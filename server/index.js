import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createInitialMatchState, PRE_SHOT_DEFENSE_CARD_IDS } from '../shared/game/core.js';
import { applyEndTurnAction, applyPlayCardAction } from '../shared/game/engine.js';
import {
  getBlindDiscardPlan,
  getBlindDiscardResolutionPlan,
  getCardPenaltyResponsePlan,
  getDefenseResolutionPlan,
  getGoalOutcome,
  getRedCardProgressPlan,
  getShotResolutionPlan
} from '../shared/game/rules.js';
import { drawCardsFromPools, getHandLimit, getOpponent } from '../shared/game/state.js';

const app = express();
const httpServer = createServer(app);

const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  try {
    const originUrl = new URL(normalizedOrigin);

    if (originUrl.hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true
};

const rooms = new Map();

const createRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const getPlayerRole = (room, socketId) => {
  const playerIndex = room.players.findIndex((player) => player.id === socketId);

  if (playerIndex === 0) {
    return 'player';
  }

  if (playerIndex === 1) {
    return 'opponent';
  }

  return null;
};

const clearTransientState = (matchState) => {
  const autoCardsFromTable = (matchState.activePlay || []).filter((card) =>
    typeof card?.id === 'string' && card.id.endsWith('_auto')
  );
  const actor = matchState.currentTurn || matchState.possession || 'player';

  if (autoCardsFromTable.length > 0) {
    matchState.discardPile = [...autoCardsFromTable, ...matchState.discardPile];
    for (const card of autoCardsFromTable) {
      pushRecentAction(matchState, {
        actor,
        type: 'table_collect',
        card: {
          id: card.id,
          name: card.name,
          color: card.color ?? 'bg-slate-800',
          value: card.value ?? 0,
          imageUrl: card.imageUrl ?? null
        }
      });
    }
  }

  matchState.activePlay = [];
  matchState.pendingShot = null;
  matchState.pendingDefense = null;
  matchState.pendingCombo = null;
  matchState.bonusTurnFor = null;
  matchState.counterAttackReady = false;
};

const consumeSanctionTurn = (matchState, actor) => {
  const currentSanction = matchState.sanctions[actor];

  if (!currentSanction?.turnsRemaining) {
    return;
  }

  const nextTurnsRemaining = currentSanction.turnsRemaining - 1;
  matchState.sanctions[actor] =
    nextTurnsRemaining > 0 ? { ...currentSanction, turnsRemaining: nextTurnsRemaining } : null;
};

const refillActorHandToLimit = (matchState, actor, targetLimit) => {
  const handKey = actor === 'player' ? 'playerHand' : 'opponentHand';
  const currentHand = matchState[handKey];
  const drawResult = drawCardsFromPools(
    matchState.deck,
    matchState.discardPile,
    Math.max(0, targetLimit - currentHand.length)
  );

  matchState[handKey] = [...currentHand, ...drawResult.drawnCards];
  matchState.deck = drawResult.deck;
  matchState.discardPile = drawResult.discardPile;
};

const getHandKey = (actor) => (actor === 'player' ? 'playerHand' : 'opponentHand');
const createEventId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const getExpectedActor = (matchState) => {
  if (matchState.pendingBlindDiscard?.actor) {
    return matchState.pendingBlindDiscard.actor;
  }

  if (matchState.pendingDefense?.defenseCardId === 'red_card_var') {
    return matchState.pendingDefense.defender;
  }

  if (matchState.pendingDefense?.defenseCardId && matchState.pendingDefense.defenseCardId !== 'pre_shot') {
    return matchState.pendingDefense.possessor;
  }

  if (matchState.pendingDefense?.defenseCardId === 'pre_shot') {
    return matchState.pendingDefense.defender;
  }

  if (matchState.pendingShot?.phase === 'penalty_response' || matchState.pendingShot?.phase === 'save') {
    return matchState.pendingShot.defender;
  }

  if (matchState.pendingShot?.phase === 'offside_var' || matchState.pendingShot?.phase === 'remate') {
    return matchState.pendingShot.attacker;
  }

  return matchState.currentTurn;
};

const pushRecentAction = (matchState, action) => {
  const actions = Array.isArray(matchState.recentActions) ? matchState.recentActions : [];
  matchState.recentActions = [
    { ...action, id: createEventId(), at: new Date().toISOString() },
    ...actions
  ].slice(0, 24);
};

const applyStatePatch = (matchState, statePatch) => {
  if (!statePatch) {
    return;
  }

  for (const [key, value] of Object.entries(statePatch)) {
    matchState[key] = value;
  }
};

const consumeCard = (matchState, actor, index, card, actionType = 'play') => {
  const handKey = getHandKey(actor);
  const currentHand = matchState[handKey];
  const nextHand = currentHand.filter((_, handIndex) => handIndex !== index);
  const drawResult = drawCardsFromPools(
    matchState.deck,
    matchState.discardPile,
    Math.max(0, getHandLimit(matchState.redCardPenalty, actor) - nextHand.length),
    [card]
  );

  matchState[handKey] = [...nextHand, ...drawResult.drawnCards];
  matchState.deck = drawResult.deck;
  matchState.discardPile = drawResult.discardPile;
  pushRecentAction(matchState, {
    actor,
    type: actionType,
    card: {
      id: card.id,
      name: card.name,
      color: card.color ?? 'bg-slate-800',
      value: card.value ?? 0,
      imageUrl: card.imageUrl ?? null
    }
  });
};

const applyRedCardTurnProgress = (matchState, actor) => {
  const progressPlan = getRedCardProgressPlan({
    actor,
    currentTurns: matchState.redCardPenalty[actor]
  });

  if (!progressPlan.shouldApply) {
    return;
  }

  matchState.redCardPenalty[actor] = progressPlan.nextPenaltyTurns;

  if (progressPlan.shouldClearSanction) {
    matchState.sanctions[actor] = null;
    refillActorHandToLimit(matchState, actor, progressPlan.refillTo);
    return;
  }

  matchState.sanctions[actor] = progressPlan.nextSanction;
};

const applyGoal = (matchState, scorer, reason) => {
  const goalOutcome = getGoalOutcome({
    scorer,
    playerScore: matchState.playerScore,
    opponentScore: matchState.opponentScore,
    reason
  });

  matchState.playerScore = goalOutcome.nextPlayerScore;
  matchState.opponentScore = goalOutcome.nextOpponentScore;
  matchState.lastEvent = { id: createEventId(), type: 'goal', scorer, reason };
  matchState.hasActedThisTurn = false;
  applyRedCardTurnProgress(matchState, scorer);
  clearTransientState(matchState);

  if (goalOutcome.isMatchFinished) {
    matchState.gameState = 'finished';
    matchState.matchWinner = scorer;
    matchState.possession = null;
    matchState.currentTurn = null;
    return { logMessage: goalOutcome.logMessage };
  }

  matchState.possession = goalOutcome.nextActor;
  matchState.currentTurn = goalOutcome.nextActor;
  return { logMessage: goalOutcome.logMessage };
};

const openBlindDiscard = (matchState, actor, targetActor, reason, returnTurnTo) => {
  const targetHandLength = matchState[getHandKey(targetActor)].length;
  const blindDiscardPlan = getBlindDiscardPlan({
    actor,
    targetActor,
    targetHandLength,
    reason,
    returnTurnTo
  });

  if (!blindDiscardPlan.allowed) {
    return false;
  }

  matchState.pendingBlindDiscard = blindDiscardPlan.pendingBlindDiscard;
  matchState.currentTurn = blindDiscardPlan.nextTurn;
  matchState.hasActedThisTurn = blindDiscardPlan.hasActedThisTurn;
  return true;
};

const resolveBlindDiscard = (matchState, actor, index) => {
  const targetActor = matchState.pendingBlindDiscard?.targetActor ?? matchState.pendingBlindDiscard?.actor;
  if (!targetActor) {
    return false;
  }
  const handKey = getHandKey(targetActor);
  const targetHand = matchState[handKey];
  const plan = getBlindDiscardResolutionPlan({
    actor,
    index,
    targetHand,
    pendingBlindDiscard: matchState.pendingBlindDiscard
  });

  if (!plan.allowed) {
    return false;
  }

  matchState.discardPile = [plan.discardedCard, ...matchState.discardPile];
  pushRecentAction(matchState, {
    actor: plan.targetActor,
    type: 'discard',
    card: {
      id: plan.discardedCard.id,
      name: plan.discardedCard.name,
      color: plan.discardedCard.color ?? 'bg-slate-800',
      value: plan.discardedCard.value ?? 0,
      imageUrl: plan.discardedCard.imageUrl ?? null
    }
  });
  matchState[handKey] = plan.nextTargetHand;
  matchState.pendingBlindDiscard = null;
  matchState.currentTurn = plan.nextTurn;
  matchState.hasActedThisTurn = plan.hasActedThisTurn;
  return true;
};

const startShotResolution = (matchState, attacker, shotType) => {
  const defender = getOpponent(attacker);
  const shotPlan = getShotResolutionPlan({
    attacker,
    shotType,
    defenderHasVar: matchState[getHandKey(defender)].some((card) => card.id === 'var'),
    defenderHasArquero: matchState[getHandKey(defender)].some((card) => card.id === 'paq'),
    defenderHasOffside: matchState[getHandKey(defender)].some((card) => card.id === 'off')
  });

  matchState.activePlay = [];
  matchState.counterAttackReady = false;

  if (shotPlan.type === 'goal') {
    applyGoal(matchState, shotPlan.scorer, shotPlan.reason);
    return;
  }

  matchState.pendingShot = shotPlan.pendingShot;
  matchState.currentTurn = shotPlan.nextTurn;
  matchState.hasActedThisTurn = false;
};

const startDefenseResolution = (matchState, defender, defenseCard) => {
  const possessor = getOpponent(defender);
  const possessorHand = matchState[getHandKey(possessor)];
  const defensePlan = getDefenseResolutionPlan({
    defender,
    defenseCardId: defenseCard.id,
    possessorHasRegate: possessorHand.some((card) => card.id === 'reg'),
    possessorHasYellowCard: possessorHand.some((card) => card.id === 'ta'),
    possessorHasRedCard: possessorHand.some((card) => card.id === 'tr')
  });

  if (defensePlan.type === 'pending-defense') {
    matchState.pendingDefense = defensePlan.pendingDefense;
    matchState.currentTurn = defensePlan.nextTurn;
    matchState.hasActedThisTurn = false;
    return;
  }

  clearTransientState(matchState);
  matchState.possession = defensePlan.nextPossession;
  matchState.currentTurn = defensePlan.nextTurn;
  matchState.hasActedThisTurn = true;
  if (defenseCard.id === 'ba' && defensePlan.nextPossession === defender) {
    matchState.lastEvent = { id: createEventId(), type: 'barrida_success', actor: defender };
  }

  if (defensePlan.clearActivePlay) {
    matchState.activePlay = [];
  }

  if (defensePlan.pendingCombo) {
    matchState.pendingCombo = defensePlan.pendingCombo;
  }
};

const canUsePreShotDefense = (matchState, actor) =>
  PRE_SHOT_DEFENSE_CARD_IDS.some((cardId) => {
    const hand = matchState[getHandKey(actor)];

    if (cardId === 'sb') {
      return hand.some((card) => card.id === 'sb') && hand.some((card) => card.id === 'pc');
    }

    if (cardId === 'sc') {
      return hand.some((card) => card.id === 'sc') && hand.some((card) => card.id === 'pa') && hand.some((card) => card.id === 'tg');
    }

    if (cardId === 'cont') {
      return hand.some((card) => card.id === 'cont') && hand.some((card) => card.type === 'pass') && hand.some((card) => card.id === 'tg');
    }

    return hand.some((card) => card.id === cardId);
  });

const emitMatchState = (ioServer, room) => {
  if (!room.matchState) {
    return;
  }

  for (const player of room.players) {
    const role = getPlayerRole(room, player.id);
    ioServer.to(player.id).emit('match:updated', {
      room: getPublicRoom(room),
      matchState: sanitizeMatchStateForPlayer(room.matchState, role)
    });
  }
};

const sanitizeMatchStateForPlayer = (matchState, role) => {
  if (!matchState || !role) {
    return null;
  }

  const ownHand = role === 'player' ? matchState.playerHand : matchState.opponentHand;
  const rivalHand = role === 'player' ? matchState.opponentHand : matchState.playerHand;
  const playerName =
    role === 'player' ? matchState.playerNames?.player ?? 'Jugador' : matchState.playerNames?.opponent ?? 'Jugador';
  const opponentName =
    role === 'player' ? matchState.playerNames?.opponent ?? 'Rival' : matchState.playerNames?.player ?? 'Rival';

  return {
    ...matchState,
    playerRole: role,
    playerName,
    opponentName,
    yourHand: ownHand,
    opponentHandCount: rivalHand.length,
    playerHand: undefined,
    opponentHand: undefined
  };
};

const getPublicRoom = (room) => ({
  code: room.code,
  status: room.status,
  playerCount: room.players.length,
  players: room.players.map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.connected
  })),
  createdAt: room.createdAt,
  hasMatch: Boolean(room.matchState)
});

const findPlayerRoom = (socketId) => {
  for (const room of rooms.values()) {
    if (room.players.some((player) => player.id === socketId)) {
      return room;
    }
  }

  return null;
};

app.use(
  cors(corsOptions)
);
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'gol-app-server',
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/rooms', (_request, response) => {
  response.json({
    rooms: Array.from(rooms.values()).map(getPublicRoom)
  });
});

const io = new Server(httpServer, {
  cors: corsOptions
});

io.on('connection', (socket) => {
  socket.emit('server:ready', {
    socketId: socket.id,
    message: 'Conexion establecida con el backend del juego.'
  });

  socket.on('room:create', ({ playerName } = {}) => {
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'Jugador 1';
    let code = createRoomCode();

    while (rooms.has(code)) {
      code = createRoomCode();
    }

    const room = {
      code,
      createdAt: new Date().toISOString(),
      status: 'waiting',
      hostId: socket.id,
      matchState: null,
      players: [
        {
          id: socket.id,
          name: safeName,
          connected: true
        }
      ]
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit('room:created', {
      room: getPublicRoom(room),
      youAreHost: true
    });
  });

  socket.on('room:join', ({ code, playerName } = {}) => {
    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'Jugador 2';
    const room = rooms.get(normalizedCode);

    if (!room) {
      socket.emit('room:error', { message: 'La sala no existe.' });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('room:error', { message: 'La sala ya esta completa.' });
      return;
    }

    room.players.push({
      id: socket.id,
      name: safeName,
      connected: true
    });
    room.status = 'ready';
    socket.join(room.code);

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('match:start', ({ choice } = {}) => {
    const room = findPlayerRoom(socket.id);

    if (!room) {
      socket.emit('room:error', { message: 'No perteneces a ninguna sala.' });
      return;
    }

    const actorRole = getPlayerRole(room, socket.id);
    if (actorRole !== 'opponent') {
      socket.emit('room:error', { message: 'Solo el jugador invitado puede elegir Cara o Sello e iniciar.' });
      return;
    }

    if (room.players.length !== 2) {
      socket.emit('room:error', { message: 'Se necesitan dos jugadores para iniciar la partida.' });
      return;
    }

    const normalizedChoice = typeof choice === 'string' ? choice.trim().toLowerCase() : '';
    const invitedChoice = normalizedChoice === 'cara' ? 'Cara' : normalizedChoice === 'sello' ? 'Sello' : null;
    if (!invitedChoice) {
      socket.emit('room:error', { message: 'El invitado debe elegir Cara o Sello para iniciar.' });
      return;
    }
    const result = Math.random() > 0.5 ? 'Cara' : 'Sello';
    const invitedWon = invitedChoice === result;
    const starter = invitedWon ? 'opponent' : 'player';
    room.matchState = createInitialMatchState({ startingPlayer: starter });
    room.matchState.playerNames = {
      player: room.players[0]?.name ?? 'Jugador 1',
      opponent: room.players[1]?.name ?? 'Jugador 2'
    };
    room.matchState.recentActions = [];
    room.matchState.lastEvent = {
      id: createEventId(),
      type: 'coin_flip',
      invitedChoice,
      result,
      winner: starter
    };
    room.status = 'in_match';

    for (const player of room.players) {
      const role = getPlayerRole(room, player.id);
      io.to(player.id).emit('match:started', {
        room: getPublicRoom(room),
        matchState: sanitizeMatchStateForPlayer(room.matchState, role)
      });
    }

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('match:end_turn', () => {
    const room = findPlayerRoom(socket.id);

    if (!room || !room.matchState) {
      socket.emit('room:error', { message: 'No hay una partida activa en esta sala.' });
      return;
    }

    const actor = getPlayerRole(room, socket.id);

    const expectedActor = getExpectedActor(room.matchState);
    if (!actor || expectedActor !== actor) {
      socket.emit('room:error', { message: 'No es tu turno.' });
      return;
    }

    const endTurnAction = applyEndTurnAction(room.matchState);

    if (!endTurnAction.ok) {
      socket.emit('match:error', { message: endTurnAction.logMessage });
      return;
    }

    if (endTurnAction.type === 'no-response') {
      const noResponsePlan = endTurnAction.resolution;

      if (noResponsePlan.type === 'goal') {
        applyGoal(room.matchState, noResponsePlan.scorer, noResponsePlan.reason);
        emitMatchState(io, room);
        return;
      }

      if (noResponsePlan.type === 'turn-change') {
        if (noResponsePlan.clearTransientState) {
          clearTransientState(room.matchState);
        }

        room.matchState.possession = noResponsePlan.nextPossession;
        room.matchState.currentTurn = noResponsePlan.nextTurn;
        emitMatchState(io, room);
        return;
      }

      if (noResponsePlan.type === 'pending-defense-release') {
        room.matchState.pendingDefense = null;
        room.matchState.currentTurn = noResponsePlan.nextTurn;
        room.matchState.hasActedThisTurn = noResponsePlan.hasActedThisTurn;
        emitMatchState(io, room);
        return;
      }
    }

    const flowPlan = endTurnAction.resolution;

    if (flowPlan.keepsTurn) {
      room.matchState.bonusTurnFor = null;
      consumeSanctionTurn(room.matchState, flowPlan.opponentActor);
    }

    if (flowPlan.shouldApplyRedCardProgress) {
      applyRedCardTurnProgress(room.matchState, flowPlan.actor);
    }

    room.matchState.currentTurn = flowPlan.nextActor;
    room.matchState.hasActedThisTurn = false;
    emitMatchState(io, room);
  });

  socket.on('match:play_card', ({ index } = {}) => {
    const room = findPlayerRoom(socket.id);

    if (!room || !room.matchState) {
      socket.emit('room:error', { message: 'No hay una partida activa en esta sala.' });
      return;
    }

    const actor = getPlayerRole(room, socket.id);

    const expectedActor = getExpectedActor(room.matchState);
    if (!actor || expectedActor !== actor) {
      socket.emit('match:error', { message: 'Aun no es tu turno para responder.' });
      return;
    }

    if (room.matchState.pendingBlindDiscard) {
      if (!Number.isInteger(index)) {
        socket.emit('match:error', { message: 'Debes elegir una posicion valida para descartar.' });
        return;
      }

      if (!resolveBlindDiscard(room.matchState, actor, index)) {
        socket.emit('match:error', { message: 'No se pudo resolver el descarte oculto.' });
        return;
      }

      emitMatchState(io, room);
      return;
    }

    const hand = room.matchState[getHandKey(actor)];
    const card = Number.isInteger(index) ? hand[index] : null;

    if (!card) {
      socket.emit('match:error', { message: 'La carta seleccionada no es valida.' });
      return;
    }

    const playCardAction = applyPlayCardAction({
      state: {
        ...room.matchState,
        currentTurn: expectedActor,
        cardIndex: index,
        defenderCanUsePreShotDefense: canUsePreShotDefense(room.matchState, getOpponent(actor))
      },
      actor,
      card,
      selectedForDiscardCount: 0
    });

    if (!playCardAction.ok) {
      socket.emit('match:error', { message: playCardAction.logMessage || 'No puedes jugar esa carta ahora.' });
      return;
    }

    consumeCard(room.matchState, actor, index, card);

    if (playCardAction.type === 'red-card-var-response') {
      room.matchState.sanctions[actor] = null;
      if (playCardAction.plan.clearTransientState) {
        clearTransientState(room.matchState);
      }
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'defense-response') {
      const pendingDefenseBeforePatch = room.matchState.pendingDefense;
      applyStatePatch(room.matchState, playCardAction.statePatch);

      if (playCardAction.plan.type === 'card-penalty') {
        const penaltyResponsePlan = getCardPenaltyResponsePlan({
          actor,
          defender: pendingDefenseBeforePatch?.defender ?? getOpponent(actor),
          cardId: card.id
        });

        room.matchState.bonusTurnFor = penaltyResponsePlan.bonusTurnFor;
        room.matchState.possession = penaltyResponsePlan.nextPossession;
        room.matchState.currentTurn = penaltyResponsePlan.nextTurn;
        room.matchState.sanctions[penaltyResponsePlan.sanctionActor] = penaltyResponsePlan.sanction;

        if (penaltyResponsePlan.type === 'red') {
          room.matchState.redCardPenalty[penaltyResponsePlan.sanctionActor] = penaltyResponsePlan.penaltyTurns;
          openBlindDiscard(
            room.matchState,
            actor,
            penaltyResponsePlan.sanctionActor,
            penaltyResponsePlan.blindDiscardReason,
            actor
          );
        }
      }

      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'pre-shot-defense' || playCardAction.type === 'steal-defense') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startDefenseResolution(room.matchState, actor, card);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'penalty-response' || playCardAction.type === 'save-response') {
      if (playCardAction.plan.type === 'turn-change' && playCardAction.plan.clearTransientState) {
        clearTransientState(room.matchState);
      }
      if (playCardAction.type === 'save-response' && card.id === 'paq' && playCardAction.plan.type === 'turn-change') {
        room.matchState.lastEvent = { id: createEventId(), type: 'save_success', actor };
      }
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'offside-var-response') {
      if (playCardAction.plan.type === 'goal') {
        applyGoal(room.matchState, playCardAction.plan.scorer, playCardAction.plan.reason);
      } else {
        applyStatePatch(room.matchState, playCardAction.statePatch);
      }
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'remate-response') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startShotResolution(room.matchState, actor, 'remate');
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'pass-play') {
      room.matchState.activePlay = [...room.matchState.activePlay, card];
      applyStatePatch(room.matchState, playCardAction.statePatch);

      if (playCardAction.plan.preShotWindow?.open && playCardAction.plan.preShotWindow.needsDefenseWindow) {
        const defender = getOpponent(actor);
        room.matchState.pendingDefense = { defender, possessor: actor, defenseCardId: 'pre_shot' };
        room.matchState.currentTurn = defender;
        room.matchState.hasActedThisTurn = false;
      }

      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'special-corner' || playCardAction.type === 'special-chilena') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'shoot-card') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      if (room.matchState.pendingCombo?.type === 'chilena_followup') {
        room.matchState.pendingCombo = null;
        startShotResolution(room.matchState, actor, 'chilena');
      } else {
        if (room.matchState.pendingCombo?.type === 'sc_followup' && room.matchState.pendingCombo.stage === 'shot') {
          room.matchState.pendingCombo = null;
        }

        if (room.matchState.pendingCombo?.type === 'cont_followup' && room.matchState.pendingCombo.stage === 'shot') {
          room.matchState.pendingCombo = null;
        }

        startShotResolution(room.matchState, actor, 'regular');
      }
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'penalty-card') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startShotResolution(room.matchState, actor, 'penalty');
      emitMatchState(io, room);
      return;
    }

    socket.emit('match:error', { message: 'La accion aun no esta soportada por el backend.' });
  });

  socket.on('match:discard', ({ indexes } = {}) => {
    const room = findPlayerRoom(socket.id);

    if (!room || !room.matchState) {
      socket.emit('room:error', { message: 'No hay una partida activa en esta sala.' });
      return;
    }

    const actor = getPlayerRole(room, socket.id);
    if (!actor || room.matchState.currentTurn !== actor) {
      socket.emit('match:error', { message: 'No es tu turno para descartar.' });
      return;
    }

    if (room.matchState.pendingShot || room.matchState.pendingDefense || room.matchState.pendingBlindDiscard || room.matchState.pendingCombo) {
      socket.emit('match:error', { message: 'No puedes descartar mientras hay una respuesta pendiente.' });
      return;
    }

    const handKey = getHandKey(actor);
    const hand = [...room.matchState[handKey]];
    const uniqueIndexes = Array.isArray(indexes)
      ? [...new Set(indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < hand.length).sort((a, b) => a - b)
      : [];

    if (uniqueIndexes.length === 0) {
      socket.emit('match:error', { message: 'Selecciona al menos una carta para descartar.' });
      return;
    }

    const cardsToDiscard = hand.filter((_, idx) => uniqueIndexes.includes(idx));
    const nextHand = hand.filter((_, idx) => !uniqueIndexes.includes(idx));
    const drawResult = drawCardsFromPools(
      room.matchState.deck,
      room.matchState.discardPile,
      Math.max(0, getHandLimit(room.matchState.redCardPenalty, actor) - nextHand.length),
      cardsToDiscard
    );

    room.matchState[handKey] = [...nextHand, ...drawResult.drawnCards];
    room.matchState.deck = drawResult.deck;
    room.matchState.discardPile = drawResult.discardPile;
    room.matchState.currentTurn = getOpponent(actor);
    room.matchState.hasActedThisTurn = false;
    applyRedCardTurnProgress(room.matchState, actor);

    for (const card of cardsToDiscard) {
      pushRecentAction(room.matchState, {
        actor,
        type: 'discard',
        card: {
          id: card.id,
          name: card.name,
          color: card.color ?? 'bg-slate-800',
          value: card.value ?? 0,
          imageUrl: card.imageUrl ?? null
        }
      });
    }

    emitMatchState(io, room);
  });

  socket.on('room:leave', () => {
    const room = findPlayerRoom(socket.id);

    if (!room) {
      return;
    }

    room.players = room.players.filter((player) => player.id !== socket.id);
    socket.leave(room.code);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    room.status = 'waiting';
    room.matchState = null;
    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('match:terminate', () => {
    const room = findPlayerRoom(socket.id);

    if (!room || !room.matchState) {
      return;
    }

    const player = room.players.find((entry) => entry.id === socket.id);
    const playerName = player?.name || 'Un jugador';
    room.matchState = null;
    room.status = room.players.length === 2 ? 'ready' : 'waiting';

    io.to(room.code).emit('match:terminated', {
      message: `${playerName} termino la partida.`
    });

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('disconnect', () => {
    const room = findPlayerRoom(socket.id);

    if (!room) {
      return;
    }

    room.players = room.players.map((player) =>
      player.id === socket.id ? { ...player, connected: false } : player
    );
    room.status = 'waiting';
    room.matchState = null;

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Gol App server listening on port ${port}`);
  console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
});
