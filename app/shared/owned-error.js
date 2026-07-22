export function reconcileOwnedError(currentError, ownedError, nextError) {
  if (nextError) {
    const normalizedError = String(nextError);
    return { error: normalizedError, ownedError: normalizedError };
  }

  return {
    error: ownedError && currentError === ownedError ? null : currentError,
    ownedError: null,
  };
}
