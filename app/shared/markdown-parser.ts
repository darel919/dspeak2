export function parseMarkdown(text) {
  if (!text) return "";

  let html = escapeHtml(text);

  html = html.replace(
    /^(&gt;|>)\s?(.*)$/gm,
    '<blockquote class="chat-quote">$2</blockquote>',
  );

  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  html = html.replace(/`(.+?)`/g, '<code class="chat-inline-code">$1</code>');

  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    '<pre class="chat-code-block"><code>$2</code></pre>',
  );

  html = html.replace(/\n/g, "<br>");

  return html;
}

export function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

export function hasMarkdown(text) {
  if (!text) return false;
  return /(\*\*|__|\*|_|`|~~|^>)/.test(text);
}

export function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^>\s?(.*)$/gm, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}
