import { applyRtpSenderSettings } from "../rtp-sender-settings.js";
import {
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
} from "../native-p2p-common.js";

export class NativeP2pSourcesMethods {
  async publishSource(source, track, stream, metadata = {}) {
    const key = String(source || "");
    if (!key) throw new Error("A P2P source identifier is required");
    return this.enqueueSourceOperation(key, () =>
      this.publishSourceInternal(key, track, stream, metadata),
    );
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

  async publishSourceInternal(source, track, stream, metadata = {}) {
    const previous = this.localSources.get(source);
    if (!this.sourceTransmission.has(source))
      this.sourceTransmission.set(source, track?.enabled !== false);
    else if (track && "enabled" in track)
      track.enabled = this.sourceTransmission.get(source) !== false;
    const initialStates = new Map(
      [...this.connections.values()].map((state) => [state.peerId, state]),
    );
    const entry = {
      track,
      stream,
      ownerSource: metadata?.ownerSource || null,
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
        this.signal(state.peerId, { sourceRemoved: { source } });
      }),
    );
    const rollbackFailure = rollbackResults.find(
      (result) => result.status === "rejected",
    );
    if (rollbackFailure)
      this.fail("source-rollback-failed", rollbackFailure.reason);
    throw failure.reason;
  }

  async setSourceTransmission(source, enabled) {
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

  usesStereoAudio() {
    return [...this.localSources].some(
      ([source, entry]) =>
        entry.track?.kind === "audio" && this.getAudioStereo?.(source),
    );
  }

  setRemoteReceiving(peerId, source, receiving) {
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

  async setSenderReceiving(state, source, receiving) {
    state.sourceReceiving.set(source, Boolean(receiving));
    return this.setSenderActive(
      state.senders.get(source),
      Boolean(receiving) && (this.sourceTransmission?.get(source) ?? true),
    );
  }

  async setSenderActive(sender, active) {
    if (!sender) return false;
    if (!sender.getParameters || !sender.setParameters) return false;
    return this.updateSender(sender, async () => {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return false;
      for (const encoding of parameters.encodings)
        encoding.active = Boolean(active);
      try {
        await sender.setParameters(parameters);
      } catch (error) {
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(error?.name)
        )
          return false;
        throw error;
      }
      return true;
    });
  }

  updateSender(sender, operation) {
    const previous = this.senderOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.senderOperations.set(sender, current);
    return current.finally(() => {
      if (this.senderOperations.get(sender) === current)
        this.senderOperations.delete(sender);
    });
  }

  async attachSource(state, source, entry) {
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
          await this.configureSender(existing, source, previousTrack);
          await this.setSenderReceiving(state, source, previousReceiving);
        } catch {}
        this.fail("track-replacement-failed", error);
        throw error;
      }
      this.signal(state.peerId, { sourceRestored: { source } });
      return existing;
    }
    let sender = null;
    let announced = false;
    try {
      sender = state.pc.addTrack(
        entry.track,
        entry.stream || new MediaStream([entry.track]),
      );
      applyP2pVideoCodecPreferences(state.pc);
      state.senders.set(source, sender);
      this.signal(state.peerId, {
        source: {
          trackId: entry.track.id,
          source,
          ownerSource: entry.ownerSource || null,
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
      if (announced) this.signal(state.peerId, { sourceRemoved: { source } });
      this.fail("sender-configuration-failed", error);
      throw error;
    }
    if (state.pc.remoteDescription && state.pc.signalingState === "stable")
      this.schedulePeerNegotiation(state);
    return sender;
  }

  updateTrack(sender, operation) {
    const previous = this.trackOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.trackOperations.set(sender, current);
    return current.finally(() => {
      if (this.trackOperations.get(sender) === current)
        this.trackOperations.delete(sender);
    });
  }

  async unpublishSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.unpublishSourceInternal(key),
    );
  }

  async unpublishSourceInternal(source) {
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
        this.signal(state.peerId, { sourceRemoved: { source } });
      }),
    );
  }

  async configureSender(sender, source, track) {
    const options = this.getSenderOptions?.(source, track);
    if (!options) return false;
    return this.updateSender(sender, () =>
      applyRtpSenderSettings(sender, options),
    );
  }

  configureStateSenders(state) {
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

  reconfigureSource(source) {
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
