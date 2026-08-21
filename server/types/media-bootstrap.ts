import { importPKCS8 } from "jose";
import type {
  ExternalField,
  ExternalRecord,
} from "../../shared/types/external.ts";

export type MediaConnectionMode = "auto" | "direct";
export type MediaSigningKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface MediaBootstrapBody extends ExternalRecord {
  channelId?: ExternalField;
  roomId?: ExternalField;
  connectionMode?: ExternalField;
  deviceId?: ExternalField;
}
