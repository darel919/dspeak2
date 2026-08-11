import { ref } from "vue";

const MEDIA_LIFECYCLE_TRACE_LIMIT = 64;
type LifecycleDetails = Record<string, string | number | boolean | null>;
type LifecycleEntry = {
  phase: string;
  elapsedMs: number;
  timestamp: number;
  details: LifecycleDetails;
};

const allowedDetailKeys = new Set([
  "code",
  "direction",
  "mediaSessionId",
  "protocolVersion",
  "reason",
  "sourceRevision",
  "topologyEpoch",
  "topologyMode",
]);

function sanitizedDetails(details: unknown): LifecycleDetails {
  const result: LifecycleDetails = {};
  const source =
    details && typeof details === "object"
      ? (details as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowedDetailKeys.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    )
      result[key] = typeof value === "string" ? value.slice(0, 160) : value;
  }
  return result;
}

export function createMediaLifecycleTrace({
  limit = MEDIA_LIFECYCLE_TRACE_LIMIT,
  now = () => Date.now(),
  monotonicNow = () => performance.now(),
}: {
  limit?: number;
  now?: () => number;
  monotonicNow?: () => number;
} = {}) {
  let startedAt = monotonicNow();
  let entries: LifecycleEntry[] = [];

  function reset() {
    startedAt = monotonicNow();
    entries = [];
  }

  function record(phase: string, details: unknown = {}) {
    const entry: LifecycleEntry = {
      phase,
      elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      timestamp: now(),
      details: sanitizedDetails(details),
    };
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return entry;
  }

  function snapshot(): LifecycleEntry[] {
    return entries.map((entry) => ({
      ...entry,
      details: { ...entry.details },
    }));
  }

  return { record, reset, snapshot };
}

export function createMediaLifecycleState() {
  const trace = createMediaLifecycleTrace();
  const phase = ref("closed");
  const lifecycle = ref<LifecycleEntry[]>([]);

  function record(nextPhase: string, details: unknown = {}) {
    phase.value = nextPhase;
    trace.record(nextPhase, details);
    lifecycle.value = trace.snapshot();
  }

  function reset() {
    trace.reset();
    lifecycle.value = [];
  }

  return { lifecycle, phase, record, reset, snapshot: trace.snapshot };
}
