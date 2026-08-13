import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  assertDesktopCaptureMode,
  desktopCaptureRequest,
  nativeCaptureFailure,
} from "../../shared/desktop-capture.ts";
import {
  canAttemptNativeCapture,
  nativeOnlyError,
} from "./native-media-engine-common.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import type {
  NativeCaptureRequest,
  NativeErrorLike,
} from "../../shared/types/native-media.ts";

export function startSystemAudioProduction(
  engine: NativeMediaEngine,
  args: unknown[] = [],
) {
  const options = (args[0] as NativeCaptureRequest | undefined) || {};
  const selection =
    (options.captureSelection as NativeCaptureRequest | undefined) || null;
  if (selection)
    assertDesktopCaptureMode(selection, ["audio", "both"], "system-audio");
  if (engine.activeScreenCapture?.mode === "both")
    return Promise.reject(
      new DesktopCaptureError(
        "System audio is already owned by the active screen-share capture.",
        {
          code: DESKTOP_CAPTURE_ERROR_CODES.SOURCE_CONFLICT,
          operation: "system-audio",
        },
      ),
    );
  if (options.explicitBrowserFallback && !selection) {
    if (engine.nativeOnly)
      throw nativeOnlyError("browser system audio fallback");
    return engine.browserEngine.startSystemAudioProduction(...args);
  }
  const request = selection
    ? desktopCaptureRequest(selection, {
        operation: "system-audio",
        roomBitrateBps:
          typeof options.roomBitrateBps === "number"
            ? options.roomBitrateBps
            : undefined,
      })
    : options;
  const nativeCaptureAttemptable =
    engine._usesNativeCapture("nativeScreenAudio") ||
    (canAttemptNativeCapture(engine.flags) &&
      (engine.nativeOnly || Boolean(selection)));
  if (!nativeCaptureAttemptable) {
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
  let nativeCaptureStarted = false;
  return replaceActiveCapture
    .then(() => engine._invoke("media_start_system_audio", { request }))
    .then(async (result: unknown) => {
      nativeCaptureStarted = true;
      engine.activeSystemAudioCapture = selection || {};
      const sourceCaptureSelection =
        (request.captureSelection as NativeCaptureRequest | null | undefined) ||
        selection;
      const entry = {
        source: "screen-audio",
        track: { kind: "audio" },
        captureSelection: sourceCaptureSelection,
        audioBitrate: engine.getAudioBitrate?.("screen-audio"),
        audioStereo: engine.getAudioStereo?.("screen-audio"),
      };
      const producer = await engine.nativeSession?.addSource(entry);
      await engine.nativeP2pSession?.addSource(entry);
      engine._startNativeAudioTelemetry();
      await engine.setSharedAudioVolume?.(
        engine.settingsStore?.sharedAudioVolume ?? 100,
      );
      return producer || result;
    })
    .catch(async (error: unknown) => {
      if (nativeCaptureStarted || engine.activeSystemAudioCapture !== null)
        await engine
          ._invoke("media_stop_system_audio", {
            source: selection?.source || null,
          })
          .catch(() => {});
      await engine._removeNativeSource("screen-audio").catch(() => {});
      engine.activeSystemAudioCapture = null;
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

export function stopSystemAudioProduction(
  engine: NativeMediaEngine,
  args: unknown[] = [],
) {
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
      await Promise.resolve(
        engine.browserEngine.stopSystemAudioProduction(...args),
      ).finally(() =>
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
