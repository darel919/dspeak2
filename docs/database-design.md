# Database design

dSpeak stores durable application data in Supabase PostgreSQL. Nitro uses Drizzle ORM and server-only database credentials for privileged operations. Browser clients authenticate with Supabase Auth and receive authorized application data through Nitro APIs or RLS-protected Supabase Realtime channels.

## Schema and migrations

The canonical schema is defined in `server/db/schema/index.js`. Drizzle migrations are checked in under `drizzle/` and applied with `npx drizzle-kit migrate`. The project config prefers `DIRECT_DATABASE_URL` for this command; use a direct Supabase PostgreSQL connection rather than the transaction-pooled runtime connection.

```bash
npx drizzle-kit check
npx drizzle-kit migrate
```

`DIRECT_DATABASE_URL` must point to the Supabase direct database endpoint, normally port `5432`. `DATABASE_URL` remains the runtime fallback and normally uses Supavisor transaction pooling on port `6543`.

The persistent Nitro server uses a small runtime connection pool so background push maintenance cannot block authentication or normal API requests. `DATABASE_POOL_MAX` defaults to `10`; `DIRECT_DATABASE_POOL_MAX` defaults to `2` for migrations and direct transactions.

The initial migration creates the dSpeak policy on Supabase Realtime's managed `realtime.messages` table but does not change that table's ownership or RLS setting. Supabase owns that infrastructure table and supplies its RLS configuration; the migration only manages the dSpeak policy.

Schema changes must be represented by a checked-in migration. Back up the database before production migrations, apply migrations before routing traffic to a new release, and verify both the migration result and application health.

## Relationship map

```text
auth.users
└── profiles
    ├── rooms (owner)
    │   ├── channels
    │   │   ├── messages ── message_revisions / message_reactions
    │   │   ├── pinned_messages
    │   │   └── chat_files
    │   ├── room_roles ── membership_roles
    │   ├── room_memberships
    │   ├── room_invites ── room_audit_log
    │   ├── room_soundboards / soundboards
    │   └── room_notification_preferences
    ├── friends / user_nicknames
    ├── notifications / notification_preferences
    └── push_subscriptions ── push_jobs
```

## Core tables

| Table                                                                        | Purpose                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `profiles`                                                                   | Public application profile linked to a Supabase Auth user                       |
| `rooms`, `channels`                                                          | Room identity, ownership, channel ordering, media policy, and current occupancy |
| `room_roles`, `room_memberships`, `membership_roles`                         | Membership and role-based authorization                                         |
| `messages`, `message_revisions`, `message_reactions`                         | Chat content, edit history, and reactions                                       |
| `pinned_messages`, `bookmarks`                                               | Shared pins and private saved messages                                          |
| `friends`, `user_nicknames`                                                  | Social relationships and room-scoped nicknames                                  |
| `room_invites`, `room_audit_log`                                             | Expiring invites and administrative history                                     |
| `notifications`, `notification_preferences`, `room_notification_preferences` | Durable notification state and user preferences                                 |
| `push_subscriptions`, `push_jobs`                                            | Device Web Push subscriptions and retryable delivery work                       |
| `room_soundboards`, `soundboards`, `chat_files`                              | R2 object metadata and ownership; file bytes are not stored in PostgreSQL       |

## Ownership and deletion

- Room deletion cascades through room-owned channels, memberships, roles, invites, preferences, and media metadata where the schema declares a cascading foreign key.
- Channel deletion cascades through messages and channel-owned metadata.
- Supabase Auth user deletion cascades to the linked application profile and profile-owned records according to their foreign-key policy.
- Historical records use restrictive or nullable references where preserving content or audit context is required.
- `room_memberships` is the authorization source for room access; role assignments are normalized through `membership_roles`.

## Integrity and access

PostgreSQL unique indexes enforce invariants such as one membership per room and user, unique usernames, unique message reactions per user and emoji, and unique room notification preferences. Foreign keys enforce ownership and deletion behavior.

RLS must remain enabled on client-observable tables and Supabase Realtime topics. Nitro validates Supabase access tokens locally through JWKS, then enforces room membership, role hierarchy, and endpoint-specific permissions before privileged reads or writes. The Supabase service-role key, database credentials, R2 credentials, and signing keys must remain server-only.

Supabase Realtime carries normal application events such as chat, typing, presence, and notifications. Media membership, signaling, route epochs, and provider selection belong to the external `dspeak-media-control` Worker, not PostgreSQL or Realtime.
