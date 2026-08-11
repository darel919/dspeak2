export function bindMediaVisibility(registry, documentTarget = document) {
  const update = () => registry.setDocumentHidden(documentTarget.hidden);
  documentTarget.addEventListener("visibilitychange", update);
  return () => documentTarget.removeEventListener("visibilitychange", update);
}
