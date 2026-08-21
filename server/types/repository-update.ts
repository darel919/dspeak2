import type {
  ExternalField,
  ExternalRecord,
} from "../../shared/types/external.ts";

export type UnknownRecord = ExternalRecord;

export interface BuildSnapshotInput {
  version?: ExternalField;
  commit?: ExternalField;
  branch?: ExternalField;
  builtAt?: ExternalField;
  repository?: ExternalField;
  updateBranch?: ExternalField;
}

export interface PresentedBuild {
  version: string | null;
  commit: string | null;
  shortCommit: string | null;
  branch: string | null;
  builtAt: string | null;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string | null;
  author: string | null;
  date: string | null;
  url: string | null;
  pullRequest: { number: number; url: string } | null;
}

export interface ComparisonSummary {
  status: string | null;
  url: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  totalCommits: number;
  commits: CommitSummary[];
}

export interface RepositoryUpdateSnapshot {
  status: "ok" | "unavailable";
  checkedAt: string;
  repository: string;
  branch: string;
  client: PresentedBuild;
  deployed: PresentedBuild;
  latest: CommitSummary | null;
  deployedUpdateAvailable: boolean;
  sourceUpdateAvailable: boolean;
  comparison: ComparisonSummary | null;
}

export interface RepositoryUpdateInput {
  clientBuild?: BuildSnapshotInput;
  deployedBuild?: BuildSnapshotInput;
}

export interface RepositoryQueryInput extends RepositoryUpdateInput {
  repository: string;
  branch: string;
}

export interface CommitNormalizationOptions {
  short?: boolean;
}
