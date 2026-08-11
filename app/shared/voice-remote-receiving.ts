export async function updateRemoteReceiving({
  session,
  method,
  feedKey,
  receiving,
  fallbackMessage,
  onError,
}) {
  try {
    return Boolean(await session?.[method]?.(feedKey, receiving));
  } catch (error) {
    onError?.(error?.message || fallbackMessage);
    return false;
  }
}

export function createRemoteReceivingHandlers({ getSession, onError }) {
  const createHandler = (method, fallbackMessage) => (feedKey, receiving) =>
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
