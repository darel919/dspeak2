<template>
  <div
    v-if="voiceStore.connected"
    class="flex items-center gap-2 px-3 py-1 bg-success/10 rounded-lg"
  >
    <Icon name="lucide:mic" class="w-4 h-4 text-success" />
    <span class="text-sm text-success font-medium">{{ connectionLabel }}</span>
    <button
      v-if="playbackBlocked"
      type="button"
      class="btn btn-xs btn-warning"
      @click="retryPlayback"
    >
      Enable audio
    </button>

    <div class="flex items-center gap-2 ml-2">
      <!-- Live participants preview -->
      <div class="flex items-center gap-2">
        <div class="flex items-center -space-x-1">
          <template
            v-for="(u, idx) in voiceStore.getDisplayUsersArray()"
            :key="u.id || idx"
          >
            <div
              v-if="u"
              :class="[
                'w-6 h-6 rounded-full overflow-hidden border-2 flex items-center justify-center text-xs',
                voiceStore.getDisplayUsersArray().some((x) => x && x.speaking)
                  ? u.speaking
                    ? 'ring-2 ring-success'
                    : 'border-base-100'
                  : idx === 0
                    ? 'ring-2 ring-success'
                    : 'border-base-100',
              ]"
              :title="identityStore.displayName(u)"
            >
              <img
                v-if="profileAssetUrl(u.avatar)"
                :src="profileAssetUrl(u.avatar)"
                :alt="identityStore.displayName(u)"
                class="w-full h-full object-cover"
              />
              <span v-else class="select-none">{{
                identityStore
                  .displayName(u)
                  .split(" ")
                  .map((s) => s[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)
              }}</span>
            </div>
          </template>
        </div>
        <span class="text-xs text-base-content/60">{{
          voiceStore.getDisplayUsersArray().length
        }}</span>
      </div>

      <MediaSettingsContextMenu kind="microphone">
        <button
          @click="voiceStore.toggleMic"
          :class="[
            'btn btn-xs btn-circle',
            voiceStore.micMuted ? 'btn-error' : 'btn-outline',
          ]"
          :title="voiceStore.micMuted ? 'Unmute' : 'Mute'"
        >
          <Icon
            name="lucide:mic"
            v-if="!voiceStore.micMuted"
            class="w-3 h-3 text-current"
          />
          <Icon name="lucide:mic-off" v-else class="w-3 h-3 text-white" />
        </button>
      </MediaSettingsContextMenu>

      <button
        @click="voiceStore.leaveVoiceChannel"
        class="btn btn-xs btn-circle btn-error"
        title="Disconnect"
      >
        <Icon name="lucide:volume-x" class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from "~/stores/voice";
import { useIdentityStore } from "~/stores/identity";
import { profileAssetUrl } from "~/shared/profile-assets";

const voiceStore = useVoiceStore();
const identityStore = useIdentityStore();
const connectionLabel = computed(() => {
  const state = voiceStore.sfuComposable?.mediaConnectionState;
  if (state === "media-flowing") return "Media flowing";
  if (state === "ready-no-active-media") return "Connected";
  if (state === "playback-blocked") return "Playback needs attention";
  if (state === "reconnecting") return "Media reconnecting";
  if (state === "recovering") return "Recovering media…";
  if (state === "transport-connecting") return "Transport connecting";
  return "Voice session ready";
});
const playbackBlocked = computed(
  () => voiceStore.sfuComposable?.mediaConnectionState === "playback-blocked",
);
async function retryPlayback() {
  await voiceStore.sfuComposable?.ensureAudioElements?.();
}
</script>
