export function createLocalAudioEngine({
  authStore,
  automaticGateThreshold,
  capture,
  collectOutboundAudioStats,
  createNoiseFloorEstimator,
  getActiveProvider,
  getAudioStereo,
  getEffectiveAudioBitrate,
  getP2pMesh,
  getRequestedVideoSettings,
  getSfu,
  localSources,
  microphoneLevelDb,
  onSpeakingChange,
  settingsStore,
  sharedAudioStats,
  updateNoiseFloor,
  voiceStore,
}) {
  let localVoiceDetector = null;
  let sharedAudioMeter = null;
  let sharedAudioStatsSample = null;

  function producerFacade(entry) {
    return {
      id: `${getActiveProvider() || "local"}:${entry.source}:${entry.track.id}`,
      track: entry.track,
      closed: entry.track.readyState !== "live",
      on() {},
      close: () => capture.stop(entry.source),
    };
  }

  function startLocalVoiceDetection(entry) {
    stopLocalVoiceDetection();
    const userId = authStore.getUserData()?.id;
    if (!userId) return;
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
      const samples = new Float32Array(analyser.fftSize);
      let speaking = false;
      let quietSamples = 0;
      const noiseFloorEstimator = createNoiseFloorEstimator();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const levelDb = microphoneLevelDb(samples);
        const gate = settingsStore.microphoneGate;
        const thresholdDb = gate.automatic
          ? automaticGateThreshold(noiseFloorEstimator.noiseFloorDb)
          : gate.thresholdDb;
        const active = levelDb >= thresholdDb;
        updateNoiseFloor(noiseFloorEstimator, levelDb, active);
        if (active) {
          quietSamples = 0;
          if (!speaking) {
            speaking = true;
            voiceStore.updateUserSpeaking(userId, true);
            onSpeakingChange?.(userId, true);
          }
        } else if (speaking && ++quietSamples >= 10) {
          speaking = false;
          voiceStore.updateUserSpeaking(userId, false);
          onSpeakingChange?.(userId, false);
        }
      }, 40);
      localVoiceDetector = { analyser, context, source, timer, userId };
      context
        .resume()
        .catch((error) =>
          console.warn("[Media] Local audio context resume failed", error),
        );
    } catch (error) {
      voiceStore.updateUserSpeaking(userId, false);
      onSpeakingChange?.(userId, false);
      console.warn(
        `[Media] Local voice detection is unavailable: ${error?.message || error}`,
      );
    }
  }

  function stopLocalVoiceDetection() {
    if (!localVoiceDetector) return;
    clearInterval(localVoiceDetector.timer);
    localVoiceDetector.source.disconnect();
    localVoiceDetector.analyser.disconnect();
    localVoiceDetector.context
      .close()
      .catch((error) =>
        console.warn("[Media] Local audio context close failed", error),
      );
    voiceStore.updateUserSpeaking(localVoiceDetector.userId, false);
    onSpeakingChange?.(localVoiceDetector.userId, false);
    localVoiceDetector = null;
  }

  function setSharedAudioVolume(value) {
    const normalized = Math.max(0, Math.min(100, Number(value))) / 100;
    if (sharedAudioMeter?.gain) {
      const now = sharedAudioMeter.context.currentTime;
      sharedAudioMeter.gain.gain.cancelScheduledValues(now);
      sharedAudioMeter.gain.gain.setValueAtTime(normalized, now);
      ensureSharedAudioProcessing().catch((error) =>
        console.warn("[Media] Shared audio context resume failed", error),
      );
    }
    const enabled = normalized > 0;
    Promise.allSettled(
      [
        getP2pMesh()?.setSourceTransmission("screen-audio", enabled),
        getSfu()?.setSourceTransmission("screen-audio", enabled),
      ].filter(Boolean),
    ).then((results) => {
      for (const result of results)
        if (result.status === "rejected")
          console.warn(
            "[Media] Shared audio transmission update failed",
            result.reason,
          );
    });
  }

  function setSystemAudioBitrate(value) {
    settingsStore.systemAudioBitrate = Number(value);
    return refreshAudioSenderSettings();
  }

  function refreshAudioSenderSettings() {
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    const sources = [...localSources.values()]
      .filter((entry) => entry.track.kind === "audio")
      .map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) =>
        [
          p2pMesh?.reconfigureSource(source),
          sfu?.updateAudioBitrate(source, getEffectiveAudioBitrate(source)),
        ].filter(Boolean),
      ),
    );
  }

  function refreshMediaPolicy() {
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    const sources = [...localSources.values()].map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) => {
        const entry = localSources.get(source);
        if (entry?.track.kind === "audio")
          return [
            p2pMesh?.reconfigureSource(source),
            sfu?.updateAudioBitrate(source, getEffectiveAudioBitrate(source)),
          ].filter(Boolean);
        return [
          p2pMesh?.reconfigureSource(source),
          sfu?.updateVideoBitrate(
            source,
            getRequestedVideoSettings(source).maxBitrate,
          ),
        ].filter(Boolean);
      }),
    );
  }

  async function createSharedAudioSource(entry) {
    try {
      const AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(
        new MediaStream([entry.track]),
      );
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      const destination = context.createMediaStreamDestination();
      analyser.fftSize = 512;
      gain.gain.value =
        Math.max(0, Math.min(100, Number(settingsStore.sharedAudioVolume))) /
        100;
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(destination);
      const track = destination.stream.getAudioTracks()[0];
      sharedAudioMeter = {
        context,
        source,
        gain,
        analyser,
        destination,
        timer: null,
        track,
      };
      setSharedAudioVolume(settingsStore.sharedAudioVolume);
      const ready = await ensureSharedAudioProcessing();
      if (!ready)
        throw new Error("Shared audio processing could not be started");
      return {
        ...entry,
        stream: new MediaStream([track]),
        track,
        captureTrack: entry.track,
      };
    } catch (error) {
      stopSharedAudioMeter();
      console.warn(
        `[Media] Shared audio processing is unavailable: ${error?.message || error}`,
      );
      return entry;
    }
  }

  async function ensureSharedAudioProcessing() {
    if (!sharedAudioMeter) return false;
    if (sharedAudioMeter.context.state !== "running")
      await sharedAudioMeter.context.resume();
    return sharedAudioMeter.context.state === "running";
  }

  function startSharedAudioMeter() {
    if (!sharedAudioMeter) return;
    const values = new Float32Array(sharedAudioMeter.analyser.fftSize);
    const sample = async () => {
      if (!sharedAudioMeter) return;
      await ensureSharedAudioProcessing();
      sharedAudioMeter.analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length,
      );
      const dbfs = rms > 0 ? 20 * Math.log10(rms) : -60;
      const sfu = getSfu();
      const p2pMesh = getP2pMesh();
      const producer = sfu?.producers.get("screen-audio")?.producer;
      const report =
        getActiveProvider() === "sfu" && producer
          ? await producer.getStats().catch(() => null)
          : p2pMesh
            ? await p2pMesh
                .getOutboundTrackStats("screen-audio")
                .catch(() => null)
            : null;
      const collected = collectOutboundAudioStats(
        report,
        sharedAudioStatsSample,
      );
      if (collected.sample) sharedAudioStatsSample = collected.sample;
      sharedAudioStats.value = {
        kbps: collected.stats?.bitrateKbps ?? 0,
        level: Math.max(0, Math.min(1, collected.stats?.audioLevel ?? rms * 4)),
        dbfs: Math.max(-60, dbfs),
      };
    };
    sample().catch((error) =>
      console.warn("[Media] Shared audio statistics failed", error),
    );
    sharedAudioMeter.timer = setInterval(
      () =>
        sample().catch((error) =>
          console.warn("[Media] Shared audio statistics failed", error),
        ),
      500,
    );
  }

  function stopSharedAudioMeter() {
    if (!sharedAudioMeter) return;
    clearInterval(sharedAudioMeter.timer);
    sharedAudioMeter.source.disconnect();
    sharedAudioMeter.gain.disconnect();
    sharedAudioMeter.analyser.disconnect();
    sharedAudioMeter.track.stop();
    sharedAudioMeter.context
      .close()
      .catch((error) =>
        console.warn("[Media] Shared audio context close failed", error),
      );
    sharedAudioMeter = null;
    sharedAudioStatsSample = null;
    sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 };
  }

  return {
    createSharedAudioSource,
    producerFacade,
    refreshAudioSenderSettings,
    refreshMediaPolicy,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
  };
}
