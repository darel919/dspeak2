import type { OwnedErrorValue } from "./types/shared-utilities.ts";

export function reconcileOwnedError(
  currentError: OwnedErrorValue,
  ownedError: OwnedErrorValue,
  nextError: OwnedErrorValue,
) {
  if (nextError) {
    const normalizedError =
      nextError instanceof Error ? nextError.message : String(nextError);
    return { error: normalizedError, ownedError: normalizedError };
  }

  return {
    error: ownedError && currentError === ownedError ? null : currentError,
    ownedError: null,
  };
}
