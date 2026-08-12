import type { InferSelectModel } from "drizzle-orm";
import type {
  channels,
  messages,
  profiles,
  pushJobs,
  pushSubscriptions,
  rooms,
} from "../db/schema/index.ts";

export type PushJob = InferSelectModel<typeof pushJobs>;
export type PushSubscriptionRow = InferSelectModel<typeof pushSubscriptions>;
export type PushProfile = InferSelectModel<typeof profiles>;
export type PushRoom = Pick<InferSelectModel<typeof rooms>, "id" | "name">;
export type PushChannel = Pick<
  InferSelectModel<typeof channels>,
  "id" | "name" | "inRoom"
>;
export type PushMessage = Pick<
  InferSelectModel<typeof messages>,
  "id" | "content" | "authorId"
> & {
  sender?: { id?: string } | null;
};

export interface PushDispatcherMetrics {
  delivered: number;
  failed: number;
  retried: number;
}

export interface PushMetricsSnapshot {
  pending: number;
  activeSubscriptions: number;
  oldestPendingAt: string | null;
  checkedAt: string | null;
  available: boolean;
}

export interface PushDispatcherState {
  timer: NodeJS.Timeout | null;
  dispatchPromise: Promise<void> | null;
  running: boolean;
  configured: boolean;
  databaseUnavailable: boolean;
  lastCleanupAt: number;
  metricsSnapshot: PushMetricsSnapshot;
  metrics: PushDispatcherMetrics;
}

export interface PushNotificationInput {
  room: PushRoom;
  channel: PushChannel;
  message: PushMessage;
  senderId: string;
}
