import type {
  RemoteReceivingHandlersOptions,
  RemoteReceivingMethod,
  RemoteReceivingOptions,
} from "./types/voice-remote-receiving.ts";

export async function updateRemoteReceiving({
  session,
  method,
  feedKey,
  receiving,
  fallbackMessage,
  onError,
}: RemoteReceivingOptions) {
  try {
    const update =
      method === "setRemoteScreenReceiving"
        ? session?.setRemoteScreenReceiving
        : session?.setRemoteSystemAudioReceiving;
    return Boolean(await update?.(feedKey, receiving));
  } catch (error) {
    onError?.(error instanceof Error ? error.message : fallbackMessage);
    return false;
  }
}

export function createRemoteReceivingHandlers({
  getSession,
  onError,
}: RemoteReceivingHandlersOptions) {
  const createHandler =
    (method: RemoteReceivingMethod, fallbackMessage: string) =>
    (feedKey: string, receiving: boolean) =>
      updateRemoteReceiving({
        session: getSession(),
        method,
        feedKey,
        receiving,
        fallbackMessage,
        onError,
      });

  return {
    setRemoteScreenReceiving: createHandler(
      "setRemoteScreenReceiving",
      "Unable to update screen playback",
    ),
    setRemoteSystemAudioReceiving: createHandler(
      "setRemoteSystemAudioReceiving",
      "Unable to update shared audio playback",
    ),
  };
}
