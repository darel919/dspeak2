import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import { buildVideoProduceOptions } from "../video-settings.ts";
import { applyRtpSenderSettings } from "../rtp-sender-settings.ts";
import { mediaDebug } from "../media-debug.ts";
import type {
  CloudflareConsumerEntry,
  CloudflarePublication,
  CloudflareRemoteTrackBinding,
  CloudflareSessionLike,
  CloudflareSourceEntry,
  CloudflareSourceInput,
  CloudflareSourceRequest,
  CloudflareSubscriptionBatchOptions,
  CloudflareSubscriptionGuardPhase,
} from "../types/cloudflare-media.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type MediaCommandResult,
} from "../types/boundary.ts";

interface CloudflarePublicationData extends CloudflarePublication {
  target?: Record<string, unknown>;
  targetAdjusted?: boolean;
}

import {
  MAX_TRACKS_PER_REQUEST,
  getLocalSessionDescription,
} from "./helpers.ts";

export function bindingStillOwnedForCompensation(
  session: CloudflareSessionLike,
  binding: CloudflareRemoteTrackBinding,
  {
    peerConnection,
    sessionGeneration,
    sessionId,
    expectedConsumer,
  }: {
    peerConnection: RTCPeerConnection;
    sessionGeneration: number;
    sessionId: string;
    expectedConsumer?: CloudflareConsumerEntry;
  },
): boolean {
  if (
    session.peerConnection !== peerConnection ||
    session.sessionGeneration !== sessionGeneration ||
    session.sessionId !== sessionId
  )
    return false;
  const mappedPublication = session.remoteByMid.get(binding.mid);
  if (mappedPublication && mappedPublication !== binding.publication)
    return false;
  const current = session.consumers.get(binding.trackName);
  if (!current) return true;
  if (current.mid != null && String(current.mid) !== binding.mid) return true;
  if (
    binding.consumer &&
    current === binding.consumer &&
    String(binding.consumer.mid || "") === binding.mid
  )
    return true;
  if (
    expectedConsumer &&
    current === expectedConsumer &&
    String(expectedConsumer.mid || "") === binding.mid
  )
    return true;
  return false;
}

export class CloudflareSourcesMethods {
  async addSource(this: CloudflareSessionLike, entry: CloudflareSourceRequest) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    const sourceInput: CloudflareSourceInput = {
      ...entry,
      generation: entry.generation ?? 1,
    };
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(() => this.addSourceInternal(sourceInput));
    });
  }

  enqueueSourceOperation(
    this: CloudflareSessionLike,
    source: string,
    operation: () => Promise<MediaCommandResult>,
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
        if (this.send) {
          const publicationData: CloudflarePublicationData = {
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
            receivers: current.receivers || [],
            emergency: current.emergency === true,
            score: current.score ?? 0,
          };
          if (isExternalRecord(current.target))
            publicationData.target = current.target;
          if (current.targetAdjusted === true)
            publicationData.targetAdjusted = true;
          this.send({
            type: "cloudflare-publication",
            data: publicationData,
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
        if (!encodings[0]) encodings[0] = {};
        parameters.encodings = encodings;
        encodings[0].maxBitrate = entry.audioBitrate || policy.maxBitrateBps;
        const priority: RTCPriorityType =
          policy.priority === "very-low" ||
          policy.priority === "low" ||
          policy.priority === "medium" ||
          policy.priority === "high"
            ? policy.priority
            : "high";
        encodings[0].priority = priority;
        encodings[0].networkPriority = priority;
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
        canonicalConnectionEpoch: this.getControlConnectionEpoch(),
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
          let compensationError: Error | string | null = null;
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
            compensationError = error instanceof Error ? error : String(error);
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

  async closePulledRemoteTracksSafely(
    this: CloudflareSessionLike,
    bindings: CloudflareRemoteTrackBinding[],
    peerConnection: RTCPeerConnection,
    generation: number,
    expectedConsumer?: CloudflareConsumerEntry,
  ) {
    const uniqueBindings = [
      ...new Map(bindings.map((binding) => [binding.mid, binding])).values(),
    ];
    const sessionId = this.sessionId;
    if (!sessionId) return false;
    const isCurrentSession = () =>
      this.peerConnection === peerConnection &&
      this.sessionGeneration === generation &&
      this.sessionId === sessionId;
    const isOwned = (binding: CloudflareRemoteTrackBinding) =>
      bindingStillOwnedForCompensation(this, binding, {
        peerConnection,
        sessionGeneration: generation,
        sessionId,
        expectedConsumer,
      });
    const blockedMids = new Set(
      uniqueBindings
        .filter((binding) => this.remoteCompensationOwners.has(binding.mid))
        .map((binding) => binding.mid),
    );
    const candidateBindings = uniqueBindings.filter(
      (binding) => !blockedMids.has(binding.mid),
    );
    const currentBindings = () => candidateBindings.filter(isOwned);
    const sameBindings = (
      left: CloudflareRemoteTrackBinding[],
      right: CloudflareRemoteTrackBinding[],
    ) =>
      left.length === right.length &&
      left.every((binding) =>
        right.some((candidate) => candidate.mid === binding.mid),
      );
    const transceivers = new Map<
      string,
      {
        transceiver: RTCRtpTransceiver;
        previousDirection: RTCRtpTransceiverDirection | null;
      }
    >();
    const compensationTokens = new Map<string, symbol>();
    const restoreUnowned = () => {
      const ownedMids = new Set(
        currentBindings().map((binding) => binding.mid),
      );
      for (const binding of candidateBindings) {
        if (ownedMids.has(binding.mid)) continue;
        const token = compensationTokens.get(binding.mid);
        const owner = this.remoteCompensationOwners.get(binding.mid);
        const state = transceivers.get(binding.mid);
        if (
          !token ||
          owner?.token !== token ||
          !state ||
          !state.previousDirection ||
          state.transceiver.direction !== "inactive"
        )
          continue;
        state.transceiver.direction = state.previousDirection;
        this.remoteCompensationOwners.delete(binding.mid);
      }
    };
    const setInactive = (owned: CloudflareRemoteTrackBinding[]) => {
      for (const binding of owned) {
        const state = transceivers.get(binding.mid);
        if (state && state.transceiver.direction !== "inactive")
          state.transceiver.direction = "inactive";
      }
    };
    const initialBindings = currentBindings();
    if (!initialBindings.length || !isCurrentSession()) return false;
    for (const binding of initialBindings) {
      const transceiver = peerConnection
        .getTransceivers?.()
        ?.find((candidate) => String(candidate.mid) === binding.mid);
      if (transceiver) {
        const token = Symbol(binding.mid);
        compensationTokens.set(binding.mid, token);
        transceivers.set(binding.mid, {
          transceiver,
          previousDirection: transceiver.direction,
        });
        this.remoteCompensationOwners.set(binding.mid, {
          token,
          transceiver,
          previousDirection: transceiver.direction,
        });
      }
    }
    try {
      let bindingsToClose: CloudflareRemoteTrackBinding[] | null = null;
      let sessionDescription: { type: string; sdp: string } | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!isCurrentSession()) return false;
        const owned = currentBindings();
        if (!owned.length) return false;
        restoreUnowned();
        setInactive(owned);
        const offer = await peerConnection.createOffer();
        if (!isCurrentSession()) return false;
        const afterOffer = currentBindings();
        restoreUnowned();
        if (!sameBindings(owned, afterOffer)) continue;
        await peerConnection.setLocalDescription(offer);
        if (!isCurrentSession()) return false;
        const afterLocalDescription = currentBindings();
        restoreUnowned();
        if (!sameBindings(owned, afterLocalDescription)) continue;
        const localDescription =
          await getLocalSessionDescription(peerConnection);
        if (!isCurrentSession()) return false;
        const afterGathering = currentBindings();
        restoreUnowned();
        if (!sameBindings(owned, afterGathering)) continue;
        bindingsToClose = afterGathering;
        sessionDescription = localDescription;
        break;
      }
      if (!bindingsToClose || !sessionDescription) return false;
      const finalBindings = currentBindings();
      if (!sameBindings(bindingsToClose, finalBindings)) return false;
      const result = await this.request("tracks-close", {
        tracks: finalBindings.map((binding) => ({ mid: binding.mid })),
        sessionDescription,
        force: false,
      });
      if (!isCurrentSession()) return false;
      if (!finalBindings.every(isOwned)) return false;
      if (result.sessionDescription?.type === "offer") {
        await peerConnection.setRemoteDescription(result.sessionDescription);
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
        const answer = await peerConnection.createAnswer();
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
        await peerConnection.setLocalDescription(answer);
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
        const renegotiationDescription =
          await getLocalSessionDescription(peerConnection);
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
        await this.request("renegotiate", {
          sessionDescription: renegotiationDescription,
        });
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
      } else if (result.sessionDescription) {
        await peerConnection.setRemoteDescription(result.sessionDescription);
        if (!isCurrentSession()) return false;
        if (!finalBindings.every(isOwned)) return false;
      }
      restoreUnowned();
      const cleanupBindings = finalBindings.filter(isOwned);
      for (const binding of cleanupBindings) {
        const mappedPublication = this.remoteByMid.get(binding.mid);
        if (!mappedPublication || mappedPublication === binding.publication) {
          this.remoteByMid.delete(binding.mid);
          this.pendingRemoteTracks.delete(binding.mid);
        }
        const current = this.consumers.get(binding.trackName);
        const ownedConsumer =
          current &&
          current.mid != null &&
          String(current.mid) === binding.mid &&
          ((binding.consumer && current === binding.consumer) ||
            (expectedConsumer && current === expectedConsumer))
            ? current
            : null;
        if (ownedConsumer) {
          try {
            ownedConsumer.track?.stop?.();
          } catch {}
          this.consumers.delete(binding.trackName);
          this.onRemoteTrackEnded?.(ownedConsumer);
        }
        const hasOtherBinding = [...this.remoteByMid.values()].some(
          (publication) => publication.trackName === binding.trackName,
        );
        if (!hasOtherBinding && !this.consumers.has(binding.trackName)) {
          this.subscribedTrackNames.delete(binding.trackName);
          this.rtpSamples.delete(binding.trackName);
        }
      }
      return true;
    } catch (error) {
      mediaDebug("cloudflare.remote-track-compensation-failed", {
        mids: uniqueBindings.map((binding) => binding.mid),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      for (const [mid, token] of compensationTokens) {
        if (this.remoteCompensationOwners.get(mid)?.token === token)
          this.remoteCompensationOwners.delete(mid);
      }
    }
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
    let recoveredMid: string | undefined;
    let recoveredConsumer: CloudflareConsumerEntry | undefined;
    const isRecoveryStale = (phase: CloudflareSubscriptionGuardPhase) => {
      const active = this.consumers.get(trackName);
      if (
        this.peerConnection !== peerConnection ||
        this.sessionGeneration !== generation ||
        !this.sessionId ||
        this.publications.get(trackName) !== publication
      )
        return true;
      if (phase === "before-bind")
        return (
          (active !== undefined && active !== current) ||
          (active?.receiverIncarnationId !== undefined &&
            expectedReceiverIncarnation !== undefined &&
            active.receiverIncarnationId !== expectedReceiverIncarnation)
        );
      if (recoveredConsumer === undefined && active !== undefined) {
        if (!recoveredMid || active.mid !== recoveredMid) return true;
        recoveredConsumer = active;
        return false;
      }
      return (
        recoveredConsumer !== undefined &&
        (active !== recoveredConsumer || active.mid !== recoveredMid)
      );
    };
    return this.enqueueNegotiation(async () => {
      if (isRecoveryStale("before-bind")) return false;
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
      if (isRecoveryStale("before-bind")) return false;
      await peerConnection.setLocalDescription(offer);
      if (isRecoveryStale("before-bind")) return false;
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      if (isRecoveryStale("before-bind")) return false;
      const result = await this.request("tracks-close", {
        tracks: [{ mid }],
        sessionDescription,
        force: false,
      });
      if (isRecoveryStale("before-bind")) return false;
      if (result.sessionDescription?.type === "offer") {
        await peerConnection.setRemoteDescription(result.sessionDescription);
        if (isRecoveryStale("before-bind")) return false;
        const answer = await peerConnection.createAnswer();
        if (isRecoveryStale("before-bind")) return false;
        await peerConnection.setLocalDescription(answer);
        if (isRecoveryStale("before-bind")) return false;
        await this.request("renegotiate", {
          sessionDescription: await getLocalSessionDescription(peerConnection),
        });
        if (isRecoveryStale("before-bind")) return false;
      } else if (result.sessionDescription) {
        if (isRecoveryStale("before-bind")) return false;
        await peerConnection.setRemoteDescription(result.sessionDescription);
        if (isRecoveryStale("before-bind")) return false;
      }
      return Boolean(
        await this.subscribePublicationBatch([publication], generation, {
          isStale: isRecoveryStale,
          onTrackBound: (binding) => {
            if (binding.trackName === trackName) recoveredMid = binding.mid;
          },
          compensateStale: (bindings) =>
            this.closePulledRemoteTracksSafely(
              bindings,
              peerConnection,
              generation,
              recoveredConsumer,
            ),
        }),
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
    options: CloudflareSubscriptionBatchOptions = {},
  ) {
    const active = publications.filter(
      (publication) =>
        publication.trackName != null &&
        this.publications.get(publication.trackName) === publication,
    );
    if (!active.length || options.isStale?.("before-bind")) return false;
    const peerConnection = this.peerConnection;
    if (
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !peerConnection
    )
      return false;
    const compensate = async (bindings: CloudflareRemoteTrackBinding[]) => {
      if (!bindings.length) return;
      if (options.compensateStale) {
        await options.compensateStale(bindings);
        return;
      }
      await this.closePulledRemoteTracksSafely(
        bindings,
        peerConnection,
        generation,
      );
    };
    const result = await this.request("tracks-new", {
      tracks: active.map((publication) => ({
        location: "remote",
        sessionId: publication.sessionId,
        trackName: publication.trackName,
      })),
    });
    this.assertCurrentSession(peerConnection, generation);
    const bindings: CloudflareRemoteTrackBinding[] = [];
    const captureBoundConsumers = () => {
      for (const binding of bindings) {
        const consumer = this.consumers.get(binding.trackName);
        if (
          consumer?.mid === binding.mid &&
          this.remoteByMid.get(binding.mid) === binding.publication
        )
          binding.consumer = consumer;
      }
    };
    const compensateIfStale = async (
      phase: CloudflareSubscriptionGuardPhase,
    ) => {
      if (!options.isStale?.(phase)) return false;
      await compensate(bindings);
      return true;
    };
    try {
      for (const publication of active) {
        const trackName = publication.trackName;
        if (!trackName)
          throw new Error("Cloudflare subscription track name is missing");
        const track = result.tracks?.find(
          (candidate) => candidate.trackName === trackName,
        );
        if (track?.mid == null)
          throw new Error("Cloudflare subscription track MID is missing");
        bindings.push({
          trackName,
          mid: String(track.mid),
          publication,
        });
      }
      if (await compensateIfStale("before-bind")) return false;
      for (const binding of bindings) {
        if (await compensateIfStale("before-bind")) return false;
        if (this.publications.get(binding.trackName) !== binding.publication) {
          await compensate(bindings);
          return false;
        }
        this.remoteByMid.set(binding.mid, binding.publication);
        this.subscribedTrackNames.add(binding.trackName);
        options.onTrackBound?.(binding);
        const pending = this.pendingRemoteTracks.get(binding.mid) || [];
        this.pendingRemoteTracks.delete(binding.mid);
        for (const event of pending)
          this.handleRemoteTrack(event, binding.publication);
        captureBoundConsumers();
      }
      if (await compensateIfStale("after-bind")) return false;
      if (result.sessionDescription?.type === "offer") {
        if (await compensateIfStale("after-bind")) return false;
        await peerConnection.setRemoteDescription(result.sessionDescription);
        captureBoundConsumers();
        this.assertCurrentSession(peerConnection, generation);
        const answer = await peerConnection.createAnswer();
        if (await compensateIfStale("after-bind")) return false;
        await peerConnection.setLocalDescription(answer);
        this.assertCurrentSession(peerConnection, generation);
        const sessionDescription =
          await getLocalSessionDescription(peerConnection);
        if (await compensateIfStale("after-bind")) return false;
        await this.request("renegotiate", {
          sessionDescription,
        });
        this.assertCurrentSession(peerConnection, generation);
        if (await compensateIfStale("after-bind")) return false;
      } else if (result.sessionDescription) {
        if (await compensateIfStale("after-bind")) return false;
        await peerConnection.setRemoteDescription(result.sessionDescription);
        captureBoundConsumers();
        this.assertCurrentSession(peerConnection, generation);
        if (await compensateIfStale("after-bind")) return false;
      }
      this.lastReceivedConsumerParams = result;
      return true;
    } catch (error) {
      await compensate(bindings);
      throw error;
    }
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
    const desired = this.desiredRemoteSources;
    if (desired instanceof Map && desired.size > 0)
      return desired.get(String(source)) !== false;
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
        const errorName = error instanceof Error ? error.name : "";
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
          (isExternalNumber(requested.frameRate)
            ? requested.frameRate
            : undefined),
        qualityPriority: isExternalString(requested.qualityPriority)
          ? requested.qualityPriority
          : undefined,
        screen: entry.source === "screen",
        maxBitrate: isExternalNumber(requested.maxBitrate)
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
    if (isExternalBoolean(sourceOrReceiving) && receivingValue === undefined) {
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

  setJitterBufferConfig(
    this: CloudflareSessionLike,
    {
      minDelayMs = 0,
      targetDelayMs = 20,
    }: {
      minDelayMs?: number;
      targetDelayMs?: number;
    } = {},
  ) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    const minimumDelaySeconds = this.jitterBufferMinimumDelay;
    for (const entry of this.consumers.values()) {
      const receiver = entry?.receiver;
      if (!receiver) continue;
      try {
        /* SAFETY: This browser-compatible receiver exposes the optional jitter buffer properties checked below. */
        const configurableReceiver = receiver as RTCRtpReceiver &
          Record<string, unknown>;
        if (configurableReceiver.jitterBufferMinimumDelay != null)
          configurableReceiver.jitterBufferMinimumDelay = minimumDelaySeconds;
        if (configurableReceiver.jitterBufferTarget != null)
          configurableReceiver.jitterBufferTarget =
            this.jitterBufferTargetDelay;
      } catch {}
    }
    return { ok: true as const };
  }
}
