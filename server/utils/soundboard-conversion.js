import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  SOUNDBOARD_MAX_DURATION_SECONDS,
  SOUNDBOARD_MAX_ICON_SOURCE_BYTES,
  SOUNDBOARD_MAX_SOURCE_BYTES,
  SOUNDBOARD_OUTPUT_BITRATE,
} from "../../shared/soundboard.js";

const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/ogg",
  "video/webm",
]);
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function run(program, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${program} timed out`));
    }, timeoutMs);
    child.stdout.on(
      "data",
      (chunk) => (stdout += chunk.toString().slice(0, 4096)),
    );
    child.stderr.on(
      "data",
      (chunk) => (stderr += chunk.toString().slice(-4096)),
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${program} failed: ${stderr.slice(-1000)}`));
    });
  });
}

export function validateSoundboardSource(file) {
  if (!(file instanceof File) || !file.size)
    throw createError({
      statusCode: 400,
      statusMessage: "Audio file is required",
    });
  if (file.size > SOUNDBOARD_MAX_SOURCE_BYTES)
    throw createError({
      statusCode: 413,
      statusMessage: "Soundboard file exceeds 5 MB",
    });
  if (!ALLOWED_TYPES.has(file.type))
    throw createError({
      statusCode: 415,
      statusMessage: "Unsupported soundboard media type",
    });
}

export function validateSoundboardIconSource(file) {
  if (!(file instanceof File) || !file.size)
    throw createError({
      statusCode: 400,
      statusMessage: "Icon image is required",
    });
  if (file.size > SOUNDBOARD_MAX_ICON_SOURCE_BYTES)
    throw createError({
      statusCode: 413,
      statusMessage: "Icon image exceeds 5 MB",
    });
  if (!ALLOWED_IMAGE_TYPES.has(file.type))
    throw createError({
      statusCode: 415,
      statusMessage: "Icon image must be JPEG, PNG, WebP, or GIF",
    });
}

async function convert(file) {
  validateSoundboardSource(file);
  const directory = await mkdtemp(join(tmpdir(), "dspeak-soundboard-"));
  const input = join(directory, `input${extname(file.name || "") || ".media"}`);
  const output = join(directory, "output.ogg");
  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    const rawDuration = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        input,
      ],
      15_000,
    );
    const duration = Number(rawDuration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw createError({
        statusCode: 415,
        statusMessage: "Media has no decodable audio",
      });
    if (duration > SOUNDBOARD_MAX_DURATION_SECONDS + 0.05)
      throw createError({
        statusCode: 422,
        statusMessage: "Soundboard clips cannot exceed 5 seconds",
      });
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        SOUNDBOARD_OUTPUT_BITRATE,
        "-application",
        "audio",
        "-vbr",
        "on",
        "-compression_level",
        "10",
        "-t",
        "5",
        "-f",
        "ogg",
        output,
      ],
      30_000,
    );
    const bytes = await readFile(output);
    if (!bytes.length || bytes.subarray(0, 4).toString() !== "OggS")
      throw createError({
        statusCode: 500,
        statusMessage: "Soundboard conversion produced invalid Ogg media",
      });
    return {
      bytes,
      duration: Math.min(duration, SOUNDBOARD_MAX_DURATION_SECONDS),
    };
  } catch (error) {
    if (error?.statusCode) throw error;
    throw createError({
      statusCode: 500,
      statusMessage: "Soundboard conversion failed",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

let conversionQueue = Promise.resolve();

export function convertSoundboardSource(file) {
  const result = conversionQueue.then(() => convert(file));
  conversionQueue = result.catch(() => {});
  return result;
}

async function convertIcon(file) {
  validateSoundboardIconSource(file);
  const directory = await mkdtemp(join(tmpdir(), "dspeak-soundboard-icon-"));
  const input = join(directory, `input${extname(file.name || "") || ".image"}`);
  const output = join(directory, "icon.ico");
  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vf",
        "scale=64:64:force_original_aspect_ratio=decrease,pad=64:64:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-frames:v",
        "1",
        "-an",
        "-map_metadata",
        "-1",
        "-c:v",
        "png",
        "-f",
        "ico",
        output,
      ],
      20_000,
    );
    const bytes = await readFile(output);
    if (
      bytes.length < 22 ||
      bytes[0] !== 0 ||
      bytes[1] !== 0 ||
      bytes[2] !== 1 ||
      bytes[3] !== 0
    )
      throw createError({
        statusCode: 500,
        statusMessage: "Icon conversion produced invalid ICO media",
      });
    return bytes;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw createError({
      statusCode: 500,
      statusMessage: "Soundboard icon conversion failed",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function convertSoundboardIcon(file) {
  const result = conversionQueue.then(() => convertIcon(file));
  conversionQueue = result.catch(() => {});
  return result;
}
