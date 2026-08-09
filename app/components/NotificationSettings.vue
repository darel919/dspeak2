<template>
  <div class="space-y-6">
    <section class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>Message notifications</h2>
          <p>Your account defaults apply unless a room overrides them.</p>
        </div>
      </div>
      <label class="settings-row"
        ><span
          ><strong>Default mode</strong
          ><small
            >Choose which room messages create inbox notifications.</small
          ></span
        ><select v-model="draft.mode" class="metro-select" @change="save">
          <option value="all">All messages</option>
          <option value="mentions">Mentions only</option>
          <option value="muted">Muted</option>
        </select></label
      >
      <label class="settings-toggle-row"
        ><span
          ><strong>Notification sound</strong
          ><small
            >Play a sound for eligible foreground notifications.</small
          ></span
        ><input
          v-model="draft.sound"
          type="checkbox"
          class="metro-toggle"
          @change="save"
      /></label>
      <label class="settings-toggle-row"
        ><span
          ><strong>Message previews</strong
          ><small
            >Include message text in the inbox and push notification.</small
          ></span
        ><input
          v-model="draft.previews"
          type="checkbox"
          class="metro-toggle"
          @change="save"
      /></label>
    </section>

    <section class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>Background push</h2>
          <p>Push is optional; the dSpeak inbox remains the source of truth.</p>
        </div>
        <span class="text-xs" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <div class="flex flex-wrap gap-2 p-5">
        <button
          v-if="!store.isSubscribed"
          class="metro-btn"
          :disabled="store.loading || !store.pushSupported"
          @click="enablePush"
        >
          Enable push
        </button>
        <button
          v-else
          class="metro-btn metro-btn--error"
          :disabled="store.loading"
          @click="disablePush"
        >
          Disable push
        </button>
        <button
          class="metro-btn metro-btn--secondary"
          :disabled="store.permission !== 'granted'"
          @click="testPush"
        >
          Send test
        </button>
      </div>
      <p
        v-if="store.permission === 'denied'"
        class="border-t border-base-300 p-4 text-sm text-error"
      >
        Notifications are blocked in this browser’s site settings.
      </p>
    </section>

    <section class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>Stream attenuation override</h2>
          <p>
            Choose whether room defaults reduce shared stream audio while people
            speak.
          </p>
        </div>
      </div>
      <label class="settings-row"
        ><span><strong>Behavior</strong></span
        ><select
          v-model="attenuation.mode"
          class="metro-select"
          @change="saveAttenuation"
        >
          <option value="room">Use room default</option>
          <option value="enabled">Always enabled</option>
          <option value="disabled">Always disabled</option>
        </select></label
      >
      <label v-if="attenuation.mode === 'enabled'" class="settings-row"
        ><span
          ><strong>Reduction</strong
          ><small>{{ attenuation.reductionPercent }}%</small></span
        ><input
          v-model.number="attenuation.reductionPercent"
          type="range"
          min="0"
          max="100"
          class="metro-range max-w-xs"
          @change="saveAttenuation"
      /></label>
    </section>
  </div>
</template>

<script setup>
import { useNotificationsStore } from "../stores/notifications";
import { useSettingsStore } from "../stores/settings";
import { useToast } from "../composables/useToast";

const store = useNotificationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();
const draft = reactive({ mode: "all", sound: true, previews: true });
const attenuation = reactive({ ...settingsStore.streamAttenuation });
const statusLabel = computed(() =>
  store.isSubscribed
    ? "Push active"
    : store.permission === "denied"
      ? "Blocked"
      : "Push off",
);
const statusClass = computed(() =>
  store.isSubscribed
    ? "text-success"
    : store.permission === "denied"
      ? "text-error"
      : "text-base-content/60",
);

watch(
  () => store.preferences,
  (value) => Object.assign(draft, value),
  { immediate: true, deep: true },
);

async function save() {
  try {
    await store.savePreferences(draft);
    toast.success("Notification settings saved");
  } catch (cause) {
    toast.error(cause.message);
  }
}
async function enablePush() {
  try {
    await store.subscribe();
    draft.push = true;
    await store.savePreferences(draft);
    toast.success("Push notifications enabled");
  } catch (cause) {
    toast.error(cause.message);
  }
}
async function disablePush() {
  try {
    await store.unsubscribe();
    draft.push = false;
    await store.savePreferences(draft);
    toast.info("Push notifications disabled");
  } catch (cause) {
    toast.error(cause.message);
  }
}
async function testPush() {
  try {
    await store.sendPushTest();
    toast.success("Push test sent. It should arrive through your browser.");
  } catch (cause) {
    toast.error(cause.message);
  }
}
async function saveAttenuation() {
  settingsStore.setStreamAttenuation(attenuation);
  try {
    await store.savePreferences({ attenuationOverride: attenuation });
  } catch (cause) {
    toast.error(cause.message);
  }
}
</script>
