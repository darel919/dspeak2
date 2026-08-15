import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVersionState,
  findVersionMismatches,
  findWixVersionMismatches,
  normalizeVersion,
  releaseVersionFromTag,
  synchronizeVersionContents,
  wixVersionFromSemver,
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

test("WiX versions derive numeric MSI-compatible prerelease builds", () => {
  assert.equal(wixVersionFromSemver("3.0.0-alpha.1"), "3.0.0.1");
  assert.equal(wixVersionFromSemver("3.0.0-alpha.25"), "3.0.0.25");
  assert.equal(wixVersionFromSemver("3.0.0"), "3.0.0");
  assert.throws(
    () => wixVersionFromSemver("3.0.0-alpha.foo"),
    /cannot be represented as an MSI version/,
  );
  assert.throws(
    () => wixVersionFromSemver("3.0.0-alpha.65536"),
    /Unsupported MSI prerelease build number: 65536/,
  );
});

test("synchronization updates every downstream release manifest", () => {
  const source = versionFiles();
  const next = synchronizeVersionContents({
    version: "3.0.0-alpha.1",
    packageJson: source.packageJson,
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
  assert.deepEqual(
    findWixVersionMismatches({
      canonicalVersion: "3.0.0-alpha.1",
      tauriConfig: next.tauriConfig,
    }),
    [],
  );
  assert.equal(next.packageJson.version, "3.0.0-alpha.1");
  assert.equal(next.tauriConfig.version, "3.0.0-alpha.1");
  assert.equal(next.tauriConfig.bundle.windows.wix.version, "3.0.0.1");
  assert.match(next.cargoToml, /version = "3\.0\.0-alpha\.1"/);
  assert.match(next.cargoLock, /version = "3\.0\.0-alpha\.1"/);
});

test("synchronization preserves existing Windows WiX configuration", () => {
  const source = versionFiles();
  source.tauriConfig = {
    ...source.tauriConfig,
    bundle: {
      windows: {
        wix: {
          language: "en-US",
        },
      },
    },
  };
  const next = synchronizeVersionContents({
    version: "3.0.0-alpha.1",
    packageJson: source.packageJson,
    packageLock: source.packageLock,
    tauriConfig: source.tauriConfig,
    cargoToml: source.cargoToml,
    cargoLock: source.cargoLock,
  });

  assert.deepEqual(next.tauriConfig.bundle.windows.wix, {
    language: "en-US",
    version: "3.0.0.1",
  });
});

test("synchronization is idempotent for an already current Cargo manifest", () => {
  const source = versionFiles("3.0.0-alpha.1");
  const next = synchronizeVersionContents({
    version: "3.0.0-alpha.1",
    packageJson: source.packageJson,
    packageLock: source.packageLock,
    tauriConfig: source.tauriConfig,
    cargoToml: source.cargoToml,
    cargoLock: source.cargoLock,
  });

  assert.equal(next.cargoToml, source.cargoToml);
  assert.equal(next.cargoLock, source.cargoLock);
  assert.deepEqual(
    findVersionMismatches(
      extractVersionState({
        packageJson: { version: "3.0.0-alpha.1" },
        packageLock: next.packageLock,
        tauriConfig: next.tauriConfig,
        cargoToml: next.cargoToml,
        cargoLock: next.cargoLock,
      }),
    ),
    [],
  );
});

test("mismatches identify the stale downstream manifest", () => {
  const state = extractVersionState(versionFiles());
  state.tauriConfig = "3.0.0-alpha.1";
  assert.deepEqual(findVersionMismatches(state), ["tauriConfig=3.0.0-alpha.1"]);
});

test("WiX mismatches are validated separately from canonical versions", () => {
  assert.deepEqual(
    findWixVersionMismatches({
      canonicalVersion: "3.0.0-alpha.1",
      tauriConfig: { version: "3.0.0-alpha.1" },
    }),
    ["tauriConfig.bundle.windows.wix.version=missing (expected 3.0.0.1)"],
  );
});

test("synchronization accepts alternate Cargo line endings", () => {
  for (const lineEnding of ["\r\n", "\r"]) {
    const source = versionFiles();
    const next = synchronizeVersionContents({
      version: "3.0.0-alpha.1",
      packageJson: source.packageJson,
      packageLock: source.packageLock,
      tauriConfig: source.tauriConfig,
      cargoToml: source.cargoToml.replaceAll("\n", lineEnding),
      cargoLock: source.cargoLock.replaceAll("\n", lineEnding),
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
  }
});
