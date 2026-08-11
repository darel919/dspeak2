import { ref } from "vue";

const MEDIA_LIFECYCLE_TRACE_LIMIT = 64;

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

function sanitizedDetails(details) {
  const result = {} as any;
  for (const [key, value] of Object.entries(details || {})) {
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

export function createMediaLifecycleTrace(
  {
    limit = MEDIA_LIFECYCLE_TRACE_LIMIT,
    now = () => Date.now(),
    monotonicNow = () => performance.now(),
  } = {} as any,
) {
  let startedAt = monotonicNow();
  let entries = [] as any;

  function reset() {
    startedAt = monotonicNow();
    entries = [] as any;
  }

  function record(phase, details = {} as any) {
    const entry = {
      phase,
      elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      timestamp: now(),
      details: sanitizedDetails(details),
    };
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return entry;
  }

  function snapshot() {
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
  const lifecycle = ref([]);

  function record(nextPhase, details = {} as any) {
    phase.value = nextPhase;
    trace.record(nextPhase, details);
    lifecycle.value = trace.snapshot();
  }

  function reset() {
    trace.reset();
    lifecycle.value = [] as any;
  }

  return { lifecycle, phase, record, reset, snapshot: trace.snapshot };
}
