import { PRE_SHOT_DEFENSE_CARD_IDS } from './core.js';

export const getPendingComboValidationMessage = ({ pendingCombo, actor, card }) => {
  if (pendingCombo?.type === 'sb_followup') {
    if (actor !== pendingCombo.actor) {
      return 'Debe resolverse primero la combinacion de Saque de Banda + Pase Corto.';
    }

    if (card.id !== 'pc') {
      return 'Despues de Saque de Banda debes jugar obligatoriamente un Pase Corto.';
    }
  }

  if (pendingCombo?.type === 'sc_followup') {
    if (actor !== pendingCombo.actor) {
      return 'Debe resolverse primero la combinacion de Saque de Corner + Pase Aereo.';
    }

    if (pendingCombo.stage === 'pass' && card.id !== 'pa') {
      return 'Despues de Saque de Corner debes jugar obligatoriamente un Pase Aereo.';
    }

    if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
      return 'Despues del Pase Aereo debes jugar obligatoriamente Tirar a Gol.';
    }
  }

  if (pendingCombo?.type === 'cont_followup') {
    if (actor !== pendingCombo.actor) {
      return 'Debe resolverse primero la combinacion de Contraataque + pase.';
    }

    if (pendingCombo.stage === 'pass' && card.type !== 'pass') {
      return 'Despues de Contraataque debes jugar obligatoriamente un pase.';
    }

    if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
      return 'Despues del pase del Contraataque debes jugar obligatoriamente Tirar a Gol.';
    }
  }

  if (pendingCombo?.type === 'chilena_followup' && actor === pendingCombo.actor) {
    if (pendingCombo.stage === 'pass' && card.id !== 'pa') {
      return 'Despues de Chilena debes jugar obligatoriamente Pase Aereo.';
    }

    if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
      return 'Despues del Pase Aereo debes jugar obligatoriamente Tirar a Gol.';
    }
  }

  return null;
};

export const getPreShotDefenseValidationMessage = ({
  actor,
  pendingDefense,
  card,
  actorHasPassCard,
  actorHasTirarGol,
  actorHasPaseAereo
}) => {
  if (pendingDefense?.defenseCardId !== 'pre_shot') {
    return null;
  }

  if (actor !== pendingDefense.defender || !PRE_SHOT_DEFENSE_CARD_IDS.includes(card.id)) {
    return 'Antes del tiro, el defensor solo puede responder con una contracarta valida.';
  }

  if (card.id === 'cont' && (!actorHasPassCard || !actorHasTirarGol)) {
    return 'Contraataque solo puede usarse si tienes en mano un pase y una carta de Tirar a Gol.';
  }

  if (card.id === 'sc' && (!actorHasPaseAereo || !actorHasTirarGol)) {
    return 'Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.';
  }

  return null;
};

export const getStealPlayValidationMessage = ({
  actorHasPaseCorto,
  actorHasPassCard,
  actorHasTirarGol,
  actorHasPaseAereo,
  card
}) => {
  if (card.id === 'sb' && !actorHasPaseCorto) {
    return 'Saque de banda solo puede usarse si tienes Pase Corto en mano.';
  }

  if (card.id === 'cont' && (!actorHasPassCard || !actorHasTirarGol)) {
    return 'Contraataque solo puede usarse si tienes en mano un pase y una carta de Tirar a Gol.';
  }

  if (card.id === 'sc' && (!actorHasPaseAereo || !actorHasTirarGol)) {
    return 'Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.';
  }

  const canStealBall =
    ['ba', 'fa', 'sb', 'cont'].includes(card.id) ||
    (card.id === 'sc' && actorHasPaseAereo);

  if (!canStealBall) {
    return 'No tienes el balon. Debes iniciar intentando recuperarlo con una contracarta valida.';
  }

  if (card.id === 'sb' && !actorHasPaseCorto) {
    return 'Saque de banda solo puede activarse si puedes combinarlo con Pase Corto.';
  }

  return null;
};

export const getPassPlayPlan = ({ pendingCombo, currentPassTotal, cardValue, counterAttackReady, defenderCanUsePreShotDefense }) => {
  const nextPassTotal = currentPassTotal + cardValue;

  if (nextPassTotal > 4) {
    return {
      allowed: false,
      errorMessage: 'No puedes superar 4 puntos de pase en una jugada.'
    };
  }

  const nextPendingCombo =
    pendingCombo?.type === 'sb_followup'
      ? null
      : pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'pass'
        ? { ...pendingCombo, stage: 'shot' }
        : pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'pass'
          ? { ...pendingCombo, stage: 'shot' }
          : pendingCombo?.type === 'chilena_followup' && pendingCombo.stage === 'pass'
            ? { ...pendingCombo, stage: 'shot' }
            : pendingCombo;

  const nextCounterAttackReady =
    pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'pass'
      ? true
      : pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'pass'
        ? true
        : counterAttackReady;

  const preShotWindow =
    nextPassTotal === 4 && !counterAttackReady
      ? defenderCanUsePreShotDefense
        ? {
            open: true,
            needsDefenseWindow: true,
            logMessage: 'Jugada de 4 pases completada. El rival puede usar una contracarta antes del tiro.'
          }
        : {
            open: true,
            needsDefenseWindow: false,
            logMessage: 'Jugada de 4 pases completada. No hay contracarta disponible; puedes tirar a gol.'
          }
      : null;

  return {
    allowed: true,
    nextPassTotal,
    nextPendingCombo,
    nextCounterAttackReady,
    logMessage: `Pase: +${cardValue} (Total: ${nextPassTotal})`,
    preShotWindow
  };
};

export const getShotCardValidationMessage = ({ pendingCombo, counterAttackReady, currentPassTotal }) => {
  const canShootFromSpecial =
    counterAttackReady ||
    pendingCombo?.type === 'chilena_followup' ||
    (pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'shot');

  if (pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'pass') {
    return 'Antes de tirar a gol debes jugar el pase obligatorio del Contraataque.';
  }

  if (!canShootFromSpecial && currentPassTotal < 4) {
    return 'Necesitas 4 puntos de pases para tirar.';
  }

  return null;
};

export const getSpecialCardValidationMessage = ({ cardId, actorHasPaseAereo, actorHasTirarGol }) => {
  if (cardId === 'sc' && (!actorHasPaseAereo || !actorHasTirarGol)) {
    return 'Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.';
  }

  if (cardId === 'ch' && (!actorHasPaseAereo || !actorHasTirarGol)) {
    return 'La Chilena solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.';
  }

  return null;
};
