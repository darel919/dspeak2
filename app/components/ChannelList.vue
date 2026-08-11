<template>
  <div class="flex flex-col h-full bg-base-200">
    <!-- Channel list header -->
    <div class="border-base-300 p-4">
      <div class="relative flex w-full flex-col items-center gap-3">
        <div
          class="grid size-20 place-items-center overflow-hidden bg-base-300"
        >
          <img
            v-if="room?.picture"
            :src="roomAssetUrl(room.picture)"
            alt=""
            class="size-full object-cover"
          />
          <span v-else class="text-2xl font-semibold text-base-content/70">{{
            room?.name?.slice(0, 2).toUpperCase() || "#"
          }}</span>
        </div>
        <h3 class="max-w-full truncate text-center text-lg font-semibold">
          {{ room?.name || "Channels" }}
        </h3>
        <div class="dropdown dropdown-end absolute top-0 right-0">
          <button
            ref="roomActionsButton"
            tabindex="0"
            class="metro-icon-btn metro-icon-btn--ghost"
            aria-label="Room actions"
          >
            <Icon name="lucide:ellipsis-vertical" class="h-5 w-5" />
          </button>
          <ul
            class="metro-pane metro-menu absolute right-0 top-full z-[1] mt-1 w-52 border border-base-300 bg-base-100 p-2 text-base-content shadow-lg"
          >
            <li v-if="hasPermission('channel.create')">
              <button type="button" @click="openCreateModal">
                Create channel
              </button>
            </li>
            <li>
              <button
                type="button"
                @click="goToRoomSettings"
                class="cursor-pointer hover:bg-base-200"
              >
                Room settings
              </button>
            </li>
            <li>
              <button
                type="button"
                @click="inviteDialog?.open(room)"
                class="cursor-pointer hover:bg-base-200"
              >
                Invite
              </button>
            </li>
            <li v-if="isRoomOwnerOrAdmin">
              <button
                type="button"
                @click="handleDeleteRoom"
                class="text-error cursor-pointer hover:bg-error/20"
              >
                Delete room
              </button>
            </li>
            <li v-else>
              <button
                type="button"
                @click="handleLeaveRoom"
                class="text-warning cursor-pointer hover:bg-warning/20"
              >
                Leave room
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <RoomInviteDialog ref="inviteDialog" />

    <!-- Channel categories -->
    <div class="flex-1 overflow-y-auto p-2 space-y-4">
      <!-- Text Channels -->
      <div>
        <div
          class="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-base-content/60 uppercase"
        >
          <Icon name="lucide:message-square" class="h-3 w-3" />
          Text channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in textChannels"
            :key="channel.id"
            @contextmenu.prevent.stop="openChannelMenu(channel, $event)"
            class="metro-transition group flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-base-300"
            :class="{
              'bg-primary text-primary-content':
                selectedChannelId === channel.id,
            }"
          >
            <button
              type="button"
              class="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left"
              :aria-current="
                selectedChannelId === channel.id ? 'page' : undefined
              "
              @click="selectChannel(channel)"
            >
              <span class="text-sm">#</span>
              <span class="flex-1 truncate text-sm">{{ channel.name }}</span>
              <span
                v-if="getUnreadCount(channel.id)"
                class="metro-badge metro-badge--accent"
              >
                {{ getUnreadCount(channel.id) }}
              </span>
            </button>
            <!-- Channel actions dropdown -->
            <div class="dropdown dropdown-end" @click.stop>
              <button
                tabindex="0"
                class="metro-icon-btn metro-icon-btn--ghost h-8 w-8"
                :aria-label="`Actions for ${channel.name}`"
              >
                <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
              </button>
              <ul
                class="metro-pane metro-menu absolute right-0 top-full z-[1] mt-1 w-44 border border-base-300 bg-base-100 p-2 text-base-content shadow-lg"
              >
                <li v-if="canEditChannel(channel)">
                  <button type="button" @click="editChannel(channel)">
                    Edit channel
                  </button>
                </li>
                <li v-if="canDeleteChannel(channel)">
                  <button
                    type="button"
                    class="text-error"
                    @click="deleteChannel(channel)"
                  >
                    Delete channel
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Voice Channels -->
      <div v-if="voiceChannels.length > 0">
        <div
          class="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-base-content/60 uppercase"
        >
          <Icon name="lucide:mic" class="h-3 w-3" />
          Voice channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in voiceChannels"
            :key="channel.id"
            class="metro-transition group"
            @contextmenu.prevent.stop="openChannelMenu(channel, $event)"
            :class="[
              selectedChannelId === channel.id &&
              !(
                voiceStore.currentChannelId === channel.id &&
                voiceStore.connected
              )
                ? 'bg-primary text-primary-content'
                : '',
              voiceStore.currentChannelId === channel.id && voiceStore.connected
                ? 'border border-success/50 bg-success/20 text-base-content'
                : '',
            ]"
          >
            <!-- Row (clickable) -->
            <div class="flex items-center gap-2 px-2 py-1 hover:bg-base-300">
              <button
                type="button"
                class="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                :aria-current="
                  selectedChannelId === channel.id ? 'page' : undefined
                "
                @click="selectChannel(channel)"
              >
                <Icon name="lucide:volume-2" class="h-4 w-4" />
                <span class="flex-1 truncate text-sm">{{
                  channel.name || "Voice Channel"
                }}</span>
                <div
                  v-if="
                    voiceStore.currentChannelId === channel.id &&
                    voiceStore.connected
                  "
                  class="flex items-center gap-1"
                >
                  <div
                    class="w-2 h-2 bg-success animate-pulse"
                    title="Connected to voice"
                  ></div>
                </div>
              </button>

              <div class="flex items-center gap-2">
                <!-- Options button (moved here from block end) -->
                <div class="dropdown dropdown-end" @click.stop>
                  <button
                    tabindex="0"
                    class="metro-icon-btn metro-icon-btn--ghost h-8 w-8"
                    :aria-label="`Actions for ${channel.name}`"
                  >
                    <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
                  </button>
                  <ul
                    class="metro-pane metro-menu absolute right-0 top-full z-[1] mt-1 w-44 border border-base-300 bg-base-100 p-2 text-base-content shadow-lg"
                  >
                    <li v-if="canEditChannel(channel)">
                      <button type="button" @click="editChannel(channel)">
                        Edit channel
                      </button>
                    </li>
                    <li v-if="canDeleteChannel(channel)">
                      <button
                        type="button"
                        class="text-error"
                        @click="deleteChannel(channel)"
                      >
                        Delete channel
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Expanded vertical participant list (when connected) -->
            <div
              v-if="
                voiceStore.currentChannelId === channel.id &&
                voiceStore.connected
              "
              class="pl-8 pr-2 pb-2"
            >
              <div class="flex flex-col gap-1">
                <template
                  v-for="u in getConnectedChannelParticipants(channel)"
                  :key="u.id || u"
                >
                  <div
                    class="flex min-w-0 items-center gap-2 text-sm text-base-content/70"
                    @contextmenu.prevent.stop="
                      openParticipantMenu(u.id || u, $event)
                    "
                  >
                    <div
                      class="avatar placeholder shrink-0"
                      :class="u.speaking ? 'avatar-online' : ''"
                    >
                      <ProfileAvatar
                        class="h-7 w-7 overflow-hidden bg-base-300 text-[10px] font-semibold text-base-content"
                        :src="getUserAvatar(u.id || u)"
                        :name="getUserName(u.id || u)"
                      />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div
                        class="truncate transition-colors duration-150"
                        :class="
                          u.speaking
                            ? 'font-medium text-base-content'
                            : 'text-base-content/70'
                        "
                      >
                        {{ getUserName(u.id || u) }}
                      </div>
                      <div
                        v-if="u.soundboardActivity"
                        class="flex min-w-0 items-center gap-1 text-xs font-medium text-primary"
                        role="status"
                      >
                        <span aria-hidden="true">{{
                          u.soundboardActivity.icon
                        }}</span>
                        <span class="truncate"
                          >Playing {{ u.soundboardActivity.title }}</span
                        >
                      </div>
                    </div>
                    <div
                      class="flex shrink-0 items-center gap-1 text-base-content/60"
                      :aria-label="getUserMediaStatusLabel(u.id || u)"
                    >
                      <Icon
                        v-if="u.deafened"
                        name="lucide:headphone-off"
                        class="h-4 w-4"
                        title="Deafened"
                      />
                      <Icon
                        v-if="u.muted"
                        name="lucide:mic-off"
                        class="h-4 w-4"
                        title="Microphone off"
                      />
                      <Icon
                        v-if="u.cameraEnabled"
                        name="lucide:video"
                        class="h-4 w-4 text-success"
                        title="Camera on"
                      />
                      <Icon
                        v-if="u.screenSharing"
                        name="lucide:screen-share"
                        class="h-4 w-4 text-success"
                        title="Screen sharing"
                      />
                    </div>
                    <div class="dropdown dropdown-end shrink-0" @click.stop>
                      <button
                        tabindex="0"
                        type="button"
                        class="metro-transition flex h-7 items-end gap-0.5 px-1 py-1 hover:bg-base-content/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        :aria-label="getConnectionQualityAriaLabel(u.id || u)"
                        :title="getConnectionQualityTitle(u.id || u)"
                      >
                        <span
                          v-for="bar in 5"
                          :key="bar"
                          class="w-0.5 bg-current transition-opacity"
                          :class="
                            bar <= getUserConnectionQuality(u.id || u)
                              ? `${getConnectionQualityColorClass(getUserConnectionQuality(u.id || u))} opacity-100`
                              : 'text-base-content opacity-20'
                          "
                          :style="{ height: `${4 + bar * 2}px` }"
                        ></span>
                      </button>
                      <div
                        class="metro-pane metro-menu absolute right-0 top-full z-[20] mt-1 w-56 border border-base-300 bg-base-100 p-3 text-base-content shadow-xl"
                      >
                        <div class="truncate text-sm font-semibold">
                          {{ getUserName(u.id || u) }}
                        </div>
                        <div class="mt-2 space-y-1.5 text-xs">
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60"
                              >Connection quality</span
                            >
                            <span class="font-medium">{{
                              getUserConnectionQualityLabel(u.id || u)
                            }}</span>
                          </div>
                          <div
                            v-if="!isP2pActive"
                            class="flex items-center justify-between gap-3"
                          >
                            <span class="text-base-content/60">SFU RTT</span>
                            <span class="font-mono tabular-nums">{{
                              formatRtt(getUserSfuRtt(u.id || u))
                            }}</span>
                          </div>
                          <div
                            v-if="isP2pActive"
                            class="flex items-center justify-between gap-3"
                          >
                            <span class="text-base-content/60">Peer RTT</span>
                            <span class="font-mono tabular-nums">{{
                              formatPeerRtt(u.id || u)
                            }}</span>
                          </div>
                          <div
                            v-if="getUserPeerMetrics(u.id || u)"
                            class="flex items-center justify-between gap-3"
                          >
                            <span class="text-base-content/60"
                              >Packet loss</span
                            >
                            <span class="font-mono tabular-nums">{{
                              formatPercent(
                                getUserPeerMetrics(u.id || u).packetLossPercent,
                              )
                            }}</span>
                          </div>
                          <div
                            v-if="getUserPeerMetrics(u.id || u)"
                            class="flex items-center justify-between gap-3"
                          >
                            <span class="text-base-content/60">Jitter</span>
                            <span class="font-mono tabular-nums">{{
                              formatRtt(getUserPeerMetrics(u.id || u).jitterMs)
                            }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Fallback vertical list when not connected but server has inRoom info -->
            <div
              v-else-if="getChannelParticipants(channel).length"
              class="pl-8 pr-2 pb-2"
            >
              <div class="flex flex-col gap-1 text-sm text-base-content/60">
                <template
                  v-for="u in getChannelParticipants(channel)"
                  :key="u.id"
                >
                  <div
                    class="flex min-w-0 items-center gap-2"
                    @contextmenu.prevent.stop="
                      openParticipantMenu(u.id, $event)
                    "
                  >
                    <div class="avatar placeholder shrink-0">
                      <ProfileAvatar
                        class="h-7 w-7 overflow-hidden bg-base-300 text-[10px] font-semibold text-base-content"
                        :src="getUserAvatar(u.id)"
                        :name="getUserName(u.id)"
                      />
                    </div>
                    <span class="min-w-0 flex-1 truncate">{{
                      getUserName(u.id)
                    }}</span>
                    <div
                      class="flex shrink-0 items-center gap-1 text-base-content/60"
                      :aria-label="getParticipantMediaStatusLabel(u)"
                    >
                      <Icon
                        v-if="u.deafened"
                        name="lucide:headphone-off"
                        class="h-4 w-4"
                        title="Deafened"
                      />
                      <Icon
                        v-if="u.muted"
                        name="lucide:mic-off"
                        class="h-4 w-4"
                        title="Microphone off"
                      />
                      <Icon
                        v-if="u.cameraEnabled"
                        name="lucide:video"
                        class="h-4 w-4 text-success"
                        title="Camera on"
                      />
                      <Icon
                        v-if="u.screenSharing"
                        name="lucide:screen-share"
                        class="h-4 w-4 text-success"
                        title="Screen sharing"
                      />
                    </div>
                  </div>
                </template>
              </div>
            </div>
            <!-- channel actions moved into row -->
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="contextChannel"
        ref="channelMenuElement"
        class="fixed z-[110] w-52 border border-base-300 bg-base-100 py-2 text-base-content shadow-2xl"
        :style="channelMenuStyle"
        role="menu"
        :aria-label="`${contextChannel.name} channel actions`"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="border-b border-base-300 px-4 pb-2 pt-1">
          <strong class="block truncate text-sm">
            {{
              contextChannel.isMedia
                ? contextChannel.name
                : `#${contextChannel.name}`
            }}
          </strong>
          <small class="text-base-content/55">
            {{ contextChannel.isMedia ? "Voice channel" : "Text channel" }}
          </small>
        </div>
        <button
          v-if="canEditChannel(contextChannel)"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-base-200"
          role="menuitem"
          @click="editContextChannel"
        >
          <Icon name="lucide:pencil" class="size-4" />Edit channel
        </button>
        <button
          v-if="canDeleteChannel(contextChannel)"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-error hover:bg-error/10"
          role="menuitem"
          @click="deleteContextChannel"
        >
          <Icon name="lucide:trash-2" class="size-4" />Delete channel
        </button>
      </div>
      <div
        v-if="participantMenuUserId"
        ref="participantMenuElement"
        class="metro-flyout fixed z-[100] w-52 bg-base-200 p-3"
        :style="participantMenuStyle"
        role="dialog"
        :aria-label="`Voice channel controls for ${getUserName(participantMenuUserId)}`"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="truncate text-sm font-semibold">
          {{ getUserName(participantMenuUserId) }}
        </div>
        <label class="mt-3 block text-xs font-medium" for="channel-user-volume">
          User volume
        </label>
        <input
          id="channel-user-volume"
          class="metro-range mt-2 w-full"
          type="range"
          min="0"
          max="2"
          step="0.01"
          :value="voiceStore.getUserVolume(participantMenuUserId)"
          @input="setParticipantVolume"
        />
        <div class="mt-1 flex justify-between text-xs text-base-content/60">
          <span>0%</span>
          <span>200%</span>
        </div>
        <template v-if="canModerateVoiceParticipant">
          <div class="my-3 border-t border-base-300"></div>
          <p class="mb-1 text-xs font-medium text-base-content/60">Move to</p>
          <button
            v-for="channel in participantMoveTargets"
            :key="channel.id"
            type="button"
            class="metro-transition flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-base-300"
            @click="moderateParticipant(channel.id)"
          >
            <Icon name="lucide:move-right" class="size-4" />
            <span class="truncate">{{ channel.name }}</span>
          </button>
          <button
            type="button"
            class="metro-transition mt-1 flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-error hover:bg-error/10"
            @click="moderateParticipant(null)"
          >
            <Icon name="lucide:phone-off" class="size-4" />
            Disconnect from voice
          </button>
        </template>
      </div>
    </Teleport>

    <!-- Create Channel Modal -->
    <div
      v-if="showCreateChannel"
      ref="createModalElement"
      class="metro-modal modal-open px-3 py-4 sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-channel-title"
      @keydown.esc.prevent.stop="closeCreateModal"
      @keydown.tab="trapModalFocus($event, createModalElement)"
    >
      <section
        class="metro-flyout flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden border border-base-300 bg-base-100 p-0"
      >
        <header
          class="flex items-start justify-between gap-6 border-b border-base-300 px-5 py-5 sm:px-7"
        >
          <div>
            <p class="mb-1 text-sm font-semibold text-primary">New channel</p>
            <h2 id="create-channel-title" class="text-3xl font-light">
              Create a channel
            </h2>
          </div>
          <button
            type="button"
            class="metro-icon-btn metro-icon-btn--ghost shrink-0"
            aria-label="Close channel creator"
            @click="closeCreateModal"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </header>

        <form
          class="flex min-h-0 flex-1 flex-col"
          @submit.prevent="handleCreateChannel"
        >
          <div
            class="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7"
          >
            <label class="grid gap-2">
              <span class="text-sm font-semibold">Channel name</span>
              <input
                ref="createChannelNameInput"
                v-model="newChannelName"
                type="text"
                placeholder="channel-name"
                class="metro-input w-full"
                required
              />
            </label>

            <label class="grid gap-2">
              <span class="text-sm font-semibold">Description</span>
              <textarea
                v-model="newChannelDesc"
                placeholder="What will people use this channel for?"
                class="metro-input min-h-24 w-full"
                rows="3"
              ></textarea>
              <small class="text-base-content/60">Optional</small>
            </label>

            <fieldset>
              <legend class="text-sm font-semibold">Channel type</legend>
              <div
                class="mt-2 grid grid-cols-2 border-l border-t border-base-300"
              >
                <label
                  class="metro-transition flex min-h-20 cursor-pointer items-center gap-3 border-b border-r border-base-300 p-3 hover:bg-base-200"
                  :class="newChannelType === 'text' && 'bg-primary/10'"
                >
                  <input
                    v-model="newChannelType"
                    type="radio"
                    value="text"
                    class="metro-radio"
                  />
                  <span>
                    <strong class="block">Text</strong>
                    <small class="text-base-content/60">Messages</small>
                  </span>
                </label>
                <label
                  class="metro-transition flex min-h-20 cursor-pointer items-center gap-3 border-b border-r border-base-300 p-3 hover:bg-base-200"
                  :class="newChannelType === 'voice' && 'bg-primary/10'"
                >
                  <input
                    v-model="newChannelType"
                    type="radio"
                    value="voice"
                    class="metro-radio"
                  />
                  <span>
                    <strong class="block">Voice</strong>
                    <small class="text-base-content/60">Audio and video</small>
                  </span>
                </label>
              </div>
            </fieldset>

            <label v-if="newChannelType === 'voice'" class="grid gap-3">
              <span class="flex items-center justify-between gap-4">
                <span class="text-sm font-semibold">Microphone bitrate</span>
                <output class="text-sm tabular-nums"
                  >{{ newChannelBitrate }} kbps</output
                >
              </span>
              <input
                v-model.number="newChannelBitrate"
                type="range"
                min="32"
                max="96"
                class="metro-range w-full"
                step="1"
              />
              <span
                class="flex justify-between text-xs tabular-nums text-base-content/60"
                aria-hidden="true"
              >
                <span>32 kbps</span>
                <span>96 kbps</span>
              </span>
            </label>
          </div>

          <footer
            class="flex flex-col-reverse gap-2 border-t border-base-300 px-5 py-4 sm:flex-row sm:justify-end sm:px-7"
          >
            <button
              type="button"
              class="metro-btn metro-btn--ghost"
              @click="closeCreateModal"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="metro-btn"
              :disabled="!newChannelName.trim()"
            >
              Create channel
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="showEditChannel"
      ref="editModalElement"
      class="metro-modal modal-open px-3 py-4 sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-channel-title"
      @keydown.esc.prevent.stop="closeEditModal"
      @keydown.tab="trapModalFocus($event, editModalElement)"
    >
      <section
        class="metro-flyout flex max-h-[min(92dvh,56rem)] w-full max-w-2xl flex-col overflow-hidden border border-base-300 bg-base-100 p-0"
      >
        <header
          class="flex shrink-0 items-start justify-between gap-6 border-b border-base-300 px-5 py-5 sm:px-7"
        >
          <div>
            <p class="mb-1 text-sm font-semibold text-primary">
              Channel settings
            </p>
            <h2 id="edit-channel-title" class="text-3xl font-light">
              Edit {{ editingChannel.name }}
            </h2>
          </div>
          <button
            type="button"
            class="metro-icon-btn metro-icon-btn--ghost shrink-0"
            aria-label="Close channel settings"
            @click="closeEditModal"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </header>

        <form
          class="flex min-h-0 flex-1 flex-col"
          @submit.prevent="handleEditChannel"
        >
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            <section aria-labelledby="channel-details-title">
              <h3 id="channel-details-title" class="text-xl font-semibold">
                Details
              </h3>
              <div class="mt-5 grid gap-5">
                <label class="grid gap-2">
                  <span class="text-sm font-semibold">Channel name</span>
                  <input
                    ref="editChannelNameInput"
                    v-model="editingChannel.name"
                    type="text"
                    class="metro-input w-full"
                    required
                  />
                </label>
                <label class="grid gap-2">
                  <span class="text-sm font-semibold">Description</span>
                  <textarea
                    v-model="editingChannel.desc"
                    class="metro-input min-h-24 w-full"
                    rows="3"
                  ></textarea>
                </label>
              </div>
            </section>

            <fieldset
              v-if="!editingChannel.isMedia && hasPermission('channel.update')"
              class="mt-8 border-t border-base-300 pt-7"
            >
              <legend class="sr-only">Message policy</legend>
              <h3 class="text-xl font-semibold">Message policy</h3>
              <p class="mt-1 max-w-xl text-sm leading-6 text-base-content/65">
                Control who can post and how often messages can be sent.
              </p>
              <div
                class="mt-5 divide-y divide-base-300 border-y border-base-300"
              >
                <label
                  class="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center"
                >
                  <span>
                    <strong class="block">Send permission</strong>
                    <small class="mt-1 block text-base-content/65">
                      Choose which channel members can send messages.
                    </small>
                  </span>
                  <select
                    v-model="editingMessagePolicy"
                    class="metro-select w-full bg-base-100"
                  >
                    <option
                      v-for="option in CHANNEL_POLICY_OPTIONS"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label
                  class="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center"
                >
                  <span>
                    <strong class="block">Slow mode</strong>
                    <small class="mt-1 block text-base-content/65">
                      Set the wait between messages from the same member.
                    </small>
                  </span>
                  <select
                    v-model.number="editingSlowMode"
                    class="metro-select w-full bg-base-100"
                  >
                    <option
                      v-for="option in SLOW_MODE_OPTIONS"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset
              v-if="
                editingChannel.isMedia &&
                hasPermission('channel.manage_media_policy')
              "
              class="mt-8 border-t border-base-300 pt-7"
            >
              <legend class="sr-only">Media policy</legend>
              <h3 class="text-xl font-semibold">Media policy</h3>
              <p class="mt-1 max-w-xl text-sm leading-6 text-base-content/65">
                These limits apply live to everyone connected to this voice
                channel.
              </p>

              <label
                class="metro-transition mt-5 flex min-h-16 cursor-pointer items-center justify-between gap-5 border-y border-base-300 py-3"
              >
                <span>
                  <span class="block font-semibold">HD microphone audio</span>
                  <small class="mt-1 block text-base-content/65">
                    Use stereo microphone audio between 64 and 256 kbps.
                  </small>
                </span>
                <input
                  v-model="editingChannelPolicy.hdAudio"
                  type="checkbox"
                  class="metro-toggle shrink-0"
                  @change="applyHdAudioRange"
                />
              </label>

              <div class="divide-y divide-base-300">
                <section
                  v-for="field in channelPolicyFields"
                  :key="field.key"
                  class="grid gap-4 py-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-6"
                >
                  <div>
                    <h4
                      :id="`channel-policy-${field.key}-label`"
                      class="font-semibold"
                    >
                      {{ field.label }}
                    </h4>
                    <p class="mt-1 text-xs leading-5 text-base-content/60">
                      {{
                        field.control === "slider"
                          ? "Set the maximum audio bitrate."
                          : "Choose the maximum video quality."
                      }}
                    </p>
                  </div>

                  <div v-if="field.control === 'slider'">
                    <div class="flex items-center gap-4">
                      <input
                        :id="`channel-policy-${field.key}`"
                        v-model.number="editingChannelPolicy[field.key]"
                        type="range"
                        class="metro-range flex-1"
                        :aria-label="field.label"
                        :min="field.min"
                        :max="field.max"
                        :step="field.step"
                        required
                      />
                      <label
                        class="metro-input flex w-28 shrink-0 items-center gap-1 px-2"
                      >
                        <input
                          v-model.number="editingChannelPolicy[field.key]"
                          type="number"
                          class="min-w-0 text-right tabular-nums"
                          :aria-label="`${field.label} bitrate in kilobits per second`"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step"
                          required
                          @change="normalizeChannelPolicyValue(field)"
                        />
                        <span class="text-xs text-base-content/60">kbps</span>
                      </label>
                    </div>
                    <div
                      class="mt-2 flex justify-between text-xs tabular-nums text-base-content/55"
                      aria-hidden="true"
                    >
                      <span>{{ field.min }} kbps</span>
                      <span>{{ field.max }} kbps</span>
                    </div>
                  </div>

                  <div
                    v-else
                    :id="`channel-policy-${field.key}`"
                    class="grid grid-cols-2 border-l border-t border-base-300 sm:grid-cols-4"
                    role="group"
                    :aria-labelledby="`channel-policy-${field.key}-label`"
                  >
                    <button
                      v-for="option in field.options"
                      :key="option.value"
                      type="button"
                      class="metro-transition min-h-16 border-b border-r border-base-300 px-2 py-2 text-left hover:bg-base-200"
                      :class="
                        editingChannelPolicy[field.key] === option.value
                          ? 'bg-primary text-primary-content'
                          : 'bg-base-100'
                      "
                      :aria-pressed="
                        editingChannelPolicy[field.key] === option.value
                      "
                      @click="setChannelPolicyValue(field.key, option.value)"
                    >
                      <strong class="block text-sm">{{ option.label }}</strong>
                      <span class="mt-1 block text-xs opacity-75">
                        {{ formatVideoPolicyBitrate(option.value) }}
                      </span>
                    </button>
                  </div>
                </section>
              </div>
            </fieldset>
          </div>

          <footer
            class="flex shrink-0 flex-col-reverse gap-2 border-t border-base-300 bg-base-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-7"
          >
            <button
              type="button"
              class="metro-btn metro-btn--ghost"
              @click="closeEditModal"
            >
              Cancel
            </button>
            <button type="submit" class="metro-btn">Save channel</button>
          </footer>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup>
function getUserName(userId) {
  const user =
    voiceStore.getUserById(userId) ||
    voiceStore.getUserProfile(userId) ||
    channelsStore.getVoiceProfile(userId) ||
    props.room?.members?.find((member) => String(member.id) === String(userId));
  return identityStore.displayName(user || {});
}
function getUserAvatar(userId) {
  const currentUser = authStore.getUserData?.();
  if (
    currentUser?.id &&
    String(currentUser.id) === String(userId?.id || userId)
  ) {
    return currentUser.avatar || null;
  }
  const user =
    voiceStore.getUserById(userId) ||
    voiceStore.getUserProfile(userId) ||
    channelsStore.getVoiceProfile(userId) ||
    props.room?.members?.find((member) => String(member.id) === String(userId));
  const avatar = user?.avatar;
  return avatar || null;
}
function getUserInitials(userId) {
  return getUserName(userId)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
function getChannelParticipants(channel) {
  const currentUserId = String(authStore.getUserData()?.id || "");
  return (channel.inRoom || [])
    .filter((userId) => String(userId) !== currentUserId)
    .map((userId) => ({
      id: String(userId),
      ...(channel.participantStates?.[String(userId)] || {}),
    }));
}
function getConnectedChannelParticipants(channel) {
  const connectedUsers = new Map(
    voiceStore.getDisplayUsersArray().map((user) => [String(user.id), user]),
  );
  return (channel.inRoom || []).map((userId) => {
    const normalizedUserId = String(userId);
    return {
      ...(connectedUsers.get(normalizedUserId) || {}),
      ...(channel.participantStates?.[normalizedUserId] || {}),
      id: normalizedUserId,
    };
  });
}
function getParticipantMediaStatusLabel(user) {
  const statuses = [];
  if (user.deafened) statuses.push("deafened");
  else if (user.muted) statuses.push("microphone off");
  if (user.cameraEnabled) statuses.push("camera on");
  if (user.screenSharing) statuses.push("screen sharing");
  return statuses.length
    ? `${getUserName(user.id)}: ${statuses.join(", ")}`
    : `${getUserName(user.id)}: microphone on`;
}
function getUserMediaStatusLabel(userId) {
  const user = voiceStore.getUserById(userId);
  const statuses = [];
  if (user?.deafened) statuses.push("deafened");
  else if (user?.muted) statuses.push("microphone off");
  if (user?.cameraEnabled) statuses.push("camera on");
  if (user?.screenSharing) statuses.push("screen sharing");
  return statuses.length
    ? `${getUserName(userId)}: ${statuses.join(", ")}`
    : `${getUserName(userId)}: microphone on`;
}
const isP2pActive = computed(
  () => unref(unref(voiceStore.sfuComposable)?.activeProvider) === "p2p",
);
function getUserSfuRtt(userId) {
  const sfu = unref(voiceStore.sfuComposable);
  if (!sfu) return null;
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id);
  const value = isCurrentUser
    ? unref(sfu.sfuRoundTripTime)
    : unref(sfu.participantSfuRoundTripTimes)?.[String(userId)];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function getUserPeerRtt(userId) {
  const sfu = unref(voiceStore.sfuComposable);
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id);
  if (!sfu) return null;
  const peerRoundTripTimes = unref(sfu.peerRoundTripTimes) || {};
  const values = Object.values(peerRoundTripTimes)
    .map(Number)
    .filter(Number.isFinite);
  const value = isCurrentUser
    ? values.length
      ? Math.max(...values)
      : null
    : peerRoundTripTimes[String(userId)];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function getUserConnectionQuality(userId) {
  const sfu = unref(voiceStore.sfuComposable);
  const provider = unref(sfu?.activeProvider);
  if (provider !== "p2p")
    return getConnectionQualityBars(getUserSfuRtt(userId));
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id);
  const metrics = isCurrentUser ? null : getUserPeerMetrics(userId);
  return getConnectionQualityBars(
    getUserPeerRtt(userId),
    metrics?.packetLossPercent,
    metrics?.jitterMs,
  );
}
function getUserPeerMetrics(userId) {
  const sfu = unref(voiceStore.sfuComposable);
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id);
  return isCurrentUser
    ? null
    : unref(sfu?.peerConnectionMetrics)?.[String(userId)] || null;
}
function getUserConnectionQualityLabel(userId) {
  return getConnectionQualityLabel(getUserConnectionQuality(userId));
}
function getConnectionQualityAriaLabel(userId) {
  const name = getUserName(userId);
  const label = getUserConnectionQualityLabel(userId);
  const rtt = formatRtt(getUserPeerRtt(userId) ?? getUserSfuRtt(userId));
  return `${name} connection quality: ${label}, RTT ${rtt}. Show connection statistics.`;
}
function getConnectionQualityTitle(userId) {
  return `${getUserConnectionQualityLabel(userId)} connection · Click for RTT statistics`;
}
function formatRtt(value) {
  return Number.isFinite(Number(value))
    ? `${Math.round(Number(value))} ms`
    : "Waiting";
}
function formatPercent(value) {
  return Number.isFinite(Number(value))
    ? `${Number(value).toFixed(1)}%`
    : "Waiting";
}
function formatPeerRtt(userId) {
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id);
  return isCurrentUser ? "Current device" : formatRtt(getUserPeerRtt(userId));
}
import { useChannelsStore } from "../stores/channels";
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";
import { useVoiceStore } from "../stores/voice";
import { useIdentityStore } from "../stores/identity";
import {
  getConnectionQualityBars,
  getConnectionQualityColorClass,
  getConnectionQualityLabel,
} from "../shared/connection-quality";
import { unref } from "vue";
import { VIEWPORT_PADDING_PX } from "../const/ui";
import {
  HD_MICROPHONE_MIN_KBPS,
  MEDIA_POLICY_LIMITS,
  STANDARD_MICROPHONE_MAX_KBPS,
  VIDEO_POLICY_QUALITY_STEPS,
  normalizeMediaPolicy,
} from "~~/shared/media-policy.js";
import {
  CHANNEL_POLICY_LABELS,
  SLOW_MODE_OPTIONS,
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "~~/shared/channel-policy.js";

const inviteDialog = ref(null);

const props = defineProps({
  room: {
    type: Object,
    required: true,
  },
  selectedChannelId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(["channel-selected"]);

const channelsStore = useChannelsStore();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const voiceStore = useVoiceStore();
const identityStore = useIdentityStore();
const contextChannel = ref(null);
const channelMenuElement = ref(null);
const channelMenuPosition = ref({ x: 0, y: 0 });
const channelMenuStyle = computed(() => ({
  left: `${channelMenuPosition.value.x}px`,
  top: `${channelMenuPosition.value.y}px`,
}));
const participantMenuUserId = ref(null);
const participantMenuElement = ref(null);
const participantMenuPosition = ref({ x: 0, y: 0 });
const participantMenuStyle = computed(() => ({
  left: `${participantMenuPosition.value.x}px`,
  top: `${participantMenuPosition.value.y}px`,
}));
const participantSourceChannel = computed(() =>
  voiceChannels.value.find((channel) =>
    (channel.inRoom || [])
      .map(String)
      .includes(String(participantMenuUserId.value)),
  ),
);
const canModerateVoiceParticipant = computed(
  () =>
    Boolean(participantMenuUserId.value) &&
    String(participantMenuUserId.value) !== String(currentUserId.value) &&
    hasPermission("channel.moderate_voice"),
);
const participantMoveTargets = computed(() =>
  voiceChannels.value.filter(
    (channel) => channel.id !== participantSourceChannel.value?.id,
  ),
);

async function openChannelMenu(channel, event) {
  closeParticipantMenu();
  contextChannel.value = channel;
  channelMenuPosition.value = { x: event.clientX, y: event.clientY };
  await nextTick();

  if (!channelMenuElement.value) return;
  const { width, height } = channelMenuElement.value.getBoundingClientRect();
  channelMenuPosition.value = {
    x: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(event.clientX, window.innerWidth - width - VIEWPORT_PADDING_PX),
    ),
    y: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        event.clientY,
        window.innerHeight - height - VIEWPORT_PADDING_PX,
      ),
    ),
  };
}

function closeChannelMenu() {
  contextChannel.value = null;
}

function editContextChannel() {
  const channel = contextChannel.value;
  closeChannelMenu();
  if (channel) editChannel(channel);
}

function deleteContextChannel() {
  const channel = contextChannel.value;
  closeChannelMenu();
  if (channel) deleteChannel(channel);
}

async function openParticipantMenu(userId, event) {
  participantMenuUserId.value = String(userId);
  participantMenuPosition.value = { x: event.clientX, y: event.clientY };
  await nextTick();

  if (!participantMenuElement.value) return;
  const { width, height } =
    participantMenuElement.value.getBoundingClientRect();
  participantMenuPosition.value = {
    x: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        participantMenuPosition.value.x,
        window.innerWidth - width - VIEWPORT_PADDING_PX,
      ),
    ),
    y: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        participantMenuPosition.value.y,
        window.innerHeight - height - VIEWPORT_PADDING_PX,
      ),
    ),
  };
}

function closeParticipantMenu() {
  participantMenuUserId.value = null;
}

function setParticipantVolume(event) {
  if (!participantMenuUserId.value) return;
  voiceStore.setUserVolume(
    participantMenuUserId.value,
    Number(event.target.value),
  );
}

async function moderateParticipant(targetChannelId) {
  const sourceChannelId = participantSourceChannel.value?.id;
  const targetUserId = participantMenuUserId.value;
  if (!sourceChannelId || !targetUserId) return;
  closeParticipantMenu();
  try {
    await channelsStore.moderateVoiceParticipant(
      sourceChannelId,
      targetUserId,
      targetChannelId,
    );
  } catch (error) {
    console.error("[ChannelList] Failed to moderate voice participant", error);
  }
}

function onParticipantMenuKeydown(event) {
  if (event.key === "Escape") {
    closeChannelMenu();
    closeParticipantMenu();
  }
}
const showCreateChannel = ref(false);
const showEditChannel = ref(false);
const roomActionsButton = ref(null);
const createModalElement = ref(null);
const createChannelNameInput = ref(null);
const editModalElement = ref(null);
const editChannelNameInput = ref(null);
const editingChannel = ref(null);
const editingChannelPolicy = ref({});
const originalEditingChannelPolicy = ref({});
const editingMessagePolicy = ref("free");
const editingSlowMode = ref(0);
const CHANNEL_POLICY_OPTIONS = computed(() =>
  Object.entries(CHANNEL_POLICY_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
);
let createReturnFocus = null;
let editReturnFocus = null;
const channelPolicyFields = computed(() =>
  Object.entries(MEDIA_POLICY_LIMITS).map(([key, limits]) => ({
    key,
    label:
      {
        microphoneKbps: "Microphone",
        cameraKbps: "Camera video",
        screenKbps: "Screen share",
        sharedAudioKbps: "Shared audio",
      }[key] || key,
    ...limits,
    ...(key === "microphoneKbps"
      ? editingChannelPolicy.value.hdAudio
        ? { min: HD_MICROPHONE_MIN_KBPS, max: limits.max }
        : { min: limits.min, max: STANDARD_MICROPHONE_MAX_KBPS }
      : {}),
    control: VIDEO_POLICY_QUALITY_STEPS[key] ? "steps" : "slider",
    options: VIDEO_POLICY_QUALITY_STEPS[key] || [],
    step: 1,
  })),
);

function applyHdAudioRange() {
  editingChannelPolicy.value.microphoneKbps = editingChannelPolicy.value.hdAudio
    ? Math.max(
        HD_MICROPHONE_MIN_KBPS,
        Number(editingChannelPolicy.value.microphoneKbps) || 96,
      )
    : Math.min(
        STANDARD_MICROPHONE_MAX_KBPS,
        Number(editingChannelPolicy.value.microphoneKbps) || 48,
      );
}

function normalizeChannelPolicyValue(field) {
  const value = Number(editingChannelPolicy.value[field.key]);
  editingChannelPolicy.value[field.key] = Math.min(
    field.max,
    Math.max(field.min, Number.isFinite(value) ? value : field.min),
  );
}

function setChannelPolicyValue(key, value) {
  editingChannelPolicy.value[key] = value;
}

function formatVideoPolicyBitrate(value) {
  return `${Number(value) / 1000} Mbps`;
}
const unreadCounts = ref([]);
const newChannelName = ref("");
const newChannelDesc = ref("");
const newChannelType = ref("text");
const newChannelBitrate = ref(48);
const textChannels = computed(() => channelsStore.getTextChannels());
const voiceChannels = computed(() => channelsStore.getMediaChannels());
const currentUserId = computed(() => authStore.getUserData()?.id);
const isRoomOwnerOrAdmin = computed(() => {
  if (!props.room || !props.room.owner) return false;
  return props.room.owner.id === currentUserId.value;
});
const runtimeConfig = useRuntimeConfig();
function roomAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${runtimeConfig.public.apiPath.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
function hasPermission(permission) {
  return (
    props.room?.owner?.id === currentUserId.value ||
    props.room?.permissions?.includes(permission)
  );
}
async function handleDeleteRoom() {
  if (!props.room || !props.room.id) return;
  if (
    !confirm(
      `Are you sure you want to delete the room "${props.room.name}"? This cannot be undone.`,
    )
  )
    return;
  try {
    await leaveActiveVoiceChannel();
    await roomsStore.deleteRoom(props.room.id);
    navigateTo("/");
  } catch (err) {
    console.error("Failed to delete room:", err);
  }
}

async function handleLeaveRoom() {
  if (!props.room || !props.room.id) return;
  if (!confirm(`Are you sure you want to leave the room "${props.room.name}"?`))
    return;
  try {
    await leaveActiveVoiceChannel();
    await roomsStore.leaveRoom(props.room.id);
    navigateTo("/");
  } catch (err) {
    console.error("Failed to leave room:", err);
  }
}

async function leaveActiveVoiceChannel() {
  if (
    voiceStore.connected &&
    String(voiceStore.currentRoomId) === String(props.room?.id)
  ) {
    await voiceStore.leaveVoiceChannel();
  }
}

async function loadChannels() {
  try {
    await channelsStore.fetchChannels(props.room.id);
    await loadUnreadCounts();
  } catch (error) {
    console.error("Failed to load channels:", error);
  }
}

async function loadUnreadCounts() {
  try {
    const counts = await channelsStore.getUnreadCounts();
    unreadCounts.value = counts;
    useState("unread-counts", () => []).value = counts;
  } catch (error) {
    console.error("Failed to load unread counts:", error);
  }
}

function getUnreadCount(channelId) {
  const count = unreadCounts.value.find((c) => c.channelId === channelId);
  return count?.unreadCount || 0;
}

function selectChannel(channel) {
  emit("channel-selected", channel);
}

async function handleCreateChannel() {
  try {
    const channelData = {
      name: newChannelName.value.trim(),
      desc: newChannelDesc.value.trim(),
      isMedia: newChannelType.value === "voice",
      mediaPolicy:
        newChannelType.value === "voice"
          ? normalizeMediaPolicy({
              microphoneKbps: Number(newChannelBitrate.value),
              hdAudio: Number(newChannelBitrate.value) > 96,
            })
          : null,
    };

    await channelsStore.createChannel(props.room.id, channelData);
    closeCreateModal();
  } catch (error) {
    console.error("Failed to create channel:", error);
  }
}

async function editChannel(channel) {
  editReturnFocus = document.activeElement;
  editingChannel.value = { ...channel };
  editingChannelPolicy.value = { ...(channel.mediaPolicy || {}) };
  originalEditingChannelPolicy.value = { ...editingChannelPolicy.value };
  editingMessagePolicy.value = normalizeChannelPolicy(channel.policy);
  editingSlowMode.value = normalizeSlowMode(channel.slow_mode);
  showEditChannel.value = true;
  await nextTick();
  editChannelNameInput.value?.focus();
}

async function handleEditChannel() {
  try {
    const update = {
      name: editingChannel.value.name,
      desc: editingChannel.value.desc,
    };
    if (
      editingChannel.value.isMedia &&
      hasPermission("channel.manage_media_policy") &&
      JSON.stringify(editingChannelPolicy.value) !==
        JSON.stringify(originalEditingChannelPolicy.value)
    )
      update.mediaPolicy = editingChannelPolicy.value;
    await channelsStore.editChannel(editingChannel.value.id, update);
    if (!editingChannel.value.isMedia && hasPermission("channel.update")) {
      await channelsStore.updateChannelPolicy(editingChannel.value.id, {
        policy: editingMessagePolicy.value,
        slowMode: editingSlowMode.value,
      });
    }
    closeEditModal();
  } catch (error) {
    console.error("Failed to edit channel:", error);
  }
}

async function deleteChannel(channel) {
  if (confirm(`Are you sure you want to delete #${channel.name}?`)) {
    try {
      await channelsStore.deleteChannel(channel.id);
    } catch (error) {
      console.error("Failed to delete channel:", error);
    }
  }
}

function canDeleteChannel(channel) {
  return (
    channel.owner?.id === currentUserId.value ||
    props.room.owner?.id === currentUserId.value ||
    hasPermission("channel.delete")
  );
}

function canEditChannel(channel) {
  return (
    channel.owner?.id === currentUserId.value ||
    props.room.owner?.id === currentUserId.value ||
    hasPermission("channel.update")
  );
}

function closeCreateModal() {
  const returnFocus = createReturnFocus;
  showCreateChannel.value = false;
  newChannelName.value = "";
  newChannelDesc.value = "";
  newChannelType.value = "text";
  newChannelBitrate.value = 48;
  createReturnFocus = null;
  nextTick(() => returnFocus?.isConnected && returnFocus.focus());
}

function closeEditModal() {
  const returnFocus = editReturnFocus;
  showEditChannel.value = false;
  editingChannel.value = null;
  editingChannelPolicy.value = {};
  originalEditingChannelPolicy.value = {};
  editingMessagePolicy.value = "free";
  editingSlowMode.value = 0;
  editReturnFocus = null;
  nextTick(() => returnFocus?.isConnected && returnFocus.focus());
}

async function openCreateModal() {
  createReturnFocus = roomActionsButton.value || document.activeElement;
  showCreateChannel.value = true;
  await nextTick();
  createChannelNameInput.value?.focus();
}

function trapModalFocus(event, modal) {
  const focusable = [
    ...modal.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hidden && element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function goToRoomSettings() {
  if (!props.room?.id) return;
  navigateTo(`/room/${props.room.id}/settings`);
}

onMounted(() => {
  loadChannels();
  document.addEventListener("pointerdown", closeChannelMenu);
  document.addEventListener("pointerdown", closeParticipantMenu);
  document.addEventListener("keydown", onParticipantMenuKeydown);
  window.addEventListener("resize", closeParticipantMenu);
  window.addEventListener("resize", closeChannelMenu);
  window.addEventListener("scroll", closeParticipantMenu, true);
  window.addEventListener("scroll", closeChannelMenu, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", closeChannelMenu);
  document.removeEventListener("pointerdown", closeParticipantMenu);
  document.removeEventListener("keydown", onParticipantMenuKeydown);
  window.removeEventListener("resize", closeParticipantMenu);
  window.removeEventListener("resize", closeChannelMenu);
  window.removeEventListener("scroll", closeParticipantMenu, true);
  window.removeEventListener("scroll", closeChannelMenu, true);
});
watch(
  () => props.room.id,
  () => {
    if (props.room.id) {
      loadChannels();
    }
  },
);
</script>
