import { describe, expect, it } from 'vitest';
import { BASE_DECK_DEFINITION, createInitialMatchState } from '../shared/game/core.js';
import { applyEndTurnAction, applyPlayCardAction } from '../shared/game/engine.js';

const getCard = (id, overrides = {}) => {
  const baseCard = BASE_DECK_DEFINITION.find((entry) => entry.id === id);
  if (!baseCard) {
    throw new Error(`Unknown card id: ${id}`);
  }

  return {
    ...baseCard,
    instanceId: `${id}-test`,
    ...overrides
  };
};

const createState = (overrides = {}) => ({
  playerHand: [],
  opponentHand: [],
  activePlay: [],
  possession: 'player',
  currentTurn: 'player',
  pendingShot: null,
  pendingDefense: null,
  pendingBlindDiscard: null,
  pendingCombo: null,
  hasActedThisTurn: false,
  bonusTurnFor: null,
  redCardPenalty: { player: 0, opponent: 0 },
  defenderCanUsePreShotDefense: false,
  ...overrides
});

describe('game logic', () => {
  it('creates an initial match with 5 cards per player and correct turn', () => {
    const matchState = createInitialMatchState({ startingPlayer: 'opponent' });

    expect(matchState.playerHand).toHaveLength(5);
    expect(matchState.opponentHand).toHaveLength(5);
    expect(matchState.currentTurn).toBe('opponent');
    expect(matchState.possession).toBe('opponent');
    expect(matchState.deck.length).toBeGreaterThan(0);
  });

  it('blocks ending the turn while a mandatory combo is pending', () => {
    const result = applyEndTurnAction(
      createState({
        pendingCombo: { actor: 'player', type: 'chilena_followup', stage: 'shot' }
      })
    );

    expect(result.ok).toBe(false);
    expect(result.logMessage).toContain('Chilena');
  });

  it('opens the pre-shot defense window when the fourth pass is completed', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('pc')],
        activePlay: [getCard('pl'), getCard('pc')],
        defenderCanUsePreShotDefense: true
      }),
      actor: 'player',
      card: getCard('pc'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('pass-play');
    expect(result.plan.preShotWindow).toEqual({
      open: true,
      needsDefenseWindow: true,
      logMessage: 'Jugada de 4 pases completada. El rival puede usar una contracarta antes del tiro.'
    });
  });

  it('rejects regatear when it is not being used as a response to barrida', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('reg')]
      }),
      actor: 'player',
      card: getCard('reg'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(false);
    expect(result.logMessage).toBe('Regatear solo se usa como respuesta a Barrida.');
  });

  it('forces Saque de Corner to have Pase Aereo and Tirar a Gol in hand', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('sc')],
        currentTurn: 'player',
        possession: 'player'
      }),
      actor: 'player',
      card: getCard('sc'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(false);
    expect(result.logMessage).toBe('Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.');
  });

  it('lets the goalkeeper save convert a shot into a remate response when available', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('rem')],
        opponentHand: [getCard('paq')],
        possession: 'player',
        currentTurn: 'opponent',
        pendingShot: {
          attacker: 'player',
          defender: 'opponent',
          shotType: 'regular',
          phase: 'save',
          allowOffside: true
        }
      }),
      actor: 'opponent',
      card: getCard('paq'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('save-response');
    expect(result.plan.type).toBe('pending-shot');
    expect(result.plan.nextPendingShot.phase).toBe('remate');
    expect(result.plan.nextTurn).toBe('player');
  });

  it('turns a red card response into a VAR window for the defender', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('tr')],
        opponentHand: [getCard('var')],
        possession: 'player',
        currentTurn: 'player',
        pendingDefense: {
          defender: 'opponent',
          possessor: 'player',
          defenseCardId: 'fa'
        }
      }),
      actor: 'player',
      card: getCard('tr'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('defense-response');
    expect(result.plan.type).toBe('await-var');
    expect(result.statePatch.pendingDefense).toEqual({
      defender: 'opponent',
      possessor: 'player',
      defenseCardId: 'red_card_var'
    });
    expect(result.statePatch.currentTurn).toBe('opponent');
  });

  it('allows VAR to cancel an offside window and restore the save phase', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('var')],
        opponentHand: [getCard('paq')],
        possession: 'player',
        currentTurn: 'player',
        pendingShot: {
          attacker: 'player',
          defender: 'opponent',
          shotType: 'regular',
          phase: 'offside_var',
          allowOffside: false
        }
      }),
      actor: 'player',
      card: getCard('var'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('offside-var-response');
    expect(result.plan.type).toBe('pending-shot');
    expect(result.plan.nextPendingShot.phase).toBe('save');
    expect(result.plan.nextTurn).toBe('opponent');
  });

  it('blocks Tirar a Gol when Contraataque still requires the mandatory pass', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('tg')],
        possession: 'player',
        currentTurn: 'player',
        pendingCombo: { actor: 'player', type: 'cont_followup', stage: 'pass' }
      }),
      actor: 'player',
      card: getCard('tg'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(false);
    expect(result.logMessage).toBe('Despues de Contraataque debes jugar obligatoriamente un pase.');
  });

  it('advances Saque de Corner combo from pass stage to shot stage', () => {
    const result = applyPlayCardAction({
      state: createState({
        playerHand: [getCard('pa')],
        possession: 'player',
        currentTurn: 'player',
        pendingCombo: { actor: 'player', type: 'sc_followup', stage: 'pass' }
      }),
      actor: 'player',
      card: getCard('pa'),
      selectedForDiscardCount: 0
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('pass-play');
    expect(result.statePatch.pendingCombo).toEqual({
      actor: 'player',
      type: 'sc_followup',
      stage: 'shot'
    });
    expect(result.statePatch.counterAttackReady).toBe(true);
  });

  it('grants the same actor an extra turn when a yellow-card bonus is active', () => {
    const result = applyEndTurnAction(
      createState({
        currentTurn: 'player',
        possession: 'player',
        bonusTurnFor: 'player'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.type).toBe('flow');
    expect(result.resolution.keepsTurn).toBe(true);
    expect(result.resolution.nextActor).toBe('player');
    expect(result.resolution.logMessage).toContain('Tarjeta Amarilla');
  });
});
