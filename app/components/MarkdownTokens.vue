<template>
  <template v-for="(token, index) in tokens" :key="index">
    <template v-if="token.type === 'heading'">
      <h1 v-if="token.depth === 1" class="text-3xl font-bold">
        <InlineTokens :tokens="token.tokens" />
      </h1>
      <h2 v-else-if="token.depth === 2" class="mt-10 text-xl font-semibold">
        <InlineTokens :tokens="token.tokens" />
      </h2>
      <h3 v-else-if="token.depth === 3" class="mt-6 text-lg font-medium">
        <InlineTokens :tokens="token.tokens" />
      </h3>
      <h4 v-else class="mt-4 text-base font-semibold">
        <InlineTokens :tokens="token.tokens" />
      </h4>
    </template>

    <p v-else-if="token.type === 'paragraph'" class="mt-2 leading-relaxed">
      <InlineTokens :tokens="token.tokens" />
    </p>

    <ul
      v-else-if="token.type === 'list' && !token.ordered"
      class="mt-2 list-disc space-y-1 pl-6"
    >
      <li v-for="(item, i) in token.items" :key="i" class="leading-relaxed">
        <InlineTokens :tokens="item.tokens" />
      </li>
    </ul>

    <ol
      v-else-if="token.type === 'list' && token.ordered"
      class="mt-2 list-decimal space-y-1 pl-6"
    >
      <li v-for="(item, i) in token.items" :key="i" class="leading-relaxed">
        <InlineTokens :tokens="item.tokens" />
      </li>
    </ol>

    <blockquote
      v-else-if="token.type === 'blockquote'"
      class="mt-4 border-l-4 border-base-300 pl-4 text-base-content/70 italic"
    >
      <MarkdownTokens :tokens="token.tokens" />
    </blockquote>

    <div v-else-if="token.type === 'table'" class="mt-4 overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-base-300 text-left">
            <th
              v-for="(cell, i) in token.header"
              :key="i"
              class="py-2 pr-4 font-medium"
            >
              <InlineTokens :tokens="cell.tokens" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in token.rows"
            :key="ri"
            class="border-b border-base-200"
          >
            <td v-for="(cell, ci) in row" :key="ci" class="py-2 pr-4">
              <InlineTokens :tokens="cell.tokens" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <pre
      v-else-if="token.type === 'code'"
      class="mt-4 overflow-x-auto rounded-box bg-base-200 p-4 text-sm"
    ><code>{{ token.text }}</code></pre>

    <div v-else-if="token.type === 'space'" class="h-4" />
  </template>
</template>

<script setup>
defineProps({
  tokens: { type: Array, required: true },
});
</script>
