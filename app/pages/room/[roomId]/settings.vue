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
      <div v-else class="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav class="grid content-start gap-1" aria-label="Room settings">
          <button
            v-for="item in sections"
            :key="item.id"
            class="metro-transition flex items-center gap-3 px-4 py-3 text-left"
            :class="
              activeSection === item.id ? 'metro-selected' : 'hover:bg-base-200'
            "
            @click="activeSection = item.id"
          >
            <Icon :name="item.icon" class="size-5" />{{ item.label }}
          </button>
        </nav>

        <main class="min-w-0 border-l border-base-300 pl-4 sm:pl-8">
          <form
            v-if="activeSection === 'branding'"
            class="space-y-6"
            @submit.prevent="saveBranding"
          >
            <h2 class="text-3xl font-light">Identity and color</h2>
            <label class="form-control gap-2">
              <span class="font-medium">Room name</span>
              <input
                v-model="form.name"
                class="input input-bordered"
                maxlength="80"
                required
              />
            </label>
            <label class="form-control gap-2">
              <span class="font-medium">Description</span>
              <textarea
                v-model="form.desc"
                class="textarea textarea-bordered"
                maxlength="500"
              ></textarea>
            </label>
            <div class="grid gap-5 sm:grid-cols-2">
              <label class="form-control gap-2">
                <span class="font-medium">Square room picture</span>
                <input
                  type="file"
                  class="file-input file-input-bordered"
                  accept="image/jpeg,image/png,image/webp"
                  @change="picture = $event.target.files[0]"
                />
                <span class="text-xs text-base-content/60"
                  >JPEG, PNG, or WebP up to 2 MB</span
                >
              </label>
              <label class="form-control gap-2">
                <span class="font-medium">Wide room header</span>
                <input
                  type="file"
                  class="file-input file-input-bordered"
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
              <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
            <label class="form-control gap-2"
              ><span>Reduction: {{ form.attenuation.reductionPercent }}%</span
              ><input
                v-model.number="form.attenuation.reductionPercent"
                type="range"
                min="0"
                max="100"
                class="range range-primary"
            /></label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="form-control gap-2"
                ><span>Attack (ms)</span
                ><input
                  v-model.number="form.attenuation.attackMs"
                  class="input input-bordered"
                  type="number"
                  min="20"
                  max="2000"
              /></label>
              <label class="form-control gap-2"
                ><span>Release (ms)</span
                ><input
                  v-model.number="form.attenuation.releaseMs"
                  class="input input-bordered"
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
                class="flex w-full items-center gap-4 py-4 text-left"
                :disabled="!hasPermission('room.manage_roles')"
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
                <Icon name="lucide:chevron-right" class="size-5" />
              </button>
            </div>
            <div>
              <h3 class="mb-3 text-xl font-light">Member assignments</h3>
              <div class="divide-y divide-base-300 border-y border-base-300">
                <div
                  v-for="membership in memberships"
                  :key="membership.id"
                  class="grid gap-3 py-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center"
                >
                  <span class="truncate font-medium">{{
                    membership.expand?.user?.name || membership.user
                  }}</span>
                  <select
                    v-model="membership.roleSelection"
                    class="select select-bordered min-h-24"
                    multiple
                    :disabled="
                      membership.expand?.roles?.some((role) => role.system)
                    "
                  >
                    <option
                      v-for="role in assignableRoles"
                      :key="role.id"
                      :value="role.id"
                    >
                      {{ role.name }}
                    </option>
                  </select>
                  <button
                    class="btn btn-primary btn-sm"
                    :disabled="
                      membership.expand?.roles?.some((role) => role.system)
                    "
                    @click="saveAssignment(membership)"
                  >
                    Assign
                  </button>
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
                  class="input input-bordered"
                  placeholder="Role name"
                  required
                /><input
                  v-model.number="roleForm.position"
                  class="input input-bordered"
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

          <section v-else class="space-y-6">
            <h2 class="text-3xl font-light">Channel media policies</h2>
            <form
              v-for="channel in mediaChannels"
              :key="channel.id"
              class="border-b border-base-300 pb-6"
              @submit.prevent="savePolicy(channel)"
            >
              <h3 class="mb-4 text-xl">{{ channel.name }}</h3>
              <div class="grid gap-4 sm:grid-cols-2">
                <label
                  v-for="field in policyFields"
                  :key="field.key"
                  class="form-control gap-2"
                  ><span>{{ field.label }}</span
                  ><input
                    v-model.number="policyForms[channel.id][field.key]"
                    type="number"
                    class="input input-bordered"
                    :min="field.min"
                    :max="field.max"
                /></label>
              </div>
              <button class="btn btn-primary btn-sm mt-4">
                Apply live policy
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ROOM_ACCENTS, ROOM_PERMISSIONS } from "~~/shared/room-policy.js";
import { MEDIA_POLICY_LIMITS } from "~~/shared/media-policy.js";
import { useAuthStore } from "../../../stores/auth";
import { useChannelsStore } from "../../../stores/channels";
import { useRoomsStore } from "../../../stores/rooms";

const route = useRoute();
const config = useRuntimeConfig();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const channelsStore = useChannelsStore();
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
const policyForms = reactive({});
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
  { id: "policies", label: "Media", icon: "lucide:gauge" },
  { id: "attenuation", label: "Attenuation", icon: "lucide:audio-lines" },
];
const policyFields = Object.entries(MEDIA_POLICY_LIMITS).map(
  ([key, value]) => ({
    key,
    label: key.replace("Kbps", " bitrate (kbps)"),
    ...value,
  }),
);
const mediaChannels = computed(
  () => room.value?.channels?.filter((channel) => channel.isMedia) || [],
);
const assignableRoles = computed(() =>
  roles.value.filter((role) => !role.system),
);

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
    for (const channel of mediaChannels.value)
      policyForms[channel.id] = { ...channel.mediaPolicy };
    const roleData = await api(
      `/room/roles?roomId=${encodeURIComponent(roomId.value)}`,
    );
    roles.value = roleData.roles || [];
    memberships.value = (roleData.memberships || []).map((membership) => ({
      ...membership,
      roleSelection: (membership.roles || []).map(String),
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
}
async function savePolicy(channel) {
  await channelsStore.editChannel(channel.id, {
    mediaPolicy: policyForms[channel.id],
  });
  await load();
}

onMounted(load);
</script>
