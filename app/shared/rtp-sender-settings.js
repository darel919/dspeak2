export async function applyRtpSenderSettings(sender, options = {}) {
  if (!sender?.getParameters || !sender?.setParameters) return false;
  const parameters = sender.getParameters();
  parameters.encodings = parameters.encodings?.length
    ? parameters.encodings
    : [{}];
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
  if (options.dtx != null) encoding.dtx = options.dtx;
  if (options.degradationPreference)
    parameters.degradationPreference = options.degradationPreference;

  await sender.setParameters(parameters);
  return true;
}
