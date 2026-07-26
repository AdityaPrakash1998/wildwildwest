// Thin WebSocket signaling client.
// Emits DOM events named after the server message `type` (created, joined,
// peer-joined, signal, peer-left, error, pong), plus lifecycle 'open'/'close'.
// The message object is delivered on `event.detail`.
export class Signaling extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => this.dispatchEvent(new Event('open')));
    this.ws.addEventListener('close', () => this.dispatchEvent(new Event('close')));
    // Avoid clashing with a server 'error' *message*; surface socket errors separately.
    this.ws.addEventListener('error', () => this.dispatchEvent(new Event('sockerror')));
    this.ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m && m.type) this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
    });
    return this;
  }

  isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  send(obj) {
    if (this.isOpen()) this.ws.send(JSON.stringify(obj));
  }
}
