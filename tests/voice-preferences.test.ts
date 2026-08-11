import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveVoicePreferences } from "../app/shared/voice-preferences.ts";

test("saved microphone-on and deafen-off state is restored", () => {
  assert.deepEqual(resolveVoicePreferences("false", "false"), {
    micMuted: false,
    deafened: false,
  });
});

test("saved deafen state always restores with the microphone muted", () => {
  assert.deepEqual(resolveVoicePreferences("false", "true"), {
    micMuted: true,
    deafened: true,
  });
});

test("missing saved values preserve the supplied defaults", () => {
  assert.deepEqual(
    resolveVoicePreferences(null, null, {
      micMuted: true,
      deafened: false,
    }),
    { micMuted: true, deafened: false },
  );
});

test("browser voice preferences are not replaced by the SSR Pinia snapshot", async () => {
  const source = await readFile("app/stores/voice.ts", "utf8");
  assert.match(source, /import \{ defineStore, skipHydrate \} from "pinia"/);
  assert.match(source, /const micMuted = skipHydrate\(ref\(true\)\)/);
  assert.match(source, /const deafened = skipHydrate\(ref\(false\)\)/);
});
