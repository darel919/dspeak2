import { byteTimeDomainLevelDb } from "./microphone-gate.ts";
import { triggerRef } from "vue";
import {
  isPairedScreenAudio,
  isStandaloneSystemAudio,
  normalizeMediaOwnerSource,
} from "./media-source-ownership.ts";
import type { Ref } from "vue";
import type {
  AudioGraph,
  AudioGraphTrack,
  RegistryAttenuation,
  RemoteMediaEntry,
  VoiceDetector,
} from "./types/hybrid-media-registry.ts";
import type { AttenuationReportInput } from "./media-attenuation-reporter.ts";
import type {
  RemoteSourceIncarnation,
  RemoteSourceConvergenceState,
  RemoteSourcePhase,
} from "./remote-source-convergence.ts";
import {
  createRemoteSourceIncarnation,
  buildRemoteReceiverIncarnationId,
  createRemoteSourceConvergenceState,
  advancePhase,
  checkRtpProgression,
  checkAudioRtpProgression,
  retireIncarnation,
  detectStall,
  scheduleRecovery,
  clearStall,
  promoteConvergence,
  recordFirstFrameEvidence,
  setIntentionalReceivingDisabled,
  DEFAULT_REMOTE_SOURCE_FSM_CONFIG,
} from "./remote-source-convergence.ts";
import type { RemoteReceiverStats } from "./remote-source-convergence.ts";

const REMOTE_VOICE_ACTIVITY_THRESHOLD_DB = -42;
const VISIBLE_VOICE_DETECTION_INTERVAL_MS = 120;
const HIDDEN_VOICE_DETECTION_INTERVAL_MS = 300;

export interface RemoteMediaRegistryOptions {
  audioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  videoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  getVolume: (userId: string, source: string) => number;
  getOutputDevice: () => string | null;
  isDeafened: () => boolean;
  isBroadcastMode: () => boolean;
  isAnyoneSpeaking: () => boolean;
  onSpeaking: (userId: string, speaking: boolean) => unknown;
  getAttenuation: (
    entry: Record<string, unknown>,
  ) => RegistryAttenuation | null;
  onVideoReceivingChange: (
    entry: RemoteMediaEntry,
    receiving: boolean,
  ) => unknown;
  onPlaybackState: (state: {
    userId: string | null;
    state: string;
    error: { name: string; message: string } | null;
  }) => unknown;
  onEffectiveGain: (state: AttenuationReportInput) => unknown;
  getReceiverStats?: (
    entry: RemoteMediaEntry,
  ) => Promise<RemoteReceiverStats | null>;
  onReceiverRecovery?: (
    entry: RemoteMediaEntry,
    attempt: number,
    signal: AbortSignal,
  ) => Promise<boolean> | boolean;
  onReceiverFailed?: (entry: RemoteMediaEntry) => unknown;
}

export function replaceMediaStreamTrack(
  stream: MediaStream,
  track: MediaStreamTrack,
) {
  if (!stream.getTracks().includes(track)) stream.addTrack(track);
  for (const currentTrack of stream.getTracks()) {
    if (currentTrack !== track) stream.removeTrack(currentTrack);
  }
  return stream;
}
export class RemoteMediaRegistry {
  audioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  videoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  getVolume: RemoteMediaRegistryOptions["getVolume"];
  getOutputDevice: RemoteMediaRegistryOptions["getOutputDevice"];
  isDeafened: RemoteMediaRegistryOptions["isDeafened"];
  isBroadcastMode: RemoteMediaRegistryOptions["isBroadcastMode"];
  isAnyoneSpeaking: RemoteMediaRegistryOptions["isAnyoneSpeaking"];
  onSpeaking: RemoteMediaRegistryOptions["onSpeaking"];
  getAttenuation: RemoteMediaRegistryOptions["getAttenuation"];
  onVideoReceivingChange: RemoteMediaRegistryOptions["onVideoReceivingChange"];
  onPlaybackState: RemoteMediaRegistryOptions["onPlaybackState"];
  onEffectiveGain: RemoteMediaRegistryOptions["onEffectiveGain"];
  getReceiverStats: RemoteMediaRegistryOptions["getReceiverStats"];
  onReceiverRecovery: RemoteMediaRegistryOptions["onReceiverRecovery"];
  onReceiverFailed: RemoteMediaRegistryOptions["onReceiverFailed"];
  voiceDetectors: Map<string, VoiceDetector>;
  speakingUsers: Set<string>;
  participantAudio: Map<string, AudioGraph>;
  receivingPreferences: Map<string, boolean>;
  audioContext: AudioContext | null;
  audioContextToken: number;
  voiceDetectionTimer: ReturnType<typeof setTimeout> | null;
  externalSpeakingUsers: Set<string>;
  remoteSourceConvergence: Map<string, RemoteSourceConvergenceState>;
  receiverHealthTimer: ReturnType<typeof setTimeout> | null;
  receiverHealthRunning: boolean;
  receiverHealthGeneration: number;
  receiverHealthRestartRequested: boolean;

  constructor({
    audioFeeds,
    videoFeeds,
    getVolume,
    getOutputDevice,
    isDeafened,
    isBroadcastMode,
    isAnyoneSpeaking,
    onSpeaking,
    getAttenuation = () => null,
    onVideoReceivingChange,
    onPlaybackState,
    onEffectiveGain,
    getReceiverStats,
    onReceiverRecovery,
    onReceiverFailed,
  }: RemoteMediaRegistryOptions) {
    this.audioFeeds = audioFeeds;
    this.videoFeeds = videoFeeds;
    this.getVolume = getVolume;
    this.getOutputDevice = getOutputDevice;
    this.isDeafened = isDeafened;
    this.isBroadcastMode = isBroadcastMode;
    this.isAnyoneSpeaking = isAnyoneSpeaking;
    this.onSpeaking = onSpeaking;
    this.getAttenuation = getAttenuation;
    this.onVideoReceivingChange = onVideoReceivingChange;
    this.onPlaybackState = onPlaybackState;
    this.onEffectiveGain = onEffectiveGain;
    this.getReceiverStats = getReceiverStats;
    this.onReceiverRecovery = onReceiverRecovery;
    this.onReceiverFailed = onReceiverFailed;
    this.voiceDetectors = new Map();
    this.speakingUsers = new Set();
    this.participantAudio = new Map();
    this.receivingPreferences = new Map();
    this.audioContext = null;
    this.audioContextToken = 0;
    this.voiceDetectionTimer = null;
    this.externalSpeakingUsers = new Set();
    this.remoteSourceConvergence = new Map();
    this.receiverHealthTimer = null;
    this.receiverHealthRunning = false;
    this.receiverHealthGeneration = 0;
    this.receiverHealthRestartRequested = false;
  }

  retireCurrentEntry(key: string) {
    const current =
      this.videoFeeds.value.get(key) || this.audioFeeds.value.get(key) || null;
    const state = this.remoteSourceConvergence.get(key);
    if (state) retireIncarnation(state);
    this.remoteSourceConvergence.delete(key);
    this.audioFeeds.value.delete(key);
    this.videoFeeds.value.delete(key);
    if (current?.kind === "audio") this.removeAudioTrack(current);
    this.stopVoiceDetection(key);
    triggerRef(this.audioFeeds);
    triggerRef(this.videoFeeds);
  }

  createIncarnation(entry: RemoteMediaEntry): RemoteSourceIncarnation {
    const provider = entry.provider as RemoteSourceIncarnation["provider"];
    const connectionEpoch = entry.connectionEpoch ?? 1;
    const sourceGeneration = entry.sourceGeneration ?? 1;
    const receiverIncarnationId =
      entry.receiverIncarnationId ||
      buildRemoteReceiverIncarnationId({
        stableFeedKey: entry.key,
        provider,
        connectionEpoch,
        sourceGeneration,
        publicationId: entry.publicationId,
        producerId: entry.producerId,
        consumerId: entry.consumerId,
        cloudflareSessionId:
          String(entry.cloudflareSessionId || "") || undefined,
        cloudflareTrackName:
          String(entry.cloudflareTrackName || "") || undefined,
        nativeTrackHandle: entry.nativeTrackHandle || entry.track?.id,
        logicalStreamId: entry.logicalStreamId,
        variantId: entry.variantId,
      });
    return createRemoteSourceIncarnation({
      receiverIncarnationId,
      stableFeedKey: entry.key,
      provider,
      peerId: String(entry.peerId ?? ""),
      userId: String(entry.userId ?? ""),
      source: entry.source,
      connectionEpoch,
      sourceGeneration,
      publicationId: entry.publicationId,
      producerId: entry.producerId,
      consumerId: entry.consumerId,
      cloudflareSessionId: entry.cloudflareSessionId,
      cloudflareTrackName: entry.cloudflareTrackName,
      nativeTrackHandle: entry.nativeTrackHandle || entry.track?.id,
      logicalStreamId: entry.logicalStreamId,
      variantId: entry.variantId,
    });
  }

  bind(entry: RemoteMediaEntry, { staged = false }: { staged?: boolean } = {}) {
    const normalizedEntry =
      entry?.source === "screen-audio"
        ? {
            ...entry,
            ownerSource: normalizeMediaOwnerSource(
              entry.source,
              entry.ownerSource,
            ),
          }
        : entry;
    entry = normalizedEntry;
    const existingConvergence = this.remoteSourceConvergence.get(entry.key);
    const previousEntry =
      this.videoFeeds.value.get(entry.key) ||
      this.audioFeeds.value.get(entry.key);
    if (
      previousEntry?.stream &&
      entry.track?.kind === "video" &&
      previousEntry.track?.kind === "video"
    )
      entry = { ...entry, stream: previousEntry.stream };
    if (
      previousEntry?.stream &&
      entry.stream &&
      entry.track &&
      typeof entry.stream.getTracks === "function"
    )
      replaceMediaStreamTrack(entry.stream, entry.track);
    const incarnation = this.createIncarnation(entry);
    const isNewIncarnation =
      !existingConvergence ||
      existingConvergence.incarnation.receiverIncarnationId !==
        incarnation.receiverIncarnationId;
    if (isNewIncarnation && existingConvergence)
      this.retireCurrentEntry(entry.key);
    let convergenceState = this.remoteSourceConvergence.get(entry.key);
    if (!convergenceState) {
      convergenceState = createRemoteSourceConvergenceState(incarnation);
      this.remoteSourceConvergence.set(entry.key, convergenceState);
      advancePhase(convergenceState, "announced");
    }
    entry.incarnation = convergenceState.incarnation;
    entry.receiverIncarnationId =
      convergenceState.incarnation.receiverIncarnationId;
    entry.convergenceState = convergenceState;

    if (entry.native && !entry.track) {
      const feeds = entry.kind === "video" ? this.videoFeeds : this.audioFeeds;
      const current = feeds.value.get(entry.key);
      const receiving =
        entry.kind === "video" && entry.source === "screen"
          ? (this.receivingPreferences.get(entry.key) ??
            current?.receiving ??
            false)
          : isPairedScreenAudio(entry)
            ? this.screenReceivingFor(entry.userId)
            : entry.receiving !== false;
      setIntentionalReceivingDisabled(convergenceState, !receiving);
      advancePhase(convergenceState, "transport-connected");
      const normalized = { ...entry, stream: null, receiving };
      feeds.value.set(entry.key, normalized);
      triggerRef(feeds);
      if (entry.kind === "video") {
        this.onVideoReceivingChange?.(normalized, Boolean(receiving));
        if (entry.source === "screen")
          this.setPairedScreenAudioReceiving(entry.userId, receiving);
      } else if (isPairedScreenAudio(normalized))
        this.onVideoReceivingChange?.(normalized, Boolean(receiving));
      this.startReceiverHealthSampling();
      return;
    }
    if (!entry?.track) return;
    advancePhase(convergenceState, "transport-connected");
    const trackEntry = { ...entry, track: entry.track };
    if (entry.track.kind === "video") {
      const current = this.videoFeeds.value.get(entry.key);
      const stream = entry.stream || new MediaStream([entry.track]);
      const receiving =
        entry.source === "screen"
          ? (this.receivingPreferences.get(entry.key) ??
            current?.receiving ??
            false)
          : typeof document === "undefined" || !document.hidden;
      entry.track.enabled = receiving;
      setIntentionalReceivingDisabled(convergenceState, !receiving);
      this.videoFeeds.value.set(entry.key, { ...entry, stream, receiving });
      triggerRef(this.videoFeeds);
      if (entry.source === "screen") {
        this.onVideoReceivingChange?.(entry, receiving);
        this.setPairedScreenAudioReceiving(entry.userId, receiving);
      }
      this.startReceiverHealthSampling();
      return;
    }
    const receiving = isPairedScreenAudio(entry)
      ? this.screenReceivingFor(entry.userId)
      : entry.receiving !== false;
    entry.track.enabled = receiving;
    setIntentionalReceivingDisabled(convergenceState, !receiving);
    this.audioFeeds.value.set(entry.key, { ...entry, receiving });
    triggerRef(this.audioFeeds);
    this.createAudioElement({ ...trackEntry, receiving }, staged);
    if (entry.source === "audio") this.startVoiceDetection(trackEntry);
    if (isPairedScreenAudio(entry))
      this.onVideoReceivingChange?.(entry, receiving);
    this.startReceiverHealthSampling();
  }

  setVideoReceiving(key: string, receiving: boolean, persistPreference = true) {
    const entry = this.videoFeeds.value.get(key);
    if (!entry) return false;
    const convergenceState = this.remoteSourceConvergence.get(key);
    if (entry.track) entry.track.enabled = Boolean(receiving);
    if (convergenceState)
      setIntentionalReceivingDisabled(convergenceState, !receiving);
    if (entry.source === "screen" && persistPreference)
      this.receivingPreferences.set(key, Boolean(receiving));
    this.videoFeeds.value.set(key, {
      ...entry,
      receiving: Boolean(receiving),
    });
    triggerRef(this.videoFeeds);
    this.onVideoReceivingChange?.(entry, Boolean(receiving));
    if (entry.source === "screen" && persistPreference)
      this.setPairedScreenAudioReceiving(entry.userId, receiving);
    if (receiving) this.startReceiverHealthSampling();
    return true;
  }

  markFirstFrame(
    key: string,
    expectedReceiverIncarnation: string | null = null,
    at = Date.now(),
    fallback = false,
  ) {
    const convergenceState = this.remoteSourceConvergence.get(key);
    if (!convergenceState) return false;
    if (
      expectedReceiverIncarnation &&
      convergenceState.incarnation.receiverIncarnationId !==
        expectedReceiverIncarnation
    )
      return false;
    const changed = recordFirstFrameEvidence(convergenceState, at, {
      fallback,
    });
    if (!changed) return false;
    const video = this.videoFeeds.value.get(key);
    if (video) {
      this.videoFeeds.value.set(key, {
        ...video,
        firstFrameAt: video.firstFrameAt || at,
      });
      triggerRef(this.videoFeeds);
    }
    return true;
  }

  setDocumentHidden(hidden: boolean) {
    for (const [key, entry] of this.videoFeeds.value) {
      if (entry.source === "screen") {
        const receiving = hidden
          ? false
          : (this.receivingPreferences.get(key) ?? entry.receiving ?? false);
        this.setVideoReceiving(key, receiving, false);
        continue;
      }
      this.setVideoReceiving(key, !hidden);
    }
  }

  setAudioReceiving(key: string, receiving: boolean) {
    const entry = this.audioFeeds.value.get(key);
    if (!entry || !isStandaloneSystemAudio(entry)) return false;
    return this.updateAudioReceiving(entry, receiving);
  }

  updateAudioReceiving(entry: RemoteMediaEntry, receiving: boolean) {
    const key = entry.key;
    const convergenceState = this.remoteSourceConvergence.get(key);
    entry.receiving = Boolean(receiving);
    if (entry.track) entry.track.enabled = Boolean(receiving);
    if (convergenceState)
      setIntentionalReceivingDisabled(convergenceState, !receiving);
    this.audioFeeds.value.set(key, { ...entry });
    triggerRef(this.audioFeeds);
    this.onVideoReceivingChange?.(entry, Boolean(receiving));
    if (receiving) this.startReceiverHealthSampling();
    return true;
  }

  screenReceivingFor(userId: string | number | null | undefined) {
    const screen = [...this.videoFeeds.value.values()].find(
      (entry) =>
        entry.source === "screen" && String(entry.userId) === String(userId),
    );
    return screen?.receiving === true;
  }

  setPairedScreenAudioReceiving(
    userId: string | number | null | undefined,
    receiving: boolean,
  ) {
    let changed = false;
    for (const entry of this.audioFeeds.value.values()) {
      if (
        String(entry.userId) !== String(userId) ||
        !isPairedScreenAudio(entry)
      )
        continue;
      changed = this.updateAudioReceiving(entry, receiving) || changed;
    }
    return changed;
  }

  clearReceivingPreference(key: string) {
    this.receivingPreferences.delete(key);
  }

  activateProvider(provider: string) {
    for (const graph of this.participantAudio.values()) {
      for (const track of graph.tracks.values()) {
        track.active = track.entry.provider === provider;
        this.applyTrackGain(graph, track);
      }
      if (!this.isDeafened() && !this.isBroadcastMode())
        this.resumeGraph(graph);
    }
  }

  setExternalSpeaking(userId: string | number, speaking: boolean) {
    const normalizedUserId = String(userId);
    if (speaking) this.externalSpeakingUsers.add(normalizedUserId);
    else this.externalSpeakingUsers.delete(normalizedUserId);
    this.applyAttenuation();
  }

  remove(key: string, owner: RemoteMediaEntry | null = null) {
    const audio = this.audioFeeds.value.get(key);
    const video = this.videoFeeds.value.get(key);
    if (!audio && !video) return;
    const current = video ?? audio;
    if (!current) return;
    if (owner?.provider && current.provider !== owner.provider) return;
    if (owner?.track && current.track !== owner.track) return;
    this.audioFeeds.value.delete(key);
    this.videoFeeds.value.delete(key);
    const convergenceState = this.remoteSourceConvergence.get(key);
    if (convergenceState) {
      retireIncarnation(convergenceState);
      this.remoteSourceConvergence.delete(key);
    }
    triggerRef(this.audioFeeds);
    triggerRef(this.videoFeeds);
    if (audio) this.removeAudioTrack(audio);
    this.stopVoiceDetection(key);
  }

  clearProvider(provider: string) {
    const keys = new Set<string>();
    for (const [key, entry] of this.audioFeeds.value)
      if (entry.provider === provider) keys.add(key);
    for (const [key, entry] of this.videoFeeds.value)
      if (entry.provider === provider) keys.add(key);
    for (const key of keys) this.remove(key);
  }

  clear() {
    this.stopReceiverHealthSampling();
    const keys = new Set([
      ...this.audioFeeds.value.keys(),
      ...this.videoFeeds.value.keys(),
    ]);
    for (const key of keys) this.remove(key);
    for (const graph of this.participantAudio.values()) this.closeGraph(graph);
    this.participantAudio.clear();
    this.receivingPreferences.clear();
    this.speakingUsers.clear();
    this.externalSpeakingUsers.clear();
    this.stopVoiceDetectionScheduler();
    const context = this.audioContext;
    const contextToken = this.audioContextToken;
    this.audioContext = null;
    this.audioContextToken += 1;
    if (context) {
      try {
        Promise.resolve(context.close()).catch((error) => {
          if (this.audioContextToken === contextToken + 1 && !this.audioContext)
            this.publishPlaybackState(null, "context-close-failed", error);
        });
      } catch (error) {
        if (this.audioContextToken === contextToken + 1 && !this.audioContext)
          this.publishPlaybackState(null, "context-close-failed", error);
      }
    }
  }

  createAudioElement(
    entry: RemoteMediaEntry & { track: MediaStreamTrack },
    staged: boolean,
  ) {
    const graph = this.getOrCreateGraph(entry.userId);
    const audio = document.createElement("audio");
    audio.id = `audio-${entry.key}`;
    audio.dataset.userId = String(entry.userId);
    audio.autoplay = true;
    audio.controls = false;
    audio.playsInline = true;
    audio.srcObject = new MediaStream([entry.track]);
    this.audioContainer().appendChild(audio);
    const source = graph.context.createMediaElementSource(audio);
    const gain = graph.context.createGain();
    const handleUnmute = () => this.resumeGraph(graph);
    entry.track.addEventListener?.("unmute", handleUnmute);
    const track = {
      active: !staged,
      audio,
      entry,
      gain,
      handleUnmute,
      source,
    };
    source.connect(gain);
    gain.connect(graph.context.destination);
    graph.tracks.set(entry.key, track);
    this.applyTrackGain(graph, track, true);
    if (!this.isDeafened() && !this.isBroadcastMode() && !staged)
      this.resumeGraph(graph);
  }

  getOrCreateGraph(userId: string | number | null | undefined): AudioGraph {
    const normalizedUserId = String(userId);
    const existing = this.participantAudio.get(normalizedUserId);
    if (existing) return existing;
    const context = this.getAudioContext();
    const graph = {
      context,
      tracks: new Map<string, AudioGraphTrack>(),
      userId: normalizedUserId,
      resumeAttempt: 0,
      resumePromise: null,
      resumeTimer: null,
      closed: false,
      resumeGeneration: 0,
    };
    this.participantAudio.set(normalizedUserId, graph);
    return graph;
  }

  getAudioContext(): AudioContext {
    if (this.audioContext) return this.audioContext;
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    const contextToken = this.audioContextToken + 1;
    this.audioContextToken = contextToken;
    this.audioContext = context;
    const sinkId = this.getOutputDevice();
    if (sinkId && typeof context.setSinkId === "function") {
      try {
        Promise.resolve(context.setSinkId(sinkId)).catch((error) => {
          if (
            this.audioContext === context &&
            this.audioContextToken === contextToken
          )
            void this.recoverOutputDevice(context, null, error);
        });
      } catch (error) {
        if (
          this.audioContext === context &&
          this.audioContextToken === contextToken
        )
          void this.recoverOutputDevice(context, null, error);
      }
    }
    return context;
  }

  getAudioLatencySnapshot() {
    const context = this.audioContext;
    return {
      latencyHint: context ? "interactive" : null,
      contextState: context?.state || null,
      baseLatency:
        context && Number.isFinite(Number(context.baseLatency))
          ? Number(context.baseLatency) * 1000
          : null,
      outputLatency:
        context && Number.isFinite(Number(context.outputLatency))
          ? Number(context.outputLatency) * 1000
          : null,
    };
  }

  async preparePlayback() {
    try {
      const context = this.getAudioContext();
      await context.resume();
      const ready = context.state === "running";
      this.publishPlaybackState(
        null,
        ready ? "prepared" : "blocked",
        ready ? null : new Error(`Audio context is ${context.state}`),
      );
      return ready;
    } catch (error) {
      this.publishPlaybackState(null, "blocked", error);
      return false;
    }
  }

  audioContainer() {
    let container = document.getElementById("webrtc-audio-global");
    if (container) return container;
    container = document.createElement("div");
    container.id = "webrtc-audio-global";
    container.hidden = true;
    document.body.appendChild(container);
    return container;
  }

  applyOutputDevice() {
    const sinkId = this.getOutputDevice();
    const context = this.audioContext;
    if (!context || typeof context.setSinkId !== "function") {
      if (sinkId)
        this.publishPlaybackState(
          null,
          "output-failed",
          new Error("Audio output selection is unavailable"),
        );
      return Promise.resolve(!sinkId);
    }
    return context
      .setSinkId(sinkId || "")
      .then(() => {
        this.publishPlaybackState(null, sinkId ? "ready" : "default-output");
        return true;
      })
      .catch((error) => this.recoverOutputDevice(context, null, error));
  }

  applyVolume(userId: string | number, source: string, volume: number) {
    const graph = this.participantAudio.get(String(userId));
    if (!graph) return;
    for (const track of graph.tracks.values())
      if (!source || track.entry.source === source)
        this.applyTrackGain(graph, track, false, volume);
  }

  attenuatedVolume(source: string, baseVolume: number) {
    if (
      !this.speakingUsers.size &&
      !this.externalSpeakingUsers.size &&
      !this.isAnyoneSpeaking?.()
    )
      return baseVolume;
    if (!["screen-audio", "system-audio"].includes(source)) return baseVolume;
    const attenuation = this.getAttenuation({}) || { enabled: false };
    if (!attenuation.enabled) return baseVolume;
    return baseVolume * (1 - Number(attenuation.reductionPercent || 0) / 100);
  }

  applyTrackGain(
    graph: AudioGraph,
    track: AudioGraphTrack,
    immediate = false,
    volume: number | null = null,
  ) {
    const baseVolume =
      volume === null
        ? this.getVolume(String(track.entry.userId ?? ""), track.entry.source)
        : volume;
    const target =
      track.active && !this.isDeafened() && !this.isBroadcastMode()
        ? this.attenuatedVolume(track.entry.source, baseVolume)
        : 0;
    const attenuation = this.getAttenuation({}) || {};
    const duration =
      target < track.gain.gain.value
        ? Number(attenuation.attackMs) || 120
        : Number(attenuation.releaseMs) || 650;
    const now = graph.context.currentTime;
    const gainTarget = Math.max(0, Math.min(2, target));
    if (!immediate && track.gainTarget === gainTarget) return;
    track.gainTarget = gainTarget;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.audio.volume = 1;
    if (immediate) {
      track.gain.gain.setValueAtTime(gainTarget, now);
    } else {
      track.gain.gain.linearRampToValueAtTime(
        gainTarget,
        now + duration / 1000,
      );
    }
    if (track.entry.source === "screen-audio")
      this.onEffectiveGain?.({
        active: target < baseVolume,
        baseVolume,
        effectiveVolume: target,
        entry: track.entry,
      });
  }

  applyAttenuation() {
    for (const graph of this.participantAudio.values())
      for (const track of graph.tracks.values())
        this.applyTrackGain(graph, track);
  }

  async ensurePlayback() {
    this.applyAttenuation();
    if (this.isDeafened() || this.isBroadcastMode()) return true;
    const attempts = [...this.participantAudio.values()].map((graph) =>
      this.resumeGraph(graph),
    );
    const results = await Promise.allSettled(attempts);
    return results.every(
      (result) => result.status === "fulfilled" && result.value === true,
    );
  }

  async resumeGraph(graph: AudioGraph): Promise<boolean> {
    if (graph.closed || !graph.tracks.size) return false;
    if (graph.resumePromise) return graph.resumePromise;
    const generation = graph.resumeGeneration;
    const promise = this.performGraphResume(graph, generation);
    const trackedPromise = promise.finally(() => {
      if (graph.resumePromise === trackedPromise) graph.resumePromise = null;
    });
    graph.resumePromise = trackedPromise;
    return trackedPromise;
  }

  isGraphActive(graph: AudioGraph, generation: number) {
    return (
      !graph.closed &&
      graph.resumeGeneration === generation &&
      graph.tracks.size > 0
    );
  }

  async performGraphResume(graph: AudioGraph, generation: number) {
    try {
      if (!this.isGraphActive(graph, generation)) return false;
      await graph.context.resume();
      if (!this.isGraphActive(graph, generation)) return false;
      await Promise.all(
        [...graph.tracks.entries()].map(([key, track]) => {
          if (
            !this.isGraphActive(graph, generation) ||
            graph.tracks.get(key) !== track
          )
            return true;
          const streamTrack =
            track.audio.srcObject instanceof MediaStream
              ? track.audio.srcObject.getAudioTracks()[0]
              : undefined;
          if (streamTrack !== track.entry.track && track.entry.track)
            track.audio.srcObject = new MediaStream([track.entry.track]);
          return Promise.resolve()
            .then(() => track.audio.play())
            .catch((error) => {
              if (
                !this.isGraphActive(graph, generation) ||
                graph.tracks.get(key) !== track
              )
                return true;
              throw error;
            });
        }),
      );
      if (!this.isGraphActive(graph, generation)) return false;
      graph.resumeAttempt = 0;
      if (graph.resumeTimer) clearTimeout(graph.resumeTimer);
      graph.resumeTimer = null;
      this.publishPlaybackState(graph.userId, "ready");
      return true;
    } catch (error) {
      if (!this.isGraphActive(graph, generation)) return false;
      this.publishPlaybackState(graph.userId, "blocked", error);
      this.scheduleGraphResume(graph);
      return false;
    }
  }

  scheduleGraphResume(graph: AudioGraph) {
    if (
      graph.closed ||
      graph.resumeTimer ||
      !graph.tracks.size ||
      this.isDeafened() ||
      this.isBroadcastMode()
    )
      return;
    const delay = Math.min(4000, 250 * 2 ** graph.resumeAttempt);
    graph.resumeAttempt = Math.min(graph.resumeAttempt + 1, 4);
    graph.resumeTimer = setTimeout(() => {
      graph.resumeTimer = null;
      if (graph.closed || !graph.tracks.size) return;
      void this.resumeGraph(graph);
    }, delay);
    graph.resumeTimer?.unref?.();
  }

  async recoverOutputDevice(
    output: AudioContext,
    userId: string | number | null,
    error: unknown,
  ) {
    this.publishPlaybackState(userId, "output-failed", error);
    if (typeof output.setSinkId !== "function") return false;
    try {
      await output.setSinkId("");
      this.publishPlaybackState(userId, "default-output");
      return true;
    } catch (fallbackError) {
      this.publishPlaybackState(userId, "output-blocked", fallbackError);
      return false;
    }
  }

  publishPlaybackState(
    userId: string | number | null,
    state: string,
    error: unknown = null,
  ) {
    try {
      const result = this.onPlaybackState?.({
        userId: userId === null ? null : String(userId),
        state,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : null,
      });
      Promise.resolve(result).catch((callbackError: unknown) => {
        console.warn("[Media] playback-state observer failed", callbackError);
      });
    } catch (callbackError) {
      console.warn("[Media] playback-state observer failed", callbackError);
    }
  }

  disposeAudioTrack(track: AudioGraphTrack) {
    try {
      track.source.disconnect();
    } catch {}
    try {
      track.gain.disconnect();
    } catch {}
    try {
      track.entry.track?.removeEventListener?.("unmute", track.handleUnmute);
    } catch {}
    try {
      track.audio.pause();
    } catch {}
    try {
      track.audio.srcObject = null;
    } catch {}
    try {
      track.audio.remove();
    } catch {}
  }

  removeAudioTrack(entry: RemoteMediaEntry) {
    const graph = this.participantAudio.get(String(entry.userId));
    const track = graph?.tracks.get(entry.key);
    if (!graph || !track) return;
    this.disposeAudioTrack(track);
    graph.tracks.delete(entry.key);
    if (!graph.tracks.size) {
      this.closeGraph(graph);
      this.participantAudio.delete(String(entry.userId));
    }
  }

  closeGraph(graph: AudioGraph) {
    graph.closed = true;
    graph.resumeGeneration += 1;
    if (graph.resumeTimer) clearTimeout(graph.resumeTimer);
    graph.resumeTimer = null;
    graph.resumePromise = null;
    for (const track of graph.tracks.values()) this.disposeAudioTrack(track);
    graph.tracks.clear();
  }

  startVoiceDetection(entry: RemoteMediaEntry & { track: MediaStreamTrack }) {
    this.stopVoiceDetection(entry.key);
    try {
      const graph = this.participantAudio.get(String(entry.userId));
      const playbackTrack = graph?.tracks.get(entry.key);
      const context = graph?.context || this.audioContext;
      if (!context || !playbackTrack)
        throw new Error("Audio graph is unavailable");
      const detectionSource = context.createMediaStreamSource(
        new MediaStream([entry.track]),
      );
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      detectionSource.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let speaking = false;
      let activeSamples = 0;
      let quietSamples = 0;
      this.voiceDetectors.set(entry.key, {
        analyser,
        key: entry.key,
        source: detectionSource,
        samples,
        speaking,
        activeSamples,
        quietSamples,
        userId: entry.userId,
      });
      this.startVoiceDetectionScheduler();
    } catch (error) {
      this.publishPlaybackState(
        entry.userId ?? null,
        "analysis-unavailable",
        error,
      );
      this.notifySpeaking(entry.userId ?? null, false);
    }
  }

  notifySpeaking(
    userId: string | number | null | undefined,
    speaking: boolean,
  ) {
    try {
      const result = this.onSpeaking?.(String(userId ?? ""), speaking);
      Promise.resolve(result).catch((error: unknown) => {
        console.warn("[Media] speaking observer failed", error);
      });
    } catch (error) {
      console.warn("[Media] speaking observer failed", error);
    }
  }

  startVoiceDetectionScheduler() {
    if (this.voiceDetectionTimer) return;
    const sample = () => {
      this.voiceDetectionTimer = null;
      for (const detector of this.voiceDetectors.values()) {
        if (detector.analysisFailed) continue;
        try {
          const playbackTrack = this.participantAudio
            .get(String(detector.userId))
            ?.tracks.get(detector.key);
          if (!playbackTrack?.active || playbackTrack.entry.receiving === false)
            continue;
          detector.analyser.getByteTimeDomainData(
            detector.samples as unknown as Uint8Array<ArrayBuffer>,
          );
          const levelDb = byteTimeDomainLevelDb(
            detector.samples as unknown as Uint8Array<ArrayBuffer>,
          );
          const sensitivity =
            this.getAttenuation({})?.sensitivity || "standard";
          const thresholdOffset =
            sensitivity === "relaxed"
              ? 5
              : sensitivity === "responsive"
                ? -3
                : 0;
          const requiredSamples =
            sensitivity === "relaxed"
              ? 5
              : sensitivity === "responsive"
                ? 1
                : 2;
          if (levelDb >= REMOTE_VOICE_ACTIVITY_THRESHOLD_DB + thresholdOffset) {
            detector.quietSamples = 0;
            detector.activeSamples += 1;
            if (
              !detector.speaking &&
              detector.activeSamples >= requiredSamples
            ) {
              detector.speaking = true;
              this.speakingUsers.add(String(detector.userId));
              this.notifySpeaking(detector.userId, true);
              this.applyAttenuation();
            }
          } else if (detector.speaking && ++detector.quietSamples >= 6) {
            detector.activeSamples = 0;
            detector.speaking = false;
            this.speakingUsers.delete(String(detector.userId));
            this.notifySpeaking(detector.userId, false);
            this.applyAttenuation();
          } else {
            detector.activeSamples = 0;
          }
        } catch (error) {
          detector.analysisFailed = true;
          detector.activeSamples = 0;
          detector.quietSamples = 0;
          detector.speaking = false;
          this.speakingUsers.delete(String(detector.userId));
          this.publishPlaybackState(
            detector.userId ?? null,
            "analysis-unavailable",
            error,
          );
          this.notifySpeaking(detector.userId ?? null, false);
        }
      }
      if (this.voiceDetectors.size)
        this.voiceDetectionTimer = setTimeout(
          sample,
          document.hidden
            ? HIDDEN_VOICE_DETECTION_INTERVAL_MS
            : VISIBLE_VOICE_DETECTION_INTERVAL_MS,
        );
    };
    this.voiceDetectionTimer = setTimeout(sample, 0);
  }

  stopVoiceDetectionScheduler() {
    if (this.voiceDetectionTimer) clearTimeout(this.voiceDetectionTimer);
    this.voiceDetectionTimer = null;
  }

  stopVoiceDetection(key: string) {
    const detector = this.voiceDetectors.get(key);
    if (!detector) return;
    try {
      detector.source.disconnect();
    } catch {}
    try {
      detector.analyser.disconnect();
    } catch {}
    this.notifySpeaking(detector.userId, false);
    this.speakingUsers.delete(String(detector.userId));
    this.applyAttenuation();
    this.voiceDetectors.delete(key);
    if (!this.voiceDetectors.size) this.stopVoiceDetectionScheduler();
  }

  receiverIsCurrent(
    key: string,
    expectedReceiverIncarnation: string | RemoteSourceIncarnation,
  ) {
    const state = this.remoteSourceConvergence.get(key);
    if (!state) return false;
    const expected =
      typeof expectedReceiverIncarnation === "string"
        ? expectedReceiverIncarnation
        : expectedReceiverIncarnation.receiverIncarnationId;
    return state.incarnation.receiverIncarnationId === expected;
  }

  applyRtpEvidence(
    key: string,
    expectedReceiverIncarnation: string | RemoteSourceIncarnation,
    stats: RemoteReceiverStats,
    audio: boolean,
  ) {
    if (!this.receiverIsCurrent(key, expectedReceiverIncarnation)) return false;
    const state = this.remoteSourceConvergence.get(key);
    if (!state) return false;
    const progression = audio
      ? checkAudioRtpProgression(state, stats)
      : checkRtpProgression(state, stats);
    if (progression && state.stallState.detected) clearStall(state);
    promoteConvergence(state);
    this.evaluateReceiverHealth(key, expectedReceiverIncarnation);
    return progression || state.rtpEvidence.lastRtpSampleAt !== null;
  }

  evaluateReceiverHealth(
    key: string,
    expectedReceiverIncarnation: string | RemoteSourceIncarnation,
  ) {
    if (!this.receiverIsCurrent(key, expectedReceiverIncarnation)) return false;
    const state = this.remoteSourceConvergence.get(key);
    if (!state) return false;
    if (detectStall(state, DEFAULT_REMOTE_SOURCE_FSM_CONFIG)) {
      this.scheduleReceiverRecovery(key, state);
      return true;
    }
    return false;
  }

  updateRtpStats(
    key: string,
    expectedReceiverIncarnation: string | RemoteSourceIncarnation,
    stats: RemoteReceiverStats,
  ) {
    return this.applyRtpEvidence(
      key,
      expectedReceiverIncarnation,
      stats,
      false,
    );
  }

  updateAudioRtpStats(
    key: string,
    expectedReceiverIncarnation: string | RemoteSourceIncarnation,
    stats: RemoteReceiverStats,
  ) {
    return this.applyRtpEvidence(key, expectedReceiverIncarnation, stats, true);
  }

  scheduleReceiverRecovery(key: string, state: RemoteSourceConvergenceState) {
    const entry =
      this.videoFeeds.value.get(key) || this.audioFeeds.value.get(key) || null;
    if (!entry) return false;
    return scheduleRecovery(
      state,
      DEFAULT_REMOTE_SOURCE_FSM_CONFIG,
      () =>
        void this.runReceiverRecovery(
          key,
          state.incarnation.receiverIncarnationId,
        ),
    );
  }

  async runReceiverRecovery(key: string, expectedReceiverIncarnation: string) {
    if (!this.receiverIsCurrent(key, expectedReceiverIncarnation)) return;
    const state = this.remoteSourceConvergence.get(key);
    const entry =
      this.videoFeeds.value.get(key) || this.audioFeeds.value.get(key) || null;
    if (
      !state ||
      !entry ||
      !this.receiverIsCurrent(key, expectedReceiverIncarnation)
    )
      return;
    const attempt = state.stallState.recoveryAttempt;
    let recovered = false;
    try {
      recovered =
        (await this.onReceiverRecovery?.(
          entry,
          attempt,
          state.abortController.signal,
        )) === true;
    } catch {
      recovered = false;
    }
    if (!this.receiverIsCurrent(key, expectedReceiverIncarnation)) return;
    if (
      !state.stallState.detected ||
      !["stalled", "recovering"].includes(state.phase)
    )
      return;
    if (recovered) {
      clearStall(state);
      return;
    }
    if (attempt >= DEFAULT_REMOTE_SOURCE_FSM_CONFIG.maxRecoveryAttempts) {
      state.failed = true;
      state.phase = "failed";
      this.onReceiverFailed?.(entry);
      return;
    }
    this.scheduleReceiverRecovery(key, state);
  }

  startReceiverHealthSampling() {
    if (!this.getReceiverStats) return;
    if (this.receiverHealthRunning) {
      this.receiverHealthRestartRequested = true;
      return;
    }
    if (this.receiverHealthTimer) return;
    this.receiverHealthRestartRequested = false;
    const generation = this.receiverHealthGeneration;
    const sample = async () => {
      this.receiverHealthTimer = null;
      if (
        this.receiverHealthRunning ||
        generation !== this.receiverHealthGeneration
      )
        return;
      this.receiverHealthRunning = true;
      const entries = new Map<string, RemoteMediaEntry>();
      for (const entry of this.audioFeeds.value.values())
        entries.set(entry.key, entry);
      for (const entry of this.videoFeeds.value.values())
        entries.set(entry.key, entry);
      const activeEntries = [...entries.values()].filter((entry) => {
        const state = this.remoteSourceConvergence.get(entry.key);
        return (
          state &&
          !state.retired &&
          !state.failed &&
          !state.intentionalReceivingDisabled &&
          entry.receiving !== false
        );
      });
      if (!activeEntries.length) {
        this.receiverHealthRunning = false;
        if (
          generation !== this.receiverHealthGeneration &&
          this.receiverHealthRestartRequested
        ) {
          this.receiverHealthRestartRequested = false;
          this.startReceiverHealthSampling();
        }
        return;
      }
      await Promise.all(
        activeEntries.map(async (entry) => {
          const state = this.remoteSourceConvergence.get(entry.key);
          if (!state) return;
          const expected = state.incarnation.receiverIncarnationId;
          let stats: RemoteReceiverStats | null = null;
          try {
            stats = (await this.getReceiverStats?.(entry)) || null;
          } catch {
            stats = null;
          }
          if (stats && this.receiverIsCurrent(entry.key, expected))
            this.applyRtpEvidence(
              entry.key,
              expected,
              stats,
              state.kind === "audio",
            );
          else this.evaluateReceiverHealth(entry.key, expected);
        }),
      );
      this.receiverHealthRunning = false;
      if (generation !== this.receiverHealthGeneration) {
        if (this.receiverHealthRestartRequested) {
          this.receiverHealthRestartRequested = false;
          this.startReceiverHealthSampling();
        }
        return;
      }
      const hasEntries =
        this.audioFeeds.value.size > 0 || this.videoFeeds.value.size > 0;
      if (hasEntries && this.getReceiverStats) {
        this.receiverHealthTimer = setTimeout(
          sample,
          DEFAULT_REMOTE_SOURCE_FSM_CONFIG.statsSampleIntervalMs,
        );
        this.receiverHealthTimer.unref?.();
      }
    };
    void sample();
  }

  stopReceiverHealthSampling() {
    this.receiverHealthGeneration += 1;
    this.receiverHealthRestartRequested = false;
    if (this.receiverHealthTimer) clearTimeout(this.receiverHealthTimer);
    this.receiverHealthTimer = null;
  }

  isSourceRenderable(key: string): boolean {
    const convergenceState = this.remoteSourceConvergence.get(key);
    return convergenceState?.phase === "renderable";
  }

  getConvergenceState(key: string): RemoteSourceConvergenceState | undefined {
    return this.remoteSourceConvergence.get(key);
  }

  clearStallForKey(key: string) {
    const convergenceState = this.remoteSourceConvergence.get(key);
    if (convergenceState) clearStall(convergenceState);
  }

  scheduleRecoveryForKey(
    key: string,
    expectedReceiverIncarnation: string,
    onRecovery: () => void,
  ) {
    const convergenceState = this.remoteSourceConvergence.get(key);
    if (
      !convergenceState ||
      !this.receiverIsCurrent(key, expectedReceiverIncarnation)
    )
      return false;
    return scheduleRecovery(
      convergenceState,
      DEFAULT_REMOTE_SOURCE_FSM_CONFIG,
      onRecovery,
    );
  }
}
