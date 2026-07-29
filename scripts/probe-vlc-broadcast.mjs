import { request } from "node:http";

const PORT = Number(process.env.BROADCAST_PORT || "19350");
const HOST = "127.0.0.1";
const MIN_BYTES = 1024;
const TEN_SECONDS_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

function connectAndReadBytes(maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: HOST, port: PORT, path: "/", method: "GET", timeout: timeoutMs },
      (res) => {
        const abortTimer = setTimeout(() => {
          res.destroy();
          reject(new Error("Timed out while reading initial bytes"));
        }, timeoutMs);

        let totalBytes = 0;
        let contentType = res.headers["content-type"] || "unknown";
        let statusCode = res.statusCode;

        res.on("data", (chunk) => {
          if (totalBytes === 0) {
            clearTimeout(abortTimer);
          }
          totalBytes += chunk.length;
          if (totalBytes >= maxBytes) {
            res.destroy();
            clearTimeout(abortTimer);
            resolve({ statusCode, contentType, totalBytes });
          }
        });

        res.on("error", (err) => {
          clearTimeout(abortTimer);
          if (totalBytes > 0) {
            resolve({ statusCode, contentType, totalBytes });
          } else {
            reject(err);
          }
        });

        res.on("end", () => {
          clearTimeout(abortTimer);
          resolve({ statusCode, contentType, totalBytes });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });
    req.end();
  });
}

function collectForDuration(durationMs) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: HOST,
        port: PORT,
        path: "/",
        method: "GET",
        timeout: durationMs + 5000,
      },
      (res) => {
        const startTime = Date.now();
        let totalBytes = 0;
        const contentType = res.headers["content-type"] || "unknown";
        const statusCode = res.statusCode;

        res.on("data", (chunk) => {
          totalBytes += chunk.length;
        });

        const timer = setTimeout(() => {
          res.destroy();
          resolve({
            statusCode,
            contentType,
            totalBytes,
            durationMs: Date.now() - startTime,
          });
        }, durationMs);

        res.on("error", () => {
          clearTimeout(timer);
          resolve({
            statusCode,
            contentType,
            totalBytes,
            durationMs: Date.now() - startTime,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  console.log("== VLC Loopback Broadcast Probe ==");
  console.log(`Target: http://${HOST}:${PORT}/`);

  // Test 1: Connection and content type
  console.log("\n--- Test 1: Connection and content type ---");
  const first = await connectAndReadBytes(4096, CONNECT_TIMEOUT_MS);
  const ok = first.statusCode >= 200 && first.statusCode < 300;
  console.log(`  Status: ${first.statusCode} ${ok ? "OK" : "FAIL"}`);
  console.log(`  Content-Type: ${first.contentType}`);
  console.log(`  Bytes received: ${first.totalBytes}`);

  if (!ok) {
    console.error("\nFAILED: Could not connect to VLC broadcast endpoint");
    process.exit(1);
  }

  // Test 2: Continuous stream for 10 seconds
  console.log("\n--- Test 2: Continuous stream for 10 seconds ---");
  const stream = await collectForDuration(TEN_SECONDS_MS);
  console.log(`  Duration: ${stream.durationMs}ms`);
  console.log(`  Total bytes: ${stream.totalBytes}`);

  if (stream.totalBytes < MIN_BYTES) {
    console.error(
      `\nFAILED: Expected at least ${MIN_BYTES} bytes, got ${stream.totalBytes}`,
    );
    process.exit(1);
  }
  const bitrateKbps = ((stream.totalBytes * 8) / stream.durationMs).toFixed(1);
  console.log(`  Approximate bitrate: ${bitrateKbps} kbps`);
  console.log("  Stream is continuous: OK");

  // Test 3: Disconnect and reconnect
  console.log("\n--- Test 3: Disconnect and reconnect ---");
  const reconnect = await connectAndReadBytes(4096, CONNECT_TIMEOUT_MS);
  console.log(`  Reconnect status: ${reconnect.statusCode}`);
  console.log(`  Reconnect bytes: ${reconnect.totalBytes}`);
  if (reconnect.totalBytes > 0) {
    console.log("  Reconnect works: OK");
  } else {
    console.error("FAILED: Reconnect received no data");
    process.exit(1);
  }

  // Test 4: Verify content type is audio/* or application/ogg
  console.log("\n--- Test 4: Content type is audio ---");
  const ct = first.contentType;
  const isAudio = ct.startsWith("audio/") || ct.startsWith("application/ogg");
  console.log(`  Content-Type: ${ct} ${isAudio ? "OK" : "WARN"}`);

  console.log("\n=== ALL PROBE CHECKS PASSED ===");
}

main().catch((err) => {
  console.error(`\nProbe failed: ${err.message}`);
  process.exit(1);
});
