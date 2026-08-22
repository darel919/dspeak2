import { debugLog } from "./debug.ts";
import { hasTauriRuntimeMarker } from "./desktop-capture.ts";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "./types/boundary.ts";

export const DESKTOP_STARTUP_STATUS_EVENT = "desktop-startup-status";

export const DESKTOP_STARTUP_WINDOW_TARGET = "init";

export const DESKTOP_STARTUP_PHASES = [
  "starting",
  "runtime",
  "desktop-update",
  "repository-update",
  "authentication",
  "workspace",
  "ready",
  "error",
] as const;

export type DesktopStartupPhase = (typeof DESKTOP_STARTUP_PHASES)[number];

export type DesktopStartupStatus = {
  phase: DesktopStartupPhase;
  message: string;
  progress: number | null;
  elapsedMs: number;
  errorCode: string | null;
};

const KNOWN_PHASES: ReadonlySet<string> = new Set(DESKTOP_STARTUP_PHASES);

export function clampStartupProgress(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, value));
}

export function parseDesktopStartupStatus(
  value: ExternalObject[string],
): DesktopStartupStatus | null {
  if (!isExternalRecord(value)) return null;
  const phase = isExternalString(value.phase) ? value.phase : "";
  if (!KNOWN_PHASES.has(phase)) return null;
  /* SAFETY: membership in the KNOWN_PHASES set is exactly the phase union. */
  return {
    phase: phase as DesktopStartupPhase,
    message: isExternalString(value.message) ? value.message : "",
    progress:
      isExternalNumber(value.progress) || value.progress === null
        ? clampStartupProgress(value.progress)
        : null,
    elapsedMs:
      isExternalNumber(value.elapsedMs) && value.elapsedMs >= 0
        ? Math.floor(value.elapsedMs)
        : 0,
    errorCode: isExternalString(value.errorCode) ? value.errorCode : null,
  };
}

export type DesktopStartupReporter = {
  begin: (phase: DesktopStartupPhase, message: string) => void;
  progress: (
    phase: DesktopStartupPhase,
    message: string,
    completed: number,
    total: number,
  ) => void;
  finish: () => void;
  fail: (errorCode: string, message: string) => void;
  flush: () => Promise<void>;
};

export function createDesktopStartupReporter({
  deliver,
  now = () => Date.now(),
}: {
  deliver: (status: DesktopStartupStatus) => boolean | Promise<boolean>;
  now?: () => number;
}): DesktopStartupReporter {
  const startedAtMs = now();
  let lastElapsedMs = 0;
  let latest: DesktopStartupStatus | null = null;
  let latestDelivered = true;
  let queue: Promise<void> = Promise.resolve();

  function push(status: DesktopStartupStatus) {
    lastElapsedMs = Math.max(lastElapsedMs, Math.max(0, now() - startedAtMs));
    status.elapsedMs = lastElapsedMs;
    latest = status;
    const preceding = queue;
    queue = preceding.then(async () => {
      try {
        latestDelivered = Boolean(await deliver(status));
      } catch {
        latestDelivered = false;
      }
    });
  }

  function begin(phase: DesktopStartupPhase, message: string) {
    push({
      phase,
      message,
      progress: null,
      elapsedMs: 0,
      errorCode: null,
    });
  }

  function progress(
    phase: DesktopStartupPhase,
    message: string,
    completed: number,
    total: number,
  ) {
    const known =
      Number.isFinite(total) &&
      total > 0 &&
      Number.isFinite(completed) &&
      completed >= 0;
    push({
      phase,
      message,
      progress: known ? (completed / total) * 100 : null,
      elapsedMs: 0,
      errorCode: null,
    });
  }

  function finish() {
    push({
      phase: "ready",
      message: "Ready.",
      progress: null,
      elapsedMs: 0,
      errorCode: null,
    });
  }

  function fail(errorCode: string, message: string) {
    push({
      phase: "error",
      message,
      progress: null,
      elapsedMs: 0,
      errorCode,
    });
  }

  async function flush() {
    await queue;
    if (latest && !latestDelivered) {
      try {
        await deliver(latest);
      } catch {}
    }
  }

  return { begin, progress, finish, fail, flush };
}

export function createTauriDesktopStartupReporter(): DesktopStartupReporter | null {
  if (!import.meta.client) return null;
  if (!hasTauriRuntimeMarker()) return null;

  let invoke: ((command: string) => Promise<void>) | null = null;
  let emit:
    ((event: string, payload: DesktopStartupStatus) => Promise<void>) | null =
    null;

  void import("@tauri-apps/api/core")
    .then((core) => {
      invoke = core.invoke;
      return import("@tauri-apps/api/event");
    })
    .then((eventModule) => {
      emit = eventModule.emit;
    })
    .catch((error) => {
      debugLog("[Init] Startup status bridge unavailable:", error);
      invoke = null;
      emit = null;
    });

  function deliver(status: DesktopStartupStatus): boolean | Promise<boolean> {
    if (!invoke || !emit) return false;
    return emit(DESKTOP_STARTUP_STATUS_EVENT, status)
      .then(() => true)
      .catch((error) => {
        debugLog("[Init] Startup status delivery failed:", error);
        void invoke?.("desktop_ready").catch(() => {});
        return false;
      });
  }

  return createDesktopStartupReporter({ deliver });
}
