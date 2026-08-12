export interface ProfileInsertInput {
  username: string;
  displayName?: string | null;
  avatarKey?: string | null;
}

export interface ProfileUpdateInput {
  username?: string;
  displayName?: string | null;
  avatarKey?: string | null;
}

export interface FirstLoginInput {
  email: string;
  displayName?: string | null;
  avatarKey?: string | null;
}
