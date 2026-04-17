const joinClasses = (...values) => values.filter(Boolean).join(' ');

export function AppButton({
  variant = 'primary',
  className = '',
  children,
  ...props
}) {
  const variantClassName = {
    primary: 'app-button app-button-primary',
    secondary: 'app-button app-button-secondary',
    accent: 'app-button app-button-accent',
    danger: 'app-button app-button-danger',
    ghost: 'app-button app-button-ghost'
  }[variant] ?? 'app-button app-button-primary';

  return (
    <button
      {...props}
      className={joinClasses(variantClassName, className)}
    >
      {children}
    </button>
  );
}

export function ModalCard({
  eyebrow,
  title,
  description,
  tone = 'emerald',
  className = '',
  contentClassName = '',
  align = 'center',
  children
}) {
  return (
    <div className={joinClasses('modal-card', `modal-card-${tone}`, className)}>
      {eyebrow ? <div className="modal-eyebrow">{eyebrow}</div> : null}
      {title ? <h2 className={`modal-title ${align === 'left' ? 'text-left' : 'text-center'}`}>{title}</h2> : null}
      {description ? (
        <p className={`modal-description ${align === 'left' ? 'text-left' : 'text-center'}`}>{description}</p>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

export function ScorePanel({
  name,
  score,
  passTotal,
  accent = 'cyan',
  isActive = false,
  sanction = null,
  redCardStatus = '',
  ball = null
}) {
  const palette = accent === 'rose'
    ? {
        wrapper: isActive
          ? 'score-panel-active-rose'
          : sanction
            ? 'score-panel-warning-rose'
            : 'score-panel-idle',
        label: 'text-rose-300',
        chip: 'score-chip-rose',
        sanction: sanction?.type === 'red'
          ? 'border-red-200/80 bg-red-500 text-white'
          : 'border-yellow-100/90 bg-yellow-300 text-slate-950'
      }
    : {
        wrapper: isActive
          ? 'score-panel-active-cyan'
          : sanction
            ? 'score-panel-warning-cyan'
            : 'score-panel-idle',
        label: 'text-cyan-300',
        chip: 'score-chip-cyan',
        sanction: sanction?.type === 'red'
          ? 'border-red-200/80 bg-red-500 text-white'
          : 'border-yellow-100/90 bg-yellow-300 text-slate-950'
      };

  return (
    <div className={joinClasses('score-panel', palette.wrapper)}>
      {ball}
      <div className="text-center">
        <span className={joinClasses('block text-[10px] font-black max-sm:text-[8px]', palette.label)}>{name}</span>
        <span className="score-value">{score}</span>
        <div className="mt-1 flex justify-center gap-1.5 max-sm:hidden">
          {[1, 2, 3, 4].map((point) => (
            <div
              key={`${name}-pass-${point}`}
              className={`h-2 w-4 rounded-full transition-all duration-500 ${
                passTotal >= point ? 'bg-yellow-400 shadow-[0_0_10px_#facc15]' : 'bg-slate-800'
              }`}
            />
          ))}
        </div>
        <span className="score-subtitle">
          Puntos jugada: {passTotal} / 4
        </span>
        {redCardStatus ? (
          <div className={joinClasses('mt-1 inline-flex max-w-[180px] rounded-full px-2.5 py-1 text-center text-[9px] font-black uppercase tracking-[0.14em] text-white shadow-[0_8px_18px_rgba(127,29,29,0.35)] max-sm:max-w-[108px] max-sm:px-1.5 max-sm:py-0.5 max-sm:text-[6px]', palette.chip)}>
            {redCardStatus}
          </div>
        ) : null}
        {sanction ? (
          <div className={joinClasses('mt-2 hidden max-w-[220px] items-start gap-2 rounded-xl border px-3 py-2 text-left shadow-lg sm:flex', palette.sanction)}>
            <div
              className={`mt-0.5 h-8 w-6 rounded-sm border shadow-md ${
                sanction.type === 'red'
                  ? 'border-red-100/80 bg-red-700'
                  : 'border-yellow-950/20 bg-yellow-100'
              }`}
            />
            <div className="min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.2em]">
                {sanction.title}
              </span>
              <span className="block text-[10px] font-black leading-tight">
                {sanction.detail}
              </span>
              {sanction.turnsRemaining ? (
                <span className="mt-1 inline-flex rounded-full bg-black/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]">
                  Turnos restantes: {sanction.turnsRemaining}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
