<template>
  <section
    v-if="hasUpdate"
    class="mt-3 border-t border-base-content/10 pt-3 text-sm text-base-content/70"
    aria-label="Update details"
  >
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 class="font-semibold text-base-content">What's changed</h3>
      <a
        v-if="changelogUrl"
        class="metro-link text-xs"
        :href="changelogUrl"
        target="_blank"
        rel="noreferrer"
      >
        Full changelog
      </a>
    </div>

    <ul v-if="visibleCommits.length" class="mt-2 space-y-2">
      <li
        v-for="commit in visibleCommits"
        :key="commit.sha"
        class="flex items-start gap-2"
      >
        <span class="mt-0.5 text-base-content/50" aria-hidden="true">•</span>
        <div class="min-w-0 flex-1">
          <p class="break-words text-base-content">
            {{ commit.message || "Repository update" }}
          </p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            <a
              v-if="commit.pullRequest?.url"
              class="metro-link"
              :href="commit.pullRequest.url"
              target="_blank"
              rel="noreferrer"
            >
              PR #{{ commit.pullRequest.number }}
            </a>
            <a
              v-else-if="commit.url"
              class="metro-link"
              :href="commit.url"
              target="_blank"
              rel="noreferrer"
            >
              Commit {{ commit.shortSha }}
            </a>
            <span v-if="commit.author">by {{ commit.author }}</span>
          </p>
        </div>
      </li>
    </ul>
    <p
      v-else-if="releaseNotes"
      class="mt-2 whitespace-pre-line text-base-content"
    >
      {{ releaseNotes }}
    </p>
    <p v-else-if="latestCommit" class="mt-2 text-xs">
      Latest commit
      <code class="text-base-content">{{ latestCommit }}</code>
    </p>
    <p v-if="remainingCommitCount" class="mt-2 text-xs">
      {{ remainingCommitCount }} more
      {{ remainingCommitCount === 1 ? "commit" : "commits" }} in this update.
    </p>
    <p v-if="versionSummary" class="mt-2 text-xs">
      {{ versionSummary }}
    </p>
  </section>
</template>

<script setup>
const props = defineProps({
  snapshot: {
    type: Object,
    default: null,
  },
  currentBuild: {
    type: Object,
    default: () => ({}),
  },
  packageUpdate: {
    type: Object,
    default: null,
  },
});

const hasUpdate = computed(
  () =>
    Boolean(props.snapshot?.sourceUpdateAvailable) ||
    Boolean(props.snapshot?.deployedUpdateAvailable) ||
    Boolean(props.packageUpdate?.version),
);
const commits = computed(() => props.snapshot?.comparison?.commits || []);
const visibleCommits = computed(() => commits.value.slice(0, 5));
const latestCommit = computed(() => props.snapshot?.latest?.shortSha || null);
const changelogUrl = computed(() => props.snapshot?.comparison?.url || null);
const releaseNotes = computed(() => {
  const notes = String(props.packageUpdate?.body || "").trim();
  return notes || null;
});
const remainingCommitCount = computed(() => {
  const total = props.snapshot?.comparison?.aheadBy ?? commits.value.length;
  return Math.max(Number(total) - visibleCommits.value.length, 0);
});
const versionSummary = computed(() => {
  const current = props.currentBuild?.version;
  const next =
    props.packageUpdate?.version || props.snapshot?.deployed?.version;
  if (!current && !next) return null;
  if (!current) return `Version ${next} is ready.`;
  if (!next || current === next) return `Running version ${current}.`;
  return `Version ${current} → ${next}.`;
});
</script>
