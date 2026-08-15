import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

const versionFiles = {
  packageJson: resolve(projectRoot, "package.json"),
  packageLock: resolve(projectRoot, "package-lock.json"),
  tauriConfig: resolve(projectRoot, "desktop/src-tauri/tauri.conf.json"),
  cargoToml: resolve(projectRoot, "desktop/src-tauri/Cargo.toml"),
  cargoLock: resolve(projectRoot, "desktop/src-tauri/Cargo.lock"),
};

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, "\n");
}

export function normalizeVersion(value) {
  const version = String(value || "")
    .trim()
    .replace(/^v/i, "");
  if (!semverPattern.test(version))
    throw new Error(`Invalid application version: ${version || "empty"}`);
  return version;
}

function parseMsiComponent(raw, name, maximum) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum)
    throw new Error(`MSI ${name} version cannot exceed ${maximum}: ${raw}`);
  return value;
}

export function wixVersionFromSemver(value) {
  const version = normalizeVersion(value);
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match)
    throw new Error(
      `Application version cannot be represented as an MSI version: ${version}`,
    );

  const [, majorRaw, minorRaw, patchRaw, prerelease] = match;
  const major = parseMsiComponent(majorRaw, "major", 255);
  const minor = parseMsiComponent(minorRaw, "minor", 255);
  const patch = parseMsiComponent(patchRaw, "patch", 65535);

  if (prerelease === undefined) return `${major}.${minor}.${patch}`;

  const alphaMatch = prerelease.match(/^alpha\.(0|[1-9]\d*)$/);
  if (!alphaMatch)
    throw new Error(
      `Application prerelease cannot be represented as an MSI version: ${version}`,
    );
  const buildRaw = alphaMatch[1];
  const build = Number(buildRaw);
  if (!Number.isSafeInteger(build) || build > 65535)
    throw new Error(`Unsupported MSI prerelease build number: ${buildRaw}`);
  return `${major}.${minor}.${patch}.${build}`;
}

export function releaseVersionFromTag(value) {
  const tag = String(value || "").trim();
  if (!/^v/i.test(tag))
    throw new Error(`Release tag must begin with v: ${tag || "empty"}`);
  return normalizeVersion(tag.slice(1));
}

function replaceCargoPackageVersion(source, version) {
  const normalizedSource = normalizeLineEndings(source);
  const packageMatch = normalizedSource.match(/\[package\][\s\S]*?(?=\n\[|$)/);
  if (!packageMatch) throw new Error("Cargo.toml has no package section");
  const packageSection = packageMatch[0];
  const versionPattern = /(^|\n)version\s*=\s*"[^"]+"/;
  if (!versionPattern.test(packageSection))
    throw new Error("Cargo.toml package version is missing");
  const nextSection = packageSection.replace(
    versionPattern,
    `$1version = "${version}"`,
  );
  return normalizedSource.replace(packageSection, nextSection);
}

function replaceCargoLockPackageVersion(source, version) {
  const normalizedSource = normalizeLineEndings(source);
  const pattern =
    /(\[\[package\]\]\r?\nname = "dspeak-desktop"\r?\nversion = )"[^"]+"/g;
  const matches = [...normalizedSource.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error(
      "Cargo.lock must contain exactly one dspeak-desktop package",
    );
  return normalizedSource.replace(pattern, `$1"${version}"`);
}

function readCargoPackageVersion(source, fileName) {
  const normalizedSource = normalizeLineEndings(source);
  const packageMatch = normalizedSource.match(/\[package\][\s\S]*?(?=\n\[|$)/);
  const version = packageMatch?.[0].match(/(^|\n)version\s*=\s*"([^"]+)"/)?.[2];
  if (!version) throw new Error(`${fileName} package version is missing`);
  return version;
}

function readCargoLockPackageVersion(source) {
  const normalizedSource = normalizeLineEndings(source);
  const version = normalizedSource.match(
    /\[\[package\]\]\r?\nname = "dspeak-desktop"\r?\nversion = "([^"]+)"/,
  )?.[1];
  if (!version) throw new Error("Cargo.lock dspeak-desktop version is missing");
  return version;
}

export function extractVersionState({
  packageJson,
  packageLock,
  tauriConfig,
  cargoToml,
  cargoLock,
}) {
  return {
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages?.[""]?.version,
    tauriConfig: tauriConfig.version,
    cargoToml: readCargoPackageVersion(cargoToml, "Cargo.toml"),
    cargoLock: readCargoLockPackageVersion(cargoLock),
  };
}

export function findVersionMismatches(state) {
  const entries = Object.entries(state);
  const canonicalVersion = state.packageJson;
  return entries
    .filter(([, version]) => version !== canonicalVersion)
    .map(([file, version]) => `${file}=${version || "missing"}`);
}

export function findWixVersionMismatches({ canonicalVersion, tauriConfig }) {
  const expectedVersion = wixVersionFromSemver(canonicalVersion);
  const actualVersion = tauriConfig.bundle?.windows?.wix?.version;
  if (actualVersion === expectedVersion) return [];
  return [
    `tauriConfig.bundle.windows.wix.version=${actualVersion || "missing"} (expected ${expectedVersion})`,
  ];
}

export function synchronizeVersionContents({
  version,
  packageJson,
  packageLock,
  tauriConfig,
  cargoToml,
  cargoLock,
}) {
  const normalizedVersion = normalizeVersion(version);
  const wixVersion = wixVersionFromSemver(normalizedVersion);
  return {
    packageJson: {
      ...packageJson,
      version: normalizedVersion,
    },
    packageLock: {
      ...packageLock,
      version: normalizedVersion,
      packages: {
        ...packageLock.packages,
        "": {
          ...packageLock.packages?.[""],
          version: normalizedVersion,
        },
      },
    },
    tauriConfig: {
      ...tauriConfig,
      version: normalizedVersion,
      bundle: {
        ...(tauriConfig.bundle ?? {}),
        windows: {
          ...(tauriConfig.bundle?.windows ?? {}),
          wix: {
            ...(tauriConfig.bundle?.windows?.wix ?? {}),
            version: wixVersion,
          },
        },
      },
    },
    cargoToml: replaceCargoPackageVersion(cargoToml, normalizedVersion),
    cargoLock: replaceCargoLockPackageVersion(cargoLock, normalizedVersion),
  };
}

async function readVersionFiles() {
  const [packageJson, packageLock, tauriConfig, cargoToml, cargoLock] =
    await Promise.all([
      readFile(versionFiles.packageJson, "utf8"),
      readFile(versionFiles.packageLock, "utf8"),
      readFile(versionFiles.tauriConfig, "utf8"),
      readFile(versionFiles.cargoToml, "utf8"),
      readFile(versionFiles.cargoLock, "utf8"),
    ]);

  const parsedPackageJson = JSON.parse(packageJson);
  const parsedPackageLock = JSON.parse(packageLock);
  const parsedTauriConfig = JSON.parse(tauriConfig);

  return {
    raw: {
      packageLock,
      tauriConfig,
      cargoToml,
      cargoLock,
    },
    parsed: {
      packageJson: parsedPackageJson,
      packageLock: parsedPackageLock,
      tauriConfig: parsedTauriConfig,
    },
    state: extractVersionState({
      packageJson: parsedPackageJson,
      packageLock: parsedPackageLock,
      tauriConfig: parsedTauriConfig,
      cargoToml,
      cargoLock,
    }),
  };
}

async function writeSynchronizedFiles(files) {
  await Promise.all([
    writeFile(
      versionFiles.packageJson,
      `${JSON.stringify(files.packageJson, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      versionFiles.packageLock,
      `${JSON.stringify(files.packageLock, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      versionFiles.tauriConfig,
      `${JSON.stringify(files.tauriConfig, null, 2)}\n`,
      "utf8",
    ),
    writeFile(versionFiles.cargoToml, files.cargoToml, "utf8"),
    writeFile(versionFiles.cargoLock, files.cargoLock, "utf8"),
  ]);
}

function releaseTagFromArguments(args) {
  const tagIndex = args.indexOf("--tag");
  if (tagIndex >= 0) return args[tagIndex + 1] || "";
  return process.env.DSPEAK_RELEASE_TAG || "";
}

export async function main(args = process.argv.slice(2)) {
  const write = args.includes("--write");
  const files = await readVersionFiles();
  const canonicalVersion = normalizeVersion(files.state.packageJson);
  const releaseTag = releaseTagFromArguments(args);
  const releaseVersion = releaseTag
    ? releaseVersionFromTag(releaseTag)
    : canonicalVersion;

  if (releaseTag && !write && releaseVersion !== canonicalVersion)
    throw new Error(
      `Release tag ${releaseTag} does not match package version ${canonicalVersion}`,
    );

  if (write) {
    const synchronized = synchronizeVersionContents({
      version: releaseVersion,
      packageJson: files.parsed.packageJson,
      packageLock: files.parsed.packageLock,
      tauriConfig: files.parsed.tauriConfig,
      cargoToml: files.raw.cargoToml,
      cargoLock: files.raw.cargoLock,
    });
    await writeSynchronizedFiles(synchronized);
  }

  const nextFiles = write ? await readVersionFiles() : files;
  const mismatches = findVersionMismatches(nextFiles.state);
  if (mismatches.length)
    throw new Error(
      `Release versions are not synchronized with package.json: ${mismatches.join(", ")}`,
    );
  const wixMismatches = findWixVersionMismatches({
    canonicalVersion: nextFiles.state.packageJson,
    tauriConfig: nextFiles.parsed.tauriConfig,
  });
  if (wixMismatches.length)
    throw new Error(
      `WiX release version is not synchronized with package.json: ${wixMismatches.join(", ")}`,
    );

  console.log(
    `Release version ${releaseVersion} is synchronized${releaseTag ? ` for ${releaseTag}` : ""}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
