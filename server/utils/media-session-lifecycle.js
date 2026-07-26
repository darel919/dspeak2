const closedPeers = new WeakSet();

export function markMediaPeerClosed(peer) {
  if (peer && (typeof peer === "object" || typeof peer === "function"))
    closedPeers.add(peer);
}

export function isMediaPeerClosed(peer) {
  return Boolean(
    peer &&
    (typeof peer === "object" || typeof peer === "function") &&
    closedPeers.has(peer),
  );
}

export function retainMediaSessionResource(session, collection, resource) {
  if (!session?.closed) {
    collection.set(resource.id, resource);
    return true;
  }
  try {
    resource.close();
  } catch {}
  return false;
}

export function withMediaOperationTimeout(operation, label, timeoutMs = 3000) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
