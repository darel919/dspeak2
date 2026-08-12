import type { H3Event } from "h3";
import type { InferSelectModel } from "drizzle-orm";
import type { channels, profiles, rooms } from "../db/schema/index.ts";

export type DSpeakEvent = H3Event;
export type DSpeakRoomRow = InferSelectModel<typeof rooms>;
export type DSpeakChannelRow = InferSelectModel<typeof channels>;
export type DSpeakProfileRow = InferSelectModel<typeof profiles>;
export type DSpeakProfileInput = Pick<DSpeakProfileRow, "id"> &
  Partial<Omit<DSpeakProfileRow, "id">>;
