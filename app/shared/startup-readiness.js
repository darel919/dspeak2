export const STARTUP_READINESS_KEY = Symbol("startup-readiness");

export function createStartupReadiness({ onPending } = {}) {
  const tasks = new Map();
  let accepting = true;
  let generation = 0;
  let nextTaskId = 0;
  let latestStatus = "";

  function hold(status) {
    if (!accepting) return () => {};

    const taskId = ++nextTaskId;
    let releaseTask;
    const promise = new Promise((resolve) => {
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

  async function waitForIdle(settle) {
    while (accepting) {
      const observedGeneration = generation;
      await Promise.all([...tasks.values()]);
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
