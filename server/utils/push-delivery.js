import webpush from "web-push";
import {
  isMessageNotificationEligible,
  notificationBody,
  resolveNotificationPreference,
} from "../../shared/notification-policy.js";
import { publicDisplayName } from "../../shared/user-profile.js";
import { isDeviceViewingChannel } from "./dspeak-realtime.js";
import { usePocketBaseAdmin } from "./pocketbase.js";
import { getBoundedList } from "./pocketbase-query.js";
import {
  assertSafeOutboundUrl,
  configuredOutboundHosts,
  createPublicHttpsAgent,
} from "../infrastructure/network/outbound-request.js";

const dispatcherKey = Symbol.for("dspeak.push.dispatcher");
const retryDelays = [5_000, 30_000, 120_000, 600_000, 1_800_000];
const jobLifetime = 24 * 60 * 60 * 1000;
const lockLifetime = 60 * 1000;
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
        expired: 0,
      },
    };
  }
  return globalThis[dispatcherKey];
}

function configureWebPush() {
  const state = getState();
  if (state.configured) return true;
  const config = useRuntimeConfig();
  const publicKey =
    process.env.VAPID_PUBLIC_KEY ||
    process.env.VAPID_PUBKEY ||
    config.pocketbase.vapidPublicKey;
  const privateKey =
    process.env.VAPID_PRIVKEY || config.pocketbase.vapidPrivateKey;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, publicKey, privateKey);
  state.configured = true;
  return true;
}

async function firstOrNull(pb, collection, filter) {
  try {
    return await pb.collection(collection).getFirstListItem(filter);
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return null;
    throw error;
  }
}

async function createPushJob(pb, values) {
  const filter = pb.filter("dedupe_key = {:dedupe}", {
    dedupe: values.dedupe_key,
  });
  if (await firstOrNull(pb, "dspeak_push_jobs", filter)) return null;
  try {
    return await pb.collection("dspeak_push_jobs").create(values);
  } catch (error) {
    const details = error?.response?.data || {};
    if (
      details.dedupe_key?.code === "validation_not_unique" ||
      (error?.status === 400 &&
        (await firstOrNull(pb, "dspeak_push_jobs", filter)))
    ) {
      return null;
    }
    throw error;
  }
}

export async function persistMessageNotifications({
  pb,
  room,
  channel,
  message,
  senderId,
}) {
  const memberships = await getBoundedList(pb, "dspeak_room_memberships", {
    filter: pb.filter("room = {:room} && user != {:sender}", {
      room: room.id,
      sender: senderId,
    }),
    fields: "user",
  });
  const recipientIds = [
    ...new Set(memberships.map(({ user }) => String(user))),
  ];
  if (!recipientIds.length)
    return { notifications: 0, jobs: 0, recipients: [] };
  const profiles = await getBoundedList(pb, "users", {
    filter: recipientIds
      .map((id) => pb.filter("id = {:id}", { id }))
      .join(" || "),
    fields: "id,handle",
  });
  const profilesById = new Map(
    profiles.map((profile) => [profile.id, profile]),
  );
  const recipientFilter = recipientIds
    .map((id) => pb.filter("user = {:user}", { user: id }))
    .join(" || ");
  const [globalPreferences, roomPreferences, subscriptions] = await Promise.all(
    [
      getBoundedList(pb, "dspeak_notification_preferences", {
        filter: recipientFilter,
      }),
      getBoundedList(pb, "dspeak_room_notification_preferences", {
        filter: `room = ${JSON.stringify(room.id)} && (${recipientFilter})`,
      }),
      getBoundedList(pb, "dspeak_push_subscriptions", {
        filter: `disabled = false && (${recipientFilter})`,
      }),
    ],
  );
  const globalPreferencesByUser = new Map(
    globalPreferences.map((preference) => [
      String(preference.user),
      preference,
    ]),
  );
  const roomPreferencesByUser = new Map(
    roomPreferences.map((preference) => [String(preference.user), preference]),
  );
  const subscriptionsByUser = new Map();
  for (const subscription of subscriptions) {
    const userSubscriptions =
      subscriptionsByUser.get(String(subscription.user)) || [];
    userSubscriptions.push(subscription);
    subscriptionsByUser.set(String(subscription.user), userSubscriptions);
  }
  const senderName = publicDisplayName(message.expand?.sender);
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
        recipientHandle: profilesById.get(recipientId)?.handle,
      })
    ) {
      continue;
    }
    const body = preference.previews ? message.content : "New message";
    const notificationFilter = pb.filter(
      "recipient = {:recipient} && message = {:message} && type = 'message'",
      { recipient: recipientId, message: message.id },
    );
    const existingNotification = await firstOrNull(
      pb,
      "dspeak_notifications",
      notificationFilter,
    );
    if (!existingNotification) {
      try {
        await pb.collection("dspeak_notifications").create({
          recipient: recipientId,
          type: "message",
          actor: senderId,
          room: room.id,
          channel: channel.id,
          message: message.id,
          title: `#${channel.name} · ${room.name}`,
          body,
          read_at: null,
        });
        notificationCount += 1;
      } catch (error) {
        if (
          error?.status !== 400 ||
          !(await firstOrNull(pb, "dspeak_notifications", notificationFilter))
        ) {
          throw error;
        }
      }
    }
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
        roomId: room.id,
        channelId: channel.id,
      },
    };
    const now = new Date();
    for (const subscription of subscriptionsByUser.get(recipientId) || []) {
      if (
        isDeviceViewingChannel(recipientId, subscription.device_id, channel.id)
      ) {
        continue;
      }
      const job = await createPushJob(pb, {
        recipient: recipientId,
        subscription: subscription.id,
        message: message.id,
        dedupe_key: `${message.id}:${subscription.id}`,
        payload,
        status: "pending",
        attempts: 0,
        next_attempt_at: now.toISOString(),
        expires_at: new Date(now.getTime() + jobLifetime).toISOString(),
      });
      if (job) jobCount += 1;
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
  return new Date(Date.now() + Math.round(base * jitter)).toISOString();
}

async function expireJob(pb, job) {
  const finishedAt = new Date().toISOString();
  await pb.collection("dspeak_push_jobs").update(job.id, {
    status: "expired",
    locked_until: null,
    last_error: "Delivery window expired",
    finished_at: finishedAt,
  });
  getState().metrics.expired += 1;
}

async function deliverJob(pb, job) {
  const state = getState();
  if (Date.parse(job.expires_at) <= Date.now()) {
    await expireJob(pb, job);
    return;
  }
  const subscription = await pb
    .collection("dspeak_push_subscriptions")
    .getOne(job.subscription);
  if (subscription.disabled) {
    const finishedAt = new Date().toISOString();
    await pb.collection("dspeak_push_jobs").update(job.id, {
      status: "failed",
      locked_until: null,
      last_error: "Subscription disabled",
      finished_at: finishedAt,
    });
    state.metrics.failed += 1;
    return;
  }
  const attempts = Number(job.attempts || 0) + 1;
  await pb.collection("dspeak_push_jobs").update(job.id, {
    status: "sending",
    attempts,
    locked_until: new Date(Date.now() + lockLifetime).toISOString(),
  });
  try {
    await assertSafeOutboundUrl(subscription.endpoint, {
      allowedHosts: pushAllowedHosts,
    });
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(job.payload),
      {
        TTL: Math.max(
          0,
          Math.floor((Date.parse(job.expires_at) - Date.now()) / 1000),
        ),
        agent: pushAgent,
        timeout: 10_000,
      },
    );
    const deliveredAt = new Date().toISOString();
    await Promise.all([
      pb.collection("dspeak_push_jobs").update(job.id, {
        status: "delivered",
        delivered_at: deliveredAt,
        finished_at: deliveredAt,
        locked_until: null,
        last_error: "",
      }),
      pb.collection("dspeak_push_subscriptions").update(subscription.id, {
        failure_count: 0,
        last_success_at: deliveredAt,
      }),
    ]);
    state.metrics.delivered += 1;
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      const finishedAt = new Date().toISOString();
      await Promise.all([
        pb.collection("dspeak_push_subscriptions").update(subscription.id, {
          disabled: true,
          failure_count: Number(subscription.failure_count || 0) + 1,
        }),
        pb.collection("dspeak_push_jobs").update(job.id, {
          status: "failed",
          locked_until: null,
          last_error: `Push endpoint rejected delivery with HTTP ${statusCode}`,
          finished_at: finishedAt,
        }),
      ]);
      state.metrics.failed += 1;
      return;
    }
    if (
      attempts >= retryDelays.length ||
      Date.parse(job.expires_at) <= Date.now()
    ) {
      const finishedAt = new Date().toISOString();
      await pb.collection("dspeak_push_jobs").update(job.id, {
        status: "failed",
        locked_until: null,
        last_error: statusCode
          ? `Push delivery failed with HTTP ${statusCode}`
          : "Push provider unavailable",
        finished_at: finishedAt,
      });
      state.metrics.failed += 1;
      return;
    }
    await pb.collection("dspeak_push_jobs").update(job.id, {
      status: "pending",
      next_attempt_at: retryAt(attempts),
      locked_until: null,
      last_error: statusCode
        ? `Retrying after HTTP ${statusCode}`
        : "Retrying after provider failure",
    });
    state.metrics.retried += 1;
  }
}

async function pruneCompletedJobs(pb) {
  const state = getState();
  if (Date.now() - state.lastCleanupAt < cleanupInterval) return;
  const cutoff = new Date(Date.now() - completedJobRetention).toISOString();
  const jobs = await getBoundedList(
    pb,
    "dspeak_push_jobs",
    {
      filter: pb.filter("finished_at <= {:cutoff}", { cutoff }),
      fields: "id",
    },
    100,
  );
  await Promise.all(
    jobs.map((job) => pb.collection("dspeak_push_jobs").delete(job.id)),
  );
  state.lastCleanupAt = Date.now();
}

export async function dispatchPushJobs() {
  const state = getState();
  if (state.running || !configureWebPush()) return;
  state.running = true;
  let pb = null;
  try {
    pb = await usePocketBaseAdmin();
    await pruneCompletedJobs(pb).catch((error) =>
      console.error("[PushDispatcher] Retention cleanup failed", error),
    );
    const now = new Date().toISOString();
    const jobs = await pb
      .collection("dspeak_push_jobs")
      .getList(1, dispatchBatchSize, {
        filter: pb.filter(
          "(status = 'pending' && next_attempt_at <= {:now}) || (status = 'sending' && locked_until <= {:now})",
          { now },
        ),
        sort: "next_attempt_at",
      });
    for (const job of jobs.items) await deliverJob(pb, job);
  } finally {
    if (pb) {
      await refreshPushMetrics(pb).catch((error) => {
        state.metricsSnapshot = {
          ...state.metricsSnapshot,
          checkedAt: new Date().toISOString(),
          available: false,
        };
        console.error("[PushDispatcher] Metrics refresh failed", error);
      });
    }
    state.running = false;
  }
}

export async function sendPushTest(pb, userId, deviceId) {
  if (!configureWebPush()) throw new Error("Web Push is not configured");
  const subscription = await pb
    .collection("dspeak_push_subscriptions")
    .getFirstListItem(
      pb.filter("user = {:user} && device_id = {:device} && disabled = false", {
        user: userId,
        device: deviceId,
      }),
    );
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
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

async function refreshPushMetrics(pb) {
  const now = new Date().toISOString();
  const [pending, subscriptions] = await Promise.all([
    pb.collection("dspeak_push_jobs").getList(1, 1, {
      filter: "status = 'pending' || status = 'sending'",
      sort: "next_attempt_at",
    }),
    pb.collection("dspeak_push_subscriptions").getList(1, 1, {
      filter: "disabled = false",
    }),
  ]);
  const oldest = pending.items[0]?.next_attempt_at;
  getState().metricsSnapshot = {
    pending: pending.totalItems,
    activeSubscriptions: subscriptions.totalItems,
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
