import React, { useEffect, useState } from 'react';
import {
  ArrowRightCircle,
  Bot,
  BookOpen,
  Coins,
  Library,
  PlayCircle,
  RefreshCcw,
  Shield,
  Trash2,
  UserRound,
} from 'lucide-react';
import yellowCardImage from '../imagenes/Tarjeta amarilla.png';
import redCardImage from '../imagenes/Tarjeta roja.png';

const CARD_IMAGE_MODULES = import.meta.glob('../imagenes/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
});

const normalizeAssetName = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '')
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
const YELLOW_CARD_IMAGE = yellowCardImage;
const RED_CARD_IMAGE = redCardImage;
const BALL_IMAGE = CARD_IMAGE_BY_NAME.balon ?? null;

const DECK_DEFINITION = [
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
  { id: 'off', name: 'Offside', value: 0, type: 'save', color: 'bg-amber-600', count: 4, detail: 'Anula Tiro a Gol' },
  { id: 'paq', name: 'Parada Arquero', value: 0, type: 'save', color: 'bg-stone-500', count: 6, detail: 'Evita un gol' },
  { id: 'rem', name: 'Remate', value: 0, type: 'special', color: 'bg-pink-600', count: 4, detail: 'Tras Parada Arquero' },
  { id: 'sb', name: 'Saque Banda', value: 0, type: 'defense', color: 'bg-lime-600', count: 4, detail: 'Recupera + Pase Corto' },
  { id: 'sc', name: 'Saque Corner', value: 0, type: 'defense', color: 'bg-sky-700', count: 4, detail: 'Recupera + Pase Aereo' },
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
    'offside': ['offside'],
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
  sb: { id: 'pc_auto', name: 'Pase Corto', value: 1, color: 'bg-emerald-500' }
};
const PRE_SHOT_DEFENSE_CARD_IDS = ['ba', 'fa', 'sb', 'sc', 'cont'];

const getRandomIndex = (maxExclusive) => {
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

const shuffleCards = (cards) => {
  const shuffled = [...cards];

  for (let currentIndex = shuffled.length - 1; currentIndex > 0; currentIndex -= 1) {
    const randomIndex = getRandomIndex(currentIndex + 1);
    [shuffled[currentIndex], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[currentIndex]];
  }

  return shuffled;
};

const initDeck = () => {
  const fullDeck = DECK_DEFINITION.flatMap((card) =>
    Array.from({ length: card.count }, (_, instanceIndex) => ({
      ...card,
      instanceId: `${card.id}-${instanceIndex}-${getRandomIndex(1_000_000)}`
    }))
  );

  return shuffleCards(fullDeck);
};

const TUTORIAL_SEQUENCES = [
  {
    title: 'Jugada basica',
    note: 'Construye pases hasta llegar al tiro.',
    steps: ['Pase Corto', 'Pase Largo', 'Pase Aereo', 'Tirar a Gol']
  },
  {
    title: 'Combinacion Chilena',
    note: 'La Chilena abre una secuencia especial y el arquero no puede detener ese gol.',
    steps: ['Chilena', 'Pase Aereo', 'Tirar a Gol']
  },
  {
    title: 'Contraataque',
    note: 'Recuperas y cierras rapido la jugada.',
    steps: ['Contraataque', 'Pase', 'Tirar a Gol']
  },
  {
    title: 'Saque de Banda',
    note: 'Recupera la posesion y suma un pase.',
    steps: ['Saque Banda', 'Pase Corto']
  },
  {
    title: 'Saque de Corner',
    note: 'Reinicia la jugada con secuencia ofensiva.',
    steps: ['Saque Corner', 'Pase Aereo', 'Tirar a Gol']
  },
  {
    title: 'Barrida',
    note: 'Roba el balon, pero puede ser evitada.',
    layout: 'versus',
    left: {
      title: 'Barrida',
      text: 'Roba el balon con una barrida.',
      card: 'Barrida'
    },
    right: {
      title: 'Regatear',
      text: 'Una barrida puede ser evadida con un regate.',
      card: 'Regatear'
    }
  },
  {
    title: 'Penalti',
    note: 'Con posesion del balon se puede jugar un penalti.',
    layout: 'penalty',
    center: {
      title: 'Penalti',
      text: 'Con posesion del balon se puede jugar un penalti.',
      card: 'Penalti'
    },
    left: {
      title: 'VAR',
      text: 'El penalti puede ser anulado con la carta de VAR.',
      card: 'VAR'
    },
    right: {
      title: 'Parada Arquero',
      text: 'O puede ser parado por el arquero.',
      card: 'Parada Arquero'
    }
  },
  {
    title: 'Falta Agresiva',
    note: 'No puede ser evadida con regate y puede escalar a Roja.',
    layout: 'foul',
    center: {
      title: 'Falta Agresiva',
      text: 'No puede ser evadida con Regatear.',
      card: 'Falta Agresiva'
    },
    left: {
      title: 'Tarjeta Roja',
      text: 'Si responden con Roja, aplica sancion y descarte.',
      card: 'Tarj. Roja'
    },
    right: {
      title: 'VAR',
      text: 'La Tarjeta Roja puede ser anulada con VAR.',
      card: 'VAR'
    }
  },
  {
    title: 'Tarjetas',
    note: 'Las tarjetas cambian el ritmo de la jugada y la sancion.',
    layout: 'versus',
    left: {
      title: 'Tarjeta Amarilla',
      text: 'La Amarilla concede un turno extra al rival en la jugada.',
      card: 'Tarj. Amarilla'
    },
    right: {
      title: 'Tarjeta Roja',
      text: 'La Roja obliga descarte y deja al rival con menos mano por varios turnos.',
      card: 'Tarj. Roja'
    }
  },
  {
    title: 'Offside',
    note: 'Anula un Tiro a Gol por posicion adelantada.',
    layout: 'foul',
    center: {
      title: 'Offside',
      text: 'Se juega cuando el rival hace un Tiro a Gol.',
      card: 'Offside'
    },
    left: {
      title: 'VAR',
      text: 'El atacante puede usar VAR para anular el Offside.',
      card: 'VAR'
    },
    right: {
      title: 'Parada Arquero',
      text: 'Si se anula el Offside, aun puede quedar la Parada Arquero.',
      card: 'Parada Arquero'
    }
  }
];

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

const getOppositeCoinFace = (face) => (face === 'Cara' ? 'Sello' : 'Cara');

const CoinFace = ({ face, mirrored = false }) => {
  const isCara = face === 'Cara';
  const FaceIcon = isCara ? UserRound : Shield;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full"
      style={{
        backfaceVisibility: 'hidden',
        transform: mirrored ? 'rotateY(180deg)' : 'rotateY(0deg)'
      }}
    >
      <div className="absolute inset-[7px] rounded-full border border-white/50 bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.98)_0%,rgba(225,231,239,0.94)_30%,rgba(154,165,178,0.95)_62%,rgba(77,88,100,1)_100%)]" />
      <div className="absolute inset-[15px] rounded-full border border-white/35 bg-[radial-gradient(circle_at_28%_26%,rgba(255,255,255,0.82)_0%,rgba(214,221,231,0.4)_22%,rgba(82,92,106,0.14)_72%,rgba(255,255,255,0.05)_100%)]" />
      <div className="relative flex h-[74px] w-[74px] items-center justify-center rounded-full border border-slate-900/12 bg-slate-700/10 shadow-[inset_0_10px_18px_rgba(255,255,255,0.2),inset_0_-14px_24px_rgba(55,65,81,0.24)]">
        <div className="absolute h-[54px] w-[54px] rounded-full border border-slate-900/10 bg-white/10 shadow-[inset_0_4px_10px_rgba(255,255,255,0.22)]" />
        <FaceIcon className="relative h-8 w-8 text-slate-800/85" strokeWidth={2.2} />
      </div>
      <div className="absolute bottom-[21px] text-[8px] font-black uppercase tracking-[0.26em] text-slate-800/75">
        {face}
      </div>
      <div className="pointer-events-none absolute inset-[4px] rounded-full border border-white/18" />
    </div>
  );
};

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

const DiscardLane = ({ title, pile }) => {
  const archivedCards = pile.archive.slice(0, 4).reverse();
  const currentCards = pile.current;

  return (
    <div className="w-full max-w-[280px] rounded-2xl border border-white/10 bg-slate-950/35 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/45">{title}</span>
        <span className="rounded-full border border-white/10 bg-slate-950/80 px-2 py-0.5 text-[9px] font-black text-white/70">
          {pile.archive.length + pile.current.length}
        </span>
      </div>
      <div className="relative min-h-[112px]">
        {archivedCards.length > 0 ? (
          <div className="absolute bottom-0 left-0 h-24 w-20">
            {archivedCards.map((card, index) => (
              <div
                key={`archived-${card.visualId}`}
                className="absolute left-0 top-0 h-24 w-16 overflow-hidden rounded-[14px] border border-white/10 shadow-[0_10px_22px_rgba(0,0,0,0.28)]"
                style={{
                  transform: `translateX(${index * 5}px) translateY(${index * 4}px) rotate(${(index - 1.5) * 2}deg)`,
                  zIndex: index + 1
                }}
              >
                {card.imageUrl ? (
                  <>
                    <img
                      src={card.imageUrl}
                      alt={card.name}
                      className="absolute inset-0 h-full w-full object-cover object-center"
                    />
                    <div className="absolute inset-0 bg-black/18" />
                  </>
                ) : (
                  <div className={`${card.color || 'bg-slate-800'} flex h-full w-full items-end justify-center px-2 pb-2 text-center text-[8px] font-black uppercase leading-tight text-white`}>
                    {card.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {currentCards.length > 0 ? (
          <div className="relative ml-20 flex min-h-[112px] flex-wrap items-end gap-2">
            {currentCards.map((card, index) => (
              <div
                key={card.visualId}
                className="relative h-24 w-16 overflow-hidden rounded-[14px] border border-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.32)]"
                style={{
                  animation: 'discardCardSlideIn 320ms cubic-bezier(0.22,0.8,0.2,1) both',
                  animationDelay: `${index * 60}ms`
                }}
              >
                {card.imageUrl ? (
                  <>
                    <img
                      src={card.imageUrl}
                      alt={card.name}
                      className="absolute inset-0 h-full w-full object-cover object-center"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/14 via-transparent to-black/22" />
                  </>
                ) : (
                  <div className={`${card.color || 'bg-slate-800'} flex h-full w-full items-end justify-center px-2 pb-2 text-center text-[8px] font-black uppercase leading-tight text-white`}>
                    {card.name}
                  </div>
                )}
                <div className="absolute inset-[3px] rounded-[11px] border border-white/12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="ml-20 flex min-h-[112px] items-center text-[9px] font-black uppercase tracking-[0.18em] text-white/28">
            Sin cartas en esta jugada
          </div>
        )}
      </div>
    </div>
  );
};

const TutorialStepCard = ({ label }) => {
  const normalizedLabel = normalizeAssetName(label);
  const tutorialAliases = {
    'pase': 'Pase Corto',
    'tarjeta amarilla': 'Tarj. Amarilla',
    'tarjeta roja': 'Tarj. Roja',
    'parada arquero o var': 'VAR',
    'gol o remate': 'Remate',
    'recupera posesion': 'Barrida',
    'sigue la jugada': 'Regatear',
    'descarta y sancion': 'Tarj. Roja',
    'tarjeta roja o penalti': 'VAR',
    'jugada anulada': 'VAR'
  };
  const mappedLabel = tutorialAliases[normalizedLabel] ?? label;
  const mappedNormalizedLabel = normalizeAssetName(mappedLabel);
  const tutorialCardOverrides = {
    [normalizeAssetName('Tarj. Amarilla')]: {
      name: 'Tarj. Amarilla',
      color: 'bg-yellow-400',
      imageUrl: YELLOW_CARD_IMAGE
    },
    [normalizeAssetName('Tarj. Roja')]: {
      name: 'Tarj. Roja',
      color: 'bg-red-500',
      imageUrl: RED_CARD_IMAGE
    }
  };
  const cardById = tutorialCardOverrides[mappedNormalizedLabel] ?? null;
  const card =
    cardById ??
    DECK_DEFINITION.find((entry) => normalizeAssetName(entry.name) === mappedNormalizedLabel) ??
    DECK_DEFINITION.find((entry) => entry.type === 'pass' && mappedNormalizedLabel === 'pase corto');

  return (
    <div className="flex w-[96px] flex-col items-center gap-2">
      <div
        className={`relative flex h-28 w-[84px] items-end justify-center overflow-hidden rounded-[18px] border border-white/10 shadow-[0_14px_30px_rgba(0,0,0,0.35)] ${
          card?.imageUrl ? 'bg-slate-900' : card?.color ?? 'bg-slate-800'
        }`}
      >
        {card?.imageUrl ? (
          <>
            <img
              src={card.imageUrl}
              alt={label}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/18 via-transparent to-black/30" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] font-black uppercase leading-tight text-white/85">
            {label}
          </div>
        )}
        <div className="absolute inset-[3px] rounded-[15px] border border-white/12" />
      </div>
      <div className="text-center text-[10px] font-black uppercase leading-tight text-white/80">
        {label}
      </div>
    </div>
  );
};

export default function App() {
  const [gameState, setGameState] = useState('menu');
  const [tutorialPage, setTutorialPage] = useState(0);
  const [coinFlipState, setCoinFlipState] = useState({
    choice: null,
    result: null,
    winner: null,
    isFlipping: false
  });
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [sanctions, setSanctions] = useState({ player: null, opponent: null });
  const [deck, setDeck] = useState([]);
  const [discardPile, setDiscardPile] = useState([]);
  const [discardShowcase, setDiscardShowcase] = useState({
    player: { current: [], archive: [] },
    opponent: { current: [], archive: [] }
  });
  const [discardShowcasePendingArchive, setDiscardShowcasePendingArchive] = useState(false);
  const [laneNotices, setLaneNotices] = useState({ player: '', opponent: '' });
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
  const [redCardPenalty, setRedCardPenalty] = useState({ player: 0, opponent: 0 });
  const [pendingBlindDiscard, setPendingBlindDiscard] = useState(null);
  const [gameLog, setGameLog] = useState(['Posesion persistente activada']);
  const [goalCelebration, setGoalCelebration] = useState(null);
  const [matchWinner, setMatchWinner] = useState(null);
  const [aiMode, setAiMode] = useState(false);
  const [aiStatus, setAiStatus] = useState('');

  const isPlayerTurn = currentTurn === 'player';
  const isOpponentTurn = currentTurn === 'opponent';
  const currentTurnLabel = isPlayerTurn ? 'Jugador' : isOpponentTurn ? 'Rival' : 'Nadie';
  const currentPassTotal = activePlay.reduce((sum, card) => sum + (card.value || 0), 0);
  const getPassTrackerTotal = (actor) => (possession === actor ? currentPassTotal : 0);
  const lastActiveCard = activePlay[activePlay.length - 1];
  const currentTutorial = TUTORIAL_SEQUENCES[tutorialPage] ?? TUTORIAL_SEQUENCES[0];

  const addLog = (message) => {
    setGameLog((previousLog) => [message, ...previousLog].slice(0, 5));
  };

  const setLaneNotice = (actor, message) => {
    setLaneNotices((previous) => ({ ...previous, [actor]: message }));
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

  useEffect(() => {
    if (!aiStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setAiStatus('');
    }, 1900);

    return () => window.clearTimeout(timeoutId);
  }, [aiStatus]);

  const getOpponent = (actor) => (actor === 'player' ? 'opponent' : 'player');
  const getHand = (actor) => (actor === 'player' ? playerHand : opponentHand);
  const getHandLimit = (actor) => (redCardPenalty[actor] > 0 ? 4 : 5);
  const hasCardInHand = (actor, cardId) => getHand(actor).some((card) => card.id === cardId);
  const setSanctionFor = (actor, sanction) => {
    setSanctions((previous) => ({ ...previous, [actor]: sanction }));
  };
  const clearSanctionFor = (actor) => {
    setSanctions((previous) => ({ ...previous, [actor]: null }));
  };
  const consumeSanctionTurn = (actor) => {
    setSanctions((previous) => {
      const currentSanction = previous[actor];

      if (!currentSanction?.turnsRemaining) {
        return previous;
      }

      const nextTurnsRemaining = currentSanction.turnsRemaining - 1;
      return {
        ...previous,
        [actor]: nextTurnsRemaining > 0 ? { ...currentSanction, turnsRemaining: nextTurnsRemaining } : null
      };
    });
  };
  const consumeRedCardTurn = (actor) => {
    setRedCardPenalty((previous) => {
      const currentTurns = previous[actor];

      if (currentTurns <= 0) {
        return previous;
      }

      const nextTurns = currentTurns - 1;
      return { ...previous, [actor]: nextTurns };
    });
  };
  const canUsePreShotDefense = (actor) =>
    PRE_SHOT_DEFENSE_CARD_IDS.some((cardId) => {
      if (cardId === 'sb') {
        return hasCardInHand(actor, 'sb') && hasCardInHand(actor, 'pc');
      }

      if (cardId === 'sc') {
        return hasCardInHand(actor, 'sc') && hasCardInHand(actor, 'pa') && hasCardInHand(actor, 'tg');
      }

      if (cardId === 'cont') {
        return hasCardInHand(actor, 'cont') && getHand(actor).some((card) => card.type === 'pass') && hasCardInHand(actor, 'tg');
      }

      return hasCardInHand(actor, cardId);
    });
  const getFirstCardIndex = (actor, matcher) => getHand(actor).findIndex((card) => matcher(card));
  const getPreferredPassIndex = (actor, maxTotal = 4) => {
    const availablePasses = getHand(actor)
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => card.type === 'pass' && currentPassTotal + card.value <= maxTotal)
      .sort((left, right) => right.card.value - left.card.value);

    return availablePasses[0]?.index ?? -1;
  };
  const getDiscardAction = (actor) => {
    if (hasActedThisTurn || hasReactionWindow || getHand(actor).length < 2) {
      return null;
    }

    const discardIndexes = getHand(actor)
      .map((_, index) => index)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);

    return { type: 'discard', indexes: discardIndexes };
  };
  const chooseOpponentAction = () => {
    if (gameState !== 'playing' || currentTurn !== 'opponent') {
      if (aiMode && pendingBlindDiscard?.actor === 'player' && playerHand.length > 0) {
        return { type: 'blind-discard-player', index: Math.floor(Math.random() * playerHand.length) };
      }

      return null;
    }

    if (pendingBlindDiscard?.actor === 'opponent') {
      return opponentHand.length > 0 ? { type: 'play', index: Math.floor(Math.random() * opponentHand.length) } : null;
    }

    if (pendingCombo?.actor === 'opponent') {
      if (pendingCombo.type === 'sb_followup') {
        return { type: 'play', index: getFirstCardIndex('opponent', (card) => card.id === 'pc') };
      }

      if (pendingCombo.type === 'sc_followup') {
        return {
          type: 'play',
          index: pendingCombo.stage === 'pass'
            ? getFirstCardIndex('opponent', (card) => card.id === 'pa')
            : getFirstCardIndex('opponent', (card) => card.id === 'tg')
        };
      }

      if (pendingCombo.type === 'cont_followup') {
        return {
          type: 'play',
          index: pendingCombo.stage === 'pass'
            ? getPreferredPassIndex('opponent')
            : getFirstCardIndex('opponent', (card) => card.id === 'tg')
        };
      }

      if (pendingCombo.type === 'chilena_followup') {
        return {
          type: 'play',
          index: pendingCombo.stage === 'pass'
            ? getFirstCardIndex('opponent', (card) => card.id === 'pa')
            : getFirstCardIndex('opponent', (card) => card.id === 'tg')
        };
      }
    }

    if (pendingDefense?.defenseCardId === 'pre_shot' && pendingDefense.defender === 'opponent') {
      const options = [
        getFirstCardIndex('opponent', (card) => card.id === 'sc' && hasCardInHand('opponent', 'pa') && hasCardInHand('opponent', 'tg')),
        getFirstCardIndex('opponent', (card) => card.id === 'cont' && hasCardInHand('opponent', 'tg') && getHand('opponent').some((handCard) => handCard.type === 'pass')),
        getFirstCardIndex('opponent', (card) => card.id === 'sb' && hasCardInHand('opponent', 'pc')),
        getFirstCardIndex('opponent', (card) => card.id === 'ba'),
        getFirstCardIndex('opponent', (card) => card.id === 'fa')
      ].filter((index) => index >= 0);

      return options.length > 0 ? { type: 'play', index: options[0] } : { type: 'end' };
    }

    if (pendingDefense?.defenseCardId === 'red_card_var' && pendingDefense.defender === 'opponent') {
      const varIndex = getFirstCardIndex('opponent', (card) => card.id === 'var');
      return varIndex >= 0 ? { type: 'play', index: varIndex } : { type: 'end' };
    }

    if (pendingDefense && pendingDefense.possessor === 'opponent') {
      if (pendingDefense.defenseCardId === 'ba') {
        return { type: 'play', index: getFirstCardIndex('opponent', (card) => card.id === 'reg') };
      }

      if (pendingDefense.defenseCardId === 'fa') {
        const yellowIndex = getFirstCardIndex('opponent', (card) => card.id === 'ta');
        const redIndex = getFirstCardIndex('opponent', (card) => card.id === 'tr');
        return { type: 'play', index: yellowIndex >= 0 ? yellowIndex : redIndex };
      }
    }

    if (pendingShot?.phase === 'penalty_response' && pendingShot.defender === 'opponent') {
      const saveIndex = getFirstCardIndex('opponent', (card) => card.id === 'paq');
      const varIndex = getFirstCardIndex('opponent', (card) => card.id === 'var');
      return saveIndex >= 0 ? { type: 'play', index: saveIndex } : varIndex >= 0 ? { type: 'play', index: varIndex } : { type: 'end' };
    }

    if (pendingShot?.phase === 'save' && pendingShot.defender === 'opponent') {
      const saveIndex = getFirstCardIndex('opponent', (card) => card.id === 'paq');
      return saveIndex >= 0 ? { type: 'play', index: saveIndex } : { type: 'end' };
    }

    if (pendingShot?.phase === 'remate' && pendingShot.attacker === 'opponent') {
      const remateIndex = getFirstCardIndex('opponent', (card) => card.id === 'rem');
      return remateIndex >= 0 ? { type: 'play', index: remateIndex } : { type: 'end' };
    }

    if (possession !== 'opponent') {
      const stealOptions = [
        getFirstCardIndex('opponent', (card) => card.id === 'cont' && hasCardInHand('opponent', 'tg') && getHand('opponent').some((handCard) => handCard.type === 'pass')),
        getFirstCardIndex('opponent', (card) => card.id === 'sc' && hasCardInHand('opponent', 'pa') && hasCardInHand('opponent', 'tg')),
        getFirstCardIndex('opponent', (card) => card.id === 'sb' && hasCardInHand('opponent', 'pc')),
        getFirstCardIndex('opponent', (card) => card.id === 'ba'),
        getFirstCardIndex('opponent', (card) => card.id === 'fa')
      ].filter((index) => index >= 0);

      return stealOptions.length > 0 ? { type: 'play', index: stealOptions[0] } : (getDiscardAction('opponent') ?? { type: 'end' });
    }

    const canShootNow =
      counterAttackReady ||
      (pendingCombo?.type === 'chilena_followup' && pendingCombo.stage === 'shot') ||
      (pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'shot') ||
      (pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'shot') ||
      currentPassTotal >= 4;
    if (canShootNow) {
      const shotIndex = getFirstCardIndex('opponent', (card) => card.id === 'tg');
      if (shotIndex >= 0) {
        return { type: 'play', index: shotIndex };
      }
    }

    const chilenaIndex = getFirstCardIndex('opponent', (card) => card.id === 'ch' && hasCardInHand('opponent', 'pa') && hasCardInHand('opponent', 'tg'));
    if (chilenaIndex >= 0 && currentPassTotal === 0) {
      return { type: 'play', index: chilenaIndex };
    }

    const passIndex = getPreferredPassIndex('opponent');
    if (passIndex >= 0) {
      return { type: 'play', index: passIndex };
    }

    const penaltyIndex = getFirstCardIndex('opponent', (card) => card.id === 'pe');
    if (penaltyIndex >= 0) {
      return { type: 'play', index: penaltyIndex };
    }

    return getDiscardAction('opponent') ?? { type: 'end' };
  };
  const hasReactionWindow = Boolean(pendingShot || pendingDefense || pendingBlindDiscard || pendingCombo);
  const canUseDiscard = !hasActedThisTurn && !hasReactionWindow;
  const reactionBannerMessage =
    pendingBlindDiscard
      ? `DESCARTE OCULTO EN CURSO: ${pendingBlindDiscard.actor === 'player' ? 'JUGADOR' : 'RIVAL'}`
      : pendingShot?.phase === 'penalty_response'
        ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: PENALTI`
        : pendingShot?.phase === 'offside_var'
          ? `VENTANA DE RESPUESTA DEL ${pendingShot.attacker === 'player' ? 'JUGADOR' : 'RIVAL'}: VAR CONTRA OFFSIDE`
        : pendingShot?.phase === 'save'
          ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: ${pendingShot.allowOffside ? 'OFFSIDE O PARADA' : 'PARADA DEL ARQUERO'}`
          : pendingShot?.phase === 'remate'
            ? `VENTANA DE RESPUESTA DEL ${pendingShot.attacker === 'player' ? 'JUGADOR' : 'RIVAL'}: REMATE`
            : pendingDefense?.defenseCardId === 'pre_shot'
              ? `VENTANA DE RESPUESTA DEL ${pendingDefense.defender === 'player' ? 'JUGADOR' : 'RIVAL'} ANTES DEL TIRO`
              : pendingDefense?.defenseCardId === 'red_card_var'
                ? `VENTANA DE RESPUESTA DEL ${pendingDefense.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: VAR`
                  : pendingDefense?.defenseCardId
                    ? `VENTANA DE RESPUESTA DEL ${pendingDefense.possessor === 'player' ? 'JUGADOR' : 'RIVAL'}`
                  : pendingCombo?.type === 'sb_followup'
                    ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR PASE CORTO`
                  : pendingCombo?.type === 'sc_followup'
                    ? pendingCombo.stage === 'pass'
                      ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR PASE AEREO`
                      : `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR TIRAR A GOL`
                  : pendingCombo?.type === 'cont_followup'
                    ? pendingCombo.stage === 'pass'
                      ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR UN PASE`
                      : `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR TIRAR A GOL`
                  : pendingCombo?.type === 'chilena_followup'
                    ? pendingCombo.stage === 'pass'
                      ? `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR PASE AEREO`
                      : `SECUENCIA OBLIGATORIA: ${pendingCombo.actor === 'player' ? 'JUGADOR' : 'RIVAL'} DEBE JUGAR TIRAR A GOL`
                      : null;
  const statusBannerMessage = aiStatus || reactionBannerMessage;
  const comboWindow =
    pendingCombo?.type === 'chilena_followup'
      ? {
          title: 'Combinacion Chilena',
          actor: pendingCombo.actor,
          accent: 'orange',
          required: pendingCombo.stage === 'pass'
            ? 'Debes jugar Pase Aereo para continuar la combinacion.'
            : 'Debes cerrar la jugada con Tirar a Gol.',
          slots: [
            { label: 'Chilena', filled: true },
            { label: 'Pase Aereo', filled: pendingCombo.stage === 'shot' },
            { label: 'Tirar a Gol', filled: false }
          ]
        }
      : pendingCombo?.type === 'sb_followup'
        ? {
            title: 'Saque de Banda',
            actor: pendingCombo.actor,
            accent: 'lime',
            required: 'Debes jugar Pase Corto para completar la combinacion.',
            slots: [
              { label: 'Saque de Banda', filled: true },
              { label: 'Pase Corto', filled: false }
            ]
          }
      : pendingCombo?.type === 'sc_followup'
        ? {
            title: 'Saque de Corner',
            actor: pendingCombo.actor,
            accent: 'sky',
            required: pendingCombo.stage === 'pass'
              ? 'Debes jugar Pase Aereo para continuar la combinacion.'
              : 'Debes cerrar la jugada con Tirar a Gol.',
            slots: [
              { label: 'Saque de Corner', filled: true },
              { label: 'Pase Aereo', filled: pendingCombo.stage === 'shot' },
              { label: 'Tirar a Gol', filled: false }
            ]
          }
      : pendingCombo?.type === 'cont_followup'
        ? {
            title: 'Contraataque',
            actor: pendingCombo.actor,
            accent: 'indigo',
            required: pendingCombo.stage === 'pass'
              ? 'Debes jugar un pase para continuar la combinacion.'
              : 'Debes cerrar la jugada con Tirar a Gol.',
            slots: [
              { label: 'Contraataque', filled: true },
              { label: 'Pase', filled: pendingCombo.stage === 'shot' },
              { label: 'Tirar a Gol', filled: false }
            ]
          }
      : null;

  const clearTransientState = () => {
    setDiscardShowcasePendingArchive(true);
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

  const registerDiscardShowcaseCards = (actor, cards) => {
    if (!cards.length) {
      return;
    }

    setDiscardShowcase((previous) => ({
      ...(discardShowcasePendingArchive
        ? {
            player: {
              current: [],
              archive: [...previous.player.current, ...previous.player.archive].slice(0, 12)
            },
            opponent: {
              current: [],
              archive: [...previous.opponent.current, ...previous.opponent.archive].slice(0, 12)
            }
          }
        : previous),
      [actor]: {
        ...(discardShowcasePendingArchive
          ? {
              current: [],
              archive: [...previous[actor].current, ...previous[actor].archive].slice(0, 12)
            }
          : previous[actor]),
        current: [
          ...(discardShowcasePendingArchive ? [] : previous[actor].current),
          ...cards.map((card, index) => ({
            ...card,
            visualId: `${card.instanceId ?? card.id}-${Date.now()}-${index}-${actor}`
          }))
        ]
      }
    }));
    setDiscardShowcasePendingArchive(false);
  };

  const drawCardsFromPools = (currentDeck, currentDiscardPile, amount, heldBackCards = []) => {
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

  const resetMatch = () => {
    setGameState('menu');
    setTutorialPage(0);
    setCoinFlipState({
      choice: null,
      result: null,
      winner: null,
      isFlipping: false
    });
    setPlayerScore(0);
    setOpponentScore(0);
    setSanctions({ player: null, opponent: null });
    setDeck([]);
    setDiscardPile([]);
    setDiscardShowcase({
      player: { current: [], archive: [] },
      opponent: { current: [], archive: [] }
    });
    setDiscardShowcasePendingArchive(false);
    setLaneNotices({ player: '', opponent: '' });
    setPlayerHand([]);
    setOpponentHand([]);
    setPossession(null);
    setCurrentTurn(null);
    setRedCardPenalty({ player: 0, opponent: 0 });
    setPendingBlindDiscard(null);
    setGoalCelebration(null);
    setMatchWinner(null);
    setAiMode(false);
    setGameLog(['Posesion persistente activada']);
    clearTransientState();
  };

  const consumeCard = (actor, index, card) => {
    const currentHand = getHand(actor);
    const nextHand = currentHand.filter((_, handIndex) => handIndex !== index);
    const drawResult = drawCardsFromPools(
      deck,
      discardPile,
      Math.max(0, getHandLimit(actor) - nextHand.length),
      [card]
    );

    setDiscardPile(drawResult.discardPile);
    registerDiscardShowcaseCards(actor, [card]);
    setDeck(drawResult.deck);
    setLaneNotice(actor, `${actor === 'player' ? 'Jugador' : 'Rival'} juega ${card.name}.`);

    if (drawResult.reshuffled) {
      addLog('El mazo se vacio. Se barajo el descarte y se formo un nuevo mazo.');
    }

    if (actor === 'player') {
      setPlayerHand([...nextHand, ...drawResult.drawnCards]);
      return;
    }

    setOpponentHand([...nextHand, ...drawResult.drawnCards]);
  };

  const startFromMenu = (nextAiMode = false) => {
    setAiMode(nextAiMode);
    setGameState('coin-flip');
    setTutorialPage(0);
    setGameLog([nextAiMode ? 'Modo IA activado' : 'Posesion persistente activada']);
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
    registerDiscardShowcaseCards(actor, [card]);
    setLaneNotice(actor, `${actor === 'player' ? 'Jugador' : 'Rival'} descarta 1 carta oculta.`);

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

  const executeDiscard = (actor, indexes) => {
    const hand = [...getHand(actor)];
    const uniqueIndexes = [...new Set(indexes)]
      .filter((index) => index >= 0 && index < hand.length)
      .sort((left, right) => left - right);

    if (uniqueIndexes.length === 0) {
      return false;
    }

    const cardsToDiscard = hand.filter((_, idx) => uniqueIndexes.includes(idx));
    const newHand = hand.filter((_, idx) => !uniqueIndexes.includes(idx));
    const drawResult = drawCardsFromPools(
      deck,
      discardPile,
      Math.max(0, getHandLimit(actor) - newHand.length),
      cardsToDiscard
    );

    if (actor === 'player') {
      setPlayerHand([...newHand, ...drawResult.drawnCards]);
    } else {
      setOpponentHand([...newHand, ...drawResult.drawnCards]);
    }

    setDiscardPile(drawResult.discardPile);
    registerDiscardShowcaseCards(actor, cardsToDiscard);
    setDeck(drawResult.deck);
    applyRedCardTurnProgress(actor);
    setDiscardShowcasePendingArchive(true);
    setLaneNotice(actor, `${actor === 'player' ? 'Jugador' : 'Rival'} descarta ${cardsToDiscard.length} carta${cardsToDiscard.length === 1 ? '' : 's'}.`);
    setCurrentTurn(getOpponent(actor));
    setHasActedThisTurn(false);
    setSelectedForDiscard([]);
    setDiscardMode(false);

    if (drawResult.reshuffled) {
      addLog('El mazo se vacio. Se barajo el descarte y se formo un nuevo mazo.');
    }

    addLog(`${actor === 'player' ? 'Jugador' : 'Rival'} descarto ${cardsToDiscard.length} carta${cardsToDiscard.length === 1 ? '' : 's'}.`);
    return true;
  };

  const fillHandsToLimits = () => {
    const playerDrawResult = drawCardsFromPools(deck, discardPile, Math.max(0, getHandLimit('player') - playerHand.length));
    const opponentDrawResult = drawCardsFromPools(
      playerDrawResult.deck,
      playerDrawResult.discardPile,
      Math.max(0, getHandLimit('opponent') - opponentHand.length)
    );

    setPlayerHand([...playerHand, ...playerDrawResult.drawnCards]);
    setOpponentHand([...opponentHand, ...opponentDrawResult.drawnCards]);
    setDiscardPile(opponentDrawResult.discardPile);
    setDeck(opponentDrawResult.deck);

    if (playerDrawResult.reshuffled || opponentDrawResult.reshuffled) {
      addLog('El mazo se vacio. Se barajo el descarte y se formo un nuevo mazo.');
    }
  };

  const refillActorHandToLimit = (actor, targetLimit) => {
    const currentHand = getHand(actor);
    const drawResult = drawCardsFromPools(deck, discardPile, Math.max(0, targetLimit - currentHand.length));

    if (actor === 'player') {
      setPlayerHand([...currentHand, ...drawResult.drawnCards]);
    } else {
      setOpponentHand([...currentHand, ...drawResult.drawnCards]);
    }

    setDiscardPile(drawResult.discardPile);
    setDeck(drawResult.deck);

    if (drawResult.reshuffled) {
      addLog('El mazo se vacio. Se barajo el descarte y se formo un nuevo mazo.');
    }
  };

  const applyRedCardTurnProgress = (actor) => {
    const currentTurns = redCardPenalty[actor];

    if (currentTurns <= 0) {
      return;
    }

    consumeRedCardTurn(actor);

    if (currentTurns <= 1) {
      clearSanctionFor(actor);
      refillActorHandToLimit(actor, 5);
      return;
    }

    setSanctionFor(actor, {
      type: 'red',
      title: 'Roja',
      detail: 'Descarta 1 y juega con 4 cartas durante 3 turnos.',
      turnsRemaining: currentTurns - 1
    });
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
    setLaneNotice(scorer, `${scorer === 'player' ? 'Jugador' : 'Rival'} anota gol.`);

    const nextActor = getOpponent(scorer);
    applyRedCardTurnProgress(scorer);
    clearTransientState();

    if (Math.max(nextPlayerScore, nextOpponentScore) >= 5) {
      setMatchWinner(scorer);
      setGameState('finished');
      setPossession(null);
      setCurrentTurn(null);
      addLog(`${reason} ${scorerLabel} gana el partido 5 goles.`);
      return;
    }

    setPossession(nextActor);
    setCurrentTurn(nextActor);
    addLog(reason);
  };

  const startShotResolution = (attacker, shotType) => {
    const defender = getOpponent(attacker);
    const unstoppable = shotType === 'chilena';

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

    const canUseOffside = shotType !== 'remate' && hasCardInHand(defender, 'off');
    const canUseArquero = hasCardInHand(defender, 'paq');

    if (canUseArquero || canUseOffside) {
      setPendingShot({
        attacker,
        defender,
        shotType,
        phase: 'save',
        allowOffside: canUseOffside
      });
      setCurrentTurn(defender);
      setHasActedThisTurn(false);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog(
        shotType === 'remate'
          ? 'Remate al arco. El rival puede responder con Parada Arquero.'
          : `Tiro al arco. El rival puede responder con ${canUseOffside ? 'Offside o Parada Arquero' : 'Parada Arquero'}.`
      );
      return;
    }

    scoreGoal(
      attacker,
      shotType === 'remate' ? 'Remate convertido. No hubo Parada Arquero.' : 'Gol: el rival no tenia Offside ni Parada Arquero.'
    );
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
      setHasActedThisTurn(true);
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
      setHasActedThisTurn(true);
      addLog('Falta agresiva sin respuesta. El balon cambia de posesion.');
      return;
    }

    clearTransientState();
    setPossession(defender);
    setCurrentTurn(defender);
    setHasActedThisTurn(true);

    if (defenseCard.id === 'cont') {
      setPendingCombo({ actor: defender, type: 'cont_followup', stage: 'pass' });
      addLog('Contraataque activado. Debes jugar un pase y luego Tirar a Gol.');
      return;
    }

    if (defenseCard.id === 'sb') {
      setPendingCombo({ actor: defender, type: 'sb_followup' });
      addLog('Saque de banda activado. Debes jugar Pase Corto para recuperar y sumar un pase.');
      return;
    }

    if (defenseCard.id === 'sc') {
      setActivePlay([]);
      setPendingCombo({ actor: defender, type: 'sc_followup', stage: 'pass' });
      addLog('Saque de corner activado. Debes jugar Pase Aereo y luego Tirar a Gol.');
    }
  };

  const handleCoinFlip = (choice) => {
    if (coinFlipState.isFlipping) {
      return;
    }

    const result = Math.random() > 0.5 ? 'Cara' : 'Sello';
    const winner = choice === result ? 'player' : 'opponent';

    setCoinFlipState({
      choice,
      result: null,
      winner: null,
      isFlipping: true
    });

    window.setTimeout(() => {
      setCoinFlipState({
        choice,
        result,
        winner,
        isFlipping: false
      });
      setPossession(winner);
      setCurrentTurn(winner);
      setGameState('dealing');
      addLog(`Salio ${result}. El ${winner === 'player' ? 'Jugador' : 'Rival'} tiene el balon.`);
    }, 1900);
  };

  const handleDeal = () => {
    const newDeck = initDeck();
    setDiscardShowcase({
      player: { current: [], archive: [] },
      opponent: { current: [], archive: [] }
    });
    setDiscardShowcasePendingArchive(false);
    setLaneNotices({ player: '', opponent: '' });
    setPlayerHand(newDeck.splice(0, 5));
    setOpponentHand(newDeck.splice(0, 5));
    setDeck(newDeck);
    setGameState('playing');
  };

  const endTurn = () => {
    if (pendingBlindDiscard) {
      addLog('Debes resolver primero el descarte oculto antes de continuar.');
      return;
    }

    if (pendingCombo?.type === 'sb_followup') {
      addLog('Debes completar la secuencia Saque de Banda + Pase Corto antes de finalizar el turno.');
      return;
    }

    if (pendingCombo?.type === 'sc_followup') {
      addLog('Debes completar la secuencia Saque de Corner + Pase Aereo + Tirar a Gol antes de finalizar el turno.');
      return;
    }

    if (pendingCombo?.type === 'cont_followup') {
      addLog('Debes completar la secuencia Contraataque + pase antes de finalizar el turno.');
      return;
    }

    if (pendingCombo?.type === 'chilena_followup') {
      addLog('Debes completar la combinacion Chilena + Pase Aereo + Tirar a Gol antes de finalizar el turno.');
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

    if (pendingShot?.phase === 'offside_var') {
      clearTransientState();
      setPossession(pendingShot.defender);
      setCurrentTurn(pendingShot.defender);
      addLog('Offside confirmado. No se uso VAR y el balon cambia de posesion.');
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

    if (pendingDefense?.defenseCardId === 'red_card_var') {
      setPendingDefense(null);
      setCurrentTurn(pendingDefense.possessor);
      setHasActedThisTurn(true);
      addLog('La Roja se mantiene. No se uso VAR.');
      return;
    }

    if (pendingDefense && pendingDefense.defenseCardId !== 'red_card_var') {
      const defender = pendingDefense.defender;
      clearTransientState();
      setPossession(defender);
      setCurrentTurn(defender);
      addLog('La contracarta se resolvio sin respuesta. El balon cambia de posesion.');
      return;
    }

    const actor = currentTurn;

    const keepsTurn = bonusTurnFor === actor;
    const nextActor = keepsTurn ? actor : getOpponent(actor);

    if (keepsTurn) {
      setBonusTurnFor(null);
      consumeSanctionTurn(getOpponent(actor));
    }

    if (redCardPenalty[actor] > 0 && !keepsTurn) {
      applyRedCardTurnProgress(actor);
    }

    setDiscardShowcasePendingArchive(true);
    setCurrentTurn(nextActor);
    setHasActedThisTurn(false);
    setSelectedForDiscard([]);
    setDiscardMode(false);
    addLog(
      keepsTurn
        ? 'Tarjeta Amarilla: comienza un nuevo turno extra con la misma posesion.'
        : `Cambio de turno. Balon: ${possession === 'player' ? 'Jugador' : 'Rival'}.`
    );
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
      addLog(`Modo descarte: selecciona las cartas que quieras descartar del ${currentTurn === 'player' ? 'Jugador' : 'Rival'}.`);
      return;
    }

    if (selectedForDiscard.length === 0) {
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog('Descarte cancelado.');
      return;
    }

    executeDiscard(currentTurn, selectedForDiscard);
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

    setSelectedForDiscard((previous) => [...previous, index]);
  };

  const playCard = (card, index, isFromPlayer) => {
    const actor = isFromPlayer ? 'player' : 'opponent';
    const liveCard = getHand(actor)[index] ?? card;

    if (!liveCard) {
      return;
    }

    card = liveCard;

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

    if (pendingDefense?.defenseCardId === 'red_card_var') {
      if (actor !== pendingDefense.defender || card.id !== 'var') {
        addLog('Solo puedes responder con VAR para anular la Roja.');
        return;
      }

      consumeCard(actor, index, card);
      clearSanctionFor(actor);
      clearTransientState();
      setPossession(actor);
      setCurrentTurn(actor);
      addLog('VAR anula la Tarjeta Roja. La Falta Agresiva se mantiene.');
      return;
    }

    if (pendingDefense && pendingDefense.defenseCardId !== 'pre_shot') {
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

      consumeCard(actor, index, card);

      if (card.id === 'tr' && hasCardInHand(pendingDefense.defender, 'var')) {
        setPendingDefense({ ...pendingDefense, defenseCardId: 'red_card_var' });
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
        setSanctionFor(pendingDefense.defender, {
          type: 'yellow',
          title: 'Amarilla',
          detail: 'Pierde la jugada y concede un turno extra.',
          turnsRemaining: 1
        });
        addLog('Tarjeta Amarilla: mantienes la posesion y robas un turno.');
        return;
      }

      openBlindDiscard(
        pendingDefense.defender,
        'Tarjeta Roja: el rival debe elegir una posicion de su mano para descartar una carta oculta.',
        actor
      );
      setRedCardPenalty((previous) => ({ ...previous, [pendingDefense.defender]: 3 }));
      setSanctionFor(pendingDefense.defender, {
        type: 'red',
        title: 'Roja',
        detail: 'Descarta 1 y juega con 4 cartas durante 3 turnos.',
        turnsRemaining: 3
      });
      addLog('Tarjeta Roja: mantienes la posesion y el rival jugara con 4 cartas durante 3 turnos.');
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

    if (pendingCombo?.type === 'sc_followup') {
      if (actor !== pendingCombo.actor) {
        addLog('Debe resolverse primero la combinacion de Saque de Corner + Pase Aereo.');
        return;
      }

      if (pendingCombo.stage === 'pass' && card.id !== 'pa') {
        addLog('Despues de Saque de Corner debes jugar obligatoriamente un Pase Aereo.');
        return;
      }

      if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
        addLog('Despues del Pase Aereo debes jugar obligatoriamente Tirar a Gol.');
        return;
      }
    }

    if (pendingCombo?.type === 'cont_followup') {
      if (actor !== pendingCombo.actor) {
        addLog('Debe resolverse primero la combinacion de Contraataque + pase.');
        return;
      }

      if (pendingCombo.stage === 'pass' && card.type !== 'pass') {
        addLog('Despues de Contraataque debes jugar obligatoriamente un pase.');
        return;
      }

      if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
        addLog('Despues del pase del Contraataque debes jugar obligatoriamente Tirar a Gol.');
        return;
      }
    }

    if (pendingCombo?.type === 'chilena_followup' && actor === pendingCombo.actor) {
      if (pendingCombo.stage === 'pass' && card.id !== 'pa') {
        addLog('Despues de Chilena debes jugar obligatoriamente Pase Aereo.');
        return;
      }

      if (pendingCombo.stage === 'shot' && card.id !== 'tg') {
        addLog('Despues del Pase Aereo debes jugar obligatoriamente Tirar a Gol.');
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

      if (card.id === 'sc' && (!hasCardInHand(actor, 'pa') || !hasCardInHand(actor, 'tg'))) {
        addLog('Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.');
        return;
      }

        consumeCard(actor, index, card);
        setHasActedThisTurn(true);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        startDefenseResolution(actor, card);
        return;
    }

    if (pendingShot?.phase === 'penalty_response') {
      if (actor !== pendingShot.defender || !['var', 'paq'].includes(card.id)) {
        addLog('Solo puedes responder al Penalti con VAR o Parada Arquero.');
        return;
      }

        consumeCard(actor, index, card);

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
      if (actor !== pendingShot.defender || !['paq', 'off'].includes(card.id) || (card.id === 'off' && !pendingShot.allowOffside)) {
        addLog(`Solo puedes responder al tiro con ${pendingShot.allowOffside ? 'Offside o Parada Arquero' : 'Parada Arquero'}.`);
        return;
      }

        consumeCard(actor, index, card);

        if (card.id === 'off') {
        if (!hasCardInHand(pendingShot.attacker, 'var')) {
          clearTransientState();
          setPossession(actor);
          setCurrentTurn(actor);
          addLog('Offside sancionado. No hubo VAR y el balon cambia de posesion.');
          return;
        }

        setPendingShot({ ...pendingShot, phase: 'offside_var', allowOffside: false });
        setCurrentTurn(pendingShot.attacker);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('Offside jugado. El atacante puede usar VAR para mantener la jugada.');
        return;
      }

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

    if (pendingShot?.phase === 'offside_var') {
      if (actor !== pendingShot.attacker || card.id !== 'var') {
        addLog('Solo puedes responder al Offside con VAR.');
        return;
      }

      consumeCard(actor, index, card);

      if (hasCardInHand(pendingShot.defender, 'paq')) {
        setPendingShot({ ...pendingShot, phase: 'save', allowOffside: false });
        setCurrentTurn(pendingShot.defender);
        setHasActedThisTurn(false);
        setDiscardMode(false);
        setSelectedForDiscard([]);
        addLog('VAR anula el Offside. El rival aun puede usar Parada Arquero.');
        return;
      }

      scoreGoal(actor, 'VAR anula el Offside. Gol: no hubo Parada Arquero.');
      return;
    }

    if (pendingShot?.phase === 'remate') {
      if (actor !== pendingShot.attacker || card.id !== 'rem') {
        addLog('Tras la parada solo puedes jugar Remate.');
        return;
      }

        consumeCard(actor, index, card);
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

      if (card.id === 'sc' && (!hasCardInHand(actor, 'pa') || !hasCardInHand(actor, 'tg'))) {
        addLog('Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.');
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
      if (pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'pass') {
        setPendingCombo({ ...pendingCombo, stage: 'shot' });
        setCounterAttackReady(true);
      }
      if (pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'pass') {
        setPendingCombo({ ...pendingCombo, stage: 'shot' });
        setCounterAttackReady(true);
      }
      if (pendingCombo?.type === 'chilena_followup' && pendingCombo.stage === 'pass') {
        setPendingCombo({ ...pendingCombo, stage: 'shot' });
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

    if (card.id === 'sc') {
      if (!hasCardInHand(actor, 'pa') || !hasCardInHand(actor, 'tg')) {
        addLog('Saque de corner solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.');
        return;
      }

      consumeCard(actor, index, card);
      setActivePlay([]);
      setPendingCombo({ actor, type: 'sc_followup', stage: 'pass' });
      setCounterAttackReady(false);
      setHasActedThisTurn(true);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog('Saque de corner activado con posesion. Debes jugar Pase Aereo y luego Tirar a Gol.');
      return;
    }

    if (card.id === 'tg') {
      const canShootFromSpecial =
        counterAttackReady ||
        pendingCombo?.type === 'chilena_followup' ||
        (pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'shot');

      if (pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'pass') {
        addLog('Antes de tirar a gol debes jugar el pase obligatorio del Contraataque.');
        return;
      }

      if (!canShootFromSpecial && currentPassTotal < 4) {
        addLog('Necesitas 4 puntos de pases para tirar.');
        return;
      }

      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      if (pendingCombo?.type === 'chilena_followup') {
        setPendingCombo(null);
        startShotResolution(actor, 'chilena');
        return;
      }

      if (pendingCombo?.type === 'sc_followup' && pendingCombo.stage === 'shot') {
        setPendingCombo(null);
      }

      if (pendingCombo?.type === 'cont_followup' && pendingCombo.stage === 'shot') {
        setPendingCombo(null);
      }

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
      if (!hasCardInHand(actor, 'pa') || !hasCardInHand(actor, 'tg')) {
        addLog('La Chilena solo puede activarse si tienes Pase Aereo y Tirar a Gol en mano.');
        return;
      }

      consumeCard(actor, index, card);
      setHasActedThisTurn(true);
      setPendingCombo({
        actor,
        type: 'chilena_followup',
        stage: 'pass'
      });
      addLog('Chilena activada. Ahora debes jugar Pase Aereo y luego Tirar a Gol.');
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

  useEffect(() => {
    if (!aiMode || gameState !== 'playing') {
      return undefined;
    }

    const isOpponentTurn = currentTurn === 'opponent';
    const isAiResolvingPlayerBlindDiscard = pendingBlindDiscard?.actor === 'player';

    if (!isOpponentTurn && !isAiResolvingPlayerBlindDiscard) {
      return undefined;
    }

    const action = chooseOpponentAction();

    if (!action) {
      return undefined;
    }

    setAiStatus(pendingBlindDiscard ? 'IA elige una carta oculta...' : 'IA pensando...');

    const timeoutId = window.setTimeout(() => {
      if (action.type === 'end') {
        addLog('IA: finaliza el turno.');
        setAiStatus('IA finaliza el turno');
        endTurn();
        return;
      }

      if (action.type === 'discard') {
        setAiStatus('IA descarta 2 cartas');
        executeDiscard('opponent', action.indexes);
        return;
      }

      if (action.type === 'blind-discard-player') {
        setAiStatus('IA elige una carta oculta del jugador');
        resolveBlindDiscard('player', action.index);
        return;
      }

      const card = opponentHand[action.index];

      if (!card) {
        addLog('IA: no encontro una carta valida y finaliza el turno.');
        setAiStatus('IA no encontro jugada valida');
        endTurn();
        return;
      }

      addLog(`IA juega: ${card.name}`);
      setAiStatus(`IA juega: ${card.name}`);
      playCard(card, action.index, false);
    }, pendingBlindDiscard ? 1200 : 1800);

    return () => window.clearTimeout(timeoutId);
  }, [
    aiMode,
    gameState,
    currentTurn,
    playerHand,
    opponentHand,
    possession,
    pendingBlindDiscard,
    pendingCombo,
    pendingDefense,
    pendingShot,
    counterAttackReady,
    currentPassTotal,
    hasActedThisTurn,
    hasReactionWindow
  ]);

  return (
      <div className="flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <style>{`
          @keyframes fieldBallBounce {
            0%, 100% { transform: translate(-50%, 0); }
            50% { transform: translate(-50%, -12px); }
          }

          @keyframes coinTossArc {
            0% { transform: translateY(170px) scale(0.78); opacity: 0; }
            12% { opacity: 1; }
            28% { transform: translateY(-56px) scale(1.01); }
            52% { transform: translateY(-166px) scale(1.08); }
            74% { transform: translateY(-34px) scale(0.96); }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }

          @keyframes coinSpinFace {
            0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
            18% { transform: rotateX(620deg) rotateY(120deg) rotateZ(-12deg); }
            52% { transform: rotateX(1680deg) rotateY(360deg) rotateZ(10deg); }
            82% { transform: rotateX(2440deg) rotateY(580deg) rotateZ(-5deg); }
            100% { transform: rotateX(2880deg) rotateY(720deg) rotateZ(0deg); }
          }

          @keyframes coinShadowPulse {
            0% { transform: scale(0.54); opacity: 0; }
            24% { transform: scale(0.88); opacity: 0.22; }
            52% { transform: scale(0.38); opacity: 0.08; }
            78% { transform: scale(0.92); opacity: 0.18; }
            100% { transform: scale(1); opacity: 0.24; }
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

          @keyframes discardCardSlideIn {
            0% { transform: translateY(18px) scale(0.92); opacity: 0; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
        `}</style>
        <div className="z-20 border-b-2 border-emerald-500 bg-slate-900 p-2 shadow-2xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4">
          <div className={`flex items-center gap-4 rounded-2xl p-3 transition-all ${
            possession === 'player'
              ? 'bg-blue-600/30 ring-2 ring-blue-500'
              : sanctions.player
                ? 'bg-blue-600/12 ring-1 ring-blue-300/60'
                : 'grayscale opacity-30'
          }`}>
            {possession === 'player' && <SoccerBallIcon size={20} className="animate-bounce" />}
            <div className="text-center">
              <span className="block text-[10px] font-black text-blue-400">JUGADOR</span>
              <span className="text-3xl font-black">{playerScore}</span>
              <div className="mt-1 flex justify-center gap-1.5">
                {[1, 2, 3, 4].map((point) => (
                  <div
                    key={`player-pass-${point}`}
                    className={`h-2 w-4 rounded-full transition-all duration-500 ${
                      getPassTrackerTotal('player') >= point ? 'bg-yellow-400 shadow-[0_0_10px_#facc15]' : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>
              <span className="mt-1 block text-[10px] font-black uppercase tracking-widest text-yellow-500">
                Puntos jugada: {getPassTrackerTotal('player')} / 4
              </span>
              {sanctions.player && (
                <div
                  className={`mt-2 flex max-w-[220px] items-start gap-2 rounded-xl border px-3 py-2 text-left shadow-lg ${
                    sanctions.player.type === 'red'
                      ? 'border-red-200/80 bg-red-500 text-white'
                      : 'border-yellow-100/90 bg-yellow-300 text-slate-950'
                  }`}
                >
                  <div
                    className={`mt-0.5 h-8 w-6 rounded-sm border shadow-md ${
                      sanctions.player.type === 'red'
                        ? 'border-red-100/80 bg-red-700'
                        : 'border-yellow-950/20 bg-yellow-100'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-[9px] font-black uppercase tracking-[0.2em]">
                      {sanctions.player.title}
                    </span>
                    <span className="block text-[10px] font-black leading-tight">
                      {sanctions.player.detail}
                    </span>
                    {sanctions.player.turnsRemaining ? (
                      <span className="mt-1 inline-flex rounded-full bg-black/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]">
                        Turnos restantes: {sanctions.player.turnsRemaining}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1" />

          <div className={`flex items-center gap-4 rounded-2xl p-3 transition-all ${
            possession === 'opponent'
              ? 'bg-red-600/30 ring-2 ring-red-500'
              : sanctions.opponent
                ? 'bg-red-600/12 ring-1 ring-red-300/60'
                : 'grayscale opacity-30'
          }`}>
            {possession === 'opponent' && <SoccerBallIcon size={20} className="animate-bounce" />}
            <div className="text-center">
              <span className="block text-[10px] font-black text-red-400">RIVAL</span>
              <span className="text-3xl font-black">{opponentScore}</span>
              <div className="mt-1 flex justify-center gap-1.5">
                {[1, 2, 3, 4].map((point) => (
                  <div
                    key={`opponent-pass-${point}`}
                    className={`h-2 w-4 rounded-full transition-all duration-500 ${
                      getPassTrackerTotal('opponent') >= point ? 'bg-yellow-400 shadow-[0_0_10px_#facc15]' : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>
              <span className="mt-1 block text-[10px] font-black uppercase tracking-widest text-yellow-500">
                Puntos jugada: {getPassTrackerTotal('opponent')} / 4
              </span>
              {sanctions.opponent && (
                <div
                  className={`mt-2 flex max-w-[220px] items-start gap-2 rounded-xl border px-3 py-2 text-left shadow-lg ${
                    sanctions.opponent.type === 'red'
                      ? 'border-red-200/80 bg-red-500 text-white'
                      : 'border-yellow-100/90 bg-yellow-300 text-slate-950'
                  }`}
                >
                  <div
                    className={`mt-0.5 h-8 w-6 rounded-sm border shadow-md ${
                      sanctions.opponent.type === 'red'
                        ? 'border-red-100/80 bg-red-700'
                        : 'border-yellow-950/20 bg-yellow-100'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-[9px] font-black uppercase tracking-[0.2em]">
                      {sanctions.opponent.title}
                    </span>
                    <span className="block text-[10px] font-black leading-tight">
                      {sanctions.opponent.detail}
                    </span>
                    {sanctions.opponent.turnsRemaining ? (
                      <span className="mt-1 inline-flex rounded-full bg-black/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]">
                        Turnos restantes: {sanctions.opponent.turnsRemaining}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
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
            className="pointer-events-none absolute left-[8%] z-0 transition-all duration-700 ease-in-out"
            style={{
              top: possession === 'player' ? '66%' : possession === 'opponent' ? '20%' : '44%',
              animation: possession ? 'fieldBallBounce 1.4s ease-in-out infinite' : 'none'
            }}
          >
            <div className="rounded-full bg-white/10 p-3 shadow-[0_0_30px_rgba(255,255,255,0.15)] backdrop-blur-sm">
              <SoccerBallIcon size={28} className="text-white/80" />
            </div>
          </div>

        <div className="relative z-10 w-full max-w-2xl opacity-80">
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
          <div className="grid w-full grid-cols-5 justify-items-center gap-1.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-2">
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

        <div className="z-10 flex w-full max-w-4xl items-center justify-between gap-4 px-4">
          <div className="flex w-full max-w-[300px] flex-col gap-3">
            <div className="flex flex-col gap-2">
              <DiscardLane title="Rival juega" pile={discardShowcase.opponent} />
              {laneNotices.opponent ? (
                <div className="self-start rounded-full border border-white/10 bg-black/55 px-4 py-2 text-[11px] font-bold text-emerald-300 backdrop-blur-sm">
                  {laneNotices.opponent}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <DiscardLane title="Jugador juega" pile={discardShowcase.player} />
              {laneNotices.player ? (
                <div className="self-start rounded-full border border-white/10 bg-black/55 px-4 py-2 text-[11px] font-bold text-emerald-300 backdrop-blur-sm">
                  {laneNotices.player}
                </div>
              ) : null}
            </div>
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

            {statusBannerMessage && (
              <div className="mt-3 rounded-full border border-yellow-300/40 bg-yellow-500/15 px-5 py-2 text-center text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200 shadow-[0_0_20px_rgba(250,204,21,0.18)]">
                {statusBannerMessage}
              </div>
            )}

          {comboWindow && (
            <div
              className={`mt-4 w-full max-w-lg rounded-[1.4rem] border px-5 py-4 text-center shadow-[0_18px_40px_rgba(0,0,0,0.28)] ${
                comboWindow.accent === 'lime'
                  ? 'border-lime-300/50 bg-lime-500/15 text-lime-100'
                  : comboWindow.accent === 'sky'
                    ? 'border-sky-300/50 bg-sky-500/15 text-sky-100'
                    : comboWindow.accent === 'indigo'
                      ? 'border-indigo-300/50 bg-indigo-500/15 text-indigo-100'
                      : 'border-orange-300/50 bg-orange-500/15 text-orange-100'
              }`}
            >
              <div className="text-[10px] font-black uppercase tracking-[0.35em]">
                {comboWindow.title}
              </div>
              <div className="mt-2 text-sm font-black">
                {comboWindow.actor === 'player' ? 'Jugador' : 'Rival'} en combinacion especial
              </div>
              <div className="mt-2 text-sm font-semibold leading-tight text-white">
                {comboWindow.required}
              </div>
              <div className="mt-4 flex items-center justify-center gap-3">
                {comboWindow.slots.map((slot) => (
                  <div
                    key={slot.label}
                    className={`flex h-20 w-24 flex-col items-center justify-center rounded-2xl border text-center shadow-lg ${
                      slot.filled
                        ? 'border-orange-200/80 bg-orange-400/90 text-slate-950'
                        : 'border-white/15 bg-slate-950/60 text-white/55'
                    }`}
                  >
                    <span className="px-2 text-[10px] font-black uppercase leading-tight tracking-[0.18em]">
                      {slot.label}
                    </span>
                    <span className="mt-2 text-[9px] font-black uppercase">
                      {slot.filled ? 'Listo' : 'Pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="relative z-10 w-full max-w-2xl pb-2">
          <div className="mb-3 text-center text-[11px] font-black uppercase tracking-[0.3em] text-white/70">
            Turno actual: {currentTurnLabel}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-center gap-4">
              {canUseDiscard && isPlayerTurn && (
              <button
                onClick={handleDiscard}
                className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-[10px] font-black transition-all ${
                  discardMode
                    ? selectedForDiscard.length > 0
                      ? 'scale-105 bg-orange-600 shadow-lg'
                      : 'bg-slate-700'
                    : 'bg-orange-700 shadow-lg hover:bg-orange-600'
                }`}
              >
                <RefreshCcw size={14} /> {discardMode ? (selectedForDiscard.length > 0 ? `CONFIRMAR DESCARTE (${selectedForDiscard.length})` : 'CANCELAR DESCARTE') : 'DESCARTAR'}
              </button>
            )}

              <button
                onClick={endTurn}
                disabled={Boolean(pendingBlindDiscard)}
                className={`flex items-center gap-2 rounded-full px-8 py-2.5 text-[10px] font-black shadow-xl ${
                  pendingBlindDiscard
                    ? 'cursor-not-allowed bg-slate-700 text-white/50'
                    : 'bg-emerald-500 hover:bg-emerald-400'
                }`}
              >
                <ArrowRightCircle size={14} /> FINALIZAR TURNO
              </button>
          </div>

          <div className="grid w-full grid-cols-5 justify-items-center gap-1.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5">
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

          {gameState === 'menu' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <div className="w-full max-w-2xl rounded-[2rem] border border-emerald-400/20 bg-slate-950/90 px-8 py-10 text-center shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.45em] text-emerald-400/70">
                  Menu principal
                </div>
                <h1 className="mb-4 text-4xl font-black text-white">Gol App</h1>
                <p className="mx-auto mb-8 max-w-xl text-sm font-semibold text-white/65">
                  Elige si quieres entrar directo al partido o ver un tutorial rapido con las reglas base y las combinaciones especiales.
                </p>
                  <div className="flex flex-wrap items-center justify-center gap-4">
                    <button
                      onClick={() => startFromMenu(false)}
                      className="flex items-center gap-3 rounded-2xl bg-emerald-500 px-8 py-4 text-sm font-black text-slate-950 transition-all hover:bg-emerald-400"
                    >
                      <PlayCircle size={18} /> JUGAR
                    </button>
                    <button
                      onClick={() => startFromMenu(true)}
                      className="flex items-center gap-3 rounded-2xl bg-cyan-400 px-8 py-4 text-sm font-black text-slate-950 transition-all hover:bg-cyan-300"
                    >
                      <Bot size={18} /> JUGAR CONTRA IA
                    </button>
                    <button
                      onClick={() => setGameState('tutorial')}
                      className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-sm font-black text-white transition-all hover:bg-white/10"
                    >
                    <BookOpen size={18} /> TUTORIAL
                  </button>
                </div>
              </div>
            </div>
          )}

          {gameState === 'tutorial' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <div className="w-full max-w-3xl rounded-[2rem] border border-cyan-400/20 bg-slate-950/95 px-8 py-8 text-left shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.45em] text-cyan-400/70">
                  Tutorial rapido
                </div>
                <h2 className="mb-6 text-3xl font-black text-white">Como se juega</h2>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_14px_35px_rgba(0,0,0,0.22)]">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">
                      {currentTutorial.title}
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
                      Paso {tutorialPage + 1} de {TUTORIAL_SEQUENCES.length}
                    </div>
                  </div>
                  <div className="mt-2 text-sm font-semibold leading-tight text-white/70">
                    {currentTutorial.note}
                  </div>
                  {currentTutorial.layout === 'versus' ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300">
                          {currentTutorial.left.title}
                        </div>
                        <div className="mt-3 flex justify-center">
                          <TutorialStepCard label={currentTutorial.left.card} />
                        </div>
                        <div className="mt-3 text-sm font-semibold leading-tight text-white/75">
                          {currentTutorial.left.text}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300">
                          {currentTutorial.right.title}
                        </div>
                        <div className="mt-3 flex justify-center">
                          <TutorialStepCard label={currentTutorial.right.card} />
                        </div>
                        <div className="mt-3 text-sm font-semibold leading-tight text-white/75">
                          {currentTutorial.right.text}
                        </div>
                      </div>
                    </div>
                  ) : currentTutorial.layout === 'penalty' || currentTutorial.layout === 'foul' ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300">
                          {currentTutorial.center.title}
                        </div>
                        <div className="mt-3 flex justify-center">
                          <TutorialStepCard label={currentTutorial.center.card} />
                        </div>
                        <div className="mt-3 text-sm font-semibold leading-tight text-white/75">
                          {currentTutorial.center.text}
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300">
                            {currentTutorial.left.title}
                          </div>
                          <div className="mt-3 flex justify-center">
                            <TutorialStepCard label={currentTutorial.left.card} />
                          </div>
                          <div className="mt-3 text-sm font-semibold leading-tight text-white/75">
                            {currentTutorial.left.text}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300">
                            {currentTutorial.right.title}
                          </div>
                          <div className="mt-3 flex justify-center">
                            <TutorialStepCard label={currentTutorial.right.card} />
                          </div>
                          <div className="mt-3 text-sm font-semibold leading-tight text-white/75">
                            {currentTutorial.right.text}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
                      {currentTutorial.steps.map((step, index) => (
                        <React.Fragment key={`${currentTutorial.title}-${step}-${index}`}>
                          <TutorialStepCard label={step} />
                          {index < currentTutorial.steps.length - 1 ? (
                            <div className="pt-10 text-lg font-black text-cyan-300/60">+</div>
                          ) : null}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  <div className="mt-6 flex items-center justify-between gap-3">
                    <button
                      onClick={() => setTutorialPage((previous) => Math.max(0, previous - 1))}
                      disabled={tutorialPage === 0}
                      className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ANTERIOR
                    </button>
                    <button
                      onClick={() => setTutorialPage((previous) => Math.min(TUTORIAL_SEQUENCES.length - 1, previous + 1))}
                      disabled={tutorialPage === TUTORIAL_SEQUENCES.length - 1}
                      className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-100 transition-all hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      SIGUIENTE
                    </button>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
                  <button
                    onClick={() => setGameState('menu')}
                    className="rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-black text-white transition-all hover:bg-white/10"
                  >
                    VOLVER
                  </button>
                  <button
                    onClick={startFromMenu}
                    className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-black text-slate-950 transition-all hover:bg-emerald-400"
                  >
                    IR A JUGAR
                  </button>
                </div>
              </div>
            </div>
          )}

          {gameState === 'coin-flip' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <div className="w-full max-w-lg rounded-[2rem] border border-yellow-400/20 bg-slate-950/90 px-7 py-8 text-center shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.45em] text-yellow-500/70">
                  Inicio del partido
                </div>
                <h2 className="mb-4 text-3xl font-black">Sorteo de saque</h2>
                <p className="mx-auto mb-6 max-w-md text-sm font-semibold text-white/65">
                  Elige cara o sello y lanza la moneda al aire para definir quien arranca con el balon.
                </p>

                {(() => {
                  const shownFace = coinFlipState.result ?? coinFlipState.choice ?? 'Cara';
                  const hiddenFace = getOppositeCoinFace(shownFace);
                  const restingTransform = coinFlipState.result
                    ? coinFlipState.result === 'Cara'
                      ? 'rotateY(0deg)'
                      : 'rotateY(180deg)'
                    : coinFlipState.choice === 'Sello'
                      ? 'rotateY(180deg)'
                      : 'rotateY(0deg)';

                  return (
                <div className="relative mx-auto mb-7 flex h-52 w-full max-w-[220px] items-end justify-center overflow-hidden">
                  <div
                    className="absolute bottom-4 h-5 w-28 rounded-full bg-black/50 blur-md"
                    style={{
                      animation: coinFlipState.isFlipping ? 'coinShadowPulse 1.9s ease-in-out forwards' : 'none'
                    }}
                  />
                  <div
                    className="relative flex h-32 w-32 items-center justify-center"
                    style={{
                      perspective: '1200px',
                      animation: coinFlipState.isFlipping ? 'coinTossArc 1.9s cubic-bezier(0.2,0.7,0.18,1) forwards' : 'none'
                    }}
                  >
                    <div
                      className="relative h-full w-full"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: coinFlipState.isFlipping ? undefined : restingTransform,
                        animation: coinFlipState.isFlipping ? 'coinSpinFace 1.9s cubic-bezier(0.18,0.72,0.16,1) forwards' : 'none'
                      }}
                    >
                      <div className="absolute inset-y-[10px] left-1/2 w-[12px] -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,#7a4b00_0%,#d9a419_26%,#fff0a2_50%,#d29c11_74%,#6f4300_100%)] shadow-[0_0_0_1px_rgba(255,240,170,0.24),inset_0_0_8px_rgba(255,255,255,0.22)] [transform:translateX(-50%)_rotateY(90deg)]" />
                      <div className="absolute inset-0 rounded-full border-[5px] border-yellow-100/70 shadow-[inset_0_8px_18px_rgba(255,255,255,0.34),inset_0_-18px_26px_rgba(92,54,0,0.42),0_18px_35px_rgba(0,0,0,0.45)]" />
                      <CoinFace face={shownFace} />
                      <CoinFace face={hiddenFace} mirrored />
                    </div>
                  </div>
                </div>
                  );
                })()}

                <div className="mb-6 min-h-[56px]">
                  {coinFlipState.isFlipping ? (
                    <div className="text-sm font-black uppercase tracking-[0.3em] text-yellow-300">
                      Moneda en el aire...
                    </div>
                  ) : coinFlipState.result ? (
                    <div className="space-y-1">
                      <div className="text-sm font-black uppercase tracking-[0.3em] text-yellow-300">
                        Salio {coinFlipState.result}
                      </div>
                      <div className="text-sm font-semibold text-white/70">
                        {coinFlipState.winner === 'player' ? 'Jugador' : 'Rival'} gana el sorteo.
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-white/45">
                      Esperando tu eleccion.
                    </div>
                  )}
                </div>

                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => handleCoinFlip('Cara')}
                    disabled={coinFlipState.isFlipping}
                    className="rounded-2xl bg-white px-10 py-4 font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    CARA
                  </button>
                  <button
                    onClick={() => handleCoinFlip('Sello')}
                    disabled={coinFlipState.isFlipping}
                    className="rounded-2xl bg-white px-10 py-4 font-black text-black transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    SELLO
                  </button>
                </div>
              </div>
            </div>
          )}

            {gameState === 'dealing' && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
                <div className="rounded-[2rem] border border-emerald-400/20 bg-slate-950/90 px-10 py-8 text-center shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
                  {coinFlipState.result && (
                    <div className="mb-5">
                      <div className="text-[11px] font-black uppercase tracking-[0.35em] text-yellow-400/80">
                        Resultado del sorteo
                      </div>
                      <div className="mt-2 text-3xl font-black text-white">
                        Salio {coinFlipState.result}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/65">
                        Comienza {coinFlipState.winner === 'player' ? 'Jugador' : 'Rival'}.
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleDeal}
                    className="animate-pulse rounded-2xl bg-emerald-500 px-12 py-6 text-xl font-black"
                  >
                    EMPEZAR PARTIDO
                  </button>
                </div>
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
