<template>
  <div
    v-if="visible"
    class="fixed bottom-24 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2"
    role="status"
    aria-live="polite"
  >
    <div
      class="flex items-center gap-3 border-l-4 border-success bg-base-200 px-4 py-3"
    >
      <Icon name="lucide:check-circle" class="h-5 w-5 text-success" />
      <span class="min-w-0 flex-1 text-sm font-semibold">Message sent</span>
      <button
        class="btn btn-primary min-h-11"
        :disabled="actionPending"
        @click="handleUndo"
      >
        {{ actionPending ? "Undoing" : "Undo" }}
      </button>
      <span class="min-w-7 text-right text-sm font-bold" aria-hidden="true">
        {{ remainingSeconds }}s
      </span>
    </div>
    <p
      v-if="undoError"
      class="border-l-4 border-error bg-error/10 px-4 py-3 text-sm text-error"
      role="alert"
    >
      {{ undoError }}
    </p>
  </div>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  messageId: {
    type: String,
    default: "",
  },
  expiresAt: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["undo", "expired"]);

const chatStore = useChatStore();
const actionPending = ref(false);
const remainingSeconds = ref(3);
const undoError = ref("");
let countdownTimer = null;
let expiryTimer = null;

watch(
  () => [props.visible, props.messageId, props.expiresAt],
  ([visible]) => {
    if (visible) {
      startCountdown();
    } else {
      clearTimers();
    }
  },
);

onUnmounted(() => {
  clearTimers();
});

function startCountdown() {
  clearTimers();
  undoError.value = "";
  const remainingMs = props.expiresAt - Date.now();
  if (remainingMs <= 0) {
    emit("expired");
    return;
  }
  remainingSeconds.value = Math.ceil(remainingMs / 1000);

  countdownTimer = setInterval(() => {
    remainingSeconds.value = Math.max(
      0,
      Math.ceil((props.expiresAt - Date.now()) / 1000),
    );
  }, 100);

  expiryTimer = setTimeout(() => {
    clearTimers();
    emit("expired");
  }, remainingMs);
}

function clearTimers() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

async function handleUndo() {
  if (!props.messageId || actionPending.value) return;
  actionPending.value = true;
  try {
    await chatStore.undoMessage(props.messageId);
    clearTimers();
    emit("undo");
  } catch (error) {
    undoError.value = error?.message || "Could not undo this message";
  } finally {
    actionPending.value = false;
  }
}
</script>
