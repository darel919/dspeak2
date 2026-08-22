import { MediasoupProviderSocket } from "./mediasoup-provider-socket.ts";
import type { RemoteReceiverStats } from "./remote-source-convergence.ts";
import type { CloudflarePublication } from "./types/cloudflare-media.ts";
import type { MediaMessage } from "./types/media-message-handlers.ts";
import type { VideoPolicy } from "./types/video-settings.ts";
import type { WebRtcLatencyProfile } from "./types/web-rtc-latency.ts";
import {
  isExternalRecord,
  isExternalString,
  type ExternalValue,
  type MediaCommandResult,
} from "./types/boundary.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalValue,
  parseThrownError,
} from "../utils/external-values.ts";

export function normalizeVideoStatsReport(
  value: MediaCommandResult,
): Map<string, Record<string, unknown>> | null {
  if (!(value instanceof Map)) return null;
  const report = new Map<string, Record<string, unknown>>();
  for (const [key, entry] of value) {
    if (isExternalString(key) && isExternalRecord(entry))
      report.set(key, entry);
  }
  return report;
}

function finiteStat(value: ExternalValue): number | undefined {
  const number = parseExternalNumber(value);
  return number !== null && number >= 0 ? number : undefined;
}

export function ownedErrorValue(value: ExternalValue): OwnedErrorValue {
  if (value === null || value === undefined) return value;
  if (isExternalString(value)) return value;
  if (value instanceof Error) return value;
  return parseThrownError(value);
}

export class TopologyMediasoupProviderSocket extends MediasoupProviderSocket {
  override send(data: ExternalValue): boolean {
    const message = parseExternalRecord(data);
    return message ? super.send(message) : false;
  }
}

export function normalizeReceiverStats(
  raw: ExternalValue,
): RemoteReceiverStats | null {
  const values: ExternalValue[] = [];
  if (Array.isArray(raw))
    values.push(...raw.map((entry) => parseExternalValue(entry)));
  else if (raw instanceof Map)
    raw.forEach((value) => values.push(parseExternalValue(value)));
  else {
    const record = parseExternalRecord(raw);
    if (record) values.push(record);
  }
  const record = values
    .map((value) => {
      if (!isExternalRecord(value)) return null;
      return isExternalRecord(value.stats) ? value.stats : value;
    })
    .find(
      (value) =>
        isExternalRecord(value) &&
        (value.type === "inbound-rtp" || value.bytesReceived !== undefined),
    );
  if (!isExternalRecord(record)) return null;
  const bytesReceived = finiteStat(parseExternalValue(record.bytesReceived));
  const packetsReceived = finiteStat(
    parseExternalValue(record.packetsReceived),
  );
  if (bytesReceived === undefined || packetsReceived === undefined) return null;
  const result: RemoteReceiverStats = { bytesReceived, packetsReceived };
  for (const field of [
    "framesReceived",
    "framesDecoded",
    "framesRendered",
    "framesPerSecond",
    "freezeCount",
    "totalFreezesDuration",
    "pauseCount",
    "totalPausesDuration",
    "lastPacketReceivedTimestamp",
    "totalAudioEnergy",
    "totalSamplesReceived",
    "jitterBufferEmittedCount",
  ] as const) {
    const value = finiteStat(parseExternalValue(record[field]));
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export function roomAttenuation(
  value: ExternalValue,
): Record<string, unknown> | undefined {
  if (!isExternalRecord(value) || !isExternalRecord(value.attenuation))
    return undefined;
  return value.attenuation;
}

export function videoPolicy(value: ExternalValue): VideoPolicy | null {
  if (!isExternalRecord(value)) return null;
  return {
    cameraKbps: parseExternalNumber(parseExternalValue(value.cameraKbps)),
    screenKbps: parseExternalNumber(parseExternalValue(value.screenKbps)),
  };
}

export function audioLatencyPolicy(
  value: ExternalValue,
): WebRtcLatencyProfile | null {
  if (!isExternalRecord(value)) return null;
  return value.audioLatencyProfile === "ultra-low"
    ? "ultra-low"
    : value.audioLatencyProfile === "standard"
      ? "standard"
      : null;
}

export { deriveWebMediaLatencyTier } from "./web-rtc-latency-status.ts";

export function parseCloudflarePublication(
  value: ExternalValue,
): CloudflarePublication | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  const trackName = isExternalString(record.trackName)
    ? record.trackName
    : undefined;
  const peerId = isExternalString(record.peerId) ? record.peerId : undefined;
  const source = isExternalString(record.source) ? record.source : undefined;
  const generation = parseExternalNumber(parseExternalValue(record.generation));
  const connectionEpoch = parseExternalNumber(
    parseExternalValue(record.connectionEpoch),
  );
  if (
    !trackName ||
    !peerId ||
    !source ||
    generation === null ||
    connectionEpoch === null
  )
    return null;

  const publication: CloudflarePublication = {
    trackName,
    peerId,
    source,
    generation,
    connectionEpoch,
  };
  if (isExternalString(record.userId)) publication.userId = record.userId;
  if (isExternalString(record.sessionId))
    publication.sessionId = record.sessionId;
  if (isExternalString(record.ownerSource) || record.ownerSource === null)
    publication.ownerSource = record.ownerSource;
  if (record.closed === true || record.closed === false)
    publication.closed = record.closed;
  for (const [key, rawValue] of Object.entries(record)) {
    if (
      key === "trackName" ||
      key === "peerId" ||
      key === "source" ||
      key === "generation" ||
      key === "connectionEpoch" ||
      key === "userId" ||
      key === "sessionId" ||
      key === "ownerSource" ||
      key === "closed"
    )
      continue;
    Object.assign(publication, { [key]: parseExternalValue(rawValue) });
  }
  return publication;
}

export type MediaMessageHandler = (data: MediaMessage) => MediaCommandResult;
