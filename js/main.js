// App controller: rig check → lobby → pairing → duel (Phase 3).
import { SIGNALING_URL, NET_MODE } from './config.js';
import { PeerConn, makeRoomCode } from './net/peerconn.js';
import { renderQR } from './net/qr.js';
import { Signaling } from './net/signaling.js';
import { PeerLink } from './net/webrtc.js';
import { initCodec, encode, decode } from './net/codec.js';
import { ClockSync } from './duel/clock.js';
import { Duel } from './duel/duel.js';
import { MotionController } from './duel/motion.js';
import { SoundFX } from './fx/audio.js';
import { initFX, muzzleFlash, highNoonFlash, bloodSplash, screenShake, smoke } from './fx/visuals.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
let bestOf = 3;
const sfx = new SoundFX();

// ---------- screen router ----------
const screens = {};
document.querySelectorAll('.screen').forEach((s) => (screens[s.id] = s));
function show(id) { for (const s of Object.values(screens)) s.classList.toggle('active', s.id === id); }
const $ = (id) => document.getElementById(id);

// iOS "Shake to Undo" pops the "Undo Typing" dialog on a flick when a text field
// still holds an undo stack (the guest typed the room code). Releasing focus from
// the inputs before gameplay removes the editable first responder, so the flick
// no longer triggers it.
function blurActive() {
  const el = document.activeElement;
  if (el && typeof el.blur === 'function') el.blur();
  ['join-code', 'join-link'].forEach((id) => { const n = $(id); if (n) n.blur(); });
}

// ---------- state ----------
let signaling = null;
let link = null;
let role = null;
let myPlayerId = null;
let codecReady = false;
let codecError = null;
let clock = null;
let duel = null;
let calibrating = false;
let motionActive = false;
const motion = new MotionController({
  onReading: (r) => onMotionReading(r),
  onDraw: () => onMotionDraw(),
});

// ---------- rig check (start screen) ----------
const diagList = $('diag-list');
function addRow(label, value, ok) {
  const li = document.createElement('li');
  li.appendChild(Object.assign(document.createElement('span'), { className: 'diag-label' }));
  li.appendChild(Object.assign(document.createElement('span'), { className: 'diag-value' }));
  diagList.appendChild(li);
  setRow(li, label, value, ok);
  return li;
}
function setRow(li, label, value, ok) {
  li.className = 'diag-row' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
  li.querySelector('.diag-label').textContent = label;
  li.querySelector('.diag-value').textContent = value;
}
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  return 'Desktop / Other';
}
function renderRigCheck() {
  diagList.replaceChildren();
  addRow('Platform', detectPlatform());
  addRow('Secure context (HTTPS)', String(window.isSecureContext), window.isSecureContext);
  const hasMotion = typeof window.DeviceMotionEvent !== 'undefined';
  const hasOrient = typeof window.DeviceOrientationEvent !== 'undefined';
  addRow('DeviceMotion API', hasMotion ? 'available' : 'missing', hasMotion);
  addRow('DeviceOrientation API', hasOrient ? 'available' : 'missing', hasOrient);
  const needsPerm = hasMotion && typeof DeviceMotionEvent.requestPermission === 'function';
  addRow('iOS motion permission', needsPerm ? 'required (granted on tap)' : 'not required');
  addRow('Transport', NET_MODE === 'peerjs' ? 'PeerJS Cloud (serverless)' : 'local ws server');
  if (NET_MODE === 'ws') addRow('Signaling URL', SIGNALING_URL);
}

// ---------- debug log (duel screen) ----------
function log(msg) {
  const li = document.createElement('li');
  li.className = 'diag-row';
  li.textContent = msg;
  const el = $('log');
  if (!el) return;
  el.appendChild(li);
  el.scrollTop = el.scrollHeight;
}

async function ensureCodec() {
  if (codecReady) return true;
  try { await initCodec(); codecReady = true; codecError = null; }
  catch (e) { codecError = (e && e.message) ? e.message : String(e); console.error('codec init failed', e); }
  return codecReady;
}

// ---------- signaling wiring ----------
function connectSignaling() {
  if (signaling) return signaling;
  signaling = new Signaling(SIGNALING_URL).connect();
  signaling.addEventListener('created', (e) => onCreated(e.detail));
  signaling.addEventListener('joined', (e) => onJoined(e.detail));
  signaling.addEventListener('peer-joined', () => onPeerJoined());
  signaling.addEventListener('signal', (e) => link && link.handleSignal(e.detail.data));
  signaling.addEventListener('peer-left', () => onPeerLeft());
  signaling.addEventListener('error', (e) => onSignalError(e.detail));
  return signaling;
}
function sendWhenOpen(obj) {
  connectSignaling();
  if (signaling.isOpen()) signaling.send(obj);
  else signaling.addEventListener('open', () => signaling.send(obj), { once: true });
}
function makeLink(r) {
  role = r;
  link = new PeerLink({
    role: r,
    iceServers: ICE_SERVERS,
    sendSignal: (data) => signaling.send({ type: 'signal', data }),
    onState: (st) => { const c = $('conn-status'); if (c) c.textContent = 'Connection: ' + st; },
    onOpen: () => onChannelOpen(),
    onMessage: (bytes) => onChannelMessage(bytes),
  });
  return link;
}

// host
function createDuel() {
  $('lobby-hint').textContent = '';
  if (NET_MODE === 'peerjs') {
    role = 'host';
    myPlayerId = 1;
    link = makePeerConn();
    link.host(makeRoomCode());
  } else {
    sendWhenOpen({ type: 'create' });
  }
}
function onCreated(m) {
  myPlayerId = m.playerId;
  const url = new URL(location.href);
  url.searchParams.set('room', m.code);
  $('room-code').textContent = m.code;
  $('join-link').value = url.toString();
  renderQR($('qr'), url.toString());
  $('lobby-choose').hidden = true;
  $('lobby-host').hidden = false;
}
function onPeerJoined() {
  $('host-status').textContent = 'Opponent joined — connecting…';
  makeLink('host');
  show('screen-connecting');
  link.start();
}

// guest
function joinDuel(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (code.length < 4) { $('lobby-hint').textContent = 'Enter the 4-character code.'; return; }
  $('lobby-hint').textContent = '';
  blurActive();
  if (NET_MODE === 'peerjs') {
    role = 'guest';
    myPlayerId = 2;
    link = makePeerConn();
    show('screen-connecting');
    link.join(code);
  } else {
    sendWhenOpen({ type: 'join', code });
  }
}

// PeerJS transport wired to the same duel callbacks as the ws path.
function makePeerConn() {
  return new PeerConn({
    onRoomReady: (code) => onCreated({ code, playerId: 1 }),
    onOpen: () => onChannelOpen(),
    onMessage: (bytes) => onChannelMessage(bytes),
    onState: (st) => { const c = $('conn-status'); if (c) c.textContent = 'Connection: ' + st; },
    onError: (type) => onPeerError(type),
    log: (m) => log(m),
  });
}
function onPeerError(type) {
  const map = {
    'peer-unavailable': 'No duel with that code (or the host left).',
    'unavailable-id': 'That code is taken — create a new duel.',
    'network': 'Cannot reach the matchmaking broker.',
    'server-error': 'Matchmaking broker error — try again.',
    'browser-incompatible': 'This browser lacks WebRTC support.',
  };
  $('lobby-choose').hidden = false;
  $('lobby-host').hidden = true;
  $('lobby-hint').textContent = map[type] || ('Connection error: ' + type);
  show('screen-lobby');
}
function onJoined(m) { myPlayerId = m.playerId; makeLink('guest'); show('screen-connecting'); }

function onPeerLeft() {
  const c = $('conn-status'); if (c) c.textContent = 'Opponent left.';
  log('Opponent left the duel.');
}
function onSignalError(m) {
  const map = { 'no-such-room': 'No duel with that code.', 'room-full': 'That duel is already full.' };
  $('lobby-choose').hidden = false;
  $('lobby-host').hidden = true;
  $('lobby-hint').textContent = map[m.reason] || ('Error: ' + m.reason);
  show('screen-lobby');
}

// ---------- gameplay channel (codec-wrapped) ----------
function channelSend(obj) {
  if (!codecReady || !link) return;
  try { link.send(encode(obj)); } catch (e) { log('send error: ' + e.message); }
}
function onChannelMessage(bytes) {
  if (!codecReady) return;
  let msg;
  try { msg = decode(bytes); } catch (e) { log('decode error: ' + e.message); return; }
  if (msg.time_sync_ping) { if (clock) clock.respondToPing(msg.time_sync_ping); return; }
  if (msg.time_sync_pong) { if (clock) clock.onPong(msg.time_sync_pong); return; }
  if (duel) duel.onMessage(msg);
}

async function onChannelOpen() {
  blurActive();
  show('screen-duel');
  $('me-id').textContent = myPlayerId;
  $('best-of').textContent = bestOf;
  initFX();
  log('Transport: ' + (NET_MODE === 'peerjs' ? 'PeerJS Cloud (serverless broker)' : 'local ws server'));
  $('duel-hint').textContent = motionActive
    ? 'Flick your phone to draw — or tap DRAW / press SPACE.'
    : 'Tap DRAW or press SPACE the instant the bell rings.';

  if (!codecReady) await ensureCodec();
  if (!codecReady) { $('stage-prompt').textContent = 'Codec failed'; $('stage-sub').textContent = codecError || ''; return; }

  clock = new ClockSync(channelSend);
  duel = new Duel({ role, myPlayerId, bestOf, send: channelSend, onView: renderDuel, getOffset: () => clock.offset, onEvent: onDuelEvent });
  if (role === 'host') channelSend({ control: { kind: 'config', round: bestOf } });

  // Guest measures clock offset to the host; the host is the reference and just
  // answers pings (handled in onChannelMessage).
  if (role === 'guest') {
    log('Syncing clock to host…');
    clock.sync().then((best) => {
      log(best && best.rtt != null
        ? `Clock synced: offset ${Math.round(best.offset)}ms, rtt ${Math.round(best.rtt)}ms`
        : 'Clock sync: no samples');
    });
    clock.startAutoSync();
  }
  duel.reset();
}

// ---------- duel view ----------
function fmtResult(res) {
  if (!res) return '—';
  if (res.missed) return 'no draw';
  if (res.falseStart) return 'false start';
  return Math.round(res.reactionMs) + 'ms';
}
function renderDuel(v) {
  $('round-num').textContent = v.round || '–';
  $('score-me').textContent = v.scoreMe;
  $('score-opp').textContent = v.scoreOpp;
  $('best-of').textContent = v.bestOf;

  const prompt = $('stage-prompt');
  const sub = $('stage-sub');
  const action = $('btn-action');
  const draw = $('btn-draw');
  const stage = $('duel-stage');

  draw.hidden = !(v.state === 'armed' || v.state === 'fire');
  action.hidden = true;
  stage.classList.toggle('armed', v.state === 'armed');
  stage.classList.toggle('fire', v.state === 'fire');

  switch (v.state) {
    case 'idle':
      if (role === 'host') { prompt.textContent = 'High noon awaits.'; sub.textContent = 'Draw on the bell — fastest wins.'; action.hidden = false; action.textContent = 'Start Duel'; }
      else { prompt.textContent = 'Waiting for host…'; sub.textContent = 'They call the duel.'; }
      break;
    case 'armed':
      prompt.textContent = 'Hold steady…';
      sub.textContent = 'Wait for it. Don’t flinch.';
      break;
    case 'fire':
      if (v.myResult) {
        prompt.textContent = v.myResult.falseStart ? 'Too soon!' : v.myResult.missed ? 'Missed!' : fmtResult(v.myResult);
        sub.textContent = v.waiting ? 'Waiting for opponent…' : '';
      } else {
        prompt.textContent = 'DRAW!';
        sub.textContent = '';
      }
      break;
    case 'round': {
      prompt.textContent = v.roundWinner === 'me' ? 'You win the round!' : v.roundWinner === 'opp' ? 'You lost the round.' : 'Stand-off — replay!';
      sub.textContent = `You ${fmtResult(v.myResult)} · Opp ${fmtResult(v.peerResult)}`;
      break;
    }
    case 'match':
      prompt.textContent = v.matchWinner === 'me' ? 'You win the duel!' : 'You lost the duel.';
      sub.textContent = `Final ${v.scoreMe}–${v.scoreOpp}  (You ${fmtResult(v.myResult)} · Opp ${fmtResult(v.peerResult)})`;
      if (role === 'host') { action.hidden = false; action.textContent = 'Rematch'; }
      break;
  }
}

// ---------- motion input ("phone as gun") ----------
function enableMotion() {
  if (!motion.isSupported()) return;
  // requestPermission() must be initiated synchronously inside the user gesture.
  motion.requestPermission().then((granted) => {
    if (granted) { motion.start(); motionActive = true; log('Motion enabled — flick to draw.'); }
    else { motionActive = false; log('Motion permission denied — DRAW button still works.'); }
    updateCalPermUI();
  }).catch(() => {});
}

function onMotionDraw() {
  if (calibrating) { flashCalDetected(); return; }
  if (duel && (duel.state === 'armed' || duel.state === 'fire')) duel.handleDraw();
}

function onMotionReading(r) {
  if (!calibrating) return;
  const { max } = motion.range;
  const pct = Math.max(0, Math.min(1, r.mag / (max * 1.2)));
  const fill = $('cal-fill');
  fill.style.width = (pct * 100).toFixed(0) + '%';
  fill.classList.toggle('hot', r.mag >= r.threshold);
  $('cal-mag').textContent = r.mag.toFixed(1);
}

let calFlashTimer = null;
function flashCalDetected() {
  const el = $('cal-flash');
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(calFlashTimer);
  calFlashTimer = setTimeout(() => el.classList.remove('show'), 460);
}

function positionCalThreshold() {
  const { max } = motion.range;
  const pct = Math.max(0, Math.min(1, motion.getThreshold() / (max * 1.2)));
  $('cal-thresh').style.left = (pct * 100).toFixed(0) + '%';
  $('cal-thresh-val').textContent = motion.getThreshold().toFixed(0);
}

function updateCalPermUI() {
  const btn = $('btn-enable-motion');
  const status = $('cal-status');
  if (!btn || !status) return;
  if (!motion.isSupported()) {
    btn.hidden = true;
    status.textContent = 'No motion sensor here — the DRAW button works everywhere.';
  } else if (motion.isRunning()) {
    btn.hidden = true;
    status.textContent = 'Sensing… flick your phone to test.';
  } else {
    btn.hidden = false;
    status.textContent = motion.needsPermission()
      ? 'Tap “Enable Motion”, allow the prompt, then flick.'
      : 'Tap “Enable Motion” to start sensing.';
  }
}

function openCalibration() {
  blurActive();
  calibrating = true;
  $('cal-slider').value = String(motion.getSensitivity());
  positionCalThreshold();
  updateCalPermUI();
  show('screen-calibrate');
}
function closeCalibration() {
  calibrating = false;
  show('screen-start');
}

// ---------- audio + visual FX ----------
function shake(intensity) { screenShake(document.querySelector('#screen-duel .content'), intensity); }
function haptic(pattern) { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } } }
function gunSmoke() {
  const g = $('gun-wrap');
  if (!g) return;
  const r = g.getBoundingClientRect();
  smoke(r.left + r.width * 0.575, r.top + r.height * 0.10); // muzzle = top-center of the gun
}
function recoilGun() {
  const g = $('gun-wrap');
  if (!g) return;
  g.classList.remove('recoil');
  void g.offsetWidth; // restart the animation
  g.classList.add('recoil');
  setTimeout(() => g.classList.remove('recoil'), 400);
}
// Reacts to discrete duel events. Blood hits the player who LOST (got shot).
function onDuelEvent(name, data) {
  switch (name) {
    case 'arm':
      sfx.startTension();
      if (role === 'guest' && clock) clock.stopAutoSync();
      break;
    case 'bell':
      sfx.stopTension();
      sfx.bell();
      highNoonFlash();
      break;
    case 'draw':
      sfx.stopTension();
      if (data.falseStart) sfx.click();
      else if (data.missed) { /* no shot fired */ }
      else { sfx.gunshot(); muzzleFlash(); recoilGun(); shake('md'); gunSmoke(); haptic([0, 45, 25, 20]); }
      break;
    case 'result':
      if (role === 'guest' && clock) clock.startAutoSync();
      if (data.matchOver) {
        if (data.matchWinner === 'me') sfx.win();
        else { sfx.lose(); bloodSplash(1.4); shake('lg'); }
      } else if (data.roundWinner === 'opp') {
        sfx.hit(); bloodSplash(1); shake('md');
      } else if (data.roundWinner === 'me') {
        sfx.ricochet();
      }
      break;
  }
}

// ---------- inputs ----------
$('btn-action').addEventListener('click', () => {
  sfx.resume();
  if (!duel) return;
  if (duel.state === 'match') duel.requestRematch();
  else duel.startRound();
});
$('btn-draw').addEventListener('click', () => { sfx.resume(); if (duel) duel.handleDraw(); });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && duel && (duel.state === 'armed' || duel.state === 'fire')) {
    e.preventDefault();
    duel.handleDraw();
  }
});

// ---------- boot / lobby events ----------
$('btn-start').addEventListener('click', async () => {
  enableMotion();
  sfx.resume();
  await ensureCodec();
  if (NET_MODE === 'ws') connectSignaling();
  show('screen-lobby');
  const room = new URLSearchParams(location.search).get('room');
  if (room) { $('join-code').value = room.toUpperCase(); joinDuel(room); }
});
$('btn-create').addEventListener('click', () => { sfx.resume(); createDuel(); });
$('btn-join').addEventListener('click', () => { sfx.resume(); joinDuel($('join-code').value); });
$('btn-calibrate').addEventListener('click', openCalibration);
$('btn-enable-motion').addEventListener('click', enableMotion);
$('btn-cal-done').addEventListener('click', closeCalibration);
$('cal-slider').addEventListener('input', (e) => { motion.setSensitivity(e.target.value); positionCalThreshold(); });
$('btn-mute').addEventListener('click', () => {
  const on = !sfx.isEnabled();
  sfx.setEnabled(on);
  if (on) sfx.resume();
  const b = $('btn-mute');
  b.setAttribute('aria-pressed', String(!on));
  b.textContent = on ? 'Sound: On' : 'Sound: Off';
});
document.querySelectorAll('.round-opt').forEach((b) => {
  b.addEventListener('click', () => {
    bestOf = parseInt(b.dataset.n, 10) || 3;
    document.querySelectorAll('.round-opt').forEach((x) => x.classList.toggle('is-active', x === b));
  });
});
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('join-link').value); $('btn-copy').textContent = 'Copied'; }
  catch { /* clipboard may be blocked; user can select manually */ }
});

renderRigCheck();
if (MotionController.isSupported()) $('btn-calibrate').hidden = false;
show('screen-start');
