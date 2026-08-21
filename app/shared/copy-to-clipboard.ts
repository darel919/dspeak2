interface ClipboardNavigator {
  clipboard?: { writeText(text: string): Promise<void> };
}

interface ClipboardDocument {
  body?: { appendChild(element: HTMLTextAreaElement): void } | null;
  createElement?(tagName: string): HTMLTextAreaElement;
  execCommand?(command: string): boolean;
}

export async function copyTextToClipboard(
  text: string,
  {
    navigatorObject,
    documentObject,
  }: {
    navigatorObject?: ClipboardNavigator | null;
    documentObject?: ClipboardDocument | null;
  } = {},
) {
  const currentNavigator =
    navigatorObject || (import.meta.client ? navigator : null);
  const currentDocument: ClipboardDocument | null =
    documentObject || (import.meta.client ? document : null);

  if (currentNavigator?.clipboard?.writeText) {
    try {
      await currentNavigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  if (
    !currentDocument?.body ||
    !(currentDocument.createElement instanceof Function) ||
    !(currentDocument.execCommand instanceof Function)
  )
    return false;

  const textarea = currentDocument.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  currentDocument.body.appendChild(textarea);
  textarea.select();
  try {
    return currentDocument.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
