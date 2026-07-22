import {
  DEFAULT_ROLE_TEMPLATES,
  normalizeAttenuation,
} from "../../shared/room-policy.js";
import { normalizeMediaPolicy } from "../../shared/media-policy.js";

const MIGRATION_COLLECTION = "dspeak_migrations";

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
    const result = { ...item, ...addition };
    if (item.id) result.id = item.id;
    else delete result.id;
    return result;
  });
  return [...merged, ...additionsByName.values()];
}

function mergeIndexes(current = [], additions = []) {
  return [...new Set([...current, ...additions])];
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
  if (!current) return pb.collections.create(definition);
  return pb.collections.update(current.id, {
    fields: mergeCollectionFields(current.fields, definition.fields),
    indexes: mergeIndexes(current.indexes, definition.indexes),
  });
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
    fields: "id,owner,members,accent,attenuation",
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
    const members = [
      ...new Set([room.owner, ...(room.members || [])].filter(Boolean)),
    ];
    for (const userId of members) {
      const existing = await pb
        .collection("dspeak_room_memberships")
        .getFullList({ filter: `room = '${room.id}' && user = '${userId}'` });
      if (existing.length) continue;
      const role =
        String(userId) === String(room.owner)
          ? roleMap.get("Owner")
          : roleMap.get("Member");
      await pb.collection("dspeak_room_memberships").create({
        room: room.id,
        user: userId,
        roles: role ? [role.id] : [],
        joined_at: new Date().toISOString(),
      });
    }
  }

  const channelRecords = await pb
    .collection("dspeak_rooms_channels")
    .getFullList({ fields: "id,isMedia,audio_bitrate,media_policy" });
  for (const channel of channelRecords) {
    if (!channel.isMedia || channel.media_policy) continue;
    await pb.collection("dspeak_rooms_channels").update(channel.id, {
      media_policy: normalizeMediaPolicy({}, channel.audio_bitrate),
    });
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

const migrations = Object.freeze([
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
]);

export async function runPocketBaseMigrations(pb, logger = console) {
  await ensureMigrationCollection(pb);
  const applied = [];
  for (const migration of migrations) {
    if (await hasMigration(pb, migration.name)) continue;
    logger.info(`[PocketBase migration] Applying ${migration.name}`);
    await migration.run(pb);
    await recordMigration(pb, migration.name);
    applied.push(migration.name);
    logger.info(`[PocketBase migration] Applied ${migration.name}`);
  }
  if (!applied.length) logger.debug("[PocketBase migration] Schema is current");
  return applied;
}
