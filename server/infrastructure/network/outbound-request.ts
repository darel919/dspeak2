import { lookup } from "node:dns/promises";
import { Agent, request } from "node:https";
import { isIP } from "node:net";
import type { AgentOptions } from "node:https";
import type {
  OutboundFetchOptions,
  OutboundUrlOptions,
  PublicBytesResponse,
  PublicHtmlResponse,
} from "../../types/outbound-request.ts";

const blockedIpv4Ranges: ReadonlyArray<readonly [string, number]> =
  Object.freeze([
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ]);

function ipv4Number(address: string) {
  return address
    .split(".")
    .reduce((result: number, octet: string) => result * 256 + Number(octet), 0);
}

function ipv4InRange(address: string, base: string, prefix: number) {
  const blockSize = 2 ** (32 - prefix);
  return (
    Math.floor(ipv4Number(address) / blockSize) ===
    Math.floor(ipv4Number(base) / blockSize)
  );
}

function normalizedIpv6(address: string) {
  return address.toLowerCase().split("%")[0] || "";
}

export function isPublicOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4)
    return !blockedIpv4Ranges.some(([base, prefix]) =>
      ipv4InRange(address, base, prefix),
    );
  if (family !== 6) return false;
  const normalized = normalizedIpv6(address);
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  )
    return false;
  if (normalized.startsWith("::ffff:")) {
    const embedded = normalized.slice(7);
    return isIP(embedded) === 4 && isPublicOutboundAddress(embedded);
  }
  return true;
}

function allowedHostname(hostname: string, allowedHosts?: readonly string[]) {
  if (!allowedHosts?.length) return true;
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((entry: string) => {
    const allowed = String(entry).trim().toLowerCase();
    return (
      allowed && (normalized === allowed || normalized.endsWith(`.${allowed}`))
    );
  });
}

export function parseOutboundHttpsUrl(
  value: string,
  options: OutboundUrlOptions = {},
) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Outbound destination must be a valid absolute URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !allowedHostname(url.hostname, options.allowedHosts)
  )
    throw new Error("Outbound destination is not permitted");
  return url;
}

export async function resolvePublicOutboundAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const hostnameFamily = isIP(hostname);
  if (hostnameFamily)
    return isPublicOutboundAddress(hostname)
      ? [{ address: hostname, family: hostnameFamily === 4 ? 4 : 6 }]
      : [];
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return addresses
    .filter(({ address }) => isPublicOutboundAddress(address))
    .map(({ address, family }) => ({
      address,
      family: family === 4 ? 4 : 6,
    }));
}

export async function assertSafeOutboundUrl(
  value: string,
  options: OutboundUrlOptions = {},
) {
  const url = parseOutboundHttpsUrl(value, options);
  const addresses = await resolvePublicOutboundAddresses(url.hostname);
  if (!addresses.length)
    throw new Error("Outbound destination has no permitted public address");
  return url;
}

export function createPublicHttpsAgent(options: AgentOptions = {}) {
  return new Agent({
    keepAlive: false,
    lookup: (hostname, lookupOptions, callback) => {
      resolvePublicOutboundAddresses(hostname)
        .then((addresses) => {
          if (!addresses.length)
            throw new Error(
              "Outbound destination has no permitted public address",
            );
          if (lookupOptions?.all) {
            callback(null, addresses);
            return;
          }
          const requestedFamily = Number(lookupOptions?.family || 0);
          const selected =
            addresses.find(({ family }) => family === requestedFamily) ||
            addresses[0];
          if (!selected) {
            callback(
              new Error("Outbound destination has no permitted address"),
              "",
            );
            return;
          }
          callback(null, selected.address, selected.family);
        })
        .catch((error: Error) => callback(error, ""));
    },
    ...options,
  });
}

export async function fetchPublicHtml(
  value: string,
  options: OutboundFetchOptions = {},
): Promise<PublicHtmlResponse> {
  const maxBytes = options.maxBytes || 512 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs || 5000;
  const allowedHosts = options.allowedHosts;
  const fetchPage = async (
    target: string,
    redirectsRemaining: number,
  ): Promise<PublicHtmlResponse> => {
    const url = await assertSafeOutboundUrl(target, { allowedHosts });
    return new Promise((resolve, reject) => {
      const outbound = request(
        url,
        {
          agent: createPublicHttpsAgent(),
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": options.userAgent || "dSpeak/1.0",
          },
          method: "GET",
          timeout: timeoutMs,
        },
        (response) => {
          const status = response.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            response.resume();
            if (!location || redirectsRemaining <= 0) {
              reject(new Error("Outbound redirect limit exceeded"));
              return;
            }
            let nextUrl;
            try {
              nextUrl = new URL(location, url).href;
            } catch (error) {
              reject(error);
              return;
            }
            assertSafeOutboundUrl(nextUrl, { allowedHosts })
              .then(() =>
                fetchPage(nextUrl, redirectsRemaining - 1).then(
                  resolve,
                  reject,
                ),
              )
              .catch(reject);
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(new Error(`Outbound request failed with status ${status}`));
            return;
          }
          const contentType =
            String(response.headers["content-type"] || "")
              .split(";", 1)[0]
              ?.trim()
              .toLowerCase() || "";
          if (!["text/html", "application/xhtml+xml"].includes(contentType)) {
            response.resume();
            reject(new Error("Outbound response is not HTML"));
            return;
          }
          const contentLength = Number(response.headers["content-length"] || 0);
          if (contentLength > maxBytes) {
            response.resume();
            reject(new Error("Outbound response is too large"));
            return;
          }
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          response.on("data", (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              response.destroy(new Error("Outbound response is too large"));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () =>
            resolve({
              html: Buffer.concat(chunks).toString("utf8"),
              url: url.href,
            }),
          );
          response.on("error", reject);
        },
      );
      outbound.on("timeout", () =>
        outbound.destroy(new Error("Outbound request timed out")),
      );
      outbound.on("error", reject);
      outbound.end();
    });
  };
  return fetchPage(value, maxRedirects);
}

export async function fetchPublicBytes(
  value: string,
  options: OutboundFetchOptions = {},
): Promise<PublicBytesResponse> {
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs || 5000;
  const fetchBytes = async (
    target: string,
    redirectsRemaining: number,
  ): Promise<PublicBytesResponse> => {
    const url = await assertSafeOutboundUrl(target);
    return new Promise((resolve, reject) => {
      const outbound = request(
        url,
        {
          agent: createPublicHttpsAgent(),
          headers: { Accept: "image/*", "User-Agent": "dSpeak/1.0" },
          method: "GET",
          timeout: timeoutMs,
        },
        (response) => {
          const status = response.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            response.resume();
            if (!location || redirectsRemaining <= 0) {
              reject(new Error("Outbound redirect limit exceeded"));
              return;
            }
            fetchBytes(
              new URL(location, url).href,
              redirectsRemaining - 1,
            ).then(resolve, reject);
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(new Error(`Outbound request failed with status ${status}`));
            return;
          }
          const contentType =
            String(response.headers["content-type"] || "")
              .split(";", 1)[0]
              ?.trim()
              .toLowerCase() || "";
          if (!contentType.startsWith("image/")) {
            response.resume();
            reject(new Error("Outbound response is not an image"));
            return;
          }
          const contentLength = Number(response.headers["content-length"] || 0);
          if (contentLength > maxBytes) {
            response.resume();
            reject(new Error("Outbound response is too large"));
            return;
          }
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          response.on("data", (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              response.destroy(new Error("Outbound response is too large"));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks),
              contentType,
              url: url.href,
            }),
          );
          response.on("error", reject);
        },
      );
      outbound.on("timeout", () =>
        outbound.destroy(new Error("Outbound request timed out")),
      );
      outbound.on("error", reject);
      outbound.end();
    });
  };
  return fetchBytes(value, maxRedirects);
}

import type { ExternalField } from "../../../shared/types/external.ts";

export function configuredOutboundHosts(value: ExternalField): string[] {
  return String(value || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
