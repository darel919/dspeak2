import {
  automaticGateThreshold,
  createNoiseFloorEstimator,
  updateNoiseFloor,
} from "../../shared/microphone-gate.ts";
import { createEchoDetector } from "../../shared/echo-detector.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import {
  parseExternalValue,
  type ExternalValue,
} from "../../utils/external-values.ts";

function numberValue(value: ExternalValue, fallback: number) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function clampDb(value: ExternalValue) {
  return Math.max(-60, Math.min(0, numberValue(value, -60)));
}

function updateNativeSpeaking(
  engine: NativeMediaEngine,
  levelDb: number,
  microphoneReady: boolean,
) {
  const voiceStore = engine.voiceStore;
  const user = voiceStore?.getAuthenticatedUser?.();
  const userId = user?.id == null ? null : String(user.id);
  if (!voiceStore || !userId || !microphoneReady) {
    if (engine.nativeSpeaking && userId)
      voiceStore?.updateUserSpeaking?.(userId, false);
    engine.nativeSpeaking = false;
    engine.nativeActiveSamples = 0;
    engine.nativeQuietSamples = 0;
    return;
  }

  const gate = engine.settingsStore?.microphoneGate;
  const threshold =
    gate?.automatic !== false
      ? automaticGateThreshold(
          engine.nativeNoiseFloorEstimator?.noiseFloorDb ?? -60,
        )
      : Math.max(
          -60,
          Math.min(
            -20,
            numberValue(parseExternalValue(gate?.thresholdDb), -48),
          ),
        );
  const active = levelDb >= threshold;
  const estimator = engine.nativeNoiseFloorEstimator;
  if (estimator) updateNoiseFloor(estimator, levelDb, active);

  if (active) {
    engine.nativeQuietSamples = 0;
    engine.nativeActiveSamples += 1;
    if (!engine.nativeSpeaking && engine.nativeActiveSamples >= 3) {
      engine.nativeSpeaking = true;
      voiceStore.updateUserSpeaking?.(userId, true);
    }
    return;
  }

  engine.nativeActiveSamples = 0;
  if (engine.nativeSpeaking && ++engine.nativeQuietSamples >= 10) {
    engine.nativeSpeaking = false;
    engine.nativeQuietSamples = 0;
    voiceStore.updateUserSpeaking?.(userId, false);
  }
}

function updateNativeStats(
  engine: NativeMediaEngine,
  sharedAudioDbfs: number,
  sharedAudioLevel: number,
  output: Record<string, unknown> = {},
) {
  const session = engine.nativeSession;
  if (!session) return;
  session.sharedAudioStats = {
    ...session.sharedAudioStats,
    level: Math.max(0, Math.min(1, sharedAudioLevel)),
    dbfs: sharedAudioDbfs,
    nativeOutputDevicePeriodMs: numberValue(
      parseExternalValue(output.nativeOutputDevicePeriodMs),
      0,
    ),
    nativeOutputRenderPeriodMs: numberValue(
      parseExternalValue(output.nativeOutputRenderPeriodMs),
      0,
    ),
    nativeOutputQueueDepthMs: numberValue(
      parseExternalValue(output.nativeOutputQueueDepthMs),
      0,
    ),
    nativePlayoutTargetMs: numberValue(
      parseExternalValue(output.nativePlayoutTargetMs),
      0,
    ),
    nativeOutputDroppedFrames: numberValue(
      parseExternalValue(output.nativeOutputDroppedFrames),
      0,
    ),
    nativeOutputCount: numberValue(
      parseExternalValue(output.nativeOutputCount),
      0,
    ),
  };
}

export function handleNativeAudioTelemetry(
  engine: NativeMediaEngine,
  levels: Record<string, unknown>,
) {
  const microphoneDbfs = clampDb(parseExternalValue(levels.microphoneDbfs));
  const sharedAudioDbfs = clampDb(parseExternalValue(levels.sharedAudioDbfs));
  const sharedAudioLevel = Math.max(
    0,
    Math.min(1, numberValue(parseExternalValue(levels.sharedAudioLevel), 0)),
  );
  const microphoneReady = levels.microphoneReady === true;
  const sharedAudioReady = levels.sharedAudioReady === true;
  updateNativeStats(engine, sharedAudioDbfs, sharedAudioLevel, levels);
  updateNativeSpeaking(engine, microphoneDbfs, microphoneReady);
  const remoteSpeaking =
    engine.voiceStore?.getConnectedUsersArray?.().some((user) => {
      const localId = engine.voiceStore?.getAuthenticatedUser?.()?.id;
      return String(user.id) !== String(localId) && user.speaking === true;
    }) || false;
  engine.nativeEchoDetector?.sample({
    active: microphoneReady && microphoneDbfs > -60,
    echoCancellation: engine.settingsStore?.audio?.echoCancellation === true,
    remoteSpeaking,
  });
  if (!microphoneReady && engine.nativeEchoDetector)
    engine.nativeEchoDetector.clear();
  if (!sharedAudioReady) updateNativeStats(engine, -60, 0);
}

export function startNativeAudioTelemetry(engine: NativeMediaEngine) {
  if (engine.nativeNoiseFloorEstimator) return;
  engine.nativeNoiseFloorEstimator = createNoiseFloorEstimator();
  engine.nativeSpeaking = false;
  engine.nativeActiveSamples = 0;
  engine.nativeQuietSamples = 0;
  engine.nativeEchoDetector = createEchoDetector({
    onDetected: (detected) => {
      if (engine.nativeSession) engine.nativeSession.echoDetected = detected;
    },
  });
}

export function stopNativeAudioTelemetry(engine: NativeMediaEngine) {
  engine.nativeEchoDetector?.clear();
  engine.nativeEchoDetector = null;
  const userId = engine.voiceStore?.getAuthenticatedUser?.()?.id;
  if (userId && engine.nativeSpeaking)
    engine.voiceStore?.updateUserSpeaking?.(String(userId), false);
  engine.nativeSpeaking = false;
  engine.nativeActiveSamples = 0;
  engine.nativeQuietSamples = 0;
  engine.nativeNoiseFloorEstimator = null;
  updateNativeStats(engine, -60, 0);
}
