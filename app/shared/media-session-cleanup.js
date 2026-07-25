export function closeMediaSessionTransports({
  capture,
  getP2pMesh,
  getSfu,
  handoff,
  socket,
}) {
  handoff.clear();
  socket?.close();
  capture.stopAll();
  try {
    getP2pMesh()?.closeAll();
  } catch (_) {}
  try {
    getSfu()?.close();
  } catch (_) {}
}
