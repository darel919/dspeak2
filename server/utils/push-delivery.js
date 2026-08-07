import webpush from "web-push";
import {
  isMessageNotificationEligible,
  messageContainsBroadcastMention,
  notificationBody,
  resolveNotificationPreference,
} from "../../shared/notification-policy.js";
import { publicDisplayName } from "../../shared/user-profile.js";
import {
  isDeviceViewingChannel,
  isUserViewingChannel,
} from "./dspeak-realtime.js";
import { db } from "../db/client.js";
import {
  notifications,
  notificationPreferences,
  roomNotificationPreferences,
  pushSubscriptions,
  pushJobs,
  roomMemberships,
  profiles,
} from "../db/schema/index.js";
import { eq, and, inArray, lt, or, count } from "drizzle-orm";
import {
  assertSafeOutboundUrl,
  configuredOutboundHosts,
  createPublicHttpsAgent,
} from "../infrastructure/network/outbound-request.js";

const dispatcherKey = Symbol.for("dspeak.push.dispatcher");
const retryDelays = [5_000, 30_000, 120_000, 600_000, 1_800_000];
const jobLifetime = 24 * 60 * 60 * 1000;
const dispatchInterval = 5_000;
const dispatchBatchSize = 50;
const completedJobRetention = 7 * 24 * 60 * 60 * 1000;
const cleanupInterval = 60 * 60 * 1000;
const pushAllowedHosts = configuredOutboundHosts(
  process.env.DSPEAK_PUSH_ALLOWED_HOSTS,
);
const pushAgent = createPublicHttpsAgent();

function getState() {
  if (!globalThis[dispatcherKey]) {
    globalThis[dispatcherKey] = {
      timer: null,
      running: false,
      configured: false,
      lastCleanupAt: 0,
      metricsSnapshot: {
        pending: 0,
        activeSubscriptions: 0,
        oldestPendingAt: null,
        checkedAt: null,
        available: false,
      },
      metrics: {
        delivered: 0,
        failed: 0,
        retried: 0,
      },
    };
  }
  return globalThis[dispatcherKey];
}

function configureWebPush() {
  const state = getState();
  if (state.configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBKEY;
  const privateKey = process.env.VAPID_PRIVKEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, publicKey, privateKey);
  state.configured = true;
  return true;
}

async function createMessageNotification(userId, message, channel, room, body) {
  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "message"),
        eq(notifications.data, `{"messageId":"${message.id}"}`),
      ),
    )
    .limit(1);
  if (existing[0]) return null;
  try {
    const result = await db
      .insert(notifications)
      .values({
        userId,
        type: "message",
        title: `#${channel.name} · ${room.name}`,
        body,
        data: JSON.stringify({
          messageId: message.id,
          channelId: channel.id,
          roomId: room.id,
        }),
      })
      .returning();
    return result[0];
  } catch {
    return null;
  }
}

export async function persistMessageNotifications({
  room,
  channel,
  message,
  senderId,
}) {
  const allMemberships = await db
    .select({ userId: roomMemberships.userId })
    .from(roomMemberships)
    .where(eq(roomMemberships.roomId, room.id));
  const recipientIds = [
    ...new Set(
      allMemberships
        .map((m) => String(m.userId))
        .filter((id) => id !== String(senderId)),
    ),
  ];
  if (!recipientIds.length)
    return { notifications: 0, jobs: 0, recipients: [] };

  const [profileRows, prefRows, roomPrefRows, subRows] = await Promise.all([
    db.select().from(profiles).where(inArray(profiles.id, recipientIds)),
    db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, recipientIds)),
    db
      .select()
      .from(roomNotificationPreferences)
      .where(
        and(
          eq(roomNotificationPreferences.roomId, room.id),
          inArray(roomNotificationPreferences.userId, recipientIds),
        ),
      ),
    db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, recipientIds)),
  ]);

  const profilesById = new Map(profileRows.map((p) => [p.id, p]));
  const globalPreferencesByUser = new Map(
    prefRows.map((p) => [String(p.userId), p]),
  );
  const roomPreferencesByUser = new Map(
    roomPrefRows.map((p) => [String(p.userId), p]),
  );
  const subscriptionsByUser = new Map();
  for (const subscription of subRows) {
    const userSubscriptions =
      subscriptionsByUser.get(String(subscription.userId)) || [];
    userSubscriptions.push(subscription);
    subscriptionsByUser.set(String(subscription.userId), userSubscriptions);
  }
  const senderName = publicDisplayName(senderId);
  const mentionsEveryone = messageContainsBroadcastMention(
    message.content,
    "everyone",
  );
  const mentionsHere = messageContainsBroadcastMention(message.content, "here");
  let notificationCount = 0;
  let jobCount = 0;

  for (const recipientId of recipientIds) {
    const preference = resolveNotificationPreference(
      globalPreferencesByUser.get(recipientId),
      roomPreferencesByUser.get(recipientId),
    );
    if (
      !isMessageNotificationEligible({
        preference,
        content: message.content,
        recipientHandle: profilesById.get(recipientId)?.username,
        broadcastMention:
          mentionsEveryone ||
          (mentionsHere && isUserViewingChannel(recipientId, channel.id)),
      })
    ) {
      continue;
    }
    const body = preference.previews ? message.content : "New message";
    const notificationId = await createMessageNotification(
      recipientId,
      message,
      channel,
      room,
      body,
    );
    if (notificationId) notificationCount += 1;
    if (!preference.push) continue;
    const payload = {
      title: `New message in ${room.name} - ${channel.name}`,
      body: notificationBody({
        previews: preference.previews,
        senderName,
        content: message.content,
      }),
      tag: `message-${message.id}`,
      data: {
        messageId: message.id,
        roomId: String(room.id),
        channelId: String(channel.id),
      },
    };
    for (const subscription of subscriptionsByUser.get(recipientId) || []) {
      const job = await db
        .insert(pushJobs)
        .values({
          subscriptionId: subscription.id,
          payload: JSON.stringify(payload),
          status: "pending",
          attempts: 0,
          scheduledFor: new Date(),
        })
        .returning();
      if (job[0]) jobCount += 1;
    }
  }
  return {
    notifications: notificationCount,
    jobs: jobCount,
    recipients: recipientIds,
  };
}

function retryAt(attempts) {
  const base =
    retryDelays[Math.min(Math.max(attempts - 1, 0), retryDelays.length - 1)];
  const jitter = 0.8 + Math.random() * 0.4;
  return new Date(Date.now() + Math.round(base * jitter));
}

async function deliverJob(job) {
  const state = getState();
  if (Date.now() - job.scheduledFor.getTime() > jobLifetime) {
    await db
      .update(pushJobs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(pushJobs.id, job.id));
    state.metrics.failed += 1;
    return;
  }
  const subscription = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, job.subscriptionId))
    .limit(1);
  if (!subscription[0]) {
    await db
      .update(pushJobs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(pushJobs.id, job.id));
    state.metrics.failed += 1;
    return;
  }
  const attempts = Number(job.attempts || 0) + 1;
  try {
    await assertSafeOutboundUrl(subscription[0].endpoint, {
      allowedHosts: pushAllowedHosts,
    });
    await webpush.sendNotification(
      {
        endpoint: subscription[0].endpoint,
        keys: {
          p256dh: subscription[0].p256dh,
          auth: subscription[0].auth,
        },
      },
      job.payload,
      {
        TTL: Math.max(
          0,
          Math.min(
            Math.floor(jobLifetime / 1000),
            Math.floor(
              (job.scheduledFor.getTime() + jobLifetime - Date.now()) / 1000,
            ),
          ),
        ),
        agent: pushAgent,
        timeout: 10_000,
      },
    );
    const completedAt = new Date();
    await Promise.all([
      db
        .update(pushJobs)
        .set({ status: "sent", attempts, completedAt })
        .where(eq(pushJobs.id, job.id)),
      db
        .update(pushSubscriptions)
        .set({ p256dh: subscription[0].p256dh })
        .where(eq(pushSubscriptions.id, subscription[0].id)),
    ]);
    state.metrics.delivered += 1;
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (
      statusCode === 404 ||
      statusCode === 410 ||
      attempts >= retryDelays.length ||
      Date.now() - job.scheduledFor.getTime() > jobLifetime
    ) {
      await db
        .update(pushJobs)
        .set({ status: "failed", attempts, completedAt: new Date() })
        .where(eq(pushJobs.id, job.id));
      if (statusCode === 404 || statusCode === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, subscription[0].id));
      }
      state.metrics.failed += 1;
      return;
    }
    await db
      .update(pushJobs)
      .set({ status: "pending", attempts, scheduledFor: retryAt(attempts) })
      .where(eq(pushJobs.id, job.id));
    state.metrics.retried += 1;
  }
}

async function pruneCompletedJobs() {
  const state = getState();
  if (Date.now() - state.lastCleanupAt < cleanupInterval) return;
  const cutoff = new Date(Date.now() - completedJobRetention);
  const jobs = await db
    .select({ id: pushJobs.id })
    .from(pushJobs)
    .where(
      and(
        or(eq(pushJobs.status, "sent"), eq(pushJobs.status, "failed")),
        lt(pushJobs.completedAt, cutoff),
      ),
    )
    .limit(100);
  await Promise.all(
    jobs.map((job) => db.delete(pushJobs).where(eq(pushJobs.id, job.id))),
  );
  state.lastCleanupAt = Date.now();
}

export async function dispatchPushJobs() {
  const state = getState();
  if (state.running || !configureWebPush()) return;
  state.running = true;
  try {
    await pruneCompletedJobs().catch((error) =>
      console.error("[PushDispatcher] Retention cleanup failed", error),
    );
    const now = new Date();
    const jobs = await db
      .select()
      .from(pushJobs)
      .where(
        and(eq(pushJobs.status, "pending"), lt(pushJobs.scheduledFor, now)),
      )
      .orderBy(pushJobs.scheduledFor)
      .limit(dispatchBatchSize);
    for (const job of jobs) await deliverJob(job);
    await refreshPushMetrics().catch((error) =>
      console.error("[PushDispatcher] Metrics refresh failed", error),
    );
  } finally {
    state.running = false;
  }
}

export async function sendPushTest(userId, deviceId) {
  if (!configureWebPush()) throw new Error("Web Push is not configured");
  const subscription = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, deviceId),
      ),
    )
    .limit(1);
  if (!subscription[0]) throw new Error("Subscription not found");
  await webpush.sendNotification(
    {
      endpoint: subscription[0].endpoint,
      keys: {
        p256dh: subscription[0].p256dh,
        auth: subscription[0].auth,
      },
    },
    JSON.stringify({
      title: "dSpeak push test",
      body: "Background push delivery is working.",
      tag: `push-test-${Date.now()}`,
      data: { test: true },
    }),
    { TTL: 300 },
  );
  return { success: true };
}

export function startPushDispatcher() {
  const state = getState();
  if (state.timer) return;
  dispatchPushJobs().catch((error) =>
    console.error("[PushDispatcher] Dispatch failed", error),
  );
  state.timer = setInterval(() => {
    dispatchPushJobs().catch((error) =>
      console.error("[PushDispatcher] Dispatch failed", error),
    );
  }, dispatchInterval);
  state.timer.unref?.();
}

export function stopPushDispatcher() {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export async function refreshPushMetrics() {
  const now = new Date().toISOString();
  const [pending, subscriptions, oldestJob] = await Promise.all([
    db
      .select({ n: count() })
      .from(pushJobs)
      .where(eq(pushJobs.status, "pending")),
    db.select({ n: count() }).from(pushSubscriptions),
    db
      .select({ nextAttemptAt: pushJobs.scheduledFor })
      .from(pushJobs)
      .where(eq(pushJobs.status, "pending"))
      .orderBy(pushJobs.scheduledFor)
      .limit(1),
  ]);
  const oldest = oldestJob[0]?.nextAttemptAt;
  getState().metricsSnapshot = {
    pending: pending[0]?.n ?? 0,
    activeSubscriptions: subscriptions[0]?.n ?? 0,
    oldestPendingAt: oldest || null,
    checkedAt: now,
    available: true,
  };
}

export function getPushMetrics() {
  const state = getState();
  const snapshot = state.metricsSnapshot;
  return {
    ...state.metrics,
    pending: snapshot.pending,
    activeSubscriptions: snapshot.activeSubscriptions,
    oldestPendingSeconds: snapshot.oldestPendingAt
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - Date.parse(snapshot.oldestPendingAt)) / 1000,
          ),
        )
      : 0,
    checkedAt: snapshot.checkedAt,
    available: snapshot.available,
  };
}
