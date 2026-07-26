// Protobuf codec — runtime parsing, NO build step and NO runtime .proto fetch.
//
// The schema is embedded below and parsed with protobuf.parse(). We deliberately
// avoid protobuf.load(url), whose in-browser XHR fetch proved unreliable; parsing
// an embedded string is deterministic and needs no second network request.
//
// SOURCE OF TRUTH: keep this schema in sync with web/proto/game.proto (that file
// remains the human-readable canonical reference).
//
// Usage:
//   import { initCodec, encode, decode } from './net/codec.js';
//   await initCodec();
//   const bytes = encode({ recoil: { playerId: 1, accelZ: 9.8, gyroX: 2.1, timestamp: Date.now() } });
//   const msg = decode(bytes);

const SCHEMA = `
syntax = "proto3";
package wildwest;

message Envelope {
  oneof payload {
    TimeSyncPing time_sync_ping = 1;
    TimeSyncPong time_sync_pong = 2;
    HighNoonSchedule high_noon = 3;
    RecoilSignal recoil = 4;
    RoundResult round_result = 5;
    MotionState motion = 6;
    Heartbeat heartbeat = 7;
    Control control = 8;
  }
}

message TimeSyncPing { uint64 client_time = 1; uint32 seq = 2; }
message TimeSyncPong { uint64 ping_client_time = 1; uint64 peer_time = 2; uint32 seq = 3; }
message HighNoonSchedule { uint64 target_time = 1; uint32 round = 2; }
message RecoilSignal { uint32 player_id = 1; float accel_z = 2; float gyro_x = 3; uint64 timestamp = 4; }
message RoundResult { uint32 round = 1; float reaction_ms = 2; bool false_start = 3; bool missed = 4; }
message MotionState { float pitch = 1; float roll = 2; bool holstered = 3; }
message Heartbeat { uint64 t = 1; }
message Control { string kind = 1; uint32 round = 2; }
`;

let Envelope = null;

export async function initCodec(libUrl = '../../vendor/protobuf.min.js') {
  const protobuf = await loadProtobuf(new URL(libUrl, import.meta.url).href);
  // Return 64-bit fields as plain JS numbers (ms timestamps stay under 2^53).
  protobuf.util.Long = null;
  protobuf.configure();
  // keepCase:true preserves snake_case field names (target_time, reaction_ms, …)
  // so they match the message objects used throughout the app. Without it,
  // protobuf.js camelCases them and multi-word fields silently fail to encode.
  const root = protobuf.parse(SCHEMA, { keepCase: true }).root;
  Envelope = root.lookupType('wildwest.Envelope');
  return true;
}

export function encode(payload) {
  if (!Envelope) throw new Error('codec not initialized — call initCodec() first');
  const err = Envelope.verify(payload);
  if (err) throw new Error('invalid message: ' + err);
  return Envelope.encode(Envelope.create(payload)).finish();
}

export function decode(bytes) {
  if (!Envelope) throw new Error('codec not initialized — call initCodec() first');
  return Envelope.toObject(Envelope.decode(bytes), { longs: Number, defaults: true });
}

/** Load protobuf.js full build as a classic script; it attaches window.protobuf. */
function loadProtobuf(src) {
  return new Promise((resolve, reject) => {
    if (window.protobuf) return resolve(window.protobuf);
    const s = document.createElement('script');
    s.src = src;
    s.onload = () =>
      window.protobuf ? resolve(window.protobuf) : reject(new Error('protobuf global not set after load'));
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}
