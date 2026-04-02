import React, { useEffect, useState } from 'react';
import {
  ArrowRightCircle,
  Coins,
  History,
  Library,
  RefreshCcw,
  Trash2,
} from 'lucide-react';

const CARD_IMAGE_MODULES = import.meta.glob('../imagenes/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
});

const normalizeAssetName = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const CARD_IMAGE_BY_NAME = Object.fromEntries(
  Object.entries(CARD_IMAGE_MODULES).map(([path, assetUrl]) => {
    const fileName = path.split('/').pop() ?? path;
    return [normalizeAssetName(fileName), assetUrl];
  })
);
const CARD_IMAGE_BY_ID = {
  ta: CARD_IMAGE_BY_NAME['tarjeta amarilla'] ?? null,
  tr: CARD_IMAGE_BY_NAME['tarjeta roja'] ?? null
};
const BALL_IMAGE = CARD_IMAGE_BY_NAME.balon ?? null;

const DECK_DEFINITION = [
  { id: 'pc', name: 'Pase Corto', value: 1, type: 'pass', color: 'bg-emerald-500', count: 12, detail: 'Suma valor x1' },
  { id: 'pl', name: 'Pase Largo', value: 2, type: 'pass', color: 'bg-blue-500', count: 8, detail: 'Suma valor x2' },
  { id: 'pa', name: 'Pase Aereo', value: 3, type: 'pass', color: 'bg-cyan-500', count: 6, detail: 'Suma valor x3' },
  { id: 'cont', name: 'Contraataque', value: 0, type: 'defense', color: 'bg-indigo-600', count: 4, detail: 'Recupera durante pases' },
  { id: 'reg', name: 'Regatear', value: 0, type: 'counter', color: 'bg-teal-400', count: 8, detail: 'Responde a Barrida' },
  { id: 'tg', name: 'Tirar a Gol', value: 0, type: 'shoot', color: 'bg-red-600', count: 8, detail: 'Intenta anotar' },
  { id: 'ch', name: 'Chilena', value: 0, type: 'shoot_special', color: 'bg-orange-500', count: 2, detail: 'Tras Pase Aereo' },
  { id: 'ba', name: 'Barrida', value: 0, type: 'defense', color: 'bg-slate-700', count: 8, detail: 'Quita posesion' },
  { id: 'fa', name: 'Falta Agresiva', value: 0, type: 'defense', color: 'bg-orange-800', count: 4, detail: 'Responde con tarjeta' },
  { id: 'pe', name: 'Penalti', value: 0, type: 'shoot_direct', color: 'bg-yellow-500', count: 2, detail: 'Tiro directo' },
  { id: 'paq', name: 'Parada Arquero', value: 0, type: 'save', color: 'bg-stone-500', count: 7, detail: 'Evita un gol' },
  { id: 'rem', name: 'Remate', value: 0, type: 'special', color: 'bg-pink-600', count: 4, detail: 'Tras Parada Arquero' },
  { id: 'sb', name: 'Saque Banda', value: 0, type: 'defense', color: 'bg-lime-600', count: 4, detail: 'Recupera + Pase Corto' },
  { id: 'sc', name: 'Saque Corner', value: 0, type: 'defense', color: 'bg-sky-700', count: 3, detail: 'Recupera + Pase Aereo' },
  { id: 'ta', name: 'Tarj. Amarilla', value: 0, type: 'card', color: 'bg-yellow-400', count: 4, detail: 'Contra Falta Agresiva' },
  { id: 'tr', name: 'Tarj. Roja', value: 0, type: 'card_hard', color: 'bg-red-500', count: 2, detail: 'Contra Falta Agresiva' },
  { id: 'var', name: 'VAR', value: 0, type: 'var', color: 'bg-purple-600', count: 2, detail: 'Anula Roja o Penalti' }
].map((card) => {
  const imageAliases = {
    'barrida': ['barrida'],
    'saque banda': ['saque de banda', 'saque banda'],
    'pase corto': ['pase corto'],
    'pase largo': ['pase largo'],
    'pase aereo': ['pase aereo', 'pase aéreo'],
    'falta agresiva': ['falta agresiva'],
    'parada arquero': ['parada del arquero'],
    'saque corner': ['saque de corner', 'saque corner'],
    'tarj. amarilla': ['tarj. amarilla', 'tarjeta amarilla', 'tarjea amarilla'],
    'tarj. roja': ['tarj. roja', 'tarjeta roja'],
    'tirar a gol': ['tirar a gol'],
    'var': ['var']
  };

  const normalizedCardName = normalizeAssetName(card.name);
  const aliasCandidates = imageAliases[normalizedCardName] ?? [normalizedCardName];
  const imageUrl = aliasCandidates
    .map((candidate) => CARD_IMAGE_BY_NAME[normalizeAssetName(candidate)])
    .find(Boolean);

  return { ...card, imageUrl: CARD_IMAGE_BY_ID[card.id] ?? imageUrl ?? null };
});

const DEV_SHOW_OPPONENT_HAND = true;
const AUTO_PASS_BY_DEFENSE = {
  sb: { id: 'pc_auto', name: 'Pase Corto', value: 1, color: 'bg-emerald-500' },
  sc: { id: 'pa_auto', name: 'Pase Aereo', value: 3, color: 'bg-cyan-500' }
};
const PRE_SHOT_DEFENSE_CARD_IDS = ['ba', 'fa', 'sb', 'sc', 'cont'];

const initDeck = () => {
  const fullDeck = DECK_DEFINITION.flatMap((card) =>
    Array.from({ length: card.count }, () => ({ ...card }))
  );

  return fullDeck.sort(() => Math.random() - 0.5);
};

const SoccerBallIcon = ({ size, className }) =>
  BALL_IMAGE ? (
    <span
      className={`relative inline-flex overflow-hidden rounded-full ${className || ''}`}
      style={{
        width: size,
        height: size,
        boxShadow: '0 10px 18px rgba(0, 0, 0, 0.28), inset 0 -8px 14px rgba(0, 0, 0, 0.2)'
      }}
    >
      <img
        src={BALL_IMAGE}
        alt="Balon"
        width={size}
        height={size}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="pointer-events-none absolute inset-[8%] rounded-full border border-white/18" />
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.42),rgba(255,255,255,0.08)_26%,transparent_42%)]" />
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_68%_74%,transparent,rgba(0,0,0,0.24)_72%)]" />
    </span>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m12 12-4-2.5M12 12l4-2.5M12 12v5" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );

const CardItem = ({
  card,
  onClick,
  onSelect,
  disabled,
  isSelected,
  canSelectDiscard,
  isDiscardMode,
  hideContent = false
}) => {
  const cardImage = card?.imageUrl;

  return (
  <div className="relative group flex w-[82px] flex-col items-center">
    {canSelectDiscard && isDiscardMode && !disabled && (
      <button
        onClick={onSelect}
        className={`absolute -top-2 -right-1 z-30 rounded-full border p-1 shadow-lg transition-all ${
          isSelected ? 'border-white bg-orange-500' : 'border-white/20 bg-slate-700'
        }`}
      >
        {isSelected ? <Trash2 size={10} /> : <RefreshCcw size={10} className="opacity-50" />}
      </button>
    )}

    <button
      onClick={isDiscardMode ? onSelect : onClick}
      disabled={disabled}
      className={`
        ${hideContent || cardImage ? 'bg-slate-900' : card?.color || 'bg-slate-800'} h-28 w-[82px] overflow-hidden rounded-[18px] border border-white/10 p-0 shadow-[0_14px_30px_rgba(0,0,0,0.35)] transition-all duration-200
        flex flex-col justify-between
        ${!disabled ? 'hover:-translate-y-4 hover:shadow-emerald-400/30' : 'grayscale opacity-40 border-white/5'}
        ${isSelected ? 'scale-90 brightness-50 ring-2 ring-orange-300' : ''}
      `}
    >
      {cardImage && !hideContent && (
        <>
          <img
            src={cardImage}
            alt={card?.name}
            className="absolute inset-0 h-full w-full rounded-[18px] object-cover object-center"
          />
          <div className="absolute inset-0 rounded-[18px] bg-gradient-to-b from-black/18 via-transparent to-black/28" />
          <div className="absolute inset-[3px] rounded-[15px] border border-white/12" />
        </>
      )}
    </button>

    <div className="mt-2 flex min-h-[18px] w-full items-center justify-center rounded-md bg-transparent px-1 py-0 text-center">
      <div className="text-[7px] font-black uppercase leading-tight text-white/95">
        {hideContent ? 'Carta oculta' : card?.name}
      </div>
    </div>
  </div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState('coin-flip');
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [deck, setDeck] = useState([]);
  const [discardPile, setDiscardPile] = useState([]);
  const [playerHand, setPlayerHand] = useState([]);
  const [opponentHand, setOpponentHand] = useState([]);
  const [activePlay, setActivePlay] = useState([]);
  const [possession, setPossession] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [hasActedThisTurn, setHasActedThisTurn] = useState(false);
  const [selectedForDiscard, setSelectedForDiscard] = useState([]);
  const [discardMode, setDiscardMode] = useState(false);
  const [pendingShot, setPendingShot] = useState(null);
  const [pendingDefense, setPendingDefense] = useState(null);
  const [pendingCombo, setPendingCombo] = useState(null);
  const [counterAttackReady, setCounterAttackReady] = useState(false);
  const [bonusTurnFor, setBonusTurnFor] = useState(null);
  const [pendingForcedDiscards, setPendingForcedDiscards] = useState({ player: 0, opponent: 0 });
  const [pendingBlindDiscard, setPendingBlindDiscard] = useState(null);
  const [gameLog, setGameLog] = useState(['Posesion persistente activada']);
  const [goalCelebration, setGoalCelebration] = useState(null);
  const [matchWinner, setMatchWinner] = useState(null);

  const isPlayerTurn = currentTurn === 'player';
  const isOpponentTurn = currentTurn === 'opponent';
  const currentTurnLabel = isPlayerTurn ? 'Jugador' : isOpponentTurn ? 'Rival' : 'Nadie';
  const currentPassTotal = activePlay.reduce((sum, card) => sum + (card.value || 0), 0);

  const addLog = (message) => {
    setGameLog((previousLog) => [message, ...previousLog].slice(0, 5));
  };

  useEffect(() => {
    if (!goalCelebration) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setGoalCelebration(null);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [goalCelebration]);

  const getOpponent = (actor) => (actor === 'player' ? 'opponent' : 'player');
  const getHand = (actor) => (actor === 'player' ? playerHand : opponentHand);
  const hasCardInHand = (actor, cardId) => getHand(actor).some((card) => card.id === cardId);
  const canUsePreShotDefense = (actor) =>
    PRE_SHOT_DEFENSE_CARD_IDS.some((cardId) => {
      if (cardId === 'sb') {
        return hasCardInHand(actor, 'sb') && hasCardInHand(actor, 'pc');
      }

      if (cardId === 'sc') {
        return hasCardInHand(actor, 'sc') && hasCardInHand(actor, 'pa');
      }

      if (cardId === 'cont') {
        return hasCardInHand(actor, 'cont') && getHand(actor).some((card) => card.type === 'pass') && hasCardInHand(actor, 'tg');
      }

      return hasCardInHand(actor, cardId);
    });
  const hasReactionWindow = Boolean(pendingShot || pendingDefense || pendingBlindDiscard || pendingCombo);
  const canUseDiscard = !hasActedThisTurn && !hasReactionWindow;
  const reactionBannerMessage =
    pendingBlindDiscard
      ? `DESCARTE OCULTO EN CURSO: ${pendingBlindDiscard.actor === 'player' ? 'JUGADOR' : 'RIVAL'}`
      : pendingShot?.phase === 'penalty_response'
        ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: PENALTI`
        : pendingShot?.phase === 'save'
          ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: PARADA DEL ARQUERO`
          : pendingShot?.phase === 'remate'
            ? `VENTANA DE RESPUESTA DEL ${pendingShot.attacker === 'player' ? 'JUGADOR' : 'RIVAL'}: REMATE`
            : pendingDefense?.defenseCardId === 'pre_shot'
              ? `VENTANA DE RESPUESTA DEL ${pendingDefense.defender === 'player' ? 'JUGADOR' : 'RIVAL'} ANTES DEL TIRO`
              : pendingDefense?.defenseCardId === 'tr_var'
                ? `VENTANA DE RESPUESTA DEL ${pendingDefense.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: VAR`
                  : pendingDefense?.defenseCardId
                    ? `VENTANA DE RESPUESTA DEL ${pendingDefense.possessor === 'player' ? 'JUGADOR' : 'RIVAL'}`
                  : pendingCombo?.type === 'sb_followup'
                    ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR PASE CORTO`
                  : pendingCombo?.type === 'cont_followup'
                    ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR UN PASE`
                      : null;

  const clearTransientState = () => {
    setActivePlay([]);
    setPendingShot(null);
    setPendingDefense(null);
    setPendingCombo(null);
    setCounterAttackReady(false);
    setBonusTurnFor(null);
    setDiscardMode(false);
    setSelectedForDiscard([]);
    setHasActedThisTurn(false);
  };

  const resetMatch = () => {
    setGameState('coin-flip');
    setPlayerScore(0);
    setOpponentScore(0);
    setDeck([]);
    setDiscardPile([]);
    setPlayerHand([]);
    setOpponentHand([]);
    setPossession(null);
    setCurrentTurn(null);
    setPendingForcedDiscards({ player: 0, opponent: 0 });
    setPendingBlindDiscard(null);
    setGoalCelebration(null);
    setMatchWinner(null);
    setGameLog(['Posesion persistente activada']);
    clearTransientState();
  };

  const consumeCard = (actor, index, card) => {
    setDiscardPile((previousPile) => [card, ...previousPile]);

    if (actor === 'player') {
      setPlayerHand((previousHand) => previousHand.filter((_, handIndex) => handIndex !== index));
      return;
    }

    setOpponentHand((previousHand) => previousHand.filter((_, handIndex) => handIndex !== index));
  };

  const consumeCardAndRefillOne = (actor, index, card) => {
    const newDeck = [...deck];
    const drawnCard = newDeck.shift();

    setDiscardPile((previousPile) => [card, ...previousPile]);
    setDeck(newDeck);

    if (actor === 'player') {
      setPlayerHand((previousHand) => {
        const nextHand = previousHand.filter((_, handIndex) => handIndex !== index);
        return drawnCard ? [...nextHand, drawnCard] : nextHand;
      });
      return;
    }

    setOpponentHand((previousHand) => {
      const nextHand = previousHand.filter((_, handIndex) => handIndex !== index);
      return drawnCard ? [...nextHand, drawnCard] : nextHand;
    });
  };

  const forceDiscardOneCard = (actor, reason) => {
    const hand = getHand(actor);

    if (hand.length === 0) {
      return false;
    }

    const randomIndex = Math.floor(Math.random() * hand.length);
    const cardToDiscard = hand[randomIndex];
    setDiscardPile((previousPile) => [cardToDiscard, ...previousPile]);

    if (actor === 'player') {
      setPlayerHand((previousHand) => previousHand.filter((_, index) => index !== randomIndex));
    } else {
      setOpponentHand((previousHand) => previousHand.filter((_, index) => index !== randomIndex));
    }

    addLog(reason);
    return true;
  };

  const openBlindDiscard = (actor, reason, returnTurnTo) => {
    if (getHand(actor).length === 0) {
      return false;
    }

    setPendingBlindDiscard({ actor, reason, returnTurnTo });
    setCurrentTurn(actor);
    setHasActedThisTurn(false);
    setDiscardMode(false);
    setSelectedForDiscard([]);
    addLog(reason);
    return true;
  };

  const resolveBlindDiscard = (actor, index) => {
    const hand = getHand(actor);
    const card = hand[index];

    if (!pendingBlindDiscard || pendingBlindDiscard.actor !== actor || !card) {
      return;
    }

    setDiscardPile((previousPile) => [card, ...previousPile]);

    if (actor === 'player') {
      setPlayerHand((previousHand) => previousHand.filter((_, handIndex) => handIndex !== index));
    } else {
      setOpponentHand((previousHand) => previousHand.filter((_, handIndex) => handIndex !== index));
    }

    const returnTurnTo = pendingBlindDiscard.returnTurnTo;
    setPendingBlindDiscard(null);
    setCurrentTurn(returnTurnTo);
    setHasActedThisTurn(returnTurnTo !== actor);
  };

  const fillHandsToFive = () => {
    const newDeck = [...deck];
    const nextPlayerHand = [...playerHand, ...newDeck.splice(0, Math.max(0, 5 - playerHand.length))];
    const nextOpponentHand = [...opponentHand, ...newDeck.splice(0, Math.max(0, 5 - opponentHand.length))];

    setPlayerHand(nextPlayerHand);
    setOpponentHand(nextOpponentHand);
    setDeck(newDeck);
  };

  const scoreGoal = (scorer, reason) => {
    const scorerLabel = scorer === 'player' ? 'Jugador' : 'Rival';
    const nextPlayerScore = scorer === 'player' ? playerScore + 1 : playerScore;
    const nextOpponentScore = scorer === 'opponent' ? opponentScore + 1 : opponentScore;

    setPlayerScore(nextPlayerScore);
    setOpponentScore(nextOpponentScore);
    setGoalCelebration({
      scorer,
      text: scorer === 'player' ? 'GOOOL DEL JUGADOR' : 'GOOOL DEL RIVAL'
    });

    const nextActor = getOpponent(scorer);
    clearTransientState();

    if (Math.max(nextPlayerScore, nextOpponentScore) >= 5) {
      setMatchWinner(scorer);
      setGameState('finished');
      setPossession(null);
      setCurrentTurn(null);
      addLog(`${reason} ${scorerLabel} gana el partido 5 goles.`);
      return;
    }

    fillHandsToFive();
    setPossession(nextActor);
    setCurrentTurn(nextActor);
    addLog(reason);
  };

  const startShotResolution = (attacker, shotType) => {
    const defender = getOpponent(attacker);
    const unstoppable = shotType === 'chilena' || shotType === 'remate';

    setActivePlay([]);
    setCounterAttackReady(false);

    if (unstoppable) {
      scoreGoal(attacker, shotType === 'chilena' ? 'Chilena: gol automatico.' : 'Remate: gol.');
      return;
    }

    if (shotType === 'penalty') {
      if (hasCardInHand(defender, 'var') || hasCardInHand(defender, 'paq')) {
        setPendingShot({ attacker, defender, shotType, phase: 'penalty_response' });
        setCurrentTurn(defender);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Penalti cobrado. El rival puede responder con VAR o Parada Arquero.');
        return;
      }

      scoreGoal(attacker, 'Penalti convertido.');
      return;
    }

    if (hasCardInHand(defender, 'paq')) {
      setPendingShot({ attacker, defender, shotType, phase: 'save' });
      setCurrentTurn(defender);
      setHasActedThisTurn(false);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog('Tiro al arco. El rival puede usar Parada Arquero.');
      return;
    }

    scoreGoal(attacker, 'Gol: el rival no tenia Parada Arquero.');
  };

  const startDefenseResolution = (defender, defenseCard) => {
    const possessor = getOpponent(defender);

    if (defenseCard.id === 'ba') {
      if (hasCardInHand(possessor, 'reg')) {
        setPendingDefense({ defender, possessor, defenseCardId: 'ba' });
        setCurrentTurn(possessor);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Barrida activada. Puedes responder con Regatear.');
        return;
      }

      clearTransientState();
      setPossession(defender);
      setCurrentTurn(defender);
      addLog('Barrida exitosa. El balon cambia de posesion.');
      return;
    }

    if (defenseCard.id === 'fa') {
      if (hasCardInHand(possessor, 'ta') || hasCardInHand(possessor, 'tr')) {
        setPendingDefense({ defender, possessor, defenseCardId: 'fa' });
        setCurrentTurn(possessor);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Falta agresiva. Puedes responder con Amarilla o Roja.');
        return;
      }

      clearTransientState();
      setPossession(defender);
      setCurrentTurn(defender);
      addLog('Falta agresiva sin respuesta. El balon cambia de posesion.');
      return;
    }

    clearTransientState();
    setPossession(defender);
    setCurrentTurn(defender);

    if (defenseCard.id === 'cont') {
      setPendingCombo({ actor: defender, type: 'cont_followup' });
      addLog('Contraataque: recuperas el balon, pero debes combinarlo con un pase antes de tirar a gol.');
      return;
    }

    if (defenseCard.id === 'sb') {
      setPendingCombo({ actor: defender, type: 'sb_followup' });
      addLog('Saque de banda: recuperas el balon, pero debes combinarlo con Pase Corto.');
      return;
    }

    if (defenseCard.id === 'sc') {
      setActivePlay([AUTO_PASS_BY_DEFENSE.sc]);
      setCounterAttackReady(true);
      addLog('Saque de corner: recuperas el balon con Pase Aereo listo.');
    }
  };

  const handleCoinFlip = (choice) => {
    const result = Math.random() > 0.5 ? 'Cara' : 'Sello';
    const winner = choice === result ? 'player' : 'opponent';

    setPossession(winner);
    setCurrentTurn(winner);
    setGameState('dealing');
    addLog(`Salio ${result}. El ${winner === 'player' ? 'Jugador' : 'Rival'} tiene el balon.`);
  };

  const handleDeal = () => {
    const newDeck = initDeck();
    setPlayerHand(newDeck.splice(0, 5));
    setOpponentHand(newDeck.splice(0, 5));
    setDeck(newDeck);
    setGameState('playing');
  };

  const endTurn = () => {
    if (pendingCombo?.type === 'sb_followup') {
      addLog('Debes completar la secuencia Saque de Banda + Pase Corto antes de finalizar el turno.');
      return;
    }

    if (pendingCombo?.type === 'cont_followup') {
      addLog('Debes completar la secuencia Contraataque + pase antes de finalizar el turno.');
      return;
    }

    if (pendingShot?.phase === 'penalty_response') {
      scoreGoal(pendingShot.attacker, 'Penalti convertido.');
      return;
    }

    if (pendingShot?.phase === 'save') {
      scoreGoal(pendingShot.attacker, 'Gol: no hubo Parada Arquero.');
      return;
    }

    if (pendingShot?.phase === 'remate') {
      const defender = getOpponent(pendingShot.attacker);
      clearTransientState();
      setPossession(defender);
      setCurrentTurn(defender);
      addLog('La jugada termino tras la parada del arquero.');
      return;
    }

    if (pendingDefense?.defenseCardId === 'pre_shot') {
      setPendingDefense(null);
      setCurrentTurn(pendingDefense.possessor);
      setHasActedThisTurn(false);
      addLog('No hubo contra carta. Ahora se permite tirar a gol.');
      return;
    }

    if (pendingDefense?.defenseCardId === 'tr_var') {
      setPendingDefense(null);
      setCurrentTurn(pendingDefense.possessor);
      setHasActedThisTurn(true);
      addLog('La Roja se mantiene. No se uso VAR.');
      return;
    }

    if (pendingDefense && pendingDefense.defenseCardId !== 'tr_var') {
      const defender = pendingDefense.defender;
      clearTransientState();
      setPossession(defender);
      setCurrentTurn(defender);
      addLog('La contracarta se resolvio sin respuesta. El balon cambia de posesion.');
      return;
    }

    const actor = currentTurn;
    const currentHand = getHand(actor);
    const neededCards = 5 - currentHand.length;

    if (neededCards > 0) {
      const newDeck = [...deck];
      const drawnCards = newDeck.splice(0, neededCards);

      if (actor === 'player') {
        setPlayerHand([...currentHand, ...drawnCards]);
      } else {
        setOpponentHand([...currentHand, ...drawnCards]);
      }

      setDeck(newDeck);
    }

    const keepsTurn = bonusTurnFor === actor;
    const nextActor = keepsTurn ? actor : getOpponent(actor);

    if (keepsTurn) {
      setBonusTurnFor(null);
    }

    if (pendingForcedDiscards[nextActor] > 0) {
      setPendingForcedDiscards((previous) => ({
        ...previous,
        [nextActor]: Math.max(0, previous[nextActor] - 1)
      }));
      openBlindDiscard(
        nextActor,
        `Tarjeta Roja: ${nextActor === 'player' ? 'Jugador' : 'Rival'} debe elegir una posicion de su mano para descartar una carta oculta.`,
        nextActor
      );
      return;
    }

    setCurrentTurn(nextActor);
    setHasActedThisTurn(keepsTurn);
    setSelectedForDiscard([]);
    setDiscardMode(false);
    addLog(`Cambio de turno. Balon: ${possession === 'player' ? 'Jugador' : 'Rival'}.`);
  };

  const handleDiscard = () => {
    if (!canUseDiscard) {
      if (hasReactionWindow) {
        addLog('No puedes descartar mientras se resuelve una contra carta o respuesta.');
      }
      return;
    }

    if (!discardMode) {
      setDiscardMode(true);
      setSelectedForDiscard([]);
      addLog(`Modo descarte: selecciona 2 cartas del ${currentTurn === 'player' ? 'Jugador' : 'Rival'}.`);
      return;
    }

    if (selectedForDiscard.length !== 2) {
      addLog('Debes seleccionar exactamente 2 cartas para descartar.');
      return;
    }

    const actor = currentTurn;
    const hand = [...getHand(actor)];
    const cardsToDiscard = hand.filter((_, idx) => selectedForDiscard.includes(idx));
    const newHand = hand.filter((_, idx) => !selectedForDiscard.includes(idx));
    const newDeck = [...deck];
    const drawnCards = newDeck.splice(0, 2);

    setDiscardPile((previousPile) => [...cardsToDiscard, ...previousPile]);

    if (actor === 'player') {
      setPlayerHand([...newHand, ...drawnCards]);
    } else {
      setOpponentHand([...newHand, ...drawnCards]);
    }

    setDeck(newDeck);
    setCurrentTurn(getOpponent(actor));
    setHasActedThisTurn(false);
    setSelectedForDiscard([]);
    setDiscardMode(false);
    addLog(`${actor === 'player' ? 'Jugador' : 'Rival'} descarto 2 cartas.`);
  };

  const toggleDiscardSelection = (event, index) => {
    event?.stopPropagation();

    if (hasActedThisTurn || !discardMode) {
      return;
    }

    if (selectedForDiscard.includes(index)) {
      setSelectedForDiscard((previous) => previous.filter((selectedIndex) => selectedIndex !== index));
      return;
    }

    if (selectedForDiscard.length < 2) {
      setSelectedForDiscard((previous) => [...previous, index]);
    }
  };

  const playCard = (card, index, isFromPlayer) => {
    const actor = isFromPlayer ? 'player' : 'opponent';

    if (pendingBlindDiscard) {
      if (actor !== pendingBlindDiscard.actor) {
        addLog('Debe resolverse primero el descarte oculto.');
        return;
      }

      resolveBlindDiscard(actor, index);
      return;
    }

    if (currentTurn !== actor || selectedForDiscard.length > 0) {
      return;
    }

    if (pendingCombo?.type === 'sb_followup') {
      if (actor !== pendingCombo.actor) {
        addLog('Debe resolverse primero la combinacion de Saque de Banda + Pase Corto.');
        return;
      }

        if (card.id !== 'pc') {
          addLog('Despues de Saque de Banda debes jugar obligatoriamente un Pase Corto.');
          return;
        }
    }

    if (pendingCombo?.type === 'cont_followup') {
      if (actor !== pendingCombo.actor) {
        addLog('Debe resolverse primero la combinacion de Contraataque + pase.');
        return;
      }

      if (card.type !== 'pass') {
        addLog('Despues de Contraataque debes jugar obligatoriamente un pase.');
        return;
      }
    }

    if (pendingDefense?.defenseCardId === 'pre_shot') {
        if (actor !== pendingDefense.defender || !PRE_SHOT_DEFENSE_CARD_IDS.includes(card.id)) {
        addLog('Antes del tiro, el defensor solo puede responder con una contracarta valida.');
        return;
      }

      if (card.id === 'cont' && (!getHand(actor).some((handCard) => handCard.type === 'pass') || !hasCardInHand(actor, 'tg'))) {
        addLog('Contraataque solo puede usarse si tienes en mano un pase y una carta de Tirar a Gol.');
        return;
      }

      if (card.id === 'sc' && !hasCardInHand(actor, 'pa')) {
        addLog('Saque de corner solo puede activarse si tienes Pase Aereo en mano.');
        return;
      }

        consumeCardAndRefillOne(actor, index, card);
        setHasActedThisTurn(true);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        startDefenseResolution(actor, card);
        return;
    }

    if (pendingDefense?.defenseCardId === 'tr_var') {
      if (actor !== pendingDefense.defender || card.id !== 'var') {
        addLog('Solo puedes responder con VAR para anular la Roja.');
        return;
      }

        consumeCardAndRefillOne(actor, index, card);
        clearTransientState();
        setPossession(actor);
        setCurrentTurn(actor);
        addLog('VAR anula la Tarjeta Roja. La Falta Agresiva se mantiene.');
        return;
    }

    if (pendingDefense) {
      if (actor !== pendingDefense.possessor) {
        addLog('La respuesta a la contracarta debe jugarla quien tiene el balon.');
        return;
      }

      if (pendingDefense.defenseCardId === 'ba' && card.id !== 'reg') {
        addLog('La Barrida solo puede responderse con Regatear.');
        return;
      }

      if (pendingDefense.defenseCardId === 'fa' && !['ta', 'tr'].includes(card.id)) {
        addLog('La Falta Agresiva solo puede responderse con Amarilla o Roja.');
        return;
      }

      consumeCardAndRefillOne(actor, index, card);

      if (pendingDefense.defenseCardId === 'fa' && card.id === 'tr' && hasCardInHand(pendingDefense.defender, 'var')) {
        setPendingDefense({ ...pendingDefense, defenseCardId: 'tr_var' });
        setCurrentTurn(pendingDefense.defender);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Tarjeta Roja jugada. El rival puede usar VAR para anularla.');
        return;
      }

      if (card.id === 'reg') {
        const defendingActor = pendingDefense.defender;
        setPendingDefense(null);
        setCurrentTurn(defendingActor);
        setHasActedThisTurn(true);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Regate exitoso. La jugada continua.');
        return;
      }

      setPendingDefense(null);
      setCurrentTurn(actor);
      setHasActedThisTurn(true);
      setDiscardMode(false);
      setSelectedForDiscard([]);

      setBonusTurnFor(actor);

      if (card.id === 'ta') {
        addLog('Tarjeta Amarilla: mantienes la posesion y robas un turno.');
        return;
      }

      openBlindDiscard(
        pendingDefense.defender,
        'Tarjeta Roja: el rival debe elegir una posicion de su mano para descartar una carta oculta.',
        actor
      );
      setPendingForcedDiscards((previous) => ({
        ...previous,
        [pendingDefense.defender]: previous[pendingDefense.defender] + 1
      }));
      addLog('Tarjeta Roja: mantienes la posesion, robas un turno y el rival descartara otra carta en su siguiente turno.');
      return;
    }

    if (pendingShot?.phase === 'penalty_response') {
      if (actor !== pendingShot.defender || !['var', 'paq'].includes(card.id)) {
        addLog('Solo puedes responder al Penalti con VAR o Parada Arquero.');
        return;
      }

        consumeCardAndRefillOne(actor, index, card);

        if (card.id === 'paq') {
        if (!hasCardInHand(pendingShot.attacker, 'rem')) {
          clearTransientState();
          setPossession(actor);
          setCurrentTurn(actor);
          addLog('Parada del arquero al penalti. No hay Remate disponible.');
          return;
        }

        setPendingShot({ ...pendingShot, phase: 'remate' });
        setCurrentTurn(pendingShot.attacker);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Parada del arquero al penalti. El atacante puede usar Remate.');
        return;
      }

      clearTransientState();
      setPossession(actor);
      setCurrentTurn(actor);
      addLog('VAR anula el Penalti.');
      return;
    }

    if (pendingShot?.phase === 'save') {
      if (actor !== pendingShot.defender || card.id !== 'paq') {
        addLog('Solo puedes responder al tiro con Parada Arquero.');
        return;
      }

        consumeCardAndRefillOne(actor, index, card);

        if (!hasCardInHand(pendingShot.attacker, 'rem')) {
        clearTransientState();
        setPossession(actor);
        setCurrentTurn(actor);
        addLog('Parada del arquero. No hay Remate disponible.');
        return;
      }

      setPendingShot({ ...pendingShot, phase: 'remate' });
      setCurrentTurn(pendingShot.attacker);
      setHasActedThisTurn(false);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog('Parada del arquero. El atacante puede usar Remate.');
      return;
    }

    if (pendingShot?.phase === 'remate') {
      if (actor !== pendingShot.attacker || card.id !== 'rem') {
        addLog('Tras la parada solo puedes jugar Remate.');
        return;
      }

        consumeCardAndRefillOne(actor, index, card);
        setHasActedThisTurn(true);
        startShotResolution(actor, 'remate');
        return;
    }

    const isPossessor = possession === actor;

    if (!isPossessor) {
      if (card.id === 'sb' && !hasCardInHand(actor, 'pc')) {
        addLog('Saque de banda solo puede usarse si tienes Pase Corto en mano.');
        return;
      }

      if (card.id === 'cont' && (!getHand(actor).some((handCard) => handCard.type === 'pass') || !hasCardInHand(actor, 'tg'))) {
        addLog('Contraataque solo puede usarse si tienes en mano un pase y una carta de Tirar a Gol.');
        return;
      }

      if (card.id === 'sc' && !hasCardInHand(actor, 'pa')) {
        addLog('Saque de corner solo puede activarse si tienes Pase Aereo en mano.');
        return;
      }

      const canStealBall =
        ['ba', 'fa', 'sb', 'cont'].includes(card.id) ||
        (card.id === 'sc' && hasCardInHand(actor, 'pa'));

      if (!canStealBall) {
        addLog('No tienes el balon. Debes iniciar intentando recuperarlo con una contracarta valida.');
        return;
      }

      if (card.id === 'sb' && !hasCardInHand(actor, 'pc')) {
        addLog('Saque de banda solo puede activarse si puedes combinarlo con Pase Corto.');
        return;
      }

      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      startDefenseResolution(actor, card);
      return;
    }

    if (card.type === 'pass') {
      const nextPassTotal = currentPassTotal + card.value;

      if (nextPassTotal > 4) {
        addLog('No puedes superar 4 puntos de pase en una jugada.');
        return;
      }

      consumeCard(actor, index, card);
      setActivePlay((previousPlay) => [...previousPlay, card]);
      if (pendingCombo?.type === 'sb_followup') {
        setPendingCombo(null);
      }
      if (pendingCombo?.type === 'cont_followup') {
        setPendingCombo(null);
        setCounterAttackReady(true);
      }
      setHasActedThisTurn(true);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog(`Pase: +${card.value} (Total: ${nextPassTotal})`);

        if (nextPassTotal === 4 && !counterAttackReady) {
          const defender = getOpponent(actor);

          if (canUsePreShotDefense(defender)) {
            setPendingDefense({ defender, possessor: actor, defenseCardId: 'pre_shot' });
            setCurrentTurn(defender);
            setHasActedThisTurn(false);
            addLog('Jugada de 4 pases completada. El rival puede usar una contracarta antes del tiro.');
          } else {
            addLog('Jugada de 4 pases completada. No hay contracarta disponible; puedes tirar a gol.');
          }
        }

      return;
    }

    if (card.id === 'tg') {
      const canShootFromSpecial = counterAttackReady;

      if (pendingCombo?.type === 'cont_followup') {
        addLog('Antes de tirar a gol debes jugar el pase obligatorio del Contraataque.');
        return;
      }

      if (!canShootFromSpecial && currentPassTotal < 4) {
        addLog('Necesitas 4 puntos de pases para tirar.');
        return;
      }

      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      startShotResolution(actor, 'regular');
      return;
    }

    if (card.id === 'pe') {
      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      startShotResolution(actor, 'penalty');
      return;
    }

    if (card.id === 'ch') {
      const lastPass = activePlay[activePlay.length - 1];

      if (!lastPass || !String(lastPass.id).startsWith('pa')) {
        addLog('La Chilena solo puede jugarse despues de un Pase Aereo.');
        return;
      }

      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      startShotResolution(actor, 'chilena');
      return;
    }

    if (card.id === 'reg') {
      addLog('Regatear solo se usa como respuesta a Barrida.');
      return;
    }

    if (card.id === 'ta' || card.id === 'tr') {
      addLog('Las tarjetas solo se usan como respuesta a Falta Agresiva.');
      return;
    }

    if (card.id === 'rem') {
      addLog('Remate solo se usa despues de una Parada del arquero.');
      return;
    }

    addLog('No puedes usar esa carta ahora.');
  };

  return (
      <div className="flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <style>{`
          @keyframes fieldBallBounce {
            0%, 100% { transform: translate(-50%, 0); }
            50% { transform: translate(-50%, -12px); }
          }

          @keyframes goalPulse {
            0% { opacity: 0; transform: scale(0.82); }
            20% { opacity: 1; transform: scale(1.06); }
            60% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(1.14); }
          }

          @keyframes goalBallBurst {
            0%, 100% { transform: scale(1) rotate(0deg); }
            50% { transform: scale(1.22) rotate(10deg); }
          }
        `}</style>
        <div className="z-20 border-b-2 border-emerald-500 bg-slate-900 p-2 shadow-2xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4">
          <div className={`flex items-center gap-4 rounded-2xl p-3 transition-all ${possession === 'player' ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'grayscale opacity-30'}`}>
            <div className="text-center">
              <span className="block text-[10px] font-black text-blue-400">JUGADOR</span>
              <span className="text-3xl font-black">{playerScore}</span>
            </div>
            {possession === 'player' && <SoccerBallIcon size={20} className="animate-bounce" />}
          </div>

          <div className="flex flex-col items-center">
            <div className="mb-1 flex gap-1.5">
              {[1, 2, 3, 4].map((point) => (
                <div
                  key={point}
                  className={`h-2 w-4 rounded-full transition-all duration-500 ${
                    currentPassTotal >= point ? 'bg-yellow-400 shadow-[0_0_10px_#facc15]' : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500">
              Puntos jugada: {currentPassTotal} / 4
            </span>
          </div>

          <div className={`flex items-center gap-4 rounded-2xl p-3 transition-all ${possession === 'opponent' ? 'bg-red-600/30 ring-2 ring-red-500' : 'grayscale opacity-30'}`}>
            {possession === 'opponent' && <SoccerBallIcon size={20} className="animate-bounce" />}
            <div className="text-center">
              <span className="block text-[10px] font-black text-red-400">RIVAL</span>
              <span className="text-3xl font-black">{opponentScore}</span>
            </div>
          </div>
        </div>
      </div>

        <div className="relative flex flex-1 flex-col items-center justify-between border-x-[16px] border-emerald-800 bg-emerald-900 p-4 shadow-inner">
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center opacity-10">
            <div className="h-px w-full bg-white" />
            <div className="h-48 w-48 rounded-full border-4 border-white" />
          </div>

          <div
            className="pointer-events-none absolute left-[12%] z-10 transition-all duration-700 ease-in-out"
            style={{
              top: possession === 'player' ? '74%' : possession === 'opponent' ? '30%' : '52%',
              animation: possession ? 'fieldBallBounce 1.4s ease-in-out infinite' : 'none'
            }}
          >
            <div className="rounded-full bg-white/10 p-3 shadow-[0_0_30px_rgba(255,255,255,0.15)] backdrop-blur-sm">
              <SoccerBallIcon size={28} className="text-white/80" />
            </div>
          </div>

        <div className="w-full max-w-2xl opacity-80">
          <div className="mb-2 text-center text-[10px] font-black uppercase tracking-[0.25em] text-white/60">
            Rival {DEV_SHOW_OPPONENT_HAND ? '(debug visible)' : ''}
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-4">
              {canUseDiscard && isOpponentTurn && (
              <button
                onClick={handleDiscard}
                className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-[10px] font-black transition-all ${
                  discardMode
                    ? selectedForDiscard.length === 2
                      ? 'scale-105 bg-orange-600 shadow-lg'
                      : 'bg-slate-700'
                    : 'bg-orange-700 shadow-lg hover:bg-orange-600'
                }`}
              >
                <RefreshCcw size={14} /> {discardMode ? `CONFIRMAR DESCARTE (${selectedForDiscard.length}/2)` : 'DESCARTAR 2 DEL RIVAL'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {opponentHand.map((card, index) =>
              DEV_SHOW_OPPONENT_HAND ? (
                <CardItem
                  key={`${card.id}-${index}`}
                  card={card}
                  isSelected={selectedForDiscard.includes(index)}
                  onSelect={(event) => toggleDiscardSelection(event, index)}
                  onClick={() => playCard(card, index, false)}
                  disabled={!isOpponentTurn}
                    canSelectDiscard={canUseDiscard}
                  isDiscardMode={discardMode}
                  hideContent={pendingBlindDiscard?.actor === 'opponent'}
                />
              ) : (
                <div
                  key={index}
                  className="flex h-24 w-16 items-center justify-center rounded-lg border-2 border-white/10 bg-slate-800"
                >
                  <div className="h-8 w-8 rounded-full bg-white/5" />
                </div>
              )
            )}
          </div>
        </div>

        <div className="z-10 flex w-full max-w-4xl items-center justify-between px-4">
          <div className="flex flex-col items-center gap-2">
            <div className="relative flex h-28 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-900/80 text-white/20">
              <History size={24} />
              {discardPile.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl border-2 border-white/40 bg-slate-800 shadow-xl">
                  <span className="text-center text-[8px] font-black uppercase text-white/70">
                    {discardPile.length}
                  </span>
                </div>
              )}
            </div>
            <span className="text-[9px] font-black uppercase text-white/40">Descartes</span>
          </div>

          <div className="flex flex-1 justify-center gap-2 overflow-x-auto py-4">
            {activePlay.length === 0 ? (
              <div className="rounded-full border-2 border-dashed border-white/10 bg-black/20 px-10 py-5">
                <span className="text-sm font-black uppercase text-white/20">Empieza la jugada</span>
              </div>
            ) : (
              activePlay.map((card, index) => (
                <div
                  key={`${card.id}-${index}`}
                  className={`${card.color} flex h-24 min-w-[70px] flex-col justify-between rounded-lg border-2 border-white/40 p-2 shadow-lg`}
                >
                  <p className="text-[7px] font-black uppercase leading-none">{card.name}</p>
                  <p className="text-center text-xl font-black">+{card.value}</p>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex h-28 w-20 flex-col items-center justify-center rounded-xl border-2 border-white/20 bg-slate-800 shadow-2xl">
              <Library className="mb-1 text-white/20" size={24} />
              <span className="text-xl font-black">{deck.length}</span>
            </div>
            <span className="text-[9px] font-black uppercase text-white/40">Mazo</span>
          </div>
        </div>

          <div className="rounded-full border border-white/10 bg-black/60 px-6 py-2 text-[11px] font-bold text-emerald-400 backdrop-blur-sm">
            {gameLog[0]}
          </div>

            {reactionBannerMessage && (
              <div className="mt-3 rounded-full border border-yellow-300/40 bg-yellow-500/15 px-5 py-2 text-center text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200 shadow-[0_0_20px_rgba(250,204,21,0.18)]">
                {reactionBannerMessage}
              </div>
            )}

          <div className="w-full max-w-2xl pb-2">
          <div className="mb-3 text-center text-[11px] font-black uppercase tracking-[0.3em] text-white/70">
            Turno actual: {currentTurnLabel}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-center gap-4">
              {canUseDiscard && isPlayerTurn && (
              <button
                onClick={handleDiscard}
                className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-[10px] font-black transition-all ${
                  discardMode
                    ? selectedForDiscard.length === 2
                      ? 'scale-105 bg-orange-600 shadow-lg'
                      : 'bg-slate-700'
                    : 'bg-orange-700 shadow-lg hover:bg-orange-600'
                }`}
              >
                <RefreshCcw size={14} /> {discardMode ? `CONFIRMAR DESCARTE (${selectedForDiscard.length}/2)` : 'DESCARTAR 2'}
              </button>
            )}

            <button
              onClick={endTurn}
              className="flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-2.5 text-[10px] font-black shadow-xl hover:bg-emerald-400"
            >
              <ArrowRightCircle size={14} /> FINALIZAR TURNO
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            {playerHand.map((card, index) => (
              <CardItem
                key={`${card.id}-${index}`}
                card={card}
                isSelected={selectedForDiscard.includes(index)}
                onSelect={(event) => toggleDiscardSelection(event, index)}
                onClick={() => playCard(card, index, true)}
                disabled={!isPlayerTurn}
                  canSelectDiscard={canUseDiscard}
                isDiscardMode={discardMode}
                hideContent={pendingBlindDiscard?.actor === 'player'}
              />
            ))}
          </div>

          {gameState === 'coin-flip' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <div className="text-center">
                <Coins size={64} className="mx-auto mb-6 animate-spin text-yellow-500" />
                <h2 className="mb-8 text-3xl font-black">SORTEO DE SAQUE</h2>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleCoinFlip('Cara')}
                    className="rounded-2xl bg-white px-10 py-4 font-black text-black transition-all hover:bg-emerald-400"
                  >
                    CARA
                  </button>
                  <button
                    onClick={() => handleCoinFlip('Sello')}
                    className="rounded-2xl bg-white px-10 py-4 font-black text-black transition-all hover:bg-emerald-400"
                  >
                    SELLO
                  </button>
                </div>
              </div>
            </div>
          )}

            {gameState === 'dealing' && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
                <button
                  onClick={handleDeal}
                  className="animate-pulse rounded-2xl bg-emerald-500 px-12 py-6 text-xl font-black"
              >
                EMPEZAR PARTIDO
                </button>
              </div>
            )}

            {goalCelebration && (
              <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
                <div
                  className={`rounded-[2rem] border px-10 py-8 text-center shadow-[0_0_60px_rgba(255,255,255,0.12)] ${
                    goalCelebration.scorer === 'player'
                      ? 'border-blue-300/50 bg-blue-500/20 text-blue-100'
                      : 'border-red-300/50 bg-red-500/20 text-red-100'
                  }`}
                  style={{ animation: 'goalPulse 1.8s ease-out forwards' }}
                >
                  <div
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/15"
                    style={{ animation: 'goalBallBurst 0.8s ease-in-out infinite' }}
                  >
                    <SoccerBallIcon size={30} className="text-white" />
                  </div>
                  <div className="text-3xl font-black uppercase tracking-[0.28em]">{goalCelebration.text}</div>
                </div>
              </div>
            )}

            {gameState === 'finished' && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 p-6">
                <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-900/95 p-8 text-center shadow-2xl">
                  <div className="mb-4 text-sm font-black uppercase tracking-[0.35em] text-emerald-300">Fin del Partido</div>
                  <div className="mb-3 text-3xl font-black text-white">
                    {matchWinner === 'player' ? 'Gana Jugador' : 'Gana Rival'}
                  </div>
                  <div className="mb-8 text-lg font-bold text-white/70">
                    Marcador final {playerScore} - {opponentScore}
                  </div>
                  <button
                    onClick={resetMatch}
                    className="rounded-2xl bg-emerald-500 px-8 py-4 text-sm font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-emerald-400"
                  >
                    Jugar de Nuevo
                  </button>
                </div>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
