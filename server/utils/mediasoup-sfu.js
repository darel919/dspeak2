import * as mediasoup from "mediasoup";
import { usePocketBaseAdmin } from "./pocketbase";
import {
  buildPublicIceCandidates,
  buildWebRtcListenInfos,
} from "./ice-candidates";
import { mediaCodecs } from "./mediasoup-codecs";
import {
  assertTransportDirection,
  buildConsumerOptions,
  buildWebRtcTransportOptions,
  calculateSfuClientOutgoingBitrate,
  findTransportByDirection,
  validateProducer,
} from "./mediasoup-transport";
import {
  createRoomTopology,
  ensureRoomTopology,
  RoomTopologyCoordinator,
  roomTopologyPayload,
  supersededMediaSessions,
} from "./room-topology";
import {
  acquireSharedRoom,
  isRoomUnused,
  releaseRoomReservation,
} from "./room-lifecycle";
import { validP2pSignal } from "./p2p-signal";
import { relayMediaAttenuationState } from "./media-attenuation-state";
import { publicDisplayName } from "../../shared/user-profile.js";
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";
import {
  isMediaSignalHeartbeatExpired,
  isValidMediaSignalHeartbeat,
  MEDIA_SIGNAL_HEARTBEAT_SWEEP_MS,
} from "./media-heartbeat";
import { normalizeParticipantVoiceState } from "~~/shared/participant-voice-state.js";
import { requireRoomMember } from "./room-authorization.js";
import { enforceIdentifierRateLimit } from "./rate-limit.js";
import { publishVoicePresence } from "./voice-presence";
import { authenticateWebSocketRequest } from "./authentication";
import {
  consumeSignalingToken,
  createSignalingBudget,
  mediaSignalingLimits,
  parseSignalingMessage,
} from "./media-signaling-policy.js";
import {
  createMediaUserState,
  persistMediaPresence,
  persistParticipantVoiceState,
  removeMediaUserState,
} from "./media-user-state.js";
import { collectSfuMetrics } from "./mediasoup-metrics.js";
import { closeMediaPeer } from "./media-peer.js";
const stateKey = Symbol.for("dspeak.mediasoup.sfu");
function send(peer, type, data) {
  try {
    peer.send(JSON.stringify({ type, data }));
    return true;
  } catch (error) {
    console.warn(
      `[SFU] failed to send ${type} to peer ${peer?.id || "unknown"}: ${serializeError(error)}`,
    );
    return false;
  }
}
async function publicTransportData(transport, config) {
  return {
    id: transport.id,
    direction: transport.appData.direction,
    iceParameters: transport.iceParameters,
    iceCandidates: await buildPublicIceCandidates(
      transport.iceCandidates,
      config,
    ),
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters,
  };
}
function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function mediaUserProfile(user) {
  const id = String(user.id);
  return {
    id,
    name: publicDisplayName(user),
    username: user.username || "",
    handle: user.handle || "",
    display_name: user.display_name || "",
    avatar: sameOriginAvatarPath({ id, avatar: user.avatar }),
  };
}

async function createState(config) {
  const worker = await mediasoup.createWorker({
    logLevel: process.env.NODE_ENV === "production" ? "warn" : "debug",
  });

  let webRtcServer;
  try {
    webRtcServer = await worker.createWebRtcServer({
      listenInfos: buildWebRtcListenInfos(config),
    });
  } catch (error) {
    worker.close();
    throw error;
  }

  const state = {
    worker,
    webRtcServer,
    rooms: new Map(),
    roomCreations: new Map(),
    sessions: new Map(),
    config,
    heartbeatTimer: null,
    bandwidthRebalance: Promise.resolve(),
  };

  state.heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const session of [...state.sessions.values()]) {
      if (!isMediaSignalHeartbeatExpired(session.lastHeartbeatAt, now))
        continue;
      console.warn(
        `[SFU] removing peer ${session.peer.id}: signaling heartbeat timed out`,
      );
      closeSession(state, session);
      closeMediaPeer(session.peer, 4000, "Signaling heartbeat timed out");
    }
  }, MEDIA_SIGNAL_HEARTBEAT_SWEEP_MS);
  state.heartbeatTimer.unref?.();

  worker.on("died", (error) => {
    console.error("[SFU] mediasoup worker died", error);
    for (const session of state.sessions.values()) {
      send(session.peer, "server-shutdown", { reason: "media worker stopped" });
      closeMediaPeer(session.peer, 1011, "Media worker stopped");
    }
    state.sessions.clear();
    state.rooms.clear();
    state.roomCreations.clear();
    clearInterval(state.heartbeatTimer);
    delete globalThis[stateKey];
  });

  return state;
}

async function getState(resolvedConfig) {
  const runtimeConfig = useRuntimeConfig().mediasoup;
  const config = resolvedConfig || {
    listenIp: process.env.MEDIASOUP_LISTEN_IP || runtimeConfig.listenIp,
    announcedAddress:
      process.env.MEDIASOUP_ANNOUNCED_ADDRESS || runtimeConfig.announcedAddress,
    rtcPort: Number(process.env.MEDIASOUP_RTC_PORT || runtimeConfig.rtcPort),
    announcedPort: Number(
      process.env.MEDIASOUP_ANNOUNCED_PORT ||
        runtimeConfig.announcedPort ||
        runtimeConfig.rtcPort,
    ),
    directAddress:
      process.env.MEDIASOUP_DIRECT_ADDRESS || runtimeConfig.directAddress,
    directPort: Number(
      process.env.MEDIASOUP_DIRECT_PORT ||
        runtimeConfig.directPort ||
        runtimeConfig.rtcPort,
    ),
    maxClientOutgoingBitrate: Number(
      process.env.MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE ||
        runtimeConfig.maxClientOutgoingBitrate ||
        4_500_000,
    ),
    maxServerOutgoingBitrate: Number(
      process.env.MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE ||
        runtimeConfig.maxServerOutgoingBitrate ||
        40_000_000,
    ),
  };
  if (!globalThis[stateKey]) {
    globalThis[stateKey] = createState(config).catch((error) => {
      delete globalThis[stateKey];
      throw error;
    });
  }
  return globalThis[stateKey];
}

export async function initializeSfu(config) {
  return getState(config);
}

export async function closeSfu() {
  const statePromise = globalThis[stateKey];
  if (!statePromise) return;

  const state = await statePromise;
  for (const session of [...state.sessions.values()])
    closeSession(state, session);
  clearInterval(state.heartbeatTimer);
  state.worker.close();
  delete globalThis[stateKey];
}

async function acquireRoom(state, channelId) {
  const room = await acquireSharedRoom({
    rooms: state.rooms,
    creations: state.roomCreations,
    key: channelId,
    create: async () => ({
      id: channelId,
      router: await state.worker.createRouter({ mediaCodecs }),
      sessions: new Map(),
      topology: createRoomTopology(),
      pendingJoins: 0,
    }),
  });
  ensureRoomTopology(room.topology);
  return room;
}

function disposeRoomIfUnused(state, room) {
  if (!isRoomUnused(room) || state.rooms.get(room.id) !== room) return false;
  topologyCoordinator.clearTimers(room);
  room.router.close();
  state.rooms.delete(room.id);
  return true;
}

function broadcastTopology(room) {
  const data = roomTopologyPayload(room);
  for (const session of room.sessions.values())
    send(session.peer, "topology-state", data);
}

const topologyCoordinator = new RoomTopologyCoordinator({
  broadcast: broadcastTopology,
});

function producerSnapshot(room) {
  const producers = [];
  const producerUserMap = {};
  const producerSourceMap = {};

  for (const session of room.sessions.values()) {
    for (const producer of session.producers.values()) {
      producers.push(producer.id);
      producerUserMap[producer.id] = session.userId;
      producerSourceMap[producer.id] =
        producer.appData?.source || producer.kind;
    }
  }

  return { producers, producerUserMap, producerSourceMap };
}

function broadcastChannelState(room) {
  const snapshot = producerSnapshot(room);
  const data = {
    inRoom: [...room.sessions.values()].map((session) => session.userId),
    profiles: [...room.sessions.values()].map((session) => session.profile),
    participantStates: [...room.sessions.values()].map((session) => ({
      userId: session.userId,
      muted: session.muted,
      deafened: session.deafened,
      cameraEnabled: session.sources.has("camera"),
      screenSharing: session.sources.has("screen"),
    })),
    ...snapshot,
  };

  for (const session of room.sessions.values()) {
    send(session.peer, "currentlyInChannel", data);
    send(session.peer, "available-producers", {
      producers: snapshot.producers.filter((id) => !session.producers.has(id)),
      producerUserMap: snapshot.producerUserMap,
      producerSourceMap: snapshot.producerSourceMap,
    });
  }
  if (room.backendRoomId) {
    publishVoicePresence(room.backendRoomId, {
      channelId: room.id,
      inRoom: data.inRoom,
      profiles: data.profiles,
      participantStates: data.participantStates,
    });
  }
}

function closeSession(state, session) {
  if (!session || session.closed) return;
  session.closed = true;
  closeSessionMedia(state, session);
  session.room.sessions.delete(session.peer.id);
  state.sessions.delete(session.peer.id);
  broadcastChannelState(session.room);
  if (!disposeRoomIfUnused(state, session.room)) {
    topologyCoordinator.reconcile(session.room, "membership-changed");
  }

  persistMediaPresence(session.room).catch((error) =>
    console.error("[SFU] failed to persist presence", error),
  );
  const userStillConnected = [...session.room.sessions.values()].some(
    (candidate) => String(candidate.userId) === String(session.userId),
  );
  if (!userStillConnected) {
    removeMediaUserState(session.userId, session.room.id).catch((error) =>
      console.error("[SFU] failed to remove user state", error),
    );
  }
}

function closeSessionMedia(state, session) {
  for (const producer of session.producers.values()) producer.close();
  for (const consumer of session.consumers.values()) consumer.close();
  for (const transport of session.transports.values()) transport.close();
  session.producers.clear();
  session.consumers.clear();
  session.transports.clear();
  session.rtpCapabilities = null;
  queueSfuBandwidthRebalance(state);
}

function receiveTransports(state) {
  return [...state.sessions.values()]
    .flatMap((session) => [...session.transports.values()])
    .filter(
      (transport) =>
        !transport.closed && transport.appData?.direction === "recv",
    );
}

function queueSfuBandwidthRebalance(state) {
  state.bandwidthRebalance = state.bandwidthRebalance
    .catch(() => {})
    .then(async () => {
      const transports = receiveTransports(state);
      if (!transports.length) return;
      const bitrate = calculateSfuClientOutgoingBitrate(
        transports.length,
        state.config.maxClientOutgoingBitrate,
        state.config.maxServerOutgoingBitrate,
      );
      await Promise.all(
        transports.map((transport) => transport.setMaxOutgoingBitrate(bitrate)),
      );
    });
  state.bandwidthRebalance.catch((error) =>
    console.error("[SFU] failed to rebalance outgoing bandwidth", error),
  );
  return state.bandwidthRebalance;
}

async function createTransport(state, session, direction) {
  const transport = await session.room.router.createWebRtcTransport(
    buildWebRtcTransportOptions(state.webRtcServer, session.peer.id, direction),
  );

  session.transports.set(transport.id, transport);
  const removeTransport = () => {
    session.transports.delete(transport.id);
    queueSfuBandwidthRebalance(state);
  };
  transport.on("routerclose", removeTransport);
  transport.on("listenserverclose", removeTransport);
  transport.on("icestatechange", (iceState) => {
    console.info("[SFU] transport state", {
      direction,
      iceState,
      dtlsState: transport.dtlsState,
      selectedTuple: Boolean(transport.iceSelectedTuple),
    });
    send(session.peer, "transport-state", {
      direction,
      state: iceState,
      selectedTuple: Boolean(transport.iceSelectedTuple),
    });
    if (iceState === "closed") removeTransport();
  });
  transport.on("iceselectedtuplechange", (tuple) => {
    send(session.peer, "transport-state", {
      direction,
      state: transport.iceState,
      selectedTuple: Boolean(tuple),
    });
  });
  transport.on("dtlsstatechange", (dtlsState) => {
    console.info("[SFU] transport state", {
      direction,
      iceState: transport.iceState,
      dtlsState,
      selectedTuple: Boolean(transport.iceSelectedTuple),
    });
    send(session.peer, "transport-state", {
      direction,
      state: dtlsState === "connected" ? transport.iceState : dtlsState,
      dtlsState,
      selectedTuple: Boolean(transport.iceSelectedTuple),
    });
    if (dtlsState === "failed" || dtlsState === "closed") {
      removeTransport();
      if (!transport.closed) transport.close();
    }
  });
  if (direction === "recv") await queueSfuBandwidthRebalance(state);
  return transport;
}

async function handleMessage(state, session, message) {
  const { type, data = {} } = message || {};

  switch (type) {
    case "ping":
      send(session.peer, "pong", { timestamp: Date.now() });
      return;

    case "heartbeat": {
      if (!isValidMediaSignalHeartbeat(data)) return;
      const sequence = Number(data.sequence);
      const topology = roomTopologyPayload(session.room);
      const topologyMismatch =
        Number(data.topologyEpoch) !== session.room.topology.epoch ||
        Number(data.sourceRevision) !== session.room.topology.sourceRevision;
      if (topologyMismatch) {
        send(session.peer, "heartbeat-nack", {
          sequence,
          serverTime: Date.now(),
          topology,
        });
      } else {
        send(session.peer, "heartbeat-ack", {
          sequence,
          serverTime: Date.now(),
          topologyEpoch: session.room.topology.epoch,
          sourceRevision: session.room.topology.sourceRevision,
        });
      }
      return;
    }

    case "media-sources": {
      const allowed = new Set(["audio", "camera", "screen", "screen-audio"]);
      const sources = Array.isArray(data.sources)
        ? data.sources.map(String).filter((source) => allowed.has(source))
        : [];
      const previous = [...session.sources].sort().join(",");
      const next = [...sources].sort().join(",");
      if (previous === next) return;
      session.sources = new Set(sources);
      broadcastChannelState(session.room);
      topologyCoordinator.sourcesChanged(session.room);
      return;
    }

    case "participant-voice-state": {
      const voiceState = normalizeParticipantVoiceState(data);
      if (!voiceState) return;
      if (
        session.muted === voiceState.muted &&
        session.deafened === voiceState.deafened
      )
        return;
      session.muted = voiceState.muted;
      session.deafened = voiceState.deafened;
      broadcastChannelState(session.room);
      persistParticipantVoiceState(session).catch((error) =>
        console.error("[SFU] failed to persist participant voice state", error),
      );
      return;
    }

    case "attenuation-state":
      return relayMediaAttenuationState(session, data, send);

    case "p2p-signal": {
      const targetPeerId = String(data.targetPeerId || "");
      const target = session.room.sessions.get(targetPeerId);
      if (!target || target === session) return;
      if (Number(data.epoch) !== session.room.topology.epoch) return;
      const signal = data.signal;
      if (!validP2pSignal(signal)) return;
      send(target.peer, "p2p-signal", {
        fromPeerId: session.peer.id,
        epoch: session.room.topology.epoch,
        signal,
      });
      return;
    }

    case "p2p-ready": {
      topologyCoordinator.p2pReady(
        session.room,
        session.peer.id,
        data.qualifiedPeerIds,
        data.epoch,
      );
      return;
    }

    case "topology-ready": {
      topologyCoordinator.clientReady(session.room, session.peer.id, data);
      return;
    }

    case "topology-failed": {
      topologyCoordinator.clientFailed(session.room, data);
      return;
    }

    case "p2p-failed": {
      topologyCoordinator.p2pFailed(session.room, data.reason, data.epoch);
      return;
    }

    case "sfu-failed": {
      topologyCoordinator.sfuFailed(session.room, data.reason, data.epoch);
      return;
    }

    case "client-sfu-rtt": {
      const rttMs = Number(data.rttMs);
      if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 60000) return;
      for (const candidate of session.room.sessions.values()) {
        send(candidate.peer, "participant-sfu-rtt", {
          userId: session.userId,
          rttMs,
        });
      }
      return;
    }

    case "get-rtp-capabilities":
      send(
        session.peer,
        "rtp-capabilities",
        session.room.router.rtpCapabilities,
      );
      return;

    case "client-rtp-capabilities":
      session.rtpCapabilities = data.rtpCapabilities;
      send(session.peer, "rtp-capabilities-ack", { accepted: true });
      return;

    case "create-transport": {
      const direction = String(data.type || "");
      if (direction !== "send" && direction !== "recv")
        throw new Error("Transport direction must be send or recv");
      const transport =
        findTransportByDirection(session.transports, direction) ||
        (await createTransport(state, session, direction));
      send(
        session.peer,
        "transport-params",
        await publicTransportData(transport, state.config),
      );
      return;
    }

    case "connect-transport": {
      const transport = session.transports.get(data.transportId);
      if (!transport) throw new Error("Transport not found");
      await transport.connect({ dtlsParameters: data.dtlsParameters });
      send(session.peer, "transport-connected", {
        requestId: data.requestId,
        transportId: transport.id,
      });
      return;
    }

    case "restart-ice": {
      const transport = session.transports.get(data.transportId);
      if (!transport) throw new Error("Transport not found");
      const iceParameters = await transport.restartIce();
      send(session.peer, "ice-restarted", {
        requestId: data.requestId,
        transportId: transport.id,
        iceParameters,
      });
      return;
    }

    case "produce": {
      const transport = session.transports.get(data.transportId);
      if (!transport) throw new Error("Transport not found");
      assertTransportDirection(transport, "send", "Producing");
      const source = data.appData?.source || data.kind;
      validateProducer(session.producers, data.kind, source);

      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
        appData: {
          userId: session.userId,
          source,
        },
      });
      session.producers.set(producer.id, producer);

      producer.on("transportclose", () =>
        session.producers.delete(producer.id),
      );
      producer.on("close", () => session.producers.delete(producer.id));

      send(session.peer, "producer-id", {
        requestId: data.requestId,
        id: producer.id,
      });
      for (const other of session.room.sessions.values()) {
        if (other !== session) {
          send(other.peer, "new-producer", {
            producerId: producer.id,
            userId: session.userId,
            source: producer.appData.source,
          });
        }
      }
      broadcastChannelState(session.room);
      return;
    }

    case "close-producer": {
      const producer = session.producers.get(data.producerId);
      if (!producer) return;
      session.producers.delete(producer.id);
      producer.close();
      broadcastChannelState(session.room);
      return;
    }

    case "close-media":
      closeSessionMedia(state, session);
      broadcastChannelState(session.room);
      return;

    case "consume": {
      const transport = session.transports.get(data.transportId);
      if (!transport) throw new Error("Transport not found");
      assertTransportDirection(transport, "recv", "Consuming");
      const capabilities = data.rtpCapabilities || session.rtpCapabilities;
      if (!capabilities)
        throw new Error("Client RTP capabilities are required");
      if (
        !session.room.router.canConsume({
          producerId: data.producerId,
          rtpCapabilities: capabilities,
        })
      ) {
        throw new Error(
          "Cannot consume this producer with the supplied RTP capabilities",
        );
      }
      if (
        [...session.consumers.values()].some(
          (consumer) => consumer.producerId === data.producerId,
        )
      ) {
        throw new Error("Producer is already consumed by this peer");
      }

      const owner = [...session.room.sessions.values()].find((candidate) =>
        candidate.producers.has(data.producerId),
      );
      if (!owner) throw new Error("Producer not found in this channel");
      if (owner === session)
        throw new Error("A peer cannot consume its own producer");

      const consumer = await transport.consume(
        buildConsumerOptions(data.producerId, capabilities, owner.userId),
      );
      session.consumers.set(consumer.id, consumer);
      consumer.on("transportclose", () =>
        session.consumers.delete(consumer.id),
      );
      consumer.on("producerclose", () => {
        session.consumers.delete(consumer.id);
        send(session.peer, "producer-closed", { producerId: data.producerId });
      });

      send(session.peer, "consumer-params", {
        requestId: data.requestId,
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        userId: owner.userId,
        source:
          owner.producers.get(data.producerId)?.appData?.source ||
          consumer.kind,
        producerPaused: consumer.producerPaused,
      });
      return;
    }

    case "resume-consumer": {
      const consumer = session.consumers.get(data.consumerId);
      if (!consumer) throw new Error("Consumer not found");
      await consumer.resume();
      send(session.peer, "consumer-resumed", {
        requestId: data.requestId,
        revision: data.revision,
        consumerId: consumer.id,
        producerId: consumer.producerId,
      });
      return;
    }

    case "pause-consumer": {
      const consumer = session.consumers.get(data.consumerId);
      if (!consumer) throw new Error("Consumer not found");
      await consumer.pause();
      send(session.peer, "consumer-paused", {
        requestId: data.requestId,
        revision: data.revision,
        consumerId: consumer.id,
        producerId: consumer.producerId,
      });
      return;
    }

    default:
      throw new Error(`Unsupported message type: ${String(type)}`);
  }
}

export async function openSfuPeer(peer) {
  const url = new URL(peer.request.url);
  const channelId = url.searchParams.get("channelId");
  const authentication = await authenticateWebSocketRequest(peer.request);
  if (!authentication || !channelId) {
    peer.close(1008, "Authentication and channelId are required");
    return;
  }
  const { userId, deviceId } = authentication;
  enforceIdentifierRateLimit("sfu-websocket-open", userId, 30, 60 * 1000);

  const pb = await usePocketBaseAdmin();
  const channel = await pb
    .collection("dspeak_rooms_channels")
    .getOne(channelId);
  if (!channel.isMedia) {
    peer.close(1008, "Channel is not a media channel");
    return;
  }
  const backendRoom = await pb.collection("dspeak_rooms").getOne(channel.room);
  await requireRoomMember(pb, backendRoom, userId);
  const profile = mediaUserProfile(await pb.collection("users").getOne(userId));

  const state = await getState();
  const room = await acquireRoom(state, channelId);
  room.backendRoomId = String(channel.room);
  try {
    const supersededSessions = supersededMediaSessions(room, userId, deviceId);
    const session = {
      peer,
      userId,
      deviceId,
      profile,
      room,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      sources: new Set(),
      muted: true,
      deafened: false,
      rtpCapabilities: null,
      queue: Promise.resolve(),
      queueDepth: 0,
      ...createSignalingBudget(),
      closed: false,
      lastHeartbeatAt: Date.now(),
    };

    state.sessions.set(peer.id, session);
    room.sessions.set(peer.id, session);
    for (const superseded of supersededSessions) {
      closeSession(state, superseded);
      closeMediaPeer(superseded.peer, 4000, "Media session replaced");
    }
    send(peer, "connected", { userId, channelId, peerId: peer.id });
    broadcastChannelState(room);
    topologyCoordinator.reconcile(room, "membership-changed");
    const presenceResults = await Promise.allSettled([
      persistMediaPresence(room),
      createMediaUserState(session),
    ]);
    for (const result of presenceResults) {
      if (result.status === "rejected")
        console.error(
          "[SFU] failed to persist opened media session",
          result.reason,
        );
    }
    if (session.closed) {
      await persistMediaPresence(room).catch((error) =>
        console.error(
          "[SFU] failed to repair presence after concurrent close",
          error,
        ),
      );
      const userStillConnected = [...room.sessions.values()].some(
        (candidate) => String(candidate.userId) === String(userId),
      );
      if (!userStillConnected) {
        await removeMediaUserState(userId, channelId).catch((error) =>
          console.error(
            "[SFU] failed to repair user state after concurrent close",
            error,
          ),
        );
      }
    }
  } finally {
    releaseRoomReservation(room);
    disposeRoomIfUnused(state, room);
  }
}

export async function handleSfuPeerMessage(peer, rawMessage) {
  const state = await getState();
  const session = state.sessions.get(peer.id);
  if (!session) return;

  let message = null;
  try {
    message = parseSignalingMessage(rawMessage.text());
  } catch (error) {
    session.protocolViolations += 1;
    reportSignalingError(peer, message, error);
    if (session.protocolViolations >= 3)
      peer.close(1008, "Signaling protocol violation");
    return;
  }

  if (
    message?.type === "heartbeat" &&
    isValidMediaSignalHeartbeat(message.data)
  ) {
    session.lastHeartbeatAt = Date.now();
    await handleMessage(state, session, message).catch((error) =>
      reportSignalingError(peer, message, error),
    );
    return;
  }

  if (!consumeSignalingToken(session)) {
    session.protocolViolations += 1;
    reportSignalingError(peer, message, new Error("Signaling rate exceeded"));
    if (session.protocolViolations >= 3)
      peer.close(1008, "Signaling rate exceeded");
    return;
  }
  if (session.queueDepth >= mediaSignalingLimits.maximumQueuedSignals) {
    peer.close(1008, "Signaling queue exceeded");
    return;
  }

  session.queueDepth += 1;
  session.queue = session.queue
    .then(async () => {
      if (session.closed) return;
      await handleMessage(state, session, message);
    })
    .catch((error) => reportSignalingError(peer, message, error))
    .finally(() => {
      session.queueDepth = Math.max(0, session.queueDepth - 1);
    });
  await session.queue;
}

function reportSignalingError(peer, message, error) {
  console.error("[SFU] signaling error", error);
  send(peer, "error", {
    message: serializeError(error),
    fatal: false,
    requestType: message?.type || null,
    transportId: message?.data?.transportId || null,
    producerId: message?.data?.producerId || null,
    requestId: message?.data?.requestId || null,
  });
}

export async function closeSfuPeer(peer) {
  const statePromise = globalThis[stateKey];
  if (!statePromise) return;
  const state = await statePromise.catch(() => null);
  if (!state) return;
  const session = state.sessions.get(peer.id);
  if (!session) return;
  session.queue = session.queue
    .catch(() => {})
    .then(() => closeSession(state, session));
  await session.queue;
}

export async function getSfuMetrics() {
  const state = await getState();
  return collectSfuMetrics(state);
}

export async function getSfuMetricsSnapshot() {
  const statePromise = globalThis[stateKey];
  if (!statePromise)
    return collectSfuMetrics({
      rooms: new Map(),
      sessions: new Map(),
      worker: null,
    });
  const state = await statePromise.catch(() => null);
  return collectSfuMetrics(
    state || { rooms: new Map(), sessions: new Map(), worker: null },
  );
}

export async function isActiveVoiceParticipant(channelId, userId) {
  const state = await getState();
  const room = state.rooms.get(String(channelId));
  if (!room) return false;
  return [...room.sessions.values()].some(
    (session) => String(session.userId) === String(userId),
  );
}

export async function disconnectVoiceParticipant(channelId, userId) {
  const state = await getState();
  const room = state.rooms.get(String(channelId));
  if (!room) return 0;
  const sessions = [...room.sessions.values()].filter(
    (session) => String(session.userId) === String(userId),
  );
  for (const session of sessions) {
    closeSession(state, session);
    session.peer.close(1008, "Removed from room");
  }
  return sessions.length;
}

export async function moderateVoiceParticipant(
  channelId,
  userId,
  targetChannelId = null,
) {
  const state = await getState();
  const room = state.rooms.get(String(channelId));
  if (!room) return 0;
  const sessions = [...room.sessions.values()].filter(
    (session) => String(session.userId) === String(userId),
  );
  for (const session of sessions) {
    send(session.peer, "voice-moderation", {
      action: targetChannelId ? "move" : "disconnect",
      targetChannelId: targetChannelId ? String(targetChannelId) : null,
    });
    closeSession(state, session);
    session.peer.close(
      1008,
      targetChannelId
        ? "Moved by a room administrator"
        : "Disconnected by a room administrator",
    );
  }
  return sessions.length;
}

export async function broadcastVoiceChannelEvent(channelId, type, data) {
  const state = await getState();
  const room = state.rooms.get(String(channelId));
  if (!room) return 0;
  let delivered = 0;
  for (const session of room.sessions.values()) {
    if (send(session.peer, type, data)) delivered += 1;
  }
  return delivered;
}

export async function updateActiveUserProfile(profile) {
  if (!profile?.id) return 0;
  const state = await getState();
  const changedRooms = new Set();
  let updatedSessions = 0;
  for (const session of state.sessions.values()) {
    if (String(session.userId) !== String(profile.id)) continue;
    session.profile = { ...session.profile, ...profile };
    changedRooms.add(session.room);
    updatedSessions += 1;
  }
  for (const room of changedRooms) {
    broadcastChannelState(room);
  }
  return updatedSessions;
}
