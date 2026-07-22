const mediaSources = new Set([
  "audio",
  "camera",
  "screen",
  "screen-audio",
  "video",
]);

export function validP2pSignal(signal) {
  if (!signal || typeof signal !== "object") return false;
  if (signal.description) {
    const type = String(signal.description.type || "");
    const sdp = String(signal.description.sdp || "");
    return (
      (type === "offer" || type === "answer" || type === "rollback") &&
      sdp.length <= 500000
    );
  }
  if (signal.candidate) {
    return (
      String(signal.candidate.candidate || "").length <= 4096 &&
      String(signal.candidate.sdpMid || "").length <= 100
    );
  }
  if (signal.source) {
    return (
      String(signal.source.trackId || "").length <= 200 &&
      mediaSources.has(String(signal.source.source || ""))
    );
  }
  if (signal.sourceRemoved)
    return mediaSources.has(String(signal.sourceRemoved.source || ""));
  if (signal.sourceRestored)
    return mediaSources.has(String(signal.sourceRestored.source || ""));
  if (signal.sourceReceiving)
    return (
      mediaSources.has(String(signal.sourceReceiving.source || "")) &&
      typeof signal.sourceReceiving.receiving === "boolean"
    );
  return false;
}
