export function closeMediaPeer(peer, code, reason) {
  try {
    peer.close(code, reason);
  } catch (error) {
    console.warn("[SFU] failed to close peer", error);
  }
}
