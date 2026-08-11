export async function applyRtpSenderSettings(sender, options = {} as any) {
  if (!sender?.getParameters || !sender?.setParameters) return false;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return false;
  const requested = options.encodings?.[0] || {};
  const encoding = parameters.encodings[0];

  for (const key of [
    "maxBitrate",
    "maxFramerate",
    "priority",
    "networkPriority",
    "scaleResolutionDownBy",
  ]) {
    if (requested[key] != null) encoding[key] = requested[key];
  }
  if (options.degradationPreference)
    parameters.degradationPreference = options.degradationPreference;

  try {
    await sender.setParameters(parameters);
  } catch (error) {
    if (
      [
        "InvalidModificationError",
        "InvalidAccessError",
        "NotSupportedError",
      ].includes(error?.name)
    )
      return false;
    throw error;
  }
  return true;
}
