import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import { buildVideoProduceOptions } from "../video-settings.ts";
import { applyRtpSenderSettings } from "../rtp-sender-settings.ts";
import { mediaDebug } from "../media-debug.ts";
import type {
  CloudflarePublication,
  CloudflareSessionLike,
  CloudflareSourceEntry,
  CloudflareSourceInput,
} from "../types/cloudflare-media.ts";

import {
  MAX_TRACKS_PER_REQUEST,
  getLocalSessionDescription,
} from "./helpers.ts";
export class CloudflareSourcesMethods {
  async addSource(this: CloudflareSessionLike, entry: CloudflareSourceInput) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(() => this.addSourceInternal(entry));
    });
  }

  enqueueSourceOperation(
    this: CloudflareSessionLike,
    source: string,
    operation: () => Promise<unknown>,
  ) {
    const previous = this.sourceOperations.get(source) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    const tracked = task.finally(() => {
      if (this.sourceOperations.get(source) === tracked)
        this.sourceOperations.delete(source);
    });
    this.sourceOperations.set(source, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async addSourceInternal(
    this: CloudflareSessionLike,
    entry: CloudflareSourceInput,
  ) {
    const { generation, peerConnection } = this.currentSession();
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    else if (entry.track && "enabled" in entry.track)
      entry.track.enabled = this.sourceTransmission.get(entry.source) !== false;
    const current = this.producers.get(entry.source);
    if (current) {
      const previousTrack = current.track;
      const previousGeneration = current.generation;
      try {
        await current.sender.replaceTrack(entry.track);
        this.assertCurrentSession(peerConnection, generation);
        await this.configureVideoSender(current.sender, entry);
        await this.setSourceTransmission(
          entry.source,
          this.sourceTransmission.get(entry.source) ?? true,
        );
        current.track = entry.track;
        current.ownerSource = entry.ownerSource || null;
        current.generation = entry.generation;
        if (typeof this.send === "function") {
          this.send({
            type: "cloudflare-publication",
            data: {
              trackName: current.trackName,
              source: entry.source,
              kind: "video",
              ownerSource: entry.ownerSource || null,
              logicalStreamId: current.logicalStreamId || null,
              generation: entry.generation,
              connectionEpoch: this.getControlConnectionEpoch?.() || 0,
              variantId: current.variantId || null,
              codec: current.codec || null,
              codecAcceleration: current.codecAcceleration || null,
              codecImplementation: current.codecImplementation || null,
              width: current.width ?? 0,
              height: current.height ?? 0,
              fps: current.fps ?? 0,
              bitrate: current.bitrate ?? 0,
              ...(current.target ? { target: current.target } : {}),
              ...(current.targetAdjusted
                ? { targetAdjusted: current.targetAdjusted }
                : {}),
              receivers: current.receivers || [],
              emergency: current.emergency === true,
              score: current.score ?? 0,
            },
          });
        }
      } catch (error) {
        try {
          await current.sender.replaceTrack(previousTrack);
        } catch {}
        current.track = previousTrack;
        current.generation = previousGeneration;
        throw error;
      }
      return;
    }
    let sender: RTCRtpSender | null = null;
    let tracksNewSucceeded = false;
    let createdTrackName: string | null = null;
    let createdMid: string | null = null;
    try {
      const stream = entry.stream || new MediaStream([entry.track]);
      sender = peerConnection.addTrack(entry.track, stream);
      if (
        entry.track.kind === "audio" &&
        sender.getParameters &&
        sender.setParameters
      ) {
        const policy = getAudioCodecPolicy(
          entry.source === "screen-audio" ? "shared-audio" : "microphone",
          entry.audioStereo === true,
        );
        const parameters = sender.getParameters();
        const encodings = Array.isArray(parameters.encodings)
          ? parameters.encodings
          : [];
        if (!encodings[0] || typeof encodings[0] !== "object")
          encodings[0] = {};
        parameters.encodings = encodings;
        encodings[0].maxBitrate = entry.audioBitrate || policy.maxBitrateBps;
        encodings[0].priority = policy.priority as RTCPriorityType;
        encodings[0].networkPriority = policy.priority as RTCPriorityType;
        try {
          await sender.setParameters(parameters);
        } catch {}
      }
      if (entry.track.kind === "video" && sender)
        await this.configureVideoSender(sender, entry);
      this.assertCurrentSession(peerConnection, generation);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate: RTCRtpTransceiver) => candidate.sender === sender);
      const trackName = crypto.randomUUID();
      const offer = await peerConnection.createOffer();
      this.assertCurrentSession(peerConnection, generation);
      await peerConnection.setLocalDescription(offer);
      const mid = transceiver?.mid;
      if (mid == null)
        throw new Error("Cloudflare local media transceiver is unavailable");
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      const result = await this.request("tracks-new", {
        sessionDescription,
        tracks: [{ location: "local", mid, trackName }],
      });
      this.assertCurrentSession(peerConnection, generation);
      tracksNewSucceeded = true;
      createdTrackName = trackName;
      createdMid = mid;
      if (result.sessionDescription)
        await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      this.producers.set(entry.source, {
        source: entry.source,
        producer: sender,
        sender,
        track: entry.track,
        trackName,
        mid,
        ownerSource: entry.ownerSource || null,
        generation: entry.generation,
      });
      await this.setSourceTransmission(
        entry.source,
        this.sourceTransmission.get(entry.source) ?? true,
      );
      if (
        !this.send({
          type: "cloudflare-publication",
          data: {
            trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
            generation: entry.generation,
            connectionEpoch: this.getControlConnectionEpoch(),
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      ) {
        if (tracksNewSucceeded && createdTrackName && createdMid) {
          let compensationError: unknown = null;
          try {
            const sessionDescription =
              await getLocalSessionDescription(peerConnection);
            const closeResult = await this.request("tracks-close", {
              tracks: [{ mid: createdMid }],
              sessionDescription,
              force: false,
            });
            if (closeResult.sessionDescription)
              await peerConnection.setRemoteDescription(
                closeResult.sessionDescription,
              );
          } catch (error) {
            compensationError = error;
            mediaDebug("cloudflare.tracks-close-compensation-failed", {
              source: entry.source,
              trackName: createdTrackName,
              mid: createdMid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if (compensationError && error instanceof Error)
            Object.assign(error, { compensationError });
        }
        if (sender) {
          try {
            const transceiver = peerConnection
              .getTransceivers()
              .find((t) => t.sender === sender);
            if (transceiver && transceiver.direction !== "recvonly") {
              transceiver.direction = "inactive";
            }
            peerConnection.removeTrack(sender);
          } catch {}
        }
        const createdProducer = this.producers.get(entry.source);
        if (
          createdProducer &&
          createdTrackName &&
          createdProducer.trackName === createdTrackName
        ) {
          this.producers.delete(entry.source);
          this.sourceTransmission.delete(entry.source);
        }
        if (peerConnection.signalingState !== "stable") {
          try {
            await peerConnection.setLocalDescription({ type: "rollback" });
          } catch {}
        }
        this.sourceOperations.delete(entry.source);
      }
      if (
        error instanceof Error &&
        error.message.includes("MEDIA_SESSION_CLOSED")
      ) {
        this.closeMedia();
      }
      throw error;
    }
  }

  reannounceLocalPublications(
    this: CloudflareSessionLike,
    { connectionEpoch }: { connectionEpoch: number },
  ) {
    this.controlConnectionEpoch = connectionEpoch;

    for (const [source, producer] of this.producers) {
      const trackName = producer.trackName;
      if (!trackName) continue;
      const ownerSource = producer.ownerSource || null;
      const generation = producer.generation || 0;
      const sent = this.send({
        type: "cloudflare-publication",
        data: {
          trackName,
          source,
          ownerSource,
          generation,
          connectionEpoch: this.controlConnectionEpoch,
          sessionId: this.sessionId,
          variantId: producer.variantId,
          codec: producer.codec,
        },
      });
      if (!sent) {
        mediaDebug("cloudflare.reannounce-send-failed", { source, trackName });
      }
    }
    return Promise.resolve(true);
  }

  async recoverRemotePublication(
    this: CloudflareSessionLike,
    trackName: string,
    expectedReceiverIncarnation?: string,
    generation = this.sessionGeneration,
  ) {
    const publication = this.publications.get(trackName);
    const current = this.consumers.get(trackName);
    const peerConnection = this.peerConnection;
    const mid =
      current?.mid ||
      [...this.remoteByMid.entries()].find(
        ([, candidate]) => candidate.trackName === trackName,
      )?.[0];
    if (
      !publication ||
      !current ||
      !peerConnection ||
      !mid ||
      generation !== this.sessionGeneration ||
      (expectedReceiverIncarnation &&
        current.receiverIncarnationId !== expectedReceiverIncarnation)
    )
      return false;
    return this.enqueueNegotiation(async () => {
      this.assertCurrentSession(peerConnection, generation);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate) => String(candidate.mid) === String(mid));
      if (transceiver && transceiver.direction !== "inactive")
        transceiver.direction = "inactive";
      this.consumers.delete(trackName);
      this.subscribedTrackNames.delete(trackName);
      this.remoteByMid.delete(String(mid));
      this.pendingRemoteTracks.delete(String(mid));
      this.rtpSamples.delete(trackName);
      try {
        current.track?.stop?.();
      } catch {}
      this.onRemoteTrackEnded?.(current);
      const offer = await peerConnection.createOffer();
      this.assertCurrentSession(peerConnection, generation);
      await peerConnection.setLocalDescription(offer);
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      const result = await this.request("tracks-close", {
        tracks: [{ mid }],
        sessionDescription,
        force: false,
      });
      this.assertCurrentSession(peerConnection, generation);
      if (result.sessionDescription?.type === "offer") {
        await peerConnection.setRemoteDescription(result.sessionDescription);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await this.request("renegotiate", {
          sessionDescription: await getLocalSessionDescription(peerConnection),
        });
      } else if (result.sessionDescription) {
        await peerConnection.setRemoteDescription(result.sessionDescription);
      }
      this.assertCurrentSession(peerConnection, generation);
      return Boolean(
        await this.subscribePublicationBatch([publication], generation),
      );
    });
  }

  subscribe(
    this: CloudflareSessionLike,
    publication: CloudflarePublication,
    generation = this.sessionGeneration,
  ) {
    return this.subscribePublications([publication], generation);
  }

  async startSubscriptions(this: CloudflareSessionLike) {
    await this.initialize();
    this.subscriptionsStarted = true;
    const publications = [...this.publications.values()];
    for (
      let index = 0;
      index < publications.length;
      index += MAX_TRACKS_PER_REQUEST
    )
      await this.subscribePublications(
        publications.slice(index, index + MAX_TRACKS_PER_REQUEST),
        this.sessionGeneration,
      );
  }

  subscribePublications(
    this: CloudflareSessionLike,
    publications: CloudflarePublication[],
    generation = this.sessionGeneration,
  ) {
    const eligible = publications.filter((publication) => {
      const trackName = publication?.trackName;
      return (
        trackName &&
        generation === this.sessionGeneration &&
        this.sessionId &&
        this.peerConnection &&
        !this.consumers.has(trackName) &&
        !this.subscribedTrackNames.has(trackName) &&
        !this.subscriptionTasks.has(trackName)
      );
    });
    if (!eligible.length) return Promise.resolve(false);
    const task = this.enqueueNegotiation(() =>
      this.subscribePublicationBatch(eligible, generation),
    );
    const tracked = task.finally(() => {
      for (const publication of eligible) {
        const trackName = publication.trackName;
        if (trackName && this.subscriptionTasks.get(trackName) === tracked)
          this.subscriptionTasks.delete(trackName);
      }
    });
    for (const publication of eligible) {
      const trackName = publication.trackName;
      if (trackName) this.subscriptionTasks.set(trackName, tracked);
    }
    tracked.catch(() => {});
    return tracked;
  }

  async subscribePublication(
    this: CloudflareSessionLike,
    publication: CloudflarePublication,
    generation: number,
  ) {
    return this.subscribePublicationBatch([publication], generation);
  }

  async subscribePublicationBatch(
    this: CloudflareSessionLike,
    publications: CloudflarePublication[],
    generation: number,
  ) {
    const active = publications.filter(
      (publication) =>
        publication.trackName != null &&
        this.publications.get(publication.trackName) === publication,
    );
    if (!active.length) return false;
    const peerConnection = this.peerConnection;
    if (
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !peerConnection
    )
      return false;
    const result = await this.request("tracks-new", {
      tracks: active.map((publication) => ({
        location: "remote",
        sessionId: publication.sessionId,
        trackName: publication.trackName,
      })),
    });
    this.assertCurrentSession(peerConnection, generation);
    for (const publication of active) {
      if (
        !publication.trackName ||
        this.publications.get(publication.trackName) !== publication
      )
        continue;
      const track = result.tracks?.find(
        (candidate) => candidate.trackName === publication.trackName,
      );
      if (track?.mid == null)
        throw new Error("Cloudflare subscription track MID is missing");
      const mid = String(track.mid);
      this.remoteByMid.set(mid, publication);
      this.subscribedTrackNames.add(publication.trackName);
      const pending = this.pendingRemoteTracks.get(mid) || [];
      this.pendingRemoteTracks.delete(mid);
      for (const event of pending) this.handleRemoteTrack(event, publication);
    }
    this.lastReceivedConsumerParams = result;
    if (result.sessionDescription?.type === "offer") {
      await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      this.assertCurrentSession(peerConnection, generation);
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      await this.request("renegotiate", {
        sessionDescription,
      });
      this.assertCurrentSession(peerConnection, generation);
    } else if (result.sessionDescription) {
      await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
    }
    return true;
  }

  async removeSource(this: CloudflareSessionLike, source: string) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.enqueueNegotiation(() => this.removeSourceInternal(key)),
    );
  }

  async removeSourceInternal(this: CloudflareSessionLike, source: string) {
    const current = this.producers.get(source);
    if (!current) return;
    const { generation, peerConnection } = this.currentSession();
    if (this.producers.get(source) !== current) return;
    try {
      peerConnection.removeTrack(current.sender);
      const offer = await peerConnection.createOffer();
      this.assertCurrentSession(peerConnection, generation);
      await peerConnection.setLocalDescription(offer);
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      const result = await this.request("tracks-close", {
        tracks: [{ mid: current.mid }],
        sessionDescription,
        force: false,
      });
      this.assertCurrentSession(peerConnection, generation);
      if (result.sessionDescription)
        await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      this.producers.delete(source);
      if (
        !this.send({
          type: "cloudflare-publication",
          data: {
            trackName: current.trackName,
            source,
            ownerSource: current.ownerSource || null,
            generation: current.generation,
            connectionEpoch: this.getControlConnectionEpoch(),
            closed: true,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      ) {
        if (
          error instanceof Error &&
          error.message.includes("MEDIA_SESSION_CLOSED")
        ) {
          this.closeMedia();
        }
      }
      throw error;
    }
  }

  shouldReceive(
    this: CloudflareSessionLike,
    userId: string | undefined,
    source: string,
    ownerSource: string | null = null,
  ) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return !(source === "screen-audio" && ownerSource !== "system-audio");
  }

  async setSourceTransmission(
    this: CloudflareSessionLike,
    source: string,
    enabled: boolean,
  ) {
    const key = String(source || "");
    const value = Boolean(enabled);
    this.sourceTransmission.set(key, value);
    const entry = this.producers.get(key);
    if (!entry) return false;
    try {
      if (entry.track) entry.track.enabled = value;
    } catch {}
    if (entry.sender?.getParameters && entry.sender?.setParameters) {
      const parameters = entry.sender.getParameters();
      const encodings = Array.isArray(parameters.encodings)
        ? parameters.encodings
        : [];
      if (!encodings.length) return true;
      parameters.encodings = encodings;
      for (const encoding of encodings) encoding.active = value;
      try {
        await entry.sender.setParameters(parameters);
      } catch (error) {
        const errorName =
          error && typeof error === "object" && "name" in error
            ? String(error.name)
            : "";
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(errorName)
        )
          return true;
        throw error;
      }
    }
    return true;
  }

  async updateAudioBitrate(
    this: CloudflareSessionLike,
    source: string,
    maxBitrate: number,
  ) {
    const entry = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (!entry || entry.track?.kind !== "audio") return false;
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    return this.updateSenderParameters(entry, {
      maxBitrate: Math.floor(bitrate),
      priority: "high",
      networkPriority: "high",
    });
  }

  async updateVideoBitrate(
    this: CloudflareSessionLike,
    source: string,
    maxBitrate: number,
  ) {
    const entry = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (!entry || entry.track?.kind !== "video") return false;
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    return this.updateSenderParameters(entry, {
      maxBitrate: Math.floor(bitrate),
    });
  }

  configureVideoSender(
    this: CloudflareSessionLike,
    sender: RTCRtpSender,
    entry: CloudflareSourceInput,
  ) {
    if (entry?.track?.kind !== "video") return Promise.resolve(false);
    const settings = entry.track.getSettings?.() || {};
    const requested = this.getVideoSettings?.(entry.source) || {};
    return applyRtpSenderSettings(
      sender,
      buildVideoProduceOptions({
        width: settings.width,
        height: settings.height,
        frameRate:
          settings.frameRate ||
          (typeof requested.frameRate === "number"
            ? requested.frameRate
            : undefined),
        qualityPriority:
          typeof requested.qualityPriority === "string"
            ? requested.qualityPriority
            : undefined,
        screen: entry.source === "screen",
        maxBitrate:
          typeof requested.maxBitrate === "number"
            ? requested.maxBitrate
            : null,
      }),
    );
  }

  async updateSenderParameters(
    this: CloudflareSessionLike,
    entry: CloudflareSourceEntry,
    updates: Record<string, unknown>,
  ) {
    if (!entry?.sender?.getParameters || !entry.sender?.setParameters)
      return false;
    const parameters = entry.sender.getParameters();
    const encodings = Array.isArray(parameters.encodings)
      ? parameters.encodings
      : [];
    if (!encodings.length) return false;
    parameters.encodings = encodings;
    for (const encoding of encodings) Object.assign(encoding, updates);
    await entry.sender.setParameters(parameters);
    return true;
  }

  async setRemoteReceiving(
    this: CloudflareSessionLike,
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry = this.consumers.get(String(userIdOrKey));
      return entry
        ? this.setRemoteReceiving(
            String(entry.userId || ""),
            String(entry.source || ""),
            sourceOrReceiving,
          )
        : false;
    }
    const userId = String(userIdOrKey);
    const source = String(sourceOrReceiving || "");
    const receiving = Boolean(receivingValue);
    this.remoteReceiving.set(`${userId}:${source}`, receiving);
    for (const entry of this.consumers.values()) {
      if (String(entry.userId) !== userId || entry.source !== source) continue;
      entry.receiving = receiving;
      try {
        entry.track.enabled = receiving;
      } catch {}
    }
    return true;
  }

  setJitterBufferConfig() {}
}
