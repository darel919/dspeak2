declare module "web-push" {
  import type { ExternalField } from "../../shared/types/external.ts";

  export interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  export interface SendNotificationOptions {
    TTL?: number;
    agent?: unknown;
    timeout?: number;
  }

  export interface WebPushClient {
    setVapidDetails(
      subject: string | undefined,
      publicKey: string,
      privateKey: string,
    ): void;
    sendNotification(
      subscription: PushSubscription,
      payload: string,
      options?: SendNotificationOptions,
    ): Promise<ExternalField>;
  }

  const webpush: WebPushClient;
  export default webpush;
}
