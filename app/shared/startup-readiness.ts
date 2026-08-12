export const STARTUP_READINESS_KEY = Symbol("startup-readiness");
export const STARTUP_READINESS_TIMEOUT_MS = 15_000;

import type {
  StartupReadinessOptions,
  StartupWaitOptions,
} from "./types/shared-utilities.ts";

export function createStartupReadiness({
  onPending,
}: StartupReadinessOptions = {}) {
  const tasks = new Map<number, Promise<void>>();
  let accepting = true;
  let generation = 0;
  let nextTaskId = 0;
  let latestStatus = "";

  function hold(status: string) {
    if (!accepting) return () => {};

    const taskId = ++nextTaskId;
    let releaseTask: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    generation += 1;
    latestStatus = String(status || "");
    tasks.set(taskId, promise);
    onPending?.(latestStatus);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      tasks.delete(taskId);
      releaseTask();
    };
  }

  async function waitForIdle(
    settle?: () => unknown,
    { timeoutMs = STARTUP_READINESS_TIMEOUT_MS }: StartupWaitOptions = {},
  ) {
    const startedAt = Date.now();
    while (accepting) {
      const observedGeneration = generation;
      const pending = Promise.all([...tasks.values()]);
      const remaining = Math.max(timeoutMs - (Date.now() - startedAt), 0);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          pending,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `Startup readiness timed out with ${tasks.size} pending task(s): ${latestStatus || "unknown phase"}`,
                ),
              );
            }, remaining);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      await settle?.();

      if (tasks.size === 0 && generation === observedGeneration) return;
    }
  }

  function seal() {
    accepting = false;
  }

  function status() {
    return latestStatus;
  }

  return {
    hold,
    seal,
    status,
    waitForIdle,
  };
}
