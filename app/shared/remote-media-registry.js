import { byteTimeDomainLevelDb } from "./microphone-gate.js";
import { triggerRef } from "vue";

const REMOTE_VOICE_ACTIVITY_THRESHOLD_DB = -42;
const VISIBLE_VOICE_DETECTION_INTERVAL_MS = 120;
const HIDDEN_VOICE_DETECTION_INTERVAL_MS = 300;

export function replaceMediaStreamTrack(stream, track) {
  if (!stream.getTracks().includes(track)) stream.addTrack(track);
  for (const currentTrack of stream.getTracks()) {
    if (currentTrack !== track) stream.removeTrack(currentTrack);
  }
  return stream;
}

export class RemoteMediaRegistry {
  constructor({
    audioFeeds,
    videoFeeds,
    getVolume,
    getOutputDevice,
    isDeafened,
    isBroadcastMode,
    isAnyoneSpeaking,
    onSpeaking,
    getAttenuation,
    onVideoReceivingChange,
    onPlaybackState,
    onEffectiveGain,
  }) {
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
    this.voiceDetectors = new Map();
    this.speakingUsers = new Set();
    this.participantAudio = new Map();
    this.receivingPreferences = new Map();
    this.audioContext = null;
    this.voiceDetectionTimer = null;
    this.externalSpeakingUsers = new Set();
  }

  bind(entry, { staged = false } = {}) {
    if (entry.track.kind === "video") {
      const current = this.videoFeeds.value.get(entry.key);
      const stream =
        current?.stream || entry.stream || new MediaStream([entry.track]);
      if (current?.stream) replaceMediaStreamTrack(stream, entry.track);
      const receiving =
        entry.source === "screen"
          ? (this.receivingPreferences.get(entry.key) ??
            current?.receiving ??
            false)
          : typeof document === "undefined" || !document.hidden;
      entry.track.enabled = receiving;
      this.videoFeeds.value.set(entry.key, { ...entry, stream, receiving });
      triggerRef(this.videoFeeds);
      if (entry.source === "screen")
        this.onVideoReceivingChange?.(entry, receiving);
      return;
    }
    this.remove(entry.key);
    const receiving = entry.receiving !== false;
    entry.track.enabled = receiving;
    this.audioFeeds.value.set(entry.key, { ...entry, receiving });
    triggerRef(this.audioFeeds);
    this.createAudioElement({ ...entry, receiving }, staged);
    if (entry.source === "audio") this.startVoiceDetection(entry);
  }

  setVideoReceiving(key, receiving, persistPreference = true) {
    const entry = this.videoFeeds.value.get(key);
    if (!entry) return false;
    entry.track.enabled = Boolean(receiving);
    if (entry.source === "screen" && persistPreference)
      this.receivingPreferences.set(key, Boolean(receiving));
    this.videoFeeds.value.set(key, {
      ...entry,
      receiving: Boolean(receiving),
    });
    triggerRef(this.videoFeeds);
    this.onVideoReceivingChange?.(entry, Boolean(receiving));
    return true;
  }

  setDocumentHidden(hidden) {
    for (const [key, entry] of this.videoFeeds.value) {
      if (entry.source === "screen") {
        const receiving = hidden
          ? false
          : (this.receivingPreferences.get(key) ?? entry.receiving);
        this.setVideoReceiving(key, receiving, false);
        continue;
      }
      this.setVideoReceiving(key, !hidden);
    }
  }

  setAudioReceiving(key, receiving) {
    const entry = this.audioFeeds.value.get(key);
    if (!entry || entry.source !== "screen-audio") return false;
    entry.receiving = Boolean(receiving);
    entry.track.enabled = Boolean(receiving);
    this.audioFeeds.value.set(key, { ...entry });
    triggerRef(this.audioFeeds);
    this.onVideoReceivingChange?.(entry, Boolean(receiving));
    return true;
  }

  clearReceivingPreference(key) {
    this.receivingPreferences.delete(key);
  }

  activateProvider(provider) {
    for (const graph of this.participantAudio.values()) {
      for (const track of graph.tracks.values()) {
        track.active = track.entry.provider === provider;
        this.applyTrackGain(graph, track);
      }
      if (!this.isDeafened() && !this.isBroadcastMode())
        this.resumeGraph(graph);
    }
  }

  setExternalSpeaking(userId, speaking) {
    const normalizedUserId = String(userId);
    if (speaking) this.externalSpeakingUsers.add(normalizedUserId);
    else this.externalSpeakingUsers.delete(normalizedUserId);
    this.applyAttenuation();
  }

  remove(key, owner = null) {
    const audio = this.audioFeeds.value.get(key);
    const video = this.videoFeeds.value.get(key);
    if (!audio && !video) return;
    const current = video || audio;
    if (owner?.provider && current.provider !== owner.provider) return;
    if (owner?.track && current.track !== owner.track) return;
    this.audioFeeds.value.delete(key);
    this.videoFeeds.value.delete(key);
    triggerRef(this.audioFeeds);
    triggerRef(this.videoFeeds);
    if (audio) this.removeAudioTrack(audio);
    this.stopVoiceDetection(key);
  }

  clearProvider(provider) {
    const keys = new Set();
    for (const [key, entry] of this.audioFeeds.value)
      if (entry.provider === provider) keys.add(key);
    for (const [key, entry] of this.videoFeeds.value)
      if (entry.provider === provider) keys.add(key);
    for (const key of keys) this.remove(key);
  }

  clear() {
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
    this.audioContext
      ?.close()
      .catch((error) =>
        this.publishPlaybackState(null, "context-close-failed", error),
      );
    this.audioContext = null;
  }

  createAudioElement(entry, staged) {
    const graph = this.getOrCreateGraph(entry.userId);
    const audio = document.createElement("audio");
    audio.id = `audio-${entry.key}`;
    audio.dataset.userId = String(entry.userId);
    audio.autoplay = true;
    audio.controls = false;
    audio.playsInline = true;
    audio.srcObject = new MediaStream([entry.track]);
    this.audioContainer().appendChild(audio);
    const source = this.audioContext.createMediaElementSource(audio);
    const gain = this.audioContext.createGain();
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

  getOrCreateGraph(userId) {
    const normalizedUserId = String(userId);
    const existing = this.participantAudio.get(normalizedUserId);
    if (existing) return existing;
    const context = this.getAudioContext();
    const graph = {
      context,
      tracks: new Map(),
      userId: normalizedUserId,
      resumeAttempt: 0,
      resumePromise: null,
      resumeTimer: null,
    };
    this.participantAudio.set(normalizedUserId, graph);
    return graph;
  }

  getAudioContext() {
    if (this.audioContext) return this.audioContext;
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
    this.audioContext = new AudioContextConstructor();
    const sinkId = this.getOutputDevice();
    if (sinkId && typeof this.audioContext.setSinkId === "function")
      this.audioContext
        .setSinkId(sinkId)
        .catch((error) =>
          this.recoverOutputDevice(this.audioContext, null, error),
        );
    return this.audioContext;
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

  applyVolume(userId, source, volume) {
    const graph = this.participantAudio.get(String(userId));
    if (!graph) return;
    for (const track of graph.tracks.values())
      if (!source || track.entry.source === source)
        this.applyTrackGain(graph, track, false, volume);
  }

  attenuatedVolume(source, baseVolume) {
    if (
      !this.speakingUsers.size &&
      !this.externalSpeakingUsers.size &&
      !this.isAnyoneSpeaking?.()
    )
      return baseVolume;
    if (!["screen-audio", "system-audio"].includes(source)) return baseVolume;
    const attenuation = this.getAttenuation?.() || { enabled: false };
    if (!attenuation.enabled) return baseVolume;
    return baseVolume * (1 - attenuation.reductionPercent / 100);
  }

  applyTrackGain(graph, track, immediate = false, volume = null) {
    const baseVolume =
      volume === null
        ? this.getVolume(track.entry.userId, track.entry.source)
        : volume;
    const target =
      track.active && !this.isDeafened() && !this.isBroadcastMode()
        ? this.attenuatedVolume(track.entry.source, baseVolume)
        : 0;
    const attenuation = this.getAttenuation?.() || {};
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

  async resumeGraph(graph) {
    if (graph.resumePromise) return graph.resumePromise;
    graph.resumePromise = this.performGraphResume(graph).finally(() => {
      graph.resumePromise = null;
    });
    return graph.resumePromise;
  }

  async performGraphResume(graph) {
    try {
      await this.audioContext.resume();
      await Promise.all(
        [...graph.tracks.values()].map((track) => {
          const streamTrack = track.audio.srcObject?.getAudioTracks?.()[0];
          if (streamTrack !== track.entry.track)
            track.audio.srcObject = new MediaStream([track.entry.track]);
          return track.audio.play();
        }),
      );
      graph.resumeAttempt = 0;
      clearTimeout(graph.resumeTimer);
      graph.resumeTimer = null;
      this.publishPlaybackState(graph.userId, "ready");
      return true;
    } catch (error) {
      this.publishPlaybackState(graph.userId, "blocked", error);
      this.scheduleGraphResume(graph);
      return false;
    }
  }

  scheduleGraphResume(graph) {
    if (
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
      if (!graph.tracks.size) return;
      this.resumeGraph(graph);
    }, delay);
    graph.resumeTimer?.unref?.();
  }

  async recoverOutputDevice(output, userId, error) {
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

  publishPlaybackState(userId, state, error = null) {
    this.onPlaybackState?.({
      userId: userId === null ? null : String(userId),
      state,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : null,
    });
  }

  removeAudioTrack(entry) {
    const graph = this.participantAudio.get(String(entry.userId));
    const track = graph?.tracks.get(entry.key);
    if (!graph || !track) return;
    track.source.disconnect();
    track.gain.disconnect();
    track.entry.track.removeEventListener?.("unmute", track.handleUnmute);
    track.audio.pause();
    track.audio.srcObject = null;
    track.audio.remove();
    graph.tracks.delete(entry.key);
    if (!graph.tracks.size) {
      this.closeGraph(graph);
      this.participantAudio.delete(String(entry.userId));
    }
  }

  closeGraph(graph) {
    clearTimeout(graph.resumeTimer);
    graph.resumeTimer = null;
    graph.resumePromise = null;
    for (const track of graph.tracks.values()) {
      track.source.disconnect();
      track.gain.disconnect();
      track.entry.track.removeEventListener?.("unmute", track.handleUnmute);
      track.audio.pause();
      track.audio.srcObject = null;
      track.audio.remove();
    }
    graph.tracks.clear();
  }

  startVoiceDetection(entry) {
    this.stopVoiceDetection(entry.key);
    try {
      const graph = this.participantAudio.get(String(entry.userId));
      const playbackTrack = graph?.tracks.get(entry.key);
      if (!graph || !playbackTrack)
        throw new Error("Audio graph is unavailable");
      const detectionSource = this.audioContext.createMediaStreamSource(
        new MediaStream([entry.track]),
      );
      const analyser = this.audioContext.createAnalyser();
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
      this.publishPlaybackState(entry.userId, "analysis-unavailable", error);
      this.onSpeaking(entry.userId, false);
    }
  }

  startVoiceDetectionScheduler() {
    if (this.voiceDetectionTimer) return;
    const sample = () => {
      this.voiceDetectionTimer = null;
      for (const detector of this.voiceDetectors.values()) {
        const playbackTrack = this.participantAudio
          .get(String(detector.userId))
          ?.tracks.get(detector.key);
        if (!playbackTrack?.active || playbackTrack.entry.receiving === false)
          continue;
        detector.analyser.getByteTimeDomainData(detector.samples);
        const levelDb = byteTimeDomainLevelDb(detector.samples);
        const sensitivity = this.getAttenuation?.()?.sensitivity || "standard";
        const thresholdOffset =
          sensitivity === "relaxed" ? 5 : sensitivity === "responsive" ? -3 : 0;
        const requiredSamples =
          sensitivity === "relaxed" ? 5 : sensitivity === "responsive" ? 1 : 2;
        if (levelDb >= REMOTE_VOICE_ACTIVITY_THRESHOLD_DB + thresholdOffset) {
          detector.quietSamples = 0;
          detector.activeSamples += 1;
          if (!detector.speaking && detector.activeSamples >= requiredSamples) {
            detector.speaking = true;
            this.speakingUsers.add(String(detector.userId));
            this.onSpeaking(detector.userId, true);
            this.applyAttenuation();
          }
        } else if (detector.speaking && ++detector.quietSamples >= 6) {
          detector.activeSamples = 0;
          detector.speaking = false;
          this.speakingUsers.delete(String(detector.userId));
          this.onSpeaking(detector.userId, false);
          this.applyAttenuation();
        } else {
          detector.activeSamples = 0;
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
    clearTimeout(this.voiceDetectionTimer);
    this.voiceDetectionTimer = null;
  }

  stopVoiceDetection(key) {
    const detector = this.voiceDetectors.get(key);
    if (!detector) return;
    detector.source.disconnect();
    detector.analyser.disconnect();
    this.onSpeaking(detector.userId, false);
    this.speakingUsers.delete(String(detector.userId));
    this.applyAttenuation();
    this.voiceDetectors.delete(key);
    if (!this.voiceDetectors.size) this.stopVoiceDetectionScheduler();
  }
}
