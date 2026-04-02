import React, { useState, useEffect } from 'react';
import { 
  Trophy, Target, ShieldAlert, Zap, Coins, Hand, 
  User, Swords, Trash2, ArrowRightCircle, RefreshCcw,
  Library, History
} from 'lucide-react';

const App = () => {
  // --- CONFIGURACIÓN DEL MAZO (88 CARTAS) ---
  const DECK_DEFINITION = [
    { id: 'pc', name: 'Pase Corto', value: 1, type: 'pass', color: 'bg-emerald-500', count: 12, detail: 'Suma valor x1' },
    { id: 'pl', name: 'Pase Largo', value: 2, type: 'pass', color: 'bg-blue-500', count: 8, detail: 'Suma valor x2' },
    { id: 'pa', name: 'Pase Aéreo', value: 3, type: 'pass', color: 'bg-cyan-500', count: 6, detail: 'Suma valor x3' },
    { id: 'cont', name: 'Contraataque', value: 0, type: 'defense', color: 'bg-indigo-600', count: 4, detail: 'Roba + Pase + Tiro' },
    { id: 'reg', name: 'Regatear', value: 0, type: 'counter', color: 'bg-teal-400', count: 8, detail: 'Evita Barrida' },
    { id: 'tg', name: 'Tirar a Gol', value: 0, type: 'shoot', color: 'bg-red-600', count: 8, detail: 'Intenta anotar' },
    { id: 'ch', name: 'Chilena', value: 0, type: 'shoot_special', color: 'bg-orange-500', count: 2, detail: 'Tras Pase Largo' },
    { id: 'ba', name: 'Barrida', value: 0, type: 'defense', color: 'bg-slate-700', count: 8, detail: 'Quita posesión' },
    { id: 'fa', name: 'Falta Agresiva', value: 0, type: 'defense', color: 'bg-orange-800', count: 4, detail: 'Inmune a Regate' },
    { id: 'pe', name: 'Penalti', value: 0, type: 'shoot_direct', color: 'bg-yellow-500', count: 2, detail: 'Tiro directo' },
    { id: 'paq', name: 'Parada Arquero', value: 0, type: 'save', color: 'bg-stone-500', count: 7, detail: 'Evita un gol' },
    { id: 'rem', name: 'Remate', value: 0, type: 'special', color: 'bg-pink-600', count: 4, detail: 'Tras Parada Arquero' },
    { id: 'sb', name: 'Saque Banda', value: 0, type: 'defense', color: 'bg-lime-600', count: 4, detail: 'Roba + Pase Corto' },
    { id: 'sc', name: 'Saque Córner', value: 0, type: 'defense', color: 'bg-sky-700', count: 3, detail: 'Roba + Aéreo + Tiro' },
    { id: 'ta', name: 'Tarj. Amarilla', value: 0, type: 'card', color: 'bg-yellow-400', count: 4, detail: 'Contra Falta Agresiva' },
    { id: 'tr', name: 'Tarj. Roja', value: 0, type: 'card_hard', color: 'bg-red-500', count: 2, detail: 'Contra Falta + Descarte' },
    { id: 'var', name: 'VAR', value: 0, type: 'var', color: 'bg-purple-600', count: 2, detail: 'Anula Roja o Penalti' }
  ];

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
  const [hasActedThisTurn, setHasActedThisTurn] = useState(false); // Cambiado para rastrear si ya jugó cartas
  const [selectedForDiscard, setSelectedForDiscard] = useState([]);
  const [gameLog, setGameLog] = useState(['Posesión persistente activada']);

  const addLog = (msg) => setGameLog(prev => [msg, ...prev].slice(0, 5));
  const currentPassTotal = activePlay.reduce((sum, card) => sum + (card.value || 0), 0);

  const initDeck = () => {
    const full = DECK_DEFINITION.flatMap(card => Array(card.count).fill(card));
    return full.sort(() => Math.random() - 0.5);
  };

  const handleCoinFlip = (choice) => {
    const isHeads = Math.random() > 0.5;
    const resultStr = isHeads ? 'Cara' : 'Sello';
    const playerWon = choice === resultStr;
    const winner = playerWon ? 'player' : 'opponent';
    setPossession(winner);
    setCurrentTurn(winner);
    setGameState('dealing');
    addLog(`Salió ${resultStr}. El ${winner === 'player' ? 'Jugador' : 'Rival'} tiene el balón.`);
  };

  const handleDeal = () => {
    const newDeck = initDeck();
    setPlayerHand(newDeck.splice(0, 5));
    setOpponentHand(newDeck.splice(0, 5));
    setDeck(newDeck);
    setGameState('playing');
  };

  const endTurn = () => {
    const isPlayer = currentTurn === 'player';
    const currentHand = isPlayer ? playerHand : opponentHand;
    const needed = 5 - currentHand.length;
    
    if (needed > 0) {
      const newDeck = [...deck];
      const drawn = newDeck.splice(0, needed);
      if (isPlayer) setPlayerHand([...currentHand, ...drawn]);
      else setOpponentHand([...currentHand, ...drawn]);
      setDeck(newDeck);
    }

    setCurrentTurn(isPlayer ? 'opponent' : 'player');
    setHasActedThisTurn(false);
    setSelectedForDiscard([]);
    addLog(`Cambio de turno. Balón: ${possession === 'player' ? 'Jugador' : 'Rival'}`);
  };

  const handleDiscard = () => {
    if (selectedForDiscard.length !== 2) return;
    
    const isPlayer = currentTurn === 'player';
    const hand = isPlayer ? [...playerHand] : [...opponentHand];
    
    const cardsToDiscard = hand.filter((_, idx) => selectedForDiscard.includes(idx));
    const newHand = hand.filter((_, idx) => !selectedForDiscard.includes(idx));
    
    const newDeck = [...deck];
    const drawn = newDeck.splice(0, 2);
    
    setDiscardPile(prev => [...cardsToDiscard, ...prev]);
    if (isPlayer) setPlayerHand([...newHand, ...drawn]);
    else setOpponentHand([...newHand, ...drawn]);
    
    setDeck(newDeck);
    addLog(`${isPlayer ? 'Jugador' : 'Rival'} descartó 2 cartas.`);
    endTurn();
  };

  const toggleDiscardSelection = (e, idx) => {
    e.stopPropagation(); 
    if (hasActedThisTurn) return;
    
    if (selectedForDiscard.includes(idx)) {
      setSelectedForDiscard(selectedForDiscard.filter(i => i !== idx));
    } else if (selectedForDiscard.length < 2) {
      setSelectedForDiscard([...selectedForDiscard, idx]);
    }
  };

  const playCard = (card, index, isFromPlayer) => {
    const actor = isFromPlayer ? 'player' : 'opponent';
    
    if (currentTurn !== actor) return;
    if (selectedForDiscard.length > 0) return;

    const isPossessor = possession === actor;
    
    // CASO 1: NO TIENE EL BALÓN (Debe robarlo)
    if (!isPossessor) {
      const canSteal = ['ba', 'fa', 'sb', 'sc', 'cont'].includes(card.id);
      if (!canSteal) {
        addLog("No tienes el balón. ¡Usa Barrida o Saque!");
        return;
      }
      addLog(`¡${card.name}! Balón recuperado por ${actor === 'player' ? 'Jugador' : 'Rival'}`);
      setPossession(actor);
      setActivePlay([]);
    } 
    // CASO 2: TIENE EL BALÓN (Armar jugada)
    else {
      if (card.type === 'pass') {
        setActivePlay(prev => [...prev, card]);
        addLog(`Pase: +${card.value} (Total: ${currentPassTotal + card.value})`);
      } else if (card.id === 'tg' || card.id === 'pe') {
        if (card.id === 'tg' && currentPassTotal < 4) {
          addLog("Necesitas 4 puntos de pases para tirar.");
          return;
        }
        
        // Lógica de Tiro
        if (Math.random() > 0.4) {
          addLog("¡GOOOOOL!");
          if (isFromPlayer) setPlayerScore(s => s + 1);
          else setOpponentScore(s => s + 1);
        } else {
          addLog("¡Fuera o atajada!");
        }
        setActivePlay([]);
        setPossession(isFromPlayer ? 'opponent' : 'player'); // El balón cambia tras el tiro
      } else if (card.id === 'reg') {
        addLog("¡Regate!");
      } else {
        addLog("No puedes usar esa carta ahora.");
        return;
      }
    }

    // Actualizar mano y descartes
    setDiscardPile(prev => [card, ...prev]);
    if (isFromPlayer) {
      setPlayerHand(prev => prev.filter((_, i) => i !== index));
    } else {
      setOpponentHand(prev => prev.filter((_, i) => i !== index));
    }
    
    setHasActedThisTurn(true);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white font-sans overflow-hidden">
      {/* Marcador Superior */}
      <div className="bg-slate-900 p-2 border-b-2 border-emerald-500 z-20 shadow-2xl">
        <div className="max-w-4xl mx-auto flex justify-between items-center px-4">
          <div className={`flex items-center gap-4 p-3 rounded-2xl transition-all ${possession === 'player' ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'opacity-30 grayscale'}`}>
             <div className="text-center">
                <span className="text-[10px] font-black block text-blue-400">JUGADOR</span>
                <span className="text-3xl font-black">{playerScore}</span>
             </div>
             {possession === 'player' && <SoccerBallIcon size={20} className="animate-bounce" />}
          </div>

          <div className="flex flex-col items-center">
            <div className="flex gap-1.5 mb-1">
              {[1,2,3,4].map(i => <div key={i} className={`w-4 h-2 rounded-full transition-all duration-500 ${currentPassTotal >= i ? 'bg-yellow-400 shadow-[0_0_10px_#facc15]' : 'bg-slate-800'}`}></div>)}
            </div>
            <span className="text-[10px] font-black text-yellow-500 tracking-widest uppercase">Puntos Jugada: {currentPassTotal} / 4</span>
          </div>

          <div className={`flex items-center gap-4 p-3 rounded-2xl transition-all ${possession === 'opponent' ? 'bg-red-600/30 ring-2 ring-red-500' : 'opacity-30 grayscale'}`}>
             {possession === 'opponent' && <SoccerBallIcon size={20} className="animate-bounce" />}
             <div className="text-center">
                <span className="text-[10px] font-black block text-red-400">RIVAL</span>
                <span className="text-3xl font-black">{opponentScore}</span>
             </div>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-emerald-900 relative flex flex-col items-center justify-between p-4 border-x-[16px] border-emerald-800 shadow-inner">
        {/* Gráficos de Campo */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-10">
            <div className="w-full h-px bg-white"></div>
            <div className="w-48 h-48 border-4 border-white rounded-full"></div>
        </div>

        {/* Rival */}
        <div className="w-full max-w-2xl opacity-60">
           <div className="flex gap-2 justify-center">
             {opponentHand.map((c, i) => (
               <div key={i} className="w-16 h-24 bg-slate-800 rounded-lg border-2 border-white/10 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-white/5"></div>
               </div>
             ))}
           </div>
        </div>

        {/* Zona de Juego (Mesa) */}
        <div className="flex items-center justify-between w-full max-w-4xl px-4 z-10">
            <div className="flex flex-col items-center gap-2">
                <div className="relative w-20 h-28 bg-slate-900/80 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center text-white/20">
                    <History size={24} />
                    {discardPile.length > 0 && (
                        <div className={`absolute inset-0 ${discardPile[0].color} rounded-xl border-2 border-white/40 shadow-xl flex items-center justify-center`}>
                            <span className="text-[8px] font-black text-center uppercase">{discardPile[0].name}</span>
                        </div>
                    )}
                </div>
                <span className="text-[9px] font-black text-white/40 uppercase">Descartes</span>
            </div>

            <div className="flex-1 flex justify-center gap-2 overflow-x-auto py-4">
                {activePlay.length === 0 ? (
                    <div className="px-10 py-5 bg-black/20 rounded-full border-2 border-dashed border-white/10">
                        <span className="text-white/20 font-black text-sm uppercase">Empieza la jugada</span>
                    </div>
                ) : (
                    activePlay.map((c, i) => (
                        <div key={i} className={`${c.color} min-w-[70px] h-24 rounded-lg p-2 border-2 border-white/40 shadow-lg flex flex-col justify-between animate-in zoom-in duration-300`}>
                            <p className="text-[7px] font-black uppercase leading-none">{c.name}</p>
                            <p className="text-center font-black text-xl">+{c.value}</p>
                        </div>
                    ))
                )}
            </div>

            <div className="flex flex-col items-center gap-2">
                <div className="w-20 h-28 bg-slate-800 rounded-xl border-2 border-white/20 shadow-2xl flex flex-col items-center justify-center">
                    <Library className="text-white/20 mb-1" size={24} />
                    <span className="text-xl font-black">{deck.length}</span>
                </div>
                <span className="text-[9px] font-black text-white/40 uppercase">Mazo</span>
            </div>
        </div>

        {/* Log de Acciones */}
        <div className="bg-black/60 backdrop-blur-sm px-6 py-2 rounded-full border border-white/10 text-[11px] font-bold text-emerald-400">
            {gameLog[0]}
        </div>

        {/* Tu Mano e Interacciones */}
        <div className="w-full max-w-2xl flex flex-col items-center gap-4 pb-2">
           <div className="flex gap-4 mb-2">
                {/* Descarte solo permitido si no has jugado cartas todavía */}
                {!hasActedThisTurn && (
                    <button 
                        onClick={handleDiscard}
                        disabled={selectedForDiscard.length !== 2}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-[10px] transition-all ${selectedForDiscard.length === 2 ? 'bg-orange-600 shadow-lg scale-105' : 'bg-slate-800 opacity-40'}`}
                    >
                        <RefreshCcw size={14} /> DESCARTAR 2
                    </button>
                )}
                <button 
                  onClick={endTurn}
                  className="bg-emerald-500 hover:bg-emerald-400 px-8 py-2.5 rounded-full font-black text-[10px] flex items-center gap-2 shadow-xl"
                >
                  <ArrowRightCircle size={14} /> FINALIZAR TURNO
                </button>
           </div>

           <div className="flex gap-1.5 justify-center flex-wrap">
             {playerHand.map((c, i) => (
                <CardItem 
                    key={i}
                    card={c} 
                    isSelected={selectedForDiscard.includes(i)}
                    onSelect={(e) => toggleDiscardSelection(e, i)}
                    onClick={() => playCard(c, i, true)}
                    disabled={currentTurn !== 'player'}
                    canSelectDiscard={!hasActedThisTurn}
                />
             ))}
           </div>

           {/* Capas de Estado */}
           {gameState === 'coin-flip' && (
             <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-6">
                <div className="text-center">
                    <Coins size={64} className="text-yellow-500 mx-auto mb-6 animate-spin" />
                    <h2 className="text-3xl font-black mb-8">SORTEO DE SAQUE</h2>
                    <div className="flex gap-4">
                        <button onClick={() => handleCoinFlip('Cara')} className="bg-white text-black px-10 py-4 rounded-2xl font-black hover:bg-emerald-400 transition-all">CARA</button>
                        <button onClick={() => handleCoinFlip('Sello')} className="bg-white text-black px-10 py-4 rounded-2xl font-black hover:bg-emerald-400 transition-all">SELLO</button>
                    </div>
                </div>
             </div>
           )}

           {gameState === 'dealing' && (
              <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
                <button onClick={handleDeal} className="bg-emerald-500 px-12 py-6 rounded-2xl font-black text-xl animate-pulse">
                    EMPEZAR PARTIDO
                </button>
              </div>
           )}
        </div>
      </div>
    </div>
  );
};

const CardItem = ({ card, onClick, onSelect, disabled, isSelected, canSelectDiscard }) => (
  <div className="relative group">
    {/* Botón minúsculo para seleccionar descarte */}
    {canSelectDiscard && !disabled && (
        <button 
            onClick={onSelect}
            className={`absolute -top-2 -right-1 z-30 p-1 rounded-full border shadow-lg transition-all ${isSelected ? 'bg-orange-500 border-white' : 'bg-slate-700 border-white/20'}`}
        >
            {isSelected ? <Trash2 size={10} /> : <RefreshCcw size={10} className="opacity-50" />}
        </button>
    )}

    <button
        onClick={onClick}
        disabled={disabled}
        className={`
        ${card?.color || 'bg-slate-800'} w-[82px] h-28 rounded-xl p-2 flex flex-col justify-between shadow-lg border-t-2 transition-all duration-200
        ${!disabled ? 'hover:-translate-y-4 hover:shadow-emerald-400/30 border-white/30' : 'opacity-40 grayscale border-white/5'}
        ${isSelected ? 'brightness-50 scale-90' : ''}
        `}
    >
        <div className="bg-black/20 self-start p-1 rounded">
            {card?.type === 'pass' && <Zap size={10} />}
            {card?.type === 'defense' && <ShieldAlert size={10} />}
            {card?.type === 'shoot' && <Target size={10} />}
        </div>
        <p className="text-[8px] font-black uppercase text-center leading-tight">{card?.name}</p>
        <div className="bg-black/30 rounded text-[6px] font-bold text-center py-1 flex items-center justify-center min-h-[20px]">
            {card?.detail}
        </div>
    </button>
  </div>
);

const SoccerBallIcon = ({size, className}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m12 12-4-2.5M12 12l4-2.5M12 12v5" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

export default App;