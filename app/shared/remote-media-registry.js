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
    onSpeaking,
    getAttenuation,
    onVideoReceivingChange,
  }) {
    this.audioFeeds = audioFeeds;
    this.videoFeeds = videoFeeds;
    this.getVolume = getVolume;
    this.getOutputDevice = getOutputDevice;
    this.isDeafened = isDeafened;
    this.isBroadcastMode = isBroadcastMode;
    this.onSpeaking = onSpeaking;
    this.getAttenuation = getAttenuation;
    this.onVideoReceivingChange = onVideoReceivingChange;
    this.voiceDetectors = new Map();
    this.speakingUsers = new Set();
    this.volumeTimers = new Map();
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
    const container = document.getElementById("webrtc-audio-global");
    if (!container) return;
    container.querySelectorAll("audio").forEach((audio) => {
      const active = audio.dataset.provider === provider;
      audio.muted = !active || this.isDeafened() || this.isBroadcastMode();
      if (!audio.muted) audio.play().catch(() => {});
    });
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
    document.getElementById(`audio-${key}`)?.remove();
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
    for (const timer of this.volumeTimers.values()) clearInterval(timer);
    this.volumeTimers.clear();
    this.speakingUsers.clear();
  }

  createAudioElement(entry, staged) {
    const container = this.audioContainer();
    const audio = document.createElement("audio");
    audio.id = `audio-${entry.key}`;
    audio.dataset.userId = String(entry.userId);
    audio.dataset.source = entry.source;
    audio.dataset.provider = entry.provider;
    audio.dataset.producerId = entry.key;
    audio.autoplay = true;
    audio.controls = false;
    audio.playsInline = true;
    audio.srcObject = entry.stream || new MediaStream([entry.track]);
    audio.volume = this.attenuatedVolume(
      audio,
      this.getVolume(entry.userId, entry.source),
    );
    audio.muted = staged || this.isDeafened() || this.isBroadcastMode();
    const sinkId = this.getOutputDevice();
    if (sinkId && typeof audio.setSinkId === "function")
      audio.setSinkId(sinkId).catch(() => {});
    container.appendChild(audio);
    if (!audio.muted) audio.play().catch(() => {});
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
    if (!sinkId) return Promise.resolve();
    const elements =
      document
        .getElementById("webrtc-audio-global")
        ?.querySelectorAll("audio") || [];
    return Promise.all(
      [...elements].map((audio) =>
        typeof audio.setSinkId === "function"
          ? audio.setSinkId(sinkId).catch(() => {})
          : null,
      ),
    );
  }

  applyVolume(userId, source, volume) {
    const elements =
      document
        .getElementById("webrtc-audio-global")
        ?.querySelectorAll("audio") || [];
    for (const audio of elements) {
      if (
        audio.dataset.userId === String(userId) &&
        (!source || audio.dataset.source === source)
      )
        this.setAudioVolume(audio, this.attenuatedVolume(audio, volume));
    }
  }

  attenuatedVolume(audio, baseVolume) {
    if (!this.speakingUsers.size) return baseVolume;
    if (!["screen-audio", "system-audio"].includes(audio.dataset.source))
      return baseVolume;
    const attenuation = this.getAttenuation?.() || { enabled: false };
    if (!attenuation.enabled) return baseVolume;
    return baseVolume * (1 - attenuation.reductionPercent / 100);
  }

  setAudioVolume(audio, target) {
    const existing = this.volumeTimers.get(audio.id);
    if (existing) clearInterval(existing);
    const attenuation = this.getAttenuation?.() || {};
    const duration =
      target < audio.volume
        ? Number(attenuation.attackMs) || 120
        : Number(attenuation.releaseMs) || 650;
    const start = audio.volume;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      audio.volume = Math.min(
        1,
        Math.max(0, start + (target - start) * progress),
      );
      if (progress >= 1) {
        clearInterval(timer);
        this.volumeTimers.delete(audio.id);
      }
    }, 20);
    this.volumeTimers.set(audio.id, timer);
  }

  applyAttenuation() {
    const elements =
      document
        .getElementById("webrtc-audio-global")
        ?.querySelectorAll("audio") || [];
    for (const audio of elements) {
      const base = this.getVolume(audio.dataset.userId, audio.dataset.source);
      this.setAudioVolume(audio, this.attenuatedVolume(audio, base));
    }
  }

  ensurePlayback() {
    const elements =
      document
        .getElementById("webrtc-audio-global")
        ?.querySelectorAll("audio") || [];
    for (const audio of elements) {
      if (!audio.muted && audio.paused) audio.play().catch(() => {});
    }
  }

  startVoiceDetection(entry) {
    this.stopVoiceDetection(entry.key);
    try {
      const AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(
        new MediaStream([entry.track]),
      );
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let speaking = false;
      let quietSamples = 0;
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const energy = Math.sqrt(
          samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) /
            samples.length,
        );
        if (energy > 10) {
          quietSamples = 0;
          if (!speaking) {
            speaking = true;
            this.speakingUsers.add(String(entry.userId));
            this.onSpeaking(entry.userId, true);
            this.applyAttenuation();
          }
        } else if (speaking && ++quietSamples >= 6) {
          speaking = false;
          this.speakingUsers.delete(String(entry.userId));
          this.onSpeaking(entry.userId, false);
          this.applyAttenuation();
        }
      }, 80);
      this.voiceDetectors.set(entry.key, {
        context,
        source,
        analyser,
        timer,
        userId: entry.userId,
      });
    } catch (_) {
      this.onSpeaking(entry.userId, false);
    }
  }

  stopVoiceDetection(key) {
    const detector = this.voiceDetectors.get(key);
    if (!detector) return;
    clearInterval(detector.timer);
    detector.source.disconnect();
    detector.analyser.disconnect();
    detector.context.close().catch(() => {});
    this.onSpeaking(detector.userId, false);
    this.speakingUsers.delete(String(detector.userId));
    this.applyAttenuation();
    this.voiceDetectors.delete(key);
  }
}
