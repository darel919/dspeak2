import { buildVideoProduceOptions } from "../video-settings.ts";
import { buildVoiceProducerOptions } from "../voice-transport.ts";

export const methods: Record<string, any> = {
  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, () =>
      this.addSourceInternal(entry),
    );
  },

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
  },

  async addSourceInternal(entry) {
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
    if (existing) {
      const track = entry.track.clone();
      try {
        await existing.producer.replaceTrack({ track });
        await this.setSourceTransmission(
          entry.source,
          this.sourceTransmission.get(entry.source),
        );
      } catch (error) {
        try {
          await existing.producer.replaceTrack({ track: existing.track });
          await this.setSourceTransmission(
            entry.source,
            this.sourceTransmission.get(entry.source),
          );
        } catch (rollbackError) {
          this.onError?.(rollbackError);
        }
        track.stop();
        if (previousSource) this.sources.set(entry.source, previousSource);
        else this.sources.delete(entry.source);
        throw error;
      }
      existing.track.stop();
      existing.track = track;
      this.sources.set(entry.source, entry);
      return existing.producer;
    }
    this.sources.set(entry.source, entry);
    if (this.sendTransport) {
      try {
        return await this.publish(entry);
      } catch (error) {
        if (previousSource) this.sources.set(entry.source, previousSource);
        else this.sources.delete(entry.source);
        throw error;
      }
    }
    return null;
  },

  async setSourceTransmission(source, enabled) {
    this.sourceTransmission ||= new Map();
    this.sourceTransmission.set(source, Boolean(enabled));
    const entry = this.producers.get(source);
    if (!entry) return false;
    if (enabled && entry.producer.paused) entry.producer.resume();
    if (!enabled && !entry.producer.paused) entry.producer.pause();
    return true;
  },

  async publish(entry) {
    if (!this.sendTransport || this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    const activePublication = this.sourcePublications.get(entry.source);
    if (activePublication) return activePublication;
    const publication = this.publishSource(entry).finally(() => {
      if (this.sourcePublications.get(entry.source) === publication)
        this.sourcePublications.delete(entry.source);
    });
    this.sourcePublications.set(entry.source, publication);
    return publication;
  },

  async publishSource(entry) {
    const mediaRevision = this.mediaRevision;
    const track = entry.track.clone();
    const settings = track.getSettings?.() || {};
    const requestedVideo = this.getVideoSettings?.(entry.source) || {};
    const selectedBitrate = Number(
      entry.captureSelection?.audio?.maxBitrateBps || entry.roomBitrateBps,
    );
    const appData = {
      source: entry.source,
      ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
      ...(entry.captureSelection
        ? { captureSelection: entry.captureSelection }
        : {}),
    };
    const options =
      track.kind === "audio"
        ? {
            ...buildVoiceProducerOptions(
              track,
              Number.isFinite(selectedBitrate) && selectedBitrate > 0
                ? selectedBitrate
                : this.getAudioBitrate?.(entry.source),
              this.getAudioStereo?.(entry.source),
            ),
            stopTracks: false,
            appData,
          }
        : {
            track,
            stopTracks: false,
            appData,
            ...buildVideoProduceOptions({
              width: settings.width,
              height: settings.height,
              frameRate: settings.frameRate,
              qualityPriority: requestedVideo.qualityPriority,
              screen: entry.source === "screen",
              maxBitrate: requestedVideo.maxBitrate,
            }),
          };
    let producer;
    try {
      producer = await this.sendTransport.produce(options);
    } catch (error) {
      track.stop();
      throw error;
    }
    if (this.closed || mediaRevision !== this.mediaRevision) {
      producer.close();
      track.stop();
      return null;
    }
    this.producers.set(entry.source, { producer, track, source: entry.source });
    await this.setSourceTransmission(
      entry.source,
      this.sourceTransmission.get(entry.source),
    );
    producer.on("transportclose", () => {
      if (this.producers.get(entry.source)?.producer !== producer) return;
      this.producers.delete(entry.source);
      track.stop();
    });
    return producer;
  },

  async removeSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.removeSourceInternal(key),
    );
  },

  async removeSourceInternal(source) {
    this.sources.delete(source);
    const entry = this.producers.get(source);
    if (!entry) return;
    this.producers.delete(source);
    const sent = this.send({
      type: "close-producer",
      data: { producerId: entry.producer.id },
    });
    entry.producer.close();
    entry.track.stop();
    if (sent === false) {
      this.closeMedia();
      throw new Error("Media control is unavailable");
    }
  },

  async updateAudioBitrate(source, maxBitrate) {
    const entry = this.producers.get(source);
    if (!entry || entry.track?.kind !== "audio") return false;
    const bitrate = Number(maxBitrate);
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    await entry.producer.setRtpEncodingParameters({
      maxBitrate: Math.floor(bitrate),
      priority: "high",
      networkPriority: "high",
      dtx: false,
    });
    return true;
  },

  async updateVideoBitrate(source, maxBitrate) {
    const entry = this.producers.get(source);
    if (!entry || entry.track?.kind !== "video") return false;
    const bitrate = Number(maxBitrate);
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    await entry.producer.setRtpEncodingParameters({
      maxBitrate: Math.floor(bitrate),
    });
    return true;
  },
};
