import type { VoiceUserRecord } from "./types/voice-media-actions.ts";

export interface LocalVoiceParticipantOptions {
  connected: boolean;
  channelMatches: boolean;
  currentUser: VoiceUserRecord | null;
  muted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
}

export function mergeLocalVoiceParticipant(
  users: readonly VoiceUserRecord[],
  options: LocalVoiceParticipantOptions,
): VoiceUserRecord[] {
  if (!options.connected || !options.channelMatches || !options.currentUser?.id)
    return [...users];

  const localUserId = String(options.currentUser.id);
  const existingLocalUser = users.find(
    (user) => String(user.id) === localUserId,
  );
  const localParticipant: VoiceUserRecord = {
    ...options.currentUser,
    ...(existingLocalUser || {}),
    id: localUserId,
    muted: options.muted,
    deafened: options.deafened,
    cameraEnabled: options.cameraEnabled,
    screenSharing: options.screenSharing,
  };
  let replaced = false;
  const result = users.map((user) => {
    if (String(user.id) !== localUserId) return user;
    replaced = true;
    return localParticipant;
  });
  if (!replaced) result.push(localParticipant);
  return result;
}

export function shouldRenderVoiceParticipant(
  userId: string,
  representedUserIds: ReadonlySet<string>,
  localUserId: string,
): boolean {
  return (
    (localUserId.length > 0 && userId === localUserId) ||
    !representedUserIds.has(userId)
  );
}
