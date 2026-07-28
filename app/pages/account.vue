<template>
  <section class="min-h-screen-minus-navbar bg-base-100 px-6 py-12 lg:px-14">
    <div class="mx-auto max-w-5xl">
      <p
        class="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary"
      >
        dSpeak
      </p>
      <h1 class="metro-title">Account</h1>
      <div class="mt-10 grid border-y border-base-300 lg:grid-cols-[16rem_1fr]">
        <div class="bg-base-200/45 p-6">
          <h2 class="text-2xl font-light">Profile</h2>
          <p class="mt-2 text-sm leading-6 text-base-content/60">
            Your identity across every room.
          </p>
        </div>
        <div
          v-if="profile"
          class="flex flex-col gap-6 p-6 sm:flex-row sm:items-center"
        >
          <div class="avatar avatar-online select-none pointer-events-none">
            <div class="w-20">
              <img :src="profile.avatar" alt="" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-2xl font-light">
              {{ profile.display_name || profile.name }}
            </p>
            <p class="text-sm text-base-content/60">{{ profile.email }}</p>
          </div>
          <button class="btn btn-error btn-outline" @click="handleLogout">
            <Icon name="lucide:log-out" class="size-4" />Log out
          </button>
        </div>
        <div v-else class="border-l-4 border-error p-6 text-error">
          No profile data available.
        </div>

        <div class="bg-base-200/45 p-6">
          <h2 class="text-2xl font-light">Data & Privacy</h2>
          <p class="mt-2 text-sm leading-6 text-base-content/60">
            Export your data or delete and anonymize your account.
          </p>
        </div>
        <div class="flex flex-col gap-6 p-6">
          <div
            class="flex flex-col gap-4 border-t border-base-300 pt-6 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h3 class="text-lg font-medium">Export your data</h3>
              <p class="mt-1 text-sm text-base-content/60">
                Download a JSON file containing your profile, messages, rooms,
                settings, and all associated data.
              </p>
            </div>
            <button
              class="btn btn-primary"
              :disabled="exporting"
              :aria-busy="exporting"
              @click="handleExport"
            >
              <span
                v-if="exporting"
                class="loading loading-spinner loading-sm"
              />
              <span v-else>
                <Icon name="lucide:download" class="size-4 mr-2" />Export data
              </span>
            </button>
          </div>

          <div
            class="flex flex-col gap-4 border-t border-base-300 pt-6 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h3 class="text-lg font-medium text-error">
                Delete your account
              </h3>
              <p class="mt-1 text-sm text-base-content/60">
                Deactivate your profile, remove your account data, and anonymize
                messages that remain in shared rooms.
              </p>
            </div>
            <button
              class="btn btn-error"
              :disabled="deleting"
              :aria-busy="deleting"
              @click="confirmDelete = true"
            >
              <span
                v-if="deleting"
                class="loading loading-spinner loading-sm"
              />
              <span v-else>
                <Icon name="lucide:trash-2" class="size-4 mr-2" />Delete account
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="confirmDelete"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="confirmDelete = false"
    >
      <div
        ref="deleteDialog"
        class="w-full max-w-md rounded-box bg-base-100 p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        tabindex="-1"
        @keydown.esc.stop="confirmDelete = false"
      >
        <h2 id="delete-account-title" class="text-2xl font-semibold text-error">
          Delete your account?
        </h2>
        <p class="mt-3 text-base-content/70">
          This will deactivate your profile, remove your settings and personal
          records, and anonymize messages you sent in rooms that remain. You
          cannot undo this action.
        </p>
        <div class="mt-6 flex gap-3 justify-end">
          <button class="btn btn-ghost" @click="confirmDelete = false">
            Cancel
          </button>
          <button
            class="btn btn-error"
            :disabled="deleting"
            :aria-busy="deleting"
            @click="handleDelete"
          >
            <span v-if="deleting" class="loading loading-spinner loading-sm" />
            <span v-else>Yes, delete my account</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";
import { useRuntimeConfig } from "#app";
import { useChatUtils } from "../composables/useChatUtils";

const authStore = useAuthStore();
const router = useRouter();
const config = useRuntimeConfig();
const { getAvatarUrl } = useChatUtils();
const toast = useToast();

const profile = computed(() => {
  const user = authStore.getUserData();
  if (!user) return null;

  return {
    ...user,
    avatar: getAvatarUrl(user.avatar),
  };
});

const exporting = ref(false);
const deleting = ref(false);
const confirmDelete = ref(false);
const deleteDialog = ref(null);

watch(confirmDelete, async (visible) => {
  if (!visible) return;
  await nextTick();
  deleteDialog.value?.focus();
});

async function handleLogout() {
  await authStore.clearAuth();
  await nextTick();
  await router.push("/");
}

async function handleExport() {
  exporting.value = true;
  try {
    const response = await fetch(`${config.public.apiPath}/account/export`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dspeak-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    toast.error("Failed to export data. Please try again.");
  } finally {
    exporting.value = false;
  }
}

async function handleDelete() {
  deleting.value = true;
  try {
    const response = await fetch(`${config.public.apiPath}/account/delete`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Deletion failed");
    confirmDelete.value = false;
    await authStore.clearAuth();
    await router.push("/");
  } catch {
    toast.error("Failed to delete account. Please try again.");
  } finally {
    deleting.value = false;
  }
}
</script>
