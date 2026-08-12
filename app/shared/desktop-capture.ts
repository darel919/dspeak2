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

type CaptureKind = (typeof DESKTOP_CAPTURE_KINDS)[number];
type CaptureMode = (typeof DESKTOP_CAPTURE_MODES)[number];
type UnknownRecord = Record<string, unknown>;
interface CaptureSource {
  sourceId: string;
  sourceType: CaptureKind;
  sourceKey: string;
  title: string;
  appName: string | null;
  appId: string | null;
  displayId: string | null;
  thumbnail: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  capabilities: {
    video: boolean;
    audio: boolean;
    stereo: boolean;
    channels: number | null;
    sampleRate: number | null;
  };
  selfExcluded: boolean;
  available: boolean;
  reason: string | null;
}
export interface DesktopCaptureSelection {
  source: { sourceId: string; sourceType: CaptureKind; sourceKey: string };
  sourceId: string;
  sourceType: CaptureKind;
  sourceKey: string;
  mode: CaptureMode;
  excludeSelf: true;
  excludeSelfAudio: true;
  video: UnknownRecord;
  audio: UnknownRecord;
  [key: string]: unknown;
}
interface NativeCaptureCapability {
  available: boolean;
  reason: string;
  sources: unknown[];
}

const DEFAULT_NATIVE_CAPTURE_REASON =
  "Native capture support was not reported by the platform backend.";

function normalizeNativeCaptureCapability(
  value: UnknownRecord | null | undefined,
) {
  return {
    available: value?.available === true,
    reason:
      typeof value?.reason === "string" && value.reason.length > 0
        ? value.reason
        : DEFAULT_NATIVE_CAPTURE_REASON,
    sources: Array.isArray(value?.sources) ? value.sources : [],
  };
}

export function normalizeNativeCaptureCapabilities(
  value: UnknownRecord | null | undefined,
) {
  const capture =
    value?.capture && typeof value.capture === "object"
      ? (value.capture as UnknownRecord)
      : {};
  return Object.fromEntries(
    NATIVE_CAPTURE_BACKENDS.map((backend) => [
      backend,
      normalizeNativeCaptureCapability(
        capture[backend] && typeof capture[backend] === "object"
          ? (capture[backend] as UnknownRecord)
          : null,
      ),
    ]),
  ) as Record<string, NativeCaptureCapability>;
}

export function getNativeCaptureCapability(
  value: UnknownRecord | null | undefined,
  mode: "video" | "audio" = "video",
) {
  const capabilities = normalizeNativeCaptureCapabilities(value);
  const backends =
    mode === "audio"
      ? ["screenAudio", "systemAudio", "wasapiProcessLoopback"]
      : ["screenCaptureKit", "pipewirePortal", "x11", "windowsGraphicsCapture"];
  const available = backends.find(
    (backend) => capabilities[backend]?.available === true,
  );
  if (available) return capabilities[available];
  const reasons = backends
    .map((backend) => capabilities[backend]?.reason || "")
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
  override code: string;
  operation: string;
  override details: unknown;
  constructor(
    message: string,
    {
      code,
      operation = "capture",
      details = null,
    }: { code?: string; operation?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "DesktopCaptureError";
    this.code = code || DESKTOP_CAPTURE_ERROR_CODES.INVALID_REQUEST;
    this.operation = operation;
    this.details = details;
  }
}

export function captureSourceKey(sourceType: string, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

export function isDesktopCaptureSelection(
  value: unknown,
): value is DesktopCaptureSelection {
  const record =
    value && typeof value === "object" ? (value as UnknownRecord) : null;
  return Boolean(
    record &&
    typeof record.sourceId === "string" &&
    typeof record.sourceType === "string" &&
    DESKTOP_CAPTURE_KINDS.includes(record.sourceType as CaptureKind) &&
    typeof record.sourceKey === "string" &&
    record.sourceKey === captureSourceKey(record.sourceType, record.sourceId) &&
    typeof record.mode === "string" &&
    DESKTOP_CAPTURE_MODES.includes(record.mode as CaptureMode) &&
    record.audio &&
    typeof record.audio === "object" &&
    (record.audio as UnknownRecord).channels === 2 &&
    (record.audio as UnknownRecord).sampleRate === 48000 &&
    (record.audio as UnknownRecord).stereo === true &&
    (record.audio as UnknownRecord).excludeSelfAudio === true &&
    record.excludeSelf === true &&
    record.source &&
    typeof record.source === "object" &&
    (record.source as UnknownRecord).sourceId === record.sourceId &&
    (record.source as UnknownRecord).sourceType === record.sourceType &&
    (record.source as UnknownRecord).sourceKey === record.sourceKey,
  );
}

export function assertDesktopCaptureSelection(
  value: unknown,
  operation = "capture",
): DesktopCaptureSelection {
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
  value: unknown,
  allowedModes: CaptureMode | CaptureMode[],
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
  error: unknown,
  {
    operation = "capture",
    selection = null,
  }: { operation?: string; selection?: unknown } = {},
) {
  if (error instanceof DesktopCaptureError) return error;
  const errorRecord =
    error && typeof error === "object" ? (error as UnknownRecord) : null;
  const details = errorRecord?.details || null;
  return new DesktopCaptureError(
    typeof errorRecord?.message === "string"
      ? errorRecord.message
      : "Native desktop capture is unavailable.",
    {
      code:
        typeof errorRecord?.code === "string"
          ? errorRecord.code
          : DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
      operation:
        typeof errorRecord?.operation === "string"
          ? errorRecord.operation
          : operation,
      details: details || (selection ? { selection } : null),
    },
  );
}

export function desktopCaptureRequest(
  selection: unknown,
  options: { operation?: string; roomBitrateBps?: number } = {},
) {
  const validatedSelection = assertDesktopCaptureSelection(
    selection,
    options.operation || "capture",
  );
  const requestedBitrate = Number(
    options.roomBitrateBps ?? validatedSelection.audio?.maxBitrateBps,
  );
  const roomBitrateBps =
    Number.isFinite(requestedBitrate) && requestedBitrate > 0
      ? Math.floor(requestedBitrate)
      : null;
  const captureSelection = {
    ...validatedSelection,
    ...(roomBitrateBps
      ? {
          roomBitrateBps,
          audio: { ...validatedSelection.audio, maxBitrateBps: roomBitrateBps },
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

export function normalizeCaptureSource(source: unknown): CaptureSource | null {
  const record =
    source && typeof source === "object" ? (source as UnknownRecord) : null;
  if (!record) return null;
  const sourceType =
    typeof record.sourceType === "string" &&
    DESKTOP_CAPTURE_KINDS.includes(record.sourceType as CaptureKind)
      ? (record.sourceType as CaptureKind)
      : typeof record.kind === "string" &&
          DESKTOP_CAPTURE_KINDS.includes(record.kind as CaptureKind)
        ? (record.kind as CaptureKind)
        : null;
  const sourceId = String(record.sourceId || record.id || "");
  if (!sourceType || !sourceId) return null;
  const capabilities =
    record.capabilities && typeof record.capabilities === "object"
      ? (record.capabilities as UnknownRecord)
      : {};
  return {
    sourceId,
    sourceType,
    sourceKey: captureSourceKey(sourceType, sourceId),
    title: String(record.title || record.name || "Untitled source"),
    appName: record.appName ? String(record.appName) : null,
    appId: record.appId ? String(record.appId) : null,
    displayId: record.displayId ? String(record.displayId) : null,
    thumbnail: record.thumbnail ? String(record.thumbnail) : null,
    bounds:
      record.bounds && typeof record.bounds === "object"
        ? {
            x: Number((record.bounds as UnknownRecord).x) || 0,
            y: Number((record.bounds as UnknownRecord).y) || 0,
            width: Number((record.bounds as UnknownRecord).width) || 0,
            height: Number((record.bounds as UnknownRecord).height) || 0,
          }
        : null,
    capabilities: {
      video: capabilities.video === true && sourceType !== "system-audio",
      audio: capabilities.audio === true,
      stereo: capabilities.stereo === true,
      channels: Number.isInteger(capabilities.channels)
        ? Number(capabilities.channels)
        : null,
      sampleRate: Number.isFinite(Number(capabilities.sampleRate))
        ? Number(capabilities.sampleRate)
        : null,
    },
    selfExcluded: record.selfExcluded === true,
    available: record.available !== false,
    reason: record.reason ? String(record.reason) : null,
  };
}

export function normalizeCaptureSources(sources: unknown) {
  return (Array.isArray(sources) ? sources : [])
    .map(normalizeCaptureSource)
    .filter((source): source is CaptureSource => source !== null)
    .filter((source) => source.available && source.selfExcluded);
}

export function createDesktopCaptureSelection(
  source: unknown,
  mode: CaptureMode,
  options: {
    audio?: UnknownRecord;
    roomBitrateBps?: number;
    video?: UnknownRecord;
  } = {},
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

export function desktopCaptureInvoke(
  invoke: (command: string, payload: unknown) => unknown,
  command: string,
  payload: unknown = {},
) {
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
