export function handleNativeMediasoupTransportRecovery(
  session,
  direction,
  state,
) {
  clearTimeout(session.recoveryTimers.get(direction));
  session.recoveryTimers.delete(direction);
  if (state === "connected") {
    session.recoveryAttempts.delete(direction);
    return;
  }
  if (state !== "disconnected" && state !== "failed") return;
  const delay = state === "disconnected" ? 3000 : 0;
  const timer = setTimeout(() => {
    session.recoveryTimers.delete(direction);
    session.restartTransportIce(direction).catch(() => {
      session.transportStates.set(direction, "failed");
      session.mediaConnectionState = "failed";
      session._emitState();
    });
  }, delay);
  timer.unref?.();
  session.recoveryTimers.set(direction, timer);
}

export function restartNativeMediasoupTransportIce(session, direction) {
  const active = session.recoveryOperations.get(direction);
  if (active) return active;
  const operation = performNativeMediasoupTransportIceRestart(
    session,
    direction,
  ).finally(() => {
    if (session.recoveryOperations.get(direction) === operation)
      session.recoveryOperations.delete(direction);
  });
  session.recoveryOperations.set(direction, operation);
  return operation;
}

async function performNativeMediasoupTransportIceRestart(session, direction) {
  const attempts = session.recoveryAttempts.get(direction) || 0;
  if (attempts >= 1) throw new Error("SFU ICE recovery was exhausted");
  const transport =
    direction === "send" ? session.sendTransport : session.recvTransport;
  if (!transport || transport.closed)
    throw new Error("SFU transport is unavailable for ICE recovery");
  session.recoveryAttempts.set(direction, attempts + 1);
  const requestId = session.requestId("restart-ice");
  const response = session.waitForPending(
    requestId,
    `SFU ${direction} ICE restart`,
  );
  try {
    session.sendOrThrow(
      {
        type: "restart-ice",
        data: { requestId, transportId: transport.id },
      },
      `SFU ${direction} ICE restart`,
    );
  } catch (error) {
    session.pending.get(requestId)?.reject(error);
  }
  const iceParameters = await response;
  const current =
    direction === "send" ? session.sendTransport : session.recvTransport;
  if (current !== transport || transport.closed)
    throw new Error("SFU transport changed during ICE recovery");
  if (session.transportStates.get(direction) === "connected") return true;
  await session.invoke(
    direction === "send"
      ? "media_restart_send_transport_ice"
      : "media_restart_recv_transport_ice",
    { iceParameters },
  );
  clearTimeout(session.recoveryTimers.get(direction));
  const validationTimer = setTimeout(() => {
    session.recoveryTimers.delete(direction);
    const current =
      direction === "send" ? session.sendTransport : session.recvTransport;
    if (
      current !== transport ||
      session.transportStates.get(direction) === "connected"
    )
      return;
    session.transportStates.set(direction, "failed");
    session.mediaConnectionState = "failed";
    session._emitState();
  }, session.recoveryTimeoutMs);
  validationTimer.unref?.();
  session.recoveryTimers.set(direction, validationTimer);
  return true;
}
