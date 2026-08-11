export type SoundboardMetadataInput = {
  title?: unknown;
  category?: unknown;
  icon?: unknown;
  enabled?: unknown;
};

export type SoundboardClip = {
  uploader?: unknown;
  uploaderId?: unknown;
  createdById?: unknown;
};

export type SoundboardRecord = {
  id: string;
  roomId?: unknown;
  room?: unknown;
  createdById?: unknown;
  uploaderId?: unknown;
  uploader?: unknown;
  iconImageKey?: unknown;
  icon_image?: unknown;
  title?: unknown;
  name?: unknown;
  category?: unknown;
  icon?: unknown;
  duration?: unknown;
  displayOrder?: unknown;
  display_order?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  created?: unknown;
  updatedAt?: unknown;
  updated?: unknown;
  expand?: { uploader?: { id: string; [key: string]: unknown } };
};
