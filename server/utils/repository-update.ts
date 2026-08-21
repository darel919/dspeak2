import type {
  BuildSnapshotInput,
  CommitNormalizationOptions,
  CommitSummary,
  ComparisonSummary,
  PresentedBuild,
  RepositoryQueryInput,
  RepositoryUpdateInput,
  RepositoryUpdateSnapshot,
  UnknownRecord,
} from "../types/repository-update.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";

const DEFAULT_UPDATE_REPOSITORY = "darel919/dspeak2";
const DEFAULT_UPDATE_BRANCH = "next";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const MAX_COMMITS = 40;

const cache = new Map<
  string,
  { expiresAt: number; value: RepositoryUpdateSnapshot }
>();
const inFlight = new Map<string, Promise<RepositoryUpdateSnapshot>>();

function asRecord(value: ExternalField | undefined): UnknownRecord {
  return parseExternalRecord(value) ?? {};
}

function stringValue(value: ExternalField | undefined): string | null {
  const text = parseExternalString(value);
  if (text !== null) return text;
  const number = parseExternalNumber(value);
  return number === null ? null : String(number);
}

function numberValue(value: ExternalField | undefined): number | null {
  return parseExternalNumber(value);
}

function normalizeCommit(
  value: ExternalField | undefined,
  { short = false }: CommitNormalizationOptions = {},
): string | null {
  const normalized = (parseExternalString(value) || "").trim().toLowerCase();
  const pattern = short ? /^[0-9a-f]{7,40}$/ : /^[0-9a-f]{40}$/;
  return pattern.test(normalized) ? normalized : null;
}

function normalizeRepository(value: ExternalField | undefined): string {
  const normalized = (stringValue(value) || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized
    : DEFAULT_UPDATE_REPOSITORY;
}

function normalizeBranch(
  value: ExternalField | undefined,
  fallback: string = DEFAULT_UPDATE_BRANCH,
): string {
  const normalized = (stringValue(value) || "").trim();
  return /^[A-Za-z0-9._/-]{1,200}$/.test(normalized) ? normalized : fallback;
}

function sameCommit(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function boundedString(
  value: ExternalField | undefined,
  limit: number,
): string | null {
  const normalized = (stringValue(value) || "").trim();
  return normalized ? normalized.slice(0, limit) : null;
}

function githubUrl(repository: string, resource: string): string {
  return `https://api.github.com/repos/${repository}/${resource}`;
}

function safeGithubUrl(value: ExternalField | undefined): string | null {
  const normalized = stringValue(value) || "";
  return normalized.startsWith("https://github.com/") ? normalized : null;
}

async function githubJson(
  repository: string,
  resource: string,
): Promise<ExternalField> {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "dSpeak-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (process.env.DSPEAK_GITHUB_TOKEN)
    headers.set("Authorization", `Bearer ${process.env.DSPEAK_GITHUB_TOKEN}`);

  const response = await fetch(githubUrl(repository, resource), {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Repository update request failed with ${response.status}`);
  return response.json();
}

function presentBuild(build: BuildSnapshotInput | undefined): PresentedBuild {
  const value = asRecord(build);
  const commit = normalizeCommit(value.commit, { short: true });
  return {
    version: boundedString(value.version, 80),
    commit,
    shortCommit: commit?.slice(0, 7) || null,
    branch: boundedString(value.branch, 200),
    builtAt: boundedString(value.builtAt, 80),
  };
}

function pullRequestFromMessage(
  message: string | null,
  repository: string,
): { number: number; url: string } | null {
  const match = String(message || "").match(
    /(?:merge pull request\s+#|in\s+#|\(#)(\d{1,9})\b/i,
  );
  if (!match) return null;
  return {
    number: Number(match[1]),
    url: `https://github.com/${repository}/pull/${match[1]}`,
  };
}

function summarizeCommit(
  value: ExternalField,
  repository: string,
): CommitSummary | null {
  const commit = asRecord(value);
  const details = asRecord(commit.commit);
  const detailsAuthor = asRecord(details.author);
  const authorRecord = asRecord(commit.author);
  const committerRecord = asRecord(commit.committer);
  const sha = normalizeCommit(commit.sha, { short: true });
  if (!sha) return null;
  const author = authorRecord.login || detailsAuthor.name;
  const message = boundedString(
    (stringValue(details.message) || "").split("\n", 1)[0],
    240,
  );
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    author: boundedString(author, 120),
    date: boundedString(detailsAuthor.date || committerRecord.date, 80),
    url: safeGithubUrl(commit.html_url),
    pullRequest: pullRequestFromMessage(message, repository),
  };
}

function summarizeLatest(
  value: ExternalField,
  repository: string,
): CommitSummary | null {
  return summarizeCommit(value, repository);
}

function summarizeComparison(
  value: ExternalField,
  repository: string,
): ComparisonSummary {
  const comparison = asRecord(value);
  const commits = Array.isArray(comparison.commits)
    ? comparison.commits
        .flatMap((commit) => {
          const summary = summarizeCommit(commit, repository);
          return summary ? [summary] : [];
        })
        .slice(0, MAX_COMMITS)
    : [];
  return {
    status: boundedString(comparison.status, 40),
    url: safeGithubUrl(comparison.html_url),
    aheadBy: numberValue(comparison.ahead_by),
    behindBy: numberValue(comparison.behind_by),
    totalCommits: numberValue(comparison.total_commits) ?? commits.length,
    commits,
  };
}

function cacheKey(
  repository: string,
  branch: string,
  clientCommit: string | null,
  deployedCommit: string | null,
): string {
  return [
    repository,
    branch,
    clientCommit || "unknown",
    deployedCommit || "unknown",
  ].join("|");
}

function readCache(key: string): RepositoryUpdateSnapshot | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: RepositoryUpdateSnapshot): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function createUnavailableSnapshot(
  clientBuild: BuildSnapshotInput | undefined,
  deployedBuild: BuildSnapshotInput | undefined,
  repository: string,
  branch: string,
): RepositoryUpdateSnapshot {
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
}: RepositoryQueryInput): Promise<RepositoryUpdateSnapshot> {
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
  let comparison: ComparisonSummary | null = null;
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
    ? (comparison.aheadBy ?? 0) > 0
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

export async function getRepositoryUpdate({
  clientBuild,
  deployedBuild,
}: RepositoryUpdateInput): Promise<RepositoryUpdateSnapshot> {
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
  const pending = inFlight.get(key);
  if (pending) return pending;

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
