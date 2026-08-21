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
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import type { ExternalValue } from "./types/boundary.ts";

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

type DesktopCaptureResult =
  object | string | number | boolean | null | undefined;

interface DesktopCaptureApi {
  invoke: (
    command: string,
    payload: ExternalValue,
  ) => Promise<DesktopCaptureResult>;
}

interface DesktopCaptureEvent {
  payload: DesktopCaptureResult;
}

type DesktopCaptureHandler<TPayload> = (payload: TPayload) => void;

function parseDesktopCaptureResult(value: ExternalValue): DesktopCaptureResult {
  if (
    value == null ||
    isExternalRecord(value) ||
    Array.isArray(value) ||
    isExternalString(value) ||
    isExternalNumber(value) ||
    isExternalBoolean(value)
  )
    return value;
  return null;
}

function captureKind<T>(value: T): CaptureKind | null {
  return isExternalString(value) &&
    DESKTOP_CAPTURE_KINDS.some((kind) => kind === value)
    ? value
    : null;
}

function captureMode<T>(value: T): CaptureMode | null {
  return isExternalString(value) &&
    DESKTOP_CAPTURE_MODES.some((mode) => mode === value)
    ? value
    : null;
}

const DEFAULT_NATIVE_CAPTURE_REASON =
  "Native capture support was not reported by the platform backend.";

function normalizeNativeCaptureCapability(
  value: UnknownRecord | null | undefined,
) {
  return {
    available: value?.available === true,
    reason:
      isExternalString(value?.reason) && value.reason.length > 0
        ? value.reason
        : DEFAULT_NATIVE_CAPTURE_REASON,
    sources: Array.isArray(value?.sources) ? value.sources : [],
  };
}

export function normalizeNativeCaptureCapabilities(
  value: UnknownRecord | null | undefined,
) {
  const capture = isExternalRecord(value?.capture) ? value.capture : {};
  const capabilities: Record<string, NativeCaptureCapability> =
    Object.fromEntries(
      NATIVE_CAPTURE_BACKENDS.map((backend) => [
        backend,
        normalizeNativeCaptureCapability(
          isExternalRecord(capture[backend]) ? capture[backend] : null,
        ),
      ]),
    );
  return capabilities;
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
  const enumerated = backends.find(
    (backend) =>
      Array.isArray(capabilities[backend]?.sources) &&
      capabilities[backend].sources.length > 0,
  );
  if (enumerated) return capabilities[enumerated];
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
  TRACK_UNAVAILABLE: "DESKTOP_CAPTURE_TRACK_UNAVAILABLE",
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

export function isDesktopCaptureSelection<T>(
  value: T,
): value is T & DesktopCaptureSelection {
  if (!isExternalRecord(value)) return false;
  const source = isExternalRecord(value.source) ? value.source : null;
  const audio = isExternalRecord(value.audio) ? value.audio : null;
  const sourceType = captureKind(value.sourceType);
  const mode = captureMode(value.mode);
  return Boolean(
    isExternalString(value.sourceId) &&
    sourceType &&
    isExternalString(value.sourceKey) &&
    value.sourceKey === captureSourceKey(sourceType, value.sourceId) &&
    mode &&
    audio &&
    audio.channels === 2 &&
    audio.sampleRate === 48000 &&
    audio.stereo === true &&
    audio.excludeSelfAudio === true &&
    value.excludeSelf === true &&
    source &&
    source.sourceId === value.sourceId &&
    source.sourceType === sourceType &&
    source.sourceKey === value.sourceKey,
  );
}

export function assertDesktopCaptureSelection<T>(
  value: T,
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

export function assertDesktopCaptureMode<T>(
  value: T,
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

export function nativeCaptureFailure<TError, TSelection>(
  error: TError,
  {
    operation = "capture",
    selection = null,
  }: { operation?: string; selection?: TSelection | null } = {},
) {
  if (error instanceof DesktopCaptureError) return error;
  const errorRecord = isExternalRecord(error) ? error : null;
  const nestedError = isExternalRecord(errorRecord?.error)
    ? errorRecord.error
    : null;
  const nestedMessage = isExternalString(errorRecord?.error)
    ? errorRecord.error
    : null;
  const message = isExternalString(error)
    ? error
    : isExternalString(errorRecord?.message)
      ? errorRecord.message
      : isExternalString(nestedError?.message)
        ? nestedError.message
        : nestedMessage || "Native desktop capture is unavailable.";
  const details = errorRecord?.details || nestedError?.details || null;
  return new DesktopCaptureError(message, {
    code: isExternalString(errorRecord?.code)
      ? errorRecord.code
      : isExternalString(nestedError?.code)
        ? nestedError.code
        : DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
    operation: isExternalString(errorRecord?.operation)
      ? errorRecord.operation
      : isExternalString(nestedError?.operation)
        ? nestedError.operation
        : operation,
    details: details || (selection ? { selection } : null),
  });
}

export function desktopCaptureRequest<T>(
  selection: T,
  options: {
    operation?: string;
    roomBitrateBps?: number;
    video?: UnknownRecord;
  } = {},
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
  const captureSelection = { ...validatedSelection };
  if (options.video)
    captureSelection.video = { ...validatedSelection.video, ...options.video };
  if (roomBitrateBps) {
    captureSelection.roomBitrateBps = roomBitrateBps;
    captureSelection.audio = {
      ...validatedSelection.audio,
      maxBitrateBps: roomBitrateBps,
    };
  }
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

export function normalizeCaptureSource<T>(source: T): CaptureSource | null {
  const record = isExternalRecord(source) ? source : null;
  if (!record) return null;
  const sourceType = captureKind(record.sourceType) || captureKind(record.kind);
  const sourceId = String(record.sourceId || record.id || "");
  if (!sourceType || !sourceId) return null;
  const capabilities = isExternalRecord(record.capabilities)
    ? record.capabilities
    : {};
  const bounds = isExternalRecord(record.bounds) ? record.bounds : null;
  return {
    sourceId,
    sourceType,
    sourceKey: captureSourceKey(sourceType, sourceId),
    title: String(record.title || record.name || "Untitled source"),
    appName: record.appName ? String(record.appName) : null,
    appId: record.appId ? String(record.appId) : null,
    displayId: record.displayId ? String(record.displayId) : null,
    thumbnail: record.thumbnail ? String(record.thumbnail) : null,
    bounds: bounds
      ? {
          x: Number(bounds.x) || 0,
          y: Number(bounds.y) || 0,
          width: Number(bounds.width) || 0,
          height: Number(bounds.height) || 0,
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

export function normalizeCaptureSources<T>(sources: T) {
  return (Array.isArray(sources) ? sources : [])
    .map(normalizeCaptureSource)
    .filter((source): source is CaptureSource => source !== null)
    .filter((source) => source.available && source.selfExcluded);
}

export function createDesktopCaptureSelection<T>(
  source: T,
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
  const selection: DesktopCaptureSelection = {
    source: {
      sourceId: normalized.sourceId,
      sourceType: normalized.sourceType,
      sourceKey: normalized.sourceKey,
    },
    sourceId: normalized.sourceId,
    sourceType: normalized.sourceType,
    sourceKey: normalized.sourceKey,
    mode,
    excludeSelf: true,
    video: { ...DESKTOP_CAPTURE_VIDEO_POLICY, ...options.video },
    audio: {
      ...DESKTOP_CAPTURE_AUDIO_POLICY,
      stereo: normalized.capabilities.stereo,
    },
    excludeSelfAudio: DESKTOP_CAPTURE_AUDIO_POLICY.excludeSelfAudio,
  };
  if (normalized.bounds) selection.bounds = normalized.bounds;
  if (resolvedBitrateBps) {
    selection.audio.maxBitrateBps = resolvedBitrateBps;
    selection.roomBitrateBps = resolvedBitrateBps;
  }
  return selection;
}

export function desktopCaptureInvoke<TPayload extends ExternalValue, TResult>(
  invoke: (command: string, payload: TPayload) => TResult,
  command: string,
  payload: TPayload,
): TResult | Promise<never> {
  if (!(invoke instanceof Function))
    return Promise.reject(new Error("Desktop capture is unavailable"));
  return invoke(command, payload);
}

export function hasTauriRuntimeMarker() {
  const browserWindow = globalThis.window;
  return Boolean(
    browserWindow?.__TAURI__ || browserWindow?.__TAURI_INTERNALS__,
  );
}

export async function isDesktopClient() {
  if (!import.meta.client) return false;
  if (hasTauriRuntimeMarker()) return true;
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri instanceof Function && isTauri();
  } catch {
    return false;
  }
}

export async function getDesktopCaptureApi(): Promise<DesktopCaptureApi | null> {
  if (!(await isDesktopClient())) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return {
      invoke: async (command: string, payload: ExternalValue = {}) =>
        parseDesktopCaptureResult(
          await invoke("media_worker_invoke", { command, payload }),
        ),
    };
  } catch {
    return null;
  }
}

export async function invokeNativeDesktopMedia(
  command: string,
  payload: ExternalValue = {},
): Promise<DesktopCaptureResult> {
  const api = await getDesktopCaptureApi();
  if (!api) throw new Error("Native desktop media is unavailable");
  return api.invoke(command, payload);
}

export async function listenNativeDesktopMedia(
  eventName: string,
  handler: DesktopCaptureHandler<DesktopCaptureResult>,
) {
  if (!(await isDesktopClient())) return null;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const handleEvent = (event: DesktopCaptureEvent) => handler(event.payload);
    return await listen<DesktopCaptureResult>(eventName, handleEvent);
  } catch {
    return null;
  }
}
