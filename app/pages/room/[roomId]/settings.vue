<template>
  <section class="min-h-screen-minus-navbar bg-base-100 p-4 sm:p-8">
    <div class="mx-auto max-w-6xl">
      <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="mb-2 text-sm uppercase tracking-[0.2em] text-primary">
            Room administration
          </p>
          <h1 class="metro-title">{{ room?.name || "Room" }}</h1>
        </div>
        <NuxtLink :to="`/room/${roomId}`" class="btn btn-ghost">
          <Icon name="lucide:arrow-left" class="size-4" />Back to room
        </NuxtLink>
      </header>

      <div v-if="loading" class="loading loading-spinner loading-lg"></div>
      <div v-else-if="error" class="alert alert-error">{{ error }}</div>
      <div v-else class="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          class="grid content-start gap-1 border-b border-base-300 pb-5 lg:border-b-0 lg:pb-0"
          aria-label="Room settings"
        >
          <button
            v-for="item in sections"
            :key="item.id"
            v-show="
              (item.id !== 'soundboard' ||
                hasPermission('room.manage_soundboard')) &&
              (item.id !== 'audit' || canViewAudit)
            "
            class="metro-transition flex items-center gap-3 px-4 py-3 text-left"
            :class="
              activeSection === item.id ? 'metro-selected' : 'hover:bg-base-200'
            "
            @click="activeSection = item.id"
          >
            <Icon :name="item.icon" class="size-5" />{{ item.label }}
          </button>
        </nav>

        <main class="min-w-0 lg:border-l lg:border-base-300 lg:pl-8 xl:pl-10">
          <form
            v-if="activeSection === 'branding'"
            class="space-y-6"
            @submit.prevent="saveBranding"
          >
            <h2 class="text-3xl font-light">Identity and color</h2>
            <label class="grid min-w-0 gap-2">
              <span class="font-medium">Room name</span>
              <input
                v-model="form.name"
                class="input input-bordered w-full"
                maxlength="80"
                required
              />
            </label>
            <label class="grid min-w-0 gap-2">
              <span class="font-medium">Description</span>
              <textarea
                v-model="form.desc"
                class="textarea textarea-bordered min-h-28 w-full"
                maxlength="500"
              ></textarea>
            </label>
            <div class="grid gap-5 sm:grid-cols-2">
              <label class="grid min-w-0 content-start gap-2">
                <span class="font-medium">Square room picture</span>
                <input
                  type="file"
                  class="file-input file-input-bordered w-full min-w-0"
                  accept="image/jpeg,image/png,image/webp"
                  @change="picture = $event.target.files[0]"
                />
                <span class="text-xs text-base-content/60"
                  >JPEG, PNG, or WebP up to 2 MB</span
                >
              </label>
              <label class="grid min-w-0 content-start gap-2">
                <span class="font-medium">Wide room header</span>
                <input
                  type="file"
                  class="file-input file-input-bordered w-full min-w-0"
                  accept="image/jpeg,image/png,image/webp"
                  @change="headerImage = $event.target.files[0]"
                />
                <span class="text-xs text-base-content/60">
                  1920 × 192 px (10:1) recommended. Keep important content
                  centered. JPEG, PNG, or WebP up to 5 MB.
                </span>
              </label>
            </div>
            <fieldset>
              <legend class="mb-3 font-medium">Room accent</legend>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <button
                  v-for="accent in ROOM_ACCENTS"
                  :key="accent"
                  type="button"
                  class="h-16 border-4 text-xs capitalize"
                  :class="
                    form.accent === accent
                      ? 'border-base-content'
                      : 'border-transparent'
                  "
                  :style="{ background: accentColor(accent), color: '#fff' }"
                  :disabled="savingAccent"
                  @click="saveAccent(accent)"
                >
                  {{ accent }}
                </button>
              </div>
            </fieldset>
            <button class="btn btn-primary" :disabled="saving">
              {{ saving ? "Saving…" : "Save room" }}
            </button>
          </form>

          <section
            v-else-if="activeSection === 'attenuation'"
            class="space-y-6"
          >
            <div>
              <h2 class="text-3xl font-light">Speech priority</h2>
              <p class="mt-2 max-w-2xl text-sm text-base-content/70">
                Make conversations easier to hear by temporarily lowering shared
                screen and system audio while someone speaks.
              </p>
            </div>
            <label
              class="flex items-center justify-between border-b border-base-300 py-4"
            >
              <span>
                <strong class="block">Make voices easier to hear</strong>
                <small>
                  Shared audio returns to normal when the conversation stops.
                </small>
              </span>
              <input
                v-model="form.attenuation.enabled"
                type="checkbox"
                class="toggle toggle-primary"
              />
            </label>
            <fieldset
              v-if="form.attenuation.enabled"
              class="grid min-w-0 gap-3"
            >
              <legend class="font-semibold">Shared audio during speech</legend>
              <p class="text-sm text-base-content/70">
                It will play at
                <strong>{{ sharedAudioDuringSpeech }}% volume</strong>.
              </p>
              <input
                v-model.number="form.attenuation.reductionPercent"
                type="range"
                min="0"
                max="100"
                class="range range-primary"
                aria-label="Shared audio volume while someone speaks"
                :aria-valuetext="`${sharedAudioDuringSpeech}% volume`"
              />
              <div
                class="flex justify-between text-xs text-base-content/60"
                aria-hidden="true"
              >
                <span>Full volume</span>
                <span>Muted</span>
              </div>
            </fieldset>
            <fieldset
              v-if="form.attenuation.enabled"
              class="grid min-w-0 gap-3"
            >
              <legend class="font-semibold">How should volume change?</legend>
              <p class="text-sm text-base-content/70">
                Choose whether shared audio moves out of the way quickly or
                changes more gradually.
              </p>
              <div class="grid gap-2 sm:grid-cols-3">
                <label
                  v-for="preset in attenuationTimingPresets"
                  :key="preset.id"
                  :class="[
                    'block min-h-24 cursor-pointer border p-4 transition-colors',
                    attenuationTimingPreset === preset.id
                      ? 'border-primary bg-primary text-primary-content'
                      : 'border-base-300 hover:border-base-content/40',
                  ]"
                >
                  <input
                    class="sr-only"
                    type="radio"
                    name="attenuation-timing"
                    :value="preset.id"
                    :checked="attenuationTimingPreset === preset.id"
                    @change="selectAttenuationTiming(preset)"
                  />
                  <strong class="block">{{ preset.label }}</strong>
                  <small class="mt-1 block">{{ preset.description }}</small>
                </label>
              </div>
              <p
                v-if="attenuationTimingPreset === 'custom'"
                class="text-sm text-base-content/70"
              >
                This room uses older custom timing. Choose a speed above to
                replace it with a simpler preset.
              </p>
            </fieldset>
            <div
              class="flex min-h-11 items-center gap-2 border-t border-base-300 pt-4 text-sm"
              role="status"
              aria-live="polite"
            >
              <Icon
                :name="
                  attenuationSaveState === 'error'
                    ? 'lucide:circle-alert'
                    : attenuationSaveState === 'saved'
                      ? 'lucide:check'
                      : 'lucide:loader-circle'
                "
                :class="[
                  'size-4',
                  attenuationSaveState === 'saving' ? 'animate-spin' : '',
                  attenuationSaveState === 'error' ? 'text-error' : '',
                ]"
              />
              <span>{{ attenuationSaveLabel }}</span>
              <button
                v-if="attenuationSaveState === 'error'"
                type="button"
                class="btn btn-ghost btn-sm"
                @click="queueAttenuationSave(0)"
              >
                Retry
              </button>
            </div>
          </section>

          <section v-else-if="activeSection === 'roles'" class="space-y-6">
            <div class="flex items-end justify-between gap-4">
              <div>
                <h2 class="text-3xl font-light">Roles</h2>
                <p class="text-sm text-base-content/60">
                  Permissions combine when a member has multiple roles.
                </p>
              </div>
              <button
                v-if="hasPermission('room.manage_roles')"
                type="button"
                class="btn btn-primary"
                @click="startRole"
              >
                New role
              </button>
            </div>
            <div class="divide-y divide-base-300 border-y border-base-300">
              <button
                v-for="role in roles"
                :key="role.id"
                type="button"
                class="flex w-full items-center gap-4 px-2 py-4 text-left disabled:cursor-default disabled:opacity-70"
                :disabled="!canEditRole(role)"
                @click="editRole(role)"
              >
                <span
                  class="size-5"
                  :style="{ background: accentColor(role.color) }"
                ></span>
                <span class="flex-1"
                  ><strong class="block">{{ role.name }}</strong
                  ><small
                    >{{ role.permissions?.length || 0 }} permissions · position
                    {{ role.position }}</small
                  ></span
                >
                <Icon
                  :name="
                    canEditRole(role)
                      ? 'lucide:chevron-right'
                      : 'lucide:lock-keyhole'
                  "
                  class="size-5 text-base-content/50"
                />
              </button>
            </div>
            <div>
              <h3 class="mb-3 text-xl font-light">Member assignments</h3>
              <div class="divide-y divide-base-300 border-y border-base-300">
                <div
                  v-for="membership in memberships"
                  :key="membership.id"
                  class="grid gap-4 py-5 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.6fr)] lg:items-start"
                >
                  <div class="min-w-0">
                    <strong class="block truncate">{{
                      membershipUserName(membership)
                    }}</strong>
                    <small class="text-base-content/55">Room member</small>
                  </div>
                  <div
                    v-if="membershipSystemRoles(membership).length"
                    class="flex min-h-12 items-center gap-2 lg:justify-end"
                  >
                    <span
                      v-for="role in membershipSystemRoles(membership)"
                      :key="role.id"
                      class="inline-flex items-center gap-2 border border-base-300 bg-base-200 px-3 py-2 text-sm font-semibold"
                    >
                      <span
                        class="size-3"
                        :style="{ background: accentColor(role.color) }"
                      ></span>
                      {{ role.name }}
                      <Icon name="lucide:lock-keyhole" class="size-3.5" />
                    </span>
                  </div>
                  <div v-else class="min-w-0">
                    <div class="flex min-w-0 flex-wrap gap-2">
                      <button
                        v-for="role in assignableRoles"
                        :key="role.id"
                        type="button"
                        class="metro-transition inline-flex min-h-11 items-center gap-2 border px-3 py-2 text-sm font-medium"
                        :class="
                          membership.roleSelection.includes(String(role.id))
                            ? 'border-primary bg-primary text-primary-content'
                            : 'border-base-300 hover:border-primary hover:bg-base-200'
                        "
                        :disabled="
                          !canManageMembership(membership) ||
                          !canManageRoleChoice(role) ||
                          membership.saving ||
                          (membership.roleSelection.length === 1 &&
                            membership.roleSelection.includes(String(role.id)))
                        "
                        @click="toggleMembershipRole(membership, role.id)"
                      >
                        <span
                          class="size-3"
                          :style="{ background: accentColor(role.color) }"
                        ></span>
                        {{ role.name }}
                        <Icon
                          v-if="
                            membership.roleSelection.includes(String(role.id))
                          "
                          name="lucide:check"
                          class="size-4"
                        />
                      </button>
                    </div>
                    <p
                      v-if="membership.saving"
                      class="mt-3 text-xs text-base-content/55"
                    >
                      Applying role…
                    </p>
                    <p
                      v-else-if="membership.assignmentError"
                      class="mt-3 text-xs text-error"
                    >
                      {{ membership.assignmentError }}
                    </p>
                    <p
                      v-else-if="canManageMembership(membership)"
                      class="mt-3 text-xs text-base-content/55"
                    >
                      Changes apply immediately. Every member must keep at least
                      one role.
                    </p>
                    <span v-else class="mt-3 block text-xs text-base-content/45"
                      >Locked</span
                    >
                  </div>
                </div>
              </div>
            </div>
            <form
              v-if="roleForm"
              class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4"
              @submit.prevent="saveRole"
              @click.self="closeRoleForm"
            >
              <div
                class="my-auto w-full max-w-3xl border border-base-300 bg-base-100 p-5 shadow-2xl sm:p-7"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="roleFormTitleId"
              >
                <div class="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h3 :id="roleFormTitleId" class="text-2xl font-light">
                      {{
                        roleForm.id ? `Edit ${roleForm.name}` : "Create role"
                      }}
                    </h3>
                    <p class="text-sm text-base-content/60">
                      Choose what members with this role can do.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost btn-square btn-sm"
                    aria-label="Close role editor"
                    @click="closeRoleForm"
                  >
                    <Icon name="lucide:x" class="size-5" />
                  </button>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <label class="grid gap-2"
                    ><span class="font-medium">Role name</span
                    ><input
                      v-model="roleForm.name"
                      class="input input-bordered w-full"
                      required /></label
                  ><label class="grid gap-2"
                    ><span class="font-medium">Hierarchy position</span
                    ><input
                      v-model.number="roleForm.position"
                      class="input input-bordered w-full"
                      type="number"
                      min="1"
                      required
                  /></label>
                </div>
                <fieldset class="mt-6">
                  <legend class="mb-3 font-medium">Permissions</legend>
                  <div
                    class="grid max-h-[45vh] gap-2 overflow-y-auto sm:grid-cols-2"
                  >
                    <label
                      v-for="permission in permissionOptions"
                      :key="permission.value"
                      class="flex cursor-pointer items-start gap-3 border border-base-300 p-3 hover:bg-base-200"
                      ><input
                        v-model="roleForm.permissions"
                        type="checkbox"
                        class="checkbox checkbox-primary mt-0.5"
                        :value="permission.value"
                      /><span
                        ><strong class="block">{{ permission.label }}</strong
                        ><small class="text-base-content/55">{{
                          permission.help
                        }}</small></span
                      ></label
                    >
                  </div>
                </fieldset>
                <div class="mt-6 flex flex-wrap gap-2">
                  <button class="btn btn-primary" :disabled="savingRole">
                    {{ savingRole ? "Saving…" : "Save role" }}</button
                  ><button
                    type="button"
                    class="btn btn-ghost"
                    @click="closeRoleForm"
                  >
                    Cancel</button
                  ><button
                    v-if="roleForm.id && !roleForm.system"
                    type="button"
                    class="btn btn-error sm:ml-auto"
                    :disabled="savingRole"
                    @click="deleteRole"
                  >
                    Delete role
                  </button>
                </div>
              </div>
            </form>
          </section>
          <SoundboardAdmin
            v-else-if="activeSection === 'soundboard'"
            :room-id="roomId"
          />
          <section v-else-if="activeSection === 'audit'" class="space-y-6">
            <div>
              <h2 class="text-3xl font-light">Audit log</h2>
              <p class="text-sm text-base-content/60">
                Invite creation and invite-based joins for this room.
              </p>
            </div>
            <div v-if="auditLoading" class="loading loading-spinner"></div>
            <div
              v-else-if="!auditEvents.length"
              class="border-y border-base-300 py-6 text-base-content/60"
            >
              No invite activity yet.
            </div>
            <ol
              v-else
              class="divide-y divide-base-300 border-y border-base-300"
            >
              <li
                v-for="entry in auditEvents"
                :key="entry.id"
                class="grid gap-1 py-4 sm:grid-cols-[1fr_auto]"
              >
                <span>
                  <strong>{{ auditActor(entry) }}</strong>
                  {{
                    entry.action === "invite.created"
                      ? "created an invite link"
                      : `invited ${auditSubject(entry)} to the room`
                  }}
                </span>
                <time
                  class="text-sm text-base-content/55"
                  :datetime="entry.occurredAt"
                  >{{ formatAuditDate(entry.occurredAt) }}</time
                >
                <small
                  v-if="
                    entry.details?.inviteExpiresAt || entry.details?.expiresAt
                  "
                  class="text-base-content/55 sm:col-span-2"
                  >Invite expires
                  {{
                    formatAuditDate(
                      entry.details.inviteExpiresAt || entry.details.expiresAt,
                    )
                  }}</small
                >
              </li>
            </ol>
          </section>
        </main>
      </div>
    </div>
  </section>
</template>

<script setup>
import { publicDisplayName } from "~~/shared/user-profile.js";
import {
  ROOM_ACCENTS,
  ROOM_ACCENT_LIGHT_COLORS,
} from "~~/shared/room-policy.js";
import { useAuthStore } from "../../../stores/auth";
import { useRoomsStore } from "../../../stores/rooms";
import SoundboardAdmin from "../../../components/SoundboardAdmin.vue";

const route = useRoute();
const config = useRuntimeConfig();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const roomId = computed(() => String(route.params.roomId));
const room = ref(null);
const roles = ref([]);
const memberships = ref([]);
const loading = ref(true);
const saving = ref(false);
const savingAccent = ref(false);
const error = ref("");
const activeSection = ref("branding");
const picture = ref(null);
const headerImage = ref(null);
const roleForm = ref(null);
const savingRole = ref(false);
const auditEvents = ref([]);
const auditLoading = ref(false);
const attenuationSaveState = ref("saved");
const roleFormTitleId = "room-role-form-title";
let attenuationHydrating = false;
let attenuationSaveTimer = null;
let attenuationSaveQueue = Promise.resolve();
const form = reactive({
  name: "",
  desc: "",
  accent: "cobalt",
  attenuation: {
    enabled: true,
    reductionPercent: 65,
    attackMs: 120,
    releaseMs: 650,
  },
});
const sections = [
  { id: "branding", label: "Identity", icon: "lucide:image" },
  { id: "roles", label: "Roles", icon: "lucide:shield-check" },
  { id: "attenuation", label: "Speech priority", icon: "lucide:audio-lines" },
  { id: "soundboard", label: "Soundboard", icon: "lucide:music-2" },
  { id: "audit", label: "Audit log", icon: "lucide:scroll-text" },
];
const canViewAudit = computed(
  () =>
    room.value?.isOwner ||
    room.value?.permissions?.some((permission) =>
      ["room.manage_invites", "room.manage_members"].includes(permission),
    ),
);
const attenuationTimingPresets = [
  {
    id: "fast",
    label: "Fast",
    description: "Lowers and restores shared audio right away.",
    attackMs: 60,
    releaseMs: 300,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Quickly makes room for voices, then returns smoothly.",
    attackMs: 120,
    releaseMs: 650,
  },
  {
    id: "smooth",
    label: "Smooth",
    description: "Uses gentle volume changes for music and films.",
    attackMs: 250,
    releaseMs: 1200,
  },
];
const sharedAudioDuringSpeech = computed(() =>
  Math.max(0, 100 - Number(form.attenuation.reductionPercent || 0)),
);
const attenuationTimingPreset = computed(
  () =>
    attenuationTimingPresets.find(
      (preset) =>
        preset.attackMs === Number(form.attenuation.attackMs) &&
        preset.releaseMs === Number(form.attenuation.releaseMs),
    )?.id || "custom",
);
const attenuationSaveLabel = computed(() => {
  if (attenuationSaveState.value === "saving") return "Saving changes…";
  if (attenuationSaveState.value === "error")
    return "Changes couldn’t be saved.";
  return "Changes save automatically.";
});
const permissionOptions = [
  [
    "room.update_identity",
    "Edit room identity",
    "Change the room name, description, and images.",
  ],
  [
    "room.update_theme",
    "Edit room appearance",
    "Change the room accent and visual theme.",
  ],
  [
    "room.manage_invites",
    "Manage invites",
    "Create and revoke room invitations.",
  ],
  [
    "room.manage_members",
    "Manage members",
    "Remove lower-ranked members from the room.",
  ],
  [
    "room.manage_roles",
    "Manage roles",
    "Create, edit, and assign lower-ranked roles.",
  ],
  [
    "room.manage_soundboard",
    "Manage soundboard",
    "Add, edit, and remove room soundboard clips.",
  ],
  ["channel.create", "Create channels", "Add new text and voice channels."],
  ["channel.update", "Edit channels", "Change channel names and settings."],
  ["channel.delete", "Delete channels", "Permanently remove channels."],
  [
    "channel.manage_media_policy",
    "Manage media quality",
    "Change channel audio and video limits.",
  ],
  [
    "channel.moderate_voice",
    "Moderate voice",
    "Move or disconnect lower-ranked voice participants.",
  ],
  [
    "message.moderate",
    "Moderate messages",
    "Remove messages that need moderation.",
  ],
].map(([value, label, help]) => ({ value, label, help }));
const assignableRoles = computed(() =>
  roles.value.filter((role) => !role.system),
);
const highestRolePosition = computed(() => {
  if (room.value?.isOwner) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    ...(room.value?.roles || []).map((role) => Number(role.position) || 0),
  );
});

function accentColor(value) {
  return ROOM_ACCENT_LIGHT_COLORS[value] || ROOM_ACCENT_LIGHT_COLORS.cobalt;
}

function hasPermission(permission) {
  return room.value?.isOwner || room.value?.permissions?.includes(permission);
}

function selectAttenuationTiming(preset) {
  form.attenuation.attackMs = preset.attackMs;
  form.attenuation.releaseMs = preset.releaseMs;
}

async function api(path, options = {}) {
  const response = await fetch(`${config.public.apiPath}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...options.headers },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function load() {
  loading.value = true;
  try {
    room.value = await roomsStore.getRoomDetails(roomId.value);
    attenuationHydrating = true;
    Object.assign(form, {
      name: room.value.name,
      desc: room.value.desc,
      accent: room.value.accent,
      attenuation: { ...form.attenuation, ...room.value.attenuation },
    });
    await nextTick();
    attenuationHydrating = false;
    const roleData = await api(
      `/room/roles?roomId=${encodeURIComponent(roomId.value)}`,
    );
    roles.value = roleData.roles || [];
    memberships.value = (roleData.memberships || []).map((membership) => ({
      ...membership,
      roleSelection: (membership.roles || []).map(String),
      originalRoleSelection: (membership.roles || []).map(String),
      saving: false,
      assignmentError: "",
    }));
  } catch (cause) {
    attenuationHydrating = false;
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}
async function loadAudit() {
  if (!canViewAudit.value || auditLoading.value) return;
  auditLoading.value = true;
  try {
    auditEvents.value = await api(
      `/room/audit?roomId=${encodeURIComponent(roomId.value)}`,
    );
  } catch (cause) {
    error.value = cause.message;
  } finally {
    auditLoading.value = false;
  }
}
function auditActor(entry) {
  return publicDisplayName(entry.actor);
}
function auditSubject(entry) {
  return publicDisplayName(entry.subject);
}
function formatAuditDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
watch(activeSection, (section) => {
  if (section === "audit") loadAudit();
});
watch(
  () => ({ ...form.attenuation }),
  () => {
    if (!attenuationHydrating && !loading.value) queueAttenuationSave();
  },
  { deep: true },
);

async function saveBranding() {
  saving.value = true;
  try {
    await roomsStore.updateRoom(roomId.value, {
      name: form.name,
      desc: form.desc,
      picture: picture.value,
      headerImage: headerImage.value,
    });
    await load();
  } finally {
    saving.value = false;
  }
}
async function saveAccent(accent) {
  if (savingAccent.value || form.accent === accent) return;
  const previousAccent = form.accent;
  form.accent = accent;
  savingAccent.value = true;
  roomsStore.applyRealtimeRoomUpdate({ id: roomId.value, accent });
  try {
    room.value = await roomsStore.updateRoom(roomId.value, { accent });
  } catch (cause) {
    form.accent = previousAccent;
    roomsStore.applyRealtimeRoomUpdate({
      id: roomId.value,
      accent: previousAccent,
    });
    error.value = cause.message;
  } finally {
    savingAccent.value = false;
  }
}
function queueAttenuationSave(delay = 400) {
  clearTimeout(attenuationSaveTimer);
  attenuationSaveState.value = "saving";
  attenuationSaveTimer = setTimeout(() => {
    const attenuation = { ...form.attenuation };
    attenuationSaveQueue = attenuationSaveQueue
      .catch(() => {})
      .then(async () => {
        try {
          room.value = await roomsStore.updateRoom(roomId.value, {
            attenuation,
          });
          if (JSON.stringify(attenuation) === JSON.stringify(form.attenuation))
            attenuationSaveState.value = "saved";
        } catch (cause) {
          attenuationSaveState.value = "error";
          error.value = cause.message;
        }
      });
  }, delay);
}
function startRole() {
  roleForm.value = { name: "", color: "cyan", position: 200, permissions: [] };
}
function editRole(role) {
  roleForm.value = { ...role, permissions: [...(role.permissions || [])] };
}
function closeRoleForm() {
  if (!savingRole.value) roleForm.value = null;
}
function canEditRole(role) {
  return (
    hasPermission("room.manage_roles") &&
    !role.system &&
    (room.value?.isOwner || Number(role.position) < highestRolePosition.value)
  );
}
function canManageRoleChoice(role) {
  return (
    !role.system &&
    (room.value?.isOwner || Number(role.position) < highestRolePosition.value)
  );
}
function membershipSystemRoles(membership) {
  return (membership.expand?.roles || []).filter((role) => role.system);
}
function canManageMembership(membership) {
  if (!hasPermission("room.manage_roles")) return false;
  const memberRoles = membership.expand?.roles || [];
  if (memberRoles.some((role) => role.system)) return false;
  const targetPosition = Math.max(
    0,
    ...memberRoles.map((role) => Number(role.position) || 0),
  );
  return room.value?.isOwner || targetPosition < highestRolePosition.value;
}
function membershipUserName(membership) {
  const user = membership.expand?.user;
  return user ? publicDisplayName(user) : membership.user;
}
async function toggleMembershipRole(membership, roleId) {
  if (membership.saving) return;
  const id = String(roleId);
  const previousSelection = [...membership.roleSelection];
  const nextSelection = membership.roleSelection.includes(id)
    ? membership.roleSelection.filter((value) => value !== id)
    : [...membership.roleSelection, id];
  if (!nextSelection.length) {
    membership.assignmentError = "A member must have at least one role.";
    return;
  }
  membership.roleSelection = nextSelection;
  membership.assignmentError = "";
  membership.saving = true;
  try {
    await api("/room/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign",
        roomId: roomId.value,
        membershipId: membership.id,
        roleIds: nextSelection,
      }),
    });
    membership.originalRoleSelection = [...nextSelection];
    membership.expand = {
      ...membership.expand,
      roles: roles.value.filter((role) =>
        nextSelection.includes(String(role.id)),
      ),
    };
  } catch (cause) {
    membership.roleSelection = previousSelection;
    membership.assignmentError = cause.message;
  } finally {
    membership.saving = false;
  }
}
async function saveRole() {
  savingRole.value = true;
  try {
    const editing = Boolean(roleForm.value.id);
    await api("/room/roles", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: roomId.value,
        roleId: roleForm.value.id,
        ...roleForm.value,
      }),
    });
    roleForm.value = null;
    await load();
  } finally {
    savingRole.value = false;
  }
}
async function deleteRole() {
  savingRole.value = true;
  try {
    await api("/room/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: roomId.value, roleId: roleForm.value.id }),
    });
    roleForm.value = null;
    await load();
  } finally {
    savingRole.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => clearTimeout(attenuationSaveTimer));
</script>
