export interface OutboundUrlOptions {
  allowedHosts?: readonly string[];
}

export interface OutboundFetchOptions extends OutboundUrlOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface PublicHtmlResponse {
  html: string;
  url: string;
}

export interface PublicBytesResponse {
  body: Buffer;
  contentType: string;
  url: string;
}
