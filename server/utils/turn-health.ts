import { randomBytes } from "node:crypto";
import { resolve6 } from "node:dns/promises";
import { createSocket } from "node:dgram";
import type {
  TurnHealthOptions,
  TurnHealthResult,
  TurnProbeResult,
} from "../types/turn-health.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../../shared/types/external.ts";

const stunBindingRequest = 0x0001;
const stunBindingSuccess = 0x0101;
const stunMagicCookie = 0x2112a442;
const cacheDurationMs = 30_000;
let cachedResult: TurnHealthResult | undefined;
let cachedAt = 0;
let refreshPromise: Promise<TurnHealthResult | null> | null = null;

function bindingRequest(transactionId: Buffer): Buffer {
  const request = Buffer.alloc(20);
  request.writeUInt16BE(stunBindingRequest, 0);
  request.writeUInt16BE(0, 2);
  request.writeUInt32BE(stunMagicCookie, 4);
  transactionId.copy(request, 8);
  return request;
}

function sendBindingRequest(
  address: string,
  port: number,
  timeoutMs: number,
): Promise<TurnProbeResult> {
  return new Promise<TurnProbeResult>((resolve) => {
    const socket = createSocket("udp6");
    const transactionId = randomBytes(12);
    let settled = false;
    const finish = (result: TurnProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        socket.unref();
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ available: false, detail: "probe-timeout" }),
      timeoutMs,
    );
    socket.once("error", (error) =>
      finish({
        available: false,
        detail:
          parseExternalString(parseExternalRecord(error)?.code) ||
          "probe-error",
      }),
    );
    socket.once("message", (message) => {
      const valid =
        message.length >= 20 &&
        message.readUInt16BE(0) === stunBindingSuccess &&
        message.readUInt32BE(4) === stunMagicCookie &&
        message.subarray(8, 20).equals(transactionId);
      finish(
        valid
          ? { available: true, detail: "stun-binding-succeeded" }
          : { available: false, detail: "invalid-stun-response" },
      );
    });
    socket.send(bindingRequest(transactionId), port, address);
  });
}

export async function probeSelfHostedTurn(
  environment: NodeJS.ProcessEnv = process.env,
  options: TurnHealthOptions = {},
): Promise<TurnHealthResult> {
  const host = environment.DSPEAK_RTC_DOMAIN?.trim();
  const secret = environment.TURN_SHARED_SECRET?.trim();
  if (!host || !secret)
    return { configured: false, available: false, detail: "disabled" };

  const now = options.now ?? Date.now();
  if (!options.bypassCache && cachedResult && now - cachedAt < cacheDurationMs)
    return cachedResult;

  let result;
  try {
    const addresses = await resolve6(host);
    if (!addresses.length)
      result = {
        configured: true,
        available: false,
        detail: "no-ipv6-address",
      };
    else {
      const address = addresses[0];
      if (!address) throw new Error("DNS returned an empty IPv6 address");
      const probe = await sendBindingRequest(
        address,
        Number(environment.TURN_PORT || 3478),
        options.timeoutMs || 1000,
      );
      result = { configured: true, ...probe };
    }
  } catch (error) {
    const errorRecord = parseExternalRecord(error);
    result = {
      configured: true,
      available: false,
      detail: parseExternalString(errorRecord?.code) || "dns-resolution-failed",
    };
  }
  cachedResult = result;
  cachedAt = now;
  return result;
}

export function resetTurnHealthCache() {
  cachedResult = undefined;
  cachedAt = 0;
}

export function readTurnHealth(
  environment: NodeJS.ProcessEnv = process.env,
): TurnHealthResult {
  const host = environment.DSPEAK_RTC_DOMAIN?.trim();
  const secret = environment.TURN_SHARED_SECRET?.trim();
  if (!host || !secret)
    return { configured: false, available: false, detail: "disabled" };
  if (
    !refreshPromise &&
    (!cachedResult || Date.now() - cachedAt >= cacheDurationMs)
  ) {
    refreshPromise = probeSelfHostedTurn(environment, { bypassCache: true })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return (
    cachedResult || {
      configured: true,
      available: false,
      detail: "probe-pending",
    }
  );
}
