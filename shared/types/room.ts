export type RoomPermission = string;
export type RoomAccent =
  "cobalt" | "cyan" | "violet" | "magenta" | "orange" | "lime";

export type RoomRole = {
  permissions?: readonly RoomPermission[];
  position?: unknown;
  system?: boolean;
};

export type RoomLike = {
  isOwner?: unknown;
  permissions?: readonly unknown[];
};

export type AttenuationInput = {
  enabled?: unknown;
  reductionPercent?: unknown;
  sensitivity?: unknown;
  attackMs?: unknown;
  releaseMs?: unknown;
};
