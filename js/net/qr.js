// Local QR rendering (no external calls) via the vendored qrcode-generator lib.
// Encodes the join URL so the opponent just scans it to open the exact link.
// The lib is a classic script whose top-level `var qrcode` becomes window.qrcode.
let libPromise = null;

function ensureQrLib(libUrl = '../../vendor/qrcode.js') {
  if (typeof window !== 'undefined' && window.qrcode) return Promise.resolve(window.qrcode);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(libUrl, import.meta.url).href;
    s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode global missing')));
    s.onerror = () => reject(new Error('failed to load qrcode lib'));
    document.head.appendChild(s);
  });
  return libPromise;
}

/** Render `text` as a crisp, high-contrast QR (SVG) into `el` — reliable to scan. */
export async function renderQR(el, text, opts = {}) {
  if (!el) return;
  const { margin = 3, dark = '#161009', light = '#f7ecd0' } = opts;
  try {
    const qrcode = await ensureQrLib();
    const qr = qrcode(0, 'M'); // type 0 = auto-fit; 'M' = ~15% error correction
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const dim = n + margin * 2;
    let rects = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1"/>`;
      }
    }
    el.innerHTML =
      `<svg viewBox="0 0 ${dim} ${dim}" width="100%" height="100%" ` +
      `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<g fill="${dark}">${rects}</g></svg>`;
  } catch {
    el.textContent = 'QR unavailable — use the code below.';
  }
}
