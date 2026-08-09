# Room soundboards and system sounds

Room soundboards contain short effects uploaded by room members. A library
belongs to one room, and a trigger reaches only participants in the caller's
current voice channel.

## Clip contract

`dspeak_room_soundboards` stores:

- room and immutable uploader relations;
- name, category, emoji or protected icon;
- converted audio and decoded duration;
- display order and enabled state.

Production limits are fixed:

| Limit            | Value          |
| ---------------- | -------------- |
| Clips per room   | 50             |
| Source upload    | 5 MB           |
| Decoded duration | 10 seconds     |
| Required artwork | Emoji or image |

Nitro runs `ffprobe` and `ffmpeg` with argument arrays. It strips video and
metadata, downmixes to mono, resamples to 48 kHz, and creates a 24 kbps
variable-bitrate Ogg Opus file. Temporary input and output files are removed on
success and failure. Cloudflare R2 stores the converted audio; PostgreSQL stores
its object key and authorization metadata.

JPEG, PNG, WebP, and GIF icons are scaled without distortion, padded to 64 by 64
pixels, converted to ICO, and stored separately from their source images.

Docker includes FFmpeg and ffprobe. Both executables must be available on `PATH`
when dSpeak runs directly on a host.

## Authorization

Every soundboard endpoint requires an authenticated user. Listing, uploading,
downloading, and triggering require current room membership.

Updating, ordering, enabling, disabling, and deleting clips normally require
`room.manage_soundboard`. Owner and Admin roles receive this permission during
migration. An uploader may update, disable, or delete their own clips without
the room-wide permission.

R2 credentials and permanent object URLs are never exposed. Nitro checks
membership before issuing protected access and returns private caching headers.
Copying an application media URL therefore does not bypass room authorization.

## Trigger delivery

A trigger is accepted only when:

- the user has an active media-signaling session;
- the requested voice channel belongs to the room;
- the clip belongs to the same room; and
- the clip is available to that member.

Accepted triggers use the external media-control WebSocket. Multiple
clips may overlap. The event includes authenticated player identity and clip
display metadata. Participants see the clip name under the player for the
clip's decoded duration.

## Personal playback

Users have a browser-local global soundboard volume and optional per-room
overrides. Playback uses the selected output device when the browser supports
`setSinkId`. Each trigger owns an audio element and object URL, both of which are
released after playback or voice-surface teardown.

The voice soundboard supports search and category grouping. Disabled clips are
visible only to members allowed to manage them. Room soundboard managers can
upload clips from either the voice soundboard or the room-administration
Soundboard section.

## System sounds

dSpeak provides built-in system-sound themes. The default theme reads connection
sounds from:

- `public/sounds/default_connect.ogg`
- `public/sounds/default_disconnect.ogg`

Each user controls theme, volume, and mute state. Events cover successful voice
join and leave, screen-share start, and entry to or exit from a shared-screen
fullscreen viewer. Rooms and room administrators cannot replace system sounds.
