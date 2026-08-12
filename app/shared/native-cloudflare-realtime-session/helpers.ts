import {
  nativeFlowing,
  nativeRtpStatForTrack,
} from "../native-mediasoup-diagnostics.ts";

function requestIdentifier() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `native-cloudflare-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function sourceKind(entry: Record<string, unknown>): string {
  return typeof entry.kind === "string"
    ? entry.kind
    : entry.source === "camera" || entry.source === "screen"
      ? "video"
      : "audio";
}

function mediaSections(sdp: unknown, kind: string): string[] {
  return String(sdp || "")
    .split(/(?=m=)/g)
    .filter((section: string) => section.startsWith(`m=${kind} `));
}

function sectionMid(section: string): string | null {
  const match = section.match(/(?:^|\r?\n)a=mid:([^\r\n]+)/);
  return match?.[1]?.trim() || null;
}

function sectionContainsTrack(section: string, trackId: unknown): boolean {
  const expectedTrackId = String(trackId);
  return section.split(/\r?\n/).some((line) => {
    if (!line.startsWith("a=msid:")) return false;
    return line
      .slice("a=msid:".length)
      .trim()
      .split(/\s+/)
      .includes(expectedTrackId);
  });
}

function sectionSendsMedia(section: string): boolean {
  return /(?:^|\r?\n)a=(?:sendrecv|sendonly)(?:\r?\n|$)/.test(section);
}

function midForTrack(
  sdp: unknown,
  trackId: unknown,
  kind: string,
  usedMids: Set<string> = new Set(),
): string | null {
  const sections = mediaSections(sdp, kind)
    .map((section) => ({
      section,
      mid: sectionMid(section),
    }))
    .filter(({ mid }) => mid && !usedMids.has(mid));
  const exact = sections.find(({ section }) =>
    sectionContainsTrack(section, trackId),
  );
  if (exact) return exact.mid;
  const sending = sections.filter(
    ({ section }) =>
      sectionSendsMedia(section) &&
      !/(?:^|\r?\n)a=inactive(?:\r?\n|$)/.test(section),
  );
  return sending[0]?.mid || null;
}

function nativeFlowForTrack(
  value: unknown,
  type: string,
  entry: Record<string, unknown>,
) {
  const stat = nativeRtpStatForTrack(value, type, entry);
  return stat ? nativeFlowing([stat], type) : null;
}

function sessionClosedError() {
  const error = new Error("Cloudflare session closed");
  error.code = "MEDIA_SESSION_CLOSED";
  return error;
}

export {
  requestIdentifier,
  sourceKind,
  mediaSections,
  sectionMid,
  sectionContainsTrack,
  sectionSendsMedia,
  midForTrack,
  nativeFlowForTrack,
  sessionClosedError,
};
