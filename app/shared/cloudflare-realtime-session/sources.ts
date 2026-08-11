import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import { buildVideoProduceOptions } from "../video-settings.ts";
import { applyRtpSenderSettings } from "../rtp-sender-settings.ts";

import {
  MAX_TRACKS_PER_REQUEST,
  getLocalSessionDescription,
} from "./helpers.ts";
export class CloudflareSourcesMethods {
  [key: string]: any;
  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(() => this.addSourceInternal(entry));
    });
  }

  enqueueSourceOperation(source, operation) {
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

  async addSourceInternal(entry) {
    const { generation, peerConnection } = this.currentSession();
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    else if (entry.track && "enabled" in entry.track)
      entry.track.enabled = this.sourceTransmission.get(entry.source) !== false;
    const current = this.producers.get(entry.source);
    if (current) {
      const previousTrack = current.track;
      try {
        await current.sender.replaceTrack(entry.track);
        this.assertCurrentSession(peerConnection, generation);
        current.track = entry.track;
        current.ownerSource = entry.ownerSource || null;
        await this.configureVideoSender(current.sender, entry);
        await this.setSourceTransmission(
          entry.source,
          this.sourceTransmission.get(entry.source),
        );
      } catch (error) {
        try {
          await current.sender.replaceTrack(previousTrack);
        } catch {}
        current.track = previousTrack;
        throw error;
      }
      return;
    }
    let sender = null;
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
          encodings[0] = {} as any;
        parameters.encodings = encodings;
        encodings[0].maxBitrate = entry.audioBitrate || policy.maxBitrateBps;
        encodings[0].priority = policy.priority;
        encodings[0].networkPriority = policy.priority;
        try {
          await sender.setParameters(parameters);
        } catch {}
      }
      if (entry.track.kind === "video")
        await this.configureVideoSender(sender, entry);
      this.assertCurrentSession(peerConnection, generation);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate) => candidate.sender === sender);
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
      });
      await this.setSourceTransmission(
        entry.source,
        this.sourceTransmission.get(entry.source),
      );
      if (
        !this.send({
          type: "cloudflare-publication",
          data: {
            trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      )
        this.closeMedia();
      throw error;
    }
  }

  subscribe(publication, generation = this.sessionGeneration) {
    return this.subscribePublications([publication], generation);
  }

  async startSubscriptions() {
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

  subscribePublications(publications, generation = this.sessionGeneration) {
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
      for (const publication of eligible)
        if (this.subscriptionTasks.get(publication.trackName) === tracked)
          this.subscriptionTasks.delete(publication.trackName);
    });
    for (const publication of eligible)
      this.subscriptionTasks.set(publication.trackName, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async subscribePublication(publication, generation) {
    return this.subscribePublicationBatch([publication], generation);
  }

  async subscribePublicationBatch(publications, generation) {
    const active = publications.filter(
      (publication) =>
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
      if (this.publications.get(publication.trackName) !== publication)
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

  async removeSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.enqueueNegotiation(() => this.removeSourceInternal(key)),
    );
  }

  async removeSourceInternal(source) {
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
            closed: true,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      )
        this.closeMedia();
      throw error;
    }
  }

  shouldReceive(userId, source, ownerSource = null) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return !(source === "screen-audio" && ownerSource !== "system-audio");
  }

  async setSourceTransmission(source, enabled) {
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
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(error?.name)
        )
          return true;
        throw error;
      }
    }
    return true;
  }

  async updateAudioBitrate(source, maxBitrate) {
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

  async updateVideoBitrate(source, maxBitrate) {
    const entry = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (!entry || entry.track?.kind !== "video") return false;
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    return this.updateSenderParameters(entry, {
      maxBitrate: Math.floor(bitrate),
    });
  }

  configureVideoSender(sender, entry) {
    if (entry?.track?.kind !== "video") return Promise.resolve(false);
    const settings = entry.track.getSettings?.() || {};
    const requested = this.getVideoSettings?.(entry.source) || {};
    return applyRtpSenderSettings(
      sender,
      buildVideoProduceOptions({
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate || requested.frameRate,
        qualityPriority: requested.qualityPriority,
        screen: entry.source === "screen",
        maxBitrate: requested.maxBitrate,
      }),
    );
  }

  async updateSenderParameters(entry, updates) {
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

  async setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry = this.consumers.get(String(userIdOrKey));
      return entry
        ? this.setRemoteReceiving(entry.userId, entry.source, sourceOrReceiving)
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
