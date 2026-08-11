import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "../app/shared/copy-to-clipboard.ts";

test("copy helper uses the asynchronous clipboard API when available", async () => {
  let copied = null;
  const result = await copyTextToClipboard("report", {
    navigatorObject: {
      clipboard: {
        writeText: async (text) => {
          copied = text;
        },
      },
    },
  });

  assert.equal(result, true);
  assert.equal(copied, "report");
});

test("copy helper falls back to the document command after clipboard rejection", async () => {
  let command = null;
  let removed = false;
  const textarea = {
    style: {},
    setAttribute() {},
    select() {},
    remove() {
      removed = true;
    },
  };
  const result = await copyTextToClipboard("report", {
    navigatorObject: {
      clipboard: {
        writeText: async () => {
          throw new Error("permission denied");
        },
      },
    },
    documentObject: {
      body: { appendChild() {} },
      createElement: () => textarea,
      execCommand: (value) => {
        command = value;
        return true;
      },
    },
  });

  assert.equal(result, true);
  assert.equal(command, "copy");
  assert.equal(removed, true);
});

test("copy helper reports unavailable clipboard capabilities", async () => {
  assert.equal(
    await copyTextToClipboard("report", {
      navigatorObject: {},
      documentObject: null,
    }),
    false,
  );
});
