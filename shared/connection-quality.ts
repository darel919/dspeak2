import { parseExternalNumber, type ExternalField } from "./types/external.ts";

export function getConnectionQualityBars(
  rttMs: ExternalField,
  packetLossPercent: ExternalField = null,
  jitterMs: ExternalField = null,
) {
  if (rttMs == null || rttMs === "") return 0;
  const rtt = parseExternalNumber(rttMs);
  if (rtt === null || rtt < 0) return 0;
  let bars = rtt < 20 ? 5 : rtt <= 50 ? 4 : rtt <= 100 ? 3 : rtt <= 150 ? 2 : 1;
  const loss = parseExternalNumber(packetLossPercent);
  if (loss !== null && loss > 10) return 1;
  if (loss !== null) bars -= loss > 7 ? 2 : loss > 5 ? 1 : 0;

  const jitter = parseExternalNumber(jitterMs);
  if (jitter !== null && jitter > 100) return 1;
  if (jitter !== null)
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
