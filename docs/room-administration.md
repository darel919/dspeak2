# Room administration contract

Room administration covers branding, roles, memberships, channel media policy,
notifications, user identity, stream attenuation, and room soundboards.

## Migration behavior

Room administration data lives in Supabase PostgreSQL. Schema changes are
checked-in Drizzle migrations under `drizzle/` and are applied before a release
serves traffic. A failed migration blocks the release rather than leaving the
application on a partial schema.

## Room and channel fields

The migration adds these fields to `dspeak_rooms`:

| Field          | Contract                                                   |
| -------------- | ---------------------------------------------------------- |
| `header_image` | One image, up to 5 MB                                      |
| `accent`       | `cobalt`, `cyan`, `violet`, `magenta`, `orange`, or `lime` |
| `attenuation`  | JSON attenuation policy                                    |

It adds `media_policy` JSON to `dspeak_rooms_channels`. The object contains
`hdAudio`, `microphoneKbps`, `cameraKbps`, `screenKbps`, `sharedAudioKbps`,
`revision`, and `updatedAt`.

| Source              | Supported policy                                    |
| ------------------- | --------------------------------------------------- |
| Standard microphone | Mono, 32–96 kbps; default 48 kbps                   |
| HD microphone       | Stereo, 64–256 kbps                                 |
| Camera              | Low 250, Medium 750, High 1500, Maximum 2000 kbps   |
| Screen video        | Low 2000, Medium 3000, High 4000, Maximum 6000 kbps |
| Shared audio        | Stereo, 64–256 kbps                                 |

Camera and screen frame rate still follow each user's selected target.

## Roles and memberships

`dspeak_room_roles` stores the room, role name, color, position, permissions,
system status, and default status. `(room, position)` is indexed.

`dspeak_room_memberships` stores the room, user, assigned roles, and join date.
Each `(room, user)` pair is unique, and `user` is indexed.

Rooms receive Owner, Admin, Moderator, and Member roles. Membership records are
the only room membership authority.

All room and channel mutations pass through
`server/utils/room-authorization.js`. Permissions from multiple roles combine.
A member can manage only roles and members below their highest role. The Owner
role is immutable, and only the owner may delete or transfer the room.
The room settings interface edits roles in a modal with human-readable
permission names. Member role buttons persist immediately, and the client and
server both prevent removal of a member's final role. Accent changes also
persist immediately and broadcast to connected clients as `room_updated`.
Members with `room.manage_members` can kick lower-ranked members from the member
list context menu. The server protects the owner, the acting member, and members
at or above the actor's highest role, then removes room and active-channel
membership before broadcasting the participant change.

Members with `channel.moderate_voice` can move a currently connected,
lower-ranked participant to another voice channel in the same room or disconnect
that participant from voice. Nitro validates membership and role hierarchy, then the external media-control
Durable Object closes or moves the live media session. The room owner, the acting member, and members
at or above the actor's highest role cannot be targeted.

## Invite links and audit history

Members with `room.manage_invites` create invite links from a Metro-style dialog
and choose a fixed expiry from 30 minutes through 7 days. Other roles see an
explicit permission-denied dialog. The URL path contains base64url-encoded JSON
with the invite record ID, creator, creation time, expiry, and room ID.

`dspeak_room_invites` is the server-side source of truth. Join and preview
requests compare every encoded field with the stored record and reject malformed,
modified, missing, or expired links. New room membership requires a valid invite.
The invite preview is available without an account; authentication is requested
when the visitor accepts, and the pending invite is completed after sign-in. The
join screen names the inviter and room before the member accepts.

`dspeak_room_audit_log` records invite creation and successful invite-based
joins. Room owners and roles with Manage invites or Manage members can view the
latest 100 entries under Room settings → Audit log.

## Notifications

`dspeak_notifications` stores recipient, actor, room, channel, message, type,
title, body, and nullable `read_at`. It indexes `(recipient, read_at, created)`
and `(recipient, room, channel)`.

`dspeak_notification_preferences` stores one record per user with delivery mode,
push, sound, previews, and attenuation override. Room-level preferences store
the user, room, mode, and nullable push and sound overrides; `(user, room)` is
unique.

Creating a message writes durable notification records and emits
`notification_created` through Supabase Realtime. Web Push is optional; the
PostgreSQL notification record remains the source of truth.

## User identity

`users.handle` is the unique dSpeak username. Handles are lowercase and contain
only letters, numbers, and underscores. A case-insensitive unique index prevents
duplicates. Migrated users may keep an empty handle until they edit their
profile.

Public identity displays prefer `users.handle`, followed by the provider
username when a migrated account has no handle. `users.display_name`, the
identity-provider name, email, and user ID are progressively used only when no
username is available. Compact member surfaces show only the preferred public
identity. A member's expanded profile card also shows the display name, or the
identity-provider full name when no display name is available.

`PATCH /api/profile` updates the handle, display name, or avatar. Duplicate
handles return HTTP 409. Avatars accept JPEG, PNG, or WebP files up to 5 MB.

`dspeak_user_nicknames` stores one private nickname per `(owner, target)` pair.
`GET /api/profile/nicknames` returns nicknames only to their owner.
`PUT /api/profile/nickname` creates, changes, or clears one. A nickname never
changes the target user's public profile; it is applied locally in chat, member,
and voice displays.

## Media policy and attenuation

A media-policy update persists a new revision, emits `channel_policy_updated`,
and reapplies sender limits without replacing tracks. Reconnecting clients
receive the latest policy in the channel response.

The room administration UI presents attenuation as **Speech priority**. Admins
choose how loud shared audio remains while someone speaks and select Fast,
Balanced, or Smooth volume changes. Relaxed, Standard, and Responsive
sensitivity presets control the sustained level and duration required to start
ducking. The saved room contract retains `reductionPercent`, `sensitivity`,
`attackMs`, and `releaseMs`.
Changes save automatically; rapid slider changes are debounced and room updates
are serialized so an older request cannot overwrite a newer choice.
Smooth uses a 900 ms fade-down and 2.2 second recovery. Rooms saved with the
earlier 250 ms and 1.2 second Smooth timing are normalized to the gentler
timing.

The remote-media registry applies the policy only to `screen-audio` and
`system-audio`. Cleanup follows the media entry that owns the playback resource.

## Soundboards

`dspeak_room_soundboards` stores protected clips, uploader ownership, display
metadata, duration, order, and enabled state. Owner and Admin roles receive
`room.manage_soundboard`. Members may upload and trigger enabled clips;
uploaders may manage their own clips; holders of the room permission may manage
the complete library.

See [Room soundboards and system sounds](soundboards.md) for file conversion,
authorization, playback, and limits.
