import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function generateBroadcastTone(filePath) {
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  const sampleRate = 48000;
  const channels = 2;
  const bitsPerSample = 16;
  const durationSec = 10;
  const frequency = 440;

  const numSamples = sampleRate * durationSec;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const dataSize = numSamples * bytesPerFrame;
  const headerSize = 44;

  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  buffer.writeUInt16LE(bytesPerFrame, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  const amplitude = 16000;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequency * t) * amplitude,
    );
    const offset = headerSize + i * bytesPerFrame;
    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(sample, offset + ch * 2);
    }
  }

  writeFileSync(resolved, buffer);
  console.log(
    `Generated ${filePath}: ${buffer.length} bytes, ${durationSec}s stereo 440Hz tone`,
  );
}

generateBroadcastTone(process.argv[2] || "tests/fixtures/broadcast-tone.wav");
