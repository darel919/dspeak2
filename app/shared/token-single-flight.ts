type ActiveFlight<T> = {
  token: string;
  promise: Promise<T>;
};

export function createTokenSingleFlight<T>(
  run: (token: string) => Promise<T>,
): (token: string) => Promise<T> {
  let activeFlight: ActiveFlight<T> | null = null;

  return async function runSingleFlight(token: string): Promise<T> {
    while (activeFlight) {
      const existingFlight = activeFlight;
      try {
        const result = await existingFlight.promise;
        if (existingFlight.token === token) return result;
      } catch (error) {
        if (existingFlight.token === token) throw error;
      }
    }

    const promise = run(token);
    activeFlight = { token, promise };
    const clearFlight = () => {
      if (activeFlight?.promise === promise) activeFlight = null;
    };
    void promise.then(clearFlight, clearFlight);
    return promise;
  };
}
