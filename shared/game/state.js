import { createInitialMatchState, shuffleCards } from './core.js';

export const getOpponent = (actor) => (actor === 'player' ? 'opponent' : 'player');

export const getHandLimit = (redCardPenalty, actor) => (redCardPenalty[actor] > 0 ? 4 : 5);

export const drawCardsFromPools = (currentDeck, currentDiscardPile, amount, heldBackCards = []) => {
  let workingDeck = [...currentDeck];
  let workingDiscardPile = [...currentDiscardPile];
  const reservedDiscardCards = [...heldBackCards];
  const drawnCards = [];
  let reshuffled = false;

  while (drawnCards.length < amount) {
    if (workingDeck.length === 0) {
      if (workingDiscardPile.length === 0) {
        break;
      }

      workingDeck = shuffleCards(workingDiscardPile);
      workingDiscardPile = [];
      reshuffled = true;
    }

    const nextCard = workingDeck.shift();

    if (!nextCard) {
      break;
    }

    drawnCards.push(nextCard);
  }

  return {
    deck: workingDeck,
    discardPile: [...reservedDiscardCards, ...workingDiscardPile],
    drawnCards,
    reshuffled
  };
};

export const createLocalMatchSnapshot = ({
  startingPlayer = 'player',
  deckDefinition,
  playerName = 'Jugador',
  opponentName = 'Rival'
} = {}) => {
  const matchState = createInitialMatchState({ startingPlayer, deckDefinition });

  return {
    deck: matchState.deck,
    discardPile: matchState.discardPile,
    playerHand: matchState.playerHand,
    opponentHand: matchState.opponentHand,
    playerScore: matchState.playerScore,
    opponentScore: matchState.opponentScore,
    sanctions: matchState.sanctions,
    redCardPenalty: matchState.redCardPenalty,
    possession: matchState.possession,
    currentTurn: matchState.currentTurn,
    pendingShot: matchState.pendingShot,
    pendingDefense: matchState.pendingDefense,
    pendingCombo: matchState.pendingCombo,
    pendingBlindDiscard: matchState.pendingBlindDiscard,
    activePlay: matchState.activePlay,
    tablePlay: matchState.tablePlay,
    bonusTurnFor: matchState.bonusTurnFor,
    gameState: matchState.gameState,
    playerName,
    opponentName
  };
};
