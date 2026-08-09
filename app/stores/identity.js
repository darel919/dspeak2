import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { publicDisplayName } from "~~/shared/user-profile.js";
import { useAuthStore } from "./auth";

export const useIdentityStore = defineStore("identity", () => {
  const nicknames = ref({});
  const publicProfiles = ref(new Map());
  const loadedForUserId = ref(null);
  const config = useRuntimeConfig();
  const authStore = useAuthStore();
  let nicknamesRequest = null;

  function request(path, options = {}) {
    const userId = authStore.getUserData()?.id;
    if (!userId) throw new Error("You must be signed in");
    return $fetch(`${config.public.apiPath}/profile${path}`, {
      ...options,
      credentials: "include",
      headers: { ...options.headers },
    });
  }

  async function loadNicknames() {
    if (nicknamesRequest) return nicknamesRequest;
    nicknamesRequest = loadIdentity();
    try {
      return await nicknamesRequest;
    } finally {
      nicknamesRequest = null;
    }
  }

  async function loadIdentity() {
    const userId = authStore.getUserData()?.id;
    if (!userId) {
      nicknames.value = {};
      loadedForUserId.value = null;
      return;
    }
    const [profile, result] = await Promise.all([
      request(""),
      request("/nicknames"),
    ]);
    authStore.updateUserData(profile);
    nicknames.value = result.nicknames || {};
    loadedForUserId.value = String(userId);
  }

  async function saveNickname(targetUserId, nickname) {
    const result = await request("/nickname", {
      method: "PUT",
      body: { targetUserId, nickname },
    });
    const next = { ...nicknames.value };
    if (result.nickname) next[String(targetUserId)] = result.nickname;
    else delete next[String(targetUserId)];
    nicknames.value = next;
    return result.nickname;
  }

  function nicknameFor(userId) {
    return nicknames.value[String(userId)] || "";
  }

  function upsertPublicProfile(profile) {
    if (!profile?.id) return;
    const userId = String(profile.id);
    const previous = publicProfiles.value.get(userId) || {};
    publicProfiles.value.set(userId, { ...previous, ...profile, id: userId });
    publicProfiles.value = new Map(publicProfiles.value);
  }

  function profileFor(user) {
    if (!user?.id) return user || {};
    return { ...user, ...(publicProfiles.value.get(String(user.id)) || {}) };
  }

  function displayName(user) {
    return nicknameFor(user?.id) || publicDisplayName(profileFor(user));
  }

  function clearIdentity() {
    nicknames.value = {};
    publicProfiles.value = new Map();
    loadedForUserId.value = null;
  }

  return {
    nicknames,
    loadedForUserId,
    loadNicknames,
    saveNickname,
    nicknameFor,
    upsertPublicProfile,
    profileFor,
    displayName,
    clearIdentity,
  };
});
