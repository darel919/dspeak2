import {
  configureControl,
  connect,
  createSignaling,
  handleProviderTicket,
  handleRtpCapabilities,
  handleTransportParams,
  resolveConnect,
  startNegotiation,
} from "../native-mediasoup-signaling.ts";
import { installHandlers } from "../native-mediasoup-handlers.ts";
import { NativeCloudflareRealtimeSession } from "../native-cloudflare-realtime-session.ts";
import type { NativeMediasoupSfuSession } from "../native-mediasoup-session.ts";
import type {
  NativeCloudflareSessionLike,
  NativeMediasoupSfuSessionSurface,
} from "../types/native-mediasoup-session.ts";
import type { SignalingMessage } from "../types/media-signaling.ts";
import type { OwnedErrorValue } from "../types/shared-utilities.ts";
import type { MediaCommandResult } from "../types/boundary.ts";

import { CLOUDFLARE_REQUEST_TIMEOUT_MS } from "./helpers.ts";
export class NativeMediasoupSignalingMethods {
  _installHandlers(this: NativeMediasoupSfuSession) {
    return installHandlers(this);
  }

  async connect(this: NativeMediasoupSfuSession, channelId: string) {
    return connect(this, channelId);
  }

  configureControl(
    this: NativeMediasoupSfuSession,
    config: Record<string, unknown> = {},
  ) {
    return configureControl(this, config);
  }

  async _handleProviderTicket(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return handleProviderTicket(this, data);
  }

  _createSignaling(this: NativeMediasoupSfuSession) {
    return createSignaling(this);
  }

  _resolveConnect(this: NativeMediasoupSfuSession) {
    return resolveConnect(this);
  }

  _createCloudflareSession(
    this: NativeMediasoupSfuSession,
  ): NativeCloudflareSessionLike {
    if (this.cloudflareSession) return this.cloudflareSession;
    this.cloudflareSession = new NativeCloudflareRealtimeSession({
      invoke: this.invokeRaw,
      send: (message: SignalingMessage) => this.signaling?.send?.(message),
      ensureControlReady: async () => {
        await this.signaling?.waitForReady?.();
      },
      onRemoteTrack: (entry: Record<string, unknown>) => {
        this.onRemoteTrack?.(entry);
        this._emitState();
      },
      onRemoteTrackEnded: (entry: Record<string, unknown>) => {
        this.onRemoteTrackEnded?.(entry);
        this._emitState();
      },
      onStateChange: () => {
        const state = this.cloudflareSession?.connectionState?.();
        this.mediaConnectionState = state?.ready
          ? "media-flowing"
          : state?.send === "failed"
            ? "failed"
            : "transport-connecting";
        if (state?.ready) this.lastProviderFailureKey = null;
        if (
          (state?.send === "failed" || state?.recv === "failed") &&
          this.activeSfuProvider === "cloudflare-realtime"
        )
          this.reportProviderFailure("native-cloudflare-transport-failed");
        this._emitState();
      },
      onError: (error: OwnedErrorValue) => {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.error = failure;
        this.onError?.(failure);
        this._emitState();
      },
      getAudioBitrate: this.getAudioBitrate,
      getAudioStereo: this.getAudioStereo,
      getVideoSettings: this.getVideoSettings,
      localPeerId: this.localPeerId,
      requestTimeoutMs: Math.max(
        this.requestTimeoutMs,
        CLOUDFLARE_REQUEST_TIMEOUT_MS,
      ),
      sources: this.sources,
      producers: this.producers,
      producerVariants: this.producerVariants,
      consumers: this.consumers,
      sourceTransmission: this.sourceTransmission,
      remoteReceiving: this.remoteReceiving,
      localVideoFeeds: this.localVideoFeeds,
      pendingLocalVideoFrames: this.pendingLocalVideoFrames,
      remoteVideoFeeds: this.remoteVideoFeeds,
      remoteAudioFeeds: this.remoteAudioFeeds,
      mediaCapabilities: this.mediaCapabilities,
      getControlConnectionEpoch: this.getControlConnectionEpoch,
    });
    if (!this.cloudflareSession)
      throw new Error("Cloudflare media session was not created");
    return this.cloudflareSession;
  }

  async activateProvider(
    this: NativeMediasoupSfuSession,
    provider: string,
    {
      ensureMedia = false,
      closeMedia = false,
    }: { ensureMedia?: boolean; closeMedia?: boolean } = {},
  ) {
    const nextProvider = String(provider || "mediasoup");
    this.selectedProvider = nextProvider;
    const currentActivation = this.providerActivationPromise;
    if (currentActivation) {
      let activationError: Error | string | null = null;
      try {
        await currentActivation;
      } catch (error) {
        activationError = error instanceof Error ? error : String(error);
      }
      if (
        activationError &&
        this.selectedProvider === nextProvider &&
        !this.closed
      )
        throw activationError;
      if (this.activeSfuProvider === nextProvider)
        return this.cloudflareSession;
    }
    let activation: Promise<MediaCommandResult>;
    activation = (async () => {
      if (this.closed)
        throw Object.assign(new Error("Native SFU session is closed"), {
          code: "NATIVE_SFU_SESSION_CLOSED",
        });
      let mediaRevision = this.mediaRevision;
      const assertCurrentActivation = () => {
        if (
          !this.closed &&
          this.selectedProvider === nextProvider &&
          this.mediaRevision === mediaRevision
        )
          return;
        throw Object.assign(
          new Error("Native SFU provider activation was superseded"),
          { code: "NATIVE_PROVIDER_ACTIVATION_SUPERSEDED" },
        );
      };
      if (nextProvider === "cloudflare-realtime") {
        if (this.sendTransport || this.recvTransport || this.device) {
          await this._closeMedia(false);
          mediaRevision = this.mediaRevision;
          this.activeSfuProvider = null;
        }
        assertCurrentActivation();
        const cloudflare = this._createCloudflareSession();
        const wasInitialized = Boolean(cloudflare.sessionId);
        try {
          await cloudflare.initialize();
          assertCurrentActivation();
          for (const publication of this.pendingCloudflarePublications.values())
            await cloudflare.handleMessage(
              "cloudflare-publication-available",
              publication,
            );
          assertCurrentActivation();
          if (!wasInitialized)
            for (const entry of this.sources.values()) {
              await cloudflare.addSource(entry);
              assertCurrentActivation();
            }
          if (!wasInitialized)
            for (const plan of this.codecRoutingPlans.values()) {
              await this.applyCodecRoutingPlan(plan);
              assertCurrentActivation();
            }
          await cloudflare.startSubscriptions();
          assertCurrentActivation();
        } catch (error) {
          if (this.cloudflareSession === cloudflare)
            this.cloudflareSession = null;
          await Promise.resolve(cloudflare.closeMedia()).catch(() => {});
          throw error;
        }
        this.transportStates.set("send", "connected");
        this.transportStates.set("recv", "connected");
        this.mediaConnectionState = "transport-connecting";
        this.activeSfuProvider = "cloudflare-realtime";
        this.activeSfuProviderId = this.selectedProviderId;
        this._emitState();
        return cloudflare;
      }
      if (this.cloudflareSession || closeMedia) {
        await this._closeMedia(false);
        mediaRevision = this.mediaRevision;
        this.mediaConnectionState = "disconnected";
      }
      assertCurrentActivation();
      if (
        nextProvider === "mediasoup" &&
        ensureMedia &&
        !this.sendTransport &&
        !this.recvTransport &&
        !this.device
      )
        await this._startNegotiation();
      this.activeSfuProvider =
        this.sendTransport || this.recvTransport || this.device
          ? "mediasoup"
          : null;
      this.activeSfuProviderId =
        this.activeSfuProvider === "mediasoup" ? this.selectedProviderId : null;
      return null;
    })().finally(() => {
      if (this.providerActivationPromise === activation)
        this.providerActivationPromise = null;
    });
    this.providerActivationPromise = activation;
    return activation;
  }

  async _startNegotiation(this: NativeMediasoupSfuSession) {
    return startNegotiation(this);
  }

  async _handleRtpCapabilities(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return handleRtpCapabilities(this, data);
  }

  async _handleTransportParams(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return handleTransportParams(this, data);
  }
}

export type NativeMediasoupSignalingContract =
  NativeMediasoupSfuSessionSurface & NativeMediasoupSignalingMethods;
