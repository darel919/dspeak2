export const DESKTOP_CAPTURE_KINDS = Object.freeze([
  "application",
  "window",
  "display",
  "system-audio",
]);

export const DESKTOP_CAPTURE_MODES = Object.freeze(["video", "audio", "both"]);

export const DESKTOP_CAPTURE_AUDIO_POLICY = Object.freeze({
  channels: 2,
  sampleRate: 48000,
  excludeSelfAudio: true,
});

export const DESKTOP_CAPTURE_VIDEO_POLICY = Object.freeze({
  resolution: "original",
  frameRate: 60,
  qualityPriority: "framerate",
});

export const NATIVE_CAPTURE_BACKENDS = Object.freeze([
  "screenCaptureKit",
  "screenAudio",
  "pipewirePortal",
  "x11",
  "systemAudio",
  "windowsGraphicsCapture",
  "wasapiProcessLoopback",
]);

const DEFAULT_NATIVE_CAPTURE_REASON =
  "Native capture support was not reported by the platform backend.";

function normalizeNativeCaptureCapability(value) {
  return {
    available: value?.available === true,
    reason:
      typeof value?.reason === "string" && value.reason.length > 0
        ? value.reason
        : DEFAULT_NATIVE_CAPTURE_REASON,
    sources: Array.isArray(value?.sources) ? value.sources : [],
  };
}

export function normalizeNativeCaptureCapabilities(value) {
  const capture = value?.capture;
  return Object.fromEntries(
    NATIVE_CAPTURE_BACKENDS.map((backend) => [
      backend,
      normalizeNativeCaptureCapability(capture?.[backend]),
    ]),
  );
}

export function getNativeCaptureCapability(value, mode = "video") {
  const capabilities = normalizeNativeCaptureCapabilities(value);
  const backends =
    mode === "audio"
      ? ["screenAudio", "systemAudio", "wasapiProcessLoopback"]
      : ["screenCaptureKit", "pipewirePortal", "x11", "windowsGraphicsCapture"];
  const available = backends.find((backend) => capabilities[backend].available);
  if (available) return capabilities[available];
  const reasons = backends
    .map((backend) => capabilities[backend].reason)
    .filter((reason, index, all) => all.indexOf(reason) === index);
  return {
    available: false,
    reason: reasons.join(" "),
    sources: [],
  };
}

export const DESKTOP_CAPTURE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "DESKTOP_CAPTURE_INVALID_REQUEST",
  SOURCE_CONFLICT: "DESKTOP_CAPTURE_SOURCE_CONFLICT",
  NATIVE_UNAVAILABLE: "DESKTOP_CAPTURE_NATIVE_UNAVAILABLE",
  NATIVE_UNSUPPORTED: "DESKTOP_CAPTURE_NATIVE_UNSUPPORTED",
});
export class DesktopCaptureError extends Error {
  [key: string]: any;
  constructor(
    message,
    { code, operation = "capture", details = null } = {} as any,
  ) {
    super(message);
    this.name = "DesktopCaptureError";
    this.code = code || DESKTOP_CAPTURE_ERROR_CODES.INVALID_REQUEST;
    this.operation = operation;
    this.details = details;
  }
}

export function captureSourceKey(sourceType, sourceId) {
  return `${sourceType}:${sourceId}`;
}

export function isDesktopCaptureSelection(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.sourceId === "string" &&
    DESKTOP_CAPTURE_KINDS.includes(value.sourceType) &&
    typeof value.sourceKey === "string" &&
    value.sourceKey === captureSourceKey(value.sourceType, value.sourceId) &&
    DESKTOP_CAPTURE_MODES.includes(value.mode) &&
    value.audio?.channels === 2 &&
    value.audio?.sampleRate === 48000 &&
    value.audio?.stereo === true &&
    value.audio?.excludeSelfAudio === true &&
    value.excludeSelf === true &&
    value.source?.sourceId === value.sourceId &&
    value.source?.sourceType === value.sourceType &&
    value.source?.sourceKey === value.sourceKey,
  );
}

export function assertDesktopCaptureSelection(value, operation = "capture") {
  if (isDesktopCaptureSelection(value)) return value;
  throw new DesktopCaptureError(
    "The desktop capture selection is invalid or incomplete.",
    {
      code: DESKTOP_CAPTURE_ERROR_CODES.INVALID_REQUEST,
      operation,
    },
  );
}

export function assertDesktopCaptureMode(
  value,
  allowedModes,
  operation = "capture",
) {
  const selection = assertDesktopCaptureSelection(value, operation);
  const modes = Array.isArray(allowedModes) ? allowedModes : [allowedModes];
  if (modes.includes(selection.mode)) return selection;
  throw new DesktopCaptureError(
    `The selected desktop capture mode is incompatible with ${operation}.`,
    {
      code: DESKTOP_CAPTURE_ERROR_CODES.INVALID_REQUEST,
      operation,
      details: { mode: selection.mode, allowedModes: modes },
    },
  );
}

export function nativeCaptureFailure(
  error,
  { operation = "capture", selection = null } = {} as any,
) {
  if (error instanceof DesktopCaptureError) return error;
  const details =
    error && typeof error === "object" && error.details ? error.details : null;
  return new DesktopCaptureError(
    error?.message || "Native desktop capture is unavailable.",
    {
      code: error?.code || DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
      operation: error?.operation || operation,
      details: details || (selection ? { selection } : null),
    },
  );
}

export function desktopCaptureRequest(selection, options = {} as any) {
  assertDesktopCaptureSelection(selection, options.operation || "capture");
  const requestedBitrate = Number(
    options.roomBitrateBps ?? selection.audio?.maxBitrateBps,
  );
  const roomBitrateBps =
    Number.isFinite(requestedBitrate) && requestedBitrate > 0
      ? Math.floor(requestedBitrate)
      : null;
  const captureSelection = {
    ...selection,
    ...(roomBitrateBps
      ? {
          roomBitrateBps,
          audio: { ...selection.audio, maxBitrateBps: roomBitrateBps },
        }
      : {}),
  };
  return {
    captureSelection,
    source: captureSelection.source,
    sourceId: captureSelection.sourceId,
    sourceType: captureSelection.sourceType,
    sourceKey: captureSelection.sourceKey,
    mode: captureSelection.mode,
    video: captureSelection.video,
    audio: captureSelection.audio,
    excludeSelf: captureSelection.excludeSelf,
    excludeSelfAudio: captureSelection.excludeSelfAudio,
    roomBitrateBps,
  };
}

export function normalizeCaptureSource(source) {
  if (!source || typeof source !== "object") return null;
  const sourceType = DESKTOP_CAPTURE_KINDS.includes(source.sourceType)
    ? source.sourceType
    : DESKTOP_CAPTURE_KINDS.includes(source.kind)
      ? source.kind
      : null;
  const sourceId = String(source.sourceId || source.id || "");
  if (!sourceType || !sourceId) return null;
  const capabilities = source.capabilities || {};
  const selfExcluded = source.selfExcluded === true;
  return {
    sourceId,
    sourceType,
    sourceKey: captureSourceKey(sourceType, sourceId),
    title: String(source.title || source.name || "Untitled source"),
    appName: source.appName ? String(source.appName) : null,
    appId: source.appId ? String(source.appId) : null,
    displayId: source.displayId ? String(source.displayId) : null,
    thumbnail: source.thumbnail ? String(source.thumbnail) : null,
    bounds:
      source.bounds && typeof source.bounds === "object"
        ? {
            x: Number(source.bounds.x) || 0,
            y: Number(source.bounds.y) || 0,
            width: Number(source.bounds.width) || 0,
            height: Number(source.bounds.height) || 0,
          }
        : null,
    capabilities: {
      video: capabilities.video === true && sourceType !== "system-audio",
      audio: capabilities.audio === true,
      stereo: capabilities.stereo === true,
      channels: Number.isInteger(capabilities.channels)
        ? capabilities.channels
        : null,
      sampleRate: Number.isFinite(Number(capabilities.sampleRate))
        ? Number(capabilities.sampleRate)
        : null,
    },
    selfExcluded,
    available: source.available !== false,
    reason: source.reason ? String(source.reason) : null,
  };
}

export function normalizeCaptureSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map(normalizeCaptureSource)
    .filter(Boolean)
    .filter((source) => source.available && source.selfExcluded);
}

export function createDesktopCaptureSelection(
  source,
  mode,
  options = {} as any,
) {
  const normalized = normalizeCaptureSource(source);
  if (!normalized) throw new Error("A capture source is required");
  if (!DESKTOP_CAPTURE_MODES.includes(mode))
    throw new Error("A valid capture mode is required");
  const video = mode === "video" || mode === "both";
  const audio = mode === "audio" || mode === "both";
  if (video && !normalized.capabilities.video)
    throw new Error("The selected source does not provide video");
  if (audio && !normalized.capabilities.audio)
    throw new Error("The selected source does not provide audio");
  if (audio && !normalized.capabilities.stereo)
    throw new Error("The selected source does not guarantee stereo audio");
  if (normalized.sourceType === "system-audio" && video)
    throw new Error("System audio cannot provide video");
  if (!normalized.selfExcluded)
    throw new Error("The selected source is not verified as self-excluded");
  const maxBitrateBps = Number(options.audio?.maxBitrateBps);
  const roomBitrateBps = Number(options.roomBitrateBps);
  const resolvedBitrateBps =
    Number.isFinite(roomBitrateBps) && roomBitrateBps > 0
      ? roomBitrateBps
      : Number.isFinite(maxBitrateBps) && maxBitrateBps > 0
        ? maxBitrateBps
        : null;
  return {
    source: {
      sourceId: normalized.sourceId,
      sourceType: normalized.sourceType,
      sourceKey: normalized.sourceKey,
    },
    sourceId: normalized.sourceId,
    sourceType: normalized.sourceType,
    sourceKey: normalized.sourceKey,
    ...(normalized.bounds ? { bounds: normalized.bounds } : {}),
    mode,
    excludeSelf: true,
    video: { ...DESKTOP_CAPTURE_VIDEO_POLICY, ...(options.video || {}) },
    audio: {
      ...DESKTOP_CAPTURE_AUDIO_POLICY,
      stereo: normalized.capabilities.stereo,
      ...(resolvedBitrateBps ? { maxBitrateBps: resolvedBitrateBps } : {}),
    },
    excludeSelfAudio: DESKTOP_CAPTURE_AUDIO_POLICY.excludeSelfAudio,
    ...(resolvedBitrateBps ? { roomBitrateBps: resolvedBitrateBps } : {}),
  };
}

export function desktopCaptureInvoke(invoke, command, payload = {} as any) {
  if (typeof invoke !== "function")
    return Promise.reject(new Error("Desktop capture is unavailable"));
  return invoke(command, payload);
}

export function hasTauriRuntimeMarker() {
  return Boolean(
    typeof window !== "undefined" &&
    (window.__TAURI__ || window.__TAURI_INTERNALS__),
  );
}

export async function isDesktopClient() {
  if (!import.meta.client) return false;
  if (hasTauriRuntimeMarker()) return true;
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return typeof isTauri === "function" && isTauri();
  } catch {
    return false;
  }
}

export async function getDesktopCaptureApi() {
  if (!(await isDesktopClient())) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return { invoke };
  } catch {
    return null;
  }
}
