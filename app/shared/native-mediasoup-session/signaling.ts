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
      invoke: this.invoke,
      send: (message: unknown) => this.signaling?.send?.(message),
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
      onError: (error: unknown) =>
        this.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      getAudioBitrate: this.getAudioBitrate,
      getAudioStereo: this.getAudioStereo,
      getVideoSettings: this.getVideoSettings,
      requestTimeoutMs: Math.max(
        this.requestTimeoutMs,
        CLOUDFLARE_REQUEST_TIMEOUT_MS,
      ),
      sources: this.sources,
      producers: this.producers,
      consumers: this.consumers,
      sourceTransmission: this.sourceTransmission,
      remoteReceiving: this.remoteReceiving,
      localVideoFeeds: this.localVideoFeeds,
      remoteVideoFeeds: this.remoteVideoFeeds,
      remoteAudioFeeds: this.remoteAudioFeeds,
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
    if (nextProvider === "cloudflare-realtime") {
      if (this.sendTransport || this.recvTransport || this.device) {
        await this._closeMedia(false);
        this.activeSfuProvider = null;
      }
      const cloudflare = this._createCloudflareSession();
      const wasInitialized = Boolean(cloudflare.sessionId);
      await cloudflare.initialize();
      for (const publication of this.pendingCloudflarePublications.values())
        await cloudflare.handleMessage(
          "cloudflare-publication-available",
          publication,
        );
      if (!wasInitialized)
        for (const entry of this.sources.values())
          await cloudflare.addSource(entry);
      await cloudflare.startSubscriptions();
      this.transportStates.set("send", "connected");
      this.transportStates.set("recv", "connected");
      this.mediaConnectionState = "transport-connecting";
      this.activeSfuProvider = "cloudflare-realtime";
      this._emitState();
      return cloudflare;
    }
    if (this.cloudflareSession || closeMedia) {
      await this._closeMedia(false);
      this.mediaConnectionState = "disconnected";
    }
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
    return null;
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

export interface NativeMediasoupSignalingMethods extends NativeMediasoupSfuSessionSurface {}
