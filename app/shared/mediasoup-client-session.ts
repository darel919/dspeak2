import { Device } from "mediasoup-client";
import type { types as MediasoupTypes } from "mediasoup-client";
import type { MediasoupClientSessionLike } from "./types/mediasoup-client.ts";
import type {
  MediasoupDeviceLike,
  MediasoupMessage,
  MediasoupMediaProfile,
  MediasoupPendingRequest,
  MediasoupSessionOptions,
  MediasoupTransportDirection,
  MediasoupTransportLike,
  MediasoupTransportState,
} from "./types/mediasoup-client.ts";
import { isExternalRecord, isExternalString } from "./types/boundary.ts";
import type { MediaCommandResult } from "./types/boundary.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";
import { asError } from "./native-mediasoup-utils.ts";
import {
  handleMediasoupTransportRecovery,
  restartMediasoupTransportIce,
} from "./mediasoup-client-recovery.ts";
import {
  getMediasoupConnectionState,
  handleMediasoupTransportState,
} from "./mediasoup-client-transport-state.ts";
import { methods as consumerMethods } from "./mediasoup-client-session/consumers.ts";
import { methods as lifecycleMethods } from "./mediasoup-client-session/lifecycle.ts";
import { methods as sourceMethods } from "./mediasoup-client-session/sources.ts";

function waitFor(
  map: Map<string, MediasoupPendingRequest>,
  key: string,
  timeoutMs: number,
  label: string,
): Promise<MediaCommandResult> {
  return new Promise<MediaCommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(key);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    map.set(key, {
      resolve(value) {
        clearTimeout(timer);
        map.delete(key);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        map.delete(key);
        reject(error);
      },
    });
  });
}

function isRecord<T>(value: T): value is T & Record<string, unknown> {
  return isExternalRecord(value);
}

function isMediasoupMessage<T>(value: T): value is T & MediasoupMessage {
  return isRecord(value);
}

function parseRtpCapabilities<T>(
  value: T,
): MediasoupTypes.RtpCapabilities | null {
  if (!isRecord(value)) return null;
  if (value.codecs !== undefined && !Array.isArray(value.codecs)) return null;
  if (
    value.headerExtensions !== undefined &&
    !Array.isArray(value.headerExtensions)
  )
    return null;
  return value;
}
export class MediasoupClientSession implements MediasoupClientSessionLike {
  provider?: string;
  providerId?: string | null;
  send!: (message: Record<string, unknown>) => MediaCommandResult;
  iceServers!: unknown[];
  onRemoteTrack?: (
    entry: import("./types/mediasoup-client.ts").MediasoupConsumerEntry,
  ) => MediaCommandResult;
  onRemoteTrackEnded?: (
    entry: import("./types/mediasoup-client.ts").MediasoupConsumerEntry,
  ) => MediaCommandResult;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => MediaCommandResult;
  getAudioBitrate?: (source: string) => number | null;
  getVideoSettings?: (source: string) => Record<string, unknown>;
  getAudioStereo?: (source: string) => boolean;
  requestTimeoutMs!: number;
  mediaProfile!: MediasoupMediaProfile;
  consumerControlTimeoutMs!: number;
  recoveryTimeoutMs!: number;
  consumerRetryDelayMs!: number;
  device!: MediasoupDeviceLike | null;
  sendTransport!: MediasoupTransportLike | null;
  recvTransport!: MediasoupTransportLike | null;
  sources!: Map<
    string,
    import("./types/mediasoup-client.ts").MediasoupSourceEntry
  >;
  producers!: Map<
    string,
    import("./types/mediasoup-client.ts").MediasoupProducerEntry
  >;
  sourceTransmission!: Map<string, boolean>;
  sourcePublications!: Map<string, Promise<MediaCommandResult>>;
  sourceOperations!: Map<string, Promise<MediaCommandResult>>;
  consumers!: Map<
    string,
    import("./types/mediasoup-client.ts").MediasoupConsumerEntry
  >;
  pending!: Map<string, MediasoupPendingRequest>;
  pendingProduce!: Map<string, MediasoupPendingRequest>;
  pendingConsumers!: Set<string>;
  requestedConsumers!: Set<string>;
  consumerRetryAttempts!: Map<string, number>;
  consumerRetryTimers!: Map<string, ReturnType<typeof setTimeout>>;
  readyPromise!: Promise<MediaCommandResult> | null;
  readyResolve!: ((value?: MediaCommandResult) => void) | null;
  readyReject!: ((error: OwnedErrorValue) => void) | null;
  initializationTimer!: ReturnType<typeof setTimeout> | null;
  closed!: boolean;
  lastSentClientRtpCapabilities!: unknown;
  lastReceivedConsumerParams!: unknown;
  remoteReceiving!: Map<string, boolean>;
  jitterBufferMinimumDelay!: number;
  jitterBufferTargetDelay!: number;
  transportStates!: Map<MediasoupTransportDirection, MediasoupTransportState>;
  rtpSamples!: Map<string, { bytes: number; timestamp: number }>;
  nextRequestSequence!: number;
  recoveryAttempts!: Map<MediasoupTransportDirection, number>;
  recoveryOperations!: Map<
    MediasoupTransportDirection,
    Promise<MediaCommandResult>
  >;
  recoveryTimers!: Map<
    MediasoupTransportDirection,
    ReturnType<typeof setTimeout>
  >;
  mediaRevision!: number;
  initializationRequestId!: string | null;
  transportRequestIds!: Map<MediasoupTransportDirection, string>;
  declare onError?: (error: OwnedErrorValue) => MediaCommandResult;
  declare publish: MediasoupClientSessionLike["publish"];
  declare publishSource: MediasoupClientSessionLike["publishSource"];
  declare enqueueSourceOperation: MediasoupClientSessionLike["enqueueSourceOperation"];
  declare addSourceInternal: MediasoupClientSessionLike["addSourceInternal"];
  declare setSourceTransmission: MediasoupClientSessionLike["setSourceTransmission"];
  declare removeSourceInternal: MediasoupClientSessionLike["removeSourceInternal"];
  declare closeMedia: MediasoupClientSessionLike["closeMedia"];
  declare stats: MediasoupClientSessionLike["stats"];
  declare diagnosticStats: MediasoupClientSessionLike["diagnosticStats"];
  declare applyJitterBufferConfig: MediasoupClientSessionLike["applyJitterBufferConfig"];
  declare setJitterBufferConfig: MediasoupClientSessionLike["setJitterBufferConfig"];
  declare shouldReceive: MediasoupClientSessionLike["shouldReceive"];
  declare requestConsumer: MediasoupClientSessionLike["requestConsumer"];
  declare setConsumerReceiving: MediasoupClientSessionLike["setConsumerReceiving"];
  declare closeConsumerByProducer: MediasoupClientSessionLike["closeConsumerByProducer"];
  declare resetReadiness: MediasoupClientSessionLike["resetReadiness"];
  declare addSource: (
    entry: import("./types/mediasoup-client.ts").MediasoupSourceEntry,
  ) => Promise<MediaCommandResult>;
  declare startSubscriptions?: () => Promise<MediaCommandResult>;
  declare createConsumer: (
    data: MediasoupMessage,
  ) => Promise<MediaCommandResult>;
  declare handleServerError: (
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  constructor({
    send,
    iceServers,
    mediaProfile = "audio",
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    getAudioBitrate,
    getVideoSettings,
    getAudioStereo,
    requestTimeoutMs = 8000,
    consumerControlTimeoutMs = 4000,
    recoveryTimeoutMs = 5000,
    consumerRetryDelayMs = 250,
  }: MediasoupSessionOptions) {
    this.send = send;
    this.iceServers = iceServers;
    this.mediaProfile = mediaProfile;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.getAudioBitrate = getAudioBitrate;
    this.getVideoSettings = getVideoSettings;
    this.getAudioStereo = getAudioStereo;
    this.requestTimeoutMs = requestTimeoutMs;
    this.consumerControlTimeoutMs = consumerControlTimeoutMs;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.consumerRetryDelayMs = consumerRetryDelayMs;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.sources = new Map();
    this.producers = new Map();
    this.sourceTransmission = new Map();
    this.sourcePublications = new Map();
    this.sourceOperations = new Map();
    this.consumers = new Map();
    this.pending = new Map();
    this.pendingProduce = new Map();
    this.pendingConsumers = new Set();
    this.requestedConsumers = new Set();
    this.consumerRetryAttempts = new Map();
    this.consumerRetryTimers = new Map();
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationTimer = null;
    this.closed = false;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    this.remoteReceiving = new Map();
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.transportStates = new Map([
      ["send", "new"],
      ["recv", "new"],
    ]);
    this.rtpSamples = new Map();
    this.nextRequestSequence = 0;
    this.recoveryAttempts = new Map();
    this.recoveryOperations = new Map();
    this.recoveryTimers = new Map();
    this.mediaRevision = 0;
    this.initializationRequestId = null;
    this.transportRequestIds = new Map();
  }

  async initialize() {
    if (this.readyPromise) return this.readyPromise;
    this.closed = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.initializationTimer = setTimeout(() => {
      const reject = this.readyReject;
      this.resetReadiness();
      reject?.(new Error("SFU initialization timed out"));
    }, 10000);
    this.initializationRequestId = this.requestId("initialize");
    try {
      this.sendOrThrow(
        {
          type: "get-rtp-capabilities",
          data: { requestId: this.initializationRequestId },
        },
        "SFU initialization",
      );
    } catch (error) {
      this.rejectReadiness(error);
      throw error;
    }
    return this.readyPromise;
  }

  async handle<T>(type: string, data: T) {
    if (!isMediasoupMessage(data)) return false;
    if (this.closed) return false;
    if (type === "rtp-capabilities") {
      if (data.requestId !== this.initializationRequestId) return false;
      try {
        const mediaRevision = this.mediaRevision;
        const device = new Device();
        this.device = device;
        const routerRtpCapabilities = parseRtpCapabilities(data);
        if (!routerRtpCapabilities)
          throw new Error("SFU returned invalid RTP capabilities");
        await device.load({ routerRtpCapabilities });
        if (
          this.closed ||
          mediaRevision !== this.mediaRevision ||
          data.requestId !== this.initializationRequestId
        )
          return false;
        this.lastSentClientRtpCapabilities = device.rtpCapabilities;
        this.sendOrThrow(
          {
            type: "client-rtp-capabilities",
            data: { rtpCapabilities: device.rtpCapabilities },
          },
          "SFU capability negotiation",
        );
        const directions: MediasoupTransportDirection[] = ["send", "recv"];
        for (const direction of directions) {
          const requestId = this.requestId(`create-${direction}`);
          this.transportRequestIds.set(direction, requestId);
          this.sendOrThrow(
            {
              type: "create-transport",
              data: {
                type: direction,
                requestId,
                mediaProfile:
                  direction === "recv" ? "mixed" : this.mediaProfile,
              },
            },
            `SFU ${direction} transport creation`,
          );
        }
      } catch (error) {
        this.rejectReadiness(error);
        throw error;
      }
      return true;
    }
    if (type === "transport-params") {
      if (
        !data.direction ||
        this.transportRequestIds.get(data.direction) !== data.requestId
      )
        return false;
      try {
        this.transportRequestIds.delete(data.direction);
        this.createTransport(data);
        if (this.sendTransport && this.recvTransport) {
          if (this.initializationTimer) clearTimeout(this.initializationTimer);
          this.initializationTimer = null;
          this.readyResolve?.();
          this.readyResolve = null;
          this.readyReject = null;
          for (const entry of this.sources.values()) await this.publish(entry);
          for (const producerId of this.pendingConsumers)
            this.requestConsumer(producerId);
        }
      } catch (error) {
        this.rejectReadiness(error);
        throw error;
      }
      return true;
    }
    if (type === "transport-connected") {
      if (data.requestId) this.pending.get(data.requestId)?.resolve();
      return true;
    }
    if (type === "producer-id") {
      if (data.requestId && data.id)
        this.pendingProduce.get(data.requestId)?.resolve({ id: data.id });
      return true;
    }
    if (type === "consumer-params") {
      await this.createConsumer(data);
      return true;
    }
    if (type === "new-producer") {
      if (data.producerId) this.requestConsumer(data.producerId);
      return true;
    }
    if (type === "available-producers") {
      for (const producerId of data?.producers || [])
        this.requestConsumer(producerId);
      return true;
    }
    if (type === "producer-closed") {
      if (data.producerId) this.closeConsumerByProducer(data.producerId);
      return true;
    }
    if (type === "consumer-resumed" || type === "consumer-paused") {
      if (data.requestId) this.pending.get(data.requestId)?.resolve(data);
      if (data.consumerClosed) return true;
      const entry = data.consumerId
        ? this.consumers.get(data.consumerId)
        : undefined;
      if (entry) entry.receiving = type === "consumer-resumed";
      return true;
    }
    if (type === "ice-restarted") {
      if (data.requestId)
        this.pending
          .get(data.requestId)
          ?.resolve(
            isExternalRecord(data.iceParameters) ? data.iceParameters : {},
          );
      return true;
    }
    if (type === "transport-state") {
      this.handleServerTransportState(data);
      return true;
    }
    if (type === "error") {
      return this.handleServerError(data);
    }
    return false;
  }

  createTransport(data: MediasoupMessage) {
    const options = {
      id: data.id || "",
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters,
      iceServers: this.iceServers,
    };
    if (data.direction === "send" && !this.sendTransport && this.device) {
      this.sendTransport = this.device.createSendTransport(options);
      this.bindSendTransport();
    }
    if (data.direction === "recv" && !this.recvTransport && this.device) {
      this.recvTransport = this.device.createRecvTransport(options);
      this.bindReceiveTransport();
    }
  }

  bindSendTransport() {
    const sendTransport = this.sendTransport;
    if (!sendTransport) return;
    sendTransport.on(
      "connect",
      (
        { dtlsParameters }: { dtlsParameters: unknown },
        callback: (value?: MediaCommandResult) => void,
        errback: (error: Error) => void,
      ) => {
        const requestId = this.requestId("connect");
        const acknowledgement = waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU send transport connection",
        );
        try {
          this.sendOrThrow(
            {
              type: "connect-transport",
              data: {
                requestId,
                transportId: sendTransport.id,
                dtlsParameters,
              },
            },
            "SFU send transport connection",
          );
        } catch (error) {
          this.pending
            .get(requestId)
            ?.reject(asError(error, "SFU send transport connection failed"));
        }
        acknowledgement.then((value) => callback(value), errback);
      },
    );
    sendTransport.on(
      "produce",
      (
        {
          kind,
          rtpParameters,
          appData,
        }: { kind: string; rtpParameters: unknown; appData: unknown },
        callback: (value: { id: string }) => void,
        errback: (error: Error) => void,
      ) => {
        const requestId = this.requestId("produce");
        const acknowledgement = waitFor(
          this.pendingProduce,
          requestId,
          this.requestTimeoutMs,
          "SFU produce",
        );
        try {
          this.sendOrThrow(
            {
              type: "produce",
              data: {
                requestId,
                transportId: sendTransport.id,
                kind,
                rtpParameters,
                appData,
              },
            },
            "SFU producer publication",
          );
        } catch (error) {
          this.pendingProduce
            .get(requestId)
            ?.reject(asError(error, "SFU producer publication failed"));
        }
        acknowledgement.then((value) => {
          const id =
            isExternalRecord(value) && isExternalString(value.id)
              ? value.id
              : null;
          if (id) callback({ id });
          else errback(new Error("SFU producer response omitted its id"));
        }, errback);
      },
    );
    sendTransport.on(
      "connectionstatechange",
      (state: MediasoupTransportState) => {
        this.transportStates.set("send", state);
        this.onStateChange?.("send", state, this.connectionState());
        this.handleTransportRecovery("send", state);
      },
    );
  }

  bindReceiveTransport() {
    const recvTransport = this.recvTransport;
    if (!recvTransport) return;
    recvTransport.on(
      "connect",
      (
        { dtlsParameters }: { dtlsParameters: unknown },
        callback: (value?: MediaCommandResult) => void,
        errback: (error: Error) => void,
      ) => {
        const requestId = this.requestId("connect");
        const acknowledgement = waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU receive transport connection",
        );
        try {
          this.sendOrThrow(
            {
              type: "connect-transport",
              data: {
                requestId,
                transportId: recvTransport.id,
                dtlsParameters,
              },
            },
            "SFU receive transport connection",
          );
        } catch (error) {
          this.pending
            .get(requestId)
            ?.reject(asError(error, "SFU receive transport connection failed"));
        }
        acknowledgement.then((value) => callback(value), errback);
      },
    );
    recvTransport.on(
      "connectionstatechange",
      (state: MediasoupTransportState) => {
        this.transportStates.set("recv", state);
        this.onStateChange?.("recv", state, this.connectionState());
        this.handleTransportRecovery("recv", state);
      },
    );
  }

  requestId(operation: string) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  waitForPending(
    requestId: string,
    label: string,
    timeoutMs = this.requestTimeoutMs,
  ) {
    return waitFor(this.pending, requestId, timeoutMs, label);
  }

  sendOrThrow(message: Record<string, unknown>, label: string) {
    if (this.send(message) === false)
      throw new Error(`${label} signaling unavailable`);
  }

  rejectReadiness<T>(error: T) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(asError(error, "SFU readiness failed"));
  }

  connectionState() {
    return getMediasoupConnectionState(this);
  }

  handleServerTransportState(data: MediasoupMessage) {
    return handleMediasoupTransportState(this, data);
  }

  handleTransportRecovery(
    direction: MediasoupTransportDirection,
    state: MediasoupTransportState,
  ) {
    return handleMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(direction: MediasoupTransportDirection) {
    return restartMediasoupTransportIce(this, direction);
  }
}

Object.assign(
  MediasoupClientSession.prototype,
  sourceMethods,
  consumerMethods,
  lifecycleMethods,
);
