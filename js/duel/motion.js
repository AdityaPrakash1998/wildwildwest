// Motion input — "phone as gun" quick-draw detection.
//
// Uses DeviceMotion (accelerationIncludingGravity + rotationRate). Gravity is
// removed with a high-pass filter so the reading is linear acceleration; a fast
// draw flick produces a magnitude spike far above holding jitter. When the
// magnitude crosses a tunable threshold (with a refractory gap), onDraw fires.
//
// This is a plain input source: it just calls onDraw(). The duel state machine
// decides whether that draw is a false start (armed) or a real reaction (fire),
// exactly like the DRAW button / SPACE key — so button and motion coexist.
//
// iOS (incl. Chrome on iOS, which is WebKit) requires a user-gesture call to
// DeviceMotionEvent.requestPermission() before events flow.

const STORE_KEY = 'wwqd.motion.threshold';
const DEFAULT_THRESHOLD = 14;   // m/s^2 of linear acceleration
const MIN_THRESHOLD = 6;        // most sensitive (easy to trigger)
const MAX_THRESHOLD = 30;       // least sensitive (needs a hard flick)
const REFRACTORY_MS = 600;      // ignore repeat triggers within this window
const HP_ALPHA = 0.8;           // gravity low-pass factor (higher = slower gravity tracking)

export class MotionController {
  constructor({ onReading, onDraw } = {}) {
    this.onReading = onReading || (() => {});
    this.onDraw = onDraw || (() => {});
    this.threshold = clampThreshold(loadThreshold());
    this._running = false;
    this._g = { x: 0, y: 0, z: 0 };   // running gravity estimate
    this._haveG = false;
    this._lastDraw = -Infinity;
    this._orient = { beta: null, gamma: null };
    this._onMotion = this._onMotion.bind(this);
    this._onOrient = this._onOrient.bind(this);
  }

  static isSupported() {
    return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
  }
  isSupported() { return MotionController.isSupported(); }

  /** iOS 13+ WebKit gates motion behind a permission prompt that needs a user gesture. */
  needsPermission() {
    return this.isSupported() && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  /** Call from inside a user gesture (tap). Resolves true if motion may flow. */
  async requestPermission() {
    if (!this.isSupported()) return false;
    if (!this.needsPermission()) return true;
    try {
      const res = await DeviceMotionEvent.requestPermission();
      return res === 'granted';
    } catch { return false; }
  }

  start() {
    if (this._running || !this.isSupported()) return this._running;
    window.addEventListener('devicemotion', this._onMotion, { passive: true });
    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', this._onOrient, { passive: true });
    }
    this._running = true;
    return true;
  }

  stop() {
    if (!this._running) return;
    window.removeEventListener('devicemotion', this._onMotion);
    window.removeEventListener('deviceorientation', this._onOrient);
    this._running = false;
  }

  isRunning() { return this._running; }

  getThreshold() { return this.threshold; }
  setThreshold(v) {
    this.threshold = clampThreshold(v);
    try { localStorage.setItem(STORE_KEY, String(this.threshold)); } catch { /* storage may be blocked */ }
    return this.threshold;
  }

  // Sensitivity as a 0..100 slider value (right = more sensitive = lower threshold).
  setSensitivity(pct) {
    const p = Math.max(0, Math.min(100, Number(pct))) / 100;
    return this.setThreshold(MAX_THRESHOLD - p * (MAX_THRESHOLD - MIN_THRESHOLD));
  }
  getSensitivity() {
    return Math.round(((MAX_THRESHOLD - this.threshold) / (MAX_THRESHOLD - MIN_THRESHOLD)) * 100);
  }
  get range() { return { min: MIN_THRESHOLD, max: MAX_THRESHOLD }; }

  _onOrient(e) {
    this._orient = { beta: e.beta, gamma: e.gamma };
  }

  _onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    // High-pass: track gravity with a low-pass, subtract to get linear acceleration.
    if (!this._haveG) { this._g = { x: a.x, y: a.y, z: a.z }; this._haveG = true; }
    this._g.x = HP_ALPHA * this._g.x + (1 - HP_ALPHA) * a.x;
    this._g.y = HP_ALPHA * this._g.y + (1 - HP_ALPHA) * a.y;
    this._g.z = HP_ALPHA * this._g.z + (1 - HP_ALPHA) * a.z;
    const lx = a.x - this._g.x, ly = a.y - this._g.y, lz = a.z - this._g.z;
    const mag = Math.sqrt(lx * lx + ly * ly + lz * lz);

    const rr = e.rotationRate || {};
    const rot = Math.sqrt((rr.alpha || 0) ** 2 + (rr.beta || 0) ** 2 + (rr.gamma || 0) ** 2);

    this.onReading({ mag, rot, threshold: this.threshold, beta: this._orient.beta, gamma: this._orient.gamma });

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (mag >= this.threshold && now - this._lastDraw > REFRACTORY_MS) {
      this._lastDraw = now;
      this.onDraw({ mag, rot });
    }
  }
}

function clampThreshold(v) {
  v = Number(v);
  if (!isFinite(v)) return DEFAULT_THRESHOLD;
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, v));
}
function loadThreshold() {
  try { const s = localStorage.getItem(STORE_KEY); if (s != null) return Number(s); } catch { /* ignore */ }
  return DEFAULT_THRESHOLD;
}
