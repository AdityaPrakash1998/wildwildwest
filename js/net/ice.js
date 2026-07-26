// ICE servers for WebRTC NAT traversal.
//
// STUN (public, free) is enough for same-network / friendly-NAT pairs.
// TURN (a relay) is needed for CROSS-NETWORK play — especially when one side is
// on mobile/CGNAT, which usually blocks a direct connection.
//
// >>> TO ENABLE CROSS-NETWORK PLAY (e.g. Wi-Fi <-> distant mobile): <<<
// 1. Free signup at https://dashboard.metered.ca  (Open Relay / TURN).
// 2. Copy the ICE array it gives you (turn: URLs + username + credential).
// 3. Paste those objects into TURN_SERVERS below.
// Without TURN, same-Wi-Fi still works, but distant-mobile pairs may fail.

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

// Metered Open Relay TURN credentials (free tier). Client-side by design — rotate
// in the Metered dashboard anytime; regenerate if the free quota gets abused.
const TURN_SERVERS = [
  { urls: 'turn:global.relay.metered.ca:80',                 username: '7c67c73dea6c7b82594d6d1d', credential: 'PZ87QfuP4N5IFBvq' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp',   username: '7c67c73dea6c7b82594d6d1d', credential: 'PZ87QfuP4N5IFBvq' },
  { urls: 'turn:global.relay.metered.ca:443',                username: '7c67c73dea6c7b82594d6d1d', credential: 'PZ87QfuP4N5IFBvq' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '7c67c73dea6c7b82594d6d1d', credential: 'PZ87QfuP4N5IFBvq' },
];

export function getIceServers() {
  return [...STUN_SERVERS, ...TURN_SERVERS];
}

/** True once TURN creds are filled in — lets the UI warn about cross-network play. */
export function hasTurn() {
  return TURN_SERVERS.length > 0;
}
