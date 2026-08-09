import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  desktopCaptureRequest,
  nativeCaptureFailure,
} from "../../shared/desktop-capture.js";
import { nativeOnlyError } from "./native-media-engine-common.js";

export function startSystemAudioProduction(engine, args = []) {
  const options = args[0] || {};
  const selection = options.captureSelection || null;
  if (engine.activeScreenCapture?.mode === "both")
    return Promise.resolve(engine.activeSystemAudioCapture);
  if (options.explicitBrowserFallback && !selection) {
    if (engine.nativeOnly)
      throw nativeOnlyError("browser system audio fallback");
    return engine.browserEngine.startSystemAudioProduction(...args);
  }
  const request = selection
    ? desktopCaptureRequest(selection, {
        operation: "system-audio",
        roomBitrateBps: options.roomBitrateBps,
      })
    : options;
  if (!engine._usesNativeCapture("nativeScreenAudio")) {
    if (engine.nativeOnly) throw nativeOnlyError("system audio production");
    if (selection && !options.explicitBrowserFallback)
      return Promise.reject(
        new DesktopCaptureError(
          "Native desktop audio capture is not ready for the selected source; choose browser capture explicitly to continue.",
          {
            code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
            operation: "system-audio",
            details: { selection },
          },
        ),
      );
    return engine.browserEngine.startSystemAudioProduction(...args);
  }
  const replaceActiveCapture = engine.activeSystemAudioCapture
    ? engine.stopSystemAudioProduction()
    : Promise.resolve();
  return replaceActiveCapture
    .then(() => engine._invoke("media_start_system_audio", { request }))
    .then(async (result) => {
      engine.activeSystemAudioCapture = selection || {};
      const entry = {
        source: "screen-audio",
        track: { kind: "audio" },
        captureSelection: request.captureSelection || selection,
        audioBitrate: engine.getAudioBitrate?.("screen-audio"),
        audioStereo: engine.getAudioStereo?.("screen-audio"),
      };
      const producer = await engine.nativeSession?.addSource(entry);
      await engine.nativeP2pSession?.addSource(entry);
      return producer || result;
    })
    .catch((error) => {
      engine.flags.nativeScreenAudio = false;
      const failure = nativeCaptureFailure(error, {
        operation: "system-audio",
        selection,
      });
      engine._emit("error", {
        source: "native",
        operation: "system-audio",
        error: failure,
      });
      if (engine.nativeOnly) throw failure;
      if (selection && !options.explicitBrowserFallback) throw failure;
      return engine.browserEngine.startSystemAudioProduction(...args);
    });
}

export function stopSystemAudioProduction(engine, args = []) {
  const nativeCaptureActive =
    engine._usesNativeCapture("nativeScreenAudio") ||
    engine.activeSystemAudioCapture !== null;
  if (nativeCaptureActive) {
    return (async () => {
      let failure = null;
      try {
        await engine._removeNativeSource("screen-audio");
      } catch (error) {
        failure = error;
      }
      try {
        await engine._invoke("media_stop_system_audio", {
          source: engine.activeSystemAudioCapture?.source || null,
        });
      } catch (error) {
        failure ||= error;
      } finally {
        engine.activeSystemAudioCapture = null;
      }
      if (!failure) return;
      if (engine.nativeOnly) throw failure;
      await engine.browserEngine
        .stopSystemAudioProduction(...args)
        .finally(() =>
          engine._emit("error", {
            source: "native",
            operation: "system-audio-stop",
            error: nativeCaptureFailure(failure, {
              operation: "system-audio-stop",
            }),
          }),
        );
    })();
  }
  if (engine.nativeOnly) throw nativeOnlyError("system audio production stop");
  return engine.browserEngine.stopSystemAudioProduction(...args);
}
