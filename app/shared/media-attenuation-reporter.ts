interface AttenuationPeer {
  peerId?: string | number | null;
  userId?: string | number | null;
}

export interface AttenuationEntry {
  peerId?: string | number | null;
  userId?: string | number | null;
}

export interface AttenuationReportInput {
  active: boolean;
  baseVolume: number;
  effectiveVolume: number;
  entry: AttenuationEntry;
}

export interface MediaAttenuationState {
  fromPeerId?: string | number | null;
  source?: string;
  active?: boolean;
  effectivePercent?: number | string;
}

interface AttenuationReport {
  active: boolean;
  effectivePercent: number;
}

export function createMediaAttenuationReporter({
  getLocalPeerId,
  getPeers,
  onReportsChange,
  send,
}: {
  getLocalPeerId: () => string | number | null;
  getPeers: () => AttenuationPeer[];
  onReportsChange: (reports: Map<string, AttenuationReport>) => void;
  send: (message: SignalingMessage) => boolean;
}) {
  const reports = new Map<string, AttenuationReport>();
  const sentStates = new Map<string, string>();

  function notify() {
    onReportsChange(new Map(reports));
  }

  function report({
    active,
    baseVolume,
    effectiveVolume,
    entry,
  }: AttenuationReportInput) {
    const targetPeerId =
      entry.peerId ||
      getPeers().find((peer) => String(peer.userId) === String(entry.userId))
        ?.peerId;
    if (!targetPeerId || String(targetPeerId) === String(getLocalPeerId()))
      return;
    const effectivePercent =
      baseVolume > 0
        ? Math.round((effectiveVolume / baseVolume) * 100)
        : active
          ? 0
          : 100;
    const key = String(targetPeerId);
    const signature = `${active}:${effectivePercent}`;
    if (sentStates.get(key) === signature) return;
    if (
      send({
        type: "attenuation-state",
        data: {
          active,
          effectivePercent,
          source: "screen-audio",
          targetPeerId: key,
        },
      })
    )
      sentStates.set(key, signature);
  }

  function receive(data: MediaAttenuationState) {
    if (
      !data.fromPeerId ||
      data.source !== "screen-audio" ||
      !Number.isFinite(Number(data.effectivePercent))
    )
      return;
    reports.set(String(data.fromPeerId), {
      active: data.active === true,
      effectivePercent: Math.max(
        0,
        Math.min(200, Math.round(Number(data.effectivePercent))),
      ),
    });
    notify();
  }

  function prune() {
    const peerIds = new Set(getPeers().map((peer) => String(peer.peerId)));
    for (const peerId of reports.keys())
      if (!peerIds.has(peerId)) reports.delete(peerId);
    for (const peerId of sentStates.keys())
      if (!peerIds.has(peerId)) sentStates.delete(peerId);
    notify();
  }

  function clear() {
    reports.clear();
    sentStates.clear();
    notify();
  }

  return { clear, prune, receive, report };
}

export function summarizeMediaAttenuation(
  reports: Map<string, AttenuationReport>,
  peers: AttenuationPeer[],
  localPeerId: string | number | null,
) {
  const values = [...reports.values()];
  return {
    active: values.some((report) => report.active),
    effectivePercent: values.length
      ? Math.min(...values.map((report) => report.effectivePercent))
      : 100,
    expectedListeners: peers.filter(
      (peer) => String(peer.peerId) !== String(localPeerId),
    ).length,
    reportingListeners: values.length,
  };
}

export function buildMediaAttenuationWatchKey({
  roomAttenuation,
  streamAttenuation,
  speaking,
  connected = false,
  sessionAvailable = false,
}: {
  roomAttenuation?: Record<string, unknown> | null;
  streamAttenuation?: {
    mode?: string;
    reductionPercent?: number;
  } | null;
  speaking: boolean;
  connected?: boolean;
  sessionAvailable?: boolean;
}) {
  return [
    streamAttenuation?.mode,
    streamAttenuation?.reductionPercent,
    roomAttenuation?.enabled,
    roomAttenuation?.reductionPercent,
    roomAttenuation?.sensitivity,
    roomAttenuation?.attackMs,
    roomAttenuation?.releaseMs,
    speaking,
    connected,
    sessionAvailable,
  ] as const;
}

export function resolveMediaAttenuation(
  roomValue: Record<string, unknown> | null | undefined,
  override: {
    mode?: string;
    reductionPercent?: number;
  },
) {
  const attenuation = roomValue || {
    enabled: true,
    reductionPercent: 65,
    sensitivity: "standard",
    attackMs: 120,
    releaseMs: 650,
  };
  if (override.mode === "disabled") return { ...attenuation, enabled: false };
  if (override.mode === "enabled")
    return {
      ...attenuation,
      enabled: true,
      reductionPercent: override.reductionPercent,
    };
  return attenuation;
}
import type { SignalingMessage } from "./types/media-signaling.ts";
