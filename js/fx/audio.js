// Synthesized sound FX (Web Audio) — no audio assets, everything generated.
// Punchy Western-duel cues. Create/resume the AudioContext from a user gesture
// (iOS requires it) via resume(); every cue is a no-op until the context runs.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._tick = null;
    this._primed = false;
  }

  /** Must be called inside a user gesture (tap) to unlock audio on iOS. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
    // iOS/WebKit: a resumed context stays silent until a real node plays inside a
    // gesture. Play a 1-sample silent buffer once to fully unlock output.
    if (!this._primed) {
      try {
        const buf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.ctx.destination);
        src.start(0);
        this._primed = true;
      } catch { /* ignore */ }
    }
  }

  setEnabled(on) { this.enabled = !!on; if (!on) this.stopTension(); }
  isEnabled() { return this.enabled; }

  get _t() { return this.ctx ? this.ctx.currentTime : 0; }
  _ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  _tone(type, f0, f1, t0, dur, peak) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return { o, g };
  }

  /** High-noon bell — bright metallic ring (inharmonic partials). */
  bell() {
    if (!this._ok()) return;
    const t = this._t;
    [880, 1319, 1760, 2637, 3520].forEach((f, i) => {
      this._tone('triangle', f * (1 + i * 0.0015), null, t, 1.7 - i * 0.22, 0.42 / (i + 1));
    });
  }

  /** Gunshot — noise crack through a lowpass + a low sine thump. Punchy. */
  gunshot() {
    if (!this._ok()) return;
    const t = this._t;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.25);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(1.0, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.25);
    this._tone('sine', 170, 45, t, 0.24, 0.95);
  }

  /** Dry fire / drew too soon. */
  click() {
    if (!this._ok()) return;
    const t = this._t;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.04);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.05);
  }

  /** Ricochet whizz — descending sawtooth. */
  ricochet() {
    if (!this._ok()) return;
    this._tone('sawtooth', 2600, 520, this._t, 0.4, 0.22);
  }

  /** Being shot — a heavy low thud. */
  hit() {
    if (!this._ok()) return;
    const t = this._t;
    this._tone('sine', 240, 70, t, 0.3, 0.9);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.12);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.13);
  }

  /** Victory fanfare — major arpeggio. */
  win() {
    if (!this._ok()) return;
    const t = this._t;
    [523, 659, 784, 1047].forEach((f, i) => this._tone('triangle', f, null, t + i * 0.12, 0.5, 0.4));
  }

  /** Defeat — descending, filtered minor tones. */
  lose() {
    if (!this._ok()) return;
    const t = this._t;
    [392, 330, 262].forEach((f, i) => this._tone('sawtooth', f, f * 0.98, t + i * 0.18, 0.6, 0.3));
  }

  /** Slow tension ticks while armed (a tense clock). */
  startTension() {
    if (!this._ok()) return;
    this.stopTension();
    const once = () => {
      if (!this._ok()) return;
      const t = this._t;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = 1150;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.07);
    };
    once();
    this._tick = setInterval(once, 520);
  }
  stopTension() { if (this._tick) { clearInterval(this._tick); this._tick = null; } }
}
