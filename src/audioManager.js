export class AudioManager {
  constructor({ ambienceUrl = null } = {}) {
    this.ambienceUrl = ambienceUrl;
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambienceGain = null;
    this.ambienceNodes = null;
    this.ambienceElement = null;
    this.enabled = true;
    this.masterVolume = 0.8;
    this.ambienceVolume = 0.5;
    this.sfxVolume = 0.9;
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

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 520;
    lowpass.Q.value = 0.9;

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 180;
    bandpass.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = this.ambienceVolume * 0.16;

    source.connect(lowpass);
    lowpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.ambienceGain);
    source.start();

    this.ambienceNodes = { source, gain };
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

  playSfx(name) {
    this.init();
    if (!this.ctx || !this.enabled) {
      return;
    }

    switch (name) {
      case 'pass':
        this.playPass();
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
      case 'ui_discard':
        this.playDiscardButton();
        break;
      case 'ui_end_turn':
        this.playEndTurnButton();
        break;
      case 'goal':
        this.playGoal();
        break;
      case 'whistle':
        this.playWhistle();
        break;
      default:
        break;
    }
  }

  playTone({ frequency, duration = 0.12, type = 'sine', gain = 0.2, slideTo = null }) {
    if (!this.ctx || !this.sfxGain) {
      return;
    }
    const now = this.ctx.currentTime;
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

  playPass() {
    this.playTone({ frequency: 680, duration: 0.08, type: 'triangle', gain: 0.15, slideTo: 760 });
  }

  playShot() {
    this.playTone({ frequency: 320, duration: 0.2, type: 'sawtooth', gain: 0.18, slideTo: 140 });
  }

  playCard() {
    this.playTone({ frequency: 200, duration: 0.06, type: 'square', gain: 0.2 });
    this.playTone({ frequency: 140, duration: 0.08, type: 'square', gain: 0.14 });
  }

  playCardPlay() {
    this.playTone({ frequency: 260, duration: 0.05, type: 'square', gain: 0.18, slideTo: 210 });
  }

  playDiscardButton() {
    this.playTone({ frequency: 520, duration: 0.08, type: 'triangle', gain: 0.16, slideTo: 360 });
  }

  playEndTurnButton() {
    this.playTone({ frequency: 760, duration: 0.06, type: 'triangle', gain: 0.14, slideTo: 980 });
  }

  playGoal() {
    this.playTone({ frequency: 392, duration: 0.16, type: 'triangle', gain: 0.18, slideTo: 523 });
    this.playTone({ frequency: 523, duration: 0.22, type: 'triangle', gain: 0.16, slideTo: 659 });
  }

  playWhistle() {
    this.playTone({ frequency: 1800, duration: 0.12, type: 'square', gain: 0.15 });
    this.playTone({ frequency: 1600, duration: 0.1, type: 'square', gain: 0.12 });
  }
}
