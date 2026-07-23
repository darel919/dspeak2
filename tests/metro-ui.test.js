import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated shell owns fixed navigation and page content", async () => {
  const layout = await readFile("app/layouts/default.vue", "utf8");
  assert.match(layout, /v-if="authenticated"\s+class="authenticated-shell"/);
  assert.match(layout, /<MetroRoomRail\s*\/>/);
  assert.match(layout, /<Navbar\s*\/>/);
});

test("Metro geometry covers shell, overlays, and standalone utility flows", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  for (const boundary of [
    ".authenticated-shell *",
    ".metro-standalone *",
    ".metro-pane *",
    ".modal *",
    ".toast *",
  ])
    assert.equal(css.includes(boundary), true, `${boundary} must stay square`);
});

test("authenticated page copy consistently calls shared spaces rooms", async () => {
  const files = [
    "app/pages/index.vue",
    "app/components/MobileRoomSidebar.vue",
    "app/components/MobileChannelList.vue",
  ];
  const source = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(
    source,
    /Join Server|Create Server|No servers|This server|Select a server/,
  );
});

test("channel editor owns the complete live media policy", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  const roomSettings = await readFile(
    "app/pages/room/[roomId]/settings.vue",
    "utf8",
  );
  const api = await readFile("server/utils/dspeak-api.js", "utf8");
  assert.match(source, /channel\.manage_media_policy/);
  assert.match(source, /editingChannelPolicy\[field\.key\]/);
  assert.match(source, /type="range"/);
  assert.match(source, /editingChannelPolicy\.hdAudio/);
  assert.doesNotMatch(roomSettings, /Channel media policies/);
  assert.doesNotMatch(api, /body\.audio_bitrate && channel\.isMedia/);
});

test("room settings opens the full administration route", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(
    source,
    /navigateTo\(`\/room\/\$\{props\.room\.id\}\/settings`\)/,
  );
  assert.doesNotMatch(source, /showRoomSettings/);
});

test("soundboard managers can upload from room administration", async () => {
  const admin = await readFile("app/components/SoundboardAdmin.vue", "utf8");
  const panel = await readFile("app/components/SoundboardPanel.vue", "utf8");
  const uploader = await readFile(
    "app/components/SoundboardUploadDialog.vue",
    "utf8",
  );
  assert.match(admin, /Add sound/);
  assert.match(admin, /<SoundboardUploadDialog/);
  assert.match(panel, /<SoundboardUploadDialog/);
  assert.match(uploader, /await store\.upload\(props\.roomId/);
});

test("room branding places the banner in navigation and the avatar above the room name", async () => {
  const layout = await readFile("app/layouts/default.vue", "utf8");
  const navbar = await readFile("app/components/Navbar.vue", "utf8");
  const channels = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(layout, /roomHasHeaderImage \? '6rem' : undefined/);
  assert.match(navbar, /currentRoom\.value\?\.headerImage/);
  assert.match(navbar, /class="room-banner-shade absolute inset-0"/);
  assert.match(navbar, /background-position: center/);
  assert.match(navbar, /background-repeat: no-repeat/);
  assert.match(navbar, /background-size: cover/);
  assert.match(navbar, /<Transition name="room-banner">/);
  assert.match(navbar, /\.room-navbar \{/);
  assert.match(navbar, /\.room-banner-enter-active/);
  assert.match(layout, /class="authenticated-shell"/);
  assert.match(
    await readFile("app/assets/app.css", "utf8"),
    /\.authenticated-shell > main \{/,
  );
  assert.match(
    await readFile("app/assets/app.css", "utf8"),
    /\.authenticated-shell \.h-screen-minus-navbar \{/,
  );
  assert.match(channels, /v-if="room\?\.picture"/);
  assert.match(channels, /:alt="`\$\{room\.name\} avatar`"/);
  assert.doesNotMatch(channels, /room\?\.headerImage/);
});

test("notification dropdown renders above navbar call controls", async () => {
  const navbar = await readFile("app/components/Navbar.vue", "utf8");
  const notifications = await readFile(
    "app/components/NotificationCenter.vue",
    "utf8",
  );
  assert.doesNotMatch(navbar, /navbar[^\"]*overflow-hidden/);
  assert.match(notifications, /dropdown dropdown-end relative z-30/);
  assert.match(notifications, /dropdown-content metro-pane z-50/);
});

test("voice controls resize the stage instead of covering participant tiles", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /class="voice-controls-shell"/);
  assert.match(source, /grid-template-rows: 0fr/);
  assert.match(source, /\.voice-channel:hover \.voice-controls-shell/);
  assert.doesNotMatch(source, /class="voice-controls absolute/);
});

test("participant volume controls render outside the scrolling participant strip", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /<Teleport to="body">/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Adjust volume for/);
  assert.match(source, /max="2"/);
  assert.match(source, /<span>200%<\/span>/);
  assert.doesNotMatch(source, /absolute top-2 right-2 bg-base-200/);
});

test("voice channel indicators show participant avatars and media status", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  const server = await readFile("server/utils/mediasoup-sfu.js", "utf8");
  assert.match(source, /getUserAvatar\(u\.id \|\| u\)/);
  assert.match(source, /u\.speaking[\s\S]*font-medium text-base-content/);
  assert.match(source, /text-base-content\/45/);
  assert.match(source, /v-if="u\.soundboardActivity"/);
  assert.match(source, /Playing \{\{ u\.soundboardActivity\.title \}\}/);
  assert.match(source, /lucide:headphone-off/);
  assert.match(source, /lucide:mic-off/);
  assert.match(source, /lucide:video/);
  assert.match(source, /lucide:screen-share/);
  assert.match(source, /getChannelParticipants\(channel\)/);
  assert.match(source, /channel\.participantStates/);
  assert.match(server, /cameraEnabled: session\.sources\.has\("camera"\)/);
  assert.match(server, /screenSharing: session\.sources\.has\("screen"\)/);
});

test("room rail tooltips preview connected voice participants", async () => {
  const rail = await readFile("app/components/MetroRoomRail.vue", "utf8");
  const channels = await readFile("app/stores/channels.js", "utf8");
  assert.match(rail, /tooltipVoiceChannels/);
  assert.match(rail, /channel\.participants/);
  assert.match(rail, /participant\.avatar/);
  assert.match(rail, /participant\.name/);
  assert.match(rail, /lucide:volume-2/);
  assert.match(rail, /channelsStore\.syncVoicePresenceRooms/);
  assert.match(channels, /function getRoomChannels\(roomId\)/);
  assert.match(channels, /const voicePresenceConnections = new Map\(\)/);
  assert.match(
    channels,
    /applyVoicePresence\(payload\.data, normalizedRoomId\)/,
  );
  assert.match(channels, /function syncVoicePresenceRooms\(roomIds\)/);
});

test("voice channel participant rows own a channel-specific context menu", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(source, /@contextmenu\.prevent\.stop=/);
  assert.match(source, /openParticipantMenu\(u\.id \|\| u, \$event\)/);
  assert.match(source, /openParticipantMenu\(u\.id, \$event\)/);
  assert.match(source, /voiceStore\.setUserVolume/);
  assert.match(source, /Voice channel controls for/);
  assert.doesNotMatch(source, /channel-user-nickname/);
  assert.match(source, /<Teleport to="body">/);
});

test("channel rows open a permission-aware menu at the pointer", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(
    source,
    /@contextmenu\.prevent\.stop="openChannelMenu\(channel, \$event\)"/,
  );
  assert.match(source, /role="menu"/);
  assert.match(source, /canEditChannel\(contextChannel\)/);
  assert.match(source, /canDeleteChannel\(contextChannel\)/);
  assert.match(source, /window\.innerWidth - width - VIEWPORT_PADDING_PX/);
  assert.match(source, /window\.innerHeight - height - VIEWPORT_PADDING_PX/);
});

test("account settings update the public dSpeak profile", async () => {
  const source = await readFile("app/pages/settings.vue", "utf8");
  const api = await readFile("server/utils/dspeak-api.js", "utf8");
  const presence = await readFile("app/composables/usePresence.js", "utf8");
  assert.match(source, /Public profile/);
  assert.match(source, /form\.set\("displayName"/);
  assert.match(source, /form\.set\("avatar"/);
  assert.match(api, /normalizeDisplayName/);
  assert.match(api, /Profile picture/);
  assert.match(api, /broadcastGlobally/);
  assert.match(presence, /profile_updated/);
  assert.match(presence, /upsertPublicProfile/);
});

test("room administration uses explicit responsive form layouts", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /class="form-control/);
  assert.match(source, /lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(source, /file-input file-input-bordered w-full min-w-0/);
  assert.match(source, /1920 × 192 px \(10:1\) recommended/);
  assert.match(source, /Keep important content\s+centered/);
});

test("room role assignments use explicit role controls instead of a native multi-select", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /<select[\s\S]*multiple/);
  assert.match(source, /toggleMembershipRole\(membership, role\.id\)/);
  assert.match(source, /membershipSystemRoles\(membership\)/);
  assert.match(source, /Changes apply immediately/);
  assert.match(source, /if \(!nextSelection\.length\)/);
  assert.doesNotMatch(source, /Save roles/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /Edit room identity/);
  assert.doesNotMatch(source, /\{\{ permission \}\}/);
});

test("room accent changes persist and propagate immediately", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  const rooms = await readFile("app/stores/rooms.js", "utf8");
  const presence = await readFile("app/composables/usePresence.js", "utf8");
  const api = await readFile("server/utils/dspeak-api.js", "utf8");
  assert.match(source, /@click="saveAccent\(accent\)"/);
  assert.match(rooms, /applyRealtimeRoomUpdate/);
  assert.match(presence, /message\?\.type === "room_updated"/);
  assert.match(api, /type: "room_updated"/);
  assert.match(api, /A room member must have at least one role/);
  assert.match(api, /Assigned roles must belong to this room/);
});

test("member list exposes profile cards and persistent personal nickname controls", async () => {
  const source = await readFile("app/components/MemberList.vue", "utf8");
  const api = await readFile("server/utils/dspeak-api.js", "utf8");
  assert.match(source, /memberDisplayName\(profileCardUser\)/);
  assert.match(source, /profileFullName\(profileCardUser\)/);
  assert.match(source, /publicFullName\(identityStore\.profileFor\(member\)\)/);
  assert.match(source, /memberRoles\(profileCardUser\)/);
  assert.match(source, /Personal nickname/);
  assert.match(source, /identityStore\.saveNickname/);
  assert.match(source, /identityStore\.displayName\(member\)/);
  assert.match(source, /@click="openNicknameDialog"/);
  assert.match(source, /v-if="nicknameDialogUser"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /only changes how this member appears\s+to you/);
  assert.match(source, /View profile/);
  assert.doesNotMatch(source, /User Volume/);
  assert.match(source, /canKickMember\(memberMenuUser\)/);
  assert.match(source, /\/room\/kick/);
  assert.match(source, /Kick from room/);
  assert.match(source, /@contextmenu\.prevent="openMemberMenu/);
  assert.match(api, /rolesByUserId/);
  assert.match(api, /roles: rolesByUserId\.get/);
});

test("room rail owns a permission-aware context menu", async () => {
  const source = await readFile("app/components/MetroRoomRail.vue", "utf8");
  assert.match(source, /@contextmenu\.prevent\.stop="openRoomMenu/);
  assert.match(source, /openSelectedRoomSettings/);
  assert.match(source, /createSelectedRoomInvite/);
  assert.match(source, /RoomInviteDialog/);
  assert.match(source, /deleteSelectedRoom/);
  assert.match(source, /leaveSelectedRoom/);
});

test("room rail shows room names with an app-rendered tooltip", async () => {
  const source = await readFile("app/components/MetroRoomRail.vue", "utf8");
  assert.match(source, /@pointerenter="showRoomTooltip\(room, \$event\)"/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /\{\{ tooltipRoom\.name \}\}/);
  assert.doesNotMatch(source, /:title="room\.name"/);
});

test("room rail join action opens the join dialog", async () => {
  const rail = await readFile("app/components/MetroRoomRail.vue", "utf8");
  const dialog = await readFile("app/components/JoinRoomDialog.vue", "utf8");
  assert.match(rail, /@click="joinRoomDialog\?\.open\(\)"/);
  assert.match(rail, /<JoinRoomDialog ref="joinRoomDialog" \/>/);
  assert.doesNotMatch(rail, /function goHome/);
  assert.match(
    dialog,
    /router\.push\(`\/join\/\$\{encodeURIComponent\(inviteToken\)\}`\)/,
  );
});

test("room switching prepares the destination before one direct navigation", async () => {
  const rail = await readFile("app/components/MetroRoomRail.vue", "utf8");
  const navigation = await readFile(
    "app/composables/usePreparedRoomNavigation.js",
    "utf8",
  );
  const mobileRooms = await readFile(
    "app/components/MobileRoomSidebar.vue",
    "utf8",
  );
  const channels = await readFile("app/stores/channels.js", "utf8");
  const chat = await readFile("app/stores/chat.js", "utf8");
  const channelPage = await readFile(
    "app/pages/room/[roomId]/[channelId]/index.vue",
    "utf8",
  );
  assert.match(rail, /@click\.prevent="openRoom\(room\)"/);
  assert.match(navigation, /activate: false/);
  assert.match(
    navigation,
    /await chatStore\.prepareChannel\(destination\.id\)/,
  );
  assert.match(
    navigation,
    /channelsStore\.activateRoomChannels\(roomId, channels\)/,
  );
  assert.match(navigation, /`\/room\/\$\{roomId\}\/\$\{destination\.id\}`/);
  assert.match(mobileRooms, /await openRoom\(room\)/);
  assert.match(channels, /pendingRoomRequests/);
  assert.match(channels, /const roomChannels = reactive\(new Map\(\)\)/);
  assert.match(channels, /function getRoomChannelById\(roomId, channelId\)/);
  assert.match(chat, /pendingChannelPreparations/);
  assert.match(chat, /async function prepareChannel\(channelId\)/);
  assert.match(chat, /async function prepareChannels\(channelIds/);
  assert.match(chat, /PREPARED_CHANNEL_MAX_AGE_MS/);
  assert.match(channelPage, /await chatStore\.prepareChannel\(channel\.id\)/);
  assert.match(rail, /prefetchRoom\(room, \{ allChannels: true \}\)/);
  assert.match(rail, /prefetchRooms\(rooms\)/);
  assert.match(navigation, /connection\?\.saveData/);
  assert.match(navigation, /\["slow-2g", "2g"\]/);
  assert.equal((channelPage.match(/<ChatWindow/g) || []).length, 1);
  assert.doesNotMatch(channelPage, /v-show="!?isMobile"/);
  assert.match(channelPage, /channelSelectionGeneration/);
  assert.match(channelPage, /key: "room-channel"/);
  assert.match(channelPage, /ownedChatChannelId = String\(newChannelId\)/);
  assert.match(
    channelPage,
    /channelsStore\.getRoomChannelById\(roomId\.value, selectedChannelId\.value\)/,
  );
  assert.match(
    channelPage,
    /await voiceStore\.joinVoiceChannel\(selectedChannel\.value\.id\)/,
  );

  const channelList = await readFile("app/components/ChannelList.vue", "utf8");
  const mobileChannelList = await readFile(
    "app/components/MobileChannelList.vue",
    "utf8",
  );
  assert.doesNotMatch(
    channelList,
    /navigateTo\(`\/room\/\$\{props\.room\.id\}\/\$\{channel\.id\}`\)/,
  );
  assert.doesNotMatch(
    mobileChannelList,
    /navigateTo\(`\/room\/\$\{props\.room\.id\}\/\$\{channel\.id\}`\)/,
  );
});

test("app blocks the browser context menu by default", async () => {
  const source = await readFile("app/app.vue", "utf8");
  assert.match(
    source,
    /document\.addEventListener\("contextmenu", preventBrowserContextMenu, true\)/,
  );
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(
    source,
    /document\.removeEventListener\("contextmenu", preventBrowserContextMenu, true\)/,
  );
});
