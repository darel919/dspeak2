export interface FriendRecord {
  id: string | number;
  online?: boolean;
  presence_status?: string | null;
  [key: string]: unknown;
}

export interface FriendRequestRecord extends FriendRecord {
  status?: string;
}

export interface FriendApiResult {
  items?: FriendRecord[];
  id?: string;
  status?: string;
  [key: string]: unknown;
}
