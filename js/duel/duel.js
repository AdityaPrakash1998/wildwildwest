// Duel state machine (host-driven).
//
// Flow per round:
//   host taps Start/auto-advance -> host picks a RANDOM delay, schedules the bell
//   in host-clock time, and sends HighNoonSchedule -> both arm a local timer ->
//   bell fires (near-simultaneously via clock offset) -> each player draws ->
//   each computes its OWN reaction (draw - bell) locally and sends RoundResult ->
//   once both results are in, both sides resolve identically (lowest valid wins).
//
// Fairness: reaction is a local duration, immune to clock offset. False start =
// drew before the bell, or faster than the human floor (anticipation). Missed =
// no draw within the window. Best-of-N by score; ties/double-fouls replay.
//
// The channel is reliable+ordered, so control/flow messages are neither lost nor
// reordered — the state machine can assume in-order delivery.

export const HUMAN_FLOOR_MS = 100;   // faster than this after the bell = anticipation
export const DRAW_TIMEOUT_MS = 3000; // no draw within this after the bell = missed
export const ROUND_RESULT_MS = 3000; // how long a round result shows before the next round
const ARM_MIN_MS = 2000;
const ARM_MAX_MS = 5000;

export function winsNeeded(bestOf) { return Math.floor(bestOf / 2) + 1; }

/** Decide a round from both players' results. Returns the winning playerId, or 0 to replay. */
export function decideRound(a, b) {
  const valid = (r) => !r.falseStart && !r.missed;
  const av = valid(a);
  const bv = valid(b);
  if (av && bv) {
    if (a.reactionMs < b.reactionMs) return a.playerId;
    if (b.reactionMs < a.reactionMs) return b.playerId;
    return 0; // exact tie
  }
  if (av) return a.playerId;
  if (bv) return b.playerId;
  return 0; // both fouled
}

export class Duel {
  constructor({ role, myPlayerId, bestOf = 3, send, onView, getOffset, onEvent }) {
    this.role = role;
    this.me = myPlayerId;
    this.bestOf = bestOf;
    this.need = winsNeeded(bestOf);
    this.send = send;
    this.onView = onView;
    this.getOffset = getOffset || (() => 0);
    this.onEvent = onEvent || (() => {});
    this._timers = [];
  }

  reset() {
    this._clearTimers();
    this.round = 0;
    this.scoreP1 = 0;
    this.scoreP2 = 0;
    this._replay = false;
    this._enterIdle();
  }

  _view(extra) {
    const scoreMe = this.me === 1 ? this.scoreP1 : this.scoreP2;
    const scoreOpp = this.me === 1 ? this.scoreP2 : this.scoreP1;
    this.onView(Object.assign(
      {
        state: this.state, round: this.round, need: this.need, bestOf: this.bestOf,
        scoreMe, scoreOpp, myResult: this.myResult, peerResult: this.peerResult,
      },
      extra || {},
    ));
  }

  _enterIdle() {
    this.state = 'idle';
    this.myResult = null;
    this.peerResult = null;
    this._view();
  }

  // ---- round flow ----
  startRound() {
    if (this.role !== 'host') return;
    if (this.state === 'armed' || this.state === 'fire') return;
    if (!this._replay) this.round += 1;
    this._replay = false;
    this.myResult = null;
    this.peerResult = null;
    // target_time is a uint64 — must be an integer (Math.random makes it a float).
    const target = Math.round(Date.now() + ARM_MIN_MS + Math.random() * (ARM_MAX_MS - ARM_MIN_MS));
    this.send({ high_noon: { target_time: target, round: this.round } });
    this._arm(target);
  }

  _onHighNoon(m) {
    if (this.role !== 'guest') return;
    this.round = m.round;
    this.myResult = null;
    this.peerResult = null;
    this._arm(m.target_time - this.getOffset());
  }

  _arm(fireLocal) {
    this._clearTimers();
    this.state = 'armed';
    const wait = Math.max(0, fireLocal - Date.now());
    this._timers.push(setTimeout(() => this._fire(), wait));
    this.onEvent('arm');
    this._view();
  }

  _fire() {
    if (this.state !== 'armed') return;
    this.state = 'fire';
    this.firedLocal = Date.now();
    this.onEvent('bell');
    this._timers.push(setTimeout(
      () => this._setResult({ reactionMs: DRAW_TIMEOUT_MS, falseStart: false, missed: true }),
      DRAW_TIMEOUT_MS,
    ));
    this._view();
  }

  /** Draw input: button / SPACE / (later) the motion sensor. */
  handleDraw() {
    if (this.state === 'armed') {
      this._setResult({ reactionMs: 0, falseStart: true, missed: false }); // drew before the bell
    } else if (this.state === 'fire' && !this.myResult) {
      const r = Date.now() - this.firedLocal;
      this._setResult({ reactionMs: r, falseStart: r < HUMAN_FLOOR_MS, missed: false });
    }
  }

  _setResult(res) {
    if (this.myResult) return;
    this.myResult = Object.assign({ playerId: this.me }, res);
    this.onEvent('draw', { falseStart: res.falseStart, missed: res.missed, reactionMs: res.reactionMs });
    this.send({ round_result: { round: this.round, reaction_ms: res.reactionMs, false_start: res.falseStart, missed: res.missed } });
    this._clearTimers();
    this.state = 'fire';
    this._view({ waiting: !this.peerResult });
    this._tryResolve();
  }

  _onRoundResult(m) {
    if (this.peerResult) return;
    this.peerResult = {
      playerId: this.me === 1 ? 2 : 1,
      reactionMs: m.reaction_ms,
      falseStart: m.false_start,
      missed: m.missed,
    };
    this._tryResolve();
  }

  _tryResolve() {
    if (!this.myResult || !this.peerResult) return;
    const rP1 = this.myResult.playerId === 1 ? this.myResult : this.peerResult;
    const rP2 = this.myResult.playerId === 2 ? this.myResult : this.peerResult;
    const w = decideRound(rP1, rP2);
    if (w === 1) this.scoreP1 += 1;
    else if (w === 2) this.scoreP2 += 1;
    this._replay = (w === 0);

    const matchOver = this.scoreP1 >= this.need || this.scoreP2 >= this.need;
    const roundWinner = w === 0 ? 'replay' : (w === this.me ? 'me' : 'opp');
    this._clearTimers();

    if (matchOver) {
      this.state = 'match';
      const winnerId = this.scoreP1 >= this.need ? 1 : 2;
      const matchWinner = winnerId === this.me ? 'me' : 'opp';
      this.onEvent('result', { roundWinner, matchOver: true, matchWinner });
      this._view({ roundWinner, matchWinner });
    } else {
      this.state = 'round';
      this.onEvent('result', { roundWinner, matchOver: false, matchWinner: null });
      this._view({ roundWinner });
      if (this.role === 'host') this._timers.push(setTimeout(() => this.startRound(), ROUND_RESULT_MS));
    }
  }

  requestRematch() {
    if (this.role !== 'host') return;
    this.send({ control: { kind: 'rematch', round: 0 } });
    this._doRematch();
  }

  onMessage(msg) {
    if (msg.high_noon) this._onHighNoon(msg.high_noon);
    else if (msg.round_result) this._onRoundResult(msg.round_result);
    else if (msg.control && msg.control.kind === 'rematch') this._doRematch();
    else if (msg.control && msg.control.kind === 'config') this.setBestOf(msg.control.round);
  }

  /** Set best-of round count (forced odd) and re-render. Used for host→guest sync. */
  setBestOf(n) {
    n = Math.max(1, Math.round(Number(n) || this.bestOf));
    if (n % 2 === 0) n += 1;
    this.bestOf = n;
    this.need = winsNeeded(n);
    this._view();
  }

  _doRematch() {
    this._clearTimers();
    this.round = 0;
    this.scoreP1 = 0;
    this.scoreP2 = 0;
    this._replay = false;
    this._enterIdle();
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }
}
