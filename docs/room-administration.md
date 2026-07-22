# Room administration contract

The Metro room administration release adds room branding, custom roles,
versioned media policies, persistent notifications, and stream attenuation. The
Nitro API remains backward-compatible with the legacy `members` relation while
the new membership collections are being populated.

## PocketBase migration runner

The Nitro startup plugin authenticates as the configured PocketBase superuser
and runs pending migrations before mediasoup starts. Applied migration names are
stored in `dspeak_migrations`. A failed migration aborts application startup;
restarting safely retries the idempotent collection and backfill operations.

The runner automatically applies the following schema:

Add `header_image` (single image file, 5 MB), `accent` (cobalt, cyan, violet,
magenta, orange, or lime), and `attenuation` (JSON) to `dspeak_rooms`.

Add `media_policy` as JSON to `dspeak_rooms_channels`. Its keys are
`microphoneKbps`, `cameraKbps`, `screenKbps`, `sharedAudioKbps`, `revision`, and
`updatedAt`. Keep `audio_bitrate` during the compatibility period.

Create `dspeak_room_roles` with `room` (relation), `name` (text), `color`
(select), `position` (number), `permissions` (JSON), `system` (bool), and
`is_default` (bool). Add an index on `(room, position)`.

Create `dspeak_room_memberships` with `room` (relation), `user` (relation),
`roles` (multi-relation to `dspeak_room_roles`), and `joined_at` (date). Add a
unique index on `(room, user)` and an index on `user`.

Create `dspeak_notifications` with `recipient`, `actor`, `room`, `channel`, and
`message` relations; `type`, `title`, and `body` text fields; and nullable
`read_at`. Add indexes on `(recipient, read_at, created)` and
`(recipient, room, channel)`.

Create `dspeak_notification_preferences` with unique `user`, `mode` select
(`all`, `mentions`, `muted`), `push`, `sound`, and `previews` booleans, plus
`attenuation_override` JSON. Create `dspeak_room_notification_preferences` with
`user`, `room`, `mode`, and nullable push and sound overrides, uniquely indexed
on `(user, room)`.

For every existing room, create Owner, Admin, Moderator, and Member roles. Create
one membership per current member. Assign Owner to the room owner and Member to
every other member. Keep the legacy `members` relation until every deployed
client and maintenance task uses memberships.

## Authorization and realtime behavior

All room and channel mutations call `server/utils/room-authorization.js`.
Multiple roles combine permissions. A member may manage only roles and members
below their highest role. Owner is immutable and alone may delete or transfer
the room.

Changing a media policy persists a new revision, emits
`channel_policy_updated`, and reconfigures active RTP senders without replacing
tracks. Reconnecting clients receive the latest policy in the channel response.

Message creation writes recipient notification records and emits
`notification_created` to active user sockets. Web Push is optional; the
notification collection is the durable inbox.

Attenuation is applied by the remote-media registry only to `screen-audio` and
`system-audio`. Speech changes shared-stream volume over the configured attack
and release durations and cleanup follows the owning media entry.
