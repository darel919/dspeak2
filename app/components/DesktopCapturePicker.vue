<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[160] grid place-items-center bg-black/75 p-4"
      @click.self="close"
    >
      <section
        class="flex max-h-[min(86dvh,52rem)] w-full max-w-4xl flex-col overflow-hidden border-t-4 border-primary bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-capture-picker-title"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-base-content/10 px-6 py-5"
        >
          <div>
            <p
              class="text-[10px] font-bold uppercase tracking-[0.2em] text-primary"
            >
              Metro capture
            </p>
            <h2
              id="desktop-capture-picker-title"
              class="mt-1 text-2xl font-light"
            >
              Choose what to share
            </h2>
            <p class="mt-2 max-w-2xl text-sm text-base-content/60">
              Select an app, window, display, or system audio. dSpeak audio is
              always excluded to prevent feedback loops.
            </p>
          </div>
          <button
            type="button"
            class="metro-icon-btn metro-icon-btn--ghost btn-sm"
            aria-label="Close capture picker"
            @click="close"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </header>

        <div
          ref="dialogContent"
          class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6"
          aria-live="polite"
          tabindex="-1"
          @keydown="onDialogKeydown"
        >
          <div
            v-if="loading"
            class="grid min-h-64 place-items-center border border-base-content/10 bg-base-200/30"
          >
            <div class="text-center">
              <span class="metro-spinner metro-spinner--md text-primary"></span>
              <p class="mt-3 text-sm text-base-content/60">
                Finding available sources…
              </p>
            </div>
          </div>

          <div
            v-else-if="failure"
            class="border-l-4 border-error bg-error/10 p-5"
          >
            <div class="flex items-start gap-3">
              <Icon
                name="lucide:triangle-alert"
                class="mt-0.5 size-5 text-error"
              />
              <div>
                <h3 class="font-bold">Desktop capture is unavailable</h3>
                <p class="mt-1 text-sm text-base-content/65">{{ failure }}</p>
                <button
                  type="button"
                  class="metro-btn metro-btn--sm mt-4"
                  @click="useBrowserFallback"
                >
                  Use browser capture instead
                </button>
              </div>
            </div>
          </div>

          <div
            v-else-if="!sources.length"
            class="grid min-h-64 place-items-center border border-base-content/10 bg-base-200/30 p-6 text-center"
          >
            <div>
              <Icon
                name="lucide:monitor-off"
                class="mx-auto size-10 text-base-content/40"
              />
              <h3 class="mt-3 font-bold">No shareable sources found</h3>
              <p class="mt-1 text-sm text-base-content/60">
                Check Screen Recording and system-audio permissions, then try
                again.
              </p>
              <button
                type="button"
                class="metro-btn metro-btn--ghost btn-sm mt-4"
                @click="loadSources"
              >
                Refresh sources
              </button>
            </div>
          </div>

          <template v-else>
            <nav class="flex flex-wrap gap-2" aria-label="Capture source type">
              <button
                v-for="tab in visibleTabs"
                :key="tab.value"
                type="button"
                class="metro-btn metro-btn--sm"
                :class="
                  filter === tab.value
                    ? 'metro-btn--secondary'
                    : 'metro-btn--ghost'
                "
                @click="filter = tab.value"
              >
                <Icon :name="tab.icon" class="size-4" />
                {{ tab.label }}
              </button>
            </nav>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                v-for="source in filteredSources"
                :key="source.sourceKey"
                type="button"
                class="group overflow-hidden border text-left transition"
                :class="
                  selectedSource?.sourceKey === source.sourceKey
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-base-content/15 hover:border-primary/60'
                "
                @click="selectedSource = source"
              >
                <div class="relative aspect-video overflow-hidden bg-base-300">
                  <img
                    v-if="source.thumbnail"
                    :src="source.thumbnail"
                    :alt="`${source.title} preview`"
                    class="size-full object-cover"
                  />
                  <div
                    v-else
                    class="grid size-full place-items-center bg-gradient-to-br from-base-300 to-base-200"
                  >
                    <Icon
                      :name="sourceIcon(source)"
                      class="size-10 text-base-content/35"
                    />
                  </div>
                  <span
                    v-if="selectedSource?.sourceKey === source.sourceKey"
                    class="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-primary text-primary-content"
                  >
                    <Icon name="lucide:check" class="size-4" />
                  </span>
                </div>
                <div class="p-3">
                  <p class="truncate font-semibold">{{ source.title }}</p>
                  <p class="mt-1 truncate text-xs text-base-content/55">
                    {{ source.appName || sourceTypeLabel(source.sourceType) }}
                  </p>
                  <div
                    class="mt-3 flex gap-2 text-[10px] font-bold uppercase tracking-wider text-base-content/50"
                  >
                    <span
                      v-if="source.capabilities.video"
                      class="inline-flex items-center gap-1"
                      ><Icon name="lucide:video" class="size-3" /> Video</span
                    >
                    <span
                      v-if="source.capabilities.audio"
                      class="inline-flex items-center gap-1"
                    >
                      <Icon name="lucide:volume-2" class="size-3" />
                      {{
                        source.capabilities.stereo ? "Stereo audio" : "Audio"
                      }}
                    </span>
                  </div>
                </div>
              </button>
            </div>

            <div
              v-if="selectedSource"
              class="border-l-4 border-primary bg-primary/8 p-4"
            >
              <div
                class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p
                    class="text-[10px] font-bold uppercase tracking-wider text-primary"
                  >
                    Selected source
                  </p>
                  <p class="mt-1 font-bold">{{ selectedSource.title }}</p>
                  <p class="mt-1 text-xs text-base-content/60">
                    Audio capture requires verified 48 kHz stereo support and
                    dSpeak self-audio exclusion.
                  </p>
                </div>
                <div class="flex gap-0 shrink-0" aria-label="Share media">
                  <button
                    v-if="selectedSource.capabilities.video"
                    type="button"
                    class="metro-btn metro-btn--sm join-item"
                    :class="
                      mode === 'video'
                        ? 'metro-btn--secondary'
                        : 'metro-btn--ghost'
                    "
                    @click="mode = 'video'"
                  >
                    <Icon name="lucide:video" class="size-4" /> Video
                  </button>
                  <button
                    v-if="selectedSource.capabilities.audio"
                    type="button"
                    class="metro-btn metro-btn--sm join-item"
                    :class="
                      mode === 'audio'
                        ? 'metro-btn--secondary'
                        : 'metro-btn--ghost'
                    "
                    @click="mode = 'audio'"
                  >
                    <Icon name="lucide:volume-2" class="size-4" /> Audio
                  </button>
                  <button
                    v-if="
                      selectedSource.capabilities.video &&
                      selectedSource.capabilities.audio
                    "
                    type="button"
                    class="metro-btn metro-btn--sm join-item"
                    :class="
                      mode === 'both'
                        ? 'metro-btn--secondary'
                        : 'metro-btn--ghost'
                    "
                    @click="mode = 'both'"
                  >
                    <Icon name="lucide:layers-2" class="size-4" /> Both
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t border-base-content/10 px-6 py-4"
        >
          <p class="text-xs text-base-content/50">
            Low-latency native capture · verified stereo audio · self-audio
            excluded
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="metro-btn metro-btn--ghost"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="button"
              class="metro-btn"
              :disabled="!selectedSource || !mode || loading"
              @click="select"
            >
              <Icon name="lucide:radio-tower" class="size-4" />
              Start sharing
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  createDesktopCaptureSelection,
  getNativeCaptureCapability,
  getDesktopCaptureApi,
  normalizeCaptureSources,
} from "../shared/desktop-capture";

const props = defineProps({
  open: { type: Boolean, default: false },
  audioOnly: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "select", "fallback"]);
const sources = ref([]);
const selectedSource = ref(null);
const dialogContent = ref(null);
const filter = ref("all");
const mode = ref("both");
const loading = ref(false);
const failure = ref("");
const tabs = [
  { value: "all", label: "Everything", icon: "lucide:layout-grid" },
  { value: "application", label: "Apps", icon: "lucide:app-window" },
  { value: "window", label: "Windows", icon: "lucide:panel-top" },
  { value: "display", label: "Displays", icon: "lucide:monitor" },
  { value: "system-audio", label: "System audio", icon: "lucide:volume-2" },
];
const filteredSources = computed(() =>
  (filter.value === "all"
    ? sources.value
    : sources.value.filter((source) => source.sourceType === filter.value)
  ).filter((source) => props.audioOnly || source.sourceType !== "system-audio"),
);
const visibleTabs = computed(() =>
  props.audioOnly
    ? tabs.filter((tab) => tab.value === "system-audio")
    : tabs.filter((tab) => tab.value !== "system-audio"),
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      filter.value = props.audioOnly ? "system-audio" : "all";
      mode.value = props.audioOnly ? "audio" : "both";
      nextTick(() => dialogContent.value?.focus());
      loadSources();
    } else {
      selectedSource.value = null;
    }
  },
);

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onUnmounted(() => window.removeEventListener("keydown", onWindowKeydown));

async function loadSources() {
  loading.value = true;
  failure.value = "";
  selectedSource.value = null;
  try {
    const api = await getDesktopCaptureApi();
    if (!api)
      throw new Error("This capture picker is available in desktop mode only.");
    const capabilities = await api.invoke("media_get_capabilities");
    const captureCapability = getNativeCaptureCapability(
      capabilities,
      props.audioOnly ? "audio" : "video",
    );
    if (
      capabilities?.nativeRtc !== true ||
      capabilities?.nativeBackendReady !== true
    ) {
      throw new Error(captureCapability.reason);
    }
    const listedSources = normalizeCaptureSources(
      await api.invoke("media_list_capture_sources"),
    );
    sources.value = listedSources.filter((source) =>
      props.audioOnly ? source.capabilities.audio : source.capabilities.video,
    );
    const first = filteredSources.value[0];
    if (first)
      mode.value =
        first.capabilities.video && first.capabilities.audio
          ? "both"
          : first.capabilities.video
            ? "video"
            : "audio";
  } catch (error) {
    failure.value =
      error?.message || "Unable to enumerate desktop capture sources.";
  } finally {
    loading.value = false;
  }
}

function onWindowKeydown(event) {
  if (props.open && event.key === "Escape") close();
}

function onDialogKeydown(event) {
  if (event.key !== "Tab") return;
  const focusable = dialogContent.value?.querySelectorAll(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])",
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function sourceIcon(source) {
  if (source.sourceType === "application") return "lucide:app-window";
  if (source.sourceType === "window") return "lucide:panel-top";
  if (source.sourceType === "system-audio") return "lucide:volume-2";
  return "lucide:monitor";
}

function sourceTypeLabel(type) {
  return tabs.find((tab) => tab.value === type)?.label || "Source";
}

function close() {
  emit("close");
}

function useBrowserFallback() {
  emit("fallback");
}

function select() {
  if (!selectedSource.value) return;
  try {
    emit(
      "select",
      createDesktopCaptureSelection(selectedSource.value, mode.value),
    );
  } catch (error) {
    failure.value = error.message;
  }
}
</script>
