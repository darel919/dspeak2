import { db } from "../client.js";
import {
  notifications,
  notificationPreferences,
  roomNotificationPreferences,
  pushSubscriptions,
  pushJobs,
} from "../schema/index.js";
import { eq, and, desc, asc, lt, count } from "drizzle-orm";

export class NotificationRepository {
  async createNotification({ userId, type, title, body, data }) {
    const result = await db
      .insert(notifications)
      .values({ userId, type, title, body, data })
      .returning();
    return result[0];
  }

  async getNotifications(userId, { limit = 50, before, unreadOnly } = {}) {
    const conditions = [eq(notifications.userId, userId)];
    if (before) conditions.push(lt(notifications.createdAt, before));
    if (unreadOnly) conditions.push(eq(notifications.read, false));
    return db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markRead(notificationId, userId) {
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();
    return result[0];
  }

  async markAllRead(userId) {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.read, false)),
      );
  }

  async getUnreadCount(userId) {
    const result = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.read, false)),
      );
    return result[0]?.count || 0;
  }

  async getPreferences(userId) {
    const result = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (!result[0]) {
      return db
        .insert(notificationPreferences)
        .values({ userId })
        .returning()
        .then((r) => r[0]);
    }
    return result[0];
  }

  async updatePreferences(userId, prefs) {
    const result = await db
      .update(notificationPreferences)
      .set({ ...prefs, updatedAt: new Date() })
      .where(eq(notificationPreferences.userId, userId))
      .returning();
    return result[0];
  }

  async getRoomPreferences(userId, roomId) {
    const result = await db
      .select()
      .from(roomNotificationPreferences)
      .where(
        and(
          eq(roomNotificationPreferences.userId, userId),
          eq(roomNotificationPreferences.roomId, roomId),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async setRoomPreferences(userId, roomId, prefs) {
    const result = await db
      .insert(roomNotificationPreferences)
      .values({ userId, roomId, ...prefs })
      .onConflictDoUpdate({
        target: [
          roomNotificationPreferences.userId,
          roomNotificationPreferences.roomId,
        ],
        set: { ...prefs, updatedAt: new Date() },
      })
      .returning();
    return result[0];
  }

  async addPushSubscription(userId, { endpoint, p256dh, auth }) {
    const result = await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh, auth })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dh, auth, createdAt: new Date() },
      })
      .returning();
    return result[0];
  }

  async removePushSubscription(userId, endpoint) {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      );
  }

  async getPushSubscriptions(userId) {
    return db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  async createPushJob({ subscriptionId, recipientId, payload, scheduledFor }) {
    const result = await db
      .insert(pushJobs)
      .values({
        subscriptionId,
        recipientId,
        payload,
        scheduledFor,
        status: "pending",
      })
      .returning();
    return result[0];
  }

  async getPendingPushJobs(limit = 100) {
    const now = new Date();
    return db
      .select()
      .from(pushJobs)
      .where(
        and(eq(pushJobs.status, "pending"), lt(pushJobs.scheduledFor, now)),
      )
      .orderBy(asc(pushJobs.scheduledFor))
      .limit(limit);
  }

  async markPushJobSent(jobId) {
    await db
      .update(pushJobs)
      .set({ status: "sent", completedAt: new Date() })
      .where(eq(pushJobs.id, jobId));
  }

  async markPushJobFailed(jobId, attempts) {
    await db
      .update(pushJobs)
      .set({ status: "failed", attempts: attempts + 1 })
      .where(eq(pushJobs.id, jobId));
  }
}

export const notificationRepository = new NotificationRepository();
