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

export interface VideoFrameScheduler {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

export function scheduleFencedVideoFrame(
  scheduler: VideoFrameScheduler,
  candidate: VideoFrameIdentity,
  getCurrent: () => VideoFrameIdentity,
  onPresented: () => void,
): { handle: number; cancel: () => void } {
  let active = true;
  const handle = scheduler.request(() => {
    if (!active) return;
    active = false;
    if (isCurrentVideoFrame(candidate, getCurrent())) onPresented();
  });
  return {
    handle,
    cancel: () => {
      if (!active) return;
      active = false;
      scheduler.cancel(handle);
    },
  };
}
