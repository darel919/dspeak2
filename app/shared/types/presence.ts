export type PresenceRecord = Record<string, unknown> & {
  id?: string;
  userId?: string;
  status?: string;
  updatedAt?: string | number | Date;
  isManualOverride?: boolean;
  platform?: string | null;
};

export type PresenceRealtimeMessage = {
  type?: string;
  data?: PresenceRecord | PresenceRecord[];
};
