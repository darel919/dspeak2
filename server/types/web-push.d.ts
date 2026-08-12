declare module "web-push" {
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
    ): Promise<unknown>;
  }

  const webpush: WebPushClient;
  export default webpush;
}
