export const DEFAULT_UPDATE_REPOSITORY = "darel919/dspeak2";
export const DEFAULT_UPDATE_BRANCH = "next";

export function normalizeCommit(
  value: unknown,
  { short = false }: CommitOptions = {},
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const pattern = short ? /^[0-9a-f]{7,40}$/ : /^[0-9a-f]{40}$/;
  return pattern.test(normalized) ? normalized : null;
}

export function normalizeRepository(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized
    : DEFAULT_UPDATE_REPOSITORY;
}

export function normalizeBranch(
  value: unknown,
  fallback: string = DEFAULT_UPDATE_BRANCH,
) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._/-]{1,200}$/.test(normalized) ? normalized : fallback;
}

export function createBuildIdentity({
  version,
  commit,
  branch,
  builtAt,
  repository,
  updateBranch,
}: BuildIdentityInput) {
  const normalizedCommit = normalizeCommit(commit);
  const normalizedRepository = normalizeRepository(repository);
  const normalizedBranch = String(branch || "").trim();
  return {
    version: String(version || "unknown"),
    commit: normalizedCommit,
    shortCommit: normalizedCommit?.slice(0, 7) || null,
    branch: /^[A-Za-z0-9._/-]{1,200}$/.test(normalizedBranch)
      ? normalizedBranch
      : null,
    builtAt: String(builtAt || "") || null,
    repository: normalizedRepository,
    updateBranch: normalizeBranch(updateBranch),
  };
}
import type { BuildIdentityInput, CommitOptions } from "./types/app-build.ts";
