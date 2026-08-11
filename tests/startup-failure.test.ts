import test from "node:test";
import assert from "node:assert/strict";
import { terminateFailedStartup } from "../server/utils/startup-failure.ts";

test("failed startup cleans partial runtime state and exits unsuccessfully", async () => {
  const events = [];
  const failure = new Error("invalid production configuration");
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await assert.rejects(
      terminateFailedStartup(failure, {
        closeRuntime: async () => events.push("runtime-closed"),
        exit: (code) => events.push(`exit-${code}`),
        stopBackground: () => events.push("background-stopped"),
      }),
      failure,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(events, ["background-stopped", "runtime-closed", "exit-1"]);
});

test("failed startup still exits when partial runtime cleanup rejects", async () => {
  const exitCodes = [];
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await assert.rejects(
      terminateFailedStartup(new Error("startup failed"), {
        closeRuntime: async () => {
          throw new Error("cleanup failed");
        },
        exit: (code) => exitCodes.push(code),
      }),
      /startup failed/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(exitCodes, [1]);
});
