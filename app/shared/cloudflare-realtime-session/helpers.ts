function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function secondsToMilliseconds(value) {
  const number = finiteOrNull(value);
  return number == null ? null : number * 1000;
}

function deferred(timeoutMs, label) {
  let timer;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  const waiting: any = promise.finally(() => clearTimeout(timer));
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

function waitForIceGatheringComplete(peerConnection) {
  if (
    !peerConnection ||
    peerConnection.iceGatheringState == null ||
    peerConnection.iceGatheringState === "complete" ||
    typeof peerConnection.addEventListener !== "function"
  )
    return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener?.("icegatheringstatechange", finish);
      resolve();
    };
    peerConnection.addEventListener("icegatheringstatechange", finish);
    timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    if (peerConnection.iceGatheringState === "complete") finish();
  });
}

async function getLocalSessionDescription(peerConnection) {
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
