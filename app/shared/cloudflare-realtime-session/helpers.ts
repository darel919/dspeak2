import type {
  CloudflarePeerConnectionLike,
  DeferredPromise,
} from "../types/cloudflare-media.ts";

function finiteOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function secondsToMilliseconds(value: unknown): number | null {
  const number = finiteOrNull(value);
  return number == null ? null : number * 1000;
}

function deferred<T>(timeoutMs: number, label: string): DeferredPromise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  const waiting = promise.finally(() =>
    clearTimeout(timer),
  ) as DeferredPromise<T>;
  waiting.resolve = resolvePromise;
  waiting.reject = rejectPromise;
  return waiting;
}

function sessionClosedError() {
  const error = new Error("Cloudflare session closed");
  error.code = "MEDIA_SESSION_CLOSED";
  return error;
}

const ICE_GATHERING_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TRACKS_PER_REQUEST = 64;

function waitForIceGatheringComplete(
  peerConnection: CloudflarePeerConnectionLike | null,
): Promise<void> {
  if (
    !peerConnection ||
    peerConnection.iceGatheringState == null ||
    peerConnection.iceGatheringState === "complete" ||
    typeof peerConnection.addEventListener !== "function"
  )
    return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener?.("icegatheringstatechange", finish);
      resolve();
    };
    peerConnection.addEventListener!("icegatheringstatechange", finish);
    timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    if (peerConnection.iceGatheringState === "complete") finish();
  });
}

async function getLocalSessionDescription(
  peerConnection: CloudflarePeerConnectionLike,
) {
  await waitForIceGatheringComplete(peerConnection);
  const description = peerConnection.localDescription;
  if (!description?.type || typeof description.sdp !== "string")
    throw new Error(
      "Cloudflare local WebRTC session description is unavailable",
    );
  return { type: description.type, sdp: description.sdp };
}

export {
  finiteOrNull,
  secondsToMilliseconds,
  deferred,
  sessionClosedError,
  ICE_GATHERING_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  MAX_TRACKS_PER_REQUEST,
  waitForIceGatheringComplete,
  getLocalSessionDescription,
};
