// Clock synchronization over the data channel (Cristian's-algorithm style).
//
// The GUEST pings the HOST repeatedly and estimates the clock offset. Over a
// high-latency TURN relay a single sample is noisy, so we keep a rolling window
// of samples and use the MEDIAN offset of the lowest-RTT ones (least queuing =
// most symmetric = most accurate). A light background ping keeps it fresh, so
// the two phones fire the "high-noon" bell at nearly the same real instant.
//
// offset = HOST_clock - GUEST_clock, so the guest converts a host timestamp H to
// its own clock as:  localTime = H - offset. The HOST just answers pings.
//
// Fairness note: reaction time is a LOCAL duration (draw - bell) on each device,
// so it's immune to any residual offset error — sync only affects simultaneity.

/** Pure helper — offset (host-minus-guest) and round-trip time from one exchange. */
export function offsetFromSample(g0, h1, g3) {
  return { offset: h1 - (g0 + g3) / 2, rtt: g3 - g0 };
}

/** Pure helper — robust offset from samples: median of the lowest-RTT third. */
export function robustOffset(samples) {
  if (!samples.length) return 0;
  const byRtt = [...samples].sort((a, b) => a.rtt - b.rtt);
  const k = Math.max(1, Math.min(6, Math.ceil(byRtt.length / 3)));
  const offs = byRtt.slice(0, k).map((s) => s.offset).sort((a, b) => a - b);
  return offs[Math.floor(offs.length / 2)];
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SAMPLES = 40;

export class ClockSync {
  constructor(send) {
    this.send = send;
    this.seq = 0;
    this.samples = []; // { offset, rtt }
    this._auto = null;
  }

  /** HOST side: reply to a ping with the host clock. */
  respondToPing(ping) {
    this.send({ time_sync_pong: { ping_client_time: ping.client_time, peer_time: Date.now(), seq: ping.seq } });
  }

  /** GUEST side: record a pong into the rolling sample window. */
  onPong(pong) {
    const g3 = Date.now();
    this.samples.push(offsetFromSample(pong.ping_client_time, pong.peer_time, g3));
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  _ping() { this.send({ time_sync_ping: { client_time: Date.now(), seq: ++this.seq } }); }

  /** GUEST side: fire an initial burst of pings; resolves with the current estimate. */
  async sync(rounds = 12, gapMs = 90) {
    for (let i = 0; i < rounds; i++) { this._ping(); await delay(gapMs); }
    return { offset: this.offset, rtt: this.rtt };
  }

  /** GUEST side: keep re-sampling in the background so the offset stays fresh. */
  startAutoSync(intervalMs = 1500) {
    this.stopAutoSync();
    this._auto = setInterval(() => this._ping(), intervalMs);
  }
  stopAutoSync() { if (this._auto) { clearInterval(this._auto); this._auto = null; } }

  get offset() { return robustOffset(this.samples); }
  get rtt() { return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : null; }
}
