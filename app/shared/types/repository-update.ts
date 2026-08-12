export interface RepositoryUpdateSnapshot {
  status?: string;
  deployedUpdateAvailable?: boolean;
  sourceUpdateAvailable?: boolean;
  [key: string]: unknown;
}
export interface RepositoryBuildMetadata {
  commit?: unknown;
  [key: string]: unknown;
}
