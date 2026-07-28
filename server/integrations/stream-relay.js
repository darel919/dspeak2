import { spawn } from "node:child_process";
import { getStreamManager } from "../utils/stream-manager.js";

const FFmpegTerminationTimeoutMs = 3000;

export function getChannelBitrate(channel) {
  const raw = channel?.mediaPolicy?.sharedAudioKbps;
  const value = Number(raw) || 128;
  return Math.min(256, Math.max(64, value));
}

export async function startStreamRelay(router, channelId, streamKey, bitrate) {
  if (!router) throw new Error("mediasoup router is required");
  if (!channelId) throw new Error("channelId is required");
  if (!streamKey) throw new Error("streamKey is required");

  const manager = getStreamManager();
  const existing = manager.getStream(channelId);
  if (existing) {
    console.warn(
      "[StreamRelay] replacing existing relay for channel",
      channelId,
    );
    await stopStreamRelay(channelId);
  }

  const transport = await router.createPlainTransport({
    listenIp: "127.0.0.1",
    comedia: true,
    rtcpMux: false,
  });

  const localPort = transport.tuple.localPort;
  const config = useRuntimeConfig();
  const rtmpPort = config.stream?.rtmpPort || 1935;
  const rtmpUrl = `rtmp://127.0.0.1:${rtmpPort}/live/${streamKey}`;
  const rtpTarget = `rtp://127.0.0.1:${localPort}`;

  const ffmpegProcess = spawn(
    "ffmpeg",
    [
      "-i",
      rtmpUrl,
      "-c:a",
      "libopus",
      "-b:a",
      `${bitrate}k`,
      "-ac",
      "2",
      "-application",
      "audio",
      "-f",
      "rtp",
      rtpTarget,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  let stderrBuffer = "";
  ffmpegProcess.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) console.debug("[FFmpeg]", channelId, trimmed);
    }
  });

  const producer = await waitForProducer(transport, channelId);

  manager.registerStream(channelId, {
    channelId,
    streamKey,
    bitrate,
    plainTransport: transport,
    producer,
    ffmpegProcess,
    relayStarting: false,
    startedAt: new Date().toISOString(),
  });

  ffmpegProcess.on("close", (code) => {
    console.log(
      "[StreamRelay] FFmpeg exited with code",
      code,
      "for channel",
      channelId,
    );
    stopStreamRelay(channelId).catch((error) => {
      console.error("[StreamRelay] cleanup after FFmpeg exit failed", error);
    });
  });

  ffmpegProcess.on("error", (error) => {
    console.error(
      "[StreamRelay] FFmpeg spawn error for channel",
      channelId,
      error,
    );
  });

  return { transport, producer };
}

export async function stopStreamRelay(channelId) {
  const manager = getStreamManager();
  const stream = manager.getStream(channelId);
  if (!stream) return false;

  manager.unregisterStream(channelId);

  if (stream.ffmpegProcess) {
    try {
      stream.ffmpegProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        const forceKillTimer = setTimeout(() => {
          try {
            stream.ffmpegProcess.kill("SIGKILL");
          } catch {}
        }, FFmpegTerminationTimeoutMs);

        stream.ffmpegProcess.once("close", () => {
          clearTimeout(forceKillTimer);
          resolve();
        });
        stream.ffmpegProcess.once("error", () => {
          clearTimeout(forceKillTimer);
          resolve();
        });
      });
    } catch (error) {
      console.error(
        "[StreamRelay] error killing FFmpeg for channel",
        channelId,
        error,
      );
    }
  }

  try {
    if (stream.producer && !stream.producer.closed) {
      stream.producer.close();
    }
  } catch (error) {
    console.error(
      "[StreamRelay] error closing producer for channel",
      channelId,
      error,
    );
  }

  try {
    if (stream.plainTransport && !stream.plainTransport.closed) {
      stream.plainTransport.close();
    }
  } catch (error) {
    console.error(
      "[StreamRelay] error closing transport for channel",
      channelId,
      error,
    );
  }

  return true;
}

function waitForProducer(transport, channelId) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 10000;
    let settled = false;

    const cleanup = () => {
      settled = true;
      transport.removeAllListeners("rtp");
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(
        new Error(`Timed out waiting for RTP packets on channel ${channelId}`),
      );
    }, timeoutMs);

    transport.on("rtp", (packet) => {
      if (settled) return;
      clearTimeout(timer);
      cleanup();

      transport
        .produce({
          kind: "audio",
          rtpParameters: {
            codecs: [
              {
                mimeType: "audio/opus",
                payloadType: 111,
                clockRate: 48000,
                channels: 2,
                parameters: { sprop_stereo: 1 },
              },
            ],
            encodings: [{}],
            headerExtensions: [],
          },
          appData: { source: "system-audio", channelId },
        })
        .then(resolve)
        .catch(reject);
    });
  });
}
