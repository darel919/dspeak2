type ProviderIdentityRecord = {
  provider?: unknown;
  providerId?: unknown;
  targetProvider?: unknown;
  targetProviderId?: unknown;
  route?: ProviderIdentityRecord | null;
  targetRoute?: ProviderIdentityRecord | null;
};
import { isExternalRecord, isExternalString } from "./types/boundary.ts";

export type MediaProviderIdentity = {
  provider: string | null;
  providerId: string | null;
};

function stringValue<T>(value: T) {
  if (!isExternalString(value) || !value.trim()) return null;
  return value.trim();
}

function recordValue<T>(value: T): ProviderIdentityRecord {
  return isExternalRecord(value) ? value : {};
}

export function resolveMediaProviderIdentity<T>(
  value: T,
  preferTarget = false,
): MediaProviderIdentity {
  const data = recordValue(value);
  const route = recordValue(data.route);
  const targetRoute = recordValue(data.targetRoute);
  const provider = preferTarget
    ? stringValue(data.targetProvider) ||
      stringValue(data.provider) ||
      stringValue(targetRoute.provider) ||
      stringValue(route.provider)
    : stringValue(data.provider) ||
      stringValue(route.provider) ||
      stringValue(data.targetProvider) ||
      stringValue(targetRoute.provider);
  const providerId = preferTarget
    ? stringValue(data.targetProviderId) ||
      stringValue(data.providerId) ||
      stringValue(targetRoute.providerId) ||
      stringValue(route.providerId)
    : stringValue(data.providerId) ||
      stringValue(route.providerId) ||
      stringValue(data.targetProviderId) ||
      stringValue(targetRoute.providerId);
  return { provider, providerId };
}
