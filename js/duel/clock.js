// Clock synchronization over the data channel (Cristian's-algorithm style).
//
// The GUEST pings the HOST repeatedly and keeps the offset from the lowest-RTT
// sample (least jitter). offset = HOST_clock - GUEST_clock, so the guest converts
// a host timestamp H to its own clock as:  localTime = H - offset.
// The HOST is the time reference and just answers pings.
//
// Note on fairness: reaction time is measured as a LOCAL duration
// (draw - bell) on each device, so it's immune to clock offset. Sync exists so
// the two phones fire the "high-noon" bell at nearly the same real instant.

/** Pure helper — offset (host-minus-guest) and round-trip time from one exchange. */
export function offsetFromSample(g0, h1, g3) {
  return { offset: h1 - (g0 + g3) / 2, rtt: g3 - g0 };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export class ClockSync {
  constructor(send) {
    this.send = send;
    this.seq = 0;
    this.best = null; // { offset, rtt }
  }

  /** HOST side: reply to a ping with the host clock. */
  respondToPing(ping) {
    this.send({ time_sync_pong: { ping_client_time: ping.client_time, peer_time: Date.now(), seq: ping.seq } });
  }

  /** GUEST side: record a pong, keeping the lowest-RTT (most accurate) sample. */
  onPong(pong) {
    const g3 = Date.now();
    const { offset, rtt } = offsetFromSample(pong.ping_client_time, pong.peer_time, g3);
    if (!this.best || rtt < this.best.rtt) this.best = { offset, rtt };
  }

  /** GUEST side: fire a burst of pings and return the best sample. */
  async sync(rounds = 8, gapMs = 120) {
    for (let i = 0; i < rounds; i++) {
      this.send({ time_sync_ping: { client_time: Date.now(), seq: ++this.seq } });
      await delay(gapMs);
    }
    return this.best;
  }

  get offset() { return this.best ? this.best.offset : 0; }
  get rtt() { return this.best ? this.best.rtt : null; }
}
