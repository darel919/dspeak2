<template>
  <aside
    aria-labelledby="broadcast-panel-title"
    class="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[32rem]"
    @keydown.esc="emit('close')"
  >
    <section
      class="pointer-events-auto flex max-h-[min(78dvh,48rem)] w-full flex-col overflow-hidden border border-base-content/15 bg-base-100 shadow-2xl"
    >
      <header
        class="flex items-center justify-between border-b border-base-content/10 px-5 py-4"
      >
        <div>
          <p
            class="text-[10px] font-bold uppercase tracking-[0.18em] text-primary"
          >
            Application audio
          </p>
          <h3 id="broadcast-panel-title" class="mt-1 text-lg font-bold">
            DJ Mode
          </h3>
        </div>
        <button
          type="button"
          class="metro-icon-btn metro-icon-btn--ghost btn-sm"
          aria-label="Close DJ Mode panel"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="size-4" />
        </button>
      </header>

      <div class="overflow-y-auto p-5">
        <div v-if="!djSession" class="space-y-5">
          <div
            class="grid grid-cols-[auto_1fr] gap-4 border-l-4 border-primary bg-primary/8 p-4"
          >
            <span class="grid size-11 place-items-center bg-primary text-black">
              <Icon name="lucide:radio-tower" class="size-5" />
            </span>
            <div>
              <p class="font-bold">Broadcast from VLC or OBS</p>
              <p class="mt-1 text-xs leading-relaxed text-base-content/65">
                Keep playback and playlists in your media application. dSpeak
                receives its SRT output and relays it to this voice channel.
              </p>
            </div>
          </div>

          <ol class="space-y-3 text-sm">
            <li class="flex gap-3">
              <span class="font-bold text-primary">01</span>
              <span>Prepare secure connection details for this channel.</span>
            </li>
            <li class="flex gap-3">
              <span class="font-bold text-primary">02</span>
              <span>Open VLC’s Stream wizard or OBS custom output.</span>
            </li>
            <li class="flex gap-3">
              <span class="font-bold text-primary">03</span>
              <span
                >Choose SRT and paste one of the supplied destinations.</span
              >
            </li>
          </ol>

          <p v-if="broadcastError" class="bg-error/10 p-3 text-xs text-error">
            {{ broadcastError }}
          </p>
        </div>

        <div v-else class="space-y-4">
          <div
            class="flex items-center gap-3 border border-base-content/10 bg-base-200/50 px-4 py-3"
            aria-live="polite"
          >
            <span
              v-if="status === 'connecting'"
              class="metro-spinner metro-spinner--xs text-warning"
            ></span>
            <span
              v-else
              class="size-2"
              :class="status === 'live' ? 'bg-success' : 'bg-warning'"
            ></span>
            <div>
              <p class="text-sm font-bold">{{ statusLabel }}</p>
              <p class="text-[11px] text-base-content/55">
                {{
                  status === "live"
                    ? "Listeners can now hear this application."
                    : "Start streaming from VLC or OBS."
                }}
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <p
              class="text-[10px] font-bold uppercase tracking-wider text-base-content/55"
            >
              Preferred · direct IPv6
            </p>
            <div
              class="grid grid-cols-[1fr_auto] border border-base-content/15 bg-black text-white"
            >
              <code class="overflow-x-auto p-3 text-[11px]">{{
                djSession.directUrl
              }}</code>
              <button
                type="button"
                class="metro-icon-btn metro-icon-btn--ghost rounded-none"
                aria-label="Copy direct SRT destination"
                @click="copyUrl(djSession.directUrl, 'direct')"
              >
                <Icon
                  :name="copied === 'direct' ? 'lucide:check' : 'lucide:copy'"
                />
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <p
              class="text-[10px] font-bold uppercase tracking-wider text-base-content/55"
            >
              Fallback · IPv4 through relay
            </p>
            <div
              class="grid grid-cols-[1fr_auto] border border-base-content/15 bg-black text-white"
            >
              <code class="overflow-x-auto p-3 text-[11px]">{{
                djSession.fallbackUrl
              }}</code>
              <button
                type="button"
                class="metro-icon-btn metro-icon-btn--ghost rounded-none"
                aria-label="Copy fallback SRT destination"
                @click="copyUrl(djSession.fallbackUrl, 'fallback')"
              >
                <Icon
                  :name="copied === 'fallback' ? 'lucide:check' : 'lucide:copy'"
                />
              </button>
            </div>
          </div>

          <div class="border-l-2 border-warning bg-warning/10 p-3">
            <p class="text-xs leading-relaxed">
              These URLs contain a temporary publishing credential. Do not share
              them. If direct IPv6 cannot connect, use the IPv4 fallback.
            </p>
          </div>

          <p v-if="djSession.error" class="bg-error/10 p-3 text-xs text-error">
            {{ djSession.error }}
          </p>
        </div>
      </div>

      <footer
        class="flex items-center justify-end gap-2 border-t border-base-content/10 px-5 py-4"
      >
        <button
          v-if="!djSession"
          type="button"
          class="metro-btn metro-btn--sm"
          :disabled="connecting"
          @click.stop="startBroadcast()"
        >
          <span
            v-if="connecting"
            class="metro-spinner metro-spinner--xs"
          ></span>
          <Icon v-else name="lucide:plug-zap" class="size-4" />
          Prepare VLC connection
        </button>
        <button
          v-else
          type="button"
          class="metro-btn metro-btn--error metro-btn--sm"
          @click="stopBroadcast"
        >
          <Icon name="lucide:square" class="size-4" />
          End DJ session
        </button>
      </footer>
    </section>
  </aside>
</template>

<script setup>
import { computed, ref } from "vue";
import { useVoiceStore } from "../stores/voice";

const emit = defineEmits(["close"]);
const voiceStore = useVoiceStore();
const connecting = ref(false);
const broadcastError = ref(null);
const copied = ref(null);
const djSession = computed(() => voiceStore.djSession);
const status = computed(() => djSession.value?.status || "idle");
const statusLabel = computed(() => {
  if (status.value === "live") return "Broadcasting live";
  if (status.value === "connecting") return "Connecting media";
  if (status.value === "recovering") return "Publisher disconnected";
  return "Waiting for publisher";
});

async function startBroadcast() {
  connecting.value = true;
  broadcastError.value = null;
  try {
    await voiceStore.startBroadcast();
  } catch (error) {
    broadcastError.value =
      error?.data?.statusMessage ||
      error?.message ||
      "DJ Mode could not prepare a connection";
  } finally {
    connecting.value = false;
  }
}

async function stopBroadcast() {
  broadcastError.value = null;
  try {
    await voiceStore.stopBroadcast();
  } catch (error) {
    broadcastError.value =
      error?.data?.statusMessage ||
      error?.message ||
      "The DJ session could not be stopped";
  }
}

async function copyUrl(url, target) {
  await navigator.clipboard.writeText(url);
  copied.value = target;
  setTimeout(() => {
    if (copied.value === target) copied.value = null;
  }, 1500);
}
</script>
