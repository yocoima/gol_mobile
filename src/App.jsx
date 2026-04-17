import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRightCircle,
  Bot,
  BookOpen,
  RefreshCcw,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { io } from 'socket.io-client';
import { AudioManager } from './audioManager.js';
import ambienceAudio from '../audios/audio_ambiente.mp4';
import foulAudio from '../audios/falta.m4a';
import goalAudio from '../audios/gol.m4a';
import yellowCardImage from '../imagenes/Tarjeta amarilla.png';
import redCardImage from '../imagenes/Tarjeta roja.png';
import coinVideo from '../imagenes/Moneda.mp4';
import oleVideo from '../videos/ole.mp4';
import chilenaVideo from '../videos/chilena.mp4';
import saveVideo from '../videos/parada_arquero.mp4';
import {
  AUTO_PASS_BY_DEFENSE,
  BASE_DECK_DEFINITION,
  normalizeAssetName
} from '../shared/game/core.js';
import {
  createLocalMatchSnapshot,
  drawCardsFromPools,
  getHandLimit,
  getOpponent
} from '../shared/game/state.js';
import {
  applyEndTurnAction,
  applyPlayCardAction,
  createEngineContext
} from '../shared/game/engine.js';
import {
  getBlindDiscardPlan,
  getBlindDiscardResolutionPlan,
  getCardPenaltyResponsePlan,
  getDefenseResolutionPlan,
  getGoalOutcome,
  getRedCardProgressPlan,
  getShotResolutionPlan
} from '../shared/game/rules.js';
import { AppButton, ModalCard, ScorePanel } from './components/MatchUi.jsx';

const CARD_IMAGE_MODULES = import.meta.glob('../imagenes/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default'
});

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
const AI_STATUS_TIMEOUT_MS = 3400;
const FIELD_EVENT_DURATION_MS = 3952;
const DRIBBLE_CARD_ID = 'reg';
const CHILENA_CARD_ID = 'ch';
const GOALKEEPER_SAVE_CARD_ID = 'paq';
const ONLINE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const ONLINE_CLIENT_ID_STORAGE_KEY = 'gol-online-client-id';
const TURN_COUNTDOWN_SECONDS = 30;
const HAND_DRAG_START_DISTANCE = 22;
const CARD_IMAGE_ALIASES = {
  'barrida': ['barrida'],
  'saque banda': ['saque de banda', 'saque banda'],
  'pase corto': ['pase corto'],
  'pase largo': ['pase largo'],
  'pase aereo': ['pase aereo'],
  'falta agresiva': ['falta agresiva'],
  'offside': ['offside'],
  'parada arquero': ['parada del arquero'],
  'saque corner': ['saque de corner', 'saque corner'],
  'tarj. amarilla': ['tarj. amarilla', 'tarjeta amarilla', 'tarjea amarilla'],
  'tarj. roja': ['tarj. roja', 'tarjeta roja'],
  'tirar a gol': ['tirar a gol'],
  'var': ['var']
};

const withCardImage = (card) => {
  if (!card || card.imageUrl) {
    return card;
  }

  const normalizedCardName = normalizeAssetName(card.name ?? '');
  const aliasCandidates = CARD_IMAGE_ALIASES[normalizedCardName] ?? [normalizedCardName];
  const imageUrl = aliasCandidates
    .map((candidate) => CARD_IMAGE_BY_NAME[normalizeAssetName(candidate)])
    .find(Boolean);

  if (!imageUrl && !CARD_IMAGE_BY_ID[card.id]) {
    return card;
  }

  return { ...card, imageUrl: CARD_IMAGE_BY_ID[card.id] ?? imageUrl ?? null };
};

const withCardsImage = (cards = []) => cards.map((card) => withCardImage(card));

const getPersistentOnlineClientId = () => {
  if (typeof window === 'undefined') {
    return 'server-render';
  }

  const existingClientId = window.localStorage.getItem(ONLINE_CLIENT_ID_STORAGE_KEY);
  if (existingClientId) {
    return existingClientId;
  }

  const nextClientId =
    typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(ONLINE_CLIENT_ID_STORAGE_KEY, nextClientId);
  return nextClientId;
};

const onlineDebugLog = (message, extra) => {
  if (typeof console === 'undefined') {
    return;
  }

  if (typeof extra === 'undefined') {
    console.info(`[gol-online] ${message}`);
    return;
  }

  console.info(`[gol-online] ${message}`, extra);
};

const DECK_DEFINITION = BASE_DECK_DEFINITION.map((card) => withCardImage(card));

const DEV_SHOW_OPPONENT_HAND = false;
const PASS_CARD_IDS = new Set(['pc', 'pl', 'pa']);

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

const CardItem = ({
  card,
  onClick,
  onSelect,
  onPointerDown,
  onPointerEnter,
  disabled,
  isSelected,
  canSelectDiscard,
  isDiscardMode,
  hideContent = false,
  interactionState = 'idle',
  dataIndex = null
}) => {
  const cardImage = card?.imageUrl;
  const cardLabel = hideContent ? 'Carta oculta' : card?.name;
  const cardTypeLabel =
    hideContent
      ? 'Oculta'
      : card?.type === 'pass'
        ? 'Pase'
        : card?.type === 'defense'
          ? 'Defensa'
          : card?.type === 'shoot'
            ? 'Remate'
            : card?.type === 'special'
              ? 'Especial'
              : 'Juego';

  return (
  <div className={`hand-card-shell group hand-card-shell-${interactionState}`} data-hand-card-index={dataIndex}>
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
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      disabled={disabled}
      className={`hand-card-button ${
        hideContent || cardImage ? 'bg-slate-900' : card?.color || 'bg-slate-800'
      } ${hideContent ? 'hand-card-hidden' : ''} ${
        !disabled ? 'hand-card-enabled' : 'hand-card-disabled'
      } ${isSelected ? 'hand-card-selected' : ''} hand-card-button-${interactionState}`}
    >
      {!hideContent && <div className="hand-card-badge">{cardTypeLabel}</div>}
      {cardImage && !hideContent && (
        <>
          <img
            src={cardImage}
            alt={card?.name}
            className="absolute inset-0 h-full w-full rounded-[18px] object-cover object-center"
          />
          <div className="absolute inset-0 rounded-[18px] bg-gradient-to-b from-black/18 via-transparent to-black/28" />
        </>
      )}
      <div className="hand-card-frame" />
      {hideContent ? (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[10px] font-black uppercase tracking-[0.2em] text-white/75 max-sm:text-[7px]">
          Carta
        </div>
      ) : null}
    </button>

    <div className="hand-card-name">
      {cardLabel}
    </div>
  </div>
  );
};

const DiscardLane = ({ title, pile }) => {
  const totalCards = pile.archive.length + pile.current.length;
  const visibleBacks = Array.from({ length: Math.min(totalCards, 5) }, (_, index) => index);

  return (
    <div className="w-full max-w-[260px] rounded-2xl border border-white/15 bg-slate-950/45 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.32)] backdrop-blur-sm max-sm:max-w-[220px] max-sm:p-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/45 max-sm:text-[8px]">{title}</span>
        <span className="rounded-full border border-white/10 bg-slate-950/80 px-2 py-0.5 text-[9px] font-black text-white/70 max-sm:text-[8px]">
          {totalCards}
        </span>
      </div>
      <div className="relative flex min-h-[92px] items-center justify-center max-sm:min-h-[78px]">
        {visibleBacks.length > 0 ? (
          <div className="relative h-20 w-16 max-sm:h-[72px] max-sm:w-14">
            {visibleBacks.map((index) => (
              <div
                key={`${title}-back-${index}`}
                className="absolute left-1/2 top-1/2 h-20 w-12 -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-white/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(8,47,73,0.94))] shadow-[0_10px_24px_rgba(0,0,0,0.35)] max-sm:h-[72px] max-sm:w-11 max-sm:rounded-[10px]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${index * 3}px) translateY(${index * 2}px) rotate(${(index - 2) * 2}deg)`,
                  zIndex: index + 1
                }}
              >
                <div className="absolute inset-[3px] rounded-[10px] border border-cyan-200/18" />
                <div className="absolute inset-0 rounded-[12px] bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.18),transparent_58%)]" />
                <div className="absolute inset-0 flex items-center justify-center text-[8px] font-black uppercase tracking-[0.22em] text-white/28">
                  Gol
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[92px] items-center text-[9px] font-black uppercase tracking-[0.18em] text-white/28 max-sm:min-h-[78px] max-sm:text-[8px]">
            Sin descarte
          </div>
        )}
      </div>
    </div>
  );
};

const TABLE_SEQUENCE_START_TYPES = new Set([
  'pass-play',
  'special-corner',
  'special-chilena',
  'shoot-card',
  'penalty-card'
]);

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
  const audioManagerRef = useRef(null);
  const socketRef = useRef(null);
  const pendingOnlineActionRef = useRef(null);
  const lastRecentActionIdRef = useRef(null);
  const lastReactionHintRef = useRef('');
  const [gameState, setGameState] = useState('menu');
  const [tutorialPage, setTutorialPage] = useState(0);
  const [coinFlipState, setCoinFlipState] = useState({
    choice: null,
    result: null,
    winner: null,
    isFlipping: false
  });
  const [coinFlipPlaybackId, setCoinFlipPlaybackId] = useState(0);
  const coinFlipVideoRef = useRef(null);
  const coinFlipFinalizeTimeoutRef = useRef(null);
  const coinFlipOutcomeRef = useRef(null);
  const coinFlipResolvedRef = useRef(false);
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
  const [tablePlay, setTablePlay] = useState([]);
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
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [onlineRoomCode, setOnlineRoomCode] = useState('');
  const [onlineJoinCode, setOnlineJoinCode] = useState('');
  const [onlinePlayerName, setOnlinePlayerName] = useState('');
  const [onlineRoom, setOnlineRoom] = useState(null);
  const [onlineRole, setOnlineRole] = useState(null);
  const [onlineSocketId, setOnlineSocketId] = useState(null);
  const [onlineError, setOnlineError] = useState('');
  const [showOnlineCoinChoice, setShowOnlineCoinChoice] = useState(false);
  const [systemNotice, setSystemNotice] = useState('');
  const [audioMuted, setAudioMuted] = useState(false);
  const [playerDisplayName, setPlayerDisplayName] = useState('JUGADOR');
  const [opponentDisplayName, setOpponentDisplayName] = useState('RIVAL');
  const [fieldEventAnimation, setFieldEventAnimation] = useState(null);
  const [onlineCoinFlipReveal, setOnlineCoinFlipReveal] = useState(null);
  const [isDribbleVideoPlaying, setIsDribbleVideoPlaying] = useState(false);
  const [activeActionVideo, setActiveActionVideo] = useState(oleVideo);
  const [activeHandCardIndex, setActiveHandCardIndex] = useState(null);
  const [dragCardState, setDragCardState] = useState(null);
  const [onlineTurnDeadlineAt, setOnlineTurnDeadlineAt] = useState(null);
  const [turnCountdown, setTurnCountdown] = useState(TURN_COUNTDOWN_SECONDS);
  const onlineCoinFlipTimeoutRef = useRef(null);
  const onlineCoinFlipPreviewTimeoutRef = useRef(null);
  const lastOnlineEventRef = useRef(null);
  const previousPossessionRef = useRef(null);
  const onlineRoomCodeRef = useRef('');
  const dribbleVideoRef = useRef(null);
  const pendingDribbleActionRef = useRef(null);
  const countdownAlertSecondRef = useRef(null);
  const lastHandPointerTypeRef = useRef('mouse');
  const suppressHandClickRef = useRef(false);
  const handDragRef = useRef(null);
  const matchTablePanelRef = useRef(null);
  const playCardRef = useRef(null);

  const isPlayerTurn = currentTurn === 'player';
  const isOpponentTurn = currentTurn === 'opponent';
  const currentTurnLabel = isPlayerTurn ? playerDisplayName : isOpponentTurn ? opponentDisplayName : 'Nadie';
  const blindDiscardTargetActor = pendingBlindDiscard?.targetActor ?? pendingBlindDiscard?.actor ?? null;
  const engineContext = createEngineContext({
    playerHand,
    opponentHand,
    activePlay,
    possession,
    currentTurn,
    pendingShot,
    pendingDefense,
    pendingBlindDiscard,
    pendingCombo,
    hasActedThisTurn,
    bonusTurnFor,
    redCardPenalty
  });
  const { currentPassTotal, getPassTrackerTotal, hasReactionWindow, canUseDiscard } = engineContext;
  const lastActiveCard = tablePlay[tablePlay.length - 1];
  const currentTutorial = TUTORIAL_SEQUENCES[tutorialPage] ?? TUTORIAL_SEQUENCES[0];
  const isTurnCountdownActive =
    onlineEnabled &&
    gameState === 'playing' &&
    currentTurn === 'player' &&
    !matchWinner &&
    typeof onlineTurnDeadlineAt === 'number' &&
    onlineTurnDeadlineAt > Date.now();
  const isPlayerHandInteractionBlocked =
    !isPlayerTurn ||
    isDribbleVideoPlaying ||
    (pendingBlindDiscard?.actor === 'player' && blindDiscardTargetActor === 'opponent');
  const canUseTouchHandInteraction =
    !discardMode &&
    blindDiscardTargetActor !== 'player' &&
    !isPlayerHandInteractionBlocked;

  const addLog = (message) => {
    setGameLog((previousLog) => [message, ...previousLog].slice(0, 5));
  };

  const queueActionVideo = (videoSrc, pendingAction = null) => {
    pendingDribbleActionRef.current = pendingAction;
    setActiveActionVideo(videoSrc);
    setIsDribbleVideoPlaying(true);
  };

  const clearDribbleAnimation = () => {
    pendingDribbleActionRef.current = null;
    setActiveActionVideo(oleVideo);
    setIsDribbleVideoPlaying(false);
  };

  const finishDribbleAnimation = () => {
    const pendingAction = pendingDribbleActionRef.current;
    pendingDribbleActionRef.current = null;
    setIsDribbleVideoPlaying(false);
    pendingAction?.();
  };

  const playCardSfx = (card) => {
    if (!card?.id) {
      return;
    }

    if (['ta', 'tr', 'off', 'pe'].includes(card.id)) {
      audioManagerRef.current?.playSfx('foul');
      return;
    }

    audioManagerRef.current?.playSfx('card_play');
  };

  const buildLaneNoticeFromRecentActions = (actions = [], localPlayerLabel = 'JUGADOR', localOpponentLabel = 'RIVAL') => {
    if (!Array.isArray(actions) || actions.length === 0) {
      return null;
    }

    const leadActor = actions[0].actor === 'player' ? 'player' : 'opponent';
    const actorLabel = leadActor === 'player' ? localPlayerLabel : localOpponentLabel;
    const consecutiveActions = [];

    for (const action of actions) {
      if (action.actor !== leadActor) {
        break;
      }
      consecutiveActions.push(action);
      if (consecutiveActions.length >= 4) {
        break;
      }
    }

    const discardCount = consecutiveActions.filter((action) => action.type === 'discard').length;
    if (discardCount >= 2) {
      return {
        id: actions[0].id,
        actor: leadActor,
        message: `${actorLabel} descarta ${discardCount} cartas.`
      };
    }

    if (consecutiveActions[0]?.type === 'discard') {
      return {
        id: actions[0].id,
        actor: leadActor,
        message: `${actorLabel} descarta 1 carta.`
      };
    }

    const passChain = [];
    for (const action of consecutiveActions) {
      if (action.type !== 'play' || !PASS_CARD_IDS.has(action.card?.id) || !action.card?.name) {
        break;
      }
      passChain.push(action.card.name);
      if (passChain.length >= 2) {
        break;
      }
    }

    if (passChain.length >= 2) {
      const orderedPasses = [...passChain].reverse();
      return {
        id: actions[0].id,
        actor: leadActor,
        message: `${actorLabel} juega ${orderedPasses.join(' + ')}.`
      };
    }

    if (consecutiveActions[0]?.card?.name) {
      return {
        id: actions[0].id,
        actor: leadActor,
        message: `${actorLabel} juega ${consecutiveActions[0].card.name}.`
      };
    }

    return null;
  };

  const scheduleOnlineCoinFlipClose = (durationSeconds) => {
    if (onlineCoinFlipTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipTimeoutRef.current);
      onlineCoinFlipTimeoutRef.current = null;
    }

    const fallbackMs = 9000;
    const closeDelayMs =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.min(16000, Math.max(4200, Math.round(durationSeconds * 1000) + 450))
        : fallbackMs;

    onlineCoinFlipTimeoutRef.current = window.setTimeout(() => {
      setOnlineCoinFlipReveal((previous) => (previous ? { ...previous, showResult: true } : null));
      onlineCoinFlipTimeoutRef.current = window.setTimeout(() => {
        setOnlineCoinFlipReveal(null);
        onlineCoinFlipTimeoutRef.current = null;
      }, 1200);
    }, closeDelayMs);
  };

  const handleOnlineCoinFlipEnded = () => {
    if (onlineCoinFlipTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipTimeoutRef.current);
      onlineCoinFlipTimeoutRef.current = null;
    }

    setOnlineCoinFlipReveal((previous) => (previous ? { ...previous, showResult: true } : null));
    onlineCoinFlipTimeoutRef.current = window.setTimeout(() => {
      setOnlineCoinFlipReveal(null);
      onlineCoinFlipTimeoutRef.current = null;
    }, 1200);
  };

  const showOnlineCoinFlipReveal = (nextReveal) => {
    if (onlineCoinFlipPreviewTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipPreviewTimeoutRef.current);
      onlineCoinFlipPreviewTimeoutRef.current = null;
    }
    setOnlineCoinFlipReveal({ ...nextReveal, showResult: false, showVideo: false });
    onlineCoinFlipPreviewTimeoutRef.current = window.setTimeout(() => {
      setOnlineCoinFlipReveal((previous) => (previous ? { ...previous, showVideo: true } : null));
      onlineCoinFlipPreviewTimeoutRef.current = null;
    }, 1200);
  };

  const closeOnlineCoinFlipReveal = () => {
    if (onlineCoinFlipTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipTimeoutRef.current);
      onlineCoinFlipTimeoutRef.current = null;
    }
    if (onlineCoinFlipPreviewTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipPreviewTimeoutRef.current);
      onlineCoinFlipPreviewTimeoutRef.current = null;
    }
    setOnlineCoinFlipReveal(null);
  };

  const handleOnlineCoinFlipMetadata = (event) => {
    const duration = event?.currentTarget?.duration;
    scheduleOnlineCoinFlipClose(duration);
  };

  const playCoinFlipCue = () => {
    audioManagerRef.current?.pauseAmbience();
    audioManagerRef.current?.playSfx('whistle');
  };

  const setLaneNotice = (actor, message) => {
    setLaneNotices((previous) => ({ ...previous, [actor]: message }));
  };

  useEffect(() => {
    onlineRoomCodeRef.current = onlineRoomCode;
  }, [onlineRoomCode]);

  useEffect(() => {
    if (!goalCelebration) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setGoalCelebration(null);
    }, 1872);

    return () => window.clearTimeout(timeoutId);
  }, [goalCelebration]);

  useEffect(() => {
    if (!fieldEventAnimation) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setFieldEventAnimation(null);
    }, FIELD_EVENT_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [fieldEventAnimation]);

  useEffect(() => {
    if (!isTurnCountdownActive) {
      setTurnCountdown(TURN_COUNTDOWN_SECONDS);
      countdownAlertSecondRef.current = null;
      return undefined;
    }

    const deadline = onlineTurnDeadlineAt;
    const initialSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setTurnCountdown(initialSeconds);
    countdownAlertSecondRef.current = initialSeconds;

    const intervalId = window.setInterval(() => {
      const nextSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTurnCountdown(nextSeconds);

      if (
        nextSeconds <= 4 &&
        nextSeconds >= 0 &&
        countdownAlertSecondRef.current !== nextSeconds
      ) {
        countdownAlertSecondRef.current = nextSeconds;
        audioManagerRef.current?.playSfx('countdown');
      }
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [isTurnCountdownActive, onlineTurnDeadlineAt]);

  useEffect(() => {
    if (canUseTouchHandInteraction) {
      return undefined;
    }

    setActiveHandCardIndex(null);
    setDragCardState(null);
    handDragRef.current = null;
    suppressHandClickRef.current = false;
    return undefined;
  }, [canUseTouchHandInteraction]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragSession = handDragRef.current;
      if (!dragSession || event.pointerId !== dragSession.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragSession.startX;
      const deltaY = event.clientY - dragSession.startY;
      const traveledEnough = Math.hypot(deltaX, deltaY) >= HAND_DRAG_START_DISTANCE;
      const shouldStartDrag = canUseTouchHandInteraction && deltaY <= -HAND_DRAG_START_DISTANCE && traveledEnough;
      const cardElement = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-hand-card-index]');
      if (cardElement) {
        const nextIndex = Number(cardElement.getAttribute('data-hand-card-index'));
        if (Number.isInteger(nextIndex)) {
          setActiveHandCardIndex(nextIndex);
        }
      }

      if (!dragSession.isDragging && !shouldStartDrag) {
        return;
      }

      const tableBounds = matchTablePanelRef.current?.getBoundingClientRect?.();
      const isOverBoard = Boolean(
        tableBounds &&
        event.clientX >= tableBounds.left &&
        event.clientX <= tableBounds.right &&
        event.clientY >= tableBounds.top &&
        event.clientY <= tableBounds.bottom
      );

      handDragRef.current = {
        ...dragSession,
        currentX: event.clientX,
        currentY: event.clientY,
        isDragging: true,
        isOverBoard
      };
      setDragCardState({
        card: dragSession.card,
        index: dragSession.index,
        currentX: event.clientX,
        currentY: event.clientY,
        isOverBoard
      });

      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const handlePointerUp = (event) => {
      const dragSession = handDragRef.current;
      if (!dragSession || event.pointerId !== dragSession.pointerId) {
        return;
      }

      const shouldPlay = Boolean(dragSession.isDragging && dragSession.isOverBoard);
      handDragRef.current = null;
      setDragCardState(null);

      if (shouldPlay) {
        suppressHandClickRef.current = true;
        playCardRef.current?.(dragSession.card, dragSession.index, true);
        return;
      }

      window.setTimeout(() => {
        suppressHandClickRef.current = false;
      }, 0);
    };

    const handlePointerCancel = (event) => {
      const dragSession = handDragRef.current;
      if (!dragSession || event.pointerId !== dragSession.pointerId) {
        return;
      }

      handDragRef.current = null;
      setDragCardState(null);
      window.setTimeout(() => {
        suppressHandClickRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [canUseTouchHandInteraction]);

  useEffect(() => {
    if (!isDribbleVideoPlaying) {
      return undefined;
    }

    const videoNode = dribbleVideoRef.current;
    if (!videoNode) {
      return undefined;
    }

    videoNode.currentTime = 0;
    const playPromise = videoNode.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // In some mobile browsers autoplay can be blocked; never keep gameplay locked.
        finishDribbleAnimation();
      });
    }

    const safetyTimeoutId = window.setTimeout(() => {
      finishDribbleAnimation();
    }, 7000);

    return () => window.clearTimeout(safetyTimeoutId);
  }, [isDribbleVideoPlaying]);

  useEffect(() => {
    if (!systemNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSystemNotice('');
    }, 4400);

    return () => window.clearTimeout(timeoutId);
  }, [systemNotice]);

  useEffect(() => {
    if (!laneNotices.player && !laneNotices.opponent) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setLaneNotices({ player: '', opponent: '' });
    }, 4200);

    return () => window.clearTimeout(timeoutId);
  }, [laneNotices.player, laneNotices.opponent]);

  useEffect(() => {
    if (!audioManagerRef.current) {
      audioManagerRef.current = new AudioManager({
        ambienceUrl: ambienceAudio,
        sfxUrls: {
          foul: foulAudio,
          goal: goalAudio
        }
      });
      audioManagerRef.current.setEnabled(true);
    }

    const unlockAudio = () => {
      audioManagerRef.current?.unlock();
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioManagerRef.current?.setEnabled(!audioMuted);
  }, [audioMuted]);

  useEffect(() => {
    if (gameState === 'playing' && !onlineCoinFlipReveal) {
      audioManagerRef.current?.startAmbience();
      return;
    }

    audioManagerRef.current?.stopAmbience();
  }, [gameState, onlineCoinFlipReveal]);

  useEffect(() => () => {
    if (onlineCoinFlipTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipTimeoutRef.current);
      onlineCoinFlipTimeoutRef.current = null;
    }
    if (onlineCoinFlipPreviewTimeoutRef.current) {
      window.clearTimeout(onlineCoinFlipPreviewTimeoutRef.current);
      onlineCoinFlipPreviewTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!aiStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setAiStatus('');
    }, AI_STATUS_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [aiStatus]);

  useEffect(() => () => {
    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!onlineEnabled) {
      if (socketRef.current) {
        onlineDebugLog('disconnecting socket because online mode was disabled');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return undefined;
    }

    const clientId = getPersistentOnlineClientId();
    const socket = io(ONLINE_API_URL, {
      transports: ['websocket', 'polling'],
      auth: { clientId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });
    socketRef.current = socket;
    onlineDebugLog('creating online socket', { apiUrl: ONLINE_API_URL, clientId });

    const manager = socket.io;

    socket.on('connect', () => {
      onlineDebugLog('socket connected', { socketId: socket.id, clientId });
      setOnlineSocketId(socket.id);
      setOnlineError('');
      const currentRoomCode = onlineRoomCodeRef.current;
      if (currentRoomCode) {
        onlineDebugLog('requesting room sync after connect', { roomCode: currentRoomCode });
        socket.emit('room:sync_request', { code: currentRoomCode });
      }
      const pendingAction = pendingOnlineActionRef.current;
      if (pendingAction) {
        onlineDebugLog('flushing pending action after connect', pendingAction);
        socket.emit(pendingAction.event, pendingAction.payload);
        pendingOnlineActionRef.current = null;
      }
    });

    socket.on('server:ready', ({ socketId }) => {
      onlineDebugLog('server ready received', { socketId });
      setOnlineSocketId(socketId);
      const currentRoomCode = onlineRoomCodeRef.current;
      if (currentRoomCode) {
        onlineDebugLog('requesting room sync after server ready', { roomCode: currentRoomCode });
        socket.emit('room:sync_request', { code: currentRoomCode });
      }
    });

    socket.on('room:created', ({ room, youAreHost }) => {
      onlineDebugLog('room created', { roomCode: room?.code, youAreHost });
      setOnlineRoom(room);
      setOnlineRoomCode(room.code);
      setOnlineRole(youAreHost ? 'player' : null);
      setOnlineError('');
    });

    socket.on('room:updated', ({ room }) => {
      onlineDebugLog('room updated', {
        roomCode: room?.code,
        status: room?.status,
        playerCount: room?.playerCount,
        players: room?.players
      });
      setOnlineRoom(room);
      setOnlineRoomCode(room.code);
      const localSocketId = socket.id || onlineSocketId;
      if (localSocketId) {
        const localPlayer = room.players?.find((player) => player.id === localSocketId);
        if (localPlayer) {
          const roleIndex = room.players.findIndex((player) => player.id === localSocketId);
          setOnlineRole(roleIndex === 0 ? 'player' : roleIndex === 1 ? 'opponent' : null);
        }
      }
      setOnlineError('');
    });

    socket.on('match:started', ({ room, matchState }) => {
      onlineDebugLog('match started', {
        roomCode: room?.code,
        role: matchState?.playerRole,
        currentTurn: matchState?.currentTurn,
        possession: matchState?.possession
      });
      setOnlineRoom(room);
      setOnlineRole(matchState.playerRole);
      setShowOnlineCoinChoice(false);
      hydrateFromOnlineState(matchState);
      const swapActor = (actor) => (actor === 'player' ? 'opponent' : actor === 'opponent' ? 'player' : actor);
      const localWinner = matchState.playerRole === 'player'
        ? matchState.lastEvent?.winner
        : swapActor(matchState.lastEvent?.winner);
      const localResult = matchState.lastEvent?.result;
      if (matchState.lastEvent?.type === 'coin_flip' && localWinner && localResult) {
        showOnlineCoinFlipReveal({
          result: localResult,
          invitedChoice: matchState.lastEvent?.invitedChoice ?? null,
          winner: localWinner === 'player'
            ? (matchState.playerName || 'JUGADOR')
            : (matchState.opponentName || 'RIVAL')
        });
      }
    });

    socket.on('match:updated', ({ room, matchState }) => {
      onlineDebugLog('match updated', {
        roomCode: room?.code,
        role: matchState?.playerRole,
        currentTurn: matchState?.currentTurn,
        possession: matchState?.possession,
        pendingDefense: matchState?.pendingDefense,
        pendingShot: matchState?.pendingShot
      });
      setOnlineRoom(room);
      setOnlineRole(matchState.playerRole);
      hydrateFromOnlineState(matchState);
    });

    socket.on('room:error', ({ message }) => {
      onlineDebugLog('room error', { message });
      setOnlineError(message);
      addLog(message);
    });

    socket.on('match:error', ({ message }) => {
      onlineDebugLog('match error', { message });
      setOnlineError(message);
      addLog(message);
    });

    socket.on('match:terminated', ({ message }) => {
      onlineDebugLog('match terminated', { message });
      resetMatch();
      setSystemNotice(message || 'La partida fue terminada.');
    });

    socket.on('session:missing', ({ message, code }) => {
      onlineDebugLog('session missing after reconnect', { message, code });
      resetMatch();
      setSystemNotice(message || 'La sesion online ya no esta disponible.');
    });

    socket.on('disconnect', (reason) => {
      onlineDebugLog('socket disconnected', { reason, roomCode: onlineRoomCode });
      setOnlineError('La conexion online se interrumpio. Intentando reconectar...');
    });

    socket.on('connect_error', (error) => {
      onlineDebugLog('connect error', { message: error?.message });
      setOnlineError('No se pudo conectar con el servidor online.');
    });

    manager.on('reconnect_attempt', (attempt) => {
      onlineDebugLog('reconnect attempt', { attempt });
      setOnlineError(`Reconectando con el servidor online... intento ${attempt}`);
    });

    manager.on('reconnect', (attempt) => {
      onlineDebugLog('socket reconnected', { attempt, socketId: socket.id });
      setOnlineError('');
      setSystemNotice('Conexion online recuperada.');
    });

    manager.on('reconnect_error', (error) => {
      onlineDebugLog('reconnect error', { message: error?.message });
    });

    manager.on('reconnect_failed', () => {
      onlineDebugLog('reconnect failed');
      setOnlineError('No se pudo recuperar la conexion online. Vuelve a entrar a la sala.');
    });

    return () => {
      onlineDebugLog('cleaning up socket listeners');
      manager.off('reconnect_attempt');
      manager.off('reconnect');
      manager.off('reconnect_error');
      manager.off('reconnect_failed');
      socket.off('session:missing');
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [onlineEnabled]);

  const { getHand, hasCardInHand } = engineContext;
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
      return null;
    }

    if (pendingBlindDiscard?.actor === 'opponent') {
      const targetHand = blindDiscardTargetActor === 'player' ? playerHand : opponentHand;
      return targetHand.length > 0
        ? { type: 'blind-discard-target', index: Math.floor(Math.random() * targetHand.length) }
        : null;
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
  const reactionBannerMessage =
    pendingBlindDiscard
      ? pendingBlindDiscard.reason?.toLowerCase?.().includes('tarjeta roja')
        ? `ROJA: ${pendingBlindDiscard.actor === 'player' ? 'JUGADOR' : 'RIVAL'} ELIGE 1 CARTA DEL ${blindDiscardTargetActor === 'player' ? 'JUGADOR' : 'RIVAL'}`
        : `DESCARTE OCULTO: ${pendingBlindDiscard.actor === 'player' ? 'JUGADOR' : 'RIVAL'} ELIGE UNA CARTA DEL ${blindDiscardTargetActor === 'player' ? 'JUGADOR' : 'RIVAL'}`
      : pendingShot?.phase === 'penalty_response'
        ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: PENALTI`
        : pendingShot?.phase === 'offside_var'
          ? `VENTANA DE RESPUESTA DEL ${pendingShot.attacker === 'player' ? 'JUGADOR' : 'RIVAL'}: VAR CONTRA OFFSIDE`
        : pendingShot?.phase === 'save'
          ? `VENTANA DE RESPUESTA DEL ${pendingShot.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: ${pendingShot.allowOffside ? 'OFFSIDE O PARADA' : 'PARADA DEL ARQUERO'}`
            : pendingShot?.phase === 'remate'
            ? `VENTANA DE RESPUESTA DEL ${pendingShot.attacker === 'player' ? 'JUGADOR' : 'RIVAL'}: REMATE`
            : pendingDefense?.defenseCardId === 'red_card_var'
                ? `VENTANA DE RESPUESTA DEL ${pendingDefense.defender === 'player' ? 'JUGADOR' : 'RIVAL'}: VAR`
                  : pendingDefense?.defenseCardId
                    ? `VENTANA DE RESPUESTA DEL ${pendingDefense.possessor === 'player' ? 'JUGADOR' : 'RIVAL'}: ${
                        pendingDefense.defenseCardId === 'ba'
                          ? 'REGATEAR VS BARRIDA'
                          : pendingDefense.defenseCardId === 'fa'
                            ? 'AMARILLA/ROJA VS FALTA'
                            : 'RESPUESTA EN CURSO'
                      }`
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
  const rawStatusBannerMessage = aiStatus || reactionBannerMessage;
  const statusBannerMessage =
    rawStatusBannerMessage && rawStatusBannerMessage.toLowerCase().includes('empieza la jugada')
      ? null
      : rawStatusBannerMessage;
  const playerRedCardStatus =
    sanctions.player?.type === 'red' || redCardPenalty.player > 0
      ? `ROJA: ${redCardPenalty.player || sanctions.player?.turnsRemaining || 0} turnos con 4 cartas`
      : null;
  const opponentRedCardStatus =
    sanctions.opponent?.type === 'red' || redCardPenalty.opponent > 0
      ? `ROJA: ${redCardPenalty.opponent || sanctions.opponent?.turnsRemaining || 0} turnos con 4 cartas`
      : null;
  const comboWindow =
    isDribbleVideoPlaying
      ? null
      : pendingCombo?.type === 'chilena_followup'
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
    const autoCardsFromTable = activePlay.filter((card) =>
      typeof card?.id === 'string' && card.id.endsWith('_auto')
    );
    if (autoCardsFromTable.length > 0) {
      setDiscardPile((previous) => [...autoCardsFromTable, ...previous]);
      registerDiscardShowcaseCards(currentTurn ?? possession ?? 'player', autoCardsFromTable);
    }

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

  const applyEngineStatePatch = (statePatch) => {
    if (!statePatch) {
      return;
    }

    if ('activePlay' in statePatch) {
      setActivePlay(statePatch.activePlay);
    }

    if ('pendingCombo' in statePatch) {
      setPendingCombo(statePatch.pendingCombo);
    }

    if ('pendingDefense' in statePatch) {
      setPendingDefense(statePatch.pendingDefense);
    }

    if ('pendingShot' in statePatch) {
      setPendingShot(statePatch.pendingShot);
    }

    if ('counterAttackReady' in statePatch) {
      setCounterAttackReady(statePatch.counterAttackReady);
    }

    if ('hasActedThisTurn' in statePatch) {
      setHasActedThisTurn(statePatch.hasActedThisTurn);
    }

    if ('discardMode' in statePatch) {
      setDiscardMode(statePatch.discardMode);
    }

    if ('selectedForDiscard' in statePatch) {
      setSelectedForDiscard(statePatch.selectedForDiscard);
    }

    if ('currentTurn' in statePatch) {
      setCurrentTurn(statePatch.currentTurn);
    }

    if ('possession' in statePatch) {
      setPossession(statePatch.possession);
    }
  };

  const appendCardToTable = (card, actor = null) => {
    if (!card) {
      return;
    }

    setTablePlay((previousPlay) => [...previousPlay, { ...card, tableActor: actor ?? card.tableActor ?? null }]);
  };

  const shouldResetTableForNewSequence = (actor, playType) =>
    TABLE_SEQUENCE_START_TYPES.has(playType) &&
    possession === actor &&
    !pendingShot &&
    !pendingDefense &&
    !pendingBlindDiscard &&
    !pendingCombo &&
    !hasActedThisTurn &&
    tablePlay.length > 0;

  useEffect(() => {
    const previousPossession = previousPossessionRef.current;

    if (previousPossession && possession && previousPossession !== possession) {
      setTablePlay((previousPlay) => (previousPlay.length <= 2 ? previousPlay : previousPlay.slice(-2)));
    }

    previousPossessionRef.current = possession;
  }, [possession]);

  const hydrateFromOnlineState = (matchState) => {
    const swapActor = (actor) => (actor === 'player' ? 'opponent' : actor === 'opponent' ? 'player' : actor);
    const buildShowcaseFromActions = (actions = []) => {
      const mapped = {
        player: { current: [], archive: [] },
        opponent: { current: [], archive: [] }
      };

      for (const action of actions) {
        const actor = action.actor === 'player' ? 'player' : 'opponent';
        const baseCard = withCardImage(action.card);
        const visualCard = {
          ...baseCard,
          visualId: `${action.id ?? action.at ?? Date.now()}-${baseCard?.id ?? 'card'}`
        };

        if (mapped[actor].current.length < 4) {
          mapped[actor].current.push(visualCard);
        } else if (mapped[actor].archive.length < 4) {
          mapped[actor].archive.push(visualCard);
        }
      }

      return mapped;
    };

    const isLocalPlayerOne = matchState.playerRole === 'player';
    const localMatchState = isLocalPlayerOne
      ? matchState
      : {
          ...matchState,
          playerScore: matchState.opponentScore,
          opponentScore: matchState.playerScore,
          sanctions: {
            player: matchState.sanctions?.opponent ?? null,
            opponent: matchState.sanctions?.player ?? null
          },
          redCardPenalty: {
            player: matchState.redCardPenalty?.opponent ?? 0,
            opponent: matchState.redCardPenalty?.player ?? 0
          },
          possession: swapActor(matchState.possession),
          currentTurn: swapActor(matchState.currentTurn),
          pendingShot: matchState.pendingShot
            ? {
                ...matchState.pendingShot,
                attacker: swapActor(matchState.pendingShot.attacker),
                defender: swapActor(matchState.pendingShot.defender)
              }
            : null,
          pendingDefense: matchState.pendingDefense
            ? {
                ...matchState.pendingDefense,
                defender: swapActor(matchState.pendingDefense.defender),
                possessor: swapActor(matchState.pendingDefense.possessor)
              }
            : null,
          pendingCombo: matchState.pendingCombo
            ? {
                ...matchState.pendingCombo,
                actor: swapActor(matchState.pendingCombo.actor)
              }
            : null,
          pendingBlindDiscard: matchState.pendingBlindDiscard
            ? {
                ...matchState.pendingBlindDiscard,
                actor: swapActor(matchState.pendingBlindDiscard.actor),
                targetActor: swapActor(matchState.pendingBlindDiscard.targetActor),
                returnTurnTo: swapActor(matchState.pendingBlindDiscard.returnTurnTo)
              }
            : null,
          bonusTurnFor: swapActor(matchState.bonusTurnFor),
          matchWinner: swapActor(matchState.matchWinner),
          recentActions: (matchState.recentActions || []).map((action) => ({
            ...action,
            actor: swapActor(action.actor)
          })),
          lastEvent: matchState.lastEvent
            ? {
                ...matchState.lastEvent,
                actor: swapActor(matchState.lastEvent.actor),
                scorer: swapActor(matchState.lastEvent.scorer),
                winner: swapActor(matchState.lastEvent.winner)
              }
            : null
        };

    const visiblePlayerHand = withCardsImage(localMatchState.yourHand || []);
    const visibleOpponentHand = Array.from(
      { length: localMatchState.opponentHandCount || 0 },
      (_, index) => ({
        id: `hidden-opponent-${index}`,
        name: 'Carta oculta',
        color: 'bg-slate-800'
      })
    );

    setGameState(localMatchState.gameState || 'playing');
    setPlayerHand(visiblePlayerHand);
    setOpponentHand(visibleOpponentHand);
    setDeck(withCardsImage(localMatchState.deck || []));
    setDiscardPile(withCardsImage(localMatchState.discardPile || []));
    setPlayerScore(localMatchState.playerScore ?? 0);
    setOpponentScore(localMatchState.opponentScore ?? 0);
    setSanctions(localMatchState.sanctions || { player: null, opponent: null });
    setRedCardPenalty(localMatchState.redCardPenalty || { player: 0, opponent: 0 });
    setPossession(localMatchState.possession ?? null);
    setCurrentTurn(localMatchState.currentTurn ?? null);
    setPendingShot(localMatchState.pendingShot ? {
      ...localMatchState.pendingShot,
      card: withCardImage(localMatchState.pendingShot.card)
    } : null);
    setPendingDefense(localMatchState.pendingDefense ? {
      ...localMatchState.pendingDefense,
      card: withCardImage(localMatchState.pendingDefense.card)
    } : null);
    setPendingCombo(localMatchState.pendingCombo ?? null);
    setPendingBlindDiscard(localMatchState.pendingBlindDiscard ?? null);
    setActivePlay(withCardsImage(localMatchState.activePlay || []));
    setTablePlay(withCardsImage(localMatchState.tablePlay || localMatchState.activePlay || []));
    setBonusTurnFor(localMatchState.bonusTurnFor ?? null);
    setMatchWinner(localMatchState.matchWinner ?? null);
    setHasActedThisTurn(localMatchState.hasActedThisTurn ?? false);
    setCounterAttackReady(localMatchState.counterAttackReady ?? false);
    setOnlineTurnDeadlineAt(
      localMatchState.turnDeadlineAt ? new Date(localMatchState.turnDeadlineAt).getTime() : null
    );
    setPlayerDisplayName((localMatchState.playerName || 'Jugador').toUpperCase());
    setOpponentDisplayName((localMatchState.opponentName || 'Rival').toUpperCase());
    const localPlayerLabel = (localMatchState.playerName || 'Jugador').toUpperCase();
    const localOpponentLabel = (localMatchState.opponentName || 'Rival').toUpperCase();

    if (Array.isArray(localMatchState.recentActions)) {
      setDiscardShowcase(buildShowcaseFromActions(localMatchState.recentActions));
      const laneNotice = buildLaneNoticeFromRecentActions(
        localMatchState.recentActions,
        localPlayerLabel,
        localOpponentLabel
      );
      if (laneNotice?.id && laneNotice.id !== lastRecentActionIdRef.current) {
        lastRecentActionIdRef.current = laneNotice.id;
        setLaneNotice(laneNotice.actor, laneNotice.message);
        const latestAction = localMatchState.recentActions[0];
        if (latestAction?.type === 'play' && latestAction?.card?.id === DRIBBLE_CARD_ID) {
          queueActionVideo(oleVideo);
        }
        if (
          latestAction?.type === 'play' &&
          latestAction?.card?.id === 'tg' &&
          localMatchState.recentActions?.[1]?.card?.id === 'pa' &&
          localMatchState.recentActions?.[2]?.card?.id === CHILENA_CARD_ID &&
          localMatchState.recentActions?.[1]?.actor === latestAction.actor &&
          localMatchState.recentActions?.[2]?.actor === latestAction.actor
        ) {
          queueActionVideo(chilenaVideo);
        }
        if (latestAction?.type === 'discard') {
          audioManagerRef.current?.playSfx('card');
        } else if (latestAction?.card) {
          playCardSfx(latestAction.card);
        }
      }
    }

    if (localMatchState.lastEvent?.id && localMatchState.lastEvent.id !== lastOnlineEventRef.current) {
      lastOnlineEventRef.current = localMatchState.lastEvent.id;
      const event = localMatchState.lastEvent;

      if (event.type === 'goal') {
        audioManagerRef.current?.playSfx('goal');
        setGoalCelebration({
          scorer: event.scorer,
          text: `GOOL ${event.scorer === 'player' ? localPlayerLabel : localOpponentLabel}`
        });
      }

      if (event.type === 'coin_flip') {
        playCoinFlipCue();
        addLog(`Moneda: ${event.result}. Inicia ${event.winner === 'player' ? localPlayerLabel : localOpponentLabel}.`);
        showOnlineCoinFlipReveal({
          result: event.result,
          invitedChoice: event.invitedChoice ?? null,
          winner: event.winner === 'player' ? localPlayerLabel : localOpponentLabel
        });
      }

      if (event.type === 'barrida_success') {
        setFieldEventAnimation({
          actor: event.actor,
          text: `${event.actor === 'player' ? localPlayerLabel : localOpponentLabel} recupera con Barrida`
        });
      }

      if (event.type === 'save_success') {
        queueActionVideo(saveVideo);
      }

      if (event.type === 'turn_timeout') {
        setSystemNotice(`${event.actor === 'player' ? localPlayerLabel : localOpponentLabel} perdio el turno por tiempo.`);
      }

      if (event.type === 'turn_timeout_loss') {
        setSystemNotice(`${event.actor === 'player' ? localPlayerLabel : localOpponentLabel} perdio por agotar el tiempo dos veces seguidas.`);
      }
    }
  };

  const connectOnline = () => {
    if (socketRef.current?.connected) {
      return socketRef.current;
    }

    setOnlineEnabled(true);
    return socketRef.current;
  };

  const emitOnlineEvent = (event, payload) => {
    const socket = connectOnline();
    onlineDebugLog('queueing/emitting online event', {
      event,
      payload,
      connected: Boolean(socket?.connected)
    });

    if (socket?.connected) {
      socket.emit(event, payload);
      return;
    }

    pendingOnlineActionRef.current = { event, payload };
    socketRef.current?.connect?.();
  };

  const createOnlineRoom = () => {
    const normalizedName = onlinePlayerName.trim() || 'Jugador 1';
    setOnlinePlayerName(normalizedName);
    emitOnlineEvent('room:create', { playerName: normalizedName });
  };

  const joinOnlineRoom = () => {
    const normalizedName = onlinePlayerName.trim() || 'Jugador 1';
    const normalizedCode = onlineJoinCode.trim().toUpperCase();
    if (!normalizedCode) {
      setOnlineError('Ingresa un codigo de sala.');
      return;
    }
    setOnlinePlayerName(normalizedName);
    setOnlineJoinCode(normalizedCode);
    emitOnlineEvent('room:join', {
      code: normalizedCode,
      playerName: normalizedName
    });
  };

  const leaveOnlineRoom = () => {
    onlineDebugLog('leaving online room', { roomCode: onlineRoomCode });
    socketRef.current?.emit('room:leave');
    pendingOnlineActionRef.current = null;
    lastOnlineEventRef.current = null;
    lastRecentActionIdRef.current = null;
    lastReactionHintRef.current = '';
    setOnlineEnabled(false);
    setOnlineRoomCode('');
    setOnlineRoom(null);
    setOnlineRole(null);
    setShowOnlineCoinChoice(false);
    setOnlineError('');
    clearDribbleAnimation();
  };

  const copyOnlineRoomCode = async () => {
    const codeToCopy = onlineRoomCode?.trim();

    if (!codeToCopy) {
      setOnlineError('No hay un codigo de sala para copiar.');
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeToCopy);
      } else {
        const tempInput = document.createElement('textarea');
        tempInput.value = codeToCopy;
        tempInput.setAttribute('readonly', '');
        tempInput.style.position = 'absolute';
        tempInput.style.left = '-9999px';
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }

      setSystemNotice('Codigo de invitacion copiado.');
      setOnlineError('');
    } catch (error) {
      setOnlineError('No se pudo copiar el codigo de sala.');
    }
  };

  const startOnlineMatchWithChoice = (choice) => {
    if (!socketRef.current) {
      setOnlineError('No hay conexion con el servidor online.');
      return;
    }

    onlineDebugLog('starting online match', { choice, roomCode: onlineRoomCode });
    socketRef.current.emit('match:start', { choice });
    setShowOnlineCoinChoice(false);
  };

  const finishMatchAndReturnToMenu = () => {
    if (onlineEnabled) {
      socketRef.current?.emit('match:terminate');
      return;
    }
    resetMatch();
  };

  const resetMatch = () => {
    pendingOnlineActionRef.current = null;
    lastOnlineEventRef.current = null;
    lastRecentActionIdRef.current = null;
    lastReactionHintRef.current = '';
    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
      coinFlipFinalizeTimeoutRef.current = null;
    }
    coinFlipOutcomeRef.current = null;
    coinFlipResolvedRef.current = false;
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
    setTablePlay([]);
    setGoalCelebration(null);
    setMatchWinner(null);
    setAiMode(false);
    setOnlineEnabled(false);
    setOnlineRoomCode('');
    setOnlineJoinCode('');
    setOnlineRoom(null);
    setOnlineRole(null);
    setShowOnlineCoinChoice(false);
    setOnlineError('');
    setPlayerDisplayName('JUGADOR');
    setOpponentDisplayName('RIVAL');
    setFieldEventAnimation(null);
    setOnlineCoinFlipReveal(null);
    setOnlineTurnDeadlineAt(null);
    setSystemNotice('');
    setGameLog(['Posesion persistente activada']);
    clearDribbleAnimation();
    clearTransientState();
  };

  useEffect(() => {
    const getActorLabel = (actor) => (actor === 'player' ? playerDisplayName : opponentDisplayName);
    let nextHint = null;

    if (pendingBlindDiscard?.actor) {
      const chooserLabel = getActorLabel(pendingBlindDiscard.actor);
      const targetLabel = getActorLabel(blindDiscardTargetActor);
      const isRedCardDiscard = pendingBlindDiscard.reason?.toLowerCase?.().includes('tarjeta roja');
      nextHint = {
        key: `blind-${pendingBlindDiscard.actor}-${blindDiscardTargetActor}-${pendingBlindDiscard.reason || ''}`,
        actor: pendingBlindDiscard.actor,
        text: isRedCardDiscard
          ? `${chooserLabel} elige 1 carta para descarte de ${targetLabel}. Roja activa por 3 turnos con 4 cartas.`
          : `${chooserLabel} elige 1 carta para descarte de ${targetLabel}.`
      };
    } else if (pendingDefense?.defenseCardId === 'ba') {
      nextHint = {
        key: `defense-ba-${pendingDefense.possessor}`,
        actor: pendingDefense.possessor,
        text: `${getActorLabel(pendingDefense.possessor)} Puede Regatear.`
      };
    } else if (pendingDefense?.defenseCardId === 'fa') {
      nextHint = {
        key: `defense-fa-${pendingDefense.possessor}`,
        actor: pendingDefense.possessor,
        text: `${getActorLabel(pendingDefense.possessor)} Puede sancionar con tarjeta.`
      };
    } else if (pendingDefense?.defenseCardId === 'red_card_var') {
      nextHint = {
        key: `defense-var-${pendingDefense.defender}`,
        actor: pendingDefense.defender,
        text: `${getActorLabel(pendingDefense.defender)} Puede revisar la jugada con VAR.`
      };
    } else if (pendingShot?.phase === 'penalty_response') {
      nextHint = {
        key: `shot-penalty-${pendingShot.defender}`,
        actor: pendingShot.defender,
        text: `${getActorLabel(pendingShot.defender)} Puede revisar la jugada con VAR o Parada Arquero.`
      };
    } else if (pendingShot?.phase === 'save') {
      nextHint = {
        key: `shot-save-${pendingShot.defender}-${pendingShot.allowOffside ? 'off' : 'nooff'}`,
        actor: pendingShot.defender,
        text: pendingShot.allowOffside
          ? `${getActorLabel(pendingShot.defender)} Revisa Offside o Parada Arquero.`
          : `${getActorLabel(pendingShot.defender)} Puede usar Parada Arquero.`
      };
    } else if (pendingShot?.phase === 'offside_var') {
      nextHint = {
        key: `shot-offside-var-${pendingShot.attacker}`,
        actor: pendingShot.attacker,
        text: `${getActorLabel(pendingShot.attacker)} Puede revisar el Offside con el VAR.`
      };
    } else if (pendingShot?.phase === 'remate') {
      nextHint = {
        key: `shot-remate-${pendingShot.attacker}`,
        actor: pendingShot.attacker,
        text: `${getActorLabel(pendingShot.attacker)} Puede jugar un Remate`
      };
    }

    if (!nextHint) {
      lastReactionHintRef.current = '';
      return;
    }

    if (lastReactionHintRef.current === nextHint.key) {
      return;
    }

    lastReactionHintRef.current = nextHint.key;
    setFieldEventAnimation({ actor: nextHint.actor, text: nextHint.text });
  }, [pendingBlindDiscard, pendingDefense, pendingShot, playerDisplayName, opponentDisplayName, blindDiscardTargetActor]);

  const consumeCard = (actor, index, card) => {
    const currentHand = getHand(actor);
    const nextHand = currentHand.filter((_, handIndex) => handIndex !== index);
    const drawResult = drawCardsFromPools(
      deck,
      discardPile,
      Math.max(0, getHandLimit(redCardPenalty, actor) - nextHand.length),
      [card]
    );

    setDiscardPile(drawResult.discardPile);
    registerDiscardShowcaseCards(actor, [card]);
    setDeck(drawResult.deck);
    setLaneNotice(actor, `${actor === 'player' ? 'Jugador' : 'Rival'} juega ${card.name}.`);
    playCardSfx(card);

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

  const openBlindDiscard = (actor, targetActor, reason, returnTurnTo) => {
    const blindDiscardPlan = getBlindDiscardPlan({
      actor,
      targetActor,
      targetHandLength: getHand(targetActor).length,
      reason,
      returnTurnTo
    });

    if (!blindDiscardPlan.allowed) {
      return false;
    }

    setPendingBlindDiscard(blindDiscardPlan.pendingBlindDiscard);
    setCurrentTurn(blindDiscardPlan.nextTurn);
    setHasActedThisTurn(blindDiscardPlan.hasActedThisTurn);
    setDiscardMode(blindDiscardPlan.discardMode);
    setSelectedForDiscard(blindDiscardPlan.selectedForDiscard);
    addLog(blindDiscardPlan.logMessage);
    return true;
  };

  const resolveBlindDiscard = (actor, index) => {
    const targetActor = pendingBlindDiscard?.targetActor ?? pendingBlindDiscard?.actor;
    if (!targetActor) {
      return;
    }

    const blindDiscardResolution = getBlindDiscardResolutionPlan({
      actor,
      index,
      targetHand: getHand(targetActor),
      pendingBlindDiscard
    });

    if (!blindDiscardResolution.allowed) {
      return;
    }

    setDiscardPile((previousPile) => [blindDiscardResolution.discardedCard, ...previousPile]);
    registerDiscardShowcaseCards(blindDiscardResolution.targetActor, [blindDiscardResolution.discardedCard]);
    setLaneNotice(blindDiscardResolution.targetActor, blindDiscardResolution.laneNotice);

    if (blindDiscardResolution.targetActor === 'player') {
      setPlayerHand(blindDiscardResolution.nextTargetHand);
    } else {
      setOpponentHand(blindDiscardResolution.nextTargetHand);
    }

    setPendingBlindDiscard(null);
    setCurrentTurn(blindDiscardResolution.nextTurn);
    setHasActedThisTurn(blindDiscardResolution.hasActedThisTurn);
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
      Math.max(0, getHandLimit(redCardPenalty, actor) - newHand.length),
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
    const playerDrawResult = drawCardsFromPools(
      deck,
      discardPile,
      Math.max(0, getHandLimit(redCardPenalty, 'player') - playerHand.length)
    );
    const opponentDrawResult = drawCardsFromPools(
      playerDrawResult.deck,
      playerDrawResult.discardPile,
      Math.max(0, getHandLimit(redCardPenalty, 'opponent') - opponentHand.length)
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
    const progressPlan = getRedCardProgressPlan({
      actor,
      currentTurns: redCardPenalty[actor]
    });

    if (!progressPlan.shouldApply) {
      return;
    }

    consumeRedCardTurn(actor);

    if (progressPlan.shouldClearSanction) {
      clearSanctionFor(actor);
      refillActorHandToLimit(actor, progressPlan.refillTo);
      return;
    }

    setSanctionFor(actor, progressPlan.nextSanction);
  };

  const scoreGoal = (scorer, reason) => {
    const goalOutcome = getGoalOutcome({
      scorer,
      playerScore,
      opponentScore,
      reason
    });

    setPlayerScore(goalOutcome.nextPlayerScore);
    setOpponentScore(goalOutcome.nextOpponentScore);
    setGoalCelebration({
      scorer: goalOutcome.scorer,
      text: goalOutcome.celebrationText
    });
    audioManagerRef.current?.playSfx('goal');
    setLaneNotice(scorer, goalOutcome.laneNotice);

    applyRedCardTurnProgress(scorer);
    clearTransientState();
    setHasActedThisTurn(false);

    if (goalOutcome.isMatchFinished) {
      setMatchWinner(scorer);
      setGameState('finished');
      setPossession(null);
      setCurrentTurn(null);
      addLog(goalOutcome.logMessage);
      return;
    }

    setPossession(goalOutcome.nextActor);
    setCurrentTurn(goalOutcome.nextActor);
    addLog(goalOutcome.logMessage);
  };

  const startShotResolution = (attacker, shotType) => {
    const defender = getOpponent(attacker);
    const shotPlan = getShotResolutionPlan({
      attacker,
      shotType,
      defenderHasVar: hasCardInHand(defender, 'var'),
      defenderHasArquero: hasCardInHand(defender, 'paq'),
      defenderHasOffside: hasCardInHand(defender, 'off')
    });

    setActivePlay([]);
    setCounterAttackReady(false);

    if (shotPlan.type === 'goal') {
      scoreGoal(shotPlan.scorer, shotPlan.reason);
      return;
    }

    setPendingShot(shotPlan.pendingShot);
    setCurrentTurn(shotPlan.nextTurn);
    setHasActedThisTurn(false);
    setDiscardMode(false);
    setSelectedForDiscard([]);
    addLog(shotPlan.logMessage);
  };

  const startDefenseResolution = (defender, defenseCard) => {
    const possessor = getOpponent(defender);
    const defensePlan = getDefenseResolutionPlan({
      defender,
      defenseCardId: defenseCard.id,
      possessorHasRegate: hasCardInHand(possessor, 'reg'),
      possessorHasYellowCard: hasCardInHand(possessor, 'ta'),
      possessorHasRedCard: hasCardInHand(possessor, 'tr')
    });

    if (defensePlan.type === 'pending-defense') {
      setPendingDefense(defensePlan.pendingDefense);
      setCurrentTurn(defensePlan.nextTurn);
      setHasActedThisTurn(false);
      setDiscardMode(false);
      setSelectedForDiscard([]);
      addLog(defensePlan.logMessage);
      return;
    }

    clearTransientState();
    setPossession(defensePlan.nextPossession);
    setCurrentTurn(defensePlan.nextTurn);
    setHasActedThisTurn(true);

    if (defensePlan.clearActivePlay) {
      setActivePlay([]);
    }

    if (defensePlan.pendingCombo) {
      setPendingCombo(defensePlan.pendingCombo);
    }

    if (!onlineEnabled && defenseCard.id === GOALKEEPER_SAVE_CARD_ID) {
      queueActionVideo(saveVideo);
    }

    addLog(defensePlan.logMessage);
  };

  const handleCoinFlip = (choice) => {
    if (coinFlipState.isFlipping) {
      return;
    }

    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
      coinFlipFinalizeTimeoutRef.current = null;
    }

    const result = Math.random() > 0.5 ? 'Cara' : 'Sello';
    const winner = choice === result ? 'player' : 'opponent';
    coinFlipOutcomeRef.current = { choice, result, winner };
    coinFlipResolvedRef.current = false;

    setCoinFlipState({
      choice,
      result: null,
      winner,
      isFlipping: true
    });
    setCoinFlipPlaybackId((previous) => previous + 1);
    playCoinFlipCue();
  };

  const scheduleCoinFlipFinalize = () => {
    if (!coinFlipOutcomeRef.current || coinFlipResolvedRef.current) {
      return;
    }

    const durationSeconds = coinFlipVideoRef.current?.duration;
    const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.ceil(durationSeconds * 1000) + 120
      : 7000;

    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
    }

    coinFlipFinalizeTimeoutRef.current = window.setTimeout(() => {
      finalizeCoinFlip();
    }, durationMs);
  };

  const finalizeCoinFlip = () => {
    const outcome = coinFlipOutcomeRef.current;

    if (!outcome || coinFlipResolvedRef.current) {
      return;
    }
    coinFlipResolvedRef.current = true;

    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
      coinFlipFinalizeTimeoutRef.current = null;
    }

    setCoinFlipState((previous) => ({
      ...previous,
      result: outcome.result,
      winner: outcome.winner,
      isFlipping: false
    }));
    setPossession(outcome.winner);
    setCurrentTurn(outcome.winner);
    setGameState('dealing');
    playCoinFlipCue();
    addLog(`Salio ${outcome.result}. El ${outcome.winner === 'player' ? 'Jugador' : 'Rival'} tiene el balon.`);
  };

  const handleDeal = () => {
    if (onlineEnabled && socketRef.current) {
      socketRef.current.emit('match:start');
      return;
    }

    if (coinFlipFinalizeTimeoutRef.current) {
      window.clearTimeout(coinFlipFinalizeTimeoutRef.current);
      coinFlipFinalizeTimeoutRef.current = null;
    }
    coinFlipOutcomeRef.current = null;
    coinFlipResolvedRef.current = false;
    const matchSnapshot = createLocalMatchSnapshot({
      startingPlayer: coinFlipState.winner,
      deckDefinition: DECK_DEFINITION
    });
    setDiscardShowcase({
      player: { current: [], archive: [] },
      opponent: { current: [], archive: [] }
    });
    setDiscardShowcasePendingArchive(false);
    setLaneNotices({ player: '', opponent: '' });
    setPlayerHand(withCardsImage(matchSnapshot.playerHand));
    setOpponentHand(withCardsImage(matchSnapshot.opponentHand));
    setDeck(withCardsImage(matchSnapshot.deck));
    setDiscardPile(withCardsImage(matchSnapshot.discardPile));
    setPlayerScore(matchSnapshot.playerScore);
    setOpponentScore(matchSnapshot.opponentScore);
    setSanctions(matchSnapshot.sanctions);
    setRedCardPenalty(matchSnapshot.redCardPenalty);
    setPossession(matchSnapshot.possession);
    setCurrentTurn(matchSnapshot.currentTurn);
    setPendingShot(matchSnapshot.pendingShot);
    setPendingDefense(matchSnapshot.pendingDefense);
    setPendingCombo(matchSnapshot.pendingCombo);
    setPendingBlindDiscard(matchSnapshot.pendingBlindDiscard);
    setActivePlay(matchSnapshot.activePlay);
    setTablePlay([]);
    setBonusTurnFor(matchSnapshot.bonusTurnFor);
    setGameState(matchSnapshot.gameState);
    setPlayerDisplayName('JUGADOR');
    setOpponentDisplayName('RIVAL');
  };

  const handleEndTurnButtonClick = () => {
    if (isDribbleVideoPlaying) {
      return;
    }
    audioManagerRef.current?.playSfx('ui_end_turn');
    endTurn();
  };

  const handleDiscardButtonClick = () => {
    if (isDribbleVideoPlaying) {
      return;
    }
    audioManagerRef.current?.playSfx('ui_discard');
    handleDiscard();
  };

  const endTurn = () => {
    if (isDribbleVideoPlaying) {
      return;
    }
    if (onlineEnabled && socketRef.current) {
      socketRef.current.emit('match:end_turn');
      return;
    }

    const endTurnAction = applyEndTurnAction({
      pendingBlindDiscard,
      pendingCombo,
      pendingShot,
      pendingDefense,
      currentTurn,
      bonusTurnFor,
      possession,
      redCardPenalty
    });

    if (!endTurnAction.ok) {
      addLog(endTurnAction.logMessage);
      return;
    }

    if (endTurnAction.type === 'no-response') {
      const noResponsePlan = endTurnAction.resolution;

      if (noResponsePlan?.type === 'goal') {
        scoreGoal(noResponsePlan.scorer, noResponsePlan.reason);
        return;
      }

      if (noResponsePlan?.type === 'turn-change') {
        if (noResponsePlan.clearTransientState) {
          clearTransientState();
        }

        setPossession(noResponsePlan.nextPossession);
        setCurrentTurn(noResponsePlan.nextTurn);
        addLog(noResponsePlan.logMessage);
        return;
      }

      if (noResponsePlan?.type === 'pending-defense-release') {
        setPendingDefense(null);
        setCurrentTurn(noResponsePlan.nextTurn);
        setHasActedThisTurn(noResponsePlan.hasActedThisTurn);
        addLog(noResponsePlan.logMessage);
        return;
      }
    }

    const endTurnFlowPlan = endTurnAction.resolution;

    if (endTurnFlowPlan.keepsTurn) {
      setBonusTurnFor(null);
      consumeSanctionTurn(endTurnFlowPlan.opponentActor);
    }

    if (endTurnFlowPlan.shouldApplyRedCardProgress) {
      applyRedCardTurnProgress(endTurnFlowPlan.actor);
    }

    setDiscardShowcasePendingArchive(true);
    setCurrentTurn(endTurnFlowPlan.nextActor);
    setHasActedThisTurn(false);
    setSelectedForDiscard([]);
    setDiscardMode(false);
    addLog(endTurnFlowPlan.logMessage);
  };

  const handleDiscard = () => {
    if (isDribbleVideoPlaying) {
      return;
    }
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

    if (onlineEnabled && socketRef.current) {
      socketRef.current.emit('match:discard', { indexes: selectedForDiscard });
      setDiscardMode(false);
      setSelectedForDiscard([]);
      return;
    }

    executeDiscard(currentTurn, selectedForDiscard);
  };

  const toggleDiscardSelection = (event, index) => {
    event?.stopPropagation();

    if (isDribbleVideoPlaying || hasActedThisTurn || !discardMode) {
      return;
    }

    if (selectedForDiscard.includes(index)) {
      setSelectedForDiscard((previous) => previous.filter((selectedIndex) => selectedIndex !== index));
      return;
    }

    setSelectedForDiscard((previous) => [...previous, index]);
  };

  const handlePlayerCardPointerDown = (event, card, index) => {
    lastHandPointerTypeRef.current = event.pointerType || 'mouse';
    setActiveHandCardIndex(index);

    if (!canUseTouchHandInteraction) {
      return;
    }

    handDragRef.current = {
      pointerId: event.pointerId,
      card,
      index,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      isDragging: false,
      isOverBoard: false
    };
  };

  const handlePlayerCardPointerEnter = (index) => {
    if (handDragRef.current?.isDragging) {
      return;
    }

    setActiveHandCardIndex(index);
  };

  const handlePlayerHandLeave = () => {
    if (handDragRef.current?.isDragging) {
      return;
    }

    setActiveHandCardIndex(null);
  };

  const handlePlayerCardClick = (event, card, index) => {
    if (suppressHandClickRef.current) {
      suppressHandClickRef.current = false;
      event?.preventDefault?.();
      return;
    }

    setActiveHandCardIndex(index);

    if (discardMode) {
      toggleDiscardSelection(event, index);
      return;
    }

    if (lastHandPointerTypeRef.current === 'touch' || lastHandPointerTypeRef.current === 'pen') {
      return;
    }

    playCard(card, index, true);
  };

  const executePlayCard = (card, index, isFromPlayer, options = {}) => {
    if (onlineEnabled && socketRef.current) {
      socketRef.current.emit('match:play_card', { index });
      return;
    }

    const { skipSuccessAnimation = false } = options;
    const actor = isFromPlayer ? 'player' : 'opponent';

    const playCardAction = applyPlayCardAction({
      state: {
        cardIndex: index,
        playerHand,
        opponentHand,
        activePlay,
        possession,
        currentTurn,
        pendingShot,
        pendingDefense,
        pendingBlindDiscard,
        pendingCombo,
        hasActedThisTurn,
        bonusTurnFor,
        redCardPenalty,
        counterAttackReady
      },
      actor,
      card,
      selectedForDiscardCount: selectedForDiscard.length
    });

    if (!playCardAction.ok) {
      if (playCardAction.logMessage) {
        addLog(playCardAction.logMessage);
      }
      return;
    }

    if (shouldResetTableForNewSequence(actor, playCardAction.type)) {
      setTablePlay([]);
    }

    if (!skipSuccessAnimation && card.id === DRIBBLE_CARD_ID) {
      queueActionVideo(oleVideo, () => executePlayCard(card, index, isFromPlayer, { skipSuccessAnimation: true }));
      return;
    }

    if (playCardAction.type === 'resolve-blind-discard') {
      resolveBlindDiscard(actor, index);
      return;
    }

    if (playCardAction.type === 'red-card-var-response') {
      const redCardVarPlan = playCardAction.plan;

      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      clearSanctionFor(redCardVarPlan.clearSanctionFor);
      if (redCardVarPlan.clearTransientState) {
        setPendingShot(null);
        setPendingDefense(null);
        setPendingCombo(null);
        setBonusTurnFor(null);
        setCounterAttackReady(false);
      }
      applyEngineStatePatch(playCardAction.statePatch);
      addLog(redCardVarPlan.logMessage);
      return;
    }

    if (playCardAction.type === 'defense-response') {
      const defenseResponsePlan = playCardAction.plan;
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);

      if (defenseResponsePlan.type === 'await-var') {
        applyEngineStatePatch(playCardAction.statePatch);
        addLog(defenseResponsePlan.logMessage);
        return;
      }

      if (defenseResponsePlan.type === 'resume-play') {
        applyEngineStatePatch(playCardAction.statePatch);
        addLog(defenseResponsePlan.logMessage);
        return;
      }

      applyEngineStatePatch(playCardAction.statePatch);

      const penaltyResponsePlan = getCardPenaltyResponsePlan({
        actor,
        defender: pendingDefense.defender,
        cardId: card.id
      });

      setBonusTurnFor(penaltyResponsePlan.bonusTurnFor);
      setPossession(penaltyResponsePlan.nextPossession);
      setCurrentTurn(penaltyResponsePlan.nextTurn);
      setSanctionFor(penaltyResponsePlan.sanctionActor, penaltyResponsePlan.sanction);

      if (penaltyResponsePlan.type === 'yellow') {
        addLog(penaltyResponsePlan.logMessage);
        return;
      }

      openBlindDiscard(
        actor,
        pendingDefense.defender,
        penaltyResponsePlan.blindDiscardReason,
        actor
      );
      setRedCardPenalty((previous) => ({ ...previous, [pendingDefense.defender]: penaltyResponsePlan.penaltyTurns }));
      addLog(penaltyResponsePlan.logMessage);
      return;
    }

    if (playCardAction.type === 'penalty-response') {
      const penaltyResponsePlan = playCardAction.plan;
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);

      if (penaltyResponsePlan.type === 'turn-change') {
        if (penaltyResponsePlan.clearTransientState) {
          setPendingShot(null);
          setPendingDefense(null);
          setPendingCombo(null);
          setBonusTurnFor(null);
          setCounterAttackReady(false);
        }
        applyEngineStatePatch(playCardAction.statePatch);
        addLog(penaltyResponsePlan.logMessage);
        return;
      }

      applyEngineStatePatch(playCardAction.statePatch);
      addLog(penaltyResponsePlan.logMessage);
      return;
    }

    if (playCardAction.type === 'save-response') {
      const saveResponsePlan = playCardAction.plan;
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);

      if (saveResponsePlan.type === 'turn-change') {
        if (saveResponsePlan.clearTransientState) {
          setPendingShot(null);
          setPendingDefense(null);
          setPendingCombo(null);
          setBonusTurnFor(null);
          setCounterAttackReady(false);
        }
        applyEngineStatePatch(playCardAction.statePatch);
        if (card.id === GOALKEEPER_SAVE_CARD_ID) {
          queueActionVideo(saveVideo);
        }
        addLog(saveResponsePlan.logMessage);
        return;
      }

      applyEngineStatePatch(playCardAction.statePatch);
      addLog(saveResponsePlan.logMessage);
      return;
    }

    if (playCardAction.type === 'offside-var-response') {
      const offsideVarPlan = playCardAction.plan;
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);

      if (offsideVarPlan.type === 'goal') {
        scoreGoal(offsideVarPlan.scorer, offsideVarPlan.reason);
        return;
      }

      applyEngineStatePatch(playCardAction.statePatch);
      addLog(offsideVarPlan.logMessage);
      return;
    }

    if (playCardAction.type === 'remate-response') {
        consumeCard(actor, index, card);
        appendCardToTable(card, actor);
        applyEngineStatePatch(playCardAction.statePatch);
        startShotResolution(actor, 'remate');
        return;
    }

    if (playCardAction.type === 'steal-defense') {
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      startDefenseResolution(actor, card);
      return;
    }

    if (playCardAction.type === 'pass-play') {
      const passPlayPlan = playCardAction.plan;
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      setActivePlay((previousPlay) => [...previousPlay, card]);
      addLog(passPlayPlan.logMessage);

      if (passPlayPlan.preShotWindow?.open) {
        addLog(passPlayPlan.preShotWindow.logMessage);
      }

      return;
    }

    if (playCardAction.type === 'special-corner') {
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      addLog(playCardAction.logMessage);
      return;
    }

    if (playCardAction.type === 'shoot-card') {
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      if (pendingCombo?.type === 'chilena_followup') {
        queueActionVideo(chilenaVideo, () => {
          setPendingCombo(null);
          startShotResolution(actor, 'chilena');
        });
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

    if (playCardAction.type === 'penalty-card') {
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      startShotResolution(actor, 'penalty');
      return;
    }

    if (playCardAction.type === 'special-chilena') {
      consumeCard(actor, index, card);
      appendCardToTable(card, actor);
      applyEngineStatePatch(playCardAction.statePatch);
      addLog(playCardAction.logMessage);
      return;
    }
  };

  const playCard = (card, index, isFromPlayer) => {
    if (isDribbleVideoPlaying) {
      return;
    }

    const actor = isFromPlayer ? 'player' : 'opponent';
    const liveCard = getHand(actor)[index] ?? card;

    if (!liveCard) {
      return;
    }

    executePlayCard(liveCard, index, isFromPlayer);
  };
  playCardRef.current = playCard;

  useEffect(() => {
    if (onlineEnabled || !aiMode || gameState !== 'playing' || isDribbleVideoPlaying) {
      return undefined;
    }

    const isOpponentTurn = currentTurn === 'opponent';
    if (!isOpponentTurn) {
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

      if (action.type === 'blind-discard-target') {
        const targetLabel = blindDiscardTargetActor === 'player' ? 'jugador' : 'rival';
        setAiStatus(`IA elige una carta oculta del ${targetLabel}`);
        resolveBlindDiscard('opponent', action.index);
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
    isDribbleVideoPlaying,
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
      <div className="app-shell flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-slate-950 text-white">
        <div className="hud-bar z-20 border-b-2 border-cyan-500/35 p-2 shadow-2xl max-sm:p-0.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 max-sm:px-0.5">
          <ScorePanel
            name={playerDisplayName}
            score={playerScore}
            passTotal={getPassTrackerTotal('player')}
            accent="cyan"
            isActive={possession === 'player'}
            sanction={sanctions.player}
            redCardStatus={playerRedCardStatus}
            ball={possession === 'player' ? <SoccerBallIcon size={20} className="animate-bounce" /> : null}
          />

          <div className="flex flex-1 justify-center max-sm:px-0.5">
            {(gameState === 'playing' || gameState === 'dealing' || gameState === 'coin-flip') ? (
              <AppButton
                onClick={finishMatchAndReturnToMenu}
                variant="danger"
                className="px-5 py-2 shadow-xl max-sm:px-2.5 max-sm:py-1 max-sm:text-[8px] max-sm:tracking-[0.1em]"
              >
                Terminar partida
              </AppButton>
            ) : null}
          </div>

          <ScorePanel
            name={opponentDisplayName}
            score={opponentScore}
            passTotal={getPassTrackerTotal('opponent')}
            accent="rose"
            isActive={possession === 'opponent'}
            sanction={sanctions.opponent}
            redCardStatus={opponentRedCardStatus}
            ball={possession === 'opponent' ? <SoccerBallIcon size={20} className="animate-bounce" /> : null}
          />
        </div>
      </div>

        <div className="relative flex flex-1 flex-col items-center justify-between overflow-hidden border-x-[16px] border-emerald-900 p-3 shadow-inner max-sm:border-x-4 max-sm:p-1.5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,28,14,0.62),rgba(8,28,14,0.2)_38%,rgba(8,28,14,0.66)),repeating-linear-gradient(0deg,rgba(58,143,58,0.34)_0px,rgba(58,143,58,0.34)_48px,rgba(31,102,38,0.36)_48px,rgba(31,102,38,0.36)_96px),radial-gradient(circle_at_center,rgba(118,193,104,0.24),rgba(25,88,35,0.72)_68%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.22]">
            <div className="absolute left-3 right-3 top-3 bottom-3 rounded-2xl border border-white/12 max-sm:left-2 max-sm:right-2 max-sm:top-2 max-sm:bottom-2" />
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/32" />
            <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/26 max-sm:h-28 max-sm:w-28" />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/28 max-sm:h-2 max-sm:w-2" />
            <div className="absolute left-[18%] right-[18%] top-3 h-20 border border-white/14 border-t-0 max-sm:top-2 max-sm:h-14" />
            <div className="absolute left-[32%] right-[32%] top-3 h-10 border border-white/14 border-t-0 max-sm:top-2 max-sm:h-8" />
            <div className="absolute left-1/2 top-[13%] h-2 w-2 -translate-x-1/2 rounded-full bg-white/22 max-sm:top-[11%]" />
            <div className="absolute left-[18%] right-[18%] bottom-3 h-20 border border-white/14 border-b-0 max-sm:bottom-2 max-sm:h-14" />
            <div className="absolute left-[32%] right-[32%] bottom-3 h-10 border border-white/14 border-b-0 max-sm:bottom-2 max-sm:h-8" />
            <div className="absolute left-1/2 bottom-[13%] h-2 w-2 -translate-x-1/2 rounded-full bg-white/22 max-sm:bottom-[11%]" />
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

        <div className="relative z-10 w-full max-w-2xl opacity-80 max-sm:max-w-full">
          <div className="mb-2 text-center text-[10px] font-black uppercase tracking-[0.25em] text-white/60 max-sm:mb-1 max-sm:text-[8px]">
            Rival
          </div>
          {DEV_SHOW_OPPONENT_HAND || blindDiscardTargetActor === 'opponent' ? (
            <div className="grid w-full grid-cols-5 justify-items-center gap-1 sm:flex sm:flex-wrap sm:justify-center sm:gap-2">
              {(blindDiscardTargetActor === 'opponent'
                ? Array.from({ length: opponentHand.length }, (_, index) => ({
                    id: `blind-opponent-${index}`,
                    name: 'Carta oculta',
                    color: 'bg-slate-800'
                  }))
                : opponentHand
              ).map((card, index) => (
                  <CardItem
                    key={`${card.id}-${index}`}
                    card={card}
                    isSelected={selectedForDiscard.includes(index)}
                    onSelect={(event) => toggleDiscardSelection(event, index)}
                    onClick={() => {
                      if (isDribbleVideoPlaying) {
                        return;
                      }

                      if (blindDiscardTargetActor === 'opponent' && pendingBlindDiscard.actor === 'player') {
                        if (onlineEnabled && socketRef.current) {
                          socketRef.current.emit('match:play_card', { index });
                        } else {
                          resolveBlindDiscard('player', index);
                        }
                        return;
                      }

                      playCard(card, index, false);
                    }}
                    disabled={
                      blindDiscardTargetActor === 'opponent'
                        ? pendingBlindDiscard.actor !== 'player' || isDribbleVideoPlaying
                        : !isOpponentTurn || isDribbleVideoPlaying
                    }
                    canSelectDiscard={false}
                    isDiscardMode={discardMode}
                    hideContent={blindDiscardTargetActor === 'opponent'}
                  />
                ))}
            </div>
          ) : (
            <div className="text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/45 max-sm:text-[8px]">
              Cartas en mano: {opponentHand.length}
            </div>
          )}
        </div>

        {gameState === 'playing' && !onlineCoinFlipReveal && !isDribbleVideoPlaying ? (
          <div className="pointer-events-none absolute left-1/2 top-[16%] z-10 flex w-full max-w-[300px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-2 max-sm:top-[18%] max-sm:max-w-[240px]">
            {laneNotices.opponent ? (
              <div className="notice-pill notice-pill-emerald">
                {laneNotices.opponent}
              </div>
            ) : null}
          </div>
        ) : null}

        {gameState === 'playing' && !onlineCoinFlipReveal && !isDribbleVideoPlaying ? (
          <div className="pointer-events-none absolute left-1/2 bottom-[36%] z-10 flex w-full max-w-[300px] -translate-x-1/2 translate-y-1/2 flex-col items-center gap-2 px-2 max-sm:bottom-[38%] max-sm:max-w-[240px]">
            {laneNotices.player ? (
              <div className="notice-pill notice-pill-cyan">
                {laneNotices.player}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          className="z-10 flex w-full max-w-4xl items-center justify-center gap-4 px-4 max-sm:gap-2 max-sm:px-1"
          style={{ transform: 'translateY(8%)' }}
        >
          <div
            ref={matchTablePanelRef}
            className={`match-table-panel flex min-h-[150px] flex-1 items-end justify-center overflow-visible py-6 max-sm:min-h-[118px] max-sm:py-3 ${
              dragCardState?.isOverBoard ? 'match-table-panel-drop-active' : ''
            }`}
          >
            {tablePlay.length === 0 ? (
              <div className="table-empty-state w-full">
                <div className="table-empty-ball">
                  <SoccerBallIcon size={24} className="text-white/72" />
                </div>
                <div className="section-kicker">Cancha central</div>
                <div className="text-sm font-bold text-white/56">
                  Aun no hay cartas en juego
                </div>
              </div>
            ) : (
              tablePlay.map((card, index) => {
                const isRivalCard = card.tableActor === 'opponent';
                const previousActor = index > 0 ? tablePlay[index - 1]?.tableActor : null;
                const overlapOffset =
                  index === 0
                    ? '0px'
                    : isRivalCard
                      ? '-32px'
                      : previousActor === 'opponent'
                        ? '-18px'
                        : '6px';
                const verticalLift = isRivalCard ? '36px' : '0px';

                return (
                  <div
                    key={`${card.visualId || card.id}-${index}`}
                    className={`${card.color || 'bg-slate-800'} table-card relative flex h-[101px] min-w-[74px] flex-col justify-between p-2 max-sm:h-[84px] max-sm:min-w-[59px] max-sm:p-1 ${
                      isRivalCard ? 'table-card-opponent' : 'table-card-player'
                    } ${lastActiveCard?.visualId === card.visualId ? 'table-card-featured' : ''}`}
                    style={{
                      marginLeft: overlapOffset,
                      marginBottom: verticalLift,
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
                        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/32" />
                      </>
                    ) : null}
                    <p className="relative z-10 text-[7px] font-black uppercase leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] max-sm:text-[6px]">{card.name}</p>
                    {card.value > 0 ? (
                      <p className="relative z-10 text-center text-xl font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] max-sm:text-base">+{card.value}</p>
                    ) : (
                      <div className="relative z-10 h-7 max-sm:h-6" />
                    )}
                    <div className="relative z-10 mt-1 text-center text-[6px] font-black uppercase tracking-[0.18em] text-white/80 max-sm:text-[5px]">
                      {isRivalCard ? opponentDisplayName : playerDisplayName}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

            {statusBannerMessage && (
              <div className="status-banner mt-2 hidden sm:block">
                {statusBannerMessage}
              </div>
            )}

            {comboWindow && (
              <div className="pointer-events-none fixed inset-x-0 top-24 z-[68] flex justify-center px-4 max-sm:top-20">
                <div
                  className={`combo-panel relative w-full max-w-lg px-6 py-5 text-center ${
                    comboWindow.accent === 'lime'
                      ? 'border-lime-300/50 text-lime-100'
                      : comboWindow.accent === 'sky'
                        ? 'border-sky-300/50 text-sky-100'
                        : comboWindow.accent === 'indigo'
                          ? 'border-indigo-300/50 text-indigo-100'
                          : 'border-orange-300/50 text-orange-100'
                  }`}
                >
                  <div
                    className={`absolute inset-0 rounded-[1.6rem] ${
                      comboWindow.accent === 'lime'
                        ? 'bg-lime-500/20'
                        : comboWindow.accent === 'sky'
                          ? 'bg-sky-500/20'
                          : comboWindow.accent === 'indigo'
                            ? 'bg-indigo-500/20'
                            : 'bg-orange-500/20'
                    }`}
                  />
                  <div className="relative z-10 text-[10px] font-black uppercase tracking-[0.35em]">
                    {comboWindow.title}
                  </div>
                  <div className="relative z-10 mt-2 text-sm font-black">
                    {comboWindow.actor === 'player' ? 'Jugador' : 'Rival'} en combinacion especial
                  </div>
                  <div className="relative z-10 mt-2 text-sm font-semibold leading-tight text-white">
                    {comboWindow.required}
                  </div>
                  <div className="relative z-10 mt-4 flex items-center justify-center gap-3">
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
              </div>
            )}

          <div className="relative z-30 w-full max-w-[860px] pb-6 max-sm:max-w-full max-sm:pb-4">
          <div className="hand-dock">
          <div className="mb-3 flex flex-col items-center gap-3">
            <div className="turn-pill">
              Turno actual: {currentTurnLabel}
            </div>
            {onlineEnabled && gameState === 'playing' ? (
              <div className={`countdown-pill ${isTurnCountdownActive && turnCountdown <= 5 ? 'countdown-pill-critical' : ''}`}>
                Tiempo: {isTurnCountdownActive ? `${turnCountdown}s` : 'En espera'}
              </div>
            ) : null}
            <div className="section-kicker">
              {discardMode ? 'Selecciona cartas para descarte' : 'Tu mano'}
            </div>
          </div>
          <div className="action-strip max-sm:mb-2 max-sm:gap-2">
              {canUseDiscard && isPlayerTurn && (
              <AppButton
                onClick={handleDiscardButtonClick}
                disabled={isDribbleVideoPlaying}
                variant={discardMode && selectedForDiscard.length > 0 ? 'danger' : discardMode ? 'ghost' : 'secondary'}
                className={`flex items-center gap-2 px-6 py-2.5 text-[10px] ${discardMode && selectedForDiscard.length > 0 ? 'scale-105' : ''}`}
              >
                <RefreshCcw size={14} /> {discardMode ? (selectedForDiscard.length > 0 ? `CONFIRMAR DESCARTE (${selectedForDiscard.length})` : 'CANCELAR DESCARTE') : 'DESCARTAR'}
              </AppButton>
            )}

              <AppButton
                onClick={handleEndTurnButtonClick}
                disabled={Boolean(!isPlayerTurn || pendingBlindDiscard || isDribbleVideoPlaying)}
                className="flex items-center gap-2 px-8 py-2.5 text-[10px]"
              >
                <ArrowRightCircle size={14} /> FINALIZAR TURNO
              </AppButton>
          </div>

          <div
            className={`player-hand-grid mb-2 grid w-full grid-cols-5 justify-items-center gap-1 sm:mb-3 sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5 ${
              dragCardState ? 'player-hand-grid-dragging' : ''
            }`}
            style={{ marginBottom: '2%' }}
            onPointerLeave={handlePlayerHandLeave}
          >
            {playerHand.map((card, index) => {
              const cardDistance = activeHandCardIndex == null ? null : Math.abs(activeHandCardIndex - index);
              const interactionState =
                dragCardState?.index === index
                  ? 'dragging'
                  : cardDistance === 0
                    ? 'active'
                    : cardDistance === 1
                      ? 'near'
                      : cardDistance === 2
                        ? 'near-soft'
                        : 'idle';

              return (
              <CardItem
                key={`${card.id}-${index}`}
                card={card}
                isSelected={selectedForDiscard.includes(index)}
                onSelect={(event) => toggleDiscardSelection(event, index)}
                onClick={(event) => handlePlayerCardClick(event, card, index)}
                onPointerDown={(event) => handlePlayerCardPointerDown(event, card, index)}
                onPointerEnter={() => handlePlayerCardPointerEnter(index)}
                disabled={!isPlayerTurn || isDribbleVideoPlaying || (pendingBlindDiscard?.actor === 'player' && blindDiscardTargetActor === 'opponent')}
                canSelectDiscard={canUseDiscard}
                isDiscardMode={discardMode}
                hideContent={blindDiscardTargetActor === 'player'}
                interactionState={interactionState}
                dataIndex={index}
              />
              );
            })}
          </div>
          </div>

          {dragCardState ? (
            <div
              className={`drag-card-ghost ${dragCardState.isOverBoard ? 'drag-card-ghost-ready' : ''}`}
              style={{
                left: dragCardState.currentX,
                top: dragCardState.currentY,
                backgroundImage: dragCardState.card?.imageUrl ? `url(${dragCardState.card.imageUrl})` : 'none'
              }}
            >
              {!dragCardState.card?.imageUrl ? (
                <div className="drag-card-ghost-fallback">
                  {dragCardState.card?.name}
                </div>
              ) : null}
            </div>
          ) : null}

          {gameState === 'menu' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <ModalCard
                eyebrow="Menu principal"
                title="Gol App"
                description="Elige si quieres entrar directo al partido o ver un tutorial rapido con las reglas base y las combinaciones especiales."
                tone="emerald"
                className="w-full max-w-2xl px-8 py-10 text-center"
              >
                <div className="glass-panel online-panel mx-auto mb-6 max-w-lg rounded-2xl p-4 text-left">
                  <div className="mb-3 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">
                    Modo online
                  </div>
                  <input
                    value={onlinePlayerName}
                    onChange={(event) => setOnlinePlayerName(event.target.value)}
                    placeholder="Ingresa tu nombre"
                    className="input-shell mb-3 px-4 py-3 text-sm"
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <AppButton
                      onClick={() => {
                        setOnlineError('');
                        createOnlineRoom();
                      }}
                      variant="accent"
                      className="rounded-xl px-4 py-3 text-sm"
                    >
                      CREAR SALA
                    </AppButton>
                    <div className="flex gap-2">
                      <input
                        value={onlineJoinCode}
                        onChange={(event) => setOnlineJoinCode(event.target.value.toUpperCase())}
                        placeholder="Codigo"
                        className="input-shell min-w-0 flex-1 px-4 py-3 text-sm"
                      />
                      <AppButton
                        onClick={() => {
                          setOnlineError('');
                          joinOnlineRoom();
                        }}
                        className="rounded-xl px-4 py-3 text-sm"
                      >
                        UNIRSE
                      </AppButton>
                    </div>
                  </div>
                  {onlineRoomCode ? (
                    <div className="online-grid mt-3">
                      <div className="room-code-bar">
                        <div>
                          <div className="room-code-label">Codigo de sala</div>
                          <div className="room-code-value">{onlineRoomCode}</div>
                        </div>
                        <AppButton
                          onClick={copyOnlineRoomCode}
                          variant="ghost"
                          className="rounded-lg px-3 py-1.5 text-[11px] text-cyan-200"
                        >
                          COPIAR CODIGO
                        </AppButton>
                      </div>
                      <div className={`room-status ${onlineRoom?.playerCount === 2 ? 'room-status-ready' : 'room-status-waiting'}`}>
                        {onlineRoom?.playerCount === 2
                          ? 'Sala completa. Lista para iniciar la partida online.'
                          : 'Esperando a que se una otro jugador.'}
                      </div>
                      {onlineRoom?.players?.length ? (
                        <div className="player-list">
                          {onlineRoom.players.map((player, index) => (
                            <div
                              key={player.id}
                              className="player-presence-card"
                            >
                              <div className="player-avatar">
                                <span>{index + 1}</span>
                                <span className={`player-status-dot ${player.connected ? 'player-status-online' : 'player-status-offline'}`}>
                                  {player.connected ? 'OK' : '...'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-black uppercase tracking-[0.14em] text-white/85">
                                  {player.name}
                                </div>
                                <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${player.connected ? 'text-emerald-300' : 'text-white/35'}`}>
                                  {player.connected ? 'Online' : 'Desconectado'}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {onlineRoom?.playerCount === 2 && onlineRole === 'opponent' ? (
                          <AppButton
                            onClick={() => setShowOnlineCoinChoice(true)}
                            className="primary-cta-glow rounded-xl px-4 py-3 text-sm"
                          >
                            INICIAR PARTIDA ONLINE
                          </AppButton>
                        ) : null}
                        {onlineRoom?.playerCount === 2 && onlineRole === 'player' ? (
                          <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/70">
                            Esperando al invitado para iniciar el sorteo
                          </div>
                        ) : null}
                        <AppButton
                          onClick={leaveOnlineRoom}
                          variant="secondary"
                          className="rounded-xl px-4 py-3 text-sm"
                        >
                          SALIR DE LA SALA
                        </AppButton>
                      </div>
                    </div>
                  ) : null}
                  {onlineError ? (
                    <div className="mt-2 text-sm font-semibold text-red-300">{onlineError}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-4">
                  {!onlineRoomCode ? (
                    <AppButton
                      onClick={() => startFromMenu(true)}
                      variant="accent"
                      className="flex items-center gap-3 rounded-2xl px-8 py-4 text-sm"
                    >
                      <Bot size={18} /> JUGAR CONTRA IA
                    </AppButton>
                  ) : null}
                  <AppButton
                    onClick={() => setGameState('tutorial')}
                    variant="secondary"
                    className="flex items-center gap-3 rounded-2xl px-8 py-4 text-sm"
                  >
                    <BookOpen size={18} /> TUTORIAL
                  </AppButton>
                </div>
              </ModalCard>
            </div>
          )}

          {gameState === 'tutorial' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <ModalCard
                eyebrow="Tutorial rapido"
                title="Como se juega"
                tone="cyan"
                className="w-full max-w-3xl px-8 py-8 text-left"
                align="left"
              >
                <div className="glass-panel rounded-[1.5rem] p-5">
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
                    <AppButton
                      onClick={() => setTutorialPage((previous) => Math.max(0, previous - 1))}
                      disabled={tutorialPage === 0}
                      variant="secondary"
                      className="rounded-2xl px-5 py-3 text-sm"
                    >
                      ANTERIOR
                    </AppButton>
                    <AppButton
                      onClick={() => setTutorialPage((previous) => Math.min(TUTORIAL_SEQUENCES.length - 1, previous + 1))}
                      disabled={tutorialPage === TUTORIAL_SEQUENCES.length - 1}
                      variant="accent"
                      className="rounded-2xl px-5 py-3 text-sm"
                    >
                      SIGUIENTE
                    </AppButton>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
                  <AppButton
                    onClick={() => setGameState('menu')}
                    variant="secondary"
                    className="rounded-2xl px-6 py-3 text-sm"
                  >
                    VOLVER
                  </AppButton>
                  <AppButton
                    onClick={startFromMenu}
                    className="rounded-2xl px-6 py-3 text-sm"
                  >
                    IR A JUGAR
                  </AppButton>
                </div>
              </ModalCard>
            </div>
          )}

          {gameState === 'coin-flip' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6">
              <ModalCard
                eyebrow="Inicio del partido"
                title="Sorteo de saque"
                tone="gold"
                className="w-full max-w-lg px-7 py-8 text-center"
              >

                <div className="relative mx-auto mb-7 flex w-full max-w-[320px] items-center justify-center">
                  <video
                    key={coinFlipPlaybackId}
                    ref={coinFlipVideoRef}
                    src={coinVideo}
                    autoPlay={coinFlipState.isFlipping}
                    controls={false}
                    onEnded={finalizeCoinFlip}
                    onLoadedMetadata={scheduleCoinFlipFinalize}
                    onError={scheduleCoinFlipFinalize}
                    playsInline
                    preload="auto"
                    className="h-auto w-[min(92vw,760px)] rounded-[1.75rem] shadow-[0_22px_45px_rgba(0,0,0,0.4)]"
                  />
                  {coinFlipState.result ? (
                    <div className="overlay-chip pointer-events-none absolute right-3 top-3 border-yellow-300/30 text-yellow-200">
                      {coinFlipState.result}
                    </div>
                  ) : null}
                </div>

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
                        {(coinFlipState.winner === 'player' ? playerDisplayName : opponentDisplayName) || 'Jugador'} gana el sorteo.
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-white/45">
                      Esperando tu eleccion.
                    </div>
                  )}
                </div>

                <div className="flex justify-center gap-4">
                  <AppButton
                    onClick={() => handleCoinFlip('Cara')}
                    disabled={coinFlipState.isFlipping}
                    variant="secondary"
                    className="rounded-2xl px-10 py-4 text-black !bg-white"
                  >
                    CARA
                  </AppButton>
                  <AppButton
                    onClick={() => handleCoinFlip('Sello')}
                    disabled={coinFlipState.isFlipping}
                    variant="secondary"
                    className="rounded-2xl px-10 py-4 text-black !bg-white"
                  >
                    SELLO
                  </AppButton>
                </div>
              </ModalCard>
            </div>
          )}

            {gameState === 'dealing' && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
                <ModalCard
                  eyebrow="Preparacion"
                  title="Listos para arrancar"
                  tone="emerald"
                  className="px-10 py-8 text-center"
                >
                  {coinFlipState.result && (
                    <div className="mb-5">
                      <div className="text-[11px] font-black uppercase tracking-[0.35em] text-yellow-400/80">
                        Resultado del sorteo
                      </div>
                      <div className="mt-2 text-3xl font-black text-white">
                        Salio {coinFlipState.result}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/65">
                        Comienza {(coinFlipState.winner === 'player' ? playerDisplayName : opponentDisplayName) || 'Jugador'}.
                      </div>
                    </div>
                  )}
                  <AppButton
                    onClick={handleDeal}
                    className="animate-pulse rounded-2xl px-12 py-6 text-xl"
                  >
                    {onlineEnabled ? 'INICIAR PARTIDA ONLINE' : 'EMPEZAR PARTIDO'}
                  </AppButton>
                </ModalCard>
              </div>
            )}

            {goalCelebration && (
              <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/52">
                <div
                  className={`rounded-[2rem] border px-10 py-8 text-center shadow-[0_0_60px_rgba(255,255,255,0.12)] ${
                    goalCelebration.scorer === 'player'
                      ? 'border-blue-300/50 bg-blue-500/20 text-blue-100'
                      : 'border-red-300/50 bg-red-500/20 text-red-100'
                  }`}
                  style={{ animation: 'goalPulse 1.872s ease-out forwards' }}
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

            {isDribbleVideoPlaying && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 backdrop-blur-[2px]">
                <video
                  ref={dribbleVideoRef}
                  src={activeActionVideo}
                  autoPlay
                  controls={false}
                  onEnded={finishDribbleAnimation}
                  onError={finishDribbleAnimation}
                  playsInline
                  preload="auto"
                  className="h-auto w-[min(68vw,560px)] max-w-[92vw] rounded-[1.4rem] border border-white/20 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
                />
              </div>
            )}

            {fieldEventAnimation && (
              <div className="pointer-events-none fixed inset-x-0 top-24 z-[69] flex justify-center px-4 max-sm:top-20">
                <div
                  className={`overlay-banner max-w-xl px-6 py-4 text-center ${
                    fieldEventAnimation.actor === 'player'
                      ? 'border-blue-300/50 bg-blue-500/20 text-blue-100'
                      : 'border-red-300/50 bg-red-500/20 text-red-100'
                  }`}
                  style={{ animation: `goalPulse ${FIELD_EVENT_DURATION_MS}ms ease-out forwards` }}
                >
                  <div className="text-sm font-black uppercase tracking-[0.22em] max-sm:text-[11px]">
                    {fieldEventAnimation.text}
                  </div>
                </div>
              </div>
            )}

            {onlineCoinFlipReveal && (
              <div className="pointer-events-none fixed inset-0 z-50">
                <div className="absolute inset-0 bg-black/90" />
                {onlineCoinFlipReveal.showVideo ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <video
                      key={`${onlineCoinFlipReveal.result}-${onlineCoinFlipReveal.winner}`}
                      src={coinVideo}
                      autoPlay
                      onLoadedMetadata={handleOnlineCoinFlipMetadata}
                      onEnded={handleOnlineCoinFlipEnded}
                      onError={handleOnlineCoinFlipEnded}
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center px-6">
                    <div className="overlay-banner rounded-[1.6rem] border-yellow-300/40 px-8 py-6 text-center">
                      <div className="text-[11px] font-black uppercase tracking-[0.28em] text-yellow-300">
                        Sorteo Online
                      </div>
                      <div className="mt-2 text-base font-semibold text-white/90">
                        El invitado eligio {onlineCoinFlipReveal.invitedChoice || 'Cara'}.
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white/65">
                        Preparando lanzamiento de moneda...
                      </div>
                    </div>
                  </div>
                )}
                {onlineCoinFlipReveal.showResult ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="overlay-banner rounded-[1.6rem] border-yellow-300/40 px-8 py-6 text-center">
                      <div className="text-sm font-black uppercase tracking-[0.28em] text-yellow-300">
                        Salio {onlineCoinFlipReveal.result}
                      </div>
                      <div className="mt-2 text-base font-semibold text-white/90">
                        Inicia {onlineCoinFlipReveal.winner}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <button
              onClick={() => setAudioMuted((previous) => !previous)}
              className={`fixed right-3 top-[15%] z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_14px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all max-sm:right-2 max-sm:top-[12%] ${
                audioMuted
                  ? 'border-rose-300/40 bg-rose-600/85 text-white'
                  : 'border-emerald-300/40 bg-black/55 text-emerald-200'
              }`}
              aria-label={audioMuted ? 'Activar audio' : 'Silenciar audio'}
              title={audioMuted ? 'Activar audio' : 'Silenciar audio'}
            >
              {audioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            {systemNotice && (
              <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
                <div
                  className="rounded-full border border-white/25 bg-black/70 px-5 py-3 text-center text-sm font-black text-white shadow-[0_16px_35px_rgba(0,0,0,0.45)]"
                  style={{ animation: 'goalPulse 1.6s ease-out forwards' }}
                >
                  {systemNotice}
                </div>
              </div>
            )}

            {showOnlineCoinChoice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
                <ModalCard
                  eyebrow="Inicio online"
                  title="Elige Cara o Sello"
                  tone="gold"
                  className="w-full max-w-md p-6 text-center"
                >
                  <div className="flex justify-center gap-3">
                    <AppButton
                      onClick={() => startOnlineMatchWithChoice('Cara')}
                      variant="secondary"
                      className="rounded-xl px-5 py-3 text-sm text-slate-950 !bg-white"
                    >
                      CARA
                    </AppButton>
                    <AppButton
                      onClick={() => startOnlineMatchWithChoice('Sello')}
                      variant="secondary"
                      className="rounded-xl px-5 py-3 text-sm text-slate-950 !bg-white"
                    >
                      SELLO
                    </AppButton>
                    <AppButton
                      onClick={() => setShowOnlineCoinChoice(false)}
                      variant="secondary"
                      className="rounded-xl px-5 py-3 text-sm"
                    >
                      CANCELAR
                    </AppButton>
                  </div>
                </ModalCard>
              </div>
            )}

            {gameState === 'finished' && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 p-6">
                <ModalCard
                  eyebrow="Fin del Partido"
                  title={matchWinner === 'player' ? 'Gana Jugador' : 'Gana Rival'}
                  tone="emerald"
                  className="w-full max-w-md p-8 text-center"
                >
                  <div className="mb-3 text-3xl font-black text-white">
                    {playerScore} - {opponentScore}
                  </div>
                  <div className="mb-8 text-lg font-bold text-white/70">
                    Marcador final
                  </div>
                  <AppButton
                    onClick={resetMatch}
                    className="rounded-2xl px-8 py-4 text-sm"
                  >
                    Jugar de Nuevo
                  </AppButton>
                </ModalCard>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
