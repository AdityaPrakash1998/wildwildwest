// WebRTC peer link: wraps RTCPeerConnection + a DataChannel for gameplay traffic.
// The host creates the channel and the offer; the guest answers. SDP/ICE are
// relayed via the injected `sendSignal`.
//
// The channel is RELIABLE + ORDERED. The duel exchanges low-frequency control
// (high-noon schedule, round results, ready/rematch) where delivery and order
// matter; reaction time is measured locally, so raw-message latency isn't the
// fairness factor. If we later stream high-rate live motion (e.g., visualizing
// the opponent's phone tilt), add a SECOND channel with
// { ordered: false, maxRetransmits: 0 } for that stream only.
export class PeerLink {
  /**
   * @param {object} opts
   * @param {'host'|'guest'} opts.role
   * @param {RTCIceServer[]} opts.iceServers
   * @param {(data:object)=>void} opts.sendSignal  relay SDP/ICE to the peer
   * @param {()=>void} [opts.onOpen]
   * @param {(bytes:Uint8Array)=>void} [opts.onMessage]
   * @param {(state:string)=>void} [opts.onState]
   */
  constructor({ role, iceServers, sendSignal, onOpen, onMessage, onState }) {
    this.role = role;
    this.sendSignal = sendSignal;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onState = onState;
    this.dc = null;

    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) this.sendSignal({ kind: 'ice', candidate: e.candidate });
    });
    this.pc.addEventListener('connectionstatechange', () =>
      this.onState && this.onState(this.pc.connectionState),
    );
    if (role === 'guest') {
      this.pc.addEventListener('datachannel', (e) => this._bindChannel(e.channel));
    }
  }

  /** Host only: create the data channel + offer once the guest has joined. */
  async start() {
    if (this.role !== 'host') return;
    this.dc = this.pc.createDataChannel('duel', { ordered: true });
    this._bindChannel(this.dc);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ kind: 'offer', sdp: this.pc.localDescription });
  }

  /** Handle a relayed SDP/ICE message from the peer. */
  async handleSignal(data) {
    if (!data) return;
    if (data.kind === 'offer') {
      await this.pc.setRemoteDescription(data.sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal({ kind: 'answer', sdp: this.pc.localDescription });
    } else if (data.kind === 'answer') {
      await this.pc.setRemoteDescription(data.sdp);
    } else if (data.kind === 'ice') {
      try { await this.pc.addIceCandidate(data.candidate); } catch { /* may arrive early */ }
    }
  }

  _bindChannel(channel) {
    this.dc = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => this.onOpen && this.onOpen());
    channel.addEventListener('message', (ev) =>
      this.onMessage && this.onMessage(new Uint8Array(ev.data)),
    );
  }

  /** Send raw bytes (already encoded) over the data channel. */
  send(bytes) {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(bytes);
  }

  close() {
    try { this.dc && this.dc.close(); } catch { /* ignore */ }
    try { this.pc.close(); } catch { /* ignore */ }
  }
}
