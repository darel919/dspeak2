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
              item.id !== 'soundboard' ||
              hasPermission('room.manage_soundboard')
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
                <span class="text-xs text-base-content/60"
                  >3:1 recommended, up to 5 MB</span
                >
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
                  @click="form.accent = accent"
                >
                  {{ accent }}
                </button>
              </div>
            </fieldset>
            <button class="btn btn-primary" :disabled="saving">
              {{ saving ? "Saving…" : "Save room" }}
            </button>
          </form>

          <form
            v-else-if="activeSection === 'attenuation'"
            class="space-y-6"
            @submit.prevent="saveAttenuation"
          >
            <h2 class="text-3xl font-light">Stream attenuation</h2>
            <label
              class="flex items-center justify-between border-b border-base-300 py-4"
            >
              <span
                ><strong class="block"
                  >Reduce shared streams during speech</strong
                ><small>Applies to screen and system audio.</small></span
              >
              <input
                v-model="form.attenuation.enabled"
                type="checkbox"
                class="toggle toggle-primary"
              />
            </label>
            <label class="grid min-w-0 gap-2"
              ><span>Reduction: {{ form.attenuation.reductionPercent }}%</span
              ><input
                v-model.number="form.attenuation.reductionPercent"
                type="range"
                min="0"
                max="100"
                class="range range-primary"
            /></label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="grid min-w-0 gap-2"
                ><span>Attack (ms)</span
                ><input
                  v-model.number="form.attenuation.attackMs"
                  class="input input-bordered w-full"
                  type="number"
                  min="20"
                  max="2000"
              /></label>
              <label class="grid min-w-0 gap-2"
                ><span>Release (ms)</span
                ><input
                  v-model.number="form.attenuation.releaseMs"
                  class="input input-bordered w-full"
                  type="number"
                  min="50"
                  max="5000"
              /></label>
            </div>
            <button class="btn btn-primary" :disabled="saving">
              Save attenuation
            </button>
          </form>

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
                  class="grid gap-4 py-5 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.6fr)_auto] lg:items-center"
                >
                  <div class="min-w-0">
                    <strong class="block truncate">{{
                      membershipUserName(membership)
                    }}</strong>
                    <small class="text-base-content/55">Room member</small>
                  </div>
                  <div
                    v-if="membershipSystemRoles(membership).length"
                    class="flex min-h-12 items-center gap-2"
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
                  <div v-else class="flex min-w-0 flex-wrap gap-2">
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
                        !canManageRoleChoice(role)
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
                  <button
                    v-if="canManageMembership(membership)"
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="
                      !assignmentChanged(membership) || membership.saving
                    "
                    @click="saveAssignment(membership)"
                  >
                    {{ membership.saving ? "Saving…" : "Save" }}
                  </button>
                  <span
                    v-else
                    class="text-xs text-base-content/45 lg:text-right"
                    >Locked</span
                  >
                </div>
              </div>
            </div>
            <form
              v-if="roleForm"
              class="border border-base-300 p-5"
              @submit.prevent="saveRole"
            >
              <h3 class="mb-4 text-xl font-light">
                {{ roleForm.id ? "Edit role" : "Create role" }}
              </h3>
              <div class="grid gap-4 sm:grid-cols-2">
                <input
                  v-model="roleForm.name"
                  class="input input-bordered w-full"
                  placeholder="Role name"
                  required
                /><input
                  v-model.number="roleForm.position"
                  class="input input-bordered w-full"
                  type="number"
                  min="1"
                  placeholder="Position"
                />
              </div>
              <div class="mt-5 grid gap-2 sm:grid-cols-2">
                <label
                  v-for="permission in ROOM_PERMISSIONS"
                  :key="permission"
                  class="flex items-center gap-2 border border-base-300 p-3"
                  ><input
                    v-model="roleForm.permissions"
                    type="checkbox"
                    class="checkbox checkbox-primary"
                    :value="permission"
                  />{{ permission }}</label
                >
              </div>
              <div class="mt-5 flex gap-2">
                <button class="btn btn-primary">Save role</button
                ><button
                  type="button"
                  class="btn btn-ghost"
                  @click="roleForm = null"
                >
                  Cancel</button
                ><button
                  v-if="roleForm.id && !roleForm.system"
                  type="button"
                  class="btn btn-error ml-auto"
                  @click="deleteRole"
                >
                  Delete
                </button>
              </div>
            </form>
          </section>
          <SoundboardAdmin
            v-else-if="activeSection === 'soundboard'"
            :room-id="roomId"
          />
        </main>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ROOM_ACCENTS, ROOM_PERMISSIONS } from "~~/shared/room-policy.js";
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
const error = ref("");
const activeSection = ref("branding");
const picture = ref(null);
const headerImage = ref(null);
const roleForm = ref(null);
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
  { id: "attenuation", label: "Attenuation", icon: "lucide:audio-lines" },
  { id: "soundboard", label: "Soundboard", icon: "lucide:music-2" },
];
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
  return (
    {
      cobalt: "#0050ef",
      cyan: "#00aba9",
      violet: "#6a00ff",
      magenta: "#d80073",
      orange: "#e3a21a",
      lime: "#60a917",
    }[value] || "#0050ef"
  );
}

function hasPermission(permission) {
  return room.value?.isOwner || room.value?.permissions?.includes(permission);
}

async function api(path, options = {}) {
  const response = await fetch(`${config.public.apiPath}${path}`, {
    ...options,
    headers: { Authorization: authStore.getUserData().id, ...options.headers },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function load() {
  loading.value = true;
  try {
    room.value = await roomsStore.getRoomDetails(roomId.value);
    Object.assign(form, {
      name: room.value.name,
      desc: room.value.desc,
      accent: room.value.accent,
      attenuation: { ...form.attenuation, ...room.value.attenuation },
    });
    const roleData = await api(
      `/room/roles?roomId=${encodeURIComponent(roomId.value)}`,
    );
    roles.value = roleData.roles || [];
    memberships.value = (roleData.memberships || []).map((membership) => ({
      ...membership,
      roleSelection: (membership.roles || []).map(String),
      originalRoleSelection: (membership.roles || []).map(String),
      saving: false,
    }));
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}

async function saveBranding() {
  saving.value = true;
  try {
    await roomsStore.updateRoom(roomId.value, {
      name: form.name,
      desc: form.desc,
      accent: form.accent,
      picture: picture.value,
      headerImage: headerImage.value,
    });
    await load();
  } finally {
    saving.value = false;
  }
}
async function saveAttenuation() {
  saving.value = true;
  try {
    await roomsStore.updateRoom(roomId.value, {
      attenuation: form.attenuation,
    });
    await load();
  } finally {
    saving.value = false;
  }
}
function startRole() {
  roleForm.value = { name: "", color: "cyan", position: 200, permissions: [] };
}
function editRole(role) {
  roleForm.value = { ...role, permissions: [...(role.permissions || [])] };
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
  return user?.display_name || user?.name || user?.username || membership.user;
}
function toggleMembershipRole(membership, roleId) {
  const id = String(roleId);
  membership.roleSelection = membership.roleSelection.includes(id)
    ? membership.roleSelection.filter((value) => value !== id)
    : [...membership.roleSelection, id];
}
function assignmentChanged(membership) {
  const selected = [...membership.roleSelection].sort();
  const original = [...membership.originalRoleSelection].sort();
  return selected.join(",") !== original.join(",");
}
async function saveRole() {
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
}
async function deleteRole() {
  await api("/room/roles", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: roomId.value, roleId: roleForm.value.id }),
  });
  roleForm.value = null;
  await load();
}
async function saveAssignment(membership) {
  membership.saving = true;
  try {
    await api("/room/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign",
        roomId: roomId.value,
        membershipId: membership.id,
        roleIds: membership.roleSelection,
      }),
    });
    await load();
  } finally {
    membership.saving = false;
  }
}
onMounted(load);
</script>
