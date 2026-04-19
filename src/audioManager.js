export class AudioManager {
  constructor({ ambienceUrl = null, sfxUrls = {} } = {}) {
    this.ambienceUrl = ambienceUrl;
    this.sfxUrls = sfxUrls;
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambienceGain = null;
    this.ambienceNodes = null;
    this.ambienceElement = null;
    this.enabled = true;
    this.masterVolume = 0.8;
    this.ambienceVolume = 0.5;
    this.sfxVolume = 0.8;
    this._tensionLevel = 0; // 0=normal, 1=shot pending, 2=match point
  }

  init() {
    if (this.ctx) {
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.ambienceGain = this.ctx.createGain();

    this.masterGain.gain.value = this.masterVolume;
    this.sfxGain.gain.value = this.sfxVolume;
    this.ambienceGain.gain.value = this.ambienceVolume;

    this.sfxGain.connect(this.masterGain);
    this.ambienceGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  unlock() {
    this.init();
    if (!this.ctx) {
      return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  destroy() {
    this.stopAmbience();
    if (this.ambienceElement) {
      this.ambienceElement.pause();
      this.ambienceElement.src = '';
      this.ambienceElement = null;
    }
    if (this.ctx) {
      this.ctx.close();
    }
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambienceGain = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.masterGain) {
      this.masterGain.gain.value = this.enabled ? this.masterVolume : 0;
    }
    if (this.ambienceElement) {
      this.ambienceElement.muted = !this.enabled;
    }
  }

  setAmbienceVolume(volume) {
    const normalizedVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    this.ambienceVolume = normalizedVolume;

    if (this.ambienceElement) {
      this.ambienceElement.volume = this.ambienceVolume;
    }

    if (this.ambienceNodes?.gain) {
      this.ambienceNodes.gain.gain.value = this.ambienceVolume * 0.16;
    }
  }

  setSfxVolume(volume) {
    const normalizedVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    this.sfxVolume = normalizedVolume;
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume;
    }
  }

  /**
   * Ajusta la tensión musical según el estado del juego.
   * level 0 = normal, 1 = disparo en curso, 2 = match point
   */
  setTensionLevel(level) {
    const nextLevel = Math.max(0, Math.min(2, level));
    if (nextLevel === this._tensionLevel) return;
    this._tensionLevel = nextLevel;
    this._applyTensionToAmbience();
  }

  _applyTensionToAmbience() {
    if (!this.ctx || !this.ambienceNodes?.gain) return;
    const now = this.ctx.currentTime;
    const baseVol = this.ambienceVolume * 0.16;
    const targetVol = baseVol * (1 + this._tensionLevel * 0.6);
    this.ambienceNodes.gain.gain.linearRampToValueAtTime(targetVol, now + 0.8);

    if (this.ambienceNodes.filter) {
      const targetFreq = 520 + this._tensionLevel * 320;
      this.ambienceNodes.filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.8);
    }

    if (this.ambienceElement) {
      const targetVolumeEl = Math.min(1, this.ambienceVolume * (1 + this._tensionLevel * 0.35));
      this.ambienceElement.volume = targetVolumeEl;
    }
  }

  startAmbience() {
    if (!this.enabled) {
      return;
    }

    if (this.ambienceUrl) {
      if (!this.ambienceElement) {
        this.ambienceElement = new Audio(this.ambienceUrl);
        this.ambienceElement.loop = true;
        this.ambienceElement.volume = this.ambienceVolume;
      }

      this.ambienceElement.muted = false;
      this.ambienceElement.play().catch(() => {
        // If browser blocks autoplay, ambience starts after next user interaction.
      });
      return;
    }

    this.init();
    if (!this.ctx || this.ambienceNodes) {
      return;
    }

    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.35;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.9;

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 180;
    bandpass.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = this.ambienceVolume * 0.16;

    source.connect(filter);
    filter.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.ambienceGain);
    source.start();

    this.ambienceNodes = { source, gain, filter };
  }

  stopAmbience() {
    if (this.ambienceElement) {
      this.ambienceElement.pause();
      this.ambienceElement.currentTime = 0;
    }

    if (!this.ambienceNodes) {
      return;
    }

    try {
      this.ambienceNodes.source.stop();
    } catch {
      // source may already be stopped
    }
    this.ambienceNodes.source.disconnect();
    this.ambienceNodes.gain.disconnect();
    this.ambienceNodes = null;
  }

  pauseAmbience() {
    if (this.ambienceElement) {
      this.ambienceElement.pause();
    }

    if (!this.ambienceNodes?.gain || !this.ctx) {
      return;
    }

    this.ambienceNodes.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
  }

  resumeAmbience() {
    if (!this.enabled) {
      return;
    }

    if (this.ambienceElement) {
      this.ambienceElement.play().catch(() => {
        // Browser may block playback until user interaction.
      });
    }

    if (!this.ambienceNodes?.gain || !this.ctx) {
      return;
    }

    this.ambienceNodes.gain.gain.setValueAtTime(this.ambienceVolume * 0.16, this.ctx.currentTime);
  }

  playSfx(name) {
    if (!this.enabled) {
      return;
    }

    switch (name) {
      case 'pass':
        this.playPass();
        break;
      case 'pass_long':
        this.playPassLong();
        break;
      case 'pass_aerial':
        this.playPassAerial();
        break;
      case 'shot':
        this.playShot();
        break;
      case 'card':
        this.playCard();
        break;
      case 'card_play':
        this.playCardPlay();
        break;
      case 'card_draw':
        this.playCardDraw();
        break;
      case 'ui_discard':
        this.playDiscardButton();
        break;
      case 'ui_end_turn':
        this.playEndTurnButton();
        break;
      case 'goal':
        if (this.sfxUrls.goal) {
          this.playAudioFile(this.sfxUrls.goal, 1);
        } else {
          this.playGoal();
        }
        break;
      case 'foul':
        if (this.sfxUrls.foul) {
          this.playAudioFile(this.sfxUrls.foul, 1);
        } else {
          this.playFoul();
        }
        break;
      case 'tackle':
        this.playTackle();
        break;
      case 'save':
        this.playSave();
        break;
      case 'yellow_card':
        this.playYellowCard();
        break;
      case 'red_card':
        this.playRedCard();
        break;
      case 'var':
        this.playVar();
        break;
      case 'chilena':
        this.playChilena();
        break;
      case 'whistle':
        this.playWhistle();
        break;
      case 'whistle_long':
        this.playWhistleLong();
        break;
      case 'countdown':
        this.playCountdownAlert();
        break;
      case 'match_end':
        this.playMatchEnd();
        break;
      case 'card_hover':
        this.playCardHover();
        break;
      default:
        break;
    }
  }

  ensureSynthReady() {
    this.init();
    return Boolean(this.ctx && this.sfxGain);
  }

  playAudioFile(url, volumeScale = 1) {
    if (!url || !this.enabled) {
      return;
    }

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = Math.max(0, Math.min(1, this.sfxVolume * volumeScale));
    audio.play().catch(() => {
      // Browser may block playback until user interaction.
    });
  }

  playTone({ frequency, duration = 0.12, type = 'sine', gain = 0.2, slideTo = null, delay = 0 }) {
    if (!this.ensureSynthReady()) {
      return;
    }
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }

    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(env);
    env.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // ---- SONIDOS DE PASE ----
  playPass() {
    this.playTone({ frequency: 680, duration: 0.08, type: 'triangle', gain: 0.15, slideTo: 760 });
  }

  playPassLong() {
    this.playTone({ frequency: 540, duration: 0.12, type: 'triangle', gain: 0.16, slideTo: 820 });
  }

  playPassAerial() {
    this.playTone({ frequency: 480, duration: 0.18, type: 'triangle', gain: 0.14, slideTo: 920 });
    this.playTone({ frequency: 920, duration: 0.08, type: 'triangle', gain: 0.08, delay: 0.12 });
  }

  // ---- DISPARO ----
  playShot() {
    this.playTone({ frequency: 320, duration: 0.2, type: 'sawtooth', gain: 0.18, slideTo: 140 });
    this.playTone({ frequency: 200, duration: 0.06, type: 'square', gain: 0.1, delay: 0.04 });
  }

  playChilena() {
    this.playTone({ frequency: 260, duration: 0.08, type: 'sawtooth', gain: 0.14, slideTo: 580 });
    this.playTone({ frequency: 580, duration: 0.24, type: 'sawtooth', gain: 0.2, slideTo: 140, delay: 0.08 });
  }

  // ---- DEFENSA ----
  playTackle() {
    this.playTone({ frequency: 120, duration: 0.14, type: 'sawtooth', gain: 0.22, slideTo: 60 });
    this.playTone({ frequency: 280, duration: 0.06, type: 'square', gain: 0.12, delay: 0.05 });
  }

  playSave() {
    this.playTone({ frequency: 440, duration: 0.1, type: 'square', gain: 0.18, slideTo: 320 });
    this.playTone({ frequency: 320, duration: 0.14, type: 'triangle', gain: 0.14, slideTo: 220, delay: 0.08 });
  }

  // ---- CARTAS DE FALTA ----
  playFoul() {
    this.playWhistle();
  }

  playYellowCard() {
    this.playTone({ frequency: 1200, duration: 0.06, type: 'square', gain: 0.18 });
    this.playTone({ frequency: 800, duration: 0.1, type: 'square', gain: 0.12, delay: 0.06 });
  }

  playRedCard() {
    this.playTone({ frequency: 1800, duration: 0.08, type: 'square', gain: 0.2 });
    this.playTone({ frequency: 1400, duration: 0.12, type: 'square', gain: 0.18, delay: 0.06 });
    this.playTone({ frequency: 900, duration: 0.18, type: 'square', gain: 0.14, delay: 0.16 });
  }

  // ---- VAR ----
  playVar() {
    this.playTone({ frequency: 880, duration: 0.05, type: 'square', gain: 0.14 });
    this.playTone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.14, delay: 0.07 });
    this.playTone({ frequency: 880, duration: 0.05, type: 'square', gain: 0.14, delay: 0.14 });
  }

  // ---- UI ----
  playCard() {
    this.playTone({ frequency: 200, duration: 0.06, type: 'square', gain: 0.2 });
    this.playTone({ frequency: 140, duration: 0.08, type: 'square', gain: 0.14 });
  }

  playCardPlay() {
    this.playTone({ frequency: 260, duration: 0.05, type: 'square', gain: 0.18, slideTo: 210 });
  }

  playCardDraw() {
    this.playTone({ frequency: 380, duration: 0.06, type: 'triangle', gain: 0.12, slideTo: 480 });
  }

  playCardHover() {
    this.playTone({ frequency: 1000, duration: 0.018, type: 'sine', gain: 0.06 });
  }

  playDiscardButton() {
    this.playTone({ frequency: 520, duration: 0.08, type: 'triangle', gain: 0.16, slideTo: 360 });
  }

  playEndTurnButton() {
    this.playTone({ frequency: 760, duration: 0.06, type: 'triangle', gain: 0.14, slideTo: 980 });
  }

  // ---- GOL ----
  playGoal() {
    this.playTone({ frequency: 392, duration: 0.16, type: 'triangle', gain: 0.2, slideTo: 523 });
    this.playTone({ frequency: 523, duration: 0.22, type: 'triangle', gain: 0.18, slideTo: 659, delay: 0.14 });
    this.playTone({ frequency: 659, duration: 0.28, type: 'triangle', gain: 0.16, slideTo: 784, delay: 0.3 });
  }

  // ---- SILBATOS ----
  playWhistle() {
    this.playTone({ frequency: 1800, duration: 0.12, type: 'square', gain: 0.15 });
    this.playTone({ frequency: 1600, duration: 0.1, type: 'square', gain: 0.12 });
  }

  playWhistleLong() {
    this.playTone({ frequency: 1760, duration: 0.32, type: 'square', gain: 0.18 });
    this.playTone({ frequency: 1600, duration: 0.14, type: 'square', gain: 0.14, delay: 0.3 });
  }

  // ---- FIN DE PARTIDA ----
  playMatchEnd() {
    [0, 0.16, 0.32, 0.52].forEach((delay, i) => {
      this.playTone({
        frequency: 392 * Math.pow(1.25, i),
        duration: 0.22,
        type: 'triangle',
        gain: 0.16,
        slideTo: 523 * Math.pow(1.2, i),
        delay
      });
    });
  }

  // ---- CUENTA REGRESIVA ----
  playCountdownAlert() {
    this.playTone({ frequency: 920, duration: 0.08, type: 'square', gain: 0.12 });
    this.playTone({ frequency: 760, duration: 0.12, type: 'square', gain: 0.1 });
  }
}
