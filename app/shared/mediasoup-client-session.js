import { Device } from "mediasoup-client";
import {
  handleMediasoupTransportRecovery,
  restartMediasoupTransportIce,
} from "./mediasoup-client-recovery.js";
import {
  getMediasoupConnectionState,
  handleMediasoupTransportState,
} from "./mediasoup-client-transport-state.js";
import { methods as consumerMethods } from "./mediasoup-client-session/consumers.js";
import { methods as lifecycleMethods } from "./mediasoup-client-session/lifecycle.js";
import { methods as sourceMethods } from "./mediasoup-client-session/sources.js";

function waitFor(map, key, timeoutMs, label) {
  return new Promise((resolve, reject) => {
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
  constructor({
    send,
    iceServers,
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
  }) {
    this.send = send;
    this.iceServers = iceServers;
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

  async handle(type, data) {
    if (this.closed) return false;
    if (type === "rtp-capabilities") {
      if (data.requestId !== this.initializationRequestId) return false;
      try {
        const mediaRevision = this.mediaRevision;
        this.device = new Device();
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
        for (const direction of ["send", "recv"]) {
          const requestId = this.requestId(`create-${direction}`);
          this.transportRequestIds.set(direction, requestId);
          this.sendOrThrow(
            {
              type: "create-transport",
              data: { type: direction, requestId },
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
      if (this.transportRequestIds.get(data.direction) !== data.requestId)
        return false;
      try {
        this.transportRequestIds.delete(data.direction);
        this.createTransport(data);
        if (this.sendTransport && this.recvTransport) {
          clearTimeout(this.initializationTimer);
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
      this.pending.get(data.requestId)?.resolve();
      return true;
    }
    if (type === "producer-id") {
      this.pendingProduce.get(data.requestId)?.resolve({ id: data.id });
      return true;
    }
    if (type === "consumer-params") {
      await this.createConsumer(data);
      return true;
    }
    if (type === "new-producer") {
      this.requestConsumer(data.producerId);
      return true;
    }
    if (type === "available-producers") {
      for (const producerId of data?.producers || [])
        this.requestConsumer(producerId);
      return true;
    }
    if (type === "producer-closed") {
      this.closeConsumerByProducer(data.producerId);
      return true;
    }
    if (type === "consumer-resumed" || type === "consumer-paused") {
      this.pending.get(data.requestId)?.resolve(data);
      if (data.consumerClosed) return true;
      const entry = this.consumers.get(data.consumerId);
      if (entry) entry.receiving = type === "consumer-resumed";
      return true;
    }
    if (type === "ice-restarted") {
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

  createTransport(data) {
    const options = {
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters,
      iceServers: this.iceServers,
    };
    if (data.direction === "send" && !this.sendTransport) {
      this.sendTransport = this.device.createSendTransport(options);
      this.bindSendTransport();
    }
    if (data.direction === "recv" && !this.recvTransport) {
      this.recvTransport = this.device.createRecvTransport(options);
      this.bindReceiveTransport();
    }
  }

  bindSendTransport() {
    this.sendTransport.on(
      "connect",
      ({ dtlsParameters }, callback, errback) => {
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
                transportId: this.sendTransport.id,
                dtlsParameters,
              },
            },
            "SFU send transport connection",
          );
        } catch (error) {
          this.pending.get(requestId)?.reject(error);
        }
        acknowledgement.then(callback, errback);
      },
    );
    this.sendTransport.on(
      "produce",
      ({ kind, rtpParameters, appData }, callback, errback) => {
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
                transportId: this.sendTransport.id,
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
        acknowledgement.then(callback, errback);
      },
    );
    this.sendTransport.on("connectionstatechange", (state) => {
      this.transportStates.set("send", state);
      this.onStateChange?.("send", state, this.connectionState());
      this.handleTransportRecovery("send", state);
    });
  }

  bindReceiveTransport() {
    this.recvTransport.on(
      "connect",
      ({ dtlsParameters }, callback, errback) => {
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
                transportId: this.recvTransport.id,
                dtlsParameters,
              },
            },
            "SFU receive transport connection",
          );
        } catch (error) {
          this.pending.get(requestId)?.reject(error);
        }
        acknowledgement.then(callback, errback);
      },
    );
    this.recvTransport.on("connectionstatechange", (state) => {
      this.transportStates.set("recv", state);
      this.onStateChange?.("recv", state, this.connectionState());
      this.handleTransportRecovery("recv", state);
    });
  }

  requestId(operation) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  waitForPending(requestId, label, timeoutMs = this.requestTimeoutMs) {
    return waitFor(this.pending, requestId, timeoutMs, label);
  }

  sendOrThrow(message, label) {
    if (this.send(message) === false)
      throw new Error(`${label} signaling unavailable`);
  }

  rejectReadiness(error) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(error);
  }

  connectionState() {
    return getMediasoupConnectionState(this);
  }

  handleServerTransportState(data) {
    return handleMediasoupTransportState(this, data);
  }

  handleTransportRecovery(direction, state) {
    return handleMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(direction) {
    return restartMediasoupTransportIce(this, direction);
  }
}

Object.assign(
  MediasoupClientSession.prototype,
  sourceMethods,
  consumerMethods,
  lifecycleMethods,
);
