import { usePocketBaseAdmin } from "../../utils/pocketbase";
import {
  addGlobalSubscriber,
  removeGlobalSubscriber,
  broadcastGlobally,
} from "../../utils/dspeak-realtime";
import { authenticateWebSocketRequest } from "../../utils/authentication";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../../utils/rate-limit.js";
import {
  setUserPresence,
  getUserPresence,
  touchUserActivity,
  checkAndTransitionIdleUsers,
  setUserOfflineOnDisconnect,
} from "../../utils/user-presence-manager.js";

const users = new Map();
let idleCheckInterval = null;

function startIdleCheck() {
  if (idleCheckInterval) return;
  idleCheckInterval = setInterval(() => {
    checkAndTransitionIdleUsers().catch(() => {});
    for (const userId of users.values()) {
      const presence = getUserPresence(userId);
      globalThis.dispatchEvent
        ? globalThis.dispatchEvent(new CustomEvent("dspeak:presence-check"))
        : null;
      broadcastGlobally({
        type: "status_updated",
        data: { userId, ...presence },
      });
    }
  }, 15000);
  idleCheckInterval.unref?.();
}

export default defineWebSocketHandler({
  async open(peer) {
    try {
      enforceIdentifierRateLimit(
        "presence-websocket-ip",
        resolveWebSocketClientIp(peer.request),
        120,
        60 * 1000,
      );
    } catch {
      return peer.close(1008, "Too many presence connections");
    }
    const authentication = await authenticateWebSocketRequest(peer.request);
    if (!authentication) return peer.close(1008, "Authentication required");
    const { userId } = authentication;
    try {
      enforceIdentifierRateLimit(
        "presence-websocket-open",
        userId,
        30,
        60 * 1000,
      );
    } catch {
      return peer.close(1008, "Too many presence connections");
    }
    users.set(peer.id, userId);
    addGlobalSubscriber(peer);

    try {
      const pb = await usePocketBaseAdmin();
      const userRecord = await pb
        .collection("users")
        .getOne(userId, { fields: "id,presence_status" })
        .catch(() => null);

      const savedStatus = userRecord?.presence_status || "online";
      setUserPresence(userId, savedStatus, { isManualOverride: false });
      await pb.collection("users").update(userId, {
        online: true,
        presence_status: savedStatus,
      });

      broadcastGlobally({
        type: "status_updated",
        data: {
          userId,
          status: savedStatus,
          updatedAt: new Date().toISOString(),
          isManualOverride: false,
        },
      });

      startIdleCheck();
    } catch (error) {
      console.error("[Presence] failed to set user online", error);
      peer.close(1011, "Presence unavailable");
    }
  },

  async message(peer, message) {
    try {
      const data = JSON.parse(
        typeof message === "string" ? message : message.toString(),
      );
      const userId = users.get(peer.id);
      if (!userId) return;

      if (data.type === "ping") {
        peer.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (data.type === "activity") {
        touchUserActivity(userId);
        return;
      }

      if (data.type === "status") {
        const newStatus = ["online", "idle", "dnd", "offline"].includes(
          data.status,
        )
          ? data.status
          : "online";
        const isManualOverride = data.manual !== false;
        setUserPresence(userId, newStatus, {
          clientTimestamp: data.timestamp,
          idleTimeoutMs: data.idleTimeoutMs,
          isManualOverride,
        });

        const pb = await usePocketBaseAdmin();
        await pb
          .collection("users")
          .update(userId, { presence_status: newStatus })
          .catch(() => {});

        broadcastGlobally({
          type: "status_updated",
          data: {
            userId,
            status: newStatus,
            updatedAt: new Date().toISOString(),
            isManualOverride,
          },
        });
        return;
      }

      if (data.type === "request_online_users") {
        const onlineList = [];
        for (const [uid, presence] of users) {
          const p = getUserPresence(uid);
          onlineList.push({ userId: uid, ...p });
        }
        peer.send(JSON.stringify({ type: "online_users", data: onlineList }));
        return;
      }
    } catch {
      // noop
    }
  },

  async close(peer) {
    removeGlobalSubscriber(peer);
    const userId = users.get(peer.id);
    users.delete(peer.id);
    if (!userId) return;
    if ([...users.values()].some((value) => value === userId)) return;

    setUserOfflineOnDisconnect(userId);

    const pb = await usePocketBaseAdmin();
    await pb
      .collection("users")
      .update(userId, {
        online: false,
        presence_status: "offline",
      })
      .catch(() => {});

    broadcastGlobally({
      type: "status_updated",
      data: {
        userId,
        status: "offline",
        updatedAt: new Date().toISOString(),
        isManualOverride: false,
      },
    });

    if (users.size === 0 && idleCheckInterval) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
  },
});
