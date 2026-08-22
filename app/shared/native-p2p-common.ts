import { applyRtpSenderSettings } from "./rtp-sender-settings.ts";
import { findRtpStat } from "./rtc-media-stats.ts";
import { sortP2pVideoCodecPreferences } from "./video-settings.ts";
import {
  isExternalRecord,
  isExternalString,
  type MediaCommandResult,
} from "./types/boundary.ts";
import {
  normalizeVideoCodecName,
  type VideoCodecName,
} from "./types/video-codec-capabilities.ts";

type P2pStat = {
  id?: string;
  type: string;
  [key: string]: unknown;
};
type P2pTrackEntry =
  MediaStreamTrack | { track?: MediaStreamTrack | null; key?: string };
interface P2pFlowEntry {
  key: string;
  bytes: number;
  flowing: boolean;
}

function isRecord<T>(value: T): value is T & Record<string, unknown> {
  return isExternalRecord(value);
}

function p2pStat<T>(value: T): P2pStat | null {
  if (!isExternalRecord(value)) return null;
  if (!isExternalString(value.type)) return null;
  const { id, ...properties } = value;
  if (isExternalString(id))
    return { ...properties, type: value.type, id } satisfies P2pStat;
  return { ...properties, type: value.type } satisfies P2pStat;
}

export const P2P_ACTIVE_HEALTH_TIMEOUT_MS = 20000;
export const P2P_STABILITY_LIVENESS_TIMEOUT_MS = 8000;
export const P2P_DISCONNECT_GRACE_MS = 8000;
export const P2P_ICE_RESTART_TIMEOUT_MS = 12000;

export function p2pActiveLivenessTimeoutMs(connectionCount: number) {
  return Math.max(
    10000,
    P2P_ACTIVE_HEALTH_TIMEOUT_MS -
      Math.max(0, Number(connectionCount) - 1) * 5000,
  );
}

export function isP2pLivenessExpired(
  lastProgressAt: number | null | undefined,
  now: number,
  timeoutMs: number,
) {
  return (
    Number.isFinite(lastProgressAt) &&
    Number.isFinite(now) &&
    now - Number(lastProgressAt) >= timeoutMs
  );
}

export function requiresP2pLiveness(mode: string, readyReported: boolean) {
  return mode === "p2p" || (mode === "probing" && readyReported);
}

export function countEnabledP2pSources(
  sources: Iterable<string> | null | undefined,
  receiving: Map<string, boolean> = new Map(),
) {
  return [...(sources || [])].filter(
    (source) => receiving.get(String(source)) !== false,
  ).length;
}

export function p2pRemoteFeedKey(
  peerId: string | number,
  source: string | null,
) {
  return `p2p:${String(peerId)}:${String(source || "media")}`;
}

export function applyOpusAudioProfile(sdp: string, stereo = true) {
  if (!sdp) return sdp;
  return String(sdp)
    .split(/(?=m=)/)
    .map((section) => {
      if (!section.startsWith("m=audio ")) return section;
      const match = section.match(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/im);
      if (!match) return section;
      const firstLineFeed = section.indexOf("\n");
      const lineEnd =
        firstLineFeed > 0 && section[firstLineFeed - 1] === "\r"
          ? "\r\n"
          : "\n";
      const payloadType = match[1];
      const required = {
        stereo: stereo ? "1" : "0",
        "sprop-stereo": stereo ? "1" : "0",
        useinbandfec: "1",
        usedtx: "0",
        minptime: "10",
      };
      const fmtpPattern = new RegExp(
        `^a=fmtp:${payloadType} ([^\\r\\n]*)`,
        "im",
      );
      const fmtp = section.match(fmtpPattern);
      const parameters = new Map(
        (fmtp?.[1] || "")
          .split(";")
          .filter(Boolean)
          .map((value) => {
            const [key, ...rest] = value.trim().split("=");
            return [key, rest.join("=")];
          }),
      );
      for (const [key, value] of Object.entries(required))
        parameters.set(key, value);
      const nextFmtp = `a=fmtp:${payloadType} ${[...parameters]
        .map(([key, value]) => `${key}=${value}`)
        .join(";")}`;
      section = fmtp
        ? section.replace(fmtpPattern, nextFmtp)
        : section.replace(
            match[0],
            `${match[0].replace(/\r$/, "")}${lineEnd}${nextFmtp}`,
          );
      return /^a=ptime:/im.test(section)
        ? section.replace(/^a=ptime:[^\r\n]*/im, "a=ptime:10")
        : `${section.replace(/(?:\r?\n)+$/, "")}${lineEnd}a=ptime:10${lineEnd}`;
    })
    .join("");
}

function p2pCodecNameFromMimeType<T>(value: T) {
  const mimeType =
    String(value || "")
      .replace(/^video\//i, "")
      .split(/[;\s]/, 1)[0] || "";
  if (/^(HEVC|H\.265)$/i.test(mimeType)) return "H265" as const;
  return normalizeVideoCodecName(mimeType);
}

function isAuxiliaryP2pVideoCodec<T>(value: T) {
  return /^(video\/)?(rtx|red|ulpfec|flexfec)/i.test(String(value || ""));
}

export function applyP2pVideoCodecPreferences(
  pc: RTCPeerConnection,
  allowedCodecs?: Iterable<VideoCodecName> | null,
) {
  const capabilities =
    globalThis.RTCRtpReceiver?.getCapabilities?.("video")?.codecs ||
    globalThis.RTCRtpSender?.getCapabilities?.("video")?.codecs;
  if (!capabilities?.length) return false;
  const sortedPreferences = sortP2pVideoCodecPreferences(capabilities);
  const allowed = new Set(allowedCodecs || []);
  const preferences = allowed.size
    ? sortedPreferences.filter(
        (codec) =>
          isAuxiliaryP2pVideoCodec(codec.mimeType) ||
          (() => {
            const codecName = p2pCodecNameFromMimeType(codec.mimeType);
            return codecName !== null && allowed.has(codecName);
          })(),
      )
    : sortedPreferences;
  const selectedPreferences = preferences.length
    ? preferences
    : sortedPreferences;
  let applied = false;
  for (const transceiver of pc.getTransceivers?.() || []) {
    const kind =
      transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
    if (kind !== "video" || !transceiver.setCodecPreferences) continue;
    try {
      transceiver.setCodecPreferences(selectedPreferences);
      applied = true;
    } catch {}
  }
  return applied;
}

export function directIceServers<T>(servers: T): RTCIceServer[] {
  return normalizeIceServers(servers).flatMap((server) => {
    const urls = (
      Array.isArray(server.urls) ? server.urls : [server.urls]
    ).filter(
      (url) => isExternalString(url) && url.toLowerCase().startsWith("stun:"),
    );
    const firstUrl = urls[0];
    if (!firstUrl) return [];
    return [{ urls: Array.isArray(server.urls) ? urls : firstUrl }];
  });
}

export function normalizeIceServers<T>(servers: T): RTCIceServer[] {
  return (Array.isArray(servers) ? servers : []).flatMap((value) => {
    if (!isRecord(value)) return [];
    const server = value;
    const rawUrls: string[] = [];
    const candidateUrls = Array.isArray(server.urls)
      ? server.urls
      : [server.urls];
    for (const url of candidateUrls)
      if (isExternalString(url) && url.length > 0) rawUrls.push(url);
    const firstUrl = rawUrls[0];
    if (!firstUrl) return [];
    const normalized: RTCIceServer = {
      urls: Array.isArray(server.urls) ? rawUrls : firstUrl,
    };
    if (isExternalString(server.username))
      normalized.username = server.username;
    if (isExternalString(server.credential))
      normalized.credential = server.credential;
    return [normalized];
  });
}

export async function selectedPairSnapshot(
  pc: RTCPeerConnection,
  suppliedReport: RTCStatsReport | null = null,
) {
  const report = suppliedReport || (await pc.getStats());
  const byId = new Map<string, P2pStat>();
  report.forEach((stat) => {
    const parsed = p2pStat(stat);
    if (parsed?.id) byId.set(parsed.id, parsed);
  });
  let pair: P2pStat | null = null;
  let selectedPairId = "";
  report.forEach((rawStat) => {
    const stat = p2pStat(rawStat);
    if (!stat) return;
    if (stat.type === "transport" && stat.selectedCandidatePairId)
      selectedPairId = String(stat.selectedCandidatePairId);
  });
  if (selectedPairId) pair = byId.get(selectedPairId) || null;
  if (!pair) {
    report.forEach((rawStat) => {
      const stat = p2pStat(rawStat);
      if (!stat) return;
      if (
        stat.type === "candidate-pair" &&
        stat.state === "succeeded" &&
        stat.nominated
      )
        pair = stat;
    });
  }
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId || "")) || null;
  const remote = byId.get(String(pair.remoteCandidateId || "")) || null;
  return {
    id: pair.id,
    state: pair.state,
    nominated: !!pair.nominated,
    currentRoundTripTime: pair.currentRoundTripTime ?? null,
    availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
    bytesSent: pair.bytesSent ?? null,
    bytesReceived: pair.bytesReceived ?? null,
    packetsSent: pair.packetsSent ?? null,
    packetsReceived: pair.packetsReceived ?? null,
    local: local
      ? {
          address: local.address || local.ip || null,
          protocol: local.protocol || null,
          candidateType: local.candidateType || null,
        }
      : null,
    remote: remote
      ? {
          address: remote.address || remote.ip || null,
          protocol: remote.protocol || null,
          candidateType: remote.candidateType || null,
        }
      : null,
  };
}

export async function hasRequiredMediaFlow(
  pc: RTCPeerConnection,
  outboundCount: number,
  inboundCount: number,
) {
  if (outboundCount === 0 && inboundCount === 0) return true;
  const flow = await mediaFlowSnapshot(pc);
  return (
    flow.outboundCount >= outboundCount && flow.inboundCount >= inboundCount
  );
}

export async function mediaFlowSnapshot(
  pc: RTCPeerConnection,
  suppliedReport: RTCStatsReport | null = null,
  {
    outboundTracks = null,
    inboundTracks = null,
  }: {
    outboundTracks?: P2pTrackEntry[] | null;
    inboundTracks?: P2pTrackEntry[] | null;
  } = {},
) {
  const report = suppliedReport || (await pc.getStats());
  let flowingOutbound = 0;
  let flowingInbound = 0;
  let outboundBytes = 0;
  let inboundBytes = 0;
  const outboundFlows: P2pFlowEntry[] = [];
  const inboundFlows: P2pFlowEntry[] = [];
  const addTrackFlow = (
    tracks: P2pTrackEntry[] | null,
    type: "outbound-rtp" | "inbound-rtp",
    field: "bytesSent" | "bytesReceived",
    flows: P2pFlowEntry[],
  ) => {
    for (const item of tracks || []) {
      const track = item instanceof MediaStreamTrack ? item : item.track;
      const stat = findRtpStat(report, type, {
        trackId: track?.id,
        kind: track?.kind,
      });
      const bytes = Number(stat?.[field]);
      const flowing = Number.isFinite(bytes) && bytes > 0;
      flows.push({
        key: String(
          (item instanceof MediaStreamTrack ? undefined : item.key) ||
            track?.id ||
            "",
        ),
        bytes: Number.isFinite(bytes) ? bytes : 0,
        flowing,
      });
      if (!flowing) continue;
      if (type === "outbound-rtp") {
        flowingOutbound += 1;
        outboundBytes += bytes;
      } else {
        flowingInbound += 1;
        inboundBytes += bytes;
      }
    }
  };
  if (outboundTracks || inboundTracks) {
    addTrackFlow(outboundTracks, "outbound-rtp", "bytesSent", outboundFlows);
    addTrackFlow(inboundTracks, "inbound-rtp", "bytesReceived", inboundFlows);
  } else {
    report.forEach((rawStat) => {
      const stat = p2pStat(rawStat);
      if (!stat) return;
      if (
        stat.type === "outbound-rtp" &&
        !stat.isRemote &&
        Number(stat.bytesSent) > 0
      ) {
        flowingOutbound += 1;
        outboundBytes += Number(stat.bytesSent);
      }
      if (
        stat.type === "inbound-rtp" &&
        !stat.isRemote &&
        Number(stat.bytesReceived) > 0
      ) {
        flowingInbound += 1;
        inboundBytes += Number(stat.bytesReceived);
      }
    });
  }
  return {
    outboundCount: flowingOutbound,
    inboundCount: flowingInbound,
    outboundBytes,
    inboundBytes,
    outboundFlows,
    inboundFlows,
  };
}

export type SelectedP2pPath = "direct" | "relay";

export type P2pIcePolicy = "direct-only" | "direct-or-relay";

export function p2pIcePolicyAllowsRelay(policy: P2pIcePolicy): boolean {
  return policy === "direct-or-relay";
}

export function normalizeP2pIcePolicy<T>(policy: T): P2pIcePolicy {
  return policy === "direct-or-relay" ? "direct-or-relay" : "direct-only";
}

export function isViableP2pPair(
  pair: Record<string, unknown> | null | undefined,
) {
  const local = isRecord(pair?.local) ? pair.local : null;
  const remote = isRecord(pair?.remote) ? pair.remote : null;
  return (
    !!pair &&
    pair.state === "succeeded" &&
    !!local?.candidateType &&
    !!remote?.candidateType
  );
}

export function classifyP2pPath(
  pair: Record<string, unknown> | null | undefined,
): SelectedP2pPath | null {
  if (!pair) return null;
  const local = isRecord(pair.local) ? pair.local : null;
  const remote = isRecord(pair.remote) ? pair.remote : null;
  if (!local?.candidateType || !remote?.candidateType) return null;
  if (local.candidateType === "relay" || remote.candidateType === "relay")
    return "relay";
  return "direct";
}

export function isDirectP2pPair(
  pair: Record<string, unknown> | null | undefined,
) {
  return classifyP2pPath(pair) === "direct";
}

export function isAllowedP2pPair(
  pair: Record<string, unknown> | null | undefined,
  policy: P2pIcePolicy,
) {
  if (!isViableP2pPair(pair)) return false;
  if (p2pIcePolicyAllowsRelay(policy)) return true;
  return isDirectP2pPair(pair);
}

export function qualificationUsesRelay(
  candidateReports: Array<Record<string, unknown>> | null | undefined,
): boolean {
  const reports = Array.isArray(candidateReports) ? candidateReports : [];
  for (const report of reports) {
    const record = isRecord(report) ? report : null;
    if (!record) continue;
    if (record.path === "relay") return true;
    const localType = isExternalString(record.localCandidateType)
      ? record.localCandidateType
      : null;
    const remoteType = isExternalString(record.remoteCandidateType)
      ? record.remoteCandidateType
      : null;
    if (localType === "relay" || remoteType === "relay") return true;
  }
  return false;
}

export function configureP2pSender(
  mesh: {
    getSenderOptions?: (
      source: string,
      track: MediaStreamTrack,
    ) => Record<string, unknown> | null;
    updateSender: (
      sender: RTCRtpSender,
      operation: () => Promise<MediaCommandResult>,
    ) => Promise<MediaCommandResult>;
  },
  sender: RTCRtpSender,
  source: string,
  track: MediaStreamTrack,
) {
  const options = mesh.getSenderOptions?.(source, track);
  if (!options) return false;
  return mesh.updateSender(sender, () =>
    applyRtpSenderSettings(sender, options),
  );
}
