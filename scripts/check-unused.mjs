import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const targetFiles = [
  "app/shared/cloudflare-realtime-session.ts",
  "app/shared/hybrid-media-topology-controller.ts",
  "app/shared/mediasoup-client-session.ts",
  "app/shared/native-cloudflare-realtime-session.ts",
  "app/shared/native-mediasoup-session.ts",
  "app/shared/native-p2p-session.ts",
  "app/shared/native-p2p.ts",
  "app/stores/chat.ts",
  "server/utils/dspeak-api.ts",
  "server/utils/dspeak-channel-api.ts",
  "server/utils/dspeak-chat-api.ts",
  "server/utils/dspeak-profile-api.ts",
];

for (const directory of [
  "app/shared/cloudflare-realtime-session",
  "app/shared/hybrid-media-topology-controller",
  "app/shared/mediasoup-client-session",
  "app/shared/native-cloudflare-realtime-session",
  "app/shared/native-mediasoup-session",
  "app/shared/native-p2p-session",
  "app/shared/native-p2p",
  "app/stores/chat",
  "server/utils/dspeak-chat-api",
]) {
  const absoluteDirectory = resolve(projectRoot, directory);
  if (!existsSync(absoluteDirectory)) continue;
  const entries = ts.sys.readDirectory(absoluteDirectory, [".ts"], undefined, [
    "**/*",
  ]);
  targetFiles.push(
    ...entries.map((file) => file.slice(projectRoot.length + 1)),
  );
}

const unusedCodes = new Set([6133, 6192, 6193, 6196, 6198, 6200, 7027, 7028]);
const targetPaths = new Set(
  targetFiles.map((file) => resolve(projectRoot, file)),
);
const diagnostics = [];

for (const configName of [
  ".nuxt/tsconfig.app.json",
  ".nuxt/tsconfig.server.json",
]) {
  const configPath = resolve(projectRoot, configName);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    diagnostics.push(config.error);
    continue;
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    {
      allowJs: true,
      checkJs: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
    },
    configPath,
  );
  const rootNames = parsed.fileNames.filter((file) =>
    targetPaths.has(resolve(file)),
  );
  if (!rootNames.length) continue;
  const program = ts.createProgram(rootNames, parsed.options);
  diagnostics.push(...ts.getPreEmitDiagnostics(program));
}

const unusedDiagnostics = diagnostics.filter(
  (diagnostic) =>
    diagnostic.file &&
    targetPaths.has(resolve(diagnostic.file.fileName)) &&
    unusedCodes.has(diagnostic.code),
);

if (unusedDiagnostics.length) {
  const formatHost = {
    getCurrentDirectory: () => projectRoot,
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => "\n",
  };
  process.stderr.write(
    unusedDiagnostics
      .map((diagnostic) => {
        const position = diagnostic.file.getLineAndCharacterOfPosition(
          diagnostic.start || 0,
        );
        return `${diagnostic.file.fileName.slice(projectRoot.length + 1)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, formatHost.getNewLine())}`;
      })
      .join(formatHost.getNewLine()),
  );
  process.exitCode = 1;
}
