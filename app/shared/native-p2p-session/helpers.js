function sourceFromTrackId(trackId, kind) {
  const value = String(trackId || "");
  if (value.includes("desktop_capture_video")) return "screen";
  if (value.includes("desktop_capture_audio")) return "screen-audio";
  if (value.includes("screen")) return "screen";
  if (value.includes("camera")) return "camera";
  if (value.includes("microphone") || kind === "audio") return "audio";
  return kind === "video" ? "camera" : "audio";
}

function asPeerId(value) {
  return value == null ? "" : String(value);
}

export { sourceFromTrackId, asPeerId };
