const WEBRTC_CONSTRUCTORS = [
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'RTCDataChannel',
  'RTCSessionDescription',
  'RTCIceCandidate',
] as const

/**
 * CSP does not govern WebRTC: a TURN server URL or ICE traffic reaches any
 * host even with `connect-src 'none'`, and the CSP `webrtc 'block'`
 * directive is not enforced by Chromium or WebKit yet. Removing the
 * constructors from the runtime realm closes the direct path before any
 * artifact code runs; a child frame created by the artifact is the
 * documented residual.
 */
export function disableWebRtc(target: Window = window) {
  for (const name of WEBRTC_CONSTRUCTORS) {
    if (!(name in target)) {
      continue
    }

    Object.defineProperty(target, name, {
      value: undefined,
      configurable: false,
      enumerable: false,
      writable: false,
    })
  }
}
