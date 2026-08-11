<template>
  <div class="space-y-4">
    <div class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>Channel permissions</h2>
          <p>Control who can send messages in this channel.</p>
        </div>
      </div>

      <div class="divide-y divide-base-300">
        <label class="settings-row">
          <span class="settings-row-label">
            <Icon name="lucide:message-square" class="size-4" />
            Send permission
            <small class="mt-0.5 block text-xs text-base-content/60">
              {{ policyDescription }}
            </small>
          </span>
          <select
            class="metro-select w-full max-w-xs bg-base-100"
            :value="currentPolicy"
            :disabled="saving"
            @change="setPolicy($event.target.value)"
          >
            <option
              v-for="opt in policyOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-row-label">
            <Icon name="lucide:clock" class="size-4" />
            Slow mode
            <small class="mt-0.5 block text-xs text-base-content/60">
              {{ slowModeDescription }}
            </small>
          </span>
          <select
            class="metro-select w-full max-w-xs bg-base-100"
            :value="currentSlowMode"
            :disabled="saving"
            @change="setSlowMode(Number($event.target.value))"
          >
            <option
              v-for="opt in SLOW_MODE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>
      </div>

      <div
        v-if="message"
        class="border-t border-base-300 px-5 py-3 text-xs"
        :class="error ? 'text-error' : 'text-success'"
        role="status"
      >
        {{ message }}
      </div>

      <div
        class="flex items-center justify-end gap-3 border-t border-base-300 bg-base-200/25 px-5 py-3"
      >
        <button
          class="metro-btn metro-btn--sm"
          :disabled="saving"
          @click="save"
        >
          <span v-if="saving" class="metro-spinner metro-spinner--xs"></span>
          <span v-else>Save</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChannelsStore } from "../stores/channels";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
  CHANNEL_POLICY_LABELS,
  SLOW_MODE_OPTIONS,
} from "~~/shared/channel-policy.ts";

const props = defineProps({
  channelId: {
    type: String,
    required: true,
  },
});

const channelsStore = useChannelsStore();
const currentPolicy = ref("free");
const currentSlowMode = ref(0);
const saving = ref(false);
const error = ref(false);
const message = ref("");

const policyOptions = computed(() =>
  Object.entries(CHANNEL_POLICY_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
);

const policyDescription = computed(() => {
  const desc = {
    free: "Everyone with access can send and read messages.",
    send_restricted: "Only members with send permission can send messages.",
    read_only: "All members can only read messages.",
    moderator_only: "Only moderators and above can send messages.",
  };
  return desc[currentPolicy.value] || "";
});

const slowModeDescription = computed(() => {
  if (currentSlowMode.value <= 0) return "No cooldown between messages.";
  return `Members must wait ${currentSlowMode.value} seconds between messages.`;
});

onMounted(async () => {
  try {
    const channel = channelsStore.getChannelById(props.channelId);
    if (channel) {
      currentPolicy.value = normalizeChannelPolicy(channel.policy);
      currentSlowMode.value = normalizeSlowMode(channel.slow_mode);
    }
  } catch {}
});

function setPolicy(value) {
  currentPolicy.value = normalizeChannelPolicy(value);
  message.value = "";
}

function setSlowMode(value) {
  currentSlowMode.value = normalizeSlowMode(value);
  message.value = "";
}

async function save() {
  saving.value = true;
  error.value = false;
  message.value = "";

  try {
    await channelsStore.updateChannelPolicy(props.channelId, {
      policy: currentPolicy.value,
      slowMode: currentSlowMode.value,
    });
    message.value = "Channel permissions updated.";
  } catch (cause) {
    error.value = true;
    message.value = cause.message || "Failed to update channel permissions.";
  } finally {
    saving.value = false;
  }
}
</script>
