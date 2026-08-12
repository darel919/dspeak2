const ACTIVE_SAMPLES_REQUIRED = 10;
const QUIET_SAMPLES_RESET = 8;
const COOLDOWN_MS = 30_000;

export function createEchoDetector({
  onDetected,
}: {
  onDetected: (detected: boolean) => void;
}) {
  let activeSamples = 0;
  let quietSamples = 0;
  let reported = false;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  function resetSamples() {
    activeSamples = 0;
    quietSamples = 0;
  }

  function sample({
    active,
    echoCancellation,
    remoteSpeaking,
  }: {
    active: boolean;
    echoCancellation: boolean;
    remoteSpeaking: boolean;
  }) {
    if (echoCancellation || !remoteSpeaking) {
      resetSamples();
      return;
    }
    if (!active) {
      activeSamples = 0;
      if (++quietSamples >= QUIET_SAMPLES_RESET) resetSamples();
      return;
    }
    quietSamples = 0;
    activeSamples += 1;
    if (reported || activeSamples < ACTIVE_SAMPLES_REQUIRED) return;
    reported = true;
    onDetected(true);
    cooldownTimer = setTimeout(() => {
      onDetected(false);
      reported = false;
      cooldownTimer = null;
      resetSamples();
    }, COOLDOWN_MS);
  }

  function clear() {
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = null;
    reported = false;
    onDetected(false);
    resetSamples();
  }

  return { clear, sample };
}
