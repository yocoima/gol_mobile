/**
 * CardItem — versión premium
 *
 * CÓMO INTEGRAR:
 * 1. En src/index.css, al inicio: @import './card-premium.css';
 * 2. Reemplaza el componente CardItem completo en App.jsx con este código.
 *    (Está entre las líneas ~317 y ~410 de App.jsx)
 *
 * NO cambia nada de la lógica del juego — solo estilos y efectos visuales.
 */

// ─── Mapa de rareza por ID de carta ───────────────────────────────────────────
const CARD_RARITY_MAP = {
  // Legendarias
  ch:  'legendary',
  // Épicas
  pa: 'epic', cont: 'epic', fa: 'epic', tg: 'epic',
  pe: 'epic', paq: 'epic', rem: 'epic', tr: 'epic', var: 'epic',
  // Raras
  pl: 'rare', reg: 'rare', ba: 'rare', off: 'rare', sc: 'rare', ta: 'rare',
  // Comunes (default): pc, sb
};

// ─── Clase CSS de tipo de carta ───────────────────────────────────────────────
const CARD_TYPE_CLASS = {
  pass:         'card-t-pass',
  defense:      'card-t-defense',
  counter:      'card-t-counter',
  shoot:        'card-t-shoot',
  shoot_special:'card-t-shoot-special',
  shoot_direct: 'card-t-penalty',
  save:         'card-t-save',
  special:      'card-t-special',
  card:         'card-t-card',
  card_hard:    'card-t-card-hard',
  var:          'card-t-var',
};

// ─── Cantidad de gems por rareza ──────────────────────────────────────────────
const RARITY_GEMS = { legendary: 4, epic: 3, rare: 2, common: 1 };

// ─── Sparkle positions para legendarias ──────────────────────────────────────
const LEGENDARY_SPARKS = [
  { top: '18%', left: '14%', sd: '2s',   sdelay: '0s'   },
  { top: '30%', left: '72%', sd: '2.4s', sdelay: '0.6s' },
  { top: '58%', left: '20%', sd: '1.9s', sdelay: '1.1s' },
  { top: '72%', left: '62%', sd: '2.2s', sdelay: '0.3s' },
];

// ─── Componente ───────────────────────────────────────────────────────────────
const CardItem = ({
  card,
  onClick,
  onSelect,
  onPointerDown,
  onPointerEnter,
  onLongPressStart,
  onLongPressEnd,
  disabled,
  isSelected,
  canSelectDiscard,
  isDiscardMode,
  hideContent = false,
  interactionState = 'idle',
  dataIndex = null
}) => {
  const btnRef = useRef(null);
  const holoRef = useRef(null);

  const cardImage  = card?.imageUrl;
  const cardLabel  = hideContent ? 'Carta oculta' : card?.name;
  const rarity     = hideContent ? 'common' : (CARD_RARITY_MAP[card?.id] ?? 'common');
  const typeClass  = hideContent ? '' : (CARD_TYPE_CLASS[card?.type] ?? '');
  const gemCount   = RARITY_GEMS[rarity] ?? 1;
  const isLegendary = rarity === 'legendary';
  // "golden" solo para Penalti Legendario (id 'pel' cuando se agregue al juego)
  const isGolden   = card?.id === 'pel';

  const cardTypeLabel =
    hideContent        ? 'Oculta'     :
    card?.type === 'pass'             ? 'Pase'       :
    card?.type === 'defense'          ? 'Defensa'    :
    card?.type === 'shoot' || card?.type === 'shoot_special' ? 'Remate' :
    card?.type === 'shoot_direct'     ? 'Penalti'    :
    card?.type === 'save'             ? 'Parada'     :
    card?.type === 'counter'          ? 'Regate'     :
    card?.type === 'special'          ? 'Especial'   :
    card?.type === 'card'             ? 'Tarjeta'    :
    card?.type === 'card_hard'        ? 'Tarjeta'    :
    card?.type === 'var'              ? 'VAR'        : 'Juego';

  const glowClass        = !hideContent && !disabled ? getCardGlowClass(card?.type) : '';
  const playabilityClass = !hideContent && !isDiscardMode
    ? disabled ? 'hand-card-not-playable' : 'hand-card-playable'
    : '';

  // ─── Tilt 3D + efecto holográfico en hover ───────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Tilt suave (las cartas son pequeñas, 6° máximo)
    const rotX = (y - 0.5) * -10;
    const rotY = (x - 0.5) *  10;
    btnRef.current.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.06) translateY(-12px) rotate(-1.2deg)`;

    // Holo: gradiente cónico que sigue el cursor
    if (holoRef.current) {
      const angle = Math.atan2(y - 0.5, x - 0.5) * (180 / Math.PI);
      const dist  = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2);
      holoRef.current.style.background = `
        radial-gradient(ellipse 70% 70% at ${x * 100}% ${y * 100}%,
          rgba(255,255,255,0.04), transparent 55%),
        conic-gradient(from ${angle}deg at ${x * 100}% ${y * 100}%,
          rgba(255,80,120,${0.11 * dist}),
          rgba(80,255,180,${0.09 * dist}),
          rgba(80,120,255,${0.11 * dist}),
          rgba(255,200,80,${0.09 * dist}),
          rgba(255,80,200,${0.09 * dist}),
          rgba(255,80,120,${0.11 * dist}))
      `;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!btnRef.current) return;
    btnRef.current.style.transform = '';
    if (holoRef.current) holoRef.current.style.background = '';
  }, []);

  return (
    <div
      className={`hand-card-shell group hand-card-shell-${interactionState}`}
      data-hand-card-index={dataIndex}
      onMouseMove={!disabled && !hideContent ? handleMouseMove : undefined}
      onMouseLeave={!disabled && !hideContent ? handleMouseLeave : undefined}
      onTouchStart={onLongPressStart ? (e) => onLongPressStart(card, e, disabled) : undefined}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
    >
      {/* Botón de descarte */}
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
        ref={btnRef}
        onClick={isDiscardMode ? onSelect : onClick}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        disabled={disabled}
        className={[
          'hand-card-button',
          hideContent || cardImage ? 'bg-slate-900' : card?.color || 'bg-slate-800',
          hideContent   ? 'hand-card-hidden' : '',
          !disabled     ? 'hand-card-enabled' : 'hand-card-disabled',
          isSelected    ? 'hand-card-selected' : '',
          `hand-card-button-${interactionState}`,
          glowClass,
          playabilityClass,
          // ── Premium additions ──
          typeClass,
          `card-r-${rarity}`,
          isGolden ? 'card-golden' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* Tipo badge */}
        {!hideContent && <div className="hand-card-badge">{cardTypeLabel}</div>}

        {/* Badge de valor de pase */}
        {!hideContent && card?.value > 0 && (
          <div className="card-value-badge">+{card.value}</div>
        )}

        {/* Imagen de la carta */}
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

        {/* Overlay holográfico */}
        {!hideContent && (
          <div ref={holoRef} className="card-holo" />
        )}

        {/* Sparkles para legendarias */}
        {isLegendary && !hideContent && LEGENDARY_SPARKS.map((s, i) => (
          <div
            key={i}
            className="card-spark"
            style={{ top: s.top, left: s.left, '--sd': s.sd, '--sdelay': s.sdelay }}
          />
        ))}

        {/* Gems de rareza (bottom-right) */}
        {!hideContent && !disabled && (
          <div className="card-rarity-gems">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={`card-gem ${i < gemCount ? 'lit' : ''}`} />
            ))}
          </div>
        )}

        <div className="hand-card-frame" />

        {hideContent ? (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[10px] font-black uppercase tracking-[0.2em] text-white/75 max-sm:text-[7px]">
            Carta
          </div>
        ) : null}
      </button>

      <div className="hand-card-name">{cardLabel}</div>
    </div>
  );
};
