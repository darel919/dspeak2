export const MEDIA_SIGNAL_HEARTBEAT_TIMEOUT_MS = 20000
export const MEDIA_SIGNAL_HEARTBEAT_SWEEP_MS = 5000

export function isValidMediaSignalHeartbeat(data) {
  return Number.isSafeInteger(Number(data?.sequence)) && Number(data.sequence) >= 0 &&
    Number.isSafeInteger(Number(data?.topologyEpoch)) && Number(data.topologyEpoch) >= 0 &&
    Number.isSafeInteger(Number(data?.sourceRevision)) && Number(data.sourceRevision) >= 0
}

export function isMediaSignalHeartbeatExpired(lastHeartbeatAt, now = Date.now()) {
  return !Number.isFinite(lastHeartbeatAt) || now - lastHeartbeatAt >= MEDIA_SIGNAL_HEARTBEAT_TIMEOUT_MS
}
