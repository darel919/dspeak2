<script setup>
import { isExternalString } from "../../shared/types/boundary.ts";

const props = defineProps({
  content: { type: String, default: "" },
});

const parseMarkdown = (text) => {
  if (!text) return [];

  const lines = text.split("\n");
  const tokens = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeLines = [];
  let inBlockquote = false;
  let blockquoteLines = [];
  let listStack = [];

  const flushCodeBlock = () => {
    if (codeLines.length > 0) {
      tokens.push({
        type: "code",
        lang: codeBlockLang,
        content: codeLines.join("\n"),
      });
      codeLines = [];
      codeBlockLang = "";
    }
  };

  const flushBlockquote = () => {
    if (blockquoteLines.length > 0) {
      tokens.push({ type: "blockquote", content: blockquoteLines.join("\n") });
      blockquoteLines = [];
    }
  };

  const flushList = () => {
    listStack = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false;
        flushCodeBlock();
      } else {
        flushBlockquote();
        flushList();
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith(">")) {
      if (!inBlockquote) {
        flushList();
        inBlockquote = true;
      }
      blockquoteLines.push(trimmed.slice(1).trimStart());
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
      inBlockquote = false;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+/);
    if (listMatch) {
      if (!inBlockquote) flushBlockquote();
      const indent = listMatch[1].length;
      const marker = listMatch[2];
      const content = line.slice(listMatch[0].length);
      const isOrdered = /\d+\./.test(marker);

      let listItem = { type: "listItem", ordered: isOrdered, indent, content };

      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1].indent >= indent
      ) {
        listStack.pop();
      }

      if (listStack.length === 0) {
        tokens.push({ type: "list", ordered: isOrdered, items: [] });
        listStack.push({ indent, list: tokens[tokens.length - 1] });
      } else if (listStack[listStack.length - 1].indent < indent) {
        const parentList = listStack[listStack.length - 1].list;
        const lastItem = parentList.items[parentList.items.length - 1];
        if (!lastItem.nested) lastItem.nested = [];
        parentList.items[parentList.items.length - 1].nested.push({
          type: "list",
          ordered: isOrdered,
          items: [],
        });
        listStack.push({
          indent,
          list: lastItem.nested[lastItem.nested.length - 1],
        });
      }

      const currentList = listStack[listStack.length - 1].list;
      currentList.items.push(listItem);
      continue;
    } else if (listStack.length > 0 && trimmed === "") {
      continue;
    } else if (listStack.length > 0) {
      flushList();
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      continue;
    }

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      tokens.push({ type: "hr" });
      continue;
    }

    if (trimmed === "") {
      tokens.push({ type: "br" });
      continue;
    }

    tokens.push({ type: "paragraph", content: line });
  }

  flushCodeBlock();
  flushBlockquote();

  return tokens;
};

const renderInline = (text) => {
  if (!text) return [];

  const nodes = [];
  let remaining = text;
  let lastIndex = 0;

  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, type: "strong" },
    { regex: /__(.+?)__/g, type: "strong" },
    { regex: /\*(.+?)\*/g, type: "em" },
    { regex: /_(.+?)_/g, type: "em" },
    { regex: /`(.+?)`/g, type: "code" },
    { regex: /!\[([^\]]*)\]\(([^)]+)\)/g, type: "image" },
    { regex: /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, type: "link" },
    { regex: /~~(.+?)~~/g, type: "del" },
  ];

  const matches = [];
  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        type,
        groups: match.slice(1),
      });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  let filteredMatches = [];
  for (const match of matches) {
    const overlap = filteredMatches.some(
      (m) =>
        match.index < m.index + m.length &&
        match.index + match.length > m.index,
    );
    if (!overlap) filteredMatches.push(match);
  }

  for (const match of filteredMatches) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    if (match.type === "link") {
      nodes.push({
        type: "link",
        text: match.groups[0],
        href: match.groups[1],
      });
    } else if (match.type === "image") {
      nodes.push({ type: "image", alt: match.groups[0], src: match.groups[1] });
    } else {
      nodes.push({ type: match.type, content: match.groups[0] });
    }
    lastIndex = match.index + match.length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", content: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", content: text }];
};

const tokens = computed(() => parseMarkdown(props.content));

function safeHref(value) {
  if (!isExternalString(value) || !value.trim()) return "";
  const href = value.trim();
  if (/\p{Cc}/u.test(href)) return "";
  try {
    const url = new URL(href, "https://dspeak.invalid");
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? href : "";
  } catch {
    return "";
  }
}
</script>

<template>
  <div class="chat-markdown min-w-0 max-w-none break-words whitespace-normal">
    <template v-for="(token, idx) in tokens" :key="idx">
      <h1
        v-if="token.type === 'heading' && token.level === 1"
        class="text-3xl font-bold mt-4 mb-2"
      >
        {{ token.content }}
      </h1>
      <h2
        v-else-if="token.type === 'heading' && token.level === 2"
        class="text-2xl font-bold mt-4 mb-2"
      >
        {{ token.content }}
      </h2>
      <h3
        v-else-if="token.type === 'heading' && token.level === 3"
        class="text-xl font-bold mt-3 mb-1"
      >
        {{ token.content }}
      </h3>
      <h4
        v-else-if="token.type === 'heading' && token.level === 4"
        class="text-lg font-bold mt-2 mb-1"
      >
        {{ token.content }}
      </h4>
      <h5
        v-else-if="token.type === 'heading' && token.level === 5"
        class="text-base font-bold mt-2 mb-1"
      >
        {{ token.content }}
      </h5>
      <h6
        v-else-if="token.type === 'heading' && token.level === 6"
        class="text-sm font-bold mt-2 mb-1"
      >
        {{ token.content }}
      </h6>

      <p
        v-else-if="token.type === 'paragraph'"
        class="my-0 whitespace-pre-wrap"
      >
        <span v-for="(node, ni) in renderInline(token.content)" :key="ni">
          <strong v-if="node.type === 'strong'">{{ node.content }}</strong>
          <em v-else-if="node.type === 'em'">{{ node.content }}</em>
          <del v-else-if="node.type === 'del'">{{ node.content }}</del>
          <code
            v-else-if="node.type === 'code'"
            class="px-1.5 py-0.5 bg-base-200 rounded text-sm font-mono"
            >{{ node.content }}</code
          >
          <a
            v-else-if="node.type === 'link' && safeHref(node.href)"
            :href="safeHref(node.href)"
            target="_blank"
            rel="noopener noreferrer"
            class="metro-link"
            >{{ node.text }}</a
          >
          <span v-else-if="node.type === 'image'">{{ node.alt }}</span>
          <span v-else>{{ node.text || node.content }}</span>
        </span>
      </p>

      <pre
        v-else-if="token.type === 'code'"
        class="bg-base-200 p-4 rounded overflow-x-auto my-2"
      >
        <code class="font-mono text-sm" :class="token.lang">{{ token.content }}</code>
      </pre>

      <blockquote
        v-else-if="token.type === 'blockquote'"
        class="border-l-4 border-primary pl-4 my-2 italic text-base-content/80"
      >
        <div
          v-for="(line, li) in token.content.split('\n')"
          :key="li"
          class="my-1"
        >
          <span v-for="(node, ni) in renderInline(line)" :key="ni">
            <strong v-if="node.type === 'strong'">{{ node.content }}</strong>
            <em v-else-if="node.type === 'em'">{{ node.content }}</em>
            <code
              v-else-if="node.type === 'code'"
              class="px-1.5 py-0.5 bg-base-200 rounded text-sm font-mono"
              >{{ node.content }}</code
            >
            <a
              v-else-if="node.type === 'link'"
              :href="node.href"
              target="_blank"
              rel="noopener noreferrer"
              class="metro-link"
              >{{ node.text }}</a
            >
            <span v-else>{{ node.content }}</span>
          </span>
        </div>
      </blockquote>

      <ul
        v-else-if="token.type === 'list' && !token.ordered"
        class="list-disc list-inside my-2 space-y-1"
      >
        <li v-for="(item, li) in token.items" :key="li" class="ml-4">
          <span v-for="(node, ni) in renderInline(item.content)" :key="ni">
            <strong v-if="node.type === 'strong'">{{ node.content }}</strong>
            <em v-else-if="node.type === 'em'">{{ node.content }}</em>
            <code
              v-else-if="node.type === 'code'"
              class="px-1.5 py-0.5 bg-base-200 rounded text-sm font-mono"
              >{{ node.content }}</code
            >
            <a
              v-else-if="node.type === 'link'"
              :href="node.href"
              target="_blank"
              rel="noopener noreferrer"
              class="metro-link"
              >{{ node.text }}</a
            >
            <span v-else>{{ node.content }}</span>
          </span>
          <ul
            v-if="item.nested && item.nested.length > 0"
            class="list-disc list-inside mt-1 ml-4 space-y-1"
          >
            <li
              v-for="(nested, ni) in item.nested[0].items"
              :key="ni"
              class="ml-4"
            >
              <span v-for="(n, nn) in renderInline(nested.content)" :key="nn">
                <strong v-if="n.type === 'strong'">{{ n.content }}</strong>
                <em v-else-if="n.type === 'em'">{{ n.content }}</em>
                <code
                  v-else-if="n.type === 'code'"
                  class="px-1.5 py-0.5 bg-base-200 rounded text-sm font-mono"
                  >{{ n.content }}</code
                >
                <a
                  v-else-if="n.type === 'link'"
                  :href="n.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="metro-link"
                  >{{ n.text }}</a
                >
                <span v-else>{{ n.content }}</span>
              </span>
            </li>
          </ul>
        </li>
      </ul>

      <ol
        v-else-if="token.type === 'list' && token.ordered"
        class="list-decimal list-inside my-2 space-y-1"
      >
        <li v-for="(item, li) in token.items" :key="li" class="ml-4">
          <span v-for="(node, ni) in renderInline(item.content)" :key="ni">
            <strong v-if="node.type === 'strong'">{{ node.content }}</strong>
            <em v-else-if="node.type === 'em'">{{ node.content }}</em>
            <code
              v-else-if="node.type === 'code'"
              class="px-1.5 py-0.5 bg-base-200 rounded text-sm font-mono"
              >{{ node.content }}</code
            >
            <a
              v-else-if="node.type === 'link'"
              :href="node.href"
              target="_blank"
              rel="noopener noreferrer"
              class="metro-link"
              >{{ node.text }}</a
            >
            <span v-else>{{ node.content }}</span>
          </span>
        </li>
      </ol>

      <hr v-else-if="token.type === 'hr'" class="my-4 border-base-300" />

      <br v-else-if="token.type === 'br'" />
    </template>
  </div>
</template>
