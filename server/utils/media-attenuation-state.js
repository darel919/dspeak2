export function relayMediaAttenuationState(session, data, send) {
  const target = session.room.sessions.get(String(data.targetPeerId));
  if (!target || target === session) return false;
  send(target.peer, "attenuation-state", {
    active: data.active,
    effectivePercent: Math.round(Number(data.effectivePercent)),
    fromPeerId: session.peer.id,
    source: "screen-audio",
  });
  return true;
}
