import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVersionState,
  findVersionMismatches,
  normalizeVersion,
  releaseVersionFromTag,
  synchronizeVersionContents,
} from "../scripts/sync-release-version.mjs";

const cargoToml = `[package]\nname = "dspeak-desktop"\nversion = "2.7.0-alpha12"\nedition = "2021"\n\n[dependencies]\n`;
const cargoLock = `[[package]]\nname = "dspeak-desktop"\nversion = "2.7.0-alpha12"\ndependencies = []\n`;

function versionFiles(version = "2.7.0-alpha12") {
  return {
    packageJson: { version },
    packageLock: {
      version,
      packages: { "": { version } },
    },
    tauriConfig: { version },
    cargoToml: cargoToml.replace("2.7.0-alpha12", version),
    cargoLock: cargoLock.replace("2.7.0-alpha12", version),
  };
}

test("release versions accept SemVer and require versioned tags", () => {
  assert.equal(normalizeVersion("v3.0.0-alpha.1"), "3.0.0-alpha.1");
  assert.equal(releaseVersionFromTag("v3.0.0-alpha.1"), "3.0.0-alpha.1");
  assert.throws(() => normalizeVersion("3.0"), /Invalid application version/);
  assert.throws(() => releaseVersionFromTag("3.0.0"), /begin with v/);
});

test("synchronization updates every downstream release manifest", () => {
  const source = versionFiles();
  const next = synchronizeVersionContents({
    version: "3.0.0-alpha.1",
    packageLock: source.packageLock,
    tauriConfig: source.tauriConfig,
    cargoToml: source.cargoToml,
    cargoLock: source.cargoLock,
  });
  const state = extractVersionState({
    packageJson: { version: "3.0.0-alpha.1" },
    packageLock: next.packageLock,
    tauriConfig: next.tauriConfig,
    cargoToml: next.cargoToml,
    cargoLock: next.cargoLock,
  });

  assert.deepEqual(findVersionMismatches(state), []);
  assert.equal(next.tauriConfig.version, "3.0.0-alpha.1");
  assert.match(next.cargoToml, /version = "3\.0\.0-alpha\.1"/);
  assert.match(next.cargoLock, /version = "3\.0\.0-alpha\.1"/);
});

test("mismatches identify the stale downstream manifest", () => {
  const state = extractVersionState(versionFiles());
  state.tauriConfig = "3.0.0-alpha.1";
  assert.deepEqual(findVersionMismatches(state), ["tauriConfig=3.0.0-alpha.1"]);
});

test("synchronization accepts Cargo lockfiles with CRLF line endings", () => {
  const source = versionFiles();
  const next = synchronizeVersionContents({
    version: "3.0.0-alpha.1",
    packageLock: source.packageLock,
    tauriConfig: source.tauriConfig,
    cargoToml: source.cargoToml.replaceAll("\n", "\r\n"),
    cargoLock: source.cargoLock.replaceAll("\n", "\r\n"),
  });
  const state = extractVersionState({
    packageJson: { version: "3.0.0-alpha.1" },
    packageLock: next.packageLock,
    tauriConfig: next.tauriConfig,
    cargoToml: next.cargoToml,
    cargoLock: next.cargoLock,
  });

  assert.deepEqual(findVersionMismatches(state), []);
  assert.match(next.cargoLock, /version = "3\.0\.0-alpha\.1"/);
});
