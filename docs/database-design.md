# Database design

PocketBase is dSpeak's persistent data store. Nitro is the only application
component that uses privileged PocketBase credentials; browser clients use the
authenticated Nitro API.

## Initialization and migration

Nitro runs `runPocketBaseMigrations` before starting the media runtime. The
initializer supports both an existing deployment and a new PocketBase instance:

1. Create or reconcile the `dspeak_migrations` ledger.
2. Detect whether any required dSpeak collection is absent.
3. Create the foundational auth, room, channel, message, push, and voice-state
   collections in dependency order.
4. Apply the feature migrations and record each completed migration.
5. If a required collection was removed after its migration was recorded,
   replay the idempotent schema operations to repair the current schema and its
   relation collection IDs.

Existing fields and indexes are merged by name. Field IDs are retained when a
field is updated so PocketBase data remains attached to the same schema field.
PocketBase-owned system fields retain their complete server-provided definitions,
and server-managed indexes are left out of collection updates unless a migration
adds an index. Multi-value relation fields are not assigned SQL indexes.
Startup fails if authentication, schema creation, repair, or data backfill
fails. The application never continues against a known partial schema.

The initializer does not create the first PocketBase superuser. Operators must
create that account and configure `POCKETBASE_URL`, `PBASE_ADMIN_EMAIL`, and
`PBASE_ADMIN_PASSWORD` before Nitro starts.

## Relationship map

```text
users
├── dspeak_sessions
├── dspeak_user_nicknames
├── dspeak_notification_preferences
├── dspeak_push_subscriptions ── dspeak_push_jobs
├── dspeak_rooms (owner and members)
│   ├── dspeak_rooms_channels
│   │   ├── dspeak_messages
│   │   │   ├── dspeak_message_revisions
│   │   │   ├── dspeak_notifications
│   │   │   └── dspeak_push_jobs
│   │   └── dspeak_users_state
│   ├── dspeak_room_roles ── dspeak_room_memberships
│   ├── dspeak_room_invites ── dspeak_room_audit_log
│   ├── dspeak_room_soundboards
│   └── dspeak_room_notification_preferences
└── legacy web-push collections
```

## Collection catalog

| Collection                             | Purpose                                                                | Principal relationships                                                          |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `users`                                | Auth identity and public profile                                       | Owns rooms, messages, memberships, preferences, sessions, and media state        |
| `dspeak_rooms`                         | Room identity, members, branding, and attenuation policy               | `owner`, `members` → `users`; `channels` → `dspeak_rooms_channels`               |
| `dspeak_rooms_channels`                | Text or media channel and current voice occupancy                      | `room` → rooms; `owner`, `inRoom` → users                                        |
| `dspeak_messages`                      | Current chat message and sender-only read state                        | `room_channel` → channels; `sender`, `read_by` → users                           |
| `dspeak_message_revisions`             | Append-only message edit history                                       | `message` → messages; `editor` → users                                           |
| `dspeak_room_roles`                    | Ordered room roles and permission arrays                               | `room` → rooms                                                                   |
| `dspeak_room_memberships`              | Canonical room membership and assigned roles                           | `room` → rooms; `user` → users; `roles` → room roles                             |
| `dspeak_room_invites`                  | Expiring room invite records                                           | `room` → rooms; `created_by` → users                                             |
| `dspeak_room_audit_log`                | Room administration audit events                                       | `room` → rooms; optional `actor`, `subject` → users; optional `invite` → invites |
| `dspeak_user_nicknames`                | Per-viewer nickname overrides                                          | `owner`, `target` → users                                                        |
| `dspeak_room_soundboards`              | Room-scoped converted audio clips and presentation data                | `room` → rooms; `uploader` → users                                               |
| `dspeak_notifications`                 | Durable in-application notification records                            | Recipient/actor users with optional room, channel, and message context           |
| `dspeak_notification_preferences`      | Global notification, push, preview, sound, and attenuation preferences | `user` → users                                                                   |
| `dspeak_room_notification_preferences` | Per-room notification overrides                                        | `user` → users; `room` → rooms                                                   |
| `dspeak_push_subscriptions`            | Device-scoped Web Push endpoints and delivery health                   | `user` → users                                                                   |
| `dspeak_push_jobs`                     | Durable, retryable Web Push work                                       | `recipient` → users; `subscription` → subscriptions; `message` → messages        |
| `dspeak_sessions`                      | Hashed application sessions                                            | `user` → users                                                                   |
| `dspeak_users_state`                   | Current persisted voice-control state                                  | `user` → users; `connected` → channels                                           |
| `dspeak_webpush`                       | Legacy room-scoped push subscription                                   | `room` → rooms; `user` → users                                                   |
| `dspeak_webpush_global`                | Read-only migration source for legacy global subscriptions             | `user` → users                                                                   |
| `dspeak_migrations`                    | Applied migration ledger                                               | No application relation                                                          |

## Ownership and deletion

- Room deletion cascades through room-owned channels and the feature records
  explicitly configured with cascading room relations.
- Channel deletion cascades through messages and active persisted voice state.
- User deletion cascades through sessions, memberships, preferences, push
  subscriptions, and voice state. Historical author, actor, editor, and
  uploader relations do not cascade where preserving content or audit history
  is required.
- `dspeak_room_memberships` is the authorization source. The `members` field on
  `dspeak_rooms` remains for the established room API and realtime contract and
  is updated with the membership record.
- Secrets are not stored in these collections. Session tokens are stored only
  as SHA-256 hashes; VAPID private keys and PocketBase superuser credentials
  remain runtime configuration.

## Integrity and access patterns

The schema enforces unique session tokens, one session per user/device, one
membership per room/user, unique role names within a room, unique message
client IDs per sender, ordered revision numbers per message, unique push
endpoints and job deduplication keys, and one active voice-state record per
user. Compound indexes cover room/channel listing, message history, unread
notifications, push dispatch, expiration, and audit history.

All application collections use administrator-only PocketBase rules by default.
Authorization is enforced by Nitro from the authenticated session, room
membership, role hierarchy, and explicit permissions before records are read or
mutated.
