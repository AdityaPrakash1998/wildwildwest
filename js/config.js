// Resolves the signaling server URL.
//
// Dev: the same Node server serves this page AND the WebSocket, so same-origin
//      `/ws` works — including through a cloudflared HTTPS tunnel (-> wss://).
// Prod: when this static site is hosted on GitHub Pages, the signaling server
//       lives elsewhere. Point at it by opening the page with:
//         ?signal=wss://your-signaling-host/ws
export const SIGNALING_URL = (() => {
  const override = new URLSearchParams(location.search).get('signal');
  if (override) return override;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
})();

// Networking transport:
//  - 'ws'     : our local Node signaling server (localhost dev / two windows)
//  - 'peerjs' : serverless — public PeerServer Cloud broker (GitHub Pages, cross-network)
// Defaults to 'ws' on localhost and 'peerjs' elsewhere. Override with ?net=ws|peerjs
export const NET_MODE = (() => {
  const q = new URLSearchParams(location.search).get('net');
  if (q === 'ws' || q === 'peerjs') return q;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local ? 'ws' : 'peerjs';
})();
