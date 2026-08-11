import { requireAuthenticatedUser } from "../../utils/auth.ts";
import { notificationRepository } from "../../db/repositories/notifications.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  if (method === "POST") {
    const body = await readBody(event);
    const { subscription, enable } = body;

    if (!subscription || !subscription.endpoint) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid subscription",
      });
    }

    if (enable === false) {
      await notificationRepository.removePushSubscription(
        userId,
        subscription.endpoint,
      );
      return { success: true };
    }

    const deviceId = getHeader(event, "x-dspeak-device") || "unknown";

    await notificationRepository.addPushSubscription(userId, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh || "",
      auth: subscription.keys?.auth || "",
    });

    return { success: true };
  }

  if (method === "GET") {
    const subscriptions =
      await notificationRepository.getPushSubscriptions(userId);

    return { items: subscriptions };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
