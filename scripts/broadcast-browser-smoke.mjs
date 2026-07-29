import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const EXECUTABLE_PATH =
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const VLC_BIN = "/Applications/VLC.app/Contents/MacOS/VLC";
const BROADCAST_PORT = Number(process.env.BROADCAST_PORT || "19350");
const BROADCAST_TIMEOUT_MS = 30_000;

const temporaryRoot = await mkdtemp(join(tmpdir(), "dspeak-broadcast-probe-"));
let vlcProcess;
let webServer;
let browser;

function startVlc() {
  return new Promise((resolve, reject) => {
    const fixture = join(process.cwd(), "tests/fixtures/broadcast-tone.wav");
    vlcProcess = spawn(
      VLC_BIN,
      [
        "--intf",
        "dummy",
        "--no-audio",
        "--repeat",
        "--no-video",
        "--sout",
        `#transcode{acodec=vorbis,ab=128,channels=2,samplerate=48000}:http{mux=ogg,dst=127.0.0.1:${BROADCAST_PORT}/}`,
        "--sout-keep",
        fixture,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let started = false;
    const output = [];

    vlcProcess.stdout.on("data", (data) => {
      const text = data.toString();
      output.push(text);
      if (text.includes("mux_ogg") || text.includes("http access out")) {
        started = true;
        resolve();
      }
    });

    vlcProcess.stderr.on("data", (data) => {
      output.push(data.toString());
    });

    vlcProcess.on("error", (err) => {
      if (!started)
        reject(new Error(`VLC failed: ${err.message}\n${output.join("")}`));
    });

    vlcProcess.on("exit", (code) => {
      if (!started)
        reject(new Error(`VLC exited with code ${code}\n${output.join("")}`));
    });

    // Fallback timer — VLC might not log a ready message
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve();
      }
    }, 3000);
  });
}

function stopVlc() {
  return new Promise((resolve) => {
    if (!vlcProcess) return resolve();
    vlcProcess.on("exit", () => resolve());
    vlcProcess.kill("SIGTERM");
    setTimeout(() => {
      try {
        vlcProcess.kill("SIGKILL");
      } catch (_) {}
      resolve();
    }, 3000);
  });
}

async function main() {
  console.log("=== Broadcast Browser Smoke Test ===\n");
  const probeDir = temporaryRoot;
  let probeHtml;

  try {
    // Read the probe HTML
    probeHtml = await readFile(
      join(process.cwd(), "scripts/broadcast-browser-probe.html"),
      "utf-8",
    );
  } catch (err) {
    console.error(`Failed to read probe HTML: ${err.message}`);
    await rm(probeDir, { recursive: true, force: true });
    process.exit(1);
  }

  try {
    // Start VLC
    console.log("Starting VLC loopback broadcast...");
    await startVlc();
    console.log(`VLC running on 127.0.0.1:${BROADCAST_PORT}`);

    // Start HTTP server that serves probe HTML + proxies VLC stream
    const STREAM_PATH = "/broadcast-stream.ogg";
    const VLC_BASE = `http://127.0.0.1:${BROADCAST_PORT}`;
    webServer = createServer((request, response) => {
      if (request.url.startsWith(STREAM_PATH)) {
        // Proxy VLC stream with proper headers
        const vlcReq = httpRequest(VLC_BASE, (vlcRes) => {
          response.writeHead(200, {
            "content-type": "audio/ogg",
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "content-type",
          });
          vlcRes.pipe(response);
        });
        vlcReq.on("error", () => {
          response.writeHead(502);
          response.end("VLC stream unavailable");
        });
        vlcReq.end();
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(probeHtml);
      }
    });
    await new Promise((resolve, reject) => {
      webServer.once("error", reject);
      webServer.listen(0, "127.0.0.1", resolve);
    });
    const serverAddress = webServer.address();
    const origin = `http://127.0.0.1:${serverAddress.port}`;
    const streamUrl = `${origin}${STREAM_PATH}`;
    const probeUrl = `${origin}/?streamUrl=${encodeURIComponent(streamUrl)}`;
    console.log(`Probe server: ${origin}`);
    console.log(`Stream URL: ${streamUrl}`);

    // Launch browser
    console.log("Launching Brave...");
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "shell",
      userDataDir: join(probeDir, "browser-profile"),
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--no-default-browser-check",
        "--no-first-run",
        "--no-sandbox",
      ],
    });

    const page = await browser.newPage();

    // Collect console output
    const consoleLines = [];
    page.on("console", (msg) => {
      consoleLines.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleLines.push(`PAGE ERROR: ${err.message}`);
    });

    // Navigate to probe
    console.log("Loading probe page...");
    await page.goto(probeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Wait for probe result
    console.log("Waiting for probe results...");
    const result = await Promise.race([
      page.waitForFunction(() => window.__BROADCAST_PROBE_RESULT__, {
        timeout: BROADCAST_TIMEOUT_MS,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Probe timed out")),
          BROADCAST_TIMEOUT_MS,
        ),
      ),
    ]);

    const probeResult = await page.evaluate(
      () => window.__BROADCAST_PROBE_RESULT__,
    );

    // Print console output
    console.log("\n--- Browser Console Output ---");
    for (const line of consoleLines) {
      console.log(line);
    }

    console.log("\n--- Probe Results ---");
    console.log(JSON.stringify(probeResult, null, 2));

    if (probeResult?.allPassed) {
      console.log("\n=== ALL TESTS PASSED ===");
    } else {
      console.log(
        `\n=== ${probeResult?.passed || 0}/${probeResult?.total || 0} PASSED ===`,
      );
      for (const [name, test] of Object.entries(probeResult?.results || {})) {
        if (!test.passed) {
          console.log(`  FAIL: ${name} — ${test.detail || ""}`);
        }
      }
    }

    return probeResult;
  } finally {
    // Cleanup
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => webServer?.close(resolve) || resolve());
    await stopVlc();
    await rm(probeDir, { recursive: true, force: true }).catch(() => {});
  }
}

const result = await main();
if (!result?.allPassed) {
  console.error("Browser probe reported failures");
  process.exit(1);
}
