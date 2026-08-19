import { applyRtpSenderSettings } from "../rtp-sender-settings.ts";
import {
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
} from "../native-p2p-common.ts";
import type {
  NativeP2pConnectionState,
  NativeP2pLocalSourceEntry,
  NativeP2pMeshSurface,
} from "../types/native-p2p.ts";
export class NativeP2pSourcesMethods {
  async publishSource(
    this: NativeP2pMeshSurface,
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata: Record<string, unknown> = {},
  ) {
    const key = String(source || "");
    if (!key) throw new Error("A P2P source identifier is required");
    return this.enqueueSourceOperation(key, () =>
      this.publishSourceInternal(key, track, stream, metadata),
    );
  }

  enqueueSourceOperation(
    this: NativeP2pMeshSurface,
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

  async publishSourceInternal(
    this: NativeP2pMeshSurface,
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata: Record<string, unknown> = {},
  ) {
    const previous = this.localSources.get(source);
    if (!this.sourceTransmission.has(source))
      this.sourceTransmission.set(source, track?.enabled !== false);
    else if (track && "enabled" in track)
      track.enabled = this.sourceTransmission.get(source) !== false;
    const initialStates = new Map(
      [...this.connections.values()].map((state) => [state.peerId, state]),
    );
    const committedGeneration =
      Number.isSafeInteger(Number(metadata.generation)) &&
      Number(metadata.generation) > 0
        ? Number(metadata.generation)
        : 0;
    const entry: NativeP2pLocalSourceEntry = {
      track,
      stream,
      ownerSource:
        typeof metadata.ownerSource === "string" ? metadata.ownerSource : null,
      generation:
        Number.isSafeInteger(Number(metadata.generation)) &&
        Number(metadata.generation) > 0
          ? Number(metadata.generation)
          : undefined,
    };
    this.localSources.set(source, entry);
    const results = await Promise.allSettled(
      [...this.connections.values()].map((state) =>
        this.attachSource(state, source, entry),
      ),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) return;
    if (previous) this.localSources.set(source, previous);
    else this.localSources.delete(source);
    const rollbackStates = [
      ...new Set([...initialStates.values(), ...this.connections.values()]),
    ];
    const rollbackResults = await Promise.allSettled(
      rollbackStates.map(async (state) => {
        if (state.closed || !this.connections.has(state.peerId)) return;
        const sender = state.senders.get(source);
        if (previous) {
          if (sender) {
            await this.updateTrack(sender, async () => {
              await sender.replaceTrack(previous.track);
              await this.configureSender(sender, source, previous.track);
              await this.setSenderReceiving(
                state,
                source,
                state.sourceReceiving.get(source) ?? true,
              );
            });
          } else {
            await this.attachSource(state, source, previous);
          }
          return;
        }
        if (!sender) return;
        await this.updateTrack(sender, () => sender.replaceTrack(null));
        state.senders.delete(source);
        state.sourceReceiving.delete(source);
        const rollbackGeneration = committedGeneration;
        const connectionEpoch = this.getControlConnectionEpoch?.() || 0;
        this.signal(state.peerId, {
          sourceRemoved: {
            source,
            connectionEpoch,
            ...(rollbackGeneration > 0
              ? { generation: rollbackGeneration }
              : {}),
          },
        });
      }),
    );
    const rollbackFailure = rollbackResults.find(
      (result) => result.status === "rejected",
    );
    if (rollbackFailure)
      this.fail("source-rollback-failed", rollbackFailure.reason);
    throw failure.reason;
  }

  async setSourceTransmission(
    this: NativeP2pMeshSurface,
    source: string,
    enabled: boolean,
  ) {
    this.sourceTransmission ||= new Map();
    const value = Boolean(enabled);
    this.sourceTransmission.set(source, value);
    const entry = this.localSources.get(source);
    if (entry?.track && "enabled" in entry.track) entry.track.enabled = value;
    await Promise.all(
      [...this.connections.values()].map((state) => {
        const receiving = state.sourceReceiving.get(source) ?? true;
        return this.setSenderActive(
          state.senders.get(source),
          receiving && value,
        );
      }),
    );
  }

  usesStereoAudio(this: NativeP2pMeshSurface) {
    return [...this.localSources].some(
      ([source, entry]) =>
        entry.track?.kind === "audio" && this.getAudioStereo?.(source),
    );
  }

  setRemoteReceiving(
    this: NativeP2pMeshSurface,
    peerId: string | number | undefined,
    source: string,
    receiving: boolean,
  ) {
    if (peerId === undefined) return false;
    const state = this.connections.get(String(peerId));
    state?.remoteReceiving.set(source, Boolean(receiving));
    this.signal(String(peerId), {
      sourceReceiving: {
        source,
        receiving: Boolean(receiving),
      },
    });
    if (state)
      state.expectedRemoteSources = countEnabledP2pSources(
        state.remoteSourceNames,
        state.remoteReceiving,
      );
  }

  async setSenderReceiving(
    this: NativeP2pMeshSurface,
    state: NativeP2pConnectionState,
    source: string,
    receiving: boolean,
  ) {
    state.sourceReceiving.set(source, Boolean(receiving));
    return this.setSenderActive(
      state.senders.get(source),
      Boolean(receiving) && (this.sourceTransmission?.get(source) ?? true),
    );
  }

  async setSenderActive(
    this: NativeP2pMeshSurface,
    sender: RTCRtpSender | undefined,
    active: boolean,
  ) {
    if (!sender) return false;
    if (!sender.getParameters || !sender.setParameters) return false;
    return this.updateSender(sender, async () => {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return false;
      for (const encoding of parameters.encodings)
        encoding.active = Boolean(active);
      try {
        await sender.setParameters(parameters);
      } catch (error: unknown) {
        const errorName =
          error instanceof DOMException
            ? error.name
            : error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "";
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(errorName)
        )
          return false;
        throw error;
      }
      return true;
    });
  }

  updateSender(
    this: NativeP2pMeshSurface,
    sender: RTCRtpSender,
    operation: () => Promise<unknown>,
  ) {
    const previous = this.senderOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.senderOperations.set(sender, current);
    return current.finally(() => {
      if (this.senderOperations.get(sender) === current)
        this.senderOperations.delete(sender);
    });
  }

  async attachSource(
    this: NativeP2pMeshSurface,
    state: NativeP2pConnectionState,
    source: string,
    entry: NativeP2pLocalSourceEntry,
  ) {
    const existing = state.senders.get(source);
    if (existing) {
      const previousTrack = existing.track;
      const previousReceiving = state.sourceReceiving.get(source) ?? true;
      try {
        await this.updateTrack(existing, async () => {
          await existing.replaceTrack(entry.track);
          await this.configureSender(existing, source, entry.track);
          await this.setSenderReceiving(
            state,
            source,
            state.sourceReceiving.get(source) ?? true,
          );
        });
      } catch (error) {
        try {
          await this.updateTrack(existing, () =>
            existing.replaceTrack(previousTrack),
          );
          if (previousTrack)
            await this.configureSender(existing, source, previousTrack);
          await this.setSenderReceiving(state, source, previousReceiving);
        } catch {}
        this.fail("track-replacement-failed", error);
        throw error;
      }
      const connectionEpoch = this.getControlConnectionEpoch?.() || 0;
      const restoredGeneration = Number(entry.generation) || 0;
      this.signal(state.peerId, {
        sourceRestored: {
          source,
          connectionEpoch,
          generation: restoredGeneration,
        },
      });
      return existing;
    }
    let sender: RTCRtpSender | null = null;
    let announced = false;
    try {
      sender = state.pc.addTrack(
        entry.track,
        entry.stream || new MediaStream([entry.track]),
      );
      applyP2pVideoCodecPreferences(
        state.pc,
        state.selectedCodec ? [state.selectedCodec] : null,
      );
      state.senders.set(source, sender);
      const connectionEpoch = this.getControlConnectionEpoch?.() || 0;
      this.signal(state.peerId, {
        source: {
          trackId: entry.track.id,
          source,
          ownerSource: entry.ownerSource || null,
          connectionEpoch,
          ...(Number.isFinite(Number(entry.generation)) &&
          Number(entry.generation) > 0
            ? { generation: Math.floor(Number(entry.generation)) }
            : {}),
        },
      });
      announced = true;
      await this.configureSender(sender, source, entry.track);
      await this.setSenderReceiving(
        state,
        source,
        state.sourceReceiving.get(source) ?? true,
      );
    } catch (error) {
      state.senders.delete(source);
      state.sourceReceiving.delete(source);
      try {
        await sender?.replaceTrack(null);
      } catch {}
      if (announced) {
        const removalGeneration = Number(entry.generation) || 0;
        const connectionEpoch = this.getControlConnectionEpoch?.() || 0;
        this.signal(state.peerId, {
          sourceRemoved: {
            source,
            connectionEpoch,
            ...(removalGeneration > 0 ? { generation: removalGeneration } : {}),
          },
        });
      }
      this.fail("sender-configuration-failed", error);
      throw error;
    }
    if (state.pc.remoteDescription && state.pc.signalingState === "stable")
      this.schedulePeerNegotiation(state);
    return sender;
  }

  updateTrack(
    this: NativeP2pMeshSurface,
    sender: RTCRtpSender,
    operation: () => Promise<unknown>,
  ) {
    const previous = this.trackOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.trackOperations.set(sender, current);
    return current.finally(() => {
      if (this.trackOperations.get(sender) === current)
        this.trackOperations.delete(sender);
    });
  }

  async unpublishSource(this: NativeP2pMeshSurface, source: string) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.unpublishSourceInternal(key),
    );
  }

  async unpublishSourceInternal(this: NativeP2pMeshSurface, source: string) {
    const entry = this.localSources.get(source);
    this.localSources.delete(source);
    await Promise.all(
      [...this.connections.values()].map(async (state) => {
        const sender = state.senders.get(source);
        if (!sender) return;
        try {
          await this.updateTrack(sender, () => sender.replaceTrack(null));
        } catch (error) {
          this.fail("track-removal-failed", error);
          throw error;
        }
        state.senders.delete(source);
        state.sourceReceiving.delete(source);
        const removalGeneration = Number(entry?.generation) || 0;
        const connectionEpoch = this.getControlConnectionEpoch?.() || 0;
        this.signal(state.peerId, {
          sourceRemoved: {
            source,
            connectionEpoch,
            ...(removalGeneration > 0 ? { generation: removalGeneration } : {}),
          },
        });
      }),
    );
  }

  async configureSender(
    this: NativeP2pMeshSurface,
    sender: RTCRtpSender,
    source: string,
    track: MediaStreamTrack,
  ) {
    const options = this.getSenderOptions(source, track);
    if (!options) return false;
    return this.updateSender(sender, () =>
      applyRtpSenderSettings(sender, options),
    );
  }

  configureStateSenders(
    this: NativeP2pMeshSurface,
    state: NativeP2pConnectionState,
  ) {
    return Promise.all(
      [...state.senders].map(([source, sender]) => {
        const transceiver = state.pc
          .getTransceivers()
          .find((candidate) => candidate.sender === sender);
        if (transceiver?.mid == null) return false;
        const track = this.localSources.get(source)?.track || sender.track;
        return track
          ? this.configureSender(sender, source, track).then(() =>
              this.setSenderReceiving(
                state,
                source,
                state.sourceReceiving.get(source) ?? true,
              ),
            )
          : false;
      }),
    );
  }

  reconfigureSource(this: NativeP2pMeshSurface, source: string) {
    const entry = this.localSources.get(source);
    if (!entry) return Promise.resolve();
    return Promise.all(
      [...this.connections.values()].map((state) => {
        const sender = state.senders.get(source);
        return sender
          ? this.configureSender(sender, source, entry.track)
          : Promise.resolve(false);
      }),
    );
  }
}

export interface NativeP2pSourcesMethods extends NativeP2pMeshSurface {}
