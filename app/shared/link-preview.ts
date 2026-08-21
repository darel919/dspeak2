import { isExternalRecord } from "./types/boundary.ts";

type EmbedPlatform = {
  domains: string[];
  getEmbedUrl?: (url: string) => string | null;
  getThumbnail?: (url: string) => string | null;
};

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,;:!?)}\]'"])/gi;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
  ];
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return imageExtensions.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith(".gif");
  } catch {
    return false;
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

export const EMBED_PLATFORMS = {
  youtube: {
    domains: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
    getEmbedUrl: (url: string) => {
      try {
        const parsed = new URL(url);
        let videoId = null;
        if (parsed.hostname === "youtu.be") {
          videoId = parsed.pathname.slice(1);
        } else {
          videoId = parsed.searchParams.get("v");
        }
        if (videoId) {
          return `https://www.youtube-nocookie.com/embed/${videoId}`;
        }
      } catch {}
      return null;
    },
    getThumbnail: (url: string) => {
      try {
        const parsed = new URL(url);
        let videoId = null;
        if (parsed.hostname === "youtu.be") {
          videoId = parsed.pathname.slice(1);
        } else {
          videoId = parsed.searchParams.get("v");
        }
        if (videoId)
          return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      } catch {}
      return null;
    },
  },
  twitter: {
    domains: ["twitter.com", "x.com", "www.twitter.com", "www.x.com"],
  },
  github: {
    domains: ["github.com", "www.github.com"],
  },
} satisfies Record<string, EmbedPlatform>;

export function identifyPlatform(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    for (const [platform, config] of Object.entries(EMBED_PLATFORMS)) {
      if (config.domains.some((d) => d.includes(hostname))) {
        return platform;
      }
    }
  } catch {}
  return null;
}

export type LinkPreviewPayload = Record<string, unknown> | null;

function parseLinkPreviewPayload<T>(value: T): LinkPreviewPayload {
  return isExternalRecord(value) ? value : null;
}

export async function fetchLinkPreview(
  url: string,
): Promise<LinkPreviewPayload> {
  try {
    const apiPath = window.__NUXT__?.config?.public?.apiPath || "/api";
    const response = await fetch(
      `${apiPath}/chat/link-preview?url=${encodeURIComponent(url)}`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    return parseLinkPreviewPayload(await response.json());
  } catch {
    return null;
  }
}
