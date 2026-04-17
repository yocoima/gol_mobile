import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { BASE_DECK_DEFINITION, createInitialMatchState } from '../shared/game/core.js';
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
const disconnectGraceMs = Number(process.env.DISCONNECT_GRACE_MS || 30000);
const onlineTurnTimeoutMs = Number(process.env.ONLINE_TURN_TIMEOUT_MS || 10000);
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
const disconnectTimers = new Map();

const serverDebugLog = (message, extra = {}) => {
  console.log(
    `[gol-server] ${new Date().toISOString()} ${message}`,
    Object.keys(extra).length > 0 ? extra : ''
  );
};

const createRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const deckCardById = new Map(BASE_DECK_DEFINITION.map((card) => [card.id, card]));

const createCardInstance = (cardId, suffix) => {
  const baseCard = deckCardById.get(cardId);
  if (!baseCard) {
    throw new Error(`Unknown test card id: ${cardId}`);
  }

  return {
    ...baseCard,
    instanceId: `${cardId}-${suffix}-${Math.random().toString(36).slice(2, 8)}`
  };
};

const parseTestMatchPreset = () => {
  if (!process.env.TEST_MATCH_PRESET) {
    return null;
  }

  try {
    return JSON.parse(process.env.TEST_MATCH_PRESET);
  } catch (error) {
    console.warn('[gol-server] Invalid TEST_MATCH_PRESET JSON', error);
    return null;
  }
};

const createMatchStateForRoom = (startingPlayer) => {
  const preset = parseTestMatchPreset();
  if (!preset) {
    return createInitialMatchState({ startingPlayer });
  }

  const baseState = createInitialMatchState({ startingPlayer });
  const playerHand = Array.isArray(preset.playerHand)
    ? preset.playerHand.map((cardId, index) => createCardInstance(cardId, `player-${index}`))
    : baseState.playerHand;
  const opponentHand = Array.isArray(preset.opponentHand)
    ? preset.opponentHand.map((cardId, index) => createCardInstance(cardId, `opponent-${index}`))
    : baseState.opponentHand;
  const deck = Array.isArray(preset.deck)
    ? preset.deck.map((cardId, index) => createCardInstance(cardId, `deck-${index}`))
    : baseState.deck;

  return {
    ...baseState,
    playerHand,
    opponentHand,
    deck,
    currentTurn: preset.currentTurn ?? baseState.currentTurn,
    possession: preset.possession ?? baseState.possession,
    activePlay: preset.activePlay ?? baseState.activePlay,
    tablePlay: preset.tablePlay ?? preset.activePlay ?? baseState.activePlay,
    pendingShot: preset.pendingShot ?? baseState.pendingShot,
    pendingDefense: preset.pendingDefense ?? baseState.pendingDefense,
    pendingCombo: preset.pendingCombo ?? baseState.pendingCombo,
    pendingBlindDiscard: preset.pendingBlindDiscard ?? baseState.pendingBlindDiscard,
    hasActedThisTurn: preset.hasActedThisTurn ?? baseState.hasActedThisTurn,
    bonusTurnFor: preset.bonusTurnFor ?? baseState.bonusTurnFor
  };
};

const getClientIdFromSocket = (socket) => {
  const authClientId = socket.handshake.auth?.clientId;
  if (typeof authClientId === 'string' && authClientId.trim()) {
    return authClientId.trim();
  }

  const queryClientId = socket.handshake.query?.clientId;
  if (typeof queryClientId === 'string' && queryClientId.trim()) {
    return queryClientId.trim();
  }

  return null;
};

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
const appendCardToTable = (matchState, card, actor = null) => {
  if (!card) {
    return;
  }

  matchState.tablePlay = [
    ...(matchState.tablePlay || []),
    { ...card, tableActor: actor ?? card.tableActor ?? null }
  ];
};
const trimTablePlayOnPossessionChange = (matchState, previousPossession, nextPossession) => {
  if (!previousPossession || !nextPossession || previousPossession === nextPossession) {
    return;
  }

  matchState.tablePlay = (matchState.tablePlay || []).slice(-2);
};
const shouldResetTableForNewSequence = (matchState, actor, playType) =>
  ['pass-play', 'special-corner', 'special-chilena', 'shoot-card', 'penalty-card'].includes(playType) &&
  matchState.possession === actor &&
  !matchState.pendingShot &&
  !matchState.pendingDefense &&
  !matchState.pendingBlindDiscard &&
  !matchState.pendingCombo &&
  !matchState.hasActedThisTurn &&
  (matchState.tablePlay || []).length > 0;
const getExpectedActor = (matchState) => {
  if (matchState.pendingBlindDiscard?.actor) {
    return matchState.pendingBlindDiscard.actor;
  }

  if (matchState.pendingDefense?.defenseCardId === 'red_card_var') {
    return matchState.pendingDefense.defender;
  }

  if (matchState.pendingDefense?.defenseCardId) {
    return matchState.pendingDefense.possessor;
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

  const previousPossession = matchState.possession;
  for (const [key, value] of Object.entries(statePatch)) {
    matchState[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(statePatch, 'possession')) {
    trimTablePlayOnPossessionChange(matchState, previousPossession, statePatch.possession);
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

const clearRoomTurnTimer = (room) => {
  if (room?.turnTimer?.timeoutId) {
    clearTimeout(room.turnTimer.timeoutId);
  }

  if (room) {
    room.turnTimer = null;
  }

  if (room?.matchState) {
    room.matchState.turnDeadlineAt = null;
  }
};

const shouldRunOnlineTurnTimer = (matchState) =>
  Boolean(
    matchState &&
    matchState.gameState === 'playing' &&
    matchState.currentTurn &&
    !matchState.pendingShot &&
    !matchState.pendingDefense &&
    !matchState.pendingBlindDiscard &&
    !matchState.pendingCombo
  );

const resolveServerEndTurn = (room) => {
  const endTurnAction = applyEndTurnAction(room.matchState);

  if (!endTurnAction.ok) {
    return { ok: false, message: endTurnAction.logMessage };
  }

  if (endTurnAction.type === 'no-response') {
    const noResponsePlan = endTurnAction.resolution;

    if (noResponsePlan.type === 'goal') {
      applyGoal(room.matchState, noResponsePlan.scorer, noResponsePlan.reason);
      return { ok: true };
    }

    if (noResponsePlan.type === 'turn-change') {
      if (noResponsePlan.clearTransientState) {
        clearTransientState(room.matchState);
      }

      const previousPossession = room.matchState.possession;
      room.matchState.possession = noResponsePlan.nextPossession;
      trimTablePlayOnPossessionChange(room.matchState, previousPossession, noResponsePlan.nextPossession);
      room.matchState.currentTurn = noResponsePlan.nextTurn;
      return { ok: true };
    }

    if (noResponsePlan.type === 'pending-defense-release') {
      room.matchState.pendingDefense = null;
      room.matchState.currentTurn = noResponsePlan.nextTurn;
      room.matchState.hasActedThisTurn = noResponsePlan.hasActedThisTurn;
      return { ok: true };
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
  return { ok: true };
};

const syncRoomTurnTimer = (ioServer, room) => {
  if (!room?.matchState || !shouldRunOnlineTurnTimer(room.matchState)) {
    clearRoomTurnTimer(room);
    return;
  }

  const actor = room.matchState.currentTurn;
  if (room.turnTimer?.actor === actor && room.turnTimer?.deadlineAt === room.matchState.turnDeadlineAt) {
    return;
  }

  clearRoomTurnTimer(room);

  const deadlineAt = new Date(Date.now() + onlineTurnTimeoutMs).toISOString();
  room.matchState.turnDeadlineAt = deadlineAt;
  room.turnTimer = {
    actor,
    deadlineAt,
    timeoutId: setTimeout(() => {
      const latestRoom = rooms.get(room.code);
      if (!latestRoom?.matchState) {
        return;
      }

      if (!shouldRunOnlineTurnTimer(latestRoom.matchState)) {
        clearRoomTurnTimer(latestRoom);
        return;
      }

      if (latestRoom.matchState.currentTurn !== actor || latestRoom.matchState.turnDeadlineAt !== deadlineAt) {
        return;
      }

      latestRoom.matchState.lastEvent = {
        id: createEventId(),
        type: 'turn_timeout',
        actor
      };
      clearRoomTurnTimer(latestRoom);
      const outcome = resolveServerEndTurn(latestRoom);
      if (!outcome.ok) {
        serverDebugLog('online turn timeout could not resolve end turn', {
          roomCode: latestRoom.code,
          actor,
          message: outcome.message
        });
        return;
      }
      emitMatchState(ioServer, latestRoom);
    }, onlineTurnTimeoutMs)
  };
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
  const previousPossession = matchState.possession;
  appendCardToTable(matchState, defenseCard, defender);
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
  trimTablePlayOnPossessionChange(matchState, previousPossession, defensePlan.nextPossession);
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

const emitMatchState = (ioServer, room) => {
  if (!room.matchState) {
    return;
  }

  syncRoomTurnTimer(ioServer, room);

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
    tablePlay: matchState.tablePlay || [],
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

const getDisconnectTimerKey = (roomCode, clientId) => `${roomCode}:${clientId}`;

const findPlayerRoom = (socketId) => {
  for (const room of rooms.values()) {
    if (room.players.some((player) => player.id === socketId)) {
      return room;
    }
  }

  return null;
};

const findDisconnectedPlayerByClientId = (clientId) => {
  if (!clientId) {
    return null;
  }

  for (const room of rooms.values()) {
    const player = room.players.find((entry) => entry.clientId === clientId);
    if (player) {
      return { room, player };
    }
  }

  return null;
};

const findRoomByClientId = (clientId) => {
  if (!clientId) {
    return null;
  }

  for (const room of rooms.values()) {
    if (room.players.some((player) => player.clientId === clientId)) {
      return room;
    }
  }

  return null;
};

const clearDisconnectTimer = (roomCode, clientId) => {
  const timerKey = getDisconnectTimerKey(roomCode, clientId);
  const timer = disconnectTimers.get(timerKey);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  disconnectTimers.delete(timerKey);
};

const removeClientFromAllRooms = (clientId) => {
  if (!clientId) {
    return;
  }

  for (const room of rooms.values()) {
    const nextPlayers = room.players.filter((player) => player.clientId !== clientId);
    if (nextPlayers.length === room.players.length) {
      continue;
    }

    clearDisconnectTimer(room.code, clientId);
    room.players = nextPlayers;

    if (room.hostId && !room.players.some((player) => player.id === room.hostId)) {
      room.hostId = room.players[0]?.id ?? null;
    }

    if (room.players.length === 0) {
      rooms.delete(room.code);
      continue;
    }

    room.status = room.matchState ? 'in_match' : room.players.length === 2 ? 'ready' : 'waiting';
    if (room.players.length < 2) {
      room.matchState = null;
    }

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  }
};

const syncSocketToExistingRoom = (socket, clientId, requestedCode = null) => {
  const room = requestedCode ? rooms.get(requestedCode) ?? null : findRoomByClientId(clientId);

  if (!room) {
    socket.emit('session:missing', {
      code: requestedCode ?? null,
      message: 'La sala ya no esta disponible. Debes crear o unirte a una nueva.'
    });
    return false;
  }

  const player = room.players.find((entry) => entry.clientId === clientId || entry.id === socket.id);
  if (!player) {
    socket.emit('session:missing', {
      code: requestedCode ?? room.code,
      message: 'La sala ya no esta disponible. Debes crear o unirte a una nueva.'
    });
    return false;
  }

  clearDisconnectTimer(room.code, clientId);
  const previousSocketId = player.id;
  player.id = socket.id;
  player.connected = true;
  if (room.hostId === previousSocketId) {
    room.hostId = socket.id;
  }
  room.status = room.matchState
    ? 'in_match'
    : room.players.length === 2
      ? 'ready'
      : 'waiting';

  socket.join(room.code);
  socket.emit('room:created', {
    room: getPublicRoom(room),
    youAreHost: room.hostId === socket.id
  });

  const role = getPlayerRole(room, socket.id);
  if (room.matchState && role) {
    io.to(socket.id).emit('match:updated', {
      room: getPublicRoom(room),
      matchState: sanitizeMatchStateForPlayer(room.matchState, role)
    });
  }

  io.to(room.code).emit('room:updated', {
    room: getPublicRoom(room)
  });

  return true;
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
  const clientId = getClientIdFromSocket(socket);
  serverDebugLog('socket connected', {
    socketId: socket.id,
    clientId,
    origin: socket.handshake.headers.origin ?? null
  });

  const recoveredSession = findDisconnectedPlayerByClientId(clientId);
  if (recoveredSession && !recoveredSession.player.connected) {
    syncSocketToExistingRoom(socket, clientId, recoveredSession.room.code);
    serverDebugLog('player reattached to room', {
      roomCode: recoveredSession.room.code,
      socketId: socket.id,
      clientId
    });
  }

  socket.emit('server:ready', {
    socketId: socket.id,
    message: 'Conexion establecida con el backend del juego.'
  });

  socket.on('room:sync_request', ({ code } = {}) => {
    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : null;
    serverDebugLog('room:sync_request received', {
      roomCode: normalizedCode,
      socketId: socket.id,
      clientId
    });
    syncSocketToExistingRoom(socket, clientId, normalizedCode);
  });

  socket.on('room:create', ({ playerName } = {}) => {
    const safeName = typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'Jugador 1';
    removeClientFromAllRooms(clientId);
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
      turnTimer: null,
      players: [
        {
          id: socket.id,
          clientId,
          name: safeName,
          connected: true
        }
      ]
    };

    serverDebugLog('room created', {
      roomCode: code,
      socketId: socket.id,
      clientId,
      playerName: safeName
    });
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
    removeClientFromAllRooms(clientId);
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
      clientId,
      name: safeName,
      connected: true
    });
    room.status = 'ready';
    socket.join(room.code);
    serverDebugLog('room joined', {
      roomCode: room.code,
      socketId: socket.id,
      clientId,
      playerName: safeName
    });

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('match:start', ({ choice } = {}) => {
    const room = findPlayerRoom(socket.id);
    serverDebugLog('match:start received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId,
      choice
    });

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
    room.matchState = createMatchStateForRoom(starter);
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
    syncRoomTurnTimer(io, room);

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
    serverDebugLog('match:end_turn received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId
    });

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

    const outcome = resolveServerEndTurn(room);
    if (!outcome.ok) {
      socket.emit('match:error', { message: outcome.message });
      return;
    }
    emitMatchState(io, room);
  });

  socket.on('match:play_card', ({ index } = {}) => {
    const room = findPlayerRoom(socket.id);
    serverDebugLog('match:play_card received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId,
      index
    });

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
        cardIndex: index
      },
      actor,
      card,
      selectedForDiscardCount: 0
    });

    if (!playCardAction.ok) {
      socket.emit('match:error', { message: playCardAction.logMessage || 'No puedes jugar esa carta ahora.' });
      return;
    }

    if (shouldResetTableForNewSequence(room.matchState, actor, playCardAction.type)) {
      room.matchState.tablePlay = [];
    }

    consumeCard(room.matchState, actor, index, card);

    if (playCardAction.type === 'red-card-var-response') {
      appendCardToTable(room.matchState, card, actor);
      room.matchState.sanctions[actor] = null;
      if (playCardAction.plan.clearTransientState) {
        room.matchState.pendingShot = null;
        room.matchState.pendingDefense = null;
        room.matchState.pendingCombo = null;
        room.matchState.bonusTurnFor = null;
        room.matchState.counterAttackReady = false;
      }
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'defense-response') {
      appendCardToTable(room.matchState, card, actor);
      const pendingDefenseBeforePatch = room.matchState.pendingDefense;
      applyStatePatch(room.matchState, playCardAction.statePatch);

      if (playCardAction.plan.type === 'card-penalty') {
        const penaltyResponsePlan = getCardPenaltyResponsePlan({
          actor,
          defender: pendingDefenseBeforePatch?.defender ?? getOpponent(actor),
          cardId: card.id
        });

        room.matchState.bonusTurnFor = penaltyResponsePlan.bonusTurnFor;
        const previousPossession = room.matchState.possession;
        room.matchState.possession = penaltyResponsePlan.nextPossession;
        trimTablePlayOnPossessionChange(room.matchState, previousPossession, penaltyResponsePlan.nextPossession);
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

    if (playCardAction.type === 'steal-defense') {
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startDefenseResolution(room.matchState, actor, card);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'penalty-response' || playCardAction.type === 'save-response') {
      appendCardToTable(room.matchState, card, actor);
      if (playCardAction.plan.type === 'turn-change' && playCardAction.plan.clearTransientState) {
        room.matchState.pendingShot = null;
        room.matchState.pendingDefense = null;
        room.matchState.pendingCombo = null;
        room.matchState.bonusTurnFor = null;
        room.matchState.counterAttackReady = false;
      }
      if (playCardAction.type === 'save-response' && card.id === 'paq' && playCardAction.plan.type === 'turn-change') {
        room.matchState.lastEvent = { id: createEventId(), type: 'save_success', actor };
      }
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'offside-var-response') {
      appendCardToTable(room.matchState, card, actor);
      if (playCardAction.plan.type === 'goal') {
        applyGoal(room.matchState, playCardAction.plan.scorer, playCardAction.plan.reason);
      } else {
        applyStatePatch(room.matchState, playCardAction.statePatch);
      }
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'remate-response') {
      appendCardToTable(room.matchState, card, actor);
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startShotResolution(room.matchState, actor, 'remate');
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'pass-play') {
      appendCardToTable(room.matchState, card, actor);
      room.matchState.activePlay = [...room.matchState.activePlay, card];
      applyStatePatch(room.matchState, playCardAction.statePatch);

      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'special-corner' || playCardAction.type === 'special-chilena') {
      appendCardToTable(room.matchState, card, actor);
      applyStatePatch(room.matchState, playCardAction.statePatch);
      emitMatchState(io, room);
      return;
    }

    if (playCardAction.type === 'shoot-card') {
      appendCardToTable(room.matchState, card, actor);
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
      appendCardToTable(room.matchState, card, actor);
      applyStatePatch(room.matchState, playCardAction.statePatch);
      startShotResolution(room.matchState, actor, 'penalty');
      emitMatchState(io, room);
      return;
    }

    socket.emit('match:error', { message: 'La accion aun no esta soportada por el backend.' });
  });

  socket.on('match:discard', ({ indexes } = {}) => {
    const room = findPlayerRoom(socket.id);
    serverDebugLog('match:discard received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId,
      indexes
    });

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
    serverDebugLog('room:leave received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId
    });

    if (!room) {
      return;
    }

    clearDisconnectTimer(room.code, clientId);

    room.players = room.players.filter((player) => player.clientId !== clientId && player.id !== socket.id);
    socket.leave(room.code);

    if (room.players.length === 0) {
      clearRoomTurnTimer(room);
      rooms.delete(room.code);
      return;
    }

    room.status = 'waiting';
    room.matchState = null;
    clearRoomTurnTimer(room);
    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('match:terminate', () => {
    const room = findPlayerRoom(socket.id);
    serverDebugLog('match:terminate received', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId
    });

    if (!room || !room.matchState) {
      return;
    }

    const player = room.players.find((entry) => entry.id === socket.id);
    const playerName = player?.name || 'Un jugador';
    room.matchState = null;
    room.status = room.players.length === 2 ? 'ready' : 'waiting';
    clearRoomTurnTimer(room);

    io.to(room.code).emit('match:terminated', {
      message: `${playerName} termino la partida.`
    });

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });

  socket.on('disconnect', () => {
    const room = findPlayerRoom(socket.id);
    serverDebugLog('socket disconnected', {
      roomCode: room?.code ?? null,
      socketId: socket.id,
      clientId
    });

    if (!room) {
      return;
    }

    room.players = room.players.map((player) => {
      if (player.id !== socket.id) {
        return player;
      }

      return { ...player, connected: false };
    });

    if (clientId) {
      clearDisconnectTimer(room.code, clientId);
      const timerKey = getDisconnectTimerKey(room.code, clientId);
      const timeout = setTimeout(() => {
        disconnectTimers.delete(timerKey);
        const currentRoom = rooms.get(room.code);
      if (!currentRoom) {
        return;
      }

        const disconnectedPlayer = currentRoom.players.find((player) => player.clientId === clientId);
      if (!disconnectedPlayer || disconnectedPlayer.connected) {
          return;
        }

        const hadActiveMatch = Boolean(currentRoom.matchState);
        currentRoom.players = currentRoom.players.filter((player) => player.clientId !== clientId);
        if (currentRoom.hostId && !currentRoom.players.some((player) => player.id === currentRoom.hostId)) {
          currentRoom.hostId = currentRoom.players[0]?.id ?? null;
        }
        if (currentRoom.players.length === 0) {
          clearRoomTurnTimer(currentRoom);
          rooms.delete(currentRoom.code);
          return;
        }
        currentRoom.status = 'waiting';
        currentRoom.matchState = null;
        clearRoomTurnTimer(currentRoom);
        serverDebugLog('disconnect grace expired; room reset', {
          roomCode: currentRoom.code,
          clientId
      });
      if (hadActiveMatch) {
        io.to(currentRoom.code).emit('match:terminated', {
          message: 'La partida termino por desconexion prolongada de un jugador.'
        });
      }
      io.to(currentRoom.code).emit('room:updated', {
        room: getPublicRoom(currentRoom)
      });
      }, disconnectGraceMs);
      disconnectTimers.set(timerKey, timeout);
    } else {
      room.status = 'waiting';
      room.matchState = null;
    }

    io.to(room.code).emit('room:updated', {
      room: getPublicRoom(room)
    });
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Gol App server listening on port ${port}`);
  console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
});
