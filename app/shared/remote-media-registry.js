import { byteTimeDomainLevelDb } from "./microphone-gate.js";

const REMOTE_VOICE_ACTIVITY_THRESHOLD_DB = -48;

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
        entry.source === "screen" ? (current?.receiving ?? false) : true;
      entry.track.enabled = receiving;
      this.videoFeeds.value.set(entry.key, { ...entry, stream, receiving });
      this.videoFeeds.value = new Map(this.videoFeeds.value);
      if (entry.source === "screen")
        this.onVideoReceivingChange?.(entry, receiving);
      return;
    }
    this.remove(entry.key);
    this.audioFeeds.value.set(entry.key, entry);
    this.audioFeeds.value = new Map(this.audioFeeds.value);
    this.createAudioElement(entry, staged);
    if (entry.source === "audio") this.startVoiceDetection(entry);
  }

  setVideoReceiving(key, receiving) {
    const entry = this.videoFeeds.value.get(key);
    if (!entry || entry.source !== "screen") return false;
    entry.track.enabled = Boolean(receiving);
    this.videoFeeds.value.set(key, {
      ...entry,
      receiving: Boolean(receiving),
    });
    this.videoFeeds.value = new Map(this.videoFeeds.value);
    this.onVideoReceivingChange?.(entry, Boolean(receiving));
    return true;
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
    this.audioFeeds.value = new Map(this.audioFeeds.value);
    this.videoFeeds.value = new Map(this.videoFeeds.value);
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
      volumeTimer: null,
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
    const elementTarget = Math.max(0, Math.min(1, target));
    const gainTarget = target > 1 ? target : 1;
    clearInterval(track.volumeTimer);
    track.volumeTimer = null;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    if (immediate) {
      track.audio.volume = elementTarget;
      track.gain.gain.setValueAtTime(gainTarget, now);
    } else {
      const initialVolume = track.audio.volume;
      const startedAt = performance.now();
      const updateVolume = () => {
        const elapsed = performance.now() - startedAt;
        const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
        track.audio.volume =
          initialVolume + (elementTarget - initialVolume) * progress;
        if (progress >= 1) {
          clearInterval(track.volumeTimer);
          track.volumeTimer = null;
        }
      };
      updateVolume();
      if (track.audio.volume !== elementTarget)
        track.volumeTimer = setInterval(updateVolume, 20);
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
    clearInterval(track.volumeTimer);
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
      clearInterval(track.volumeTimer);
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
      let quietSamples = 0;
      this.voiceDetectors.set(entry.key, {
        analyser,
        source: detectionSource,
        samples,
        speaking,
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
    this.voiceDetectionTimer = setInterval(() => {
      for (const detector of this.voiceDetectors.values()) {
        detector.analyser.getByteTimeDomainData(detector.samples);
        const levelDb = byteTimeDomainLevelDb(detector.samples);
        if (levelDb >= REMOTE_VOICE_ACTIVITY_THRESHOLD_DB) {
          detector.quietSamples = 0;
          if (!detector.speaking) {
            detector.speaking = true;
            this.speakingUsers.add(String(detector.userId));
            this.onSpeaking(detector.userId, true);
            this.applyAttenuation();
          }
        } else if (detector.speaking && ++detector.quietSamples >= 6) {
          detector.speaking = false;
          this.speakingUsers.delete(String(detector.userId));
          this.onSpeaking(detector.userId, false);
          this.applyAttenuation();
        }
      }
    }, 80);
  }

  stopVoiceDetectionScheduler() {
    clearInterval(this.voiceDetectionTimer);
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
