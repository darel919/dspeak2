export interface RoomOwner {
  id: string;
  [key: string]: unknown;
}

export interface RoomRecord {
  id: string;
  name?: string;
  desc?: string;
  owner?: RoomOwner;
  [key: string]: unknown;
}

export type RoomUpdate = Record<string, unknown> & { id?: string | number };
export type RoomUpdateInput = Record<string, unknown> & {
  picture?: File | null;
  headerImage?: File | null;
};

export interface CreateRoomResponse extends RoomRecord {
  [key: string]: unknown;
}

export interface RoomDetailsResponse extends RoomRecord {
  [key: string]: unknown;
}

export function isRoomRecord(value: unknown): value is RoomRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  );
}
