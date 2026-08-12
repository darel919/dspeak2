export type SharedAudioStatsLike =
  | {
      kbps?: unknown;
      level?: unknown;
      dbfs?: unknown;
    }
  | null
  | undefined;

export type SharedAudioAttenuationLike =
  | {
      active?: unknown;
      effectivePercent?: unknown;
      expectedListeners?: unknown;
      reportingListeners?: unknown;
    }
  | null
  | undefined;

export type SharedAudioDuckingLike =
  | {
      active?: unknown;
      effectivePercent?: unknown;
    }
  | null
  | undefined;
