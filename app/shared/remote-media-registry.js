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
    this.participantAudio = new Map();
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
      graph.audio.muted = this.isDeafened() || this.isBroadcastMode();
      if (!graph.audio.muted) this.resumeGraph(graph);
    }
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
  }

  createAudioElement(entry, staged) {
    const graph = this.getOrCreateGraph(entry.userId);
    const source = graph.context.createMediaStreamSource(
      new MediaStream([entry.track]),
    );
    const gain = graph.context.createGain();
    const track = { active: !staged, entry, gain, source };
    source.connect(gain);
    gain.connect(graph.destination);
    graph.tracks.set(entry.key, track);
    this.applyTrackGain(graph, track, true);
    graph.audio.muted = this.isDeafened() || this.isBroadcastMode();
    if (!graph.audio.muted && !staged) this.resumeGraph(graph);
  }

  getOrCreateGraph(userId) {
    const normalizedUserId = String(userId);
    const existing = this.participantAudio.get(normalizedUserId);
    if (existing) return existing;
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
    const context = new AudioContextConstructor();
    const destination = context.createMediaStreamDestination();
    const audio = document.createElement("audio");
    audio.id = `audio-user-${normalizedUserId}`;
    audio.dataset.userId = normalizedUserId;
    audio.autoplay = true;
    audio.controls = false;
    audio.playsInline = true;
    audio.srcObject = destination.stream;
    audio.volume = 1;
    const sinkId = this.getOutputDevice();
    if (sinkId && typeof audio.setSinkId === "function")
      audio.setSinkId(sinkId).catch(() => {});
    this.audioContainer().appendChild(audio);
    const graph = {
      audio,
      context,
      destination,
      tracks: new Map(),
      userId: normalizedUserId,
    };
    this.participantAudio.set(normalizedUserId, graph);
    return graph;
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
    const graph = this.participantAudio.get(String(userId));
    if (!graph) return;
    for (const track of graph.tracks.values())
      if (!source || track.entry.source === source)
        this.applyTrackGain(graph, track, false, volume);
  }

  attenuatedVolume(source, baseVolume) {
    if (!this.speakingUsers.size) return baseVolume;
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
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    if (immediate) track.gain.gain.setValueAtTime(target, now);
    else track.gain.gain.linearRampToValueAtTime(target, now + duration / 1000);
  }

  applyAttenuation() {
    for (const graph of this.participantAudio.values())
      for (const track of graph.tracks.values())
        this.applyTrackGain(graph, track);
  }

  ensurePlayback() {
    for (const graph of this.participantAudio.values())
      if (!graph.audio.muted) this.resumeGraph(graph);
  }

  resumeGraph(graph) {
    graph.context.resume().catch(() => {});
    if (graph.audio.paused) graph.audio.play().catch(() => {});
  }

  removeAudioTrack(entry) {
    const graph = this.participantAudio.get(String(entry.userId));
    const track = graph?.tracks.get(entry.key);
    if (!graph || !track) return;
    track.source.disconnect();
    track.gain.disconnect();
    graph.tracks.delete(entry.key);
    if (!graph.tracks.size) {
      this.closeGraph(graph);
      this.participantAudio.delete(String(entry.userId));
    }
  }

  closeGraph(graph) {
    graph.audio.pause();
    graph.audio.srcObject = null;
    graph.audio.remove();
    graph.destination.disconnect();
    graph.context.close().catch(() => {});
  }

  startVoiceDetection(entry) {
    this.stopVoiceDetection(entry.key);
    try {
      const graph = this.participantAudio.get(String(entry.userId));
      const playbackTrack = graph?.tracks.get(entry.key);
      if (!graph || !playbackTrack)
        throw new Error("Audio graph is unavailable");
      const analyser = graph.context.createAnalyser();
      analyser.fftSize = 256;
      playbackTrack.source.connect(analyser);
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
    detector.analyser.disconnect();
    this.onSpeaking(detector.userId, false);
    this.speakingUsers.delete(String(detector.userId));
    this.applyAttenuation();
    this.voiceDetectors.delete(key);
  }
}
