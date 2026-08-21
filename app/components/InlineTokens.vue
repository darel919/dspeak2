<template>
  <template v-for="(token, index) in tokens" :key="index">
    <template v-if="token.type === 'text'">
      <template v-if="token.tokens">
        <InlineTokens :tokens="token.tokens" />
      </template>
      <template v-else>{{ token.text }}</template>
    </template>

    <strong v-else-if="token.type === 'strong'" class="font-semibold">
      <InlineTokens :tokens="token.tokens" />
    </strong>

    <em v-else-if="token.type === 'em'" class="italic">
      <InlineTokens :tokens="token.tokens" />
    </em>

    <del v-else-if="token.type === 'del'" class="line-through">
      <InlineTokens :tokens="token.tokens" />
    </del>

    <code
      v-else-if="token.type === 'codespan'"
      class="rounded bg-base-200 px-1.5 py-0.5 text-sm font-mono"
      >{{ token.text }}</code
    >

    <a
      v-else-if="token.type === 'link' && safeHref(token.href)"
      class="metro-link"
      :href="safeHref(token.href)"
      rel="noopener noreferrer"
      target="_blank"
    >
      <InlineTokens :tokens="token.tokens" />
    </a>

    <span v-else-if="token.type === 'link'">
      <InlineTokens :tokens="token.tokens" />
    </span>

    <br v-else-if="token.type === 'br'" />
  </template>
</template>

<script setup>
import { isExternalString } from "../shared/types/boundary.ts";

defineProps({
  tokens: { type: Array, required: true },
});

function safeHref(value) {
  if (!isExternalString(value) || !value.trim()) return "";
  const href = value.trim();
  if (/\p{Cc}/u.test(href)) return "";
  try {
    const url = new URL(href, "https://dspeak.invalid");
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return "";
    return href;
  } catch {
    return "";
  }
}
</script>
