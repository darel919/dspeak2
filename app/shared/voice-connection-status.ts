const VOICE_CONNECTION_STEPS = Object.freeze([
  { key: "control", label: "Media control" },
  { key: "signaling", label: "RTC signaling" },
  { key: "route", label: "Media route" },
  { key: "transport", label: "RTC transport" },
  { key: "media", label: "Media readiness" },
]);

type VoiceConnectionStepState = "complete" | "current" | "pending";
type VoiceConnectionStatusBase = {
  key: string;
  label: string;
  detail: string;
  icon: string;
  stepIndex: number;
};
type VoiceConnectionStatus = VoiceConnectionStatusBase & {
  steps: Array<{
    key: string;
    label: string;
    state: VoiceConnectionStepState;
  }>;
};
type VoiceConnectionStatusOptions = {
  activeProvider?: string | null;
  connected?: boolean;
  connecting?: boolean;
  mediaState?: string;
  phase?: string;
  topologyMode?: string;
};

function withSteps(status: VoiceConnectionStatusBase): VoiceConnectionStatus {
  return {
    ...status,
    steps: VOICE_CONNECTION_STEPS.map((step, index) => ({
      ...step,
      state:
        index < status.stepIndex
          ? "complete"
          : index === status.stepIndex
            ? "current"
            : "pending",
    })),
  };
}

export function getVoiceConnectionStatus({
  activeProvider = null,
  connected = false,
  connecting = false,
  mediaState = "",
  phase = "",
  topologyMode = "",
}: VoiceConnectionStatusOptions = {}): VoiceConnectionStatus {
  if (
    phase === "failed" ||
    mediaState === "failed" ||
    (mediaState === "disconnected" && !connecting && !connected)
  )
    return withSteps({
      key: "failed",
      label: "Connection issue",
      detail: "Voice media could not finish connecting.",
      icon: "lucide:triangle-alert",
      stepIndex: 3,
    });

  if (phase === "playback-blocked" || mediaState === "playback-blocked")
    return withSteps({
      key: "playback",
      label: "Audio playback blocked",
      detail:
        "The connection is ready, but the browser needs audio playback permission.",
      icon: "lucide:volume-x",
      stepIndex: 4,
    });

  if (phase === "reconnecting" || mediaState === "reconnecting")
    return withSteps({
      key: "reconnecting",
      label: "Reconnecting RTC",
      detail: "The media path was interrupted and is being restored.",
      icon: "lucide:refresh-cw",
      stepIndex: 3,
    });

  if (phase === "transport-connecting" || mediaState === "transport-connecting")
    return withSteps({
      key: "transport",
      label: "Connecting RTC transport",
      detail: "Establishing the WebRTC transport with the selected route.",
      icon: "lucide:radio-tower",
      stepIndex: 3,
    });

  if (phase === "media-ready" || mediaState === "ready-no-active-media")
    return withSteps({
      key: "media",
      label:
        connected && !connecting ? "Connected" : "Checking media readiness",
      detail: "Waiting for the audio and video path to become usable.",
      icon: "lucide:audio-lines",
      stepIndex: 4,
    });

  if (phase === "topology-probing" || topologyMode === "probing")
    return withSteps({
      key: "route",
      label: "Testing RTC route",
      detail: "Checking whether a direct media path can be used.",
      icon: "lucide:route",
      stepIndex: 2,
    });

  if (phase === "topology-selecting" || topologyMode === "switching")
    return withSteps({
      key: "route",
      label: "Selecting media route",
      detail: "Choosing direct P2P, TURN, or an SFU route.",
      icon: "lucide:route",
      stepIndex: 2,
    });

  if (phase === "signaling-ready")
    return withSteps({
      key: "route",
      label: "Waiting for media route",
      detail:
        "The control connection is ready; waiting for the route decision.",
      icon: "lucide:route",
      stepIndex: 2,
    });

  if (phase === "protocol-negotiating")
    return withSteps({
      key: "signaling",
      label: "RTC signaling",
      detail: "Authenticating the real-time media session.",
      icon: "lucide:messages-square",
      stepIndex: 1,
    });

  if (phase === "socket-connecting")
    return withSteps({
      key: "control",
      label: "Connecting to media control",
      detail: "Opening the voice control connection.",
      icon: "lucide:radio",
      stepIndex: 0,
    });

  if (activeProvider || topologyMode === "sfu" || topologyMode === "p2p")
    return withSteps({
      key: "transport",
      label: "Connecting RTC transport",
      detail: "Preparing the selected media provider.",
      icon: "lucide:radio-tower",
      stepIndex: 3,
    });

  return withSteps({
    key: "control",
    label: connecting ? "Waiting for media control" : "Voice disconnected",
    detail: connecting
      ? "Preparing the voice session."
      : "Join a voice channel to start a media session.",
    icon: connecting ? "lucide:loader-circle" : "lucide:volume-x",
    stepIndex: 0,
  });
}

export { VOICE_CONNECTION_STEPS };
