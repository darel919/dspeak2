import { NativeP2pMesh } from "../../app/shared/native-p2p.ts";
import { applyBrowserReceiverLatencyPolicy } from "../../app/shared/web-rtc-receiver-latency.ts";
import { applyBrowserSenderLatencyPolicy } from "../../app/shared/web-rtc-sender-policy.ts";
import { getWebRtcLatencyEvents } from "../../app/shared/web-rtc-latency-diagnostics.ts";
import type {
  BrowserMediaTuningContext,
  WebRtcLatencyProfile,
} from "../../app/shared/types/web-rtc-latency.ts";

type WebRtcLatencyDiagnosticSnapshot = Awaited<
  ReturnType<typeof getWebRtcLatencyEvents>
>;

type SmokeWindow = Window &
  typeof globalThis & {
    NativeP2pMesh: typeof NativeP2pMesh;
    webRtcLatencyTestHooks: {
      applyReceiverPolicy: (
        receiver: RTCRtpReceiver,
        context: BrowserMediaTuningContext,
      ) => ReturnType<typeof applyBrowserReceiverLatencyPolicy>;
      applySenderPolicy: (
        sender: RTCRtpSender,
        context: BrowserMediaTuningContext,
      ) => Promise<Awaited<ReturnType<typeof applyBrowserSenderLatencyPolicy>>>;
      latencyEvents: () => WebRtcLatencyDiagnosticSnapshot;
      tuningContext: (
        profile: WebRtcLatencyProfile,
      ) => BrowserMediaTuningContext;
    };
  };

/* SAFETY: This smoke entry runs inside a page that only this script populates; the window surface is owned here. */
const smokeWindow = window as SmokeWindow;
smokeWindow.NativeP2pMesh = NativeP2pMesh;
smokeWindow.webRtcLatencyTestHooks = {
  applyReceiverPolicy: (receiver, context) =>
    applyBrowserReceiverLatencyPolicy(receiver, context),
  applySenderPolicy: (sender, context) =>
    applyBrowserSenderLatencyPolicy(sender, context),
  latencyEvents: () => getWebRtcLatencyEvents(),
  tuningContext: (profile) => ({
    profile,
    qualityPriority: "framerate",
    configuredFrameRate: 30,
    configuredWidth: null,
    configuredHeight: null,
  }),
};
