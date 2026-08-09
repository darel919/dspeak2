import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import {
  normalizeVersion,
  releaseVersionFromTag,
} from "./sync-release-version.mjs";

const assetDirectory = resolve(
  process.env.DSPEAK_RELEASE_ASSET_DIR || "release-assets",
);
const repository = process.env.DSPEAK_UPDATE_REPOSITORY || "darel919/dspeak2";
const tag = process.env.DSPEAK_RELEASE_TAG || process.env.GITHUB_REF_NAME;
const commit = process.env.DSPEAK_RELEASE_COMMIT || "";
const version = normalizeVersion(packageMetadata.version);
const tagVersion = tag ? releaseVersionFromTag(tag) : null;
const requestedVersion = process.env.DSPEAK_RELEASE_VERSION
  ? normalizeVersion(process.env.DSPEAK_RELEASE_VERSION)
  : null;
const releaseBaseUrl =
  process.env.DSPEAK_RELEASE_BASE_URL ||
  `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;

if (!tag || !tagVersion) throw new Error("A release tag is required");
if (tagVersion !== version)
  throw new Error(
    `Release tag ${tag} does not match package version ${version}`,
  );
if (requestedVersion && requestedVersion !== version)
  throw new Error(
    `Requested release version ${requestedVersion} does not match package version ${version}`,
  );
if (!/^[0-9a-f]{40}$/i.test(commit))
  throw new Error("A full release commit is required");

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files;
}

const assets = await filesIn(assetDirectory);

const targets = [
  {
    target: "darwin-aarch64",
    pattern: /\.app\.tar\.gz$/i,
  },
  {
    target: "linux-x86_64",
    pattern: /\.AppImage$/,
  },
  {
    target: "windows-x86_64",
    pattern: /\.nsis\.zip$/i,
  },
];

const platforms = {};
for (const { target, pattern } of targets) {
  const bundle = assets.find((path) => pattern.test(basename(path)));
  if (!bundle) throw new Error(`No updater bundle found for ${target}`);
  const signaturePath = `${bundle}.sig`;
  if (!assets.includes(signaturePath))
    throw new Error(`No updater signature found for ${basename(bundle)}`);
  platforms[target] = {
    url: `${releaseBaseUrl}/${encodeURIComponent(basename(bundle))}`,
    signature: (await readFile(signaturePath, "utf8")).trim(),
  };
}

const manifest = {
  version,
  commit: commit.toLowerCase(),
  notes: process.env.DSPEAK_RELEASE_NOTES || "",
  pub_date: process.env.DSPEAK_RELEASE_DATE || new Date().toISOString(),
  platforms,
};

await writeFile(
  join(assetDirectory, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
