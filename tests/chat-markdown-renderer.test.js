import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat messages use the concrete chat markdown component", async () => {
  const message = await readFile(
    new URL("../app/components/Chat/ChatMessage.vue", import.meta.url),
    "utf8",
  );
  assert.match(
    message,
    /import ChatMarkdownRenderer from "\.\/MarkdownRenderer\.vue"/,
  );
  assert.match(
    message,
    /<ChatMarkdownRenderer :content="message\.content" \/>/,
  );
  assert.doesNotMatch(message, /<FormattedContent/);
});

test("chat markdown is reactive and preserves message line layout", async () => {
  const renderer = await readFile(
    new URL("../app/components/Chat/MarkdownRenderer.vue", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /const tokens = computed\(\(\) => parseMarkdown\(props\.content\)\)/,
  );
  assert.match(renderer, /const listMatch = line\.match/);
  assert.match(renderer, /class="my-0 whitespace-pre-wrap"/);
});

test("chat markdown restricts links and does not embed markdown images", async () => {
  const renderer = await readFile(
    new URL("../app/components/Chat/MarkdownRenderer.vue", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /\["http:", "https:", "mailto:"\]/);
  assert.match(renderer, /node\.type === 'link' && safeHref\(node\.href\)/);
  assert.doesNotMatch(renderer, /:src="node\.src"/);
});
