import { getOpponent } from './state.js';

export const WINNING_SCORE = 5;

export const createRedCardSanction = (turnsRemaining) => ({
  type: 'red',
  title: 'Roja',
  detail: 'Descarta 1 y juega con 4 cartas durante 3 turnos.',
  turnsRemaining
});

export const createYellowCardSanction = (turnsRemaining = 1) => ({
  type: 'yellow',
  title: 'Amarilla',
  detail: 'Pierde la jugada y concede un turno extra.',
  turnsRemaining
});

export const getBlindDiscardPlan = ({ actor, targetActor, targetHandLength, reason, returnTurnTo }) => {
  if (targetHandLength <= 0) {
    return { allowed: false };
  }

  return {
    allowed: true,
    pendingBlindDiscard: { actor, targetActor, reason, returnTurnTo },
    nextTurn: actor,
    hasActedThisTurn: false,
    discardMode: false,
    selectedForDiscard: [],
    logMessage: reason
  };
};

export const getBlindDiscardResolutionPlan = ({ actor, index, targetHand, pendingBlindDiscard }) => {
  const card = targetHand[index];

  if (!pendingBlindDiscard || pendingBlindDiscard.actor !== actor || !card) {
    return { allowed: false };
  }

  return {
    allowed: true,
    discardedCard: card,
    targetActor: pendingBlindDiscard.targetActor,
    chooserActor: actor,
    nextTargetHand: targetHand.filter((_, handIndex) => handIndex !== index),
    laneNotice: `${pendingBlindDiscard.targetActor === 'player' ? 'Jugador' : 'Rival'} descarta 1 carta oculta.`,
    nextTurn: pendingBlindDiscard.returnTurnTo,
    hasActedThisTurn: pendingBlindDiscard.returnTurnTo !== actor
  };
};

export const getRedCardProgressPlan = ({ actor, currentTurns }) => {
  if (currentTurns <= 0) {
    return { shouldApply: false };
  }

  const nextTurns = currentTurns - 1;

  if (currentTurns <= 1) {
    return {
      shouldApply: true,
      nextPenaltyTurns: nextTurns,
      shouldClearSanction: true,
      refillTo: 5
    };
  }

  return {
    shouldApply: true,
    nextPenaltyTurns: nextTurns,
    nextSanction: createRedCardSanction(nextTurns)
  };
};

export const getCardPenaltyResponsePlan = ({ actor, defender, cardId }) => {
  if (cardId === 'ta') {
    return {
      type: 'yellow',
      nextTurn: actor,
      nextPossession: actor,
      bonusTurnFor: actor,
      sanctionActor: defender,
      sanction: createYellowCardSanction(),
      logMessage: 'Tarjeta Amarilla: mantienes la posesion y robas un turno.'
    };
  }

  return {
    type: 'red',
    nextTurn: actor,
    nextPossession: actor,
    bonusTurnFor: actor,
    sanctionActor: defender,
    sanction: createRedCardSanction(3),
    penaltyTurns: 3,
    blindDiscardReason: 'Tarjeta Roja: el jugador sancionado descarta 1 carta cubierta elegida por el rival.',
    logMessage: 'Tarjeta Roja: mantienes la posesion y el rival jugara con 4 cartas durante 3 turnos.'
  };
};

export const getNoResponseResolutionPlan = ({ pendingShot, pendingDefense }) => {
  if (pendingShot?.phase === 'penalty_response') {
    return {
      type: 'goal',
      scorer: pendingShot.attacker,
      reason: 'Penalti convertido.'
    };
  }

  if (pendingShot?.phase === 'save') {
    return {
      type: 'goal',
      scorer: pendingShot.attacker,
      reason: 'Gol: no hubo Parada Arquero.'
    };
  }

  if (pendingShot?.phase === 'offside_var') {
    return {
      type: 'turn-change',
      nextTurn: pendingShot.defender,
      nextPossession: pendingShot.defender,
      clearTransientState: true,
      logMessage: 'Offside confirmado. No se uso VAR y el balon cambia de posesion.'
    };
  }

  if (pendingShot?.phase === 'remate') {
    const defender = getOpponent(pendingShot.attacker);
    return {
      type: 'turn-change',
      nextTurn: defender,
      nextPossession: defender,
      clearTransientState: true,
      logMessage: 'La jugada termino tras la parada del arquero.'
    };
  }

  if (pendingDefense?.defenseCardId === 'red_card_var') {
    return {
      type: 'pending-defense-release',
      nextTurn: pendingDefense.possessor,
      hasActedThisTurn: true,
      logMessage: 'La Roja se mantiene. No se uso VAR.'
    };
  }

  if (pendingDefense) {
    return {
      type: 'turn-change',
      nextTurn: pendingDefense.defender,
      nextPossession: pendingDefense.defender,
      clearTransientState: true,
      logMessage: 'La contracarta se resolvio sin respuesta. El balon cambia de posesion.'
    };
  }

  return null;
};

export const getRedCardVarResponsePlan = ({ actor, pendingDefense, cardId }) => {
  if (pendingDefense?.defenseCardId !== 'red_card_var' || actor !== pendingDefense.defender || cardId !== 'var') {
    return { allowed: false };
  }

  return {
    allowed: true,
    clearSanctionFor: actor,
    clearTransientState: true,
    nextTurn: actor,
    nextPossession: actor,
    logMessage: 'VAR anula la Tarjeta Roja. La Falta Agresiva se mantiene.'
  };
};

export const getDefenseResponsePlan = ({ actor, pendingDefense, cardId, defenderHasVar }) => {
  if (!pendingDefense) {
    return { allowed: false };
  }

  if (actor !== pendingDefense.possessor) {
    return { allowed: false, errorMessage: 'La respuesta a la contracarta debe jugarla quien tiene el balon.' };
  }

  if (pendingDefense.defenseCardId === 'ba' && cardId !== 'reg') {
    return { allowed: false, errorMessage: 'La Barrida solo puede responderse con Regatear.' };
  }

  if (pendingDefense.defenseCardId === 'fa' && !['ta', 'tr'].includes(cardId)) {
    return { allowed: false, errorMessage: 'La Falta Agresiva solo puede responderse con Amarilla o Roja.' };
  }

  if (cardId === 'tr' && defenderHasVar) {
    return {
      allowed: true,
      type: 'await-var',
      nextPendingDefense: { ...pendingDefense, defenseCardId: 'red_card_var' },
      nextTurn: pendingDefense.defender,
      hasActedThisTurn: false,
      logMessage: 'Tarjeta Roja jugada. El rival puede usar VAR para anularla.'
    };
  }

  if (cardId === 'reg') {
    return {
      allowed: true,
      type: 'resume-play',
      nextTurn: pendingDefense.defender,
      hasActedThisTurn: true,
      logMessage: 'Regate exitoso. La jugada continua.'
    };
  }

  return {
    allowed: true,
    type: 'card-penalty'
  };
};

export const getPenaltyResponsePlan = ({ actor, pendingShot, cardId, attackerHasRemate }) => {
  if (pendingShot?.phase !== 'penalty_response' || actor !== pendingShot.defender || !['var', 'paq'].includes(cardId)) {
    return { allowed: false };
  }

  if (cardId === 'paq') {
    if (!attackerHasRemate) {
      return {
        allowed: true,
        type: 'turn-change',
        nextTurn: actor,
        nextPossession: actor,
        clearTransientState: true,
        logMessage: 'Parada del arquero al penalti. No hay Remate disponible.'
      };
    }

    return {
      allowed: true,
      type: 'pending-shot',
      nextPendingShot: { ...pendingShot, phase: 'remate' },
      nextTurn: pendingShot.attacker,
      hasActedThisTurn: false,
      logMessage: 'Parada del arquero al penalti. El atacante puede usar Remate.'
    };
  }

  return {
    allowed: true,
    type: 'turn-change',
    nextTurn: actor,
    nextPossession: actor,
    clearTransientState: true,
    logMessage: 'VAR anula el Penalti.'
  };
};

export const getSaveResponsePlan = ({ actor, pendingShot, cardId, attackerHasVar, attackerHasRemate }) => {
  const isAllowedCard = ['paq', 'off'].includes(cardId);
  const canUseOffside = cardId === 'off' ? pendingShot?.allowOffside : true;

  if (pendingShot?.phase !== 'save' || actor !== pendingShot.defender || !isAllowedCard || !canUseOffside) {
    return { allowed: false };
  }

  if (cardId === 'off') {
    if (!attackerHasVar) {
      return {
        allowed: true,
        type: 'turn-change',
        nextTurn: actor,
        nextPossession: actor,
        clearTransientState: true,
        logMessage: 'Offside sancionado. No hubo VAR y el balon cambia de posesion.'
      };
    }

    return {
      allowed: true,
      type: 'pending-shot',
      nextPendingShot: { ...pendingShot, phase: 'offside_var', allowOffside: false },
      nextTurn: pendingShot.attacker,
      hasActedThisTurn: false,
      logMessage: 'Offside jugado. El atacante puede usar VAR para mantener la jugada.'
    };
  }

  if (!attackerHasRemate) {
    return {
      allowed: true,
      type: 'turn-change',
      nextTurn: actor,
      nextPossession: actor,
      clearTransientState: true,
      logMessage: 'Parada del arquero. No hay Remate disponible.'
    };
  }

  return {
    allowed: true,
    type: 'pending-shot',
    nextPendingShot: { ...pendingShot, phase: 'remate' },
    nextTurn: pendingShot.attacker,
    hasActedThisTurn: false,
    logMessage: 'Parada del arquero. El atacante puede usar Remate.'
  };
};

export const getOffsideVarResponsePlan = ({ actor, pendingShot, cardId, defenderHasArquero }) => {
  if (pendingShot?.phase !== 'offside_var' || actor !== pendingShot.attacker || cardId !== 'var') {
    return { allowed: false };
  }

  if (defenderHasArquero) {
    return {
      allowed: true,
      type: 'pending-shot',
      nextPendingShot: { ...pendingShot, phase: 'save', allowOffside: false },
      nextTurn: pendingShot.defender,
      hasActedThisTurn: false,
      logMessage: 'VAR anula el Offside. El rival aun puede usar Parada Arquero.'
    };
  }

  return {
    allowed: true,
    type: 'goal',
    scorer: actor,
    reason: 'VAR anula el Offside. Gol: no hubo Parada Arquero.'
  };
};

export const getGoalOutcome = ({ scorer, playerScore, opponentScore, winScore = WINNING_SCORE, reason }) => {
  const nextPlayerScore = scorer === 'player' ? playerScore + 1 : playerScore;
  const nextOpponentScore = scorer === 'opponent' ? opponentScore + 1 : opponentScore;
  const scorerLabel = scorer === 'player' ? 'Jugador' : 'Rival';
  const isMatchFinished = Math.max(nextPlayerScore, nextOpponentScore) >= winScore;

  return {
    scorer,
    scorerLabel,
    nextPlayerScore,
    nextOpponentScore,
    nextActor: getOpponent(scorer),
    isMatchFinished,
    celebrationText: scorer === 'player' ? 'GOOOL DEL JUGADOR' : 'GOOOL DEL RIVAL',
    logMessage: isMatchFinished ? `${reason} ${scorerLabel} gana el partido ${winScore} goles.` : reason,
    laneNotice: `${scorer === 'player' ? 'Jugador' : 'Rival'} anota gol.`
  };
};

export const getShotResolutionPlan = ({
  attacker,
  shotType,
  defenderHasVar,
  defenderHasArquero,
  defenderHasOffside
}) => {
  const defender = getOpponent(attacker);
  const unstoppable = shotType === 'chilena';

  if (unstoppable) {
    return {
      type: 'goal',
      scorer: attacker,
      reason: shotType === 'chilena' ? 'Chilena: gol automatico.' : 'Remate: gol.'
    };
  }

  if (shotType === 'penalty') {
    if (defenderHasVar || defenderHasArquero) {
      return {
        type: 'pending-shot',
        nextTurn: defender,
        pendingShot: { attacker, defender, shotType, phase: 'penalty_response' },
        logMessage: 'Penalti cobrado. El rival puede responder con VAR o Parada Arquero.'
      };
    }

    return {
      type: 'goal',
      scorer: attacker,
      reason: 'Penalti convertido.'
    };
  }

  const canUseOffside = shotType !== 'remate' && defenderHasOffside;

  if (defenderHasArquero || canUseOffside) {
    return {
      type: 'pending-shot',
      nextTurn: defender,
      pendingShot: {
        attacker,
        defender,
        shotType,
        phase: 'save',
        allowOffside: canUseOffside
      },
      logMessage:
        shotType === 'remate'
          ? 'Remate al arco. El rival puede responder con Parada Arquero.'
          : `Tiro al arco. El rival puede responder con ${canUseOffside ? 'Offside o Parada Arquero' : 'Parada Arquero'}.`
    };
  }

  return {
    type: 'goal',
    scorer: attacker,
    reason:
      shotType === 'remate'
        ? 'Remate convertido. No hubo Parada Arquero.'
        : 'Gol: el rival no tenia Offside ni Parada Arquero.'
  };
};

export const getDefenseResolutionPlan = ({
  defender,
  defenseCardId,
  possessorHasRegate,
  possessorHasYellowCard,
  possessorHasRedCard
}) => {
  const possessor = getOpponent(defender);

  if (defenseCardId === 'ba') {
    if (possessorHasRegate) {
      return {
        type: 'pending-defense',
        nextTurn: possessor,
        pendingDefense: { defender, possessor, defenseCardId: 'ba' },
        logMessage: 'Barrida activada. Puedes responder con Regatear.'
      };
    }

    return {
      type: 'possession-change',
      nextTurn: defender,
      nextPossession: defender,
      logMessage: 'Barrida exitosa. El balon cambia de posesion.'
    };
  }

  if (defenseCardId === 'fa') {
    if (possessorHasYellowCard || possessorHasRedCard) {
      return {
        type: 'pending-defense',
        nextTurn: possessor,
        pendingDefense: { defender, possessor, defenseCardId: 'fa' },
        logMessage: 'Falta agresiva. Puedes responder con Amarilla o Roja.'
      };
    }

    return {
      type: 'possession-change',
      nextTurn: defender,
      nextPossession: defender,
      logMessage: 'Falta agresiva sin respuesta. El balon cambia de posesion.'
    };
  }

  if (defenseCardId === 'cont') {
    return {
      type: 'combo',
      nextTurn: defender,
      nextPossession: defender,
      pendingCombo: { actor: defender, type: 'cont_followup', stage: 'pass' },
      logMessage: 'Contraataque activado. Debes jugar un pase y luego Tirar a Gol.'
    };
  }

  if (defenseCardId === 'sb') {
    return {
      type: 'combo',
      nextTurn: defender,
      nextPossession: defender,
      pendingCombo: { actor: defender, type: 'sb_followup' },
      logMessage: 'Saque de banda activado. Debes jugar Pase Corto para recuperar y sumar un pase.'
    };
  }

  if (defenseCardId === 'sc') {
    return {
      type: 'combo',
      nextTurn: defender,
      nextPossession: defender,
      pendingCombo: { actor: defender, type: 'sc_followup', stage: 'pass' },
      clearActivePlay: true,
      logMessage: 'Saque de corner activado. Debes jugar Pase Aereo y luego Tirar a Gol.'
    };
  }

  return {
    type: 'possession-change',
    nextTurn: defender,
    nextPossession: defender,
    logMessage: 'El balon cambia de posesion.'
  };
};
