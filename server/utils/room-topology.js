import {
  allClientsReady,
  hasCompleteMesh,
  membershipTopology,
  p2pRoutingPolicy,
} from "./media-transition.js";

const DEFAULT_TRANSITION_TIMEOUT_MS = 15000;
const DEFAULT_SFU_RETRY_DELAY_MS = 1000;

export function createRoomTopology() {
  return {
    mode: "idle",
    epoch: 0,
    reason: "waiting-for-peer",
    activatedAt: Date.now(),
    readiness: new Map(),
    transitionReadiness: new Map(),
    sourceRevision: 0,
    preparedEpoch: null,
    target: null,
    recovering: false,
    p2pFailures: 0,
    p2pEverActivated: false,
    recoveryTimer: null,
    activationTimer: null,
    transitionTimer: null,
  };
}

export function ensureRoomTopology(topology) {
  const defaults = createRoomTopology();
  for (const [key, value] of Object.entries(defaults)) {
    if (topology[key] == null) topology[key] = value;
  }
  if (!(topology.readiness instanceof Map)) topology.readiness = new Map();
  if (!(topology.transitionReadiness instanceof Map))
    topology.transitionReadiness = new Map();
  return topology;
}

export function roomTopologyPayload(room) {
  return {
    mode: room.topology.mode,
    epoch: room.topology.epoch,
    reason: room.topology.reason,
    activatedAt: room.topology.activatedAt,
    target: room.topology.target,
    sourceRevision: room.topology.sourceRevision,
    preparedEpoch: room.topology.preparedEpoch,
    peers: [...room.sessions.values()].map((session) => ({
      peerId: session.peer.id,
      userId: session.userId,
      profile: session.profile || null,
      sources: [...session.sources],
    })),
  };
}

export function supersededMediaSessions(room, userId, deviceId) {
  const normalizedUserId = String(userId || "");
  const normalizedDeviceId = String(deviceId || "");
  if (!normalizedUserId || !normalizedDeviceId) return [];
  return [...room.sessions.values()].filter(
    (session) =>
      String(session.userId) === normalizedUserId &&
      String(session.deviceId) === normalizedDeviceId,
  );
}

export class RoomTopologyCoordinator {
  constructor({
    broadcast,
    maxP2pParticipants = 4,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.broadcast = broadcast;
    this.maxP2pParticipants = maxP2pParticipants;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  clearTimers(room) {
    for (const key of ["recoveryTimer", "activationTimer", "transitionTimer"]) {
      if (room.topology[key]) this.clearTimer(room.topology[key]);
      room.topology[key] = null;
    }
  }

  set(room, mode, reason, target = null, preparedEpoch = null) {
    this.clearTimers(room);
    room.topology.mode = mode;
    room.topology.target = target;
    room.topology.reason = reason;
    room.topology.preparedEpoch = preparedEpoch;
    room.topology.epoch += 1;
    room.topology.activatedAt = Date.now();
    room.topology.readiness.clear();
    room.topology.transitionReadiness.clear();
    this.broadcast(room);
  }

  reconcile(room, reason) {
    const next = membershipTopology(room.sessions.size);
    if (next === "idle") {
      room.topology.recovering = false;
      return this.set(room, "idle", "waiting-for-peer");
    }
    if (next === "sfu") {
      room.topology.recovering = false;
      if (room.topology.mode === "sfu") {
        this.clearTimers(room);
        return this.broadcast(room);
      }
      const transitionReason =
        room.sessions.size === 1 ? "establishing-sfu" : "participant-limit";
      return this.beginTransition(room, "sfu", transitionReason);
    }
    if (room.topology.recovering) {
      this.set(
        room,
        "sfu",
        reason || "membership-changed-during-direct-recovery",
      );
      this.scheduleDirectRecovery(room);
      return;
    }
    if (room.topology.mode === "sfu") {
      this.clearTimers(room);
      this.broadcast(room);
      this.scheduleDirectRecovery(room);
      return;
    }
    this.beginTransition(
      room,
      "sfu",
      room.topology.mode === "p2p"
        ? "membership-changed-stabilize-sfu"
        : "establishing-stable-sfu",
    );
  }

  beginTransition(room, target, reason) {
    this.set(room, "switching", reason, target);
    const epoch = room.topology.epoch;
    room.topology.transitionTimer = this.setTimer(() => {
      if (room.topology.epoch !== epoch || room.topology.mode !== "switching")
        return;
      if (target === "sfu")
        return this.beginTransition(room, "sfu", "retrying-sfu-preparation");
      this.fallbackToSfu(room, "direct-transition-timeout");
    }, DEFAULT_TRANSITION_TIMEOUT_MS);
  }

  clientReady(room, peerId, { epoch, target, sourceRevision }) {
    if (room.topology.mode !== "switching") return false;
    if (
      Number(epoch) !== room.topology.epoch ||
      String(target || "") !== room.topology.target
    )
      return false;
    if (
      Number(sourceRevision) !== room.topology.sourceRevision ||
      !room.sessions.has(peerId)
    )
      return false;
    room.topology.transitionReadiness.set(peerId, room.topology.sourceRevision);
    if (
      !allClientsReady(
        [...room.sessions.keys()],
        room.topology.transitionReadiness,
        room.topology.sourceRevision,
      )
    )
      return true;
    const activationReason =
      room.topology.reason || `all-clients-ready-${target}`;
    this.set(room, target, activationReason, null, Number(epoch));
    if (target === "p2p") {
      room.topology.recovering = false;
      room.topology.p2pFailures = 0;
      room.topology.p2pEverActivated = true;
    }
    if (target === "sfu") this.scheduleDirectRecovery(room);
    return true;
  }

  clientFailed(room, { epoch, target, sourceRevision, reason }) {
    if (room.topology.mode !== "switching") return false;
    if (
      Number(epoch) !== room.topology.epoch ||
      String(target || "") !== room.topology.target
    )
      return false;
    if (Number(sourceRevision) !== room.topology.sourceRevision) return false;
    if (target === "p2p") {
      room.topology.p2pFailures += 1;
      if (room.topology.p2pFailures < 3) {
        this.set(room, "probing", "retrying-direct-preparation");
        return true;
      }
      this.fallbackToSfu(room, "client-direct-preparation-failed");
      return true;
    }
    this.clearTimer(room.topology.transitionTimer);
    const detail = String(reason || "preparation-failed")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
    room.topology.transitionTimer = this.setTimer(() => {
      if (
        room.topology.epoch === Number(epoch) &&
        room.topology.mode === "switching"
      ) {
        this.beginTransition(room, "sfu", `retrying-sfu-${detail}`);
      }
    }, DEFAULT_SFU_RETRY_DELAY_MS);
    return true;
  }

  sourcesChanged(room) {
    room.topology.sourceRevision += 1;
    if (room.topology.mode === "switching") {
      this.beginTransition(room, room.topology.target, "media-sources-changed");
    } else if (room.topology.mode === "probing") {
      room.topology.readiness.clear();
      room.topology.transitionReadiness.clear();
    } else {
      room.topology.transitionReadiness.clear();
      this.broadcast(room);
      if (room.topology.mode === "sfu") {
        this.clearTimers(room);
        this.scheduleDirectRecovery(room);
      }
    }
  }

  p2pReady(room, peerId, qualifiedPeerIds, epoch) {
    if (
      room.topology.mode !== "probing" ||
      Number(epoch) !== room.topology.epoch ||
      !room.sessions.has(peerId)
    )
      return false;
    const expected = new Set(
      [...room.sessions.keys()].filter((candidate) => candidate !== peerId),
    );
    const qualified = new Set(
      (Array.isArray(qualifiedPeerIds) ? qualifiedPeerIds : [])
        .map(String)
        .filter((candidate) => expected.has(candidate)),
    );
    if (qualified.size !== expected.size) return false;
    room.topology.readiness.set(peerId, qualified);
    const peerIds = [...room.sessions.keys()].sort();
    if (!hasCompleteMesh(peerIds, room.topology.readiness)) return true;
    if (!room.topology.p2pEverActivated) {
      this.beginTransition(room, "p2p", "complete-direct-mesh");
      room.topology.recovering = false;
      return true;
    }
    if (!room.topology.recovering) {
      this.beginTransition(room, "p2p", "complete-direct-mesh");
      return true;
    }
    if (room.topology.activationTimer) return true;
    const qualificationEpoch = room.topology.epoch;
    room.topology.activationTimer = this.setTimer(() => {
      room.topology.activationTimer = null;
      if (
        room.topology.epoch !== qualificationEpoch ||
        room.topology.mode !== "probing"
      )
        return;
      if (
        !hasCompleteMesh(
          [...room.sessions.keys()].sort(),
          room.topology.readiness,
        )
      )
        return;
      this.beginTransition(room, "p2p", "recovered-direct-mesh");
    }, p2pRoutingPolicy(room.sessions.size).stabilityDelayMs);
    return true;
  }

  p2pFailed(room, reason, epoch) {
    const directIsActive =
      room.topology.mode === "p2p" ||
      room.topology.mode === "probing" ||
      (room.topology.mode === "switching" && room.topology.target === "p2p");
    if (
      !directIsActive ||
      Number(epoch) !== room.topology.epoch ||
      room.sessions.size < 2
    )
      return false;
    const detail =
      String(reason || "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 48) || "unknown";
    this.fallbackToSfu(room, `direct-path-unavailable-${detail}`);
    return true;
  }

  sfuFailed(room, reason, epoch) {
    if (
      room.topology.mode !== "sfu" ||
      Number(epoch) !== room.topology.epoch ||
      !room.sessions.size
    )
      return false;
    const detail = String(reason || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 64);
    this.beginTransition(room, "sfu", `sfu-path-unavailable-${detail}`);
    return true;
  }

  fallbackToSfu(room, reason) {
    room.topology.p2pFailures = 0;
    if (room.topology.recovering) {
      room.topology.recovering = false;
      this.set(room, "sfu", reason);
      this.scheduleDirectRecovery(room);
      return;
    }
    room.topology.recovering = false;
    this.beginTransition(room, "sfu", reason);
  }

  scheduleDirectRecovery(room) {
    if (room.sessions.size < 2 || room.sessions.size > this.maxP2pParticipants)
      return;
    room.topology.recoveryTimer = this.setTimer(() => {
      if (
        room.topology.mode !== "sfu" ||
        room.sessions.size < 2 ||
        room.sessions.size > this.maxP2pParticipants
      )
        return;
      this.set(room, "probing", "checking-recovered-direct-path");
      room.topology.recovering = true;
    }, p2pRoutingPolicy(room.sessions.size).recoveryDelayMs);
  }
}
