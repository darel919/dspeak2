export type WebRtcLatencyDiagnosticEvent =
  | {
      kind: "receiver-jitter-target-applied";
      requestedTargetMs: number;
      assignedTargetMs: number | null;
    }
  | { kind: "receiver-jitter-target-rejected"; errorName: string }
  | { kind: "receiver-jitter-target-unsupported" }
  | { kind: "sender-policy-applied"; appliedControls: readonly string[] }
  | {
      kind: "sender-policy-rejected";
      rejectedControls: readonly string[];
      errorName: string | null;
    };

const EVENT_LIMIT = 128;

let events: WebRtcLatencyDiagnosticEvent[] = [];

export function recordWebRtcLatencyEvent(event: WebRtcLatencyDiagnosticEvent) {
  events.push(event);
  if (events.length > EVENT_LIMIT)
    events = events.slice(events.length - EVENT_LIMIT);
}

export function getWebRtcLatencyEvents(): readonly WebRtcLatencyDiagnosticEvent[] {
  return events;
}

export function clearWebRtcLatencyEvents() {
  events = [];
}
