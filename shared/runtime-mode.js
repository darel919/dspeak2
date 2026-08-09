function isServerlessEnvironment() {
  if (process.env.DSPEAK_FORCE_SERVERLESS === "true") return true;
  if (process.env.DSPEAK_FORCE_PERSISTENT === "true") return false;
  if (process.env.VERCEL === "1") return true;
  if (process.env.NITRO_PRESET === "vercel") return true;
  return false;
}

function isPersistentEnvironment() {
  return !isServerlessEnvironment();
}

export { isServerlessEnvironment, isPersistentEnvironment };
