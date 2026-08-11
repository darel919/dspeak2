import { createEchoDetector } from "./echo-detector.ts";
import type {
  LocalAudioContext,
  LocalAudioProvider,
  AudioStatsSample,
  LocalVoiceDetector,
  SharedAudioMeter,
} from "./types/local-audio.ts";
import type { MediaCaptureEntry } from "./types/media-capture.ts";

export function createLocalAudioEngine({
  authStore,
  automaticGateThreshold,
  capture,
  collectOutboundAudioStats,
  createNoiseFloorEstimator,
  echoDetected,
  getActiveProvider,
  getAudioStereo,
  getAttenuation,
  getEffectiveAudioBitrate,
  getP2pMesh,
  getRequestedVideoSettings,
  getSfu,
  localSources,
  microphoneLevelDb,
  onSpeakingChange,
  settingsStore,
  sharedAudioDucking,
  sharedAudioStats,
  updateNoiseFloor,
  voiceStore,
}: LocalAudioContext) {
  let localVoiceDetector: LocalVoiceDetector | null = null;
  let sharedAudioMeter: SharedAudioMeter | null = null;
  let sharedAudioStatsSample: AudioStatsSample | null = null;
  const asProvider = (value: unknown): LocalAudioProvider | null =>
    value && typeof value === "object" ? (value as LocalAudioProvider) : null;
  let sharedAudioBaseVolume = 1;
  let sharedAudioAttenuation = 1;
  const echoDetector = createEchoDetector({
    onDetected: (detected: boolean) => {
      echoDetected.value = detected;
    },
  });

  function isAnyRemoteUserSpeaking() {
    const localId = authStore.getUserData()?.id;
    if (!localId) return false;
    for (const user of voiceStore.connectedUsers.values()) {
      if (String(user.id) !== String(localId) && user.speaking === true)
        return true;
    }
    return false;
  }

  function producerFacade(entry: MediaCaptureEntry) {
    return {
      id: `${getActiveProvider() || "local"}:${entry.source}:${entry.track.id}`,
      track: entry.track,
      closed: entry.track.readyState !== "live",
      on() {},
      close: () => capture.stop(entry.source),
    };
  }

  function startLocalVoiceDetection(entry: MediaCaptureEntry) {
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
      let activeSamples = 0;
      let quietSamples = 0;
      const noiseFloorEstimator = createNoiseFloorEstimator();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const levelDb = microphoneLevelDb(samples);
        const gate = settingsStore.microphoneGate;
        const thresholdDb = gate.automatic
          ? automaticGateThreshold(noiseFloorEstimator.noiseFloorDb)
          : gate.thresholdDb;
        const sensitivity = getAttenuation?.()?.sensitivity || "standard";
        const sensitivityOffset =
          sensitivity === "relaxed" ? 5 : sensitivity === "responsive" ? -3 : 0;
        const requiredSamples =
          sensitivity === "relaxed" ? 6 : sensitivity === "responsive" ? 2 : 3;
        const active = levelDb >= thresholdDb + sensitivityOffset;
        updateNoiseFloor(noiseFloorEstimator, levelDb, active);
        if (active) {
          quietSamples = 0;
          activeSamples += 1;
          if (!speaking && activeSamples >= requiredSamples) {
            speaking = true;
            voiceStore.updateUserSpeaking(userId, true);
            onSpeakingChange?.(userId, true);
          }
        } else if (speaking && ++quietSamples >= 10) {
          activeSamples = 0;
          speaking = false;
          voiceStore.updateUserSpeaking(userId, false);
          onSpeakingChange?.(userId, false);
        } else {
          activeSamples = 0;
        }

        echoDetector.sample({
          active,
          echoCancellation: settingsStore.audio?.echoCancellation === true,
          remoteSpeaking: isAnyRemoteUserSpeaking(),
        });
      }, 40);
      localVoiceDetector = { analyser, context, source, timer, userId };
      context
        .resume()
        .catch((error: unknown) =>
          console.warn("[Media] Local audio context resume failed", error),
        );
    } catch (error: unknown) {
      voiceStore.updateUserSpeaking(userId, false);
      onSpeakingChange?.(userId, false);
      console.warn(
        `[Media] Local voice detection is unavailable: ${error instanceof Error ? error.message : String(error)}`,
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
      .catch((error: unknown) =>
        console.warn("[Media] Local audio context close failed", error),
      );
    voiceStore.updateUserSpeaking(localVoiceDetector.userId, false);
    onSpeakingChange?.(localVoiceDetector.userId, false);
    localVoiceDetector = null;
    echoDetector.clear();
  }

  function setSharedAudioVolume(value: unknown) {
    const normalized = Math.max(0, Math.min(100, Number(value))) / 100;
    sharedAudioBaseVolume = normalized;
    if (sharedAudioMeter?.gain) {
      applySharedAudioGain(0);
      ensureSharedAudioProcessing().catch((error) =>
        console.warn("[Media] Shared audio context resume failed", error),
      );
    }
    const enabled = normalized > 0;
    Promise.allSettled(
      [
        asProvider(getP2pMesh())?.setSourceTransmission?.(
          "screen-audio",
          enabled,
        ),
        asProvider(getSfu())?.setSourceTransmission?.("screen-audio", enabled),
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

  function setSharedAudioAttenuation(
    speaking: boolean,
    attenuation:
      | {
          enabled?: boolean;
          reductionPercent?: number;
          attackMs?: number;
          releaseMs?: number;
        }
      | null
      | undefined,
  ) {
    const enabled = speaking && attenuation?.enabled;
    sharedAudioAttenuation = enabled
      ? 1 -
        Math.max(0, Math.min(100, Number(attenuation.reductionPercent))) / 100
      : 1;
    if (sharedAudioDucking)
      sharedAudioDucking.value = {
        active: Boolean(enabled),
        effectivePercent: Math.round(sharedAudioAttenuation * 100),
      };
    applySharedAudioGain(
      enabled
        ? Number(attenuation.attackMs) || 120
        : Number(attenuation?.releaseMs) || 650,
    );
  }

  function applySharedAudioGain(durationMs: number) {
    if (!sharedAudioMeter?.gain) return;
    const now = sharedAudioMeter.context.currentTime;
    const parameter = sharedAudioMeter.gain.gain;
    const target = sharedAudioBaseVolume * sharedAudioAttenuation;
    if (sharedAudioMeter.gainTarget === target) return;
    sharedAudioMeter.gainTarget = target;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    if (durationMs > 0)
      parameter.linearRampToValueAtTime(target, now + durationMs / 1000);
    else parameter.setValueAtTime(target, now);
  }

  function setSystemAudioBitrate(value: unknown) {
    settingsStore.systemAudioBitrate = Number(value);
    return refreshAudioSenderSettings();
  }

  function refreshAudioSenderSettings() {
    const p2pMesh = asProvider(getP2pMesh());
    const sfu = asProvider(getSfu());
    const sources = [...localSources.values()]
      .filter((entry) => entry.track.kind === "audio")
      .map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) =>
        [
          p2pMesh?.reconfigureSource?.(source),
          sfu?.updateAudioBitrate?.(source, getEffectiveAudioBitrate(source)),
        ].filter(Boolean),
      ),
    );
  }

  function refreshMediaPolicy() {
    const p2pMesh = asProvider(getP2pMesh());
    const sfu = asProvider(getSfu());
    const sources = [...localSources.values()].map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) => {
        const entry = localSources.get(source);
        if (entry?.track.kind === "audio")
          return [
            p2pMesh?.reconfigureSource?.(source),
            sfu?.updateAudioBitrate?.(source, getEffectiveAudioBitrate(source)),
          ].filter(Boolean);
        return [
          p2pMesh?.reconfigureSource?.(source),
          sfu?.updateVideoBitrate?.(
            source,
            getRequestedVideoSettings(source).maxBitrate,
          ),
        ].filter(Boolean);
      }),
    );
  }

  async function createSharedAudioSource(entry: MediaCaptureEntry) {
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
      if (!track) throw new Error("Shared audio processing returned no track");
      sharedAudioMeter = {
        context,
        source,
        gain,
        gainTarget: gain.gain.value,
        analyser,
        destination,
        timer: null,
        track,
      };
      setSharedAudioVolume(settingsStore.sharedAudioVolume);
      const ready = await ensureSharedAudioProcessing();
      if (!ready)
        throw new Error("Shared audio processing could not be started");
      const rendering = await waitForSharedAudioRendering();
      if (!rendering)
        throw new Error("Shared audio processing did not begin rendering");
      return {
        ...entry,
        stream: new MediaStream([track]),
        track,
        captureTrack: entry.track,
      };
    } catch (error: unknown) {
      stopSharedAudioMeter();
      console.warn(
        `[Media] Shared audio processing is unavailable: ${error instanceof Error ? error.message : String(error)}`,
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

  async function waitForSharedAudioRendering(timeoutMs = 500) {
    if (!sharedAudioMeter) return false;
    const context = sharedAudioMeter.context;
    if (!Number.isFinite(Number(context.baseLatency))) return true;
    const startedAt = performance.now();
    const initialTime = context.currentTime;
    const renderWindow = Math.max(0.02, Number(context.baseLatency) * 2);
    while (
      context.currentTime < initialTime + renderWindow &&
      performance.now() - startedAt < timeoutMs
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    return (
      context.state === "running" &&
      context.currentTime >= initialTime + renderWindow
    );
  }

  function startSharedAudioMeter(source: string) {
    if (!sharedAudioMeter) return;
    if (sharedAudioMeter.timer) clearInterval(sharedAudioMeter.timer);
    const values = new Float32Array(sharedAudioMeter.analyser.fftSize);
    const sample = async () => {
      if (!sharedAudioMeter) return;
      await ensureSharedAudioProcessing();
      sharedAudioMeter.analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length,
      );
      const dbfs = rms > 0 ? 20 * Math.log10(rms) : -60;
      const sfu = asProvider(getSfu());
      const p2pMesh = asProvider(getP2pMesh());
      const producer = sfu?.producers?.get(source)?.producer;
      const report =
        getActiveProvider() === "sfu" && producer
          ? await producer.getStats().catch(() => null)
          : p2pMesh?.getOutboundTrackStats
            ? await p2pMesh.getOutboundTrackStats(source).catch(() => null)
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
    sample().catch((error: unknown) =>
      console.warn("[Media] Shared audio statistics failed", error),
    );
    sharedAudioMeter.timer = setInterval(
      () =>
        sample().catch((error: unknown) =>
          console.warn("[Media] Shared audio statistics failed", error),
        ),
      500,
    );
  }

  function stopSharedAudioMeter() {
    if (!sharedAudioMeter) return;
    if (sharedAudioMeter.timer) clearInterval(sharedAudioMeter.timer);
    sharedAudioMeter.source.disconnect();
    sharedAudioMeter.gain.disconnect();
    sharedAudioMeter.analyser.disconnect();
    sharedAudioMeter.track.stop();
    sharedAudioMeter.context
      .close()
      .catch((error: unknown) =>
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
    setSharedAudioAttenuation,
    setSystemAudioBitrate,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
  };
}
