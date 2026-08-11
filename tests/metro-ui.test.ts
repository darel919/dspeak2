import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated shell owns fixed navigation and page content", async () => {
  const layout = await readFile("app/layouts/default.vue", "utf8");
  assert.match(layout, /'authenticated-shell': authenticated/);
  assert.match(layout, /<template v-if="authenticated">/);
  assert.equal(layout.match(/<slot\s*\/>/g)?.length, 1);
  assert.match(layout, /<MetroRoomRail\s*\/>/);
  assert.match(layout, /<Navbar\s*\/>/);
});

test("Metro geometry covers shell, overlays, and standalone utility flows", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  assert.match(css, /:where\(\s*\.alert,\s*\.btn,\s*\.card,/);
  assert.match(css, /\.metro-pane,\s*\.metro-flyout,\s*\.metro-status/);
  assert.doesNotMatch(css, /\.authenticated-shell,\s*\.authenticated-shell \*/);
  assert.doesNotMatch(css, /\.modal,\s*\.modal \*/);
});

test("Metro foundations include shared layout, state, motion, and contrast primitives", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  for (const primitive of [
    ".metro-page",
    ".metro-section",
    ".metro-toolbar",
    ".metro-flyout",
    ".metro-status",
    ".metro-skeleton",
    "@media (prefers-reduced-motion: reduce)",
    "@media (forced-colors: active)",
  ])
    assert.equal(css.includes(primitive), true, `${primitive} must be defined`);
  assert.match(css, /--metro-control-size: 2\.75rem/);
  assert.match(css, /outline: 2px solid var\(--metro-accent\)/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /--color-base-100: #111214/);
  assert.match(css, /--color-base-200: #17181c/);
  assert.match(css, /--color-base-300: #24262b/);
});

test("primary settings, startup, and media surfaces avoid ornamental chrome", async () => {
  const files = [
    "app/pages/settings.vue",
    "app/components/Init.vue",
    "app/components/VoiceChannel.vue",
    "app/components/SoundboardPanel.vue",
    "app/components/SoundboardUploadDialog.vue",
  ];
  const source = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(source, /bg-gradient/);
  assert.doesNotMatch(source, /backdrop-blur/);
  assert.doesNotMatch(source, /transition-all/);
  assert.doesNotMatch(source, /btn-circle/);
});

test("Metro implementation checks verify shipped source instead of a stale checklist", async () => {
  const source = await readFile("app/assets/app.css", "utf8");
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /@media \(forced-colors: active\)/);
  assert.match(source, /:focus-visible/);
});

test("error and toast overlays own their Metro geometry", async () => {
  const fatalPrompt = await readFile(
    "app/components/FatalErrorPrompt.vue",
    "utf8",
  );
  const toastContainer = await readFile(
    "app/components/ToastContainer.vue",
    "utf8",
  );
  const ui = await readFile("app/const/ui.ts", "utf8");

  assert.match(fatalPrompt, /fatal-error-flyout/);
  assert.match(fatalPrompt, /width: min\(100%, 32rem\)/);
  assert.match(fatalPrompt, /padding: var\(--metro-space-6\)/);
  assert.match(toastContainer, /metro-toast-region/);
  assert.match(
    toastContainer,
    /grid-template-columns: auto minmax\(0, 1fr\) auto/,
  );
  assert.doesNotMatch(toastContainer, /class="toast toast-top toast-end/);
  assert.match(ui, /error: "metro-status--error"/);
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

test("home workspace uses a content-led Metro room composition", async () => {
  const source = await readFile("app/pages/index.vue", "utf8");
  assert.match(source, /class="home-workspace flex-1 overflow-y-auto"/);
  assert.match(source, /aria-labelledby="home-rooms-title"/);
  assert.match(source, /v-for="room in roomsStore\.rooms"/);
  assert.match(source, /class="home-room-tile metro-transition/);
  assert.match(source, /v-if="roomsStore\.loading/);
  assert.match(source, /v-else-if="roomsStore\.error/);
  assert.doesNotMatch(source, /Welcome to dSpeak/);
  assert.doesNotMatch(source, /text-center max-w-md/);
});

test("channel editor owns the complete live media policy", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  const roomSettings = await readFile(
    "app/pages/room/[roomId]/settings.vue",
    "utf8",
  );
  const api = await readFile("server/utils/dspeak-rooms-api.ts", "utf8");
  assert.match(source, /channel\.manage_media_policy/);
  assert.match(source, /editingChannelPolicy\[field\.key\]/);
  assert.match(source, /type="range"/);
  assert.match(source, /editingChannelPolicy\.hdAudio/);
  assert.match(source, /aria-labelledby="edit-channel-title"/);
  assert.match(source, /max-h-\[min\(92dvh,56rem\)\]/);
  assert.match(source, /max-w-2xl/);
  assert.match(source, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(source, /Save channel/);
  assert.doesNotMatch(source, /rounded-box border border-base-300 bg-base-200/);
  assert.doesNotMatch(roomSettings, /Channel media policies/);
  assert.doesNotMatch(api, /body\.audio_bitrate && channel\.isMedia/);
});

test("channel creation and editing use bounded Metro command layouts", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(source, /aria-labelledby="create-channel-title"/);
  assert.match(source, /Create a channel/);
  assert.match(source, /Create channel/);
  assert.match(source, /flex flex-col-reverse gap-2 border-t/);
  assert.match(source, /grid grid-cols-2 border-l border-t/);
  assert.doesNotMatch(source, />Create Channel</);
  assert.doesNotMatch(source, />Save Changes</);
});

test("channel action menus stay hidden until their trigger is active", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  const css = await readFile("app/assets/app.css", "utf8");
  assert.match(source, /relative flex w-full flex-col items-center/);
  assert.match(source, /metro-menu absolute right-0 top-full/);
  assert.match(css, /\.dropdown\.absolute\s*\{\s*position: absolute;/);
  assert.match(css, /\.metro-menu \{[\s\S]*?visibility: hidden/);
  assert.match(css, /\.dropdown:hover > \.metro-menu/);
  assert.match(css, /\.dropdown:focus-within > \.metro-menu/);
});

test("voice overflow menus keep their trigger in the top bar", async () => {
  const source = await readFile("app/components/Navbar.vue", "utf8");
  assert.match(
    source,
    /<details\s+v-if="voiceStore\.connected"[\s\S]*?class="metro-call-menu"/,
  );
  assert.match(
    source,
    /\.metro-call-menu\s*\{\s*position: relative;\s*flex: none;\s*\}/,
  );
  assert.match(
    source,
    /\.metro-call-menu-content\s*\{[\s\S]*?position: absolute;[\s\S]*?top: calc\(100% \+ var\(--metro-space-3\)\)[\s\S]*?right: 0;/,
  );
  assert.doesNotMatch(source, /\.metro-call-menu\s*\{\s*position: absolute;/);
});

test("message action menus use Metro-sized rows and bounded scrolling", async () => {
  const source = await readFile(
    "app/components/Chat/MessageActions.vue",
    "utf8",
  );
  const css = await readFile("app/assets/app.css", "utf8");
  assert.match(source, /metro-message-actions-menu/);
  assert.match(
    css,
    /\.metro-message-actions-menu\s*\{[\s\S]*?max-height: min\(28rem, calc\(100dvh - 6rem\)\)[\s\S]*?overflow-y: auto/,
  );
  assert.match(
    css,
    /\.metro-message-actions-menu > li\[role="none"\] > button\s*\{[\s\S]*?display: flex/,
  );
  assert.match(
    css,
    /\.metro-message-actions-menu > li\[role="none"\] > button\s*\{[\s\S]*?gap: var\(--metro-space-3\)/,
  );
  assert.match(
    css,
    /\.metro-message-actions-menu > li\[role="none"\] > button\s*\{[\s\S]*?min-height: 2.75rem/,
  );
  assert.match(css, /\.metro-message-actions-menu > li\[role="separator"\]/);
});

test("chat message metadata keeps its action menu in the chat column", async () => {
  const source = await readFile("app/components/Chat/ChatMessage.vue", "utf8");
  assert.match(
    source,
    /\.metro-message-meta\s*\{[\s\S]*?display: flex[\s\S]*?align-items: center/,
  );
  assert.doesNotMatch(source, /\.metro-message-header\s*\{/);
});

test("missing member avatars use identity fallbacks instead of the dSpeak logo", async () => {
  const source = await readFile("app/components/MemberList.vue", "utf8");
  const chatUtils = await readFile("app/composables/useChatUtils.ts", "utf8");
  const onlineMembers = await readFile(
    "app/components/OnlineMembers.vue",
    "utf8",
  );
  const details = await readFile(
    "app/components/Chat/MessageDetailsModal.vue",
    "utf8",
  );
  assert.match(source, /<ProfileAvatar/);
  assert.match(onlineMembers, /<ProfileAvatar/);
  assert.doesNotMatch(
    source + chatUtils + onlineMembers + details,
    /favicon-32x32\.png/,
  );
});

test("self-message notification guards normalize sender IDs", async () => {
  const chat = (
    await Promise.all(
      [
        "store.ts",
        "cache.ts",
        "extras.ts",
        "messages.ts",
        "reads.ts",
        "transport.ts",
      ].map((file) => readFile(`app/stores/chat/${file}`, "utf8")),
    )
  ).join("\n");
  const manager = await readFile("app/utils/notificationManager.ts", "utf8");
  const store = await readFile("app/stores/notifications.ts", "utf8");
  const delivery = await readFile("server/utils/push-delivery.ts", "utf8");
  assert.match(
    chat,
    /const senderId = message\?\.sender\?\.id \|\| message\?\.sender;/,
  );
  assert.match(chat, /String\(senderId\) === String\(userData\.id\)/);
  assert.match(
    manager,
    /const viewerId = currentUserId \|\| storedUserData\?\.id/,
  );
  assert.match(manager, /String\(senderId\) === String\(viewerId\)/);
  assert.match(chat, /currentChannelName\.value,\s+userData\?\.id/);
  assert.match(store, /String\(senderId\) === String\(currentUserId\)/);
  assert.match(delivery, /\.filter\(\(id\) => id !== String\(senderId\)\)/);
  assert.match(delivery, /senderId: String\(message\.authorId/);
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
  assert.match(navbar, /\.metro-navbar \{/);
  assert.match(navbar, /\.room-banner-enter-active/);
  assert.match(layout, /'authenticated-shell': authenticated/);
  assert.match(
    await readFile("app/assets/app.css", "utf8"),
    /\.authenticated-shell > main \{/,
  );
  assert.match(
    await readFile("app/assets/app.css", "utf8"),
    /\.authenticated-shell \.h-screen-minus-navbar \{/,
  );
  assert.match(channels, /v-if="room\?\.picture"/);
  assert.match(channels, /:src="roomAssetUrl\(room\.picture\)"\s+alt=""/);
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

test("friends menu routes primary actions and refreshes when opened", async () => {
  const menu = await readFile("app/components/FriendsList.vue", "utf8");
  const page = await readFile("app/pages/friends.vue", "utf8");
  assert.match(menu, /@toggle="handleDropdownToggle"/);
  assert.match(menu, /to="\/friends"[\s\S]*?>\s*Friends\s*<\/NuxtLink>/);
  assert.match(menu, /navigateToAddFriend/);
  assert.match(menu, /path: "\/friends"[\s\S]*?tab: "add"/);
  assert.doesNotMatch(menu, />\s*Manage\s*</);
  assert.doesNotMatch(menu, /lucide:refresh-cw/);
  assert.doesNotMatch(menu, /Sent \(\{\{ sentRequests\.length \}\}\)/);
  assert.doesNotMatch(menu, /friendsView === 'sent'/);
  assert.doesNotMatch(menu, /friendsStore\.fetchSentRequests\(\)/);
  assert.match(page, /route\.query\.tab/);
});

test("voice controls remain visible in a compact floating dock", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /class="voice-command-dock/);
  assert.match(source, /\.voice-command-dock\s*\{[\s\S]*?flex-wrap: wrap/);
  assert.match(source, /class="voice-dock-button/);
  assert.match(source, /aria-label="Leave voice channel"/);
  assert.doesNotMatch(source, /items-center gap-2 overflow-x-auto/);
  assert.doesNotMatch(source, /voice-channel:hover \.voice-controls/);
});

test("global voice controls keep the connected channel name across room navigation", async () => {
  const navbar = await readFile("app/components/Navbar.vue", "utf8");
  const status = await readFile("app/components/GlobalVoiceStatus.vue", "utf8");
  const connectedChannelLookup =
    /getRoomChannelById\(\s*voiceStore\.currentRoomId,\s*voiceStore\.currentChannelId,\s*\)/;
  assert.match(navbar, connectedChannelLookup);
  assert.match(status, connectedChannelLookup);
});

test("shared audio status keeps readable colors independent of the page theme", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  const statusStyles = source.match(
    /\.shared-audio-status\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(statusStyles);
  assert.match(statusStyles, /background: #151619/);
  assert.match(statusStyles, /color: #f2f3f5/);
  assert.doesNotMatch(source, /shared-audio-status[^"]*bg-base-/);
});

test("shared audio ducking uses a reduced-volume status instead of a duplicate meter", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /shared-audio-ducking-arrow/);
  assert.match(source, /shared-audio-ducking-value/);
  assert.match(source, /min-width: 7\.5rem/);
  assert.match(source, /effective while voice is detected/);
  assert.doesNotMatch(source, /Ducking ready/);
  assert.doesNotMatch(source, /shared-audio-status-ducking/);
  assert.doesNotMatch(source, />Output</);
});

test("audio-only system shares expose automatic listening controls", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /is sharing system audio/);
  assert.match(source, /Stop listening/);
  assert.match(source, /setRemoteSystemAudioReceiving/);
});

test("screen prompts and accepted video use one stable stage frame", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  const feed = await readFile("app/components/VideoFeed.vue", "utf8");
  assert.match(source, /screen-feed-frame-single/);
  assert.match(source, /aspect-ratio: 16 \/ 9/);
  assert.match(source, /width: min\(100cqw, calc\(100cqh \* 16 \/ 9\)\)/);
  assert.match(source, /:compact=/);
  assert.match(source, /:avatar-src="tile\.feed\.avatar"/);
  assert.match(feed, /\(localScreenPreviewPaused \|\| !receiving\)/);
  assert.match(feed, />\s*LIVE\s*</);
  assert.match(feed, /blur-xl opacity-60/);
});

test("voice video offers equal overview tiles and viewer-selected focus", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(
    source,
    /tile\.type !== 'participant' && scheduleTileFocus\(tile\.key\)/,
  );
  assert.match(source, /@dblclick\.stop="cancelTileFocus"/);
  assert.match(source, /voice-room-grid-focused/);
  assert.match(source, /voice-room-tile-focused/);
  assert.match(source, /justify-content: center/);
  assert.match(source, /grid-template-rows: minmax\(0, 1fr\) 8rem/);
  assert.match(source, /grid-column: 1 \/ -1/);
  assert.match(source, /representedUsers/);
  assert.match(source, /focusedTileKey\.value === key/);
  assert.match(source, /viewMode\.value = "overview"/);
  assert.match(source, /participant-audio-tile-compact/);
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /}, 240\)/);
  assert.doesNotMatch(source, /aria-label="Voice channel view"/);
});

test("participant volume controls render outside the scrolling participant strip", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /<Teleport to="body">/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Adjust volume for/);
  assert.match(source, /@contextmenu\.prevent="openTileVolumeMenu\(tile\)"/);
  assert.match(source, /Adjust DJ and voice volume for/);
  assert.match(source, /tile\.type === "broadcast" \? tile\.broadcast/);
  assert.match(source, /DJ broadcast/);
  assert.match(source, /"broadcast-audio"/);
  assert.match(source, /voiceStore\.getUserById\(media\.userId\)/);
  assert.match(source, /media\.local/);
  assert.match(source, /max="2"/);
  assert.match(source, /<span>200%<\/span>/);
  assert.doesNotMatch(source, /absolute top-2 right-2 bg-base-200/);
});

test("odd overview tiles center the final participant in the grid", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /@container \(min-width: 36\.75rem\)/);
  assert.match(source, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /\.voice-room-tile:last-child:nth-child\(odd\)/);
  assert.match(source, /grid-column: 1 \/ -1/);
  assert.match(source, /width: calc\(50% - 0\.375rem\)/);
});

test("voice channel indicators show participant avatars and media status", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(source, /getUserAvatar\(u\.id \|\| u\)/);
  assert.match(source, /u\.speaking[\s\S]*font-medium text-base-content/);
  assert.match(source, /text-base-content\/70/);
  assert.match(source, /v-if="u\.soundboardActivity"/);
  assert.match(source, /Playing \{\{ u\.soundboardActivity\.title \}\}/);
  assert.match(source, /lucide:headphone-off/);
  assert.match(source, /lucide:mic-off/);
  assert.match(source, /lucide:video/);
  assert.match(source, /lucide:screen-share/);
  assert.match(source, /getChannelParticipants\(channel\)/);
  assert.match(source, /channel\.participantStates/);
});

test("room rail tooltips preview connected voice participants", async () => {
  const rail = await readFile("app/components/MetroRoomRail.vue", "utf8");
  const channels = await readFile("app/stores/channels.ts", "utf8");
  assert.match(rail, /tooltipVoiceChannels/);
  assert.match(rail, /channel\.participants/);
  assert.match(rail, /participant\.avatar/);
  assert.match(rail, /participant\.name/);
  assert.match(rail, /lucide:volume-2/);
  assert.match(rail, /\[\s*\(\) => roomsStore\.rooms,\s*activeRoomId\s*\]/);
  assert.match(rail, /roomIds\.push\(activeRoomId\.value\)/);
  assert.match(rail, /channelsStore\.syncVoicePresenceRooms/);
  assert.match(channels, /function getRoomChannels\(roomId\)/);
  assert.match(channels, /const voicePresenceConnections = new Map\(\)/);
  assert.match(channels, /const voicePresenceSnapshots = new Map\(\)/);
  assert.match(channels, /applyStoredVoicePresence\(normalizedRoomId\)/);
  assert.match(channels, /existing\?\.connecting/);
  assert.match(
    channels,
    /applyVoicePresence\(message\.data, normalizedRoomId\)/,
  );
  assert.match(channels, /openRealtimeChannel\(`room:\$\{normalizedRoomId\}`/);
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
  const api = await readFile("server/utils/dspeak-profile-api.ts", "utf8");
  const presence = await readFile("app/composables/usePresence.ts", "utf8");
  assert.match(source, /Public profile/);
  assert.match(source, /form\.set\("displayName"/);
  assert.match(source, /form\.set\("avatar"/);
  assert.match(api, /normalizeDisplayName/);
  assert.match(api, /Profile picture/);
  assert.match(api, /broadcastGlobally/);
  assert.match(presence, /profile_updated/);
  assert.match(presence, /upsertPublicProfile/);
});

test("settings volume sliders consistently use the active accent", async () => {
  const source = await readFile("app/pages/settings.vue", "utf8");
  assert.doesNotMatch(source, /range-secondary/);
  assert.doesNotMatch(source, /range range-primary/);
  assert.equal((source.match(/metro-range/g) || []).length, 3);
});

test("voice settings provide a local microphone listen-back check", async () => {
  const source = await readFile("app/pages/settings.vue", "utf8");
  assert.match(source, /Microphone setup/);
  assert.match(source, /Record mic check/);
  assert.match(source, /new MediaRecorder/);
  assert.match(source, /createMediaStreamDestination/);
  assert.match(source, /audioElement\.setSinkId/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test("room administration uses explicit responsive form layouts", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /class="form-control/);
  assert.match(source, /lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(source, /metro-input w-full min-w-0/);
  assert.match(source, /1920 × 192 px \(10:1\) recommended/);
  assert.match(source, /Keep important content\s+centered/);
});

test("room speech priority settings explain audio behavior without jargon", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.match(source, /Speech priority/);
  assert.match(source, /Shared audio during speech/);
  assert.match(source, /How should volume change\?/);
  assert.match(source, /How easily should speech trigger it\?/);
  assert.match(source, /Relaxed/);
  assert.match(source, /Responsive/);
  assert.match(source, /Fast/);
  assert.match(source, /Balanced/);
  assert.match(source, /Smooth/);
  assert.match(source, /attackMs: 900/);
  assert.match(source, /releaseMs: 2200/);
  assert.match(source, /Changes save automatically/);
  assert.match(source, /queueAttenuationSave/);
  assert.doesNotMatch(source, />Attack \(ms\)</);
  assert.doesNotMatch(source, />Release \(ms\)</);
  assert.doesNotMatch(source, /Save speech priority/);
});

test("room role assignments use explicit role controls instead of a native multi-select", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /<select[\s\S]*multiple/);
  assert.match(source, /toggleMembershipRole\(membership, role\.id\)/);
  assert.match(source, /membershipSystemRoles\(membership\)/);
  assert.match(source, /const memberById = new Map/);
  assert.match(source, /user: memberById\.get\(String\(membership\.userId\)\)/);
  assert.match(source, /function membershipRoleDetails\(membership/);
  assert.match(source, /Changes apply immediately/);
  assert.match(source, /if \(!nextSelection\.length\)/);
  assert.doesNotMatch(source, /Save roles/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /Edit room identity/);
  assert.doesNotMatch(source, /\{\{ permission \}\}/);
});

test("room accent changes persist and propagate immediately", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  const rooms = await readFile("app/stores/rooms.ts", "utf8");
  const presence = await readFile("app/composables/usePresence.ts", "utf8");
  const api = await readFile("server/utils/dspeak-rooms-api.ts", "utf8");
  assert.match(source, /@click="saveAccent\(accent\)"/);
  assert.match(rooms, /applyRealtimeRoomUpdate/);
  assert.match(presence, /message\?\.type === "room_updated"/);
  assert.match(api, /type: "room_updated"/);
  assert.match(api, /data\.attenuation = normalizeAttenuation/);
  assert.match(api, /A room member must have at least one role/);
  assert.match(api, /Assigned roles must belong to this room/);
});

test("member list exposes profile cards and persistent personal nickname controls", async () => {
  const source = await readFile("app/components/MemberList.vue", "utf8");
  const api = await readFile("server/utils/dspeak-api.ts", "utf8");
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

test("member list counts global presence separately from channel presence", async () => {
  const source = await readFile("app/components/MemberList.vue", "utf8");
  const countLogic = source.slice(
    source.indexOf("const onlineMembersCount"),
    source.indexOf(
      "function isOwner",
      source.indexOf("const onlineMembersCount"),
    ),
  );
  assert.match(countLogic, /props\.members\.filter\(isMemberOnline\)/);
  assert.match(
    source,
    /presenceStatusStore\.getUserStatus\(member\?\.id\)\.status/,
  );
  assert.match(source, /onlineUserIds\.value\.has\(String\(member\.id\)\)/);
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
    "app/composables/usePreparedRoomNavigation.ts",
    "utf8",
  );
  const mobileRooms = await readFile(
    "app/components/MobileRoomSidebar.vue",
    "utf8",
  );
  const channels = await readFile("app/stores/channels.ts", "utf8");
  const chat = (
    await Promise.all(
      [
        "store.ts",
        "cache.ts",
        "extras.ts",
        "messages.ts",
        "reads.ts",
        "transport.ts",
      ].map((file) => readFile(`app/stores/chat/${file}`, "utf8")),
    )
  ).join("\n");
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

test("presence selector uses a bounded Metro command surface", async () => {
  const selector = await readFile(
    "app/components/PresenceStatusSelector.vue",
    "utf8",
  );
  assert.match(selector, /aria-haspopup="dialog"/);
  assert.match(selector, /:aria-expanded="isOpen"/);
  assert.match(selector, /role="radiogroup"/);
  assert.match(selector, /role="radio"/);
  assert.match(selector, /:aria-checked=/);
  assert.match(selector, /profile\?\.username \|\| profile\?\.handle/);
  assert.doesNotMatch(selector, /statusDotClass|presenceStore\.label/);
  assert.match(selector, /min-h-11/);
  assert.match(selector, /calc\(100vw-2rem\)/);
  assert.match(selector, /event\.key === "Escape"/);
  assert.doesNotMatch(selector, /rounded-lg|shadow-xl|range-xs|text-\[10px\]/);
});

test("profile avatar status reflects the selected presence state", async () => {
  const navbar = await readFile("app/components/Navbar.vue", "utf8");
  const selector = await readFile(
    "app/components/PresenceStatusSelector.vue",
    "utf8",
  );
  assert.match(navbar, /usePresenceStatusStore/);
  assert.match(navbar, /presenceStore\.effectiveStatus === "idle"/);
  assert.match(navbar, /presenceStore\.effectiveStatus === "dnd"/);
  assert.match(selector, /\.avatar-idle::before/);
  assert.match(selector, /\.avatar-dnd::before/);
  assert.doesNotMatch(
    navbar,
    /presenceStatus\?\.value === "connected"\) return "avatar-online"/,
  );
});

test("image lightbox traps focus and restores its opener", async () => {
  const source = await readFile(
    new URL("../app/components/Chat/ImageLightbox.vue", import.meta.url),
    "utf8",
  );
  assert.match(source, /ref="dialogRef"/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /previouslyFocused\?\.focus\(\)/);
  assert.match(source, /closeButtonRef\.value\?\.focus\(\)/);
  assert.doesNotMatch(
    source,
    /btn-circle|rounded-(?:lg|xl|2xl|full)|shadow-(?:lg|xl|2xl)/,
  );
  assert.doesNotMatch(source, /<img[\s\S]*?@click=/);
});
