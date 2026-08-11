export function shouldCloseSocketOnPageHide(readyState) {
  return readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING;
}

export function closeSocketOnPageHide(socket) {
  if (!import.meta.client || !socket) return () => {};
  const handlePageHide = () => {
    if (shouldCloseSocketOnPageHide(socket.readyState)) {
      socket.close(1000, "Page navigation");
    }
  };
  window.addEventListener("pagehide", handlePageHide);
  const removeListener = () =>
    window.removeEventListener("pagehide", handlePageHide);
  socket.addEventListener("close", removeListener, { once: true });
  return removeListener;
}
