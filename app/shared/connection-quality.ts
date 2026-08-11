type ConnectionMetric = number | string | null | undefined;

export function getConnectionQualityBars(
  rttMs: ConnectionMetric,
  packetLossPercent: ConnectionMetric = null,
  jitterMs: ConnectionMetric = null,
) {
  if (rttMs == null || rttMs === "") return 0;
  const rtt = Number(rttMs);
  if (!Number.isFinite(rtt) || rtt < 0) return 0;
  let bars = rtt < 20 ? 5 : rtt <= 50 ? 4 : rtt <= 100 ? 3 : rtt <= 150 ? 2 : 1;
  const loss = Number(packetLossPercent);
  if (Number.isFinite(loss) && loss > 10) return 1;
  if (Number.isFinite(loss)) bars -= loss > 7 ? 2 : loss > 5 ? 1 : 0;

  const jitter = Number(jitterMs);
  if (Number.isFinite(jitter) && jitter > 100) return 1;
  if (Number.isFinite(jitter))
    bars -= jitter > 50 ? 3 : jitter > 30 ? 2 : jitter > 15 ? 1 : 0;
  return Math.max(1, bars);
}

export function getConnectionQualityLabel(bars: number) {
  if (bars === 5) return "Excellent";
  if (bars === 4) return "Very good";
  if (bars === 3) return "Good";
  if (bars === 2) return "Fair";
  if (bars === 1) return "Poor";
  return "Waiting for statistics";
}

export function isConnectionPending(mediaState: string, connecting = false) {
  return (
    connecting ||
    mediaState === "reconnecting" ||
    mediaState === "topology-probing" ||
    mediaState === "transport-connecting" ||
    mediaState === "signaling-connected"
  );
}

export function getActiveConnectionLabel(
  bars: number,
  mediaState: string,
  hasConnectedStatistics = false,
) {
  if (mediaState === "reconnecting") return "Reconnecting";
  if (mediaState === "failed" || mediaState === "disconnected")
    return "Connection issue";
  if (mediaState === "playback-blocked") return "Playback blocked";
  if (mediaState === "topology-probing") return "Selecting media route";
  if (mediaState === "transport-connecting") return "Transport connecting";
  if (mediaState === "ready-no-active-media") return "Connected";
  if (mediaState === "media-flowing")
    return hasConnectedStatistics
      ? getConnectionQualityLabel(bars)
      : "Media flowing";
  return hasConnectedStatistics
    ? getConnectionQualityLabel(bars)
    : "Signaling connected";
}

export function normalizeConnectionMetricValue(value: ConnectionMetric) {
  return value != null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

export function getConnectionQualityColorClass(bars: number) {
  if (bars > 3) return "text-success";
  if (bars >= 2) return "text-warning";
  if (bars === 1) return "text-error";
  return "text-base-content";
}
