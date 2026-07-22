export const MEDIA_JITTER_BUFFER_TARGET_MS = 0;

export function setReceiverJitterBufferTarget(receiver) {
  if (!receiver || !("jitterBufferTarget" in receiver)) return false;
  try {
    receiver.jitterBufferTarget = MEDIA_JITTER_BUFFER_TARGET_MS;
    return true;
  } catch (_) {
    return false;
  }
}
