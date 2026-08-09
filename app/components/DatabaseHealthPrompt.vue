<template>
  <Transition name="database-health">
    <aside
      v-if="issue && !issue.recovered"
      class="fixed inset-x-4 bottom-4 z-[110] mx-auto max-w-2xl"
      aria-live="assertive"
      aria-label="Local storage problem"
    >
      <div
        class="metro-status metro-flyout bg-base-100"
        :class="issue.severity === 'fatal' ? 'alert-error' : 'alert-warning'"
      >
        <Icon :name="issueIcon" class="h-6 w-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">{{ issueTitle }}</h2>
          <p class="text-sm">{{ issueDescription }}</p>
          <p v-if="storageSummary" class="mt-1 text-xs opacity-70">
            {{ storageSummary }}
          </p>
          <p v-if="diagnosticSummary" class="mt-1 text-xs text-base-content/65">
            {{ diagnosticSummary }}
          </p>
          <p v-if="resetConfirmation" class="mt-2 text-xs font-semibold">
            Resetting removes saved rooms, cached messages, and messages waiting
            to send from this browser.
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            v-if="issue.canReset"
            class="metro-btn metro-btn--sm"
            :class="resetConfirmation ? 'metro-btn--error' : 'metro-btn--ghost'"
            :disabled="working"
            @click="handleReset"
          >
            {{ resetConfirmation ? "Confirm reset" : "Reset local data" }}
          </button>
          <button
            v-if="issue.severity !== 'fatal'"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            :disabled="working"
            @click="dismiss"
          >
            Continue online
          </button>
          <button
            class="metro-btn metro-btn--sm btn-primary"
            :disabled="working"
            @click="refresh"
          >
            <span v-if="working" class="metro-spinner metro-spinner--xs"></span>
            Refresh
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import {
  getBrowserStorageEstimate,
  getLastIdbHealthIssue,
  HEALTH_EVENT,
  probeLocalDatabases,
  resetLocalDatabases,
} from "../utils/idb";

const issue = ref(null);
const storageEstimate = ref(null);
const resetConfirmation = ref(false);
const working = ref(false);
let issueGeneration = 0;

const issueIcon = computed(() =>
  issue.value?.severity === "fatal" ? "lucide:database-zap" : "lucide:database",
);

const issueTitle = computed(() => {
  if (issue.value?.code === "quota-exceeded") return "Browser storage is full";
  if (issue.value?.code === "blocked") return "Local data is busy";
  if (issue.value?.code === "transaction-interrupted")
    return "Local data was interrupted";
  if (issue.value?.code === "invalid-data")
    return "Local data could not be saved";
  if (issue.value?.code === "unavailable")
    return "Local storage is unavailable";
  if (issue.value?.severity === "fatal") return "Local data needs repair";
  return "Local data operation failed";
});

const issueDescription = computed(() => {
  if (issue.value?.code === "quota-exceeded") {
    return "dSpeak will continue online, but offline messages and cached rooms may not be saved. Free browser storage, then refresh.";
  }
  if (issue.value?.code === "blocked") {
    return "Close other dSpeak tabs, then refresh this page to retry safely.";
  }
  if (issue.value?.code === "transaction-interrupted") {
    return "A temporary browser database operation failed. dSpeak is checking whether local data has already recovered.";
  }
  if (issue.value?.code === "invalid-data") {
    return "dSpeak rejected an invalid local record. Online messaging can continue, but this item was not cached.";
  }
  if (issue.value?.code === "unavailable") {
    return "This browser did not provide IndexedDB. dSpeak will continue online where possible.";
  }
  if (issue.value?.severity === "fatal") {
    return "Refresh to retry. If the problem returns, reset only dSpeak’s local browser data.";
  }
  return "dSpeak will continue online where possible. Refresh to try local storage again.";
});

const diagnosticSummary = computed(() => {
  if (!issue.value) return "";
  return [issue.value.errorName, issue.value.database, issue.value.operation]
    .filter(Boolean)
    .join(" · ");
});

const storageSummary = computed(() => {
  const usage = storageEstimate.value?.usage;
  const quota = storageEstimate.value?.quota;
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0)
    return "";
  return `${formatBytes(usage)} of ${formatBytes(quota)} browser storage used`;
});

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function receiveIssue(nextIssue) {
  if (!nextIssue || nextIssue.source !== "indexeddb") return;
  const generation = ++issueGeneration;
  if (nextIssue.recovered) {
    if (
      issue.value?.database === nextIssue.database &&
      issue.value?.operation === nextIssue.operation
    ) {
      issue.value = null;
    }
    return;
  }
  if (nextIssue.severity !== "fatal") {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await probeLocalDatabases();
      if (generation === issueGeneration) issue.value = null;
      return;
    } catch {
      if (generation !== issueGeneration) return;
    }
  }
  issue.value = nextIssue;
  resetConfirmation.value = false;
  try {
    storageEstimate.value = await getBrowserStorageEstimate();
  } catch (error) {
    console.warn("[IndexedDB] Unable to read browser storage estimate:", error);
  }
}

function handleHealthEvent(event) {
  receiveIssue(event.detail);
}

function handleWorkerMessage(event) {
  if (event.data?.type === "IDB_HEALTH") receiveIssue(event.data.issue);
}

function refresh() {
  working.value = true;
  window.location.reload();
}

function dismiss() {
  issue.value = null;
  resetConfirmation.value = false;
}

async function handleReset() {
  if (!resetConfirmation.value) {
    resetConfirmation.value = true;
    return;
  }
  working.value = true;
  try {
    await resetLocalDatabases();
    window.location.reload();
  } catch (error) {
    working.value = false;
    resetConfirmation.value = false;
    console.error("[IndexedDB] Local data reset failed:", error);
  }
}

onMounted(() => {
  const lastIssue = getLastIdbHealthIssue();
  if (lastIssue) receiveIssue(lastIssue);
  window.addEventListener(HEALTH_EVENT, handleHealthEvent);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", handleWorkerMessage);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener(HEALTH_EVENT, handleHealthEvent);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.removeEventListener("message", handleWorkerMessage);
  }
});
</script>

<style scoped>
.database-health-enter-active,
.database-health-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.database-health-enter-from,
.database-health-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
