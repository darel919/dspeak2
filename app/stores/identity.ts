import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { publicDisplayName } from "~~/shared/user-profile.ts";
import { useAuthStore } from "./auth";
import type {
  IdentityApiResult,
  IdentityProfile,
  IdentityRequestOptions,
} from "../shared/types/identity.ts";

export const useIdentityStore = defineStore("identity", () => {
  const nicknames = ref<Record<string, string>>({});
  const publicProfiles = ref<Map<string, IdentityProfile>>(new Map());
  const loadedForUserId = ref<string | null>(null);
  const config = useRuntimeConfig();
  const authStore = useAuthStore();
  let nicknamesRequest: Promise<void> | null = null;

  function request(
    path: string,
    options: IdentityRequestOptions = {},
  ): Promise<unknown> {
    const userId = authStore.getUserData()?.id;
    if (!userId) throw new Error("You must be signed in");
    const fetchRequest = $fetch as unknown as (
      url: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    return fetchRequest(`${config.public.apiPath}/profile${path}`, {
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
    const [profile, result] = (await Promise.all([
      request(""),
      request("/nicknames"),
    ])) as [Record<string, unknown>, IdentityApiResult];
    authStore.updateUserData(profile);
    nicknames.value = result.nicknames || {};
    loadedForUserId.value = String(userId);
  }

  async function saveNickname(
    targetUserId: string | number,
    nickname: string,
  ): Promise<string | undefined> {
    const result = (await request("/nickname", {
      method: "PUT",
      body: { targetUserId, nickname },
    })) as IdentityApiResult;
    const next = { ...nicknames.value };
    if (result.nickname) next[String(targetUserId)] = result.nickname;
    else delete next[String(targetUserId)];
    nicknames.value = next;
    return result.nickname;
  }

  function nicknameFor(userId: string | number | null | undefined): string {
    return nicknames.value[String(userId)] || "";
  }

  function upsertPublicProfile(profile: IdentityProfile): void {
    if (!profile?.id) return;
    const userId = String(profile.id);
    const previous = publicProfiles.value.get(userId) || {};
    publicProfiles.value.set(userId, { ...previous, ...profile, id: userId });
    publicProfiles.value = new Map(publicProfiles.value);
  }

  function profileFor(
    user: IdentityProfile | null | undefined,
  ): IdentityProfile {
    if (!user?.id) return user || { id: "" };
    return { ...user, ...(publicProfiles.value.get(String(user.id)) || {}) };
  }

  function displayName(user: IdentityProfile | null | undefined): string {
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
