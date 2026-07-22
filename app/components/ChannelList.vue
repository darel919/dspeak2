<template>
  <div class="flex flex-col h-full bg-base-200">
    <!-- Channel list header -->
    <div class="border-base-300 p-4">
      <div class="relative flex flex-col items-center gap-3">
        <div
          class="grid size-20 place-items-center overflow-hidden bg-base-300"
        >
          <img
            v-if="room?.picture"
            :src="roomAssetUrl(room.picture)"
            :alt="`${room.name} avatar`"
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
          <button tabindex="0" class="btn btn-ghost btn-sm btn-circle">
            <Icon name="lucide:ellipsis-vertical" class="h-5 w-5" />
          </button>
          <div
            tabindex="0"
            class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-52"
          >
            <li v-if="hasPermission('channel.create')">
              <a @click="showCreateChannel = true">Create Channel</a>
            </li>
            <li>
              <a
                @click="goToRoomSettings"
                class="cursor-pointer hover:bg-base-200"
              >
                Room Settings
              </a>
            </li>
            <li>
              <a
                @click="inviteDialog?.open(room)"
                class="cursor-pointer hover:bg-base-200"
                >Copy Invite Link</a
              >
            </li>
            <li v-if="isRoomOwnerOrAdmin">
              <a
                @click="handleDeleteRoom"
                class="text-error cursor-pointer hover:bg-error/20"
                >Delete Room</a
              >
            </li>
            <li v-else>
              <a
                @click="handleLeaveRoom"
                class="text-warning cursor-pointer hover:bg-warning/20"
                >Leave Room</a
              >
            </li>
          </div>
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
          Text Channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in textChannels"
            :key="channel.id"
            @click="selectChannel(channel)"
            @contextmenu.prevent.stop="openChannelMenu(channel, $event)"
            class="group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-base-300 transition-colors"
            :class="{
              'bg-primary text-primary-content':
                selectedChannelId === channel.id,
            }"
          >
            <span class="text-sm">#</span>
            <span class="flex-1 text-sm truncate">{{ channel.name }}</span>
            <div
              v-if="getUnreadCount(channel.id)"
              class="badge badge-primary badge-sm"
            >
              {{ getUnreadCount(channel.id) }}
            </div>
            <!-- Channel actions dropdown -->
            <div class="dropdown dropdown-end" @click.stop>
              <button
                tabindex="0"
                class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100"
              >
                <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
              </button>
              <div
                tabindex="0"
                class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-44"
              >
                <li v-if="canEditChannel(channel)">
                  <a @click="editChannel(channel)">Edit Channel</a>
                </li>
                <li v-if="canDeleteChannel(channel)">
                  <a @click="deleteChannel(channel)" class="text-error"
                    >Delete Channel</a
                  >
                </li>
              </div>
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
          Voice Channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in voiceChannels"
            :key="channel.id"
            class="group rounded transition-colors"
            @contextmenu.prevent.stop="openChannelMenu(channel, $event)"
            :class="{
              'bg-primary text-primary-content':
                selectedChannelId === channel.id,
              'bg-success/20 border border-success/50':
                voiceStore.currentChannelId === channel.id &&
                voiceStore.connected,
            }"
          >
            <!-- Row (clickable) -->
            <div
              @click="selectChannel(channel)"
              class="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-base-300"
            >
              <Icon name="lucide:volume-2" class="h-4 w-4" />

              <span class="flex-1 text-sm truncate">{{
                channel.name || "Voice Channel"
              }}</span>

              <div class="flex items-center gap-2">
                <div
                  v-if="
                    voiceStore.currentChannelId === channel.id &&
                    voiceStore.connected
                  "
                  class="flex items-center gap-1"
                >
                  <div
                    class="w-2 h-2 bg-success rounded-full animate-pulse"
                    title="Connected to voice"
                  ></div>
                </div>

                <!-- Options button (moved here from block end) -->
                <div class="dropdown dropdown-end" @click.stop>
                  <button
                    tabindex="0"
                    class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100"
                    title="Channel options"
                  >
                    <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
                  </button>
                  <div
                    tabindex="0"
                    class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-44"
                  >
                    <li v-if="canEditChannel(channel)">
                      <a @click="editChannel(channel)">Edit Channel</a>
                    </li>
                    <li v-if="canDeleteChannel(channel)">
                      <a @click="deleteChannel(channel)" class="text-error"
                        >Delete Channel</a
                      >
                    </li>
                  </div>
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
                  v-for="u in voiceStore.getDisplayUsersArray()"
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
                      <div
                        class="h-7 w-7 overflow-hidden rounded-full bg-base-300 text-[10px] font-semibold text-base-content"
                      >
                        <img
                          v-if="getUserAvatar(u.id || u)"
                          :src="getUserAvatar(u.id || u)"
                          :alt="`${getUserName(u.id || u)} avatar`"
                          class="h-full w-full object-cover"
                        />
                        <span v-else>{{ getUserInitials(u.id || u) }}</span>
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div
                        class="truncate transition-colors duration-150"
                        :class="
                          u.speaking
                            ? 'font-medium text-base-content'
                            : 'text-base-content/45'
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
                        v-else-if="u.muted"
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
                        class="flex h-6 items-end gap-0.5 rounded px-1 py-1 transition-colors hover:bg-base-content/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        :aria-label="getConnectionQualityAriaLabel(u.id || u)"
                        :title="getConnectionQualityTitle(u.id || u)"
                      >
                        <span
                          v-for="bar in 5"
                          :key="bar"
                          class="w-0.5 rounded-full bg-current transition-opacity"
                          :class="
                            bar <= getUserConnectionQuality(u.id || u)
                              ? `${getConnectionQualityColorClass(getUserConnectionQuality(u.id || u))} opacity-100`
                              : 'text-base-content opacity-20'
                          "
                          :style="{ height: `${4 + bar * 2}px` }"
                        ></span>
                      </button>
                      <div
                        tabindex="0"
                        class="dropdown-content z-[20] mt-1 w-56 rounded-box border border-base-300 bg-base-100 p-3 text-base-content shadow-xl"
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
            <div v-else-if="channel.inRoom?.length" class="pl-8 pr-2 pb-2">
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
                      <div
                        class="h-7 w-7 overflow-hidden rounded-full bg-base-300 text-[10px] font-semibold text-base-content"
                      >
                        <img
                          v-if="getUserAvatar(u.id)"
                          :src="getUserAvatar(u.id)"
                          :alt="`${getUserName(u.id)} avatar`"
                          class="h-full w-full object-cover"
                        />
                        <span v-else>{{ getUserInitials(u.id) }}</span>
                      </div>
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
                        v-else-if="u.muted"
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
        class="fixed z-[100] w-52 rounded-lg border border-base-300 bg-base-200 p-3 text-base-content shadow-xl"
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
          class="range range-primary mt-2 w-full"
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
      </div>
    </Teleport>

    <!-- Create Channel Modal -->
    <div v-if="showCreateChannel" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Create Channel</h3>
        <form @submit.prevent="handleCreateChannel" class="space-y-4 mt-4">
          <div>
            <label class="label">
              <span class="label-text">Channel Name</span>
            </label>
            <input
              v-model="newChannelName"
              type="text"
              placeholder="channel-name"
              class="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label class="label">
              <span class="label-text">Description (optional)</span>
            </label>
            <textarea
              v-model="newChannelDesc"
              placeholder="Describe what this channel is for..."
              class="textarea textarea-bordered w-full"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class="label">
              <span class="label-text">Channel Type</span>
            </label>
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Text Channel</span>
                <input
                  v-model="newChannelType"
                  type="radio"
                  value="text"
                  class="radio"
                />
              </label>
              <label class="label cursor-pointer">
                <span class="label-text">Voice Channel</span>
                <input
                  v-model="newChannelType"
                  type="radio"
                  value="voice"
                  class="radio"
                />
              </label>
            </div>
          </div>
          <div v-if="newChannelType === 'voice'">
            <label class="label">
              <span class="label-text">Audio Bitrate (kbps)</span>
            </label>
            <div class="w-full">
              <input
                type="range"
                min="32"
                max="64"
                v-model.number="newChannelBitrate"
                class="range w-full"
                step="1"
              />
              <div class="flex justify-between px-2.5 mt-2 text-xs">
                <span>32</span>
                <span>48</span>
                <span>64</span>
              </div>
            </div>
            <div class="text-sm mt-2">
              Selected: <strong>{{ newChannelBitrate }} kbps mono</strong>
            </div>
          </div>
          <div class="modal-action">
            <button type="button" class="btn" @click="closeCreateModal">
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="!newChannelName.trim()"
            >
              Create Channel
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Channel Modal -->
    <div v-if="showEditChannel" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Edit Channel</h3>
        <form @submit.prevent="handleEditChannel" class="space-y-4 mt-4">
          <div>
            <label class="label">
              <span class="label-text">Channel Name</span>
            </label>
            <input
              v-model="editingChannel.name"
              type="text"
              class="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="editingChannel.desc"
              class="textarea textarea-bordered w-full"
              rows="3"
            ></textarea>
          </div>
          <fieldset
            v-if="
              editingChannel.isMedia &&
              hasPermission('channel.manage_media_policy')
            "
            class="border-t border-base-300 pt-4"
          >
            <legend class="pr-3 text-lg font-light">Media policy</legend>
            <p class="mb-4 text-sm text-base-content/60">
              Changes apply live to everyone connected to this voice channel.
            </p>
            <label class="mb-4 flex cursor-pointer items-start gap-3">
              <input
                v-model="editingChannelPolicy.hdAudio"
                type="checkbox"
                class="toggle toggle-primary mt-0.5"
                @change="applyHdAudioRange"
              />
              <span>
                <span class="block text-sm font-medium"
                  >HD microphone audio</span
                >
                <small class="text-base-content/60">
                  Stereo microphone audio above 64 kbps. Off by default.
                </small>
              </span>
            </label>
            <div class="grid gap-5 sm:grid-cols-2">
              <label
                v-for="field in channelPolicyFields"
                :key="field.key"
                class="grid min-w-0 gap-2"
              >
                <span class="text-sm font-medium">{{ field.label }}</span>
                <div class="flex items-center gap-3">
                  <input
                    v-model.number="editingChannelPolicy[field.key]"
                    type="range"
                    class="range range-primary min-w-0 flex-1"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step"
                    required
                  />
                  <output class="w-20 text-right text-sm tabular-nums">
                    {{ editingChannelPolicy[field.key] }} kbps
                  </output>
                </div>
                <small class="text-base-content/50"
                  >{{ field.min }}–{{ field.max }} kbps</small
                >
              </label>
            </div>
          </fieldset>
          <div class="modal-action">
            <button type="button" class="btn" @click="closeEditModal">
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
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
  const user =
    voiceStore.getUserById(userId) ||
    voiceStore.getUserProfile(userId) ||
    channelsStore.getVoiceProfile(userId) ||
    props.room?.members?.find((member) => String(member.id) === String(userId));
  const avatar = user?.avatar;
  if (!avatar) return null;
  if (/^(https?:)?\/\//i.test(avatar)) return avatar;
  const base = runtimeConfig.public.baseApiPath.replace(/\/$/, "");
  return `${base}/${String(avatar).replace(/^\/+/, "")}`;
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
  return (channel.inRoom || []).map((userId) => ({
    id: String(userId),
    ...(channel.participantStates?.[String(userId)] || {}),
  }));
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
} from "~~/shared/media-policy.js";

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

function onParticipantMenuKeydown(event) {
  if (event.key === "Escape") {
    closeChannelMenu();
    closeParticipantMenu();
  }
}
const showCreateChannel = ref(false);
const showEditChannel = ref(false);
const editingChannel = ref(null);
const editingChannelPolicy = ref({});
const originalEditingChannelPolicy = ref({});
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
    await roomsStore.leaveRoom(props.room.id);
    navigateTo("/");
  } catch (err) {
    console.error("Failed to leave room:", err);
  }
}

async function loadChannels() {
  try {
    await channelsStore.fetchChannels(props.room.id);
    channelsStore.connectVoicePresence(props.room.id);
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
  if (props.room && channel && channel.id) {
    navigateTo(`/room/${props.room.id}/${channel.id}`);
  }
}

async function handleCreateChannel() {
  try {
    const channelData = {
      name: newChannelName.value.trim(),
      desc: newChannelDesc.value.trim(),
      isMedia: newChannelType.value === "voice",

      audio_bitrate:
        newChannelType.value === "voice"
          ? Number(newChannelBitrate.value)
          : null,
    };

    await channelsStore.createChannel(props.room.id, channelData);
    closeCreateModal();
  } catch (error) {
    console.error("Failed to create channel:", error);
  }
}

async function editChannel(channel) {
  editingChannel.value = { ...channel };
  editingChannelPolicy.value = { ...(channel.mediaPolicy || {}) };
  originalEditingChannelPolicy.value = { ...editingChannelPolicy.value };
  showEditChannel.value = true;
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
  showCreateChannel.value = false;
  newChannelName.value = "";
  newChannelDesc.value = "";
  newChannelType.value = "text";
  newChannelBitrate.value = 48;
}

function closeEditModal() {
  showEditChannel.value = false;
  editingChannel.value = null;
  editingChannelPolicy.value = {};
  originalEditingChannelPolicy.value = {};
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
  channelsStore.disconnectVoicePresence();
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

<style scoped>
.group:hover .group-hover\:opacity-100 {
  opacity: 1;
}
</style>
