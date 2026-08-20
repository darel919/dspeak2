<template>
  <div class="voice-channel relative flex h-full flex-col bg-base-200">
    <DesktopCapturePicker
      v-if="capturePickerOpen"
      :open="capturePickerOpen"
      :audio-only="capturePickerAudioOnly"
      :busy="capturePickerStarting"
      :error-message="capturePickerError"
      @close="closeCapturePicker"
      @fallback="useBrowserCaptureFallback"
      @select="selectDesktopCapture"
    />
    <header
      class="voice-channel-header flex min-h-12 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black px-4 text-white"
    >
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center">
          <Icon name="lucide:volume-2" class="size-5 text-primary" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-sm font-semibold">{{ channel.name }}</h1>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2" aria-live="polite">
        <button
          v-if="voiceStore.protocolUpdateRequired"
          type="button"
          class="metro-btn metro-btn--warning btn-sm"
          @click="reloadForMediaUpdate"
        >
          <Icon name="lucide:refresh-cw" />
          <span class="hidden sm:inline">Refresh to update voice</span>
        </button>
        <span
          v-else-if="voiceStore.connecting"
          class="inline-flex items-center gap-2 text-sm text-warning"
          :title="voiceConnectionStatus.detail"
        >
          <span class="metro-spinner metro-spinner--xs"></span>
          <span>{{ voiceConnectionStatus.label }}</span>
        </span>
        <span
          v-else-if="voiceStore.connected"
          class="inline-flex items-center gap-2 text-sm text-success"
        >
          <span class="size-2 bg-success"></span>
          <span class="hidden sm:inline">Voice connected</span>
        </span>
      </div>
    </header>

    <div
      v-if="
        !voiceStore.connected ||
        voiceStore.currentChannelId !== props.channel.id
      "
      class="flex min-h-0 flex-1 items-center justify-center p-6"
    >
      <div
        class="max-w-md"
        :class="voiceStore.connecting ? 'text-left' : 'text-center'"
      >
        <Icon name="lucide:volume-2" class="mx-auto size-12 text-primary/70" />
        <h2 class="mt-4 text-lg font-semibold">{{ channel.name }}</h2>
        <p
          v-if="!voiceStore.connecting"
          class="mt-2 text-sm text-base-content/60"
        >
          {{
            voiceStore.connected
              ? "You are connected to another voice channel."
              : "Join this voice channel to start talking."
          }}
        </p>
        <div
          v-if="voiceStore.connecting"
          class="mt-5 rounded border border-warning/30 bg-base-100/60 p-4"
          role="status"
          aria-live="polite"
        >
          <div class="flex items-start gap-3">
            <Icon
              :name="voiceConnectionStatus.icon"
              class="mt-0.5 size-5 shrink-0 text-warning"
            />
            <div class="min-w-0">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p class="font-semibold">{{ voiceConnectionStatus.label }}</p>
              </div>
              <p class="mt-1 text-sm text-base-content/70">
                {{ voiceConnectionStatus.detail }}
              </p>
            </div>
          </div>
          <ol
            class="mt-4 grid gap-2 text-xs text-base-content/60 sm:grid-cols-5"
            aria-label="Voice connection progress"
          >
            <li
              v-for="(step, index) in voiceConnectionStatus.steps"
              :key="step.key"
              class="flex items-center gap-2 sm:block"
              :class="{
                'text-success': step.state === 'complete',
                'font-semibold text-warning': step.state === 'current',
              }"
              :aria-current="step.state === 'current' ? 'step' : undefined"
            >
              <span
                class="grid size-5 shrink-0 place-items-center rounded-full border border-current sm:mb-1"
                aria-hidden="true"
              >
                <Icon
                  v-if="step.state === 'complete'"
                  name="lucide:check"
                  class="size-3"
                />
                <span
                  v-else-if="step.state === 'current'"
                  class="size-1.5 animate-pulse rounded-full bg-current"
                ></span>
                <span v-else>{{ index + 1 }}</span>
              </span>
              <span>{{ step.label }}</span>
            </li>
          </ol>
        </div>
        <button
          v-if="!voiceStore.connected && !voiceStore.connecting"
          type="button"
          class="metro-btn metro-btn--primary mt-5"
          @click="joinThisChannel"
        >
          Join voice channel
        </button>
      </div>
    </div>

    <div
      v-if="remoteSystemAudioShares.length"
      class="grid shrink-0 gap-px border-b border-base-content/15 bg-base-content/15"
      aria-live="polite"
    >
      <div
        v-for="share in remoteSystemAudioShares"
        :key="share.key"
        class="flex items-center justify-between gap-4 bg-base-200 px-4 py-3"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Icon
            name="lucide:audio-lines"
            class="size-5 shrink-0 text-primary"
          />
          <p class="truncate text-sm font-medium">
            {{ share.label }} is sharing system audio
          </p>
        </div>
        <button
          class="metro-btn metro-btn--sm shrink-0"
          :class="
            share.receiving === false
              ? 'metro-btn--secondary'
              : 'metro-btn--ghost'
          "
          type="button"
          @click="setSystemAudioReceiving(share, share.receiving === false)"
        >
          <Icon
            :name="
              share.receiving === false ? 'lucide:volume-2' : 'lucide:volume-x'
            "
            class="size-4"
          />
          {{ share.receiving === false ? "Listen" : "Stop listening" }}
        </button>
      </div>
    </div>

    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId !== props.channel.id
      "
      class="metro-status m-4 border-info bg-info/10 text-info"
    >
      <div class="flex items-center gap-3">
        <Icon name="lucide:info" class="w-5 h-5 text-info" />
        <div class="flex-1">
          <p class="text-sm font-medium">
            You're connected to a different voice channel
          </p>
          <p class="text-xs text-base-content/60">
            {{ currentConnectedChannelName }}
          </p>
        </div>
        <div class="flex gap-2">
          <button
            @click="switchToThisChannel"
            class="metro-btn metro-btn--sm btn-info"
            :disabled="voiceStore.connecting"
          >
            Switch Here
          </button>
          <button
            @click="navigateToCurrentChannel"
            class="metro-btn metro-btn--sm btn-outline"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="voice-stage flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        v-if="roomTiles.length"
        class="screen-feed-area min-h-0 flex-1 overflow-hidden p-4 md:p-6"
      >
        <div
          ref="videoStage"
          class="voice-room-grid h-full min-h-0 w-full"
          :class="{ 'voice-room-grid-focused': viewMode === 'focused' }"
          :style="
            viewMode === 'overview'
              ? {
                  '--video-tile-width': `${adaptiveLayout.tileWidth}px`,
                  '--video-tile-height': `${adaptiveLayout.tileHeight}px`,
                  '--video-grid-gap': `${adaptiveLayout.gap}px`,
                }
              : undefined
          "
        >
          <div
            v-for="tile in displayedRoomTiles"
            :key="tile.key"
            class="voice-room-tile min-h-0 overflow-hidden"
            :class="{
              'voice-room-tile-focused':
                viewMode === 'focused' && tile.key === focusedTileKey,
              'participant-tile-speaking': tile.user?.speaking,
            }"
            :role="tile.type !== 'participant' ? 'button' : undefined"
            :tabindex="tile.type !== 'participant' ? 0 : undefined"
            :aria-label="
              tile.type === 'feed'
                ? `Maximize ${tile.feed.label} ${tile.feed.source}`
                : tile.type === 'broadcast'
                  ? `Maximize DJ broadcast from ${tile.broadcast.label}`
                  : undefined
            "
            @click="tile.type !== 'participant' && scheduleTileFocus(tile.key)"
            @dblclick.stop="cancelTileFocus"
            @keydown.enter.prevent="
              tile.type !== 'participant' && focusTile(tile.key)
            "
            @keydown.space.prevent="
              tile.type !== 'participant' && focusTile(tile.key)
            "
            @contextmenu.prevent="openTileVolumeMenu(tile)"
          >
            <VideoFeed
              v-if="tile.type === 'feed'"
              :feed-key="tile.feed.logicalStreamId || tile.feed.key"
              :stream="tile.feed.stream"
              :track="tile.feed.track || null"
              :receiver-incarnation-id="tile.feed.receiverIncarnationId || null"
              :native="tile.feed.native === true"
              :native-frame="tile.feed.frame || null"
              :can-pop-out="
                runtimeStore.isTauri &&
                tile.feed.native === true &&
                !tile.feed.local
              "
              :popped-out="isPoppedOut(tile.feed)"
              :source="tile.feed.source"
              :label="tile.feed.label"
              :muted="true"
              :local="tile.feed.local"
              :receiving="tile.feed.receiving !== false"
              :compact="viewMode === 'focused' && tile.key !== focusedTileKey"
              :avatar-src="tile.feed.avatar"
              :own-camera-stream="ownCameraFeed?.stream || null"
              :own-camera-feed-key="ownCameraFeed?.key || null"
              @start-receiving="setScreenReceiving(tile.feed, true)"
              @stop-receiving="setScreenReceiving(tile.feed, false)"
              @preview-change="setLocalPreview(tile.feed, $event)"
              @pop-out="openMediaPopout(tile.feed)"
              @focus-popup="focusMediaPopout(tile.feed)"
              @pop-in="closeMediaPopout(tile.feed)"
              @first-frame="onRemoteFirstFrame"
              @frame-presented="onRemoteFramePresented"
            />
            <div
              v-else-if="tile.type === 'broadcast'"
              class="relative flex h-full flex-col items-center justify-center overflow-hidden border border-primary/40 bg-black text-center text-white"
              :class="
                viewMode === 'focused' && tile.key !== focusedTileKey
                  ? 'min-h-0 p-3'
                  : 'min-h-[18rem] p-8'
              "
            >
              <div
                class="absolute inset-x-0 top-0 h-1 bg-primary"
                aria-hidden="true"
              ></div>
              <button
                class="metro-icon-btn metro-icon-btn--ghost btn-sm absolute right-2 top-2 z-10 text-white"
                type="button"
                :aria-label="`Adjust DJ and voice volume for ${tile.broadcast.label}`"
                @click.stop="
                  openVolumeMenu(volumeUserForTile(tile), $event.currentTarget)
                "
              >
                <Icon name="lucide:sliders-horizontal" class="size-4" />
              </button>
              <div
                class="grid place-items-center rounded-full bg-primary text-black shadow-[0_0_60px_rgba(244,114,182,0.28)]"
                :class="
                  viewMode === 'focused' && tile.key !== focusedTileKey
                    ? 'size-12'
                    : 'size-24'
                "
              >
                <Icon
                  name="lucide:disc-3"
                  class="animate-spin-slow"
                  :class="
                    viewMode === 'focused' && tile.key !== focusedTileKey
                      ? 'size-6'
                      : 'size-11'
                  "
                />
              </div>
              <p
                class="text-xs font-bold uppercase tracking-[0.24em] text-primary"
                :class="
                  viewMode === 'focused' && tile.key !== focusedTileKey
                    ? 'mt-2'
                    : 'mt-7'
                "
              >
                Live DJ broadcast
              </p>
              <h2
                class="mt-2 max-w-full truncate font-bold"
                :class="
                  viewMode === 'focused' && tile.key !== focusedTileKey
                    ? 'text-sm'
                    : 'text-2xl'
                "
              >
                {{ tile.broadcast.label }}
              </h2>
              <div
                v-if="viewMode !== 'focused' || tile.key === focusedTileKey"
                class="mt-5 flex items-center gap-2 text-sm text-white/60"
              >
                <span class="size-2 bg-success"></span>
                Application audio is live
              </div>
            </div>
            <div
              v-else
              class="participant-tile participant-audio-tile metro-transition group relative flex h-full min-w-0 flex-col items-center justify-center overflow-hidden border"
              :class="
                viewMode === 'focused'
                  ? 'participant-audio-tile-compact p-2'
                  : 'p-6'
              "
            >
              <button
                v-if="!isLocalUser(tile.user)"
                class="metro-icon-btn metro-icon-btn--ghost btn-sm absolute right-2 top-2 z-10 opacity-70 hover:opacity-100 focus-visible:opacity-100"
                type="button"
                :aria-label="`Adjust volume for ${getUserDisplayName(tile.user)}`"
                @click.stop="openVolumeMenu(tile.user, $event.currentTarget)"
              >
                <Icon name="lucide:volume-2" class="size-4" />
              </button>
              <div
                class="avatar"
                :class="viewMode === 'focused' ? 'mb-0' : 'mb-4'"
              >
                <ProfileAvatar
                  :src="userAvatarSource(tile.user)"
                  :name="getUserDisplayName(tile.user)"
                  class="metro-transition rounded-full bg-primary text-primary-content font-bold ring-2"
                  :class="[
                    viewMode === 'focused'
                      ? 'h-12 w-12 text-sm'
                      : 'h-24 w-24 text-2xl md:h-28 md:w-28',
                    tile.user.speaking
                      ? 'ring-success ring-offset-2 ring-offset-base-100'
                      : 'ring-base-300',
                  ]"
                />
              </div>
              <h4
                class="max-w-full truncate text-center font-semibold"
                :class="
                  viewMode === 'focused' ? 'mt-1 text-sm' : 'mt-4 text-lg'
                "
              >
                {{ getUserDisplayName(tile.user) }}
              </h4>
              <div class="flex items-center gap-2">
                <div
                  v-if="tile.user.muted"
                  class="flex items-center gap-1 text-error"
                >
                  <Icon
                    name="lucide:mic-off"
                    class="size-5"
                    aria-label="Microphone off"
                  />
                </div>
                <div
                  v-if="tile.user.deafened"
                  class="flex items-center gap-1 text-error"
                >
                  <Icon
                    name="lucide:volume-x"
                    class="size-5"
                    aria-label="Deafened"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-0 flex-1 items-center justify-center p-6 text-center"
      >
        <div class="max-w-md">
          <Icon
            name="lucide:users-round"
            class="mx-auto size-14 text-primary/80"
            aria-hidden="true"
          />
          <h2 class="mt-5 text-xl font-semibold">You’re the only one here</h2>
          <p class="mt-2 text-sm text-white/60">
            Invite someone to join {{ channel.name }} or wait for another
            participant.
          </p>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="volumeMenuUser"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        role="presentation"
        @pointerdown.self="closeVolumeMenu"
      >
        <section
          ref="volumeDialog"
          class="w-full max-w-md border border-base-content/20 bg-base-200 text-base-content shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="participant-volume-title"
          tabindex="-1"
        >
          <header
            class="flex items-center justify-between gap-4 border-b border-base-content/15 px-5 py-4"
          >
            <div class="min-w-0">
              <p
                class="text-xs font-semibold uppercase tracking-wider text-base-content/55"
              >
                Playback volume
              </p>
              <h4
                id="participant-volume-title"
                class="truncate text-lg font-bold"
              >
                {{ getUserDisplayName(volumeMenuUser) }}
              </h4>
            </div>
            <button
              class="metro-icon-btn metro-icon-btn--ghost btn-sm shrink-0"
              type="button"
              aria-label="Close volume settings"
              @click="closeVolumeMenu"
            >
              <Icon name="lucide:x" class="size-5" />
            </button>
          </header>

          <div class="space-y-6 p-5">
            <div>
              <div class="mb-3 flex items-center justify-between gap-3">
                <label
                  class="flex items-center gap-2 font-semibold"
                  for="participant-voice-volume"
                >
                  <Icon name="lucide:mic" class="size-4 text-primary" />
                  Voice
                </label>
                <output class="text-sm font-semibold tabular-nums">
                  {{ trackVolumePercent(volumeMenuUser.id, "audio") }}%
                </output>
              </div>
              <input
                id="participant-voice-volume"
                class="metro-range w-full"
                type="range"
                min="0"
                max="2"
                step="0.01"
                :value="voiceStore.getTrackVolume(volumeMenuUser.id, 'audio')"
                @input="onTrackVolumeChange(volumeMenuUser.id, 'audio', $event)"
              />
              <div
                class="mt-2 flex justify-between text-xs text-base-content/55"
              >
                <span>Muted</span>
                <span>200%</span>
              </div>
            </div>

            <div v-if="hasAudioSource(volumeMenuUser.id, 'screen-audio')">
              <div class="mb-3 flex items-center justify-between gap-3">
                <label
                  class="flex items-center gap-2 font-semibold"
                  for="participant-screen-volume"
                >
                  <Icon
                    name="lucide:monitor-up"
                    class="size-4 text-secondary"
                  />
                  Screen share
                </label>
                <output class="text-sm font-semibold tabular-nums">
                  {{ trackVolumePercent(volumeMenuUser.id, "screen-audio") }}%
                </output>
              </div>
              <input
                id="participant-screen-volume"
                class="metro-range w-full"
                type="range"
                min="0"
                max="2"
                step="0.01"
                :value="
                  voiceStore.getTrackVolume(volumeMenuUser.id, 'screen-audio')
                "
                @input="
                  onTrackVolumeChange(volumeMenuUser.id, 'screen-audio', $event)
                "
              />
              <div
                class="mt-2 flex justify-between text-xs text-base-content/55"
              >
                <span>Muted</span>
                <span>200%</span>
              </div>
            </div>

            <div v-if="hasAudioSource(volumeMenuUser.id, 'broadcast-audio')">
              <div class="mb-3 flex items-center justify-between gap-3">
                <label
                  class="flex items-center gap-2 font-semibold"
                  for="participant-broadcast-volume"
                >
                  <Icon name="lucide:disc-3" class="size-4 text-primary" />
                  DJ broadcast
                </label>
                <output class="text-sm font-semibold tabular-nums">
                  {{
                    trackVolumePercent(volumeMenuUser.id, "broadcast-audio")
                  }}%
                </output>
              </div>
              <input
                id="participant-broadcast-volume"
                class="metro-range w-full"
                type="range"
                min="0"
                max="2"
                step="0.01"
                :value="
                  voiceStore.getTrackVolume(
                    volumeMenuUser.id,
                    'broadcast-audio',
                  )
                "
                @input="
                  onTrackVolumeChange(
                    volumeMenuUser.id,
                    'broadcast-audio',
                    $event,
                  )
                "
              />
              <div
                class="mt-2 flex justify-between text-xs text-base-content/55"
              >
                <span>Muted</span>
                <span>200%</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Teleport>

    <footer
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="voice-command-bar shrink-0 border-t border-white/10 bg-black px-3 py-3 text-white"
    >
      <div class="voice-command-dock mx-auto">
        <div class="voice-command-group">
          <MediaSettingsContextMenu kind="microphone">
            <button
              @click="voiceStore.toggleMic"
              :disabled="
                !voiceStore.connected ||
                (voiceStore.sfuComposable &&
                  !voiceStore.sfuComposable.transportReady)
              "
              :class="[
                'voice-dock-button metro-transition',
                voiceStore.micMuted ? 'voice-dock-button-danger' : '',
              ]"
              :aria-label="getButtonTitle()"
              :data-label="voiceStore.micMuted ? 'Unmute' : 'Mute'"
            >
              <Icon
                :name="voiceStore.micMuted ? 'lucide:mic-off' : 'lucide:mic'"
                class="size-5"
              />
            </button>
          </MediaSettingsContextMenu>

          <button
            @click="voiceStore.toggleDeafen"
            :class="[
              'voice-dock-button metro-transition',
              voiceStore.deafened ? 'voice-dock-button-danger' : '',
            ]"
            :aria-label="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
            :data-label="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
          >
            <Icon
              :name="
                voiceStore.deafened ? 'lucide:volume-x' : 'lucide:headphones'
              "
              class="size-5"
            />
          </button>

          <MediaSettingsContextMenu kind="camera">
            <button
              class="voice-dock-button metro-transition"
              :class="
                voiceStore.cameraEnabled ? 'voice-dock-button-active' : ''
              "
              :aria-label="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              :data-label="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              @click="toggleCamera"
            >
              <Icon name="lucide:camera" class="size-5" />
            </button>
          </MediaSettingsContextMenu>

          <button
            class="voice-dock-button metro-transition"
            :class="voiceStore.screenSharing ? 'voice-dock-button-active' : ''"
            :aria-label="
              voiceStore.screenSharing
                ? 'Stop sharing screen'
                : 'Share your screen'
            "
            :data-label="
              voiceStore.screenSharing ? 'Stop sharing' : 'Share screen'
            "
            @click="requestScreenShare"
          >
            <Icon name="lucide:monitor-up" class="size-5" />
          </button>

          <button
            class="voice-dock-button metro-transition"
            :class="
              voiceStore.systemAudioSharing ? 'voice-dock-button-active' : ''
            "
            :aria-label="
              voiceStore.systemAudioSharing
                ? 'Stop sharing system audio'
                : 'Share system audio only'
            "
            :data-label="
              voiceStore.systemAudioSharing
                ? 'Stop system audio'
                : 'System audio'
            "
            @click="requestSystemAudioShare"
          >
            <Icon name="lucide:volume-2" class="size-5" />
          </button>

          <SoundboardPanel
            :room-id="String(channel.room)"
            :channel-id="String(channel.id)"
            compact
          />
        </div>

        <button
          type="button"
          class="voice-dock-button voice-dock-button-leave metro-transition"
          aria-label="Leave voice channel"
          data-label="Leave"
          @click="leaveChannel"
        >
          <Icon name="lucide:phone-off" class="size-5" />
        </button>
      </div>
      <div
        v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
        class="shared-audio-status mx-auto mt-3 max-w-3xl"
      >
        <div class="shared-audio-heading">
          <span class="shared-audio-icon">
            <Icon
              :name="
                voiceStore.systemAudioSharing
                  ? 'lucide:volume-2'
                  : 'lucide:monitor-up'
              "
              class="size-4"
            />
          </span>
          <div>
            <p class="text-sm font-semibold">
              {{
                voiceStore.systemAudioSharing
                  ? "System audio is live"
                  : "Screen audio is live"
              }}
            </p>
            <p class="text-xs text-white/60">
              Control what everyone else hears
            </p>
          </div>
        </div>

        <div class="shared-audio-control">
          <label for="shared-audio-volume" class="shared-audio-label">
            <span>Shared volume</span>
            <span class="shared-audio-volume-status">
              <output class="tabular-nums" aria-live="polite">
                <span>{{ voiceStore.sharedAudioVolume }}%</span>
                <template v-if="voiceStore.sharedAudioDucking.active">
                  <span class="shared-audio-ducking-arrow" aria-hidden="true"
                    >→</span
                  >
                  <span class="shared-audio-ducking-value">
                    {{
                      Math.round(
                        (voiceStore.sharedAudioVolume *
                          voiceStore.sharedAudioDucking.effectivePercent) /
                          100,
                      )
                    }}%
                  </span>
                  <span class="sr-only">effective while voice is detected</span>
                </template>
              </output>
            </span>
          </label>
          <input
            id="shared-audio-volume"
            class="metro-range w-full"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="voiceStore.sharedAudioVolume"
            :style="{
              '--metro-range-progress': `${voiceStore.sharedAudioVolume}%`,
            }"
            @input="voiceStore.setSharedAudioVolume($event.target.value)"
          />
        </div>

        <div
          class="shared-audio-meter"
          :title="`${voiceStore.sharedAudioStats.dbfs.toFixed(1)} dBFS`"
        >
          <div class="shared-audio-label">
            <span>Signal sent</span>
            <span class="tabular-nums"
              >{{ voiceStore.sharedAudioStats.kbps.toFixed(1) }} kbps</span
            >
          </div>
          <progress
            :class="[
              'progress h-2 w-full',
              voiceStore.sharedAudioStats.dbfs >= -12
                ? 'progress-error'
                : 'progress-success',
            ]"
            max="1"
            :value="voiceStore.sharedAudioStats.level"
          ></progress>
          <span class="shared-audio-detail tabular-nums">
            {{ voiceStore.sharedAudioStats.dbfs.toFixed(1) }} dBFS
          </span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";
import { useVoiceStore } from "~/stores/voice";
import { useAuthStore } from "~/stores/auth";
import { useSettingsStore } from "~/stores/settings";
import { useIdentityStore } from "~/stores/identity";
import { useChannelsStore } from "~/stores/channels";
import { useRuntimeStore } from "~/stores/runtime";
import { getDesktopCaptureApi } from "../shared/desktop-capture";
import { useVoiceConnectionStatus } from "../composables/useVoiceConnectionStatus";
import { useDesktopMediaPopouts } from "../composables/useDesktopMediaPopouts";
import { useAdaptiveVideoGrid } from "../composables/useAdaptiveVideoGrid";

const DesktopCapturePicker = defineAsyncComponent(
  () => import("./DesktopCapturePicker.vue"),
);
const VideoFeed = defineAsyncComponent(() => import("./VideoFeed.vue"));

const props = defineProps({
  channel: {
    type: Object,
    required: true,
  },
});

const voiceStore = useVoiceStore();
const {
  sfuComposable: mediaSessionRef,
  localVideoFeeds: localVideoFeedsRef,
  remoteVideoFeeds: remoteVideoFeedsRef,
  remoteAudioFeeds: remoteAudioFeedsRef,
} = storeToRefs(voiceStore);
const authStore = useAuthStore();
const identityStore = useIdentityStore();
const channelsStore = useChannelsStore();
const runtimeStore = useRuntimeStore();
const { openPopout, closePopout, focusPopout, isPoppedOut, syncPopoutFeeds } =
  useDesktopMediaPopouts();
const router = useRouter();
const config = useRuntimeConfig();
const viewMode = ref("overview");
const videoStage = ref(null);
const { layout: adaptiveLayout } = useAdaptiveVideoGrid(
  videoStage,
  computed(() => displayedRoomTiles.value.length),
);
const { status: voiceConnectionStatus } = useVoiceConnectionStatus(voiceStore);
function reloadForMediaUpdate() {
  window.location.reload();
}
const focusedTileKey = ref(null);
let tileFocusTimer = null;

const connectedUsers = computed(() => {
  return voiceStore.getDisplayUsersArray();
});
const mediaFeedRevision = ref(0);
watch(
  () => mediaSessionRef.value,
  (session, _, onCleanup) => {
    mediaFeedRevision.value += 1;
    const unsubscribe = session?.on?.("state", () => {
      mediaFeedRevision.value += 1;
    });
    onCleanup(() => unsubscribe?.());
  },
  { immediate: true },
);
const videoFeeds = computed(() => {
  mediaFeedRevision.value;
  const currentUser = authStore.getUserData?.();
  const currentUserId = currentUser?.id;
  const sessionLocalFeeds = unref(mediaSessionRef.value?.localVideoFeeds);
  const localFeeds = sessionLocalFeeds || localVideoFeedsRef.value;
  const sessionRemoteFeeds = unref(mediaSessionRef.value?.remoteVideoFeeds);
  const remoteFeeds = sessionRemoteFeeds || remoteVideoFeedsRef.value;
  const local = Array.from(localFeeds).map(([source, feed]) => ({
    ...feed,
    source,
    key: `local-${source}`,
    userId: currentUserId ? String(currentUserId) : "local",
    local: true,
    label: "You",
    avatar: userAvatarSource(currentUser || { id: currentUserId }),
  }));
  const remote = Array.from(remoteFeeds).map(([producerId, feed]) => {
    const user = voiceStore.getUserById(feed.userId) || { id: feed.userId };
    return {
      ...feed,
      source: feed.source,
      key: producerId,
      local: false,
      label: getUserDisplayName(user),
      avatar: userAvatarSource(user),
    };
  });
  return [...local, ...remote].sort(
    (a, b) => Number(b.source === "screen") - Number(a.source === "screen"),
  );
});
const broadcastFeeds = computed(() =>
  Array.from(voiceStore.remoteAudioFeeds)
    .filter(([, feed]) => feed.source === "broadcast-audio")
    .map(([key, feed]) => ({
      ...feed,
      key,
      label: getUserDisplayName(
        voiceStore.getUserById(feed.userId) || { id: feed.userId },
      ),
    })),
);
const roomTiles = computed(() => {
  const representedUsers = new Set(
    videoFeeds.value.map((feed) => String(feed.userId)),
  );
  const feeds = videoFeeds.value.map((feed) => ({
    key: `feed-${feed.logicalStreamId || feed.key}`,
    type: "feed",
    feed,
  }));
  const broadcasts = broadcastFeeds.value.map((broadcast) => ({
    key: `broadcast-${broadcast.key}`,
    type: "broadcast",
    broadcast,
  }));
  const participants = connectedUsers.value
    .filter((user) => !representedUsers.has(String(user.id)))
    .map((user) => ({
      key: `participant-${user.id}`,
      type: "participant",
      user,
    }));
  return [...broadcasts, ...feeds, ...participants];
});
const displayedRoomTiles = computed(() => {
  if (viewMode.value !== "focused") return roomTiles.value;
  return [...roomTiles.value].sort(
    (a, b) =>
      Number(b.key === focusedTileKey.value) -
      Number(a.key === focusedTileKey.value),
  );
});
const ownCameraFeed = computed(
  () =>
    videoFeeds.value.find((feed) => feed.local && feed.source === "camera") ||
    null,
);

watch(mediaFeedRevision, () => syncPopoutFeeds(videoFeeds.value), {
  immediate: true,
});

const settingsStore = useSettingsStore();

const isChannelModerator = computed(() => {
  const channel = props.channel;
  const userData = authStore.getUserData?.();
  if (!userData?.id || !channel) return false;
  const ownerId = channel.owner?.id || channel.owner;
  if (String(ownerId) === String(userData.id)) return true;
  const room = channelsStore.getRoomChannels(channel.room);
  const membership = room
    ?.find((c) => c.id === channel.id)
    ?.expand?.memberships?.find((m) => String(m.user) === String(userData.id));
  return (
    membership?.expand?.roles?.some((r) =>
      r.permissions?.includes("channel.moderate_voice"),
    ) || false
  );
});

function volumeUserForTile(tile) {
  if (tile.type === "participant") return tile.user;
  const media = tile.type === "broadcast" ? tile.broadcast : tile.feed;
  if (!media || media.local) return null;
  return voiceStore.getUserById(media.userId) || { id: media.userId };
}

function openTileVolumeMenu(tile) {
  const user = volumeUserForTile(tile);
  if (user) openVolumeMenu(user);
}

function focusTile(key) {
  if (viewMode.value === "focused" && focusedTileKey.value === key) {
    viewMode.value = "overview";
    return;
  }
  focusedTileKey.value = key;
  viewMode.value = "focused";
}

function cancelTileFocus() {
  if (tileFocusTimer) clearTimeout(tileFocusTimer);
  tileFocusTimer = null;
}

function scheduleTileFocus(key) {
  cancelTileFocus();
  tileFocusTimer = setTimeout(() => {
    tileFocusTimer = null;
    focusTile(key);
  }, 240);
}

watch(roomTiles, (tiles) => {
  if (
    focusedTileKey.value &&
    !tiles.some((tile) => tile.key === focusedTileKey.value)
  ) {
    focusedTileKey.value =
      tiles.find((tile) => tile.type === "feed")?.key || null;
    if (!focusedTileKey.value) viewMode.value = "overview";
  }
});
watch(
  broadcastFeeds,
  (feeds, previous) => {
    const previousKeys = new Set((previous || []).map((feed) => feed.key));
    const started = feeds.find((feed) => !previousKeys.has(feed.key));
    if (!started) return;
    focusedTileKey.value = `broadcast-${started.key}`;
    viewMode.value = "focused";
  },
  { flush: "post" },
);
const remoteSystemAudioShares = computed(() => {
  return Array.from(remoteAudioFeedsRef.value)
    .filter(
      ([, feed]) =>
        feed.source === "screen-audio" && feed.ownerSource === "system-audio",
    )
    .map(([key, feed]) => ({
      ...feed,
      key,
      label: getUserDisplayName(
        voiceStore.getUserById(feed.userId) || { id: feed.userId },
      ),
    }));
});

function setScreenReceiving(feed, receiving) {
  if (feed.local || feed.source !== "screen") return;
  voiceStore.setRemoteScreenReceiving(feed.key, receiving);
}

function onRemoteFirstFrame(event) {
  const feedKey = typeof event === "string" ? event : event?.feedKey;
  const receiverIncarnationId =
    typeof event === "string" ? null : event?.receiverIncarnationId || null;
  const observationMode =
    typeof event === "object" ? event?.observationMode : undefined;
  if (!feedKey) return;
  mediaSessionRef.value?.markRemoteFirstFrame?.(
    feedKey,
    receiverIncarnationId,
    typeof event === "object" && event?.fallback === true,
    observationMode,
  );
}

function onRemoteFramePresented(event) {
  const feedKey = typeof event === "string" ? event : event?.feedKey;
  const receiverIncarnationId =
    typeof event === "string" ? null : event?.receiverIncarnationId || null;
  const observationMode =
    typeof event === "object" ? event?.observationMode : undefined;
  if (!feedKey) return;
  mediaSessionRef.value?.markRemoteFramePresented?.(
    feedKey,
    receiverIncarnationId,
    observationMode,
  );
}

function setLocalPreview(feed, enabled) {
  if (!feed?.local || feed.native !== true || feed.source !== "screen") return;
  Promise.resolve(
    mediaSessionRef.value?.setLocalVideoPreview?.(feed.source, enabled),
  ).catch(() => {});
}

function openMediaPopout(feed) {
  openPopout(feed).catch((error) => {
    console.error("[VoiceChannel] Media popup error:", error);
  });
}

function focusMediaPopout(feed) {
  focusPopout(feed).catch((error) => {
    console.error("[VoiceChannel] Media popup focus error:", error);
  });
}

function closeMediaPopout(feed) {
  closePopout(feed).catch((error) => {
    console.error("[VoiceChannel] Media popup close error:", error);
  });
}

function setSystemAudioReceiving(feed, receiving) {
  voiceStore.setRemoteSystemAudioReceiving(feed.key, receiving);
}

async function toggleCamera() {
  try {
    await voiceStore.toggleCamera();
  } catch (err) {
    console.error("[VoiceChannel] Camera error:", err);
  }
}

async function toggleScreenShare() {
  try {
    await voiceStore.toggleScreenShare();
  } catch (err) {
    console.error("[VoiceChannel] Screen share error:", err);
  }
}

const capturePickerOpen = ref(false);
const capturePickerAudioOnly = ref(false);
const capturePickerStarting = ref(false);
const capturePickerError = ref("");

async function requestScreenShare() {
  if (voiceStore.screenSharing) {
    await toggleScreenShare();
    return;
  }
  const api = await getDesktopCaptureApi();
  if (runtimeStore.isTauri || api) {
    capturePickerAudioOnly.value = false;
    capturePickerError.value = "";
    capturePickerOpen.value = true;
    return;
  }
  await toggleScreenShare();
}

async function requestSystemAudioShare() {
  if (voiceStore.systemAudioSharing) {
    await toggleSystemAudioShare();
    return;
  }
  const api = await getDesktopCaptureApi();
  if (runtimeStore.isTauri || api) {
    capturePickerAudioOnly.value = true;
    capturePickerError.value = "";
    capturePickerOpen.value = true;
    return;
  }
  await toggleSystemAudioShare();
}

function closeCapturePicker() {
  capturePickerOpen.value = false;
  capturePickerError.value = "";
}

async function selectDesktopCapture(selection) {
  capturePickerStarting.value = true;
  capturePickerError.value = "";
  try {
    if (capturePickerAudioOnly.value) {
      await voiceStore.toggleSystemAudioShare(selection);
    } else {
      await voiceStore.toggleScreenShare(selection);
    }
    capturePickerOpen.value = false;
  } catch (error) {
    capturePickerError.value =
      error?.message || "Native desktop sharing could not be started.";
    console.error("[VoiceChannel] Desktop capture selection error:", error);
  } finally {
    capturePickerStarting.value = false;
  }
}

async function useBrowserCaptureFallback() {
  capturePickerStarting.value = true;
  capturePickerError.value = "";
  try {
    if (capturePickerAudioOnly.value) {
      await voiceStore.toggleSystemAudioShare(null, {
        explicitBrowserFallback: true,
      });
    } else {
      await voiceStore.toggleScreenShare(null, {
        explicitBrowserFallback: true,
      });
    }
    capturePickerOpen.value = false;
  } catch (error) {
    capturePickerError.value =
      error?.message || "Browser capture could not be started.";
    console.error("[VoiceChannel] Browser capture fallback error:", error);
  } finally {
    capturePickerStarting.value = false;
  }
}

async function toggleSystemAudioShare() {
  try {
    await voiceStore.toggleSystemAudioShare();
  } catch (err) {
    console.error("[VoiceChannel] System audio share error:", err);
  }
}
const volumeMenuUser = ref(null);
const volumeDialog = ref(null);
let volumeMenuTrigger = null;

async function openVolumeMenu(user, trigger = null) {
  if (isLocalUser(user)) return;
  volumeMenuTrigger = trigger instanceof HTMLElement ? trigger : null;
  volumeMenuUser.value = user;
  await nextTick();
  volumeDialog.value?.focus();
}
function closeVolumeMenu() {
  volumeMenuUser.value = null;
  nextTick(() => volumeMenuTrigger?.focus());
}
function onTrackVolumeChange(userId, source, event) {
  voiceStore.setTrackVolume(userId, source, Number(event.target.value));
}

function hasAudioSource(userId, source) {
  return Array.from(voiceStore.remoteAudioFeeds).some(
    ([, feed]) =>
      String(feed.userId) === String(userId) && feed.source === source,
  );
}

function trackVolumePercent(userId, source) {
  return Math.round(voiceStore.getTrackVolume(userId, source) * 100);
}

function onVolumeDialogKeydown(event) {
  if (event.key === "Escape" && volumeMenuUser.value) closeVolumeMenu();
}

const currentConnectedChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return "";
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId);
  return channel?.name || "Unknown Channel";
});

function getUserDisplayName(user) {
  const profile =
    voiceStore.getUserProfile && user?.id
      ? voiceStore.getUserProfile(user.id)
      : null;
  const merged = { ...profile, ...user };

  try {
    const me = useAuthStore().getUserData && useAuthStore().getUserData();
    if (me && me.id && String(me.id) === String(merged.id)) return "You";
  } catch (_) {}
  return identityStore.displayName(merged);
}

function userAvatarSource(user) {
  const currentUser = authStore.getUserData?.();
  if (
    currentUser?.id &&
    user?.id &&
    String(currentUser.id) === String(user.id)
  ) {
    return currentUser.avatar || "";
  }
  const profile =
    voiceStore.getUserProfile && user?.id
      ? voiceStore.getUserProfile(user.id)
      : null;
  const merged = { ...profile, ...user };
  return merged.avatar || "";
}

function getButtonTitle() {
  if (!voiceStore.connected) return "Not connected";
  if (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady)
    return "Setting up connection...";
  return voiceStore.micMuted ? "Unmute Microphone" : "Mute Microphone";
}

function isLocalUser(user) {
  try {
    const me = authStore.getUserData && authStore.getUserData();
    return me && me.id && user && String(user.id) === String(me.id);
  } catch (_) {
    return false;
  }
}

async function joinThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id);
  } catch (error) {
    console.error("Failed to join voice channel:", error);
  }
}

async function switchToThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id);
  } catch (error) {
    console.error("Failed to switch voice channel:", error);
  }
}

function navigateToCurrentChannel() {
  if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
    router.push(
      `/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`,
    );
  }
}

async function leaveChannel() {
  try {
    await voiceStore.leaveVoiceChannel();
  } catch (error) {
    console.error("Failed to leave voice channel:", error);
  }
}

onMounted(() => document.addEventListener("keydown", onVolumeDialogKeydown));
onUnmounted(() => {
  cancelTileFocus();
  document.removeEventListener("keydown", onVolumeDialogKeydown);
});
</script>

<style scoped>
.voice-channel {
  isolation: isolate;
}

.voice-stage {
  background: #050505;
}

.screen-feed-area {
  container-type: size;
}

.voice-room-grid:not(.voice-room-grid-focused) {
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  gap: var(--video-grid-gap);
}

.voice-room-grid:not(.voice-room-grid-focused) .voice-room-tile {
  flex: 0 0 auto;
  width: var(--video-tile-width);
  height: var(--video-tile-height);
  min-width: 0;
  min-height: 0;
}

.voice-room-grid.voice-room-grid-focused {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 14rem));
  grid-template-rows: minmax(0, 1fr) 8rem;
  justify-content: center;
  gap: 0.75rem;
}

.voice-room-tile {
  min-width: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  background: #000;
  cursor: default;
}

.voice-room-tile[role="button"] {
  cursor: pointer;
}

.voice-room-tile[role="button"]:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.voice-room-tile-focused {
  grid-column: 1 / -1;
  width: 100%;
  height: 100%;
}

.voice-room-grid-focused .voice-room-tile:not(.voice-room-tile-focused) {
  width: 100%;
  height: 8rem;
}

.participant-audio-tile-compact {
  min-height: 0;
}

.participant-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
}

.participant-tile {
  box-shadow: inset 0 -4px 0 transparent;
}

.voice-stage .participant-tile:not(.participant-audio-tile) {
  background: #18191c;
  color: #f2f3f5;
}

.participant-tile-speaking {
  border-color: var(--color-success);
  box-shadow: inset 0 -4px 0 var(--color-success);
}

.participant-audio-tile {
  border-color: rgb(255 255 255 / 12%);
  background: #cdb597;
  color: #171717;
}

.voice-command-dock {
  display: flex;
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.voice-command-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.voice-dock-button,
:deep(.voice-dock-button) {
  position: relative;
  display: inline-flex;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  background: #1e1f22;
  color: #f2f3f5;
}

.voice-dock-button:hover,
:deep(.voice-dock-button:hover) {
  background: #35373c;
}

.voice-dock-button::after,
:deep(.voice-dock-button::after) {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  z-index: 50;
  max-width: 12rem;
  padding: 0.375rem 0.5rem;
  background: var(--color-neutral);
  color: var(--color-neutral-content);
  content: attr(data-label);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1rem;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 0.25rem);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  white-space: nowrap;
}

.voice-dock-button:hover::after,
.voice-dock-button:focus-visible::after,
:deep(.voice-dock-button:hover::after),
:deep(.voice-dock-button:focus-visible::after) {
  opacity: 1;
  transform: translate(-50%, 0);
}

.voice-dock-button-active {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.voice-dock-button-danger,
.voice-dock-button-leave {
  background: var(--color-error);
  color: var(--color-error-content);
}

.voice-dock-button-leave {
  margin-left: 0.5rem;
}

.shared-audio-status {
  display: grid;
  grid-template-columns: minmax(11rem, 1fr) minmax(12rem, 1.5fr) 1fr;
  align-items: center;
  gap: 1rem;
  border: 1px solid rgb(255 255 255 / 14%);
  background: #151619;
  padding: 1rem;
  color: #f2f3f5;
}

.shared-audio-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
}

.shared-audio-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  place-items: center;
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.shared-audio-control,
.shared-audio-meter {
  min-width: 0;
}

.shared-audio-volume-status {
  display: flex;
  min-width: 7.5rem;
  align-items: center;
  justify-content: flex-end;
}

.shared-audio-ducking-arrow {
  margin: 0 0.375rem;
  color: rgb(242 243 245 / 48%);
}

.shared-audio-ducking-value {
  color: var(--color-warning);
  font-weight: 700;
}

.shared-audio-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  color: #f2f3f5;
  font-size: 0.75rem;
  font-weight: 600;
}

.shared-audio-detail {
  display: block;
  margin-top: 0.375rem;
  overflow: hidden;
  color: rgb(242 243 245 / 60%);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 64rem) {
  .shared-audio-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 30rem) {
  .voice-dock-button-leave {
    margin-left: 0;
  }

  .shared-audio-status {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
