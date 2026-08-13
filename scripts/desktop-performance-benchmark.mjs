import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const scenarios = Object.freeze([
  "tray-idle",
  "ui-open-idle",
  "joined-voice-muted",
  "one-to-one-voice",
  "camera-360p15",
  "camera-720p30",
  "screen-720p15",
  "screen-1080p30",
  "one-remote-video",
  "four-remote-videos",
  "camera-screen-remote",
]);

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") result.list = true;
    else if (argument === "--scenario") result.scenario = argv[++index];
    else if (argument === "--pid") result.pid = Number(argv[++index]);
    else if (argument === "--binary") result.binary = argv[++index];
    else if (argument === "--duration") result.duration = Number(argv[++index]);
    else if (argument === "--interval") result.interval = Number(argv[++index]);
    else if (argument === "--warmup") result.warmup = Number(argv[++index]);
    else if (argument === "--output") result.output = argv[++index];
    else if (argument === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Release desktop process-tree benchmark

Usage:
  bun run benchmark:desktop -- --scenario tray-idle --binary /path/to/release-executable
  bun run benchmark:desktop -- --scenario one-to-one-voice --pid 12345

Options:
  --list                 List the supported scenarios
  --scenario NAME       Scenario label stored in the result
  --binary PATH         Launch a release executable and sample its process tree
  --pid PID             Sample an already-running release process tree
  --duration SECONDS    Steady-state sampling duration (default: 60)
  --interval SECONDS    Sampling interval (default: 1)
  --warmup SECONDS      Time to wait before steady-state sampling (default: 5)
  --output PATH         Write the JSON result to this path
`);
}

function macThreadCount(pid) {
  try {
    const output = execFileSync("ps", ["-M", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return Math.max(0, lines.length - 1);
  } catch {
    return null;
  }
}

function processTreePosix(rootPid) {
  const withThreadCount = process.platform !== "darwin";
  const fields = withThreadCount
    ? "pid=,ppid=,%cpu=,rss=,nlwp=,comm="
    : "pid=,ppid=,%cpu=,rss=,comm=";
  const output = execFileSync("ps", ["-axo", fields], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const processes = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = withThreadCount
        ? line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(.*)$/)
        : line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      const pid = Number(match[1]);
      return {
        pid,
        parentPid: Number(match[2]),
        cpuPercent: Number(match[3]),
        rssKb: Number(match[4]),
        privateMemoryKb: null,
        threads: withThreadCount ? Number(match[5]) : macThreadCount(pid),
        command: withThreadCount ? match[6] : match[5],
      };
    })
    .filter(Boolean);
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (descendants.has(process.parentPid) && !descendants.has(process.pid)) {
        descendants.add(process.pid);
        changed = true;
      }
    }
  }
  return processes.filter((process) => descendants.has(process.pid));
}

function processTreeWindows(rootPid) {
  const script = `
    $processes = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name
    $details = @{}
    Get-Process | ForEach-Object {
    $details[$_.Id] = [PSCustomObject]@{ Cpu = $_.CPU; WorkingSet = $_.WorkingSet64; PrivateMemory = $_.PrivateMemorySize64; Threads = $_.Threads.Count }
    }
    [PSCustomObject]@{ Processes = $processes; Details = $details } | ConvertTo-Json -Compress -Depth 5
  `;
  const output = execFileSync(
    process.env.ComSpec ? "powershell.exe" : "pwsh",
    ["-NoProfile", "-Command", script],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  const processes = Array.isArray(parsed.Processes)
    ? parsed.Processes
    : parsed.Processes
      ? [parsed.Processes]
      : [];
  const details = parsed.Details || {};
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      const pid = Number(process.ProcessId);
      if (
        descendants.has(Number(process.ParentProcessId)) &&
        !descendants.has(pid)
      ) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  return processes
    .filter((process) => descendants.has(Number(process.ProcessId)))
    .map((process) => {
      const detail = details[String(process.ProcessId)] || {};
      return {
        pid: Number(process.ProcessId),
        parentPid: Number(process.ParentProcessId),
        cpuPercent: null,
        cpuSeconds: Number(detail.Cpu) || 0,
        rssKb: Math.round((Number(detail.WorkingSet) || 0) / 1024),
        privateMemoryKb: Math.round((Number(detail.PrivateMemory) || 0) / 1024),
        threads: Number(detail.Threads) || 0,
        command: process.Name || "",
      };
    });
}

function processTree(rootPid) {
  return process.platform === "win32"
    ? processTreeWindows(rootPid)
    : processTreePosix(rootPid);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  );
  return sorted[index];
}

function summarize(samples) {
  const cpu = samples
    .map((sample) => sample.cpuPercent)
    .filter(Number.isFinite);
  const rss = samples.map((sample) => sample.rssKb).filter(Number.isFinite);
  const privateMemory = samples
    .map((sample) => sample.privateMemoryKb)
    .filter(Number.isFinite);
  const threads = samples
    .map((sample) => sample.threads)
    .filter(Number.isFinite);
  const processCount = samples.map((sample) => sample.processCount);
  return {
    cpuPercentAverage: cpu.length
      ? cpu.reduce((total, value) => total + value, 0) / cpu.length
      : null,
    cpuPercentP95: percentile(cpu, 0.95),
    rssKbAverage: rss.length
      ? rss.reduce((total, value) => total + value, 0) / rss.length
      : null,
    rssKbP95: percentile(rss, 0.95),
    privateMemoryKbAverage: privateMemory.length
      ? privateMemory.reduce((total, value) => total + value, 0) /
        privateMemory.length
      : null,
    privateMemoryKbP95: percentile(privateMemory, 0.95),
    threadsAverage: threads.length
      ? threads.reduce((total, value) => total + value, 0) / threads.length
      : null,
    processCountMaximum: processCount.length ? Math.max(...processCount) : 0,
  };
}

function sampleTree(rootPid, previousCpuSeconds, elapsedSeconds) {
  const processes = processTree(rootPid);
  if (!processes.some((process) => process.pid === rootPid))
    throw new Error(`Benchmark process ${rootPid} is no longer running`);
  const cpuSeconds = processes.reduce(
    (total, process) => total + (process.cpuSeconds || 0),
    0,
  );
  const windowsCpuPercent =
    previousCpuSeconds == null || elapsedSeconds <= 0
      ? null
      : Math.max(0, ((cpuSeconds - previousCpuSeconds) / elapsedSeconds) * 100);
  const privateMemoryValues = processes
    .map((process) => process.privateMemoryKb)
    .filter(Number.isFinite);
  return {
    timestamp: new Date().toISOString(),
    processCount: processes.length,
    cpuPercent: processes.every((process) => process.cpuPercent == null)
      ? windowsCpuPercent
      : processes.reduce(
          (total, process) => total + (process.cpuPercent || 0),
          0,
        ),
    rssKb: processes.reduce(
      (total, process) => total + (process.rssKb || 0),
      0,
    ),
    privateMemoryKb: privateMemoryValues.length
      ? privateMemoryValues.reduce((total, value) => total + value, 0)
      : null,
    threads: processes.reduce(
      (total, process) => total + (process.threads || 0),
      0,
    ),
    processes,
  };
}

function ensureReleaseBinary(binary) {
  const path = resolve(binary);
  if (!existsSync(path))
    throw new Error(`Release executable does not exist: ${path}`);
  if (/[/\\]target[/\\](debug|dev)[/\\]/i.test(path))
    throw new Error(
      "Performance measurements must use a release desktop executable",
    );
  return path;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.list) {
    process.stdout.write(`${scenarios.join("\n")}\n`);
    return;
  }
  if (!scenarios.includes(options.scenario))
    throw new Error(`--scenario must be one of: ${scenarios.join(", ")}`);
  const duration =
    Number.isFinite(options.duration) && options.duration > 0
      ? options.duration
      : 60;
  const interval =
    Number.isFinite(options.interval) && options.interval > 0
      ? options.interval
      : 1;
  const warmup =
    Number.isFinite(options.warmup) && options.warmup >= 0 ? options.warmup : 5;
  if (options.binary && options.pid)
    throw new Error("Choose either --binary or --pid");
  if (!options.binary && !Number.isInteger(options.pid))
    throw new Error(
      "Provide --binary for a release launch or --pid for an existing process",
    );

  let child = null;
  const rootPid = options.binary
    ? (() => {
        const binary = ensureReleaseBinary(options.binary);
        const args = options.scenario === "tray-idle" ? ["--minimized"] : [];
        child = spawn(binary, args, { stdio: "ignore", detached: false });
        return child.pid;
      })()
    : options.pid;
  if (!rootPid) throw new Error("Could not determine the benchmark process ID");
  if (warmup > 0)
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, warmup * 1000),
    );
  if (child && child.exitCode !== null)
    throw new Error("Benchmark process exited during warmup");
  const samples = [];
  let previousCpuSeconds = null;
  let previousSampleAt = Date.now();
  const deadline = Date.now() + duration * 1000;
  while (Date.now() <= deadline) {
    try {
      const now = Date.now();
      const sample = sampleTree(
        rootPid,
        previousCpuSeconds,
        Math.max(0.001, (now - previousSampleAt) / 1000),
      );
      samples.push(sample);
      previousCpuSeconds = sample.processes.reduce(
        (total, process) => total + (process.cpuSeconds || 0),
        0,
      );
      previousSampleAt = now;
    } catch (error) {
      child?.kill();
      if (child && child.exitCode !== null)
        throw new Error(
          `Benchmark process exited before sampling completed: ${error}`,
        );
      throw error;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, interval * 1000),
    );
  }
  const result = {
    schema: 1,
    scenario: options.scenario,
    platform: process.platform,
    node: process.version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    rootPid,
    durationSeconds: duration,
    intervalSeconds: interval,
    warmupSeconds: warmup,
    summary: summarize(samples),
    samples,
  };
  if (options.output)
    writeFileSync(
      resolve(options.output),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (child) child.kill();
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
