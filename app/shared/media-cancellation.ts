import { asError } from "./native-mediasoup-utils.ts";
export const MEDIA_CANCELLATION_CODES = {
  MEDIA_OPERATION_SUPERSEDED: "MEDIA_OPERATION_SUPERSEDED",
  MEDIA_PROVIDER_ACTIVATION_SUPERSEDED: "MEDIA_PROVIDER_ACTIVATION_SUPERSEDED",
  MEDIA_SESSION_CLOSED: "MEDIA_SESSION_CLOSED",
  MEDIA_ROUTE_RETIRED: "MEDIA_ROUTE_RETIRED",
  MEDIA_SOURCE_GENERATION_REPLACED: "MEDIA_SOURCE_GENERATION_REPLACED",
} as const;

export type MediaCancellationCode =
  (typeof MEDIA_CANCELLATION_CODES)[keyof typeof MEDIA_CANCELLATION_CODES];

const ALL_CANCELLATION_CODES = new Set<string>(
  Object.values(MEDIA_CANCELLATION_CODES),
);

export class MediaCancellationError extends Error {
  override readonly code: MediaCancellationCode;
  readonly detail: Record<string, unknown>;

  constructor(
    code: MediaCancellationCode,
    message?: string,
    detail: Record<string, unknown> = {},
  ) {
    super(message || code);
    this.name = "MediaCancellationError";
    this.code = code;
    this.detail = detail;
  }
}

export function isMediaCancellationCode<T>(value: T): boolean {
  const code =
    /* SAFETY: callers pass untyped protocol payloads; membership is the contract. */
    asError(value, "Expected cancellation code").message;
  return ALL_CANCELLATION_CODES.has(code);
}

export function isMediaCancellationError<T>(value: T): boolean {
  if (value instanceof MediaCancellationError) return true;
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code =
    /* SAFETY: the guard above proved an attached code property exists. */
    (value as { code?: unknown }).code;
  return isMediaCancellationCode(code);
}

export interface MediaErrorClassification {
  cancellation: boolean;
  code: string | null;
}

export function classifyMediaError<T>(value: T): MediaErrorClassification {
  const error =
    value instanceof Error ? value : asError(value, "Media operation failed");
  if (isMediaCancellationError(error)) {
    const code =
      error instanceof MediaCancellationError
        ? error.code
        : /* SAFETY: isMediaCancellationError validated the attached code above. */
          String((error as { code?: unknown }).code);
    return { cancellation: true, code };
  }
  const candidate =
    /* SAFETY: error is normalized to an Error instance above. */
    (error as Error & { code?: unknown }).code;
  if (candidate !== undefined && String(candidate).includes("SUPERSEDED"))
    return { cancellation: true, code: String(candidate) };
  if (
    /superseded|session closed|route retired|generation replaced/i.test(
      error.message,
    )
  )
    return { cancellation: true, code: null };
  return { cancellation: false, code: null };
}

export interface MediaTransitionIdentity {
  routeEpoch: number;
  attemptId: string;
  provider: string | null;
  providerId: string | null;
  sourceRevision: number;
}

export function transitionIdentityKey(
  identity: MediaTransitionIdentity,
): string {
  return [
    identity.routeEpoch,
    identity.attemptId,
    identity.provider ?? "-",
    identity.providerId ?? "-",
    identity.sourceRevision,
  ].join(":");
}

export interface ProviderIncarnationIdentity {
  provider: string;
  providerId: string | null;
  providerSessionId: string | null;
  attemptId: string | null;
}

export function providerIncarnationKey(
  incarnation: ProviderIncarnationIdentity,
): string {
  return [
    incarnation.provider,
    incarnation.providerId ?? "-",
    incarnation.providerSessionId ?? "-",
    incarnation.attemptId ?? "-",
  ].join(":");
}

export interface SourceIncarnationIdentity {
  participantId: string;
  source: string;
  generation: number;
  connectionEpoch: number;
}

export function sourceIncarnationNewer(
  candidate: SourceIncarnationIdentity,
  current: SourceIncarnationIdentity | null | undefined,
): boolean {
  if (!current) return true;
  if (candidate.connectionEpoch !== current.connectionEpoch)
    return candidate.connectionEpoch > current.connectionEpoch;
  return candidate.generation > current.generation;
}

export function sourceIncarnationStale(
  candidate: SourceIncarnationIdentity,
  currentGeneration: number,
  currentConnectionEpoch: number,
): boolean {
  if (candidate.connectionEpoch < currentConnectionEpoch) return true;
  if (candidate.connectionEpoch > currentConnectionEpoch) return false;
  return (
    candidate.generation > 0 &&
    currentGeneration > 0 &&
    candidate.generation < currentGeneration
  );
}
