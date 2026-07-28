import {
  DEFAULT_ROLE_TEMPLATES,
  normalizeAttenuation,
} from "../../shared/room-policy.js";
import { DEFAULT_IDLE_TIMEOUT_MS } from "../../shared/presence-status.js";

const MIGRATION_COLLECTION = "dspeak_migrations";
const REQUIRED_COLLECTIONS = Object.freeze([
  "users",
  "dspeak_rooms",
  "dspeak_rooms_channels",
  "dspeak_messages",
  "dspeak_users_state",
  "dspeak_room_roles",
  "dspeak_room_memberships",
  "dspeak_notifications",
  "dspeak_notification_preferences",
  "dspeak_room_notification_preferences",
  "dspeak_user_nicknames",
  "dspeak_room_soundboards",
  "dspeak_push_subscriptions",
  "dspeak_push_jobs",
  "dspeak_sessions",
  "dspeak_message_revisions",
  "dspeak_room_invites",
  "dspeak_room_audit_log",
  "dspeak_friends",
  "dspeak_chat_files",
  "dspeak_message_reactions",
  "dspeak_pinned_messages",
  "dspeak_bookmarks",
]);

function field(name, type, options = {}) {
  return {
    name,
    type,
    required: false,
    hidden: false,
    presentable: false,
    system: false,
    ...options,
  };
}

export function mergeCollectionFields(current = [], additions = []) {
  const additionsByName = new Map(additions.map((item) => [item.name, item]));
  const merged = current.map((item) => {
    const addition = additionsByName.get(item.name);
    if (!addition) return item;
    additionsByName.delete(item.name);
    if (item.system) return item;
    const result = { ...item, ...addition };
    if (item.id) result.id = item.id;
    else delete result.id;
    return result;
  });
  return [...merged, ...additionsByName.values()];
}

function indexSignature(definition) {
  return definition
    .replaceAll(/["`[\]]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(
      /^CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?\S* ON /i,
      (_, unique = "") => `${unique ? "UNIQUE" : ""}ON `,
    )
    .replace(/\b(DESC|ASC|COLLATE \w+|NULLS (?:FIRST|LAST))\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function indexName(definition) {
  const match = definition.match(
    /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\S+)/i,
  );
  return match ? match[1].toLowerCase() : "";
}

export function mergeCollectionIndexes(current = [], additions = []) {
  const nameSet = new Set();
  const result = [];

  for (const idx of current) {
    const name = indexName(idx);
    if (name && nameSet.has(name)) continue;
    if (name) nameSet.add(name);
    result.push(idx);
  }

  for (const addition of additions) {
    const name = indexName(addition);
    if (name && nameSet.has(name)) continue;
    const signature = indexSignature(addition);
    if (result.some((existing) => indexSignature(existing) === signature))
      continue;
    if (name) nameSet.add(name);
    result.push(addition);
  }

  return result;
}

export function buildCollectionUpdate(current, definition) {
  const update = {
    fields: mergeCollectionFields(current.fields, definition.fields),
  };
  if (definition.indexes?.length) {
    update.indexes = mergeCollectionIndexes(
      current.indexes,
      definition.indexes,
    );
  }
  return update;
}

export function removeIndexesForFields(indexes = [], fieldNames = []) {
  const fields = new Set(fieldNames.map((name) => String(name).toLowerCase()));
  return indexes.filter((statement) => {
    const indexedDefinition = String(statement).replace(/^[\s\S]*?\bON\b/i, "");
    const tokens =
      indexedDefinition.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
    return !tokens.some((token) => fields.has(token));
  });
}

function collectionMigrationError(error, collection, operation) {
  const details =
    error?.response?.data || error?.data?.data || error?.response || null;
  const message =
    `[PocketBase migration] Failed ${operation} collection ` +
    `${JSON.stringify(collection.name)} (${collection.id || "new"}): ` +
    `${JSON.stringify(details)}`;
  return new Error(message, { cause: error });
}

async function findCollection(pb, name) {
  try {
    return await pb.collections.getOne(name);
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return null;
    throw error;
  }
}

async function upsertCollection(pb, definition) {
  const current = await findCollection(pb, definition.name);
  try {
    if (!current) return await pb.collections.create(definition);
    return await pb.collections.update(
      current.id,
      buildCollectionUpdate(current, definition),
    );
  } catch (error) {
    const indexErrors =
      error?.response?.data?.indexes || error?.data?.data?.indexes || null;
    const hasIndexNameConflict = indexErrors
      ? Object.values(indexErrors).some(
          (e) =>
            e?.code === "validation_duplicated_index_name" ||
            /duplicate.*index.*name/i.test(e?.message || ""),
        )
      : false;

    if (current && hasIndexNameConflict) {
      const update = {
        fields: mergeCollectionFields(current.fields, definition.fields),
      };
      return await pb.collections.update(current.id, update);
    }
    throw collectionMigrationError(
      error,
      current || definition,
      current ? "updating" : "creating",
    );
  }
}

async function ensureMigrationCollection(pb) {
  return upsertCollection(pb, {
    name: MIGRATION_COLLECTION,
    type: "base",
    fields: [
      field("name", "text", { required: true, max: 200 }),
      field("applied_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_migrations_name ON dspeak_migrations (name)",
    ],
  });
}

async function hasMigration(pb, name) {
  try {
    await pb
      .collection(MIGRATION_COLLECTION)
      .getFirstListItem(`name = '${name}'`);
    return true;
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return false;
    throw error;
  }
}

async function recordMigration(pb, name) {
  await pb.collection(MIGRATION_COLLECTION).create({
    name,
    applied_at: new Date().toISOString(),
  });
}

async function migrateFoundation(pb) {
  const users = await upsertCollection(pb, {
    name: "users",
    type: "auth",
    fields: [
      field("name", "text", { max: 120 }),
      field("username", "text", { max: 120 }),
      field("avatar", "file", {
        maxSelect: 1,
        maxSize: 2 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      }),
      field("online", "bool"),
    ],
    indexes: [],
  });

  const rooms = await upsertCollection(pb, {
    name: "dspeak_rooms",
    type: "base",
    fields: [
      field("name", "text", { required: true, max: 120 }),
      field("desc", "text", { max: 2000 }),
      field("picture", "file", {
        maxSelect: 1,
        maxSize: 2 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      }),
      field("owner", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
    ],
    indexes: ["CREATE INDEX idx_dspeak_rooms_owner ON dspeak_rooms (owner)"],
  });

  const channels = await upsertCollection(pb, {
    name: "dspeak_rooms_channels",
    type: "base",
    fields: [
      field("name", "text", { required: true, max: 120 }),
      field("desc", "text", { max: 2000 }),
      field("isMedia", "bool"),
      field("inRoom", "relation", {
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 999,
      }),
      field("owner", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_channels_room ON dspeak_rooms_channels (room)",
    ],
  });

  await upsertCollection(pb, {
    name: rooms.name,
    type: rooms.type,
    fields: [
      field("channels", "relation", {
        collectionId: channels.id,
        cascadeDelete: false,
        maxSelect: 999,
      }),
    ],
    indexes: [],
  });

  await upsertCollection(pb, {
    name: "dspeak_messages",
    type: "base",
    fields: [
      field("content", "text", { required: true, max: 4000 }),
      field("room_channel", "relation", {
        required: true,
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("sender", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("read_by", "relation", {
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 999,
      }),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_messages_channel_created ON dspeak_messages (room_channel, created)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_users_state",
    type: "base",
    fields: [
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("connected", "relation", {
        required: true,
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("muted", "bool"),
      field("deafened", "bool"),
      field("audioBroadcasting", "bool"),
      field("videoSharing", "bool"),
      field("screenSharing", "bool"),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_users_state_user ON dspeak_users_state (user)",
      "CREATE INDEX idx_dspeak_users_state_connected ON dspeak_users_state (connected)",
    ],
  });
}

async function migrateRoomAdministration(pb) {
  const users = await pb.collections.getOne("users");
  const rooms = await pb.collections.getOne("dspeak_rooms");
  const channels = await pb.collections.getOne("dspeak_rooms_channels");
  const messages = await pb.collections.getOne("dspeak_messages");

  await upsertCollection(pb, {
    name: rooms.name,
    type: rooms.type,
    fields: [
      field("header_image", "file", {
        maxSelect: 1,
        maxSize: 5 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      }),
      field("accent", "select", {
        maxSelect: 1,
        values: ["cobalt", "cyan", "violet", "magenta", "orange", "lime"],
      }),
      field("attenuation", "json", { maxSize: 10000 }),
    ],
    indexes: [],
  });

  await upsertCollection(pb, {
    name: channels.name,
    type: channels.type,
    fields: [field("media_policy", "json", { maxSize: 10000 })],
    indexes: [],
  });

  const roles = await upsertCollection(pb, {
    name: "dspeak_room_roles",
    type: "base",
    fields: [
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("name", "text", { required: true, max: 80 }),
      field("color", "select", {
        required: true,
        maxSelect: 1,
        values: ["cobalt", "cyan", "violet", "magenta", "orange", "lime"],
      }),
      field("position", "number", { required: true, min: 1, max: 1000 }),
      field("permissions", "json", { maxSize: 20000 }),
      field("system", "bool"),
      field("is_default", "bool"),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_room_roles_room_position ON dspeak_room_roles (room, position)",
      "CREATE UNIQUE INDEX idx_dspeak_room_roles_room_name ON dspeak_room_roles (room, name)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_room_memberships",
    type: "base",
    fields: [
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("roles", "relation", {
        collectionId: roles.id,
        cascadeDelete: false,
        maxSelect: 99,
      }),
      field("joined_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_memberships_room_user ON dspeak_room_memberships (room, user)",
      "CREATE INDEX idx_dspeak_memberships_user ON dspeak_room_memberships (user)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_notifications",
    type: "base",
    fields: [
      field("recipient", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("type", "text", { required: true, max: 80 }),
      field("actor", "relation", {
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("room", "relation", {
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("channel", "relation", {
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("message", "relation", {
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("title", "text", { max: 240 }),
      field("body", "text", { max: 2000 }),
      field("read_at", "date"),
      field("created", "autodate", { onCreate: true, onUpdate: false }),
      field("updated", "autodate", { onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_notifications_unread ON dspeak_notifications (recipient, read_at)",
      "CREATE INDEX idx_dspeak_notifications_context ON dspeak_notifications (recipient, room, channel)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_notification_preferences",
    type: "base",
    fields: [
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("mode", "select", {
        required: true,
        maxSelect: 1,
        values: ["all", "mentions", "muted"],
      }),
      field("push", "bool"),
      field("sound", "bool"),
      field("previews", "bool"),
      field("attenuation_override", "json", { maxSize: 10000 }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_notification_preferences_user ON dspeak_notification_preferences (user)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_room_notification_preferences",
    type: "base",
    fields: [
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("mode", "select", {
        required: true,
        maxSelect: 1,
        values: ["all", "mentions", "muted"],
      }),
      field("push", "bool"),
      field("sound", "bool"),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_room_notification_user_room ON dspeak_room_notification_preferences (user, room)",
    ],
  });

  const roomRecords = await pb.collection("dspeak_rooms").getFullList({
    fields: "id,owner,accent,attenuation",
  });
  for (const room of roomRecords) {
    await pb.collection("dspeak_rooms").update(room.id, {
      accent: room.accent || "cobalt",
      attenuation: normalizeAttenuation(room.attenuation),
    });
    const existingRoles = await pb.collection("dspeak_room_roles").getFullList({
      filter: `room = '${room.id}'`,
    });
    const roleMap = new Map(existingRoles.map((role) => [role.name, role]));
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      if (roleMap.has(template.name)) continue;
      const created = await pb.collection("dspeak_room_roles").create({
        room: room.id,
        ...template,
        permissions: [...template.permissions],
      });
      roleMap.set(created.name, created);
    }
    const existing = await pb
      .collection("dspeak_room_memberships")
      .getFullList({ filter: `room = '${room.id}' && user = '${room.owner}'` });
    if (!existing.length) {
      const role = roleMap.get("Owner");
      await pb.collection("dspeak_room_memberships").create({
        room: room.id,
        user: room.owner,
        roles: role ? [role.id] : [],
        joined_at: new Date().toISOString(),
      });
    }
  }
}

async function migrateUserProfiles(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: users.name,
    type: users.type,
    fields: [field("display_name", "text", { max: 32 })],
    indexes: [],
  });
  await upsertCollection(pb, {
    name: "dspeak_user_nicknames",
    type: "base",
    fields: [
      field("owner", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("target", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("nickname", "text", { required: true, max: 32 }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_user_nicknames_owner_target ON dspeak_user_nicknames (owner, target)",
      "CREATE INDEX idx_dspeak_user_nicknames_owner ON dspeak_user_nicknames (owner)",
    ],
  });
}

async function migrateUniqueUserHandles(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: users.name,
    type: users.type,
    fields: [field("handle", "text", { max: 32 })],
    indexes: [
      "CREATE UNIQUE INDEX idx_users_handle_unique ON users (handle COLLATE NOCASE) WHERE handle != ''",
    ],
  });
}

async function migrateRoomSoundboards(pb) {
  const users = await pb.collections.getOne("users");
  const rooms = await pb.collections.getOne("dspeak_rooms");
  await upsertCollection(pb, {
    name: "dspeak_room_soundboards",
    type: "base",
    fields: [
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("uploader", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("title", "text", { required: true, max: 48 }),
      field("category", "text", { required: true, max: 32 }),
      field("icon", "text", { max: 16 }),
      field("media", "file", {
        required: true,
        maxSelect: 1,
        maxSize: 512 * 1024,
        mimeTypes: ["audio/ogg"],
      }),
      field("duration", "number", { required: true, min: 0, max: 10 }),
      field("display_order", "number", { min: 0 }),
      field("enabled", "bool"),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_soundboards_room_order ON dspeak_room_soundboards (room, display_order)",
      "CREATE INDEX idx_dspeak_soundboards_room_enabled ON dspeak_room_soundboards (room, enabled)",
    ],
  });
  const roles = await pb.collection("dspeak_room_roles").getFullList({
    filter: "name = 'Owner' || name = 'Admin'",
  });
  for (const role of roles) {
    const permissions = [
      ...new Set([...(role.permissions || []), "room.manage_soundboard"]),
    ];
    await pb.collection("dspeak_room_roles").update(role.id, { permissions });
  }
}

async function migrateSoundboardIcons(pb) {
  const soundboards = await pb.collections.getOne("dspeak_room_soundboards");
  await upsertCollection(pb, {
    name: soundboards.name,
    type: soundboards.type,
    fields: [
      field("icon_image", "file", {
        maxSelect: 1,
        maxSize: 256 * 1024,
        mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"],
      }),
    ],
    indexes: [],
  });
}

async function migrateVoiceModerationPermission(pb) {
  const roles = await pb.collection("dspeak_room_roles").getFullList({
    filter: "name = 'Owner' || name = 'Admin'",
  });
  for (const role of roles) {
    const permissions = [
      ...new Set([...(role.permissions || []), "channel.moderate_voice"]),
    ];
    await pb.collection("dspeak_room_roles").update(role.id, { permissions });
  }
}

async function migratePushDelivery(pb) {
  const users = await pb.collections.getOne("users");
  const messages = await pb.collections.getOne("dspeak_messages");
  const notifications = await pb.collections.getOne("dspeak_notifications");
  const notificationRecords = await pb
    .collection("dspeak_notifications")
    .getFullList({
      fields: "id,recipient,message,type",
    });
  const notificationKeys = new Set();
  for (const notification of notificationRecords) {
    if (!notification.message) continue;
    const key = [
      notification.recipient,
      notification.message,
      notification.type,
    ].join(":");
    if (notificationKeys.has(key)) {
      await pb.collection("dspeak_notifications").delete(notification.id);
      continue;
    }
    notificationKeys.add(key);
  }
  await upsertCollection(pb, {
    name: notifications.name,
    type: notifications.type,
    fields: [],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_notifications_message_recipient ON dspeak_notifications (recipient, message, type) WHERE message != ''",
    ],
  });
  const subscriptions = await upsertCollection(pb, {
    name: "dspeak_push_subscriptions",
    type: "base",
    fields: [
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("device_id", "text", { required: true, max: 128 }),
      field("endpoint", "text", { required: true, max: 4096 }),
      field("p256dh", "text", { required: true, max: 512 }),
      field("auth", "text", { required: true, max: 512 }),
      field("disabled", "bool"),
      field("failure_count", "number", { min: 0 }),
      field("last_success_at", "date"),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_push_subscriptions_endpoint ON dspeak_push_subscriptions (endpoint)",
      "CREATE INDEX idx_dspeak_push_subscriptions_user_device ON dspeak_push_subscriptions (user, device_id)",
    ],
  });
  await upsertCollection(pb, {
    name: "dspeak_push_jobs",
    type: "base",
    fields: [
      field("recipient", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("subscription", "relation", {
        required: true,
        collectionId: subscriptions.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("message", "relation", {
        required: true,
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("dedupe_key", "text", { required: true, max: 240 }),
      field("payload", "json", { required: true, maxSize: 20000 }),
      field("status", "select", {
        required: true,
        maxSelect: 1,
        values: ["pending", "sending", "delivered", "failed", "expired"],
      }),
      field("attempts", "number", { min: 0, max: 20 }),
      field("next_attempt_at", "date", { required: true }),
      field("locked_until", "date"),
      field("expires_at", "date", { required: true }),
      field("last_error", "text", { max: 500 }),
      field("delivered_at", "date"),
      field("finished_at", "date"),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_push_jobs_dedupe ON dspeak_push_jobs (dedupe_key)",
      "CREATE INDEX idx_dspeak_push_jobs_dispatch ON dspeak_push_jobs (status, next_attempt_at)",
      "CREATE INDEX idx_dspeak_push_jobs_expiry ON dspeak_push_jobs (expires_at)",
      "CREATE INDEX idx_dspeak_push_jobs_finished ON dspeak_push_jobs (finished_at)",
    ],
  });
}

async function migratePushJobRetention(pb) {
  const jobs = await pb.collections.getOne("dspeak_push_jobs");
  await upsertCollection(pb, {
    name: jobs.name,
    type: jobs.type,
    fields: [field("finished_at", "date")],
    indexes: [
      "CREATE INDEX idx_dspeak_push_jobs_finished ON dspeak_push_jobs (finished_at)",
    ],
  });
}

async function migratePushJobZeroAttempts(pb) {
  const jobs = await pb.collections.getOne("dspeak_push_jobs");
  await upsertCollection(pb, {
    name: jobs.name,
    type: jobs.type,
    fields: [field("attempts", "number", { min: 0, max: 20 })],
    indexes: [],
  });
}

async function migrateAuthenticatedSessions(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: "dspeak_sessions",
    type: "base",
    fields: [
      field("token_hash", "text", { required: true, max: 64 }),
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("device_id", "text", { required: true, max: 128 }),
      field("expires_at", "date", { required: true }),
      field("last_seen_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_sessions_token ON dspeak_sessions (token_hash)",
      "CREATE INDEX idx_dspeak_sessions_expiry ON dspeak_sessions (expires_at)",
      "CREATE UNIQUE INDEX idx_dspeak_sessions_user_device ON dspeak_sessions (user, device_id)",
    ],
  });
}

async function migrateLegalConsent(pb) {
  const sessions = await pb.collections.getOne("dspeak_sessions");
  await upsertCollection(pb, {
    name: sessions.name,
    type: sessions.type,
    fields: [field("terms_accepted_at", "date")],
    indexes: [],
  });
}

async function migrateAccountDeletionState(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: users.name,
    type: users.type,
    fields: [field("deleted_at", "date")],
    indexes: [],
  });
}

async function migrateMessageIdempotency(pb) {
  const messages = await pb.collections.getOne("dspeak_messages");
  await upsertCollection(pb, {
    name: messages.name,
    type: messages.type,
    fields: [field("client_id", "text", { max: 80 })],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_messages_sender_client ON dspeak_messages (sender, client_id) WHERE client_id != ''",
    ],
  });
}

async function migrateMessageRevisions(pb) {
  const users = await pb.collections.getOne("users");
  const messages = await pb.collections.getOne("dspeak_messages");
  await upsertCollection(pb, {
    name: messages.name,
    type: messages.type,
    fields: [field("edited_at", "date")],
    indexes: [],
  });
  await upsertCollection(pb, {
    name: "dspeak_message_revisions",
    type: "base",
    fields: [
      field("message", "relation", {
        required: true,
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("editor", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("content", "text", { required: true, max: 4000 }),
      field("revision", "number", { required: true, min: 1 }),
      field("edited_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_message_revision_number ON dspeak_message_revisions (message, revision)",
      "CREATE INDEX idx_dspeak_message_revision_time ON dspeak_message_revisions (message, edited_at)",
    ],
  });
}

async function migrateSoundboardTimestamps(pb) {
  const soundboards = await pb.collections.getOne("dspeak_room_soundboards");
  await upsertCollection(pb, {
    name: soundboards.name,
    type: soundboards.type,
    fields: [
      field("created", "autodate", { onCreate: true, onUpdate: false }),
      field("updated", "autodate", { onCreate: true, onUpdate: true }),
    ],
    indexes: [],
  });
}

async function migrateSoundboardDisplayOrder(pb) {
  const soundboards = await pb.collections.getOne("dspeak_room_soundboards");
  await upsertCollection(pb, {
    name: soundboards.name,
    type: soundboards.type,
    fields: [field("display_order", "number", { min: 0 })],
    indexes: [],
  });
}

async function migrateSoundboardDurationLimit(pb) {
  const soundboards = await pb.collections.getOne("dspeak_room_soundboards");
  await upsertCollection(pb, {
    name: soundboards.name,
    type: soundboards.type,
    fields: [field("duration", "number", { required: true, min: 0, max: 10 })],
    indexes: [],
  });
}

async function migrateRoomInvites(pb) {
  const users = await pb.collections.getOne("users");
  const rooms = await pb.collections.getOne("dspeak_rooms");
  const invites = await upsertCollection(pb, {
    name: "dspeak_room_invites",
    type: "base",
    fields: [
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("created_by", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("created_at", "date", { required: true }),
      field("expires_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_room_invites_room_created ON dspeak_room_invites (room, created_at)",
      "CREATE INDEX idx_dspeak_room_invites_expiry ON dspeak_room_invites (expires_at)",
    ],
  });
  await upsertCollection(pb, {
    name: "dspeak_room_audit_log",
    type: "base",
    fields: [
      field("room", "relation", {
        required: true,
        collectionId: rooms.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("action", "text", { required: true, max: 80 }),
      field("actor", "relation", {
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("subject", "relation", {
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("invite", "relation", {
        collectionId: invites.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("occurred_at", "date", { required: true }),
      field("details", "json", { maxSize: 10000 }),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_room_audit_room_time ON dspeak_room_audit_log (room, occurred_at)",
    ],
  });
}

async function removeObsoletePushCollections(pb) {
  for (const name of ["dspeak_webpush", "dspeak_webpush_global"]) {
    const collection = await findCollection(pb, name);
    if (!collection) continue;
    const records = await pb.collection(name).getFullList();
    for (const record of records) {
      const endpoint = record.endpoint || record.keys?.endpoint;
      const p256dh = record.p256dh || record.keys?.p256dh;
      const auth = record.auth || record.keys?.auth;
      if (!record.user || !endpoint || !p256dh || !auth) continue;
      let endpointUrl;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        continue;
      }
      if (endpointUrl.protocol !== "https:") continue;
      const existing = await pb
        .collection("dspeak_push_subscriptions")
        .getFullList({
          filter: pb.filter("endpoint = {:endpoint}", { endpoint }),
          fields: "id",
        });
      if (existing.length) continue;
      await pb.collection("dspeak_push_subscriptions").create({
        user: record.user,
        device_id: `migrated-${record.id}`,
        endpoint,
        p256dh,
        auth,
        disabled: false,
        failure_count: 0,
      });
    }
    await pb.collections.delete(collection.id);
  }
}

async function removeObsoleteContractFields(pb) {
  const roomCollection = await pb.collections.getOne("dspeak_rooms");
  if (
    roomCollection.fields.some(
      (fieldDefinition) => fieldDefinition.name === "members",
    )
  ) {
    const rooms = await pb
      .collection("dspeak_rooms")
      .getFullList({ fields: "id,owner,members" });
    for (const room of rooms) {
      const roles = await pb
        .collection("dspeak_room_roles")
        .getFullList({ filter: `room = '${room.id}'` });
      for (const userId of new Set([
        String(room.owner),
        ...(room.members || []).map(String),
      ])) {
        const memberships = await pb
          .collection("dspeak_room_memberships")
          .getFullList({
            filter: `room = '${room.id}' && user = '${userId}'`,
            fields: "id",
          });
        if (!memberships.length)
          await pb.collection("dspeak_room_memberships").create({
            room: room.id,
            user: userId,
            roles: roles
              .filter((role) =>
                String(userId) === String(room.owner)
                  ? role.system
                  : role.is_default,
              )
              .map((role) => role.id),
            joined_at: new Date().toISOString(),
          });
      }
    }
  }
  const channelCollection = await pb.collections.getOne(
    "dspeak_rooms_channels",
  );
  if (
    channelCollection.fields.some(
      (fieldDefinition) => fieldDefinition.name === "audio_bitrate",
    )
  ) {
    const channels = await pb
      .collection("dspeak_rooms_channels")
      .getFullList({ fields: "id,isMedia,audio_bitrate,media_policy" });
    for (const channel of channels) {
      if (!channel.isMedia || channel.media_policy) continue;
      const microphoneKbps = Number(channel.audio_bitrate) || 48;
      await pb.collection("dspeak_rooms_channels").update(channel.id, {
        media_policy: {
          hdAudio: microphoneKbps > 96,
          microphoneKbps,
          cameraKbps: 1500,
          screenKbps: 4000,
          sharedAudioKbps: 128,
          revision: 1,
          updatedAt: new Date().toISOString(),
        },
      });
    }
  }
  for (const [collection, obsoleteFields] of [
    [roomCollection, new Set(["members"])],
    [channelCollection, new Set(["audio_bitrate"])],
  ]) {
    if (
      !collection.fields.some((fieldDefinition) =>
        obsoleteFields.has(fieldDefinition.name),
      )
    )
      continue;
    await pb.collections.update(collection.id, {
      fields: collection.fields.filter(
        (fieldDefinition) => !obsoleteFields.has(fieldDefinition.name),
      ),
      indexes: removeIndexesForFields(collection.indexes, [...obsoleteFields]),
    });
  }
}

async function migratePresenceStatus(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: users.name,
    type: users.type,
    fields: [
      field("presence_status", "select", {
        maxSelect: 1,
        values: ["online", "idle", "dnd", "offline"],
      }),
    ],
    indexes: [
      "CREATE INDEX idx_users_presence_status ON users (presence_status)",
    ],
  });
}

async function migrateChannelPolicy(pb) {
  const channels = await pb.collections.getOne("dspeak_rooms_channels");
  await upsertCollection(pb, {
    name: channels.name,
    type: channels.type,
    fields: [
      field("policy", "select", {
        maxSelect: 1,
        values: ["free", "send_restricted", "read_only", "moderator_only"],
      }),
      field("slow_mode", "number", { min: 0, max: 3600 }),
    ],
    indexes: [],
  });
}

async function migrateFriends(pb) {
  const users = await pb.collections.getOne("users");
  await upsertCollection(pb, {
    name: "dspeak_friends",
    type: "base",
    fields: [
      field("requester", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("recipient", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("status", "select", {
        required: true,
        maxSelect: 1,
        values: ["pending", "accepted", "rejected", "blocked"],
      }),
      field("created", "autodate", { onCreate: true, onUpdate: false }),
      field("updated", "autodate", { onCreate: true, onUpdate: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_friends_pair ON dspeak_friends (requester, recipient)",
      "CREATE INDEX idx_dspeak_friends_recipient_status ON dspeak_friends (recipient, status)",
    ],
  });
}

async function migratePushSubscriptionMetadata(pb) {
  const subscriptions = await pb.collections.getOne(
    "dspeak_push_subscriptions",
  );
  await upsertCollection(pb, {
    name: subscriptions.name,
    type: subscriptions.type,
    fields: [
      field("user_agent", "text", { max: 512 }),
      field("last_seen_at", "date"),
    ],
    indexes: [],
  });
}

async function migrateNotificationUnreadIndex(pb) {
  const notifications = await pb.collections.getOne("dspeak_notifications");
  await upsertCollection(pb, {
    name: notifications.name,
    type: notifications.type,
    fields: [],
    indexes: [
      "CREATE INDEX idx_dspeak_notifications_recipient ON dspeak_notifications (recipient)",
    ],
  });
}

async function migrateChatFeatures(pb) {
  const users = await pb.collections.getOne("users");
  const channels = await pb.collections.getOne("dspeak_rooms_channels");
  const messages = await pb.collections.getOne("dspeak_messages");

  await upsertCollection(pb, {
    name: messages.name,
    type: messages.type,
    fields: [
      field("reply_to", "relation", {
        collectionId: messages.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("attachments", "json", { maxSize: 50000 }),
      field("pinned", "bool"),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_messages_reply_to ON dspeak_messages (reply_to)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_chat_files",
    type: "base",
    fields: [
      field("uploader", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("room_channel", "relation", {
        required: true,
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("message", "relation", {
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("file", "file", {
        maxSelect: 1,
        maxSize: 10 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      }),
      field("name", "text", { max: 255 }),
      field("size", "number"),
      field("mime_type", "text", { max: 100 }),
      field("width", "number"),
      field("height", "number"),
    ],
    indexes: [
      "CREATE INDEX idx_dspeak_chat_files_channel ON dspeak_chat_files (room_channel)",
      "CREATE INDEX idx_dspeak_chat_files_uploader ON dspeak_chat_files (uploader)",
      "CREATE INDEX idx_dspeak_chat_files_message ON dspeak_chat_files (message)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_message_reactions",
    type: "base",
    fields: [
      field("message", "relation", {
        required: true,
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("emoji", "text", { required: true, max: 80 }),
      field("skin_tone", "text", { max: 20 }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_reactions_message_user_emoji ON dspeak_message_reactions (message, user, emoji)",
      "CREATE INDEX idx_dspeak_reactions_message ON dspeak_message_reactions (message)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_pinned_messages",
    type: "base",
    fields: [
      field("message", "relation", {
        required: true,
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("channel", "relation", {
        required: true,
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("pinned_by", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      field("pinned_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_pinned_messages_message ON dspeak_pinned_messages (message)",
      "CREATE INDEX idx_dspeak_pinned_messages_channel ON dspeak_pinned_messages (channel)",
    ],
  });

  await upsertCollection(pb, {
    name: "dspeak_bookmarks",
    type: "base",
    fields: [
      field("user", "relation", {
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("message", "relation", {
        required: true,
        collectionId: messages.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
      field("note", "text", { max: 500 }),
      field("saved_at", "date", { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dspeak_bookmarks_user_message ON dspeak_bookmarks (user, message)",
      "CREATE INDEX idx_dspeak_bookmarks_user ON dspeak_bookmarks (user)",
    ],
  });
}

const migrations = Object.freeze([
  {
    name: "20260724_foundation_v1",
    run: migrateFoundation,
  },
  {
    name: "20260722_room_administration_v1",
    run: migrateRoomAdministration,
  },
  {
    name: "20260723_user_profiles_v1",
    run: migrateUserProfiles,
  },
  {
    name: "20260723_unique_user_handles_v1",
    run: migrateUniqueUserHandles,
  },
  {
    name: "20260723_room_soundboards_v1",
    run: migrateRoomSoundboards,
  },
  {
    name: "20260723_soundboard_icons_v1",
    run: migrateSoundboardIcons,
  },
  {
    name: "20260723_soundboard_timestamps_v1",
    run: migrateSoundboardTimestamps,
  },
  {
    name: "20260723_soundboard_display_order_v1",
    run: migrateSoundboardDisplayOrder,
  },
  {
    name: "20260723_soundboard_duration_10s_v1",
    run: migrateSoundboardDurationLimit,
  },
  { name: "20260723_room_invites_v1", run: migrateRoomInvites },
  {
    name: "20260723_voice_moderation_permission_v1",
    run: migrateVoiceModerationPermission,
  },
  {
    name: "20260723_push_delivery_v1",
    run: migratePushDelivery,
  },
  {
    name: "20260723_authenticated_sessions_v1",
    run: migrateAuthenticatedSessions,
  },
  {
    name: "20260728_legal_consent_v1",
    run: migrateLegalConsent,
  },
  {
    name: "20260728_account_deletion_state_v1",
    run: migrateAccountDeletionState,
  },
  {
    name: "20260723_message_idempotency_v1",
    run: migrateMessageIdempotency,
  },
  {
    name: "20260723_message_revisions_v1",
    run: migrateMessageRevisions,
  },
  {
    name: "20260723_push_job_retention_v1",
    run: migratePushJobRetention,
  },
  {
    name: "20260723_push_job_zero_attempts_v1",
    run: migratePushJobZeroAttempts,
  },
  {
    name: "20260725_remove_obsolete_push_collections_v1",
    run: removeObsoletePushCollections,
  },
  {
    name: "20260725_remove_obsolete_contract_fields_v1",
    run: removeObsoleteContractFields,
  },
  {
    name: "20260727_presence_status_v1",
    run: migratePresenceStatus,
  },
  {
    name: "20260727_channel_policy_v1",
    run: migrateChannelPolicy,
  },
  {
    name: "20260727_friends_v1",
    run: migrateFriends,
  },
  {
    name: "20260727_push_subscription_metadata_v1",
    run: migratePushSubscriptionMetadata,
  },
  {
    name: "20260727_notification_unread_index_v1",
    run: migrateNotificationUnreadIndex,
  },
  {
    name: "20260728_chat_features_v1",
    run: migrateChatFeatures,
  },
  {
    name: "20260728_foundation_schema_refresh_v1",
    run: migrateFoundation,
  },
  {
    name: "20260728_friends_schema_refresh_v1",
    run: migrateFriends,
  },
  {
    name: "20260728_chat_schema_refresh_v1",
    run: migrateChatFeatures,
  },
  {
    name: "20260728_sortable_timestamps_v1",
    run: async (pb) => {
      await migrateFoundation(pb);
      await migrateFriends(pb);
    },
  },
  {
    name: "20260728_notification_timestamps_v1",
    run: migrateRoomAdministration,
  },
]);

export async function runPocketBaseMigrations(pb, logger = console) {
  await ensureMigrationCollection(pb);
  const missingCollections = (
    await Promise.all(
      REQUIRED_COLLECTIONS.map(async (name) => ({
        name,
        exists: Boolean(await findCollection(pb, name)),
      })),
    )
  )
    .filter((collection) => !collection.exists)
    .map((collection) => collection.name);
  const applied = [];
  for (const migration of migrations) {
    const completed = await hasMigration(pb, migration.name);
    if (completed && !missingCollections.length) continue;
    const operation = completed ? "Repairing with" : "Applying";
    logger.info(`[PocketBase migration] ${operation} ${migration.name}`);
    await migration.run(pb);
    if (!completed) {
      await recordMigration(pb, migration.name);
      applied.push(migration.name);
    }
    logger.info(
      `[PocketBase migration] ${completed ? "Repaired" : "Applied"} ${migration.name}`,
    );
  }
  if (!applied.length) logger.debug("[PocketBase migration] Schema is current");
  return applied;
}
