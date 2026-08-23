import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
} from "./media-signaling-socket.ts";
import { MediasoupProviderSocket } from "./mediasoup-provider-socket.ts";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.ts";
import { asError } from "./native-mediasoup-utils.ts";
import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";
import type { NativeTransportEntry } from "./types/native-mediasoup-session.ts";
import {
  isExternalRecord,
  isExternalString,
  type ExternalObject,
  type ExternalValue,
} from "./types/boundary.ts";

export function connect(session: NativeMediasoupSfuSession, channelId: string) {
  if (!channelId) throw new Error("Channel ID is required");
  if (
    session.connected &&
    session.channelId === channelId &&
    session.readyPromise
  )
    return session.readyPromise;
  session.channelId = channelId;
  session.closed = false;
  session.intentionalClose = false;
  session.error = null;
  session.connectionPhase = "socket-connecting";
  session.connectPromise = new Promise((resolve, reject) => {
    session.connectResolve = resolve;
    session.connectReject = reject;
  });
  createSignaling(session);
  const signaling = session.signaling;
  if (!signaling) throw new Error("Media signaling socket was not created");
  return signaling.open().then(() => session.connectPromise);
}

export function configureControl(
  session: NativeMediasoupSfuSession,
  config: Record<string, unknown> = {},
) {
  const endpoint = String(
    config.websocketUrl ||
      config.controlWebsocketUrl ||
      config.mediaControlUrl ||
      "",
  );
  const channelId = String(config.channelId || session.channelId || "");
  if (!endpoint) throw new Error("Media control websocket URL is missing");
  session.buildUrl = () => {
    const url = new URL(
      endpoint,
      globalThis.window?.location?.href || "http://localhost",
    );
    if (channelId) url.searchParams.set("channelId", channelId);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    return url.toString();
  };
  session.controlTicket = String(config.ticket || "");
  session.mediaSessionId = String(config.mediaSessionId || "");
  const refreshControl = config.refreshControl;
  if (refreshControl instanceof Function)
    session.refreshControl = () => Promise.resolve(refreshControl());
}

export async function handleProviderTicket(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  const route = isExternalRecord(data.route) ? data.route : {};
  const sourceRevision = Number(data?.sourceRevision ?? route.sourceRevision);
  const epoch = Number(data?.epoch ?? route.epoch);
  const currentEpoch = Number(session.topologyState?.epoch);
  const currentSourceRevision = Number(session.topologyState?.sourceRevision);
  const resolvedSourceRevision = Number.isFinite(sourceRevision)
    ? sourceRevision
    : Number.isFinite(currentSourceRevision)
      ? currentSourceRevision
      : 0;
  if (
    !Number.isSafeInteger(epoch) ||
    (Number.isSafeInteger(currentEpoch) && epoch < currentEpoch) ||
    (Number.isSafeInteger(currentSourceRevision) &&
      resolvedSourceRevision < currentSourceRevision)
  )
    return false;
  const providerId =
    isExternalString(data.providerId) && data.providerId.trim()
      ? data.providerId.trim()
      : isExternalString(route.providerId) && route.providerId.trim()
        ? route.providerId.trim()
        : null;
  const provider = String(data.provider || "mediasoup");
  session.selectedProvider = provider;
  session.selectedProviderId = providerId;
  const routeAttemptId = isExternalString(route.attemptId)
    ? route.attemptId
    : isExternalString(data.attemptId)
      ? data.attemptId
      : null;
  let providerFailureNotified = false;
  const notifyProviderFailure = (error: Error | string | null | undefined) => {
    if (providerFailureNotified) return;
    providerFailureNotified = true;
    const failure: ExternalObject = {
      provider,
      epoch,
      sourceRevision: resolvedSourceRevision,
      reason: asError(error, "Provider connection failed").message,
    };
    if (providerId) failure.providerId = providerId;
    if (routeAttemptId) failure.attemptId = routeAttemptId;
    session.signaling?.send?.({
      type: "provider-failure",
      data: failure,
    });
  };
  if (provider === "cloudflare-realtime") {
    try {
      await session.activateProvider("cloudflare-realtime");
      if (
        session.signaling?.send?.({
          type: "provider-ready",
          data: {
            provider,
            epoch,
            sourceRevision: resolvedSourceRevision,
          },
        }) === false
      )
        throw new Error("Media control signaling unavailable");
    } catch (error) {
      notifyProviderFailure(
        asError(error, "Cloudflare provider activation failed"),
      );
      throw error;
    }
    return;
  }
  try {
    session.providerSignaling?.close();
    session.providerSignaling = new MediasoupProviderSocket({
      onMessage: (type, payload) =>
        session.messageHandlers.get(type)?.(payload || {}),
      onFailure: (error) => {
        notifyProviderFailure(error);
        session._fail(error);
      },
    });
    const providerSignaling = session.providerSignaling;
    if (!providerSignaling) throw new Error("Provider signaling unavailable");
    await providerSignaling.connect({
      signalingUrl: String(data.signalingUrl || ""),
      ticket: String(data.ticket || ""),
      mediaCapabilities: session.mediaCapabilities,
      capabilityProtocol: "video-codec-matrix-v1",
    });
    await session._startNegotiation();
    session.activeSfuProvider = "mediasoup";
    session.activeSfuProviderId = providerId;
    if (
      session.signaling?.send?.({
        type: "provider-ready",
        data: (() => {
          const ready: ExternalObject = {
            provider,
            epoch,
            sourceRevision: resolvedSourceRevision,
          };
          if (providerId) ready.providerId = providerId;
          if (routeAttemptId) ready.attemptId = routeAttemptId;
          return ready;
        })(),
      }) === false
    )
      throw new Error("Media control signaling unavailable");
  } catch (error) {
    notifyProviderFailure(
      asError(error, "Mediasoup provider activation failed"),
    );
    throw error;
  }
}

export function createSignaling(session: NativeMediasoupSfuSession) {
  session.signaling?.stop?.();
  const connectionEpoch = session.getControlConnectionEpoch?.() || 1;
  session.signaling = createMediaSignalingSocket({
    buildHeartbeatData: (sequence) => ({
      sequence,
      connectionEpoch,
      topologyEpoch: Number(session.topologyState?.epoch) || 0,
      sourceRevision: Number(session.topologyState?.sourceRevision) || 0,
      publicationRevision: "0",
      lastAppliedRoomRevision: "0",
      localSourceDigest: Object.fromEntries(session.sourceStates),
    }),
    buildUrl: () => session.buildUrl(session.channelId),
    buildClientHelloData: () => ({
      protocolVersion: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
      contractRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.contractRevision,
      mediaSessionId: session.mediaSessionId,
      connectionEpoch,
      lastAppliedRoomRevision: "0",
      providerCapabilities: ["cloudflare-realtime", "mediasoup"],
      mediaCapabilities: session.mediaCapabilities,
      capabilityProtocol: "video-codec-matrix-v1",
      ticket: session.controlTicket,
    }),
    connectionTimeoutMs: session.requestTimeoutMs,
    defaultHeartbeatIntervalMs: 5000,
    defaultHeartbeatTimeoutMs: 15000,
    handleMessage: (raw) =>
      dispatchMediaSignalingMessage(raw, {
        getHandler: (type) => {
          const handler = session.messageHandlers.get(type);
          if (!handler) return undefined;
          return (data: ExternalValue) => {
            if (!isExternalRecord(data)) return;
            return handler(data);
          };
        },
        onFailure: (error) => session._fail(asError(error, "Signaling failed")),
      }),
    isIntentionalClose: () => session.intentionalClose,
    onClose: (event) => session._handleSignalingClose(event),
    onError: (error) => session._fail(error),
    onOpen: () => {
      session.connectionPhase = "protocol-negotiating";
      session._emitState();
    },
    onProtocolRejected: (event) => {
      const error = Object.assign(
        new Error(event.reason || "Media client update required"),
        { code: "MEDIA_PROTOCOL_UPDATE_REQUIRED" },
      );
      session._fail(error);
    },
    onReconnect: async () => {
      await session.refreshControl?.();
      session.connectionPhase = "reconnecting";
      session._emitState();
    },
    protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
    reconnectBaseDelayMs: 500,
    reconnectJitterMs: 250,
    reconnectMaxDelayMs: 10000,
  });
}

export function resolveConnect(session: NativeMediasoupSfuSession) {
  session.connectResolve?.();
  session.connectResolve = null;
  session.connectReject = null;
}

export async function startNegotiation(session: NativeMediasoupSfuSession) {
  if (session.readyPromise) return session.readyPromise;
  await session.nativeTeardownPromise;
  session.connectionPhase = "transport-connecting";
  session.readyPromise = new Promise((resolve, reject) => {
    session.readyResolve = resolve;
    session.readyReject = reject;
  });
  session.initializationTimer = setTimeout(() => {
    const error = new Error("SFU initialization timed out");
    session.rejectReadiness(asError(error, "SFU initialization failed"));
    session._fail(error);
  }, session.initializationTimeoutMs);
  session.initializationTimer.unref?.();
  session.initializationRequestId = session.requestId("initialize");
  try {
    session.sendOrThrow(
      {
        type: "get-rtp-capabilities",
        data: { requestId: session.initializationRequestId },
      },
      "SFU initialization",
    );
  } catch (error) {
    session.rejectReadiness(
      asError(error, "SFU capability negotiation failed"),
    );
    throw error;
  }
  return session.readyPromise;
}

export async function handleRtpCapabilities(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  if (data.requestId !== session.initializationRequestId) return false;
  const mediaRevision = session.mediaRevision;
  const routerCapabilities = { ...data };
  delete routerCapabilities.requestId;
  const deviceResult = await session.invoke("media_create_device", {
    routerRtpCapabilities: JSON.stringify(routerCapabilities),
  });
  if (
    session.closed ||
    mediaRevision !== session.mediaRevision ||
    data.requestId !== session.initializationRequestId
  )
    return false;
  const rtpCapabilities = isExternalRecord(deviceResult.rtpCapabilities)
    ? deviceResult.rtpCapabilities
    : null;
  if (!deviceResult?.handle || !rtpCapabilities)
    throw new Error("Native device negotiation returned no capabilities");
  const device = {
    handle: String(deviceResult.handle),
    rtpCapabilities,
  };
  session.device = device;
  session.lastSentClientRtpCapabilities = device.rtpCapabilities;
  session.scheduleCodecRoutingEvaluation();
  try {
    session.sendOrThrow(
      {
        type: "client-rtp-capabilities",
        data: { rtpCapabilities: device.rtpCapabilities },
      },
      "SFU capability negotiation",
    );
    for (const direction of ["send", "recv"] as const) {
      const requestId = session.requestId(`create-${direction}`);
      session.transportRequestIds.set(direction, requestId);
      session.sendOrThrow(
        {
          type: "create-transport",
          data: {
            type: direction,
            requestId,
            mediaProfile: direction === "recv" ? "mixed" : session.mediaProfile,
          },
        },
        `SFU ${direction} transport creation`,
      );
    }
  } catch (error) {
    session.rejectReadiness(asError(error, "SFU transport creation failed"));
    throw error;
  }
  return true;
}

export async function handleTransportParams(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  const direction = data.direction;
  if (direction !== "send" && direction !== "recv") return false;
  if (session.transportRequestIds.get(direction) !== data.requestId)
    return false;
  const mediaRevision = session.mediaRevision;
  session.transportRequestIds.delete(direction);
  const device = session.device;
  if (!device) throw new Error("Native media device is unavailable");
  const result = await session.invoke(
    direction === "send"
      ? "media_create_send_transport"
      : "media_create_recv_transport",
    {
      deviceHandle: device.handle,
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters,
      appData: { direction },
    },
  );
  if (session.closed || mediaRevision !== session.mediaRevision) return false;
  if (!result?.handle)
    throw new Error(`Native ${direction} transport was not created`);
  const transport: NativeTransportEntry = {
    ...data,
    id: String(data.id || ""),
    handle: String(result.handle),
    direction,
    closed: false,
  };
  if (direction === "send") session.sendTransport = transport;
  else session.recvTransport = transport;
  session.transportStates.set(direction, "new");
  if (session.sendTransport && session.recvTransport) {
    if (session.initializationTimer) clearTimeout(session.initializationTimer);
    session.initializationTimer = null;
    session.readyResolve?.();
    session.readyResolve = null;
    session.readyReject = null;
    session.connectionPhase = "media-ready";
    session.mediaConnectionState = "ready-no-active-media";
    session._emitState();
    await session._republishSources();
    session.scheduleCodecRoutingEvaluation();
    for (const producerId of new Set([
      ...session.pendingConsumers,
      ...session.requestedConsumers,
    ]))
      session.requestConsumer(producerId);
  }
  return true;
}
