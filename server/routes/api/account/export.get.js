import { requireAuthenticatedUser } from "../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../utils/pocketbase.js";
import { enforceRateLimit } from "../../../utils/rate-limit.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  enforceRateLimit(event, "account-export", userId, 10, 60 * 60 * 1000);
  const pb = await usePocketBaseAdmin();
  const list = (collection, options) =>
    pb.collection(collection).getFullList(options);
  const userFilter = (field) =>
    pb.filter(`${field} = {:user}`, { user: userId });

  const [
    user,
    sessions,
    rooms,
    memberships,
    channels,
    messages,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notifications,
    notificationPreferences,
    roomNotificationPreferences,
    pushSubscriptions,
    pushJobs,
    soundboards,
    chatFiles,
    pinnedMessages,
    bookmarks,
    friends,
    invites,
    auditLogs,
    voiceState,
  ] = await Promise.all([
    pb.collection("users").getOne(userId, {
      fields:
        "id,name,username,display_name,handle,email,avatar,online,presence_status,created,updated",
    }),
    list("dspeak_sessions", {
      filter: userFilter("user"),
      fields:
        "id,device_id,expires_at,last_seen_at,terms_accepted_at,created,updated",
    }),
    list("dspeak_rooms", {
      filter: userFilter("owner"),
      fields:
        "id,name,desc,picture,header_image,accent,attenuation,owner,created,updated",
    }),
    list("dspeak_room_memberships", {
      filter: userFilter("user"),
      fields: "id,room,user,roles,joined_at,created,updated",
    }),
    list("dspeak_rooms_channels", {
      filter: userFilter("owner"),
      fields:
        "id,name,desc,isMedia,inRoom,owner,room,policy,slow_mode,media_policy,created,updated",
    }),
    list("dspeak_messages", {
      filter: userFilter("sender"),
      fields:
        "id,content,room_channel,sender,read_by,client_id,reply_to,attachments,pinned,edited_at,created,updated",
      sort: "-created",
    }),
    list("dspeak_messages", {
      filter: pb.filter("read_by ?= {:user}", { user: userId }),
      fields: "id,room_channel,sender,read_by,created,updated",
      sort: "-created",
    }),
    list("dspeak_message_reactions", {
      filter: userFilter("user"),
      fields: "id,message,user,emoji,skin_tone,created,updated",
    }),
    list("dspeak_message_revisions", {
      filter: userFilter("editor"),
      fields: "id,message,editor,content,revision,edited_at,created,updated",
    }),
    list("dspeak_user_nicknames", {
      filter: userFilter("owner"),
      fields: "id,owner,target,nickname,created,updated",
    }),
    list("dspeak_notifications", {
      filter: userFilter("recipient"),
      fields:
        "id,recipient,type,actor,room,channel,message,title,body,read_at,created,updated",
      sort: "-created",
    }),
    list("dspeak_notification_preferences", {
      filter: userFilter("user"),
      fields:
        "id,user,mode,push,sound,previews,attenuation_override,created,updated",
    }),
    list("dspeak_room_notification_preferences", {
      filter: userFilter("user"),
      fields: "id,user,room,mode,push,sound,created,updated",
    }),
    list("dspeak_push_subscriptions", {
      filter: userFilter("user"),
      fields:
        "id,user,device_id,endpoint,p256dh,auth,disabled,failure_count,last_success_at,user_agent,last_seen_at,created,updated",
    }),
    list("dspeak_push_jobs", {
      filter: userFilter("recipient"),
      fields:
        "id,recipient,subscription,message,dedupe_key,payload,status,attempts,next_attempt_at,locked_until,expires_at,last_error,delivered_at,finished_at,created,updated",
    }),
    list("dspeak_room_soundboards", {
      filter: userFilter("uploader"),
      fields:
        "id,room,uploader,title,category,icon,media,duration,display_order,enabled,icon_image,created,updated",
    }),
    list("dspeak_chat_files", {
      filter: userFilter("uploader"),
      fields:
        "id,uploader,room_channel,message,file,name,size,mime_type,width,height,created,updated",
    }),
    list("dspeak_pinned_messages", {
      filter: userFilter("pinned_by"),
      fields: "id,message,channel,pinned_by,pinned_at,created,updated",
    }),
    list("dspeak_bookmarks", {
      filter: userFilter("user"),
      fields: "id,user,message,note,saved_at,created,updated",
    }),
    list("dspeak_friends", {
      filter: pb.filter("requester = {:user} || recipient = {:user}", {
        user: userId,
      }),
      fields: "id,requester,recipient,status,created,updated",
    }),
    list("dspeak_room_invites", {
      filter: userFilter("created_by"),
      fields: "id,room,created_by,created_at,expires_at,created,updated",
    }),
    list("dspeak_room_audit_log", {
      filter: pb.filter("actor = {:user} || subject = {:user}", {
        user: userId,
      }),
      fields:
        "id,room,action,actor,subject,invite,occurred_at,details,created,updated",
    }),
    list("dspeak_users_state", {
      filter: userFilter("user"),
      fields:
        "id,user,connected,muted,deafened,audioBroadcasting,videoSharing,screenSharing,created,updated",
    }),
  ]);

  setHeader(event, "Cache-Control", "private, no-store");
  setHeader(event, "Content-Type", "application/json; charset=utf-8");
  setHeader(
    event,
    "Content-Disposition",
    `attachment; filename="dspeak-export-${userId}-${Date.now()}.json"`,
  );

  return {
    exportedAt: new Date().toISOString(),
    user,
    sessions,
    rooms,
    memberships,
    channels,
    messages,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notifications,
    notificationPreferences,
    roomNotificationPreferences,
    pushSubscriptions,
    pushJobs,
    soundboards,
    chatFiles,
    pinnedMessages,
    bookmarks,
    friends,
    invites,
    auditLogs,
    voiceState,
  };
});
