import { Device } from "mediasoup-client";
import type {
  MediasoupClientSessionLike,
  MediasoupDeviceLike,
  MediasoupMessage,
  MediasoupMediaProfile,
  MediasoupPendingRequest,
  MediasoupSessionOptions,
  MediasoupTransportDirection,
  MediasoupTransportLike,
  MediasoupTransportState,
} from "./types/mediasoup-client.ts";
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
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
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
export class MediasoupClientSession {
  send!: (message: Record<string, unknown>) => unknown;
  iceServers!: unknown[];
  onRemoteTrack?: (
    entry: import("./types/mediasoup-client.ts").MediasoupConsumerEntry,
  ) => unknown;
  onRemoteTrackEnded?: (
    entry: import("./types/mediasoup-client.ts").MediasoupConsumerEntry,
  ) => unknown;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => unknown;
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
  sourcePublications!: Map<string, Promise<unknown>>;
  sourceOperations!: Map<string, Promise<unknown>>;
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
  readyPromise!: Promise<unknown> | null;
  readyResolve!: ((value?: unknown) => void) | null;
  readyReject!: ((error: unknown) => void) | null;
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
  recoveryOperations!: Map<MediasoupTransportDirection, Promise<unknown>>;
  recoveryTimers!: Map<
    MediasoupTransportDirection,
    ReturnType<typeof setTimeout>
  >;
  mediaRevision!: number;
  initializationRequestId!: string | null;
  transportRequestIds!: Map<MediasoupTransportDirection, string>;
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
    this.device = null as MediasoupDeviceLike | null;
    this.sendTransport = null as MediasoupTransportLike | null;
    this.recvTransport = null as MediasoupTransportLike | null;
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

  async handle(type: string, data: MediasoupMessage) {
    if (this.closed) return false;
    if (type === "rtp-capabilities") {
      if (data.requestId !== this.initializationRequestId) return false;
      try {
        const mediaRevision = this.mediaRevision;
        this.device = new Device() as unknown as MediasoupDeviceLike;
        await this.device.load({ routerRtpCapabilities: data });
        if (
          this.closed ||
          mediaRevision !== this.mediaRevision ||
          data.requestId !== this.initializationRequestId
        )
          return false;
        this.lastSentClientRtpCapabilities = this.device.rtpCapabilities;
        this.sendOrThrow(
          {
            type: "client-rtp-capabilities",
            data: { rtpCapabilities: this.device.rtpCapabilities },
          },
          "SFU capability negotiation",
        );
        for (const direction of [
          "send",
          "recv",
        ] as MediasoupTransportDirection[]) {
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
          for (const producerId of [...this.pendingConsumers])
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
        this.pending.get(data.requestId)?.resolve(data.iceParameters);
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
        callback: (value?: unknown) => void,
        errback: (error: unknown) => void,
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
          this.pending.get(requestId)?.reject(error);
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
        errback: (error: unknown) => void,
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
          this.pendingProduce.get(requestId)?.reject(error);
        }
        acknowledgement.then(
          (value) => callback(value as { id: string }),
          errback,
        );
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
        callback: (value?: unknown) => void,
        errback: (error: unknown) => void,
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
          this.pending.get(requestId)?.reject(error);
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

  rejectReadiness(error: unknown) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(error);
  }

  connectionState() {
    return getMediasoupConnectionState(
      this as unknown as MediasoupClientSessionLike,
    );
  }

  handleServerTransportState(data: MediasoupMessage) {
    return handleMediasoupTransportState(
      this as unknown as MediasoupClientSessionLike,
      data,
    );
  }

  handleTransportRecovery(
    direction: MediasoupTransportDirection,
    state: MediasoupTransportState,
  ) {
    return handleMediasoupTransportRecovery(
      this as unknown as MediasoupClientSessionLike,
      direction,
      state,
    );
  }

  restartTransportIce(direction: MediasoupTransportDirection) {
    return restartMediasoupTransportIce(
      this as unknown as MediasoupClientSessionLike,
      direction,
    );
  }
}

export interface MediasoupClientSession {
  publish: (
    entry: import("./types/mediasoup-client.ts").MediasoupSourceEntry,
  ) => Promise<unknown>;
  requestConsumer: (producerId: string) => unknown;
  createConsumer: (data: MediasoupMessage) => Promise<unknown>;
  handleServerError: (data: Record<string, unknown>) => unknown;
  closeConsumerByProducer: (producerId: string) => unknown;
  setConsumerReceiving: (
    entry: import("./types/mediasoup-client.ts").MediasoupConsumerEntry,
    receiving: boolean,
  ) => Promise<boolean>;
  resetReadiness: () => void;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
}

Object.assign(
  MediasoupClientSession.prototype,
  sourceMethods,
  consumerMethods,
  lifecycleMethods,
);
