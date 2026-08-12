import type { MediaVisibilityRegistry } from "./types/media-visibility.ts";

export function bindMediaVisibility(
  registry: MediaVisibilityRegistry,
  documentTarget: Document = document,
) {
  const update = () => registry.setDocumentHidden(documentTarget.hidden);
  documentTarget.addEventListener("visibilitychange", update);
  return () => documentTarget.removeEventListener("visibilitychange", update);
}
