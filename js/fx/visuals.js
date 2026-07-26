// Visual FX — muzzle flash, blood splash, rising gun smoke (canvas particles),
// red vignette, high-noon flash, and screen shake. All synthesized; no assets.
// Elements are created lazily and overlay the whole viewport. Honors
// prefers-reduced-motion.

let canvas, ctx, flashEl, particles = [], raf = 0;

const reduced = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initFX() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'fx-canvas';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  flashEl = document.createElement('div');
  flashEl.id = 'fx-flash';
  document.body.appendChild(flashEl);
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function pulse(kind, ms) {
  initFX();
  flashEl.className = '';
  void flashEl.offsetWidth; // restart the CSS animation
  flashEl.className = 'show ' + kind;
  setTimeout(() => { if (flashEl.className === 'show ' + kind) flashEl.className = ''; }, ms);
}

export function muzzleFlash() { if (!reduced()) pulse('muzzle', 180); }
export function highNoonFlash() { if (!reduced()) pulse('noon', 340); }

/** Red splatter from roughly the upper-center, with a red vignette pulse. */
export function bloodSplash(intensity = 1) {
  initFX();
  pulse('blood', 520);
  if (reduced()) return; // vignette only, no particles
  const cx = window.innerWidth * (0.5 + (Math.random() - 0.5) * 0.2);
  const cy = window.innerHeight * (0.42 + (Math.random() - 0.5) * 0.15);
  const n = Math.floor(46 * intensity);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 12 * intensity;
    particles.push({
      kind: 'blood',
      x: cx, y: cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 2,
      r: 2 + Math.random() * 6 * intensity,
      life: 1,
      decay: 0.012 + Math.random() * 0.02,
      hue: 349 + Math.random() * 8,
    });
  }
  if (!raf) raf = requestAnimationFrame(step);
}

/** Rising powder smoke from a point (the muzzle). */
export function smoke(x, y, count = 16) {
  initFX();
  if (reduced()) return;
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.1; // mostly upward
    const sp = 0.6 + Math.random() * 2.2;
    particles.push({
      kind: 'smoke',
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 10,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: 5 + Math.random() * 7,
      life: 1,
      decay: 0.006 + Math.random() * 0.01,
    });
  }
  if (!raf) raf = requestAnimationFrame(step);
}

function step() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (const p of particles) {
    if (p.kind === 'smoke') {
      p.vy -= 0.02;         // buoyancy
      p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy;
      p.r += 0.5;           // billow
      p.life -= p.decay;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life) * 0.4;
      ctx.fillStyle = `hsl(32 6% ${55 + p.life * 10}%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      p.vy += 0.35;         // gravity
      p.x += p.vx; p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = `hsl(${p.hue} 85% ${26 + p.life * 12}%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + p.life * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 60 && p.y > -100);
  if (particles.length) raf = requestAnimationFrame(step);
  else { raf = 0; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
}

/** Shake a target element. intensity: 'sm' | 'md' | 'lg'. */
export function screenShake(el, intensity = 'md') {
  if (!el || reduced()) return;
  const cls = 'shake-' + intensity;
  el.classList.remove('shake-sm', 'shake-md', 'shake-lg');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 520);
}
