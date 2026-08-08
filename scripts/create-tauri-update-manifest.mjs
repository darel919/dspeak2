import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const assetDirectory = resolve(
  process.env.DSPEAK_RELEASE_ASSET_DIR || "release-assets",
);
const repository = process.env.DSPEAK_UPDATE_REPOSITORY || "darel919/dspeak2";
const tag = process.env.DSPEAK_RELEASE_TAG || process.env.GITHUB_REF_NAME;
const commit = process.env.DSPEAK_RELEASE_COMMIT || "";
const version = (process.env.DSPEAK_RELEASE_VERSION || tag || "").replace(
  /^v/i,
  "",
);
const releaseBaseUrl =
  process.env.DSPEAK_RELEASE_BASE_URL ||
  `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;

if (!tag || !version) throw new Error("A release tag and version are required");
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
