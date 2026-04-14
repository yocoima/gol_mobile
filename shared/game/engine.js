import { getOpponent } from './state.js';
import {
  getDefenseResponsePlan,
  getNoResponseResolutionPlan,
  getOffsideVarResponsePlan,
  getPenaltyResponsePlan,
  getRedCardVarResponsePlan,
  getSaveResponsePlan
} from './rules.js';
import {
  getPassPlayPlan,
  getPendingComboValidationMessage,
  getPreShotDefenseValidationMessage,
  getShotCardValidationMessage,
  getSpecialCardValidationMessage,
  getStealPlayValidationMessage
} from './play-validation.js';

export const createEngineContext = (state) => {
  const {
    playerHand = [],
    opponentHand = [],
    activePlay = [],
    possession = null,
    currentTurn = null,
    pendingShot = null,
    pendingDefense = null,
    pendingBlindDiscard = null,
    pendingCombo = null,
    hasActedThisTurn = false,
    bonusTurnFor = null,
    redCardPenalty = { player: 0, opponent: 0 }
  } = state;

  const getHand = (actor) => (actor === 'player' ? playerHand : opponentHand);
  const hasCardInHand = (actor, cardId) => getHand(actor).some((card) => card.id === cardId);
  const currentPassTotal = activePlay.reduce((sum, card) => sum + (card.value || 0), 0);
  const hasReactionWindow = Boolean(pendingShot || pendingDefense || pendingBlindDiscard || pendingCombo);
  const canUseDiscard = !hasActedThisTurn && !hasReactionWindow;
  const getPassTrackerTotal = (actor) => (possession === actor ? currentPassTotal : 0);

  return {
    getHand,
    hasCardInHand,
    currentPassTotal,
    hasReactionWindow,
    canUseDiscard,
    getPassTrackerTotal,
    possession,
    currentTurn,
    pendingShot,
    pendingDefense,
    pendingBlindDiscard,
    pendingCombo,
    bonusTurnFor,
    redCardPenalty
  };
};

export const getEndTurnBlockerMessage = ({ pendingBlindDiscard, pendingCombo }) => {
  if (pendingBlindDiscard) {
    return 'Debes resolver primero el descarte oculto antes de continuar.';
  }

  if (pendingCombo?.type === 'sb_followup') {
    return 'Debes completar la secuencia Saque de Banda + Pase Corto antes de finalizar el turno.';
  }

  if (pendingCombo?.type === 'sc_followup') {
    return 'Debes completar la secuencia Saque de Corner + Pase Aereo + Tirar a Gol antes de finalizar el turno.';
  }

  if (pendingCombo?.type === 'cont_followup') {
    return 'Debes completar la secuencia Contraataque + pase antes de finalizar el turno.';
  }

  if (pendingCombo?.type === 'chilena_followup') {
    return 'Debes completar la combinacion Chilena + Pase Aereo + Tirar a Gol antes de finalizar el turno.';
  }

  return null;
};

export const getEndTurnFlowPlan = ({ currentTurn, bonusTurnFor, possession, redCardPenalty }) => {
  const actor = currentTurn;
  const keepsTurn = bonusTurnFor === actor;
  const nextActor = keepsTurn ? actor : getOpponent(actor);

  return {
    actor,
    keepsTurn,
    nextActor,
    shouldConsumeOpponentSanctionTurn: keepsTurn,
    opponentActor: getOpponent(actor),
    shouldApplyRedCardProgress: !keepsTurn && redCardPenalty[actor] > 0,
    logMessage: keepsTurn
      ? 'Tarjeta Amarilla: comienza un nuevo turno extra con la misma posesion.'
      : `Cambio de turno. Balon: ${possession === 'player' ? 'Jugador' : 'Rival'}.`
  };
};

export const applyEndTurnAction = (state) => {
  const blockerMessage = getEndTurnBlockerMessage({
    pendingBlindDiscard: state.pendingBlindDiscard,
    pendingCombo: state.pendingCombo
  });

  if (blockerMessage) {
    return {
      ok: false,
      type: 'blocked',
      logMessage: blockerMessage
    };
  }

  const noResponsePlan = getNoResponseResolutionPlan({
    pendingShot: state.pendingShot,
    pendingDefense: state.pendingDefense
  });

  if (noResponsePlan) {
    return {
      ok: true,
      type: 'no-response',
      resolution: noResponsePlan
    };
  }

  return {
    ok: true,
    type: 'flow',
    resolution: getEndTurnFlowPlan({
      currentTurn: state.currentTurn,
      bonusTurnFor: state.bonusTurnFor,
      possession: state.possession,
      redCardPenalty: state.redCardPenalty
    })
  };
};

export const applyPlayCardAction = ({ state, actor, card, selectedForDiscardCount = 0 }) => {
  const engine = createEngineContext(state);
  const { getHand, hasCardInHand, currentPassTotal } = engine;

  if (state.pendingBlindDiscard) {
    if (actor !== state.pendingBlindDiscard.actor) {
      return { ok: false, type: 'blocked', logMessage: 'Debe resolverse primero el descarte oculto.' };
    }

    return { ok: true, type: 'resolve-blind-discard' };
  }

  const liveCard = getHand(actor)[state.cardIndex ?? -1] ?? card;

  if (!liveCard) {
    return { ok: false, type: 'blocked', logMessage: null };
  }

  if (state.currentTurn !== actor || selectedForDiscardCount > 0) {
    return { ok: false, type: 'blocked', logMessage: null };
  }

  if (state.pendingDefense?.defenseCardId === 'red_card_var') {
    const plan = getRedCardVarResponsePlan({
      actor,
      pendingDefense: state.pendingDefense,
      cardId: liveCard.id
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'red-card-var-response',
          card: liveCard,
          plan,
          statePatch: {
            possession: plan.nextPossession,
            currentTurn: plan.nextTurn
          }
        }
      : { ok: false, type: 'blocked', logMessage: 'Solo puedes responder con VAR para anular la Roja.' };
  }

  if (state.pendingDefense && state.pendingDefense.defenseCardId !== 'pre_shot') {
    const plan = getDefenseResponsePlan({
      actor,
      pendingDefense: state.pendingDefense,
      cardId: liveCard.id,
      defenderHasVar: hasCardInHand(state.pendingDefense.defender, 'var')
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'defense-response',
          card: liveCard,
          plan,
          statePatch:
            plan.type === 'await-var'
              ? {
                  pendingDefense: plan.nextPendingDefense,
                  currentTurn: plan.nextTurn,
                  hasActedThisTurn: plan.hasActedThisTurn,
                  discardMode: false,
                  selectedForDiscard: []
                }
              : plan.type === 'resume-play'
                ? {
                    pendingDefense: null,
                    currentTurn: plan.nextTurn,
                    hasActedThisTurn: plan.hasActedThisTurn,
                    discardMode: false,
                    selectedForDiscard: []
                  }
                : {
                    pendingDefense: null,
                    currentTurn: actor,
                    hasActedThisTurn: true,
                    discardMode: false,
                    selectedForDiscard: []
                  }
        }
      : { ok: false, type: 'blocked', logMessage: plan.errorMessage };
  }

  const pendingComboValidationMessage = getPendingComboValidationMessage({
    pendingCombo: state.pendingCombo,
    actor,
    card: liveCard
  });

  if (pendingComboValidationMessage) {
    return { ok: false, type: 'blocked', logMessage: pendingComboValidationMessage };
  }

  if (state.pendingDefense?.defenseCardId === 'pre_shot') {
    const preShotDefenseValidationMessage = getPreShotDefenseValidationMessage({
      actor,
      pendingDefense: state.pendingDefense,
      card: liveCard,
      actorHasPassCard: getHand(actor).some((handCard) => handCard.type === 'pass'),
      actorHasTirarGol: hasCardInHand(actor, 'tg'),
      actorHasPaseAereo: hasCardInHand(actor, 'pa')
    });

    return preShotDefenseValidationMessage
      ? { ok: false, type: 'blocked', logMessage: preShotDefenseValidationMessage }
      : { ok: true, type: 'pre-shot-defense', card: liveCard };
  }

  if (state.pendingShot?.phase === 'penalty_response') {
    const plan = getPenaltyResponsePlan({
      actor,
      pendingShot: state.pendingShot,
      cardId: liveCard.id,
      attackerHasRemate: hasCardInHand(state.pendingShot.attacker, 'rem')
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'penalty-response',
          card: liveCard,
          plan,
          statePatch:
            plan.type === 'turn-change'
              ? {
                  possession: plan.nextPossession,
                  currentTurn: plan.nextTurn
                }
              : {
                  pendingShot: plan.nextPendingShot,
                  currentTurn: plan.nextTurn,
                  hasActedThisTurn: plan.hasActedThisTurn,
                  discardMode: false,
                  selectedForDiscard: []
                }
        }
      : { ok: false, type: 'blocked', logMessage: 'Solo puedes responder al Penalti con VAR o Parada Arquero.' };
  }

  if (state.pendingShot?.phase === 'save') {
    const plan = getSaveResponsePlan({
      actor,
      pendingShot: state.pendingShot,
      cardId: liveCard.id,
      attackerHasVar: hasCardInHand(state.pendingShot.attacker, 'var'),
      attackerHasRemate: hasCardInHand(state.pendingShot.attacker, 'rem')
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'save-response',
          card: liveCard,
          plan,
          statePatch:
            plan.type === 'turn-change'
              ? {
                  possession: plan.nextPossession,
                  currentTurn: plan.nextTurn
                }
              : {
                  pendingShot: plan.nextPendingShot,
                  currentTurn: plan.nextTurn,
                  hasActedThisTurn: plan.hasActedThisTurn,
                  discardMode: false,
                  selectedForDiscard: []
                }
        }
      : { ok: false, type: 'blocked', logMessage: `Solo puedes responder al tiro con ${state.pendingShot.allowOffside ? 'Offside o Parada Arquero' : 'Parada Arquero'}.` };
  }

  if (state.pendingShot?.phase === 'offside_var') {
    const plan = getOffsideVarResponsePlan({
      actor,
      pendingShot: state.pendingShot,
      cardId: liveCard.id,
      defenderHasArquero: hasCardInHand(state.pendingShot.defender, 'paq')
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'offside-var-response',
          card: liveCard,
          plan,
          statePatch:
            plan.type === 'goal'
              ? null
              : {
                  pendingShot: plan.nextPendingShot,
                  currentTurn: plan.nextTurn,
                  hasActedThisTurn: plan.hasActedThisTurn,
                  discardMode: false,
                  selectedForDiscard: []
                }
        }
      : { ok: false, type: 'blocked', logMessage: 'Solo puedes responder al Offside con VAR.' };
  }

  if (state.pendingShot?.phase === 'remate') {
    if (actor !== state.pendingShot.attacker || liveCard.id !== 'rem') {
      return { ok: false, type: 'blocked', logMessage: 'Tras la parada solo puedes jugar Remate.' };
    }

    return {
      ok: true,
      type: 'remate-response',
      card: liveCard,
      statePatch: {
        hasActedThisTurn: true
      }
    };
  }

  const isPossessor = state.possession === actor;

  if (!isPossessor) {
    const stealPlayValidationMessage = getStealPlayValidationMessage({
      actorHasPaseCorto: hasCardInHand(actor, 'pc'),
      actorHasPassCard: getHand(actor).some((handCard) => handCard.type === 'pass'),
      actorHasTirarGol: hasCardInHand(actor, 'tg'),
      actorHasPaseAereo: hasCardInHand(actor, 'pa'),
      card: liveCard
    });

    return stealPlayValidationMessage
      ? { ok: false, type: 'blocked', logMessage: stealPlayValidationMessage }
      : {
          ok: true,
          type: 'steal-defense',
          card: liveCard,
          statePatch: {
            hasActedThisTurn: true,
            discardMode: false,
            selectedForDiscard: []
          }
        };
  }

  if (liveCard.type === 'pass') {
    const plan = getPassPlayPlan({
      pendingCombo: state.pendingCombo,
      currentPassTotal,
      cardValue: liveCard.value,
      counterAttackReady: state.counterAttackReady,
      defenderCanUsePreShotDefense: state.defenderCanUsePreShotDefense
    });

    return plan.allowed
      ? {
          ok: true,
          type: 'pass-play',
          card: liveCard,
          plan,
          statePatch: {
            pendingCombo: plan.nextPendingCombo,
            counterAttackReady: plan.nextCounterAttackReady,
            hasActedThisTurn: true,
            discardMode: false,
            selectedForDiscard: []
          }
        }
      : { ok: false, type: 'blocked', logMessage: plan.errorMessage };
  }

  if (liveCard.id === 'sc') {
    const validationMessage = getSpecialCardValidationMessage({
      cardId: liveCard.id,
      actorHasPaseAereo: hasCardInHand(actor, 'pa'),
      actorHasTirarGol: hasCardInHand(actor, 'tg')
    });

    return validationMessage
      ? { ok: false, type: 'blocked', logMessage: validationMessage }
      : {
          ok: true,
          type: 'special-corner',
          card: liveCard,
          statePatch: {
            activePlay: [],
            pendingCombo: { actor, type: 'sc_followup', stage: 'pass' },
            counterAttackReady: false,
            hasActedThisTurn: true,
            discardMode: false,
            selectedForDiscard: []
          },
          logMessage: 'Saque de corner activado con posesion. Debes jugar Pase Aereo y luego Tirar a Gol.'
        };
  }

  if (liveCard.id === 'tg') {
    const validationMessage = getShotCardValidationMessage({
      pendingCombo: state.pendingCombo,
      counterAttackReady: state.counterAttackReady,
      currentPassTotal
    });

    return validationMessage
      ? { ok: false, type: 'blocked', logMessage: validationMessage }
      : {
          ok: true,
          type: 'shoot-card',
          card: liveCard,
          statePatch: {
            hasActedThisTurn: true
          }
        };
  }

  if (liveCard.id === 'pe') {
    return {
      ok: true,
      type: 'penalty-card',
      card: liveCard,
      statePatch: {
        hasActedThisTurn: true
      }
    };
  }

  if (liveCard.id === 'ch') {
    const validationMessage = getSpecialCardValidationMessage({
      cardId: liveCard.id,
      actorHasPaseAereo: hasCardInHand(actor, 'pa'),
      actorHasTirarGol: hasCardInHand(actor, 'tg')
    });

    return validationMessage
      ? { ok: false, type: 'blocked', logMessage: validationMessage }
      : {
          ok: true,
          type: 'special-chilena',
          card: liveCard,
          statePatch: {
            activePlay: [],
            hasActedThisTurn: true,
            pendingCombo: {
              actor,
              type: 'chilena_followup',
              stage: 'pass'
            }
          },
          logMessage: 'Chilena activada. Ahora debes jugar Pase Aereo y luego Tirar a Gol.'
        };
  }

  if (liveCard.id === 'reg') {
    return { ok: false, type: 'blocked', logMessage: 'Regatear solo se usa como respuesta a Barrida.' };
  }

  if (liveCard.id === 'ta' || liveCard.id === 'tr') {
    return { ok: false, type: 'blocked', logMessage: 'Las tarjetas solo se usan como respuesta a Falta Agresiva.' };
  }

  if (liveCard.id === 'rem') {
    return { ok: false, type: 'blocked', logMessage: 'Remate solo se usa despues de una Parada del arquero.' };
  }

  return { ok: false, type: 'blocked', logMessage: 'No puedes usar esa carta ahora.' };
};
