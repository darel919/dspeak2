import { P2P_QUALIFICATION_TIMEOUT_MS } from "./rtc-topology.ts";
import {
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
  P2P_STABILITY_LIVENESS_TIMEOUT_MS,
  countEnabledP2pSources,
  isP2pLivenessExpired,
  isViableP2pPair,
  mediaFlowSnapshot,
  p2pActiveLivenessTimeoutMs,
  requiresP2pLiveness,
  selectedPairSnapshot,
} from "./native-p2p-common.ts";
import type {
  NativeP2pConnectionState,
  NativeP2pHealthMesh,
} from "./types/native-p2p.ts";

export function bindHealthChannel(
  mesh: NativeP2pHealthMesh,
  state: NativeP2pConnectionState,
  channel: RTCDataChannel,
) {
  state.channel = channel;
  channel.onmessage = (event) => {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object") return;
      message = parsed as Record<string, unknown>;
    } catch (_) {
      return;
    }
    if (message.type === "health") {
      state.healthReceived += 1;
      state.lastHealthAt = performance.now();
      if (channel.readyState === "open") {
        try {
          channel.send(
            JSON.stringify({
              type: "health-ack",
              sequence: message.sequence,
            }),
          );
        } catch (error) {
          mesh.fail("health-channel-send-failed", error);
        }
      }
    } else if (message.type === "health-ack") {
      state.healthReceived += 1;
      state.lastHealthAt = performance.now();
    }
  };
  channel.onopen = () => checkQualification(mesh);
  channel.onclose = () => {
    if (requiresP2pLiveness(mesh.mode, mesh.readyReported))
      mesh.fail("health-channel-closed");
  };
}

export function handleConnectionState(
  mesh: NativeP2pHealthMesh,
  state: NativeP2pConnectionState,
) {
  const connectionState = state.pc.connectionState;
  if (connectionState === "failed") mesh.fail("peer-connection-failed");
  if (
    connectionState === "closed" &&
    requiresP2pLiveness(mesh.mode, mesh.readyReported)
  )
    mesh.fail("peer-connection-closed");
  mesh.emitSnapshot();
}

export function handleIceState(
  mesh: NativeP2pHealthMesh,
  state: NativeP2pConnectionState,
) {
  if (state.pc.iceConnectionState === "disconnected") {
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    state.disconnectTimer = setTimeout(() => {
      if (state.pc.iceConnectionState !== "disconnected") return;
      if (!state.restarted) {
        state.restarted = true;
        try {
          state.pc.restartIce();
        } catch (error) {
          mesh.fail("ice-restart-failed", error);
          return;
        }
        state.disconnectTimer = setTimeout(() => {
          if (
            state.pc.iceConnectionState === "disconnected" ||
            state.pc.iceConnectionState === "failed"
          )
            mesh.fail("ice-restart-timeout");
        }, P2P_ICE_RESTART_TIMEOUT_MS);
        return;
      }
      mesh.fail("ice-disconnected");
    }, P2P_DISCONNECT_GRACE_MS);
  } else {
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    state.disconnectTimer = null;
    if (
      state.pc.iceConnectionState === "connected" ||
      state.pc.iceConnectionState === "completed"
    )
      state.restarted = false;
  }
  if (state.pc.iceConnectionState === "failed") mesh.fail("ice-failed");
  mesh.emitSnapshot();
}

export function startQualificationTimeout(mesh: NativeP2pHealthMesh) {
  if (mesh.qualificationTimeout) clearTimeout(mesh.qualificationTimeout);
  mesh.qualificationTimeout = setTimeout(() => {
    if (!mesh.readyReported && mesh.mode === "probing")
      mesh.fail("qualification-timeout");
  }, P2P_QUALIFICATION_TIMEOUT_MS);
}

export function startHealthChecks(mesh: NativeP2pHealthMesh) {
  stopHealthChecks(mesh);
  const runToken = mesh.healthRunToken;
  let sequence = 0;
  const run = async () => {
    if (runToken !== mesh.healthRunToken || mesh.healthCheckRunning) return;
    mesh.healthCheckRunning = true;
    sequence += 1;
    try {
      for (const state of mesh.connections.values()) {
        if (runToken !== mesh.healthRunToken) return;
        const checkedAt = performance.now();
        const requireLiveness = requiresP2pLiveness(
          mesh.mode,
          mesh.readyReported,
        );
        const healthTimeout =
          mesh.mode === "probing"
            ? P2P_STABILITY_LIVENESS_TIMEOUT_MS
            : p2pActiveLivenessTimeoutMs(mesh.connections.size);
        if (state.channel?.readyState === "open") {
          try {
            state.channel.send(
              JSON.stringify({ type: "health", sequence, sentAt: checkedAt }),
            );
          } catch (error) {
            mesh.fail("health-channel-send-failed", error);
          }
        }
        if (
          requireLiveness &&
          isP2pLivenessExpired(state.lastHealthAt, checkedAt, healthTimeout)
        )
          mesh.fail("health-timeout");
        try {
          const report = await state.pc.getStats();
          state.selectedPair = await selectedPairSnapshot(state.pc, report);
          const expectedOutboundEntries = [...mesh.localSources.keys()].flatMap(
            (source) => {
              const enabled =
                (state.sourceReceiving.get(source) ?? true) &&
                (mesh.sourceTransmission?.get(source) ?? true);
              if (!enabled) return [];
              return [
                {
                  key: source,
                  track: state.senders.get(source)?.track || null,
                },
              ];
            },
          );
          const expectedInboundEntries = [...state.remoteTracks.values()]
            .filter(
              (entry) =>
                entry.track &&
                (state.remoteReceiving.get(entry.source) ?? true),
            )
            .map((entry) => ({ key: entry.source, track: entry.track }));
          const expectedInboundSources = [...state.remoteSourceNames].filter(
            (source) => state.remoteReceiving.get(source) !== false,
          );
          const flow = await mediaFlowSnapshot(state.pc, report, {
            outboundTracks: expectedOutboundEntries,
            inboundTracks: expectedInboundEntries,
          });
          const expectedOutboundSources = expectedOutboundEntries.length;
          const countsReady =
            flow.outboundCount >= expectedOutboundSources &&
            flow.inboundCount >= state.expectedRemoteSources &&
            expectedInboundEntries.length >= state.expectedRemoteSources;
          const outboundNeeded = expectedOutboundSources > 0;
          const inboundNeeded = state.expectedRemoteSources > 0;
          const outboundProgressing =
            !outboundNeeded ||
            state.lastOutboundBytes == null ||
            flow.outboundBytes > state.lastOutboundBytes;
          const inboundProgressing =
            !inboundNeeded ||
            state.lastInboundBytes == null ||
            flow.inboundBytes > state.lastInboundBytes;
          for (const entry of expectedOutboundEntries) {
            if (!state.lastOutboundSourceProgressAt.has(entry.key))
              state.lastOutboundSourceProgressAt.set(entry.key, checkedAt);
          }
          for (const source of expectedInboundSources)
            if (!state.lastInboundSourceProgressAt.has(source))
              state.lastInboundSourceProgressAt.set(source, checkedAt);
          for (const entry of flow.outboundFlows) {
            const previous = state.lastOutboundSourceBytes.get(entry.key);
            if (entry.flowing && (previous == null || entry.bytes > previous))
              state.lastOutboundSourceProgressAt.set(entry.key, checkedAt);
            state.lastOutboundSourceBytes.set(entry.key, entry.bytes);
          }
          for (const entry of flow.inboundFlows) {
            const previous = state.lastInboundSourceBytes.get(entry.key);
            if (entry.flowing && (previous == null || entry.bytes > previous))
              state.lastInboundSourceProgressAt.set(entry.key, checkedAt);
            state.lastInboundSourceBytes.set(entry.key, entry.bytes);
          }
          const mediaFlowTimedOut =
            requireLiveness &&
            ((outboundNeeded &&
              expectedOutboundEntries.some((entry) =>
                isP2pLivenessExpired(
                  state.lastOutboundSourceProgressAt.get(entry.key),
                  checkedAt,
                  healthTimeout,
                ),
              )) ||
              (inboundNeeded &&
                expectedInboundSources.some((source) =>
                  isP2pLivenessExpired(
                    state.lastInboundSourceProgressAt.get(source),
                    checkedAt,
                    healthTimeout,
                  ),
                )));
          if (mediaFlowTimedOut) mesh.fail("media-flow-timeout");
          if (outboundProgressing) state.lastOutboundProgressAt = checkedAt;
          if (inboundProgressing) state.lastInboundProgressAt = checkedAt;
          state.mediaReady =
            countsReady && outboundProgressing && inboundProgressing;
          state.lastOutboundBytes = flow.outboundBytes;
          state.lastInboundBytes = flow.inboundBytes;
          if (state.selectedPair && !isViableP2pPair(state.selectedPair))
            mesh.fail("relay-candidate-selected");
        } catch (_) {
          state.selectedPair = null;
          state.mediaReady = false;
        }
      }
      checkQualification(mesh);
      mesh.emitSnapshot();
    } finally {
      if (runToken === mesh.healthRunToken) mesh.healthCheckRunning = false;
    }
  };
  const execute = () =>
    run().catch((error: unknown) => mesh.fail("health-check-failed", error));
  execute();
  mesh.healthInterval = setInterval(
    execute,
    mesh.mode === "probing" ? 250 : 1000,
  );
}

export function stopHealthChecks(mesh: NativeP2pHealthMesh) {
  mesh.healthRunToken += 1;
  mesh.healthCheckRunning = false;
  if (mesh.healthInterval) clearInterval(mesh.healthInterval);
  mesh.healthInterval = null;
  if (mesh.qualificationTimeout) clearTimeout(mesh.qualificationTimeout);
  mesh.qualificationTimeout = null;
}

export function checkQualification(mesh: NativeP2pHealthMesh) {
  if (
    mesh.mode !== "probing" ||
    mesh.readyReported ||
    mesh.connections.size === 0
  )
    return;
  const qualified = [...mesh.connections.values()].filter(
    (state) =>
      state.pc.connectionState === "connected" &&
      state.channel?.readyState === "open" &&
      state.healthReceived >= 3 &&
      state.mediaReady &&
      isViableP2pPair(state.selectedPair),
  );
  if (qualified.length !== mesh.connections.size) return;
  mesh.readyReported = true;
  if (mesh.qualificationTimeout) clearTimeout(mesh.qualificationTimeout);
  if (
    !mesh.sendControl({
      type: "ready",
      epoch: mesh.epoch,
      qualifiedPeerIds: qualified.map((state) => state.peerId),
      candidateReports: qualified.map((state) => ({
        peerId: state.peerId,
        localCandidateType:
          state.selectedPair?.local &&
          typeof state.selectedPair.local === "object"
            ? String(
                (state.selectedPair.local as Record<string, unknown>)
                  .candidateType || "",
              ) || null
            : null,
        remoteCandidateType:
          state.selectedPair?.remote &&
          typeof state.selectedPair.remote === "object"
            ? String(
                (state.selectedPair.remote as Record<string, unknown>)
                  .candidateType || "",
              ) || null
            : null,
        rttMs:
          state.selectedPair?.currentRoundTripTime == null
            ? null
            : Number(state.selectedPair.currentRoundTripTime) * 1000,
        protocol:
          state.selectedPair?.local &&
          typeof state.selectedPair.local === "object"
            ? String(
                (state.selectedPair.local as Record<string, unknown>)
                  .protocol || "",
              ) || null
            : state.selectedPair?.remote &&
                typeof state.selectedPair.remote === "object"
              ? String(
                  (state.selectedPair.remote as Record<string, unknown>)
                    .protocol || "",
                ) || null
              : null,
      })),
    })
  )
    mesh.readyReported = false;
}
