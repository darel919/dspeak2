import { requireAuthenticatedUser } from "../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../utils/pocketbase.js";
import { getBoundedList } from "../../utils/pocketbase-query.js";

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

    const pb = await usePocketBaseAdmin();

    if (enable === false) {
      try {
        const existing = await pb
          .collection("dspeak_push_subscriptions")
          .getFirstListItem(
            pb.filter("user = {:user} && endpoint = {:endpoint}", {
              user: userId,
              endpoint: subscription.endpoint,
            }),
          );
        await pb.collection("dspeak_push_subscriptions").delete(existing.id);
      } catch {
        // Noop
      }
      return { success: true };
    }
    const deviceId = getHeader(event, "x-dspeak-device") || "unknown";
    const now = new Date().toISOString();

    try {
      const existing = await pb
        .collection("dspeak_push_subscriptions")
        .getFirstListItem(
          pb.filter("user = {:user} && endpoint = {:endpoint}", {
            user: userId,
            endpoint: subscription.endpoint,
          }),
        );
      await pb.collection("dspeak_push_subscriptions").update(existing.id, {
        p256dh: subscription.keys?.p256dh || "",
        auth: subscription.keys?.auth || "",
        device_id: deviceId,
        user_agent: getHeader(event, "user-agent") || "",
        last_seen_at: now,
        disabled: false,
      });
    } catch {
      await pb.collection("dspeak_push_subscriptions").create({
        user: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh || "",
        auth: subscription.keys?.auth || "",
        device_id: deviceId,
        user_agent: getHeader(event, "user-agent") || "",
        created_at: now,
        last_seen_at: now,
        failure_count: 0,
        disabled: false,
      });
    }

    return { success: true };
  }

  if (method === "GET") {
    const pb = await usePocketBaseAdmin();
    const subscriptions = await getBoundedList(
      pb,
      "dspeak_push_subscriptions",
      {
        filter: pb.filter("user = {:user} && disabled = false", {
          user: userId,
        }),
        fields: "id,endpoint,device_id,last_seen_at,created_at",
      },
    );

    return { items: subscriptions };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
