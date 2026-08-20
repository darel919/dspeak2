import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildMediaSignalingClientHello,
  isMediaSignalingServerHello,
  MEDIA_CONTROL_MESSAGE_TYPES as CLIENT_MESSAGE_TYPES,
} from "../shared/media-signaling-protocol.ts";

export async function runMediaControlContractCompatibility(
  mediaControlPath = process.env.DSPEAK_MEDIA_CONTROL_PATH ||
    resolve(process.cwd(), "../dspeak-media-control"),
) {
  const protocolPath = pathToFileURL(
    resolve(mediaControlPath, "src/protocol.ts"),
  );
  const server = await import(protocolPath.href);
  const sessionId = "contract-session";
  const clientHello = buildMediaSignalingClientHello(sessionId);
  const serverHello = server.buildServerHello({
    mediaSessionId: sessionId,
    roomRevision: "0",
    epoch: 0,
    sourceRevision: 0,
    serverTime: 0,
  });

  assert.equal(
    server.MEDIA_CONTROL_PROTOCOL_VERSION,
    919,
    "media-control protocol version must remain 919",
  );
  assert.equal(
    server.MEDIA_CONTROL_CONTRACT_REVISION,
    5,
    "media-control contract revision must remain 5",
  );
  assert.equal(
    server.MEDIA_CONTROL_CLIENT_HELLO,
    "hello919",
    "client hello message name must match",
  );
  assert.equal(
    server.MEDIA_CONTROL_SERVER_HELLO,
    "hi919",
    "server hello message name must match",
  );
  assert.deepEqual(
    Object.values(CLIENT_MESSAGE_TYPES),
    Object.values(server.MEDIA_CONTROL_MESSAGE_TYPES),
    "supported message types must match",
  );
  assert.equal(
    CLIENT_MESSAGE_TYPES.OPERATION_ACK,
    server.MEDIA_CONTROL_MESSAGE_TYPES.OPERATION_ACK,
    "operation ACK message name must match",
  );
  for (const field of ["protocolVersion", "contractRevision", "mediaSessionId"])
    assert.equal(field in clientHello, true, `client hello requires ${field}`);
  for (const field of [
    "protocolVersion",
    "contractRevision",
    "mediaSessionId",
    "heartbeatIntervalMs",
    "heartbeatTimeoutMs",
    "serverTime",
  ])
    assert.equal(field in serverHello, true, `server hello requires ${field}`);

  assert.equal(
    server.isCompatibleClientHello(clientHello, sessionId),
    true,
    "media-control must accept the actual dSpeak client hello",
  );
  assert.equal(
    isMediaSignalingServerHello(serverHello),
    true,
    "dSpeak must accept the actual media-control server hello",
  );
  assert.equal(
    server.isCompatibleClientHello(
      { ...clientHello, contractRevision: 4 },
      sessionId,
    ),
    false,
    "media-control must reject a mismatched contract revision",
  );
  assert.equal(
    isMediaSignalingServerHello({ ...serverHello, contractRevision: 4 }),
    false,
    "dSpeak must reject a mismatched contract revision",
  );

  return {
    mediaControlPath,
    protocolVersion: server.MEDIA_CONTROL_PROTOCOL_VERSION,
    contractRevision: server.MEDIA_CONTROL_CONTRACT_REVISION,
    messageTypes: Object.values(server.MEDIA_CONTROL_MESSAGE_TYPES),
  };
}

if (import.meta.main) {
  const mediaControlPath =
    process.env.DSPEAK_MEDIA_CONTROL_PATH ||
    resolve(process.cwd(), "../dspeak-media-control");
  if (!existsSync(resolve(mediaControlPath, "src/protocol.ts"))) {
    throw new Error(`media-control protocol not found at ${mediaControlPath}`);
  }
  const result = await runMediaControlContractCompatibility(mediaControlPath);
  process.stdout.write(
    `media-control contract compatible: protocol ${result.protocolVersion}, revision ${result.contractRevision}\n`,
  );
}
