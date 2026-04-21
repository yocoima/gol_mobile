export const normalizeAssetName = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+\./g, '.')
    .replace(/(?:\.(png|jpe?g|webp|gif|bmp))+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const BASE_DECK_DEFINITION = [
  { id: 'pc', name: 'Pase Corto', value: 1, type: 'pass', color: 'bg-emerald-500', count: 12, detail: 'Suma valor x1' },
  { id: 'pl', name: 'Pase Largo', value: 2, type: 'pass', color: 'bg-blue-500', count: 8, detail: 'Suma valor x2' },
  { id: 'pa', name: 'Pase Aereo', value: 3, type: 'pass', color: 'bg-cyan-500', count: 8, detail: 'Suma valor x3' },
  { id: 'cont', name: 'Contraataque', value: 0, type: 'defense', color: 'bg-indigo-600', count: 4, detail: 'Recupera durante pases' },
  { id: 'reg', name: 'Regatear', value: 0, type: 'counter', color: 'bg-teal-400', count: 6, detail: 'Responde a Barrida' },
  { id: 'tg', name: 'Tirar a Gol', value: 0, type: 'shoot', color: 'bg-red-600', count: 8, detail: 'Intenta anotar' },
  { id: 'ch', name: 'Chilena', value: 0, type: 'shoot_special', color: 'bg-orange-500', count: 3, detail: 'Tras Pase Aereo' },
  { id: 'ba', name: 'Barrida', value: 0, type: 'defense', color: 'bg-slate-700', count: 6, detail: 'Quita posesion' },
  { id: 'fa', name: 'Falta Agresiva', value: 0, type: 'defense', color: 'bg-orange-800', count: 4, detail: 'Responde con tarjeta' },
  { id: 'pe', name: 'Penalti', value: 0, type: 'shoot_direct', color: 'bg-yellow-500', count: 3, detail: 'Tiro directo' },
  { id: 'pel', name: 'Penalti Legendario', value: 0, type: 'shoot_direct', color: 'bg-amber-400', count: 1, detail: 'Imparable — ni VAR ni arquero', rarity: 'legendary' },
  { id: 'off', name: 'Offside', value: 0, type: 'save', color: 'bg-amber-600', count: 4, detail: 'Anula Tiro a Gol' },
  { id: 'paq', name: 'Parada Arquero', value: 0, type: 'save', color: 'bg-stone-500', count: 6, detail: 'Evita un gol' },
  { id: 'rem', name: 'Remate', value: 0, type: 'special', color: 'bg-pink-600', count: 4, detail: 'Tras Parada Arquero' },
  { id: 'sb', name: 'Saque Banda', value: 0, type: 'defense', color: 'bg-lime-600', count: 4, detail: 'Recupera + Pase Corto' },
  { id: 'sc', name: 'Saque Corner', value: 0, type: 'defense', color: 'bg-sky-700', count: 4, detail: 'Recupera + Pase Aereo' },
  { id: 'ta', name: 'Tarj. Amarilla', value: 0, type: 'card', color: 'bg-yellow-400', count: 4, detail: 'Contra Falta Agresiva' },
  { id: 'tr', name: 'Tarj. Roja', value: 0, type: 'card_hard', color: 'bg-red-500', count: 2, detail: 'Contra Falta Agresiva' },
  { id: 'var', name: 'VAR', value: 0, type: 'var', color: 'bg-purple-600', count: 2, detail: 'Anula Roja o Penalti' }
];

export const AUTO_PASS_BY_DEFENSE = {
  sb: { id: 'pc_auto', name: 'Pase Corto', value: 1, color: 'bg-emerald-500' }
};

export const PRE_SHOT_DEFENSE_CARD_IDS = ['ba', 'fa', 'sb', 'sc', 'cont'];

export const getRandomIndex = (maxExclusive) => {
  if (maxExclusive <= 0) {
    return 0;
  }

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
};

export const shuffleCards = (cards) => {
  const shuffled = [...cards];

  for (let currentIndex = shuffled.length - 1; currentIndex > 0; currentIndex -= 1) {
    const randomIndex = getRandomIndex(currentIndex + 1);
    [shuffled[currentIndex], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[currentIndex]];
  }

  return shuffled;
};

export const initDeck = (deckDefinition = BASE_DECK_DEFINITION) => {
  const fullDeck = deckDefinition.flatMap((card) =>
    Array.from({ length: card.count }, (_, instanceIndex) => ({
      ...card,
      instanceId: `${card.id}-${instanceIndex}-${getRandomIndex(1_000_000)}`
    }))
  );

  return shuffleCards(fullDeck);
};

export const createInitialMatchState = ({ startingPlayer = 'player', deckDefinition = BASE_DECK_DEFINITION } = {}) => {
  const deck = initDeck(deckDefinition);
  const playerHand = deck.splice(0, 5);
  const opponentHand = deck.splice(0, 5);

  return {
    gameState: 'playing',
    startedAt: new Date().toISOString(),
    startingPlayer,
    currentTurn: startingPlayer,
    possession: startingPlayer,
    hasActedThisTurn: false,
    playerScore: 0,
    opponentScore: 0,
    sanctions: { player: null, opponent: null },
    redCardPenalty: { player: 0, opponent: 0 },
    bonusTurnFor: null,
    counterAttackReady: false,
    pendingShot: null,
    pendingDefense: null,
    pendingCombo: null,
    pendingBlindDiscard: null,
    activePlay: [],
    discardPile: [],
    matchWinner: null,
    playerHand,
    opponentHand,
    deck
  };
};
