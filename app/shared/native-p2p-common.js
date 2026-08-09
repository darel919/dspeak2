import { applyRtpSenderSettings } from "./rtp-sender-settings.js";
import { sortP2pVideoCodecPreferences } from "./video-settings.js";

export const P2P_ACTIVE_HEALTH_TIMEOUT_MS = 20000;
export const P2P_STABILITY_LIVENESS_TIMEOUT_MS = 8000;
export const P2P_DISCONNECT_GRACE_MS = 8000;
export const P2P_ICE_RESTART_TIMEOUT_MS = 12000;

export function p2pActiveLivenessTimeoutMs(connectionCount) {
  return Math.max(
    10000,
    P2P_ACTIVE_HEALTH_TIMEOUT_MS -
      Math.max(0, Number(connectionCount) - 1) * 5000,
  );
}

export function isP2pLivenessExpired(lastProgressAt, now, timeoutMs) {
  return (
    Number.isFinite(lastProgressAt) &&
    Number.isFinite(now) &&
    now - lastProgressAt >= timeoutMs
  );
}

export function requiresP2pLiveness(mode, readyReported) {
  return mode === "p2p" || (mode === "probing" && readyReported);
}

export function countEnabledP2pSources(sources, receiving = new Map()) {
  return [...(sources || [])].filter(
    (source) => receiving.get(String(source)) !== false,
  ).length;
}

export function p2pRemoteFeedKey(peerId, source) {
  return `p2p:${String(peerId)}:${String(source || "media")}`;
}

export function applyOpusAudioProfile(sdp, stereo = true) {
  if (!sdp) return sdp;
  return String(sdp)
    .split(/(?=m=)/)
    .map((section) => {
      if (!section.startsWith("m=audio ")) return section;
      const match = section.match(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/im);
      if (!match) return section;
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
        : section.replace(match[0], `${match[0]}\r\n${nextFmtp}`);
      return /^a=ptime:/im.test(section)
        ? section.replace(/^a=ptime:[^\r\n]*/im, "a=ptime:10")
        : `${section.replace(/\s*$/, "")}\r\na=ptime:10\r\n`;
    })
    .join("");
}

export function applyP2pVideoCodecPreferences(pc) {
  const capabilities =
    globalThis.RTCRtpReceiver?.getCapabilities?.("video")?.codecs ||
    globalThis.RTCRtpSender?.getCapabilities?.("video")?.codecs;
  if (!capabilities?.length) return false;
  const preferences = sortP2pVideoCodecPreferences(capabilities);
  let applied = false;
  for (const transceiver of pc.getTransceivers?.() || []) {
    const kind =
      transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
    if (kind !== "video" || !transceiver.setCodecPreferences) continue;
    transceiver.setCodecPreferences(preferences);
    applied = true;
  }
  return applied;
}

export function directIceServers(servers) {
  return (Array.isArray(servers) ? servers : []).flatMap((server) => {
    const urls = (
      Array.isArray(server.urls) ? server.urls : [server.urls]
    ).filter(
      (url) => typeof url === "string" && url.toLowerCase().startsWith("stun:"),
    );
    if (!urls.length) return [];
    return [{ urls: Array.isArray(server.urls) ? urls : urls[0] }];
  });
}

export async function selectedPairSnapshot(pc, suppliedReport = null) {
  const report = suppliedReport || (await pc.getStats());
  const byId = new Map();
  report.forEach((stat) => byId.set(stat.id, stat));
  let pair = null;
  let transport = null;
  report.forEach((stat) => {
    if (stat.type === "transport" && stat.selectedCandidatePairId)
      transport = stat;
  });
  if (transport) pair = byId.get(transport.selectedCandidatePairId) || null;
  if (!pair) {
    report.forEach((stat) => {
      if (
        stat.type === "candidate-pair" &&
        stat.state === "succeeded" &&
        stat.nominated
      )
        pair = stat;
    });
  }
  if (!pair) return null;
  const local = byId.get(pair.localCandidateId) || null;
  const remote = byId.get(pair.remoteCandidateId) || null;
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

export async function hasRequiredMediaFlow(pc, outboundCount, inboundCount) {
  if (outboundCount === 0 && inboundCount === 0) return true;
  const flow = await mediaFlowSnapshot(pc);
  return (
    flow.outboundCount >= outboundCount && flow.inboundCount >= inboundCount
  );
}

export async function mediaFlowSnapshot(pc, suppliedReport = null) {
  const report = suppliedReport || (await pc.getStats());
  let flowingOutbound = 0;
  let flowingInbound = 0;
  let outboundBytes = 0;
  let inboundBytes = 0;
  report.forEach((stat) => {
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
  return {
    outboundCount: flowingOutbound,
    inboundCount: flowingInbound,
    outboundBytes,
    inboundBytes,
  };
}

export function isViableP2pPair(pair) {
  return (
    !!pair &&
    pair.state === "succeeded" &&
    !!pair.local?.candidateType &&
    !!pair.remote?.candidateType &&
    pair.local.candidateType !== "relay" &&
    pair.remote.candidateType !== "relay"
  );
}

export function configureP2pSender(mesh, sender, source, track) {
  const options = mesh.getSenderOptions?.(source, track);
  if (!options) return false;
  return mesh.updateSender(sender, () =>
    applyRtpSenderSettings(sender, options),
  );
}
