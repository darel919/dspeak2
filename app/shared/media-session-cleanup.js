export function closeMediaSessionTransports({
  capture,
  getP2pMesh,
  getSfu,
  handoff,
  socket,
}) {
  closeMediaProviders({ getP2pMesh, getSfu, handoff });
  socket?.close();
  capture.stopAll();
}

export function closeMediaProviders({ getP2pMesh, getSfu, handoff }) {
  handoff.clear();
  try {
    getP2pMesh()?.closeAll();
  } catch (error) {
    console.warn("[Media] failed to close P2P provider", error);
  }
  try {
    getSfu()?.close();
  } catch (error) {
    console.warn("[Media] failed to close SFU provider", error);
  }
}
