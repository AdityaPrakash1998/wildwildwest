// PeerJS transport — serverless signaling via the public PeerServer Cloud broker.
// Room code maps to a namespaced peer id; the host registers that id, the guest
// connects to it. Exposes the same surface the app needs — send(bytes) plus
// onOpen/onMessage/onState — so duel/clock/codec are untouched. Host = P1, guest = P2.
//
// The channel is reliable+ordered with serialization 'raw', so our raw protobuf
// Uint8Array passes through unmodified.
import { getIceServers } from './ice.js';

const ID_PREFIX = 'wwqd-'; // namespace to reduce id collisions on the shared broker
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 4) {
  let c = '';
  for (let i = 0; i < len; i++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return c;
}

/** Load the vendored PeerJS build (classic script → window.Peer), like the codec does. */
function ensurePeerLib(libUrl = '../../vendor/peerjs.min.js') {
  return new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const s = document.createElement('script');
    s.src = new URL(libUrl, import.meta.url).href;
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS global not set')));
    s.onerror = () => reject(new Error('failed to load ' + libUrl));
    document.head.appendChild(s);
  });
}

export class PeerConn {
  constructor({ onOpen, onMessage, onState, onError, onRoomReady, log } = {}) {
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onState = onState;
    this.onError = onError;
    this.onRoomReady = onRoomReady;
    this.log = log || (() => {});
    this.peer = null;
    this.conn = null;
    this.role = null;
  }

  /** Host: register the code as our peer id and wait for the guest to connect. */
  async host(code) {
    this.role = 'host';
    const Peer = await ensurePeerLib();
    this.log('PeerJS Cloud: registering room ' + ID_PREFIX + code + '…');
    this.peer = new Peer(ID_PREFIX + code, { debug: 1, config: { iceServers: getIceServers() } });
    this.peer.on('open', () => { this.log('PeerJS Cloud: room live — waiting for opponent.'); this.onRoomReady && this.onRoomReady(code); });
    this.peer.on('connection', (conn) => this._bind(conn));
    this.peer.on('error', (e) => this._error(e));
  }

  /** Guest: connect to the host's namespaced peer id. */
  async join(code) {
    this.role = 'guest';
    const Peer = await ensurePeerLib();
    this.log('PeerJS Cloud: connecting to broker…');
    this.peer = new Peer({ debug: 1, config: { iceServers: getIceServers() } });
    this.peer.on('open', () => {
      this.log('PeerJS Cloud: dialing ' + ID_PREFIX + code + '…');
      const conn = this.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'raw' });
      this._bind(conn);
    });
    this.peer.on('error', (e) => this._error(e));
  }

  _bind(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.log('P2P connected (PeerJS).');
      this.onOpen && this.onOpen();
      setTimeout(() => this._logConnType(), 1200);
    });
    conn.on('data', (d) => {
      const bytes = d instanceof Uint8Array ? d : new Uint8Array(d);
      this.onMessage && this.onMessage(bytes);
    });
    conn.on('close', () => this.onState && this.onState('closed'));
    conn.on('error', (e) => this._error(e));
  }

  /** Log whether the media path is direct (host/srflx) or via a TURN relay. */
  async _logConnType() {
    try {
      const pc = this.conn && this.conn.peerConnection;
      if (!pc || !pc.getStats) return;
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r;
      });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const lt = local ? local.candidateType : '?';
      const rt = remote ? remote.candidateType : '?';
      const relayed = lt === 'relay' || rt === 'relay';
      this.log(`Path: ${lt} ⇄ ${rt}  ${relayed ? '(TURN relay)' : '(direct P2P)'}`);
    } catch { /* stats unsupported */ }
  }

  _error(e) {
    const type = e && e.type ? e.type : (e && e.message) || String(e);
    this.log('PeerJS error: ' + type);
    if (this.onError) this.onError(type);
  }

  send(bytes) {
    if (this.conn && this.conn.open) this.conn.send(bytes);
  }

  close() {
    try { this.conn && this.conn.close(); } catch { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
  }
}
