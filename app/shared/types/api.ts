export type ApiErrorPayload = Record<string, unknown> & {
  statusMessage?: unknown;
  message?: unknown;
  data?: { statusMessage?: unknown; message?: unknown };
};
export interface ApiRequestTarget {
  origin: string;
  pathname: string;
}
