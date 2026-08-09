<template>
  <section
    v-if="hasUpdate"
    class="mt-3 border-t border-base-content/10 pt-3 text-sm text-base-content/70"
    aria-label="Update details"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p v-if="snapshot?.sourceUpdateAvailable">
        {{ commitCountLabel }} ahead · latest
        <code class="text-xs text-base-content">{{ latestCommit }}</code>
      </p>
      <p v-else-if="snapshot?.deployedUpdateAvailable">
        A newer deployed build is available.
      </p>
      <p v-else-if="packageUpdate">
        Package v{{ packageUpdate.version || "latest" }} is ready to install.
      </p>
      <button
        class="metro-link text-xs"
        type="button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? "Hide changes" : "View changes" }}
      </button>
    </div>

    <div v-if="expanded" class="mt-3 space-y-3">
      <dl class="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt>Running</dt>
        <dd>
          <code class="text-xs text-base-content">{{ runningCommit }}</code>
          <span v-if="currentBuild?.version" class="ml-2">
            v{{ currentBuild.version }}
          </span>
        </dd>
        <template v-if="snapshot">
          <dt>Repository</dt>
          <dd class="break-all">
            {{ snapshot.repository }}/{{ snapshot.branch }}
          </dd>
        </template>
        <template v-if="packageUpdate">
          <dt>Package</dt>
          <dd>
            v{{ packageUpdate.version || "latest" }}
            <span v-if="packageCommit">
              · commit
              <code class="text-xs text-base-content">{{ packageCommit }}</code>
            </span>
          </dd>
        </template>
      </dl>

      <div v-if="commits.length">
        <h3 class="font-semibold text-base-content">Commits</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="commit in commits" :key="commit.sha" class="flex gap-2">
            <a
              v-if="commit.url"
              class="shrink-0 text-info underline"
              :href="commit.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ commit.shortSha }}
            </a>
            <code v-else class="shrink-0 text-xs text-base-content">
              {{ commit.shortSha }}
            </code>
            <span class="min-w-0 truncate">{{ commit.message }}</span>
          </li>
        </ul>
      </div>

      <div v-if="files.length">
        <h3 class="font-semibold text-base-content">
          Files changed
          <span class="font-normal">({{ fileCountLabel }})</span>
        </h3>
        <ul class="mt-1 space-y-1 font-mono text-xs">
          <li v-for="file in files" :key="file.filename">
            <span class="text-base-content">{{ file.filename }}</span>
            <span class="ml-2 text-success">+{{ file.additions }}</span>
            <span class="ml-1 text-error">-{{ file.deletions }}</span>
          </li>
        </ul>
        <p v-if="snapshot.comparison?.filesTruncated" class="mt-1 text-xs">
          Showing the first {{ files.length }} files.
        </p>
      </div>
    </div>
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

const expanded = ref(false);
const hasUpdate = computed(
  () =>
    Boolean(props.snapshot?.sourceUpdateAvailable) ||
    Boolean(props.snapshot?.deployedUpdateAvailable) ||
    Boolean(props.packageUpdate?.version),
);
const commits = computed(() => props.snapshot?.comparison?.commits || []);
const files = computed(() => props.snapshot?.comparison?.files || []);
const runningCommit = computed(
  () =>
    props.snapshot?.client?.shortCommit ||
    props.currentBuild?.shortCommit ||
    "unknown",
);
const latestCommit = computed(
  () => props.snapshot?.latest?.shortSha || "unknown",
);
const packageCommit = computed(
  () => props.packageUpdate?.commit?.slice(0, 7) || null,
);
const commitCountLabel = computed(() => {
  const count = props.snapshot?.comparison?.aheadBy ?? commits.value.length;
  return `${count} ${count === 1 ? "commit" : "commits"}`;
});
const fileCountLabel = computed(() => {
  const count = props.snapshot?.comparison?.totalFiles ?? files.value.length;
  return `${count} ${count === 1 ? "file" : "files"}`;
});
</script>
