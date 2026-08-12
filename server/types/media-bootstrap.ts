import { importPKCS8 } from "jose";

export type MediaConnectionMode = "auto" | "direct";
export type MediaSigningKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface MediaBootstrapBody {
  channelId?: unknown;
  roomId?: unknown;
  connectionMode?: unknown;
  deviceId?: unknown;
}
