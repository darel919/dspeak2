export interface DecodeAdaptationCounters {
  totalDecodeTime: number;
  framesDecoded: number;
  framesDropped: number;
}

export interface DecodeAdaptationState {
  spatialLayer: number;
  temporalLayer: number;
  pressureSamples: number;
  healthySamples: number;
}

export interface DecodeAdaptationSample {
  totalDecodeTime?: number | null;
  framesDecoded?: number | null;
  framesDropped?: number | null;
  framesPerSecond?: number | null;
}

export interface DecodeAdaptationDecision {
  state: DecodeAdaptationState;
  changed: boolean;
  overloaded: boolean;
  exhausted: boolean;
  decodeUtilization: number | null;
  droppedFrames: number;
}

export type DecodeAdaptationAction =
  "reduce-layers" | "recover-layers" | "video-unavailable" | "hold";

export function decodeAdaptationAction(
  decision: DecodeAdaptationDecision,
): DecodeAdaptationAction {
  if (decision.exhausted && decision.overloaded) {
    return "video-unavailable";
  }

  if (decision.changed) {
    return decision.overloaded ? "reduce-layers" : "recover-layers";
  }

  return "hold";
}

export const DEFAULT_DECODE_ADAPTATION_STATE: DecodeAdaptationState = {
  spatialLayer: 2,
  temporalLayer: 2,
  pressureSamples: 0,
  healthySamples: 0,
};

function delta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  const value = current - previous;
  return value >= 0 ? value : null;
}

export function decodeAdaptationDecision(
  previousCounters: DecodeAdaptationCounters | null,
  counters: DecodeAdaptationCounters,
  previousState: DecodeAdaptationState = DEFAULT_DECODE_ADAPTATION_STATE,
  framesPerSecond: number | null = null,
): DecodeAdaptationDecision {
  const nextState = {
    ...DEFAULT_DECODE_ADAPTATION_STATE,
    ...previousState,
    spatialLayer: Math.max(
      0,
      Math.min(
        2,
        Number.isFinite(Number(previousState.spatialLayer))
          ? Number(previousState.spatialLayer)
          : DEFAULT_DECODE_ADAPTATION_STATE.spatialLayer,
      ),
    ),
    temporalLayer: Math.max(
      0,
      Math.min(
        2,
        Number.isFinite(Number(previousState.temporalLayer))
          ? Number(previousState.temporalLayer)
          : DEFAULT_DECODE_ADAPTATION_STATE.temporalLayer,
      ),
    ),
    pressureSamples: Math.max(0, Number(previousState.pressureSamples) || 0),
    healthySamples: Math.max(0, Number(previousState.healthySamples) || 0),
  };
  if (!previousCounters) {
    return {
      state: nextState,
      changed: false,
      overloaded: false,
      exhausted: false,
      decodeUtilization: null,
      droppedFrames: 0,
    };
  }
  const decodedDelta = delta(
    counters.framesDecoded,
    previousCounters.framesDecoded,
  );
  const droppedDelta = delta(
    counters.framesDropped,
    previousCounters.framesDropped,
  );
  const decodeTimeDelta = delta(
    counters.totalDecodeTime,
    previousCounters.totalDecodeTime,
  );
  let decodeUtilization: number | null = null;
  if (
    decodedDelta != null &&
    decodedDelta > 0 &&
    decodeTimeDelta != null &&
    Number.isFinite(Number(framesPerSecond)) &&
    Number(framesPerSecond) > 0
  ) {
    const frameTimeMs = (decodeTimeDelta * 1000) / decodedDelta;
    decodeUtilization = (frameTimeMs * Number(framesPerSecond)) / 10;
  }
  const droppedFrames = droppedDelta || 0;
  if ((decodedDelta == null || decodedDelta <= 0) && droppedFrames === 0)
    return {
      state: nextState,
      changed: false,
      overloaded: false,
      exhausted: nextState.spatialLayer === 0 && nextState.temporalLayer === 0,
      decodeUtilization,
      droppedFrames: 0,
    };
  const overloaded = droppedFrames > 0 || (decodeUtilization || 0) >= 80;
  let changed = false;
  if (overloaded) {
    nextState.pressureSamples += 1;
    nextState.healthySamples = 0;
    if (nextState.pressureSamples >= 2) {
      if (nextState.temporalLayer > 0) {
        nextState.temporalLayer -= 1;
        changed = true;
      } else if (nextState.spatialLayer > 0) {
        nextState.spatialLayer -= 1;
        nextState.temporalLayer = 2;
        changed = true;
      }
      nextState.pressureSamples = 0;
    }
  } else {
    nextState.pressureSamples = 0;
    nextState.healthySamples += 1;
    if (nextState.healthySamples >= 8) {
      if (nextState.temporalLayer < 2) {
        nextState.temporalLayer += 1;
        changed = true;
      } else if (nextState.spatialLayer < 2) {
        nextState.spatialLayer += 1;
        nextState.temporalLayer = 0;
        changed = true;
      }
      nextState.healthySamples = 0;
    }
  }
  return {
    state: nextState,
    changed,
    overloaded,
    exhausted: nextState.spatialLayer === 0 && nextState.temporalLayer === 0,
    decodeUtilization,
    droppedFrames,
  };
}
