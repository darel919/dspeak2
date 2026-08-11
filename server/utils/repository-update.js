const DEFAULT_UPDATE_REPOSITORY = "darel919/dspeak2";
const DEFAULT_UPDATE_BRANCH = "next";

function normalizeCommit(value, { short = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const pattern = short ? /^[0-9a-f]{7,40}$/ : /^[0-9a-f]{40}$/;
  return pattern.test(normalized) ? normalized : null;
}

function normalizeRepository(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized
    : DEFAULT_UPDATE_REPOSITORY;
}

function normalizeBranch(value, fallback = DEFAULT_UPDATE_BRANCH) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._/-]{1,200}$/.test(normalized) ? normalized : fallback;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const MAX_COMMITS = 40;
const cache = new Map();
const inFlight = new Map();

function sameCommit(left, right) {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function boundedString(value, limit) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, limit) : null;
}

function githubUrl(repository, resource) {
  return `https://api.github.com/repos/${repository}/${resource}`;
}

function safeGithubUrl(value) {
  const normalized = String(value || "");
  return normalized.startsWith("https://github.com/") ? normalized : null;
}

async function githubJson(repository, resource) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "dSpeak-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.DSPEAK_GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.DSPEAK_GITHUB_TOKEN}`;

  const response = await fetch(githubUrl(repository, resource), {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Repository update request failed with ${response.status}`);
  return response.json();
}

function presentBuild(build) {
  const value = build && typeof build === "object" ? build : {};
  const commit = normalizeCommit(value.commit, { short: true });
  return {
    version: boundedString(value.version, 80),
    commit,
    shortCommit: commit?.slice(0, 7) || null,
    branch: boundedString(value.branch, 200),
    builtAt: boundedString(value.builtAt, 80),
  };
}

function pullRequestFromMessage(message, repository) {
  const match = String(message || "").match(
    /(?:merge pull request\s+#|in\s+#|\(#)(\d{1,9})\b/i,
  );
  if (!match) return null;
  return {
    number: Number(match[1]),
    url: `https://github.com/${repository}/pull/${match[1]}`,
  };
}

function summarizeCommit(value, repository) {
  const commit = value && typeof value === "object" ? value : {};
  const details =
    commit.commit && typeof commit.commit === "object" ? commit.commit : {};
  const sha = normalizeCommit(commit.sha, { short: true });
  if (!sha) return null;
  const author = commit.author?.login || details.author?.name;
  const message = boundedString(
    String(details.message || "").split("\n", 1)[0],
    240,
  );
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    author: boundedString(author, 120),
    date: boundedString(details.author?.date || commit.committer?.date, 80),
    url: safeGithubUrl(commit.html_url),
    pullRequest: pullRequestFromMessage(message, repository),
  };
}

function summarizeLatest(value, repository) {
  return summarizeCommit(value, repository);
}

function summarizeComparison(value, repository) {
  const comparison = value && typeof value === "object" ? value : {};
  const commits = Array.isArray(comparison.commits)
    ? comparison.commits
        .map((commit) => summarizeCommit(commit, repository))
        .filter(Boolean)
        .slice(0, MAX_COMMITS)
    : [];
  return {
    status: boundedString(comparison.status, 40),
    url: safeGithubUrl(comparison.html_url),
    aheadBy: Number.isFinite(Number(comparison.ahead_by))
      ? Number(comparison.ahead_by)
      : null,
    behindBy: Number.isFinite(Number(comparison.behind_by))
      ? Number(comparison.behind_by)
      : null,
    totalCommits: Number.isFinite(Number(comparison.total_commits))
      ? Number(comparison.total_commits)
      : commits.length,
    commits,
  };
}

function cacheKey(repository, branch, clientCommit, deployedCommit) {
  return [
    repository,
    branch,
    clientCommit || "unknown",
    deployedCommit || "unknown",
  ].join("|");
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  while (cache.size > MAX_CACHE_ENTRIES)
    cache.delete(cache.keys().next().value);
}

function createUnavailableSnapshot(
  clientBuild,
  deployedBuild,
  repository,
  branch,
) {
  return {
    status: "unavailable",
    checkedAt: new Date().toISOString(),
    repository,
    branch,
    client: presentBuild(clientBuild),
    deployed: presentBuild(deployedBuild),
    latest: null,
    deployedUpdateAvailable: false,
    sourceUpdateAvailable: false,
    comparison: null,
  };
}

async function queryRepositoryUpdate({
  clientBuild,
  deployedBuild,
  repository,
  branch,
}) {
  const client = presentBuild(clientBuild);
  const deployed = presentBuild(deployedBuild);
  const latestResponse = await githubJson(
    repository,
    `commits/${encodeURIComponent(branch)}`,
  );
  const latest = summarizeLatest(latestResponse, repository);
  if (!latest)
    throw new Error("Repository update response did not include a commit");

  const comparisonBase = client.commit || deployed.commit;
  let comparison = null;
  if (comparisonBase && !sameCommit(comparisonBase, latest.sha)) {
    try {
      const comparisonResponse = await githubJson(
        repository,
        `compare/${encodeURIComponent(`${comparisonBase}...${branch}`)}`,
      );
      comparison = summarizeComparison(comparisonResponse, repository);
    } catch {
      comparison = null;
    }
  }

  const sourceUpdateAvailable = comparison
    ? comparison.aheadBy > 0
    : Boolean(comparisonBase && !sameCommit(comparisonBase, latest.sha));
  const deployedUpdateAvailable = Boolean(
    client.commit &&
    deployed.commit &&
    !sameCommit(client.commit, deployed.commit),
  );

  return {
    status: "ok",
    checkedAt: new Date().toISOString(),
    repository,
    branch,
    client,
    deployed,
    latest,
    deployedUpdateAvailable,
    sourceUpdateAvailable,
    comparison,
  };
}

export async function getRepositoryUpdate({ clientBuild, deployedBuild }) {
  const repository = normalizeRepository(
    process.env.DSPEAK_UPDATE_REPOSITORY || DEFAULT_UPDATE_REPOSITORY,
  );
  const branch = normalizeBranch(
    process.env.DSPEAK_UPDATE_BRANCH || DEFAULT_UPDATE_BRANCH,
  );
  const clientCommit = normalizeCommit(clientBuild?.commit, { short: true });
  const deployedCommit = normalizeCommit(deployedBuild?.commit, {
    short: true,
  });
  const key = cacheKey(repository, branch, clientCommit, deployedCommit);
  const cached = readCache(key);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = queryRepositoryUpdate({
    clientBuild,
    deployedBuild,
    repository,
    branch,
  })
    .then((value) => {
      writeCache(key, value);
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export { createUnavailableSnapshot };
