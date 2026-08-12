export type TopologyReadiness = ReadonlyMap<string, ReadonlySet<string>>;

export interface TopologyEvent {
  epoch?: number | string;
  mode?: string;
  target?: string | null;
  sourceRevision?: number | string;
  preparedEpoch?: number | string | null;
  [key: string]: unknown;
}

export interface PreparedActivation {
  target?: string;
  epoch?: number;
  sourceRevision?: number;
}
