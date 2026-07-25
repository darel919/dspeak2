import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import { isIP } from "node:net";

const blockedIpv4Ranges = Object.freeze([
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

function ipv4Number(address) {
  return address
    .split(".")
    .reduce((result, octet) => result * 256 + Number(octet), 0);
}

function ipv4InRange(address, base, prefix) {
  const blockSize = 2 ** (32 - prefix);
  return (
    Math.floor(ipv4Number(address) / blockSize) ===
    Math.floor(ipv4Number(base) / blockSize)
  );
}

function normalizedIpv6(address) {
  return address.toLowerCase().split("%")[0];
}

export function isPublicOutboundAddress(address) {
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

function allowedHostname(hostname, allowedHosts) {
  if (!allowedHosts?.length) return true;
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = String(entry).trim().toLowerCase();
    return (
      allowed && (normalized === allowed || normalized.endsWith(`.${allowed}`))
    );
  });
}

export function parseOutboundHttpsUrl(value, options = {}) {
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

export async function resolvePublicOutboundAddresses(hostname) {
  if (isIP(hostname))
    return isPublicOutboundAddress(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : [];
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return addresses.filter(({ address }) => isPublicOutboundAddress(address));
}

export async function assertSafeOutboundUrl(value, options = {}) {
  const url = parseOutboundHttpsUrl(value, options);
  const addresses = await resolvePublicOutboundAddresses(url.hostname);
  if (!addresses.length)
    throw new Error("Outbound destination has no permitted public address");
  return url;
}

export function createPublicHttpsAgent(options = {}) {
  return new Agent({
    keepAlive: false,
    lookup: (hostname, lookupOptions, callback) => {
      resolvePublicOutboundAddresses(hostname)
        .then((addresses) => {
          if (!addresses.length)
            throw new Error(
              "Outbound destination has no permitted public address",
            );
          const requestedFamily = Number(lookupOptions?.family || 0);
          const selected =
            addresses.find(({ family }) => family === requestedFamily) ||
            addresses[0];
          callback(null, selected.address, selected.family);
        })
        .catch((error) => callback(error));
    },
    ...options,
  });
}

export function configuredOutboundHosts(value) {
  return String(value || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
