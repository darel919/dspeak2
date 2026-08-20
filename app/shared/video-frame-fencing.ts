export interface VideoFrameIdentity {
  feedKey: string | null | undefined;
  receiverIncarnationId: string | null | undefined;
}

export function isCurrentVideoFrame(
  candidate: VideoFrameIdentity,
  current: VideoFrameIdentity,
): boolean {
  return (
    candidate.feedKey === current.feedKey &&
    candidate.receiverIncarnationId === current.receiverIncarnationId
  );
}
