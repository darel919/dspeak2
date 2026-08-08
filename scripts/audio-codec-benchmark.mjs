#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const profiles = [
  ...[48, 64, 96, 128].map((kbps) => ({
    name: `mono-${kbps}`,
    channels: 1,
    maxBitrateBps: kbps * 1000,
  })),
  ...[96, 128, 160, 192].map((kbps) => ({
    name: `stereo-${kbps}`,
    channels: 2,
    maxBitrateBps: kbps * 1000,
  })),
];

const outputPath = process.argv[2] || null;
const browserPath =
  process.env.BROWSER_PATH ||
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const userDataDir = await mkdtemp(join(tmpdir(), "dspeak-codec-benchmark-"));
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  userDataDir,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage();
  const results = [];
  for (const profile of profiles) {
    results.push(
      await page.evaluate(async (current) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setOpusPolicy = (sdp) =>
          sdp
            .split(/(?=m=)/)
            .map((section) => {
              if (!section.startsWith("m=audio ")) return section;
              const match = section.match(/^a=rtpmap:(\d+) opus\/48000\/2/im);
              if (!match) return section;
              const payloadType = match[1];
              const fmtpPattern = new RegExp(
                `^a=fmtp:${payloadType} ([^\\r\\n]*)`,
                "im",
              );
              const values = new Map(
                (section.match(fmtpPattern)?.[1] || "")
                  .split(";")
                  .filter(Boolean)
                  .map((value) => {
                    const [key, ...rest] = value.trim().split("=");
                    return [key, rest.join("=")];
                  }),
              );
              for (const [key, value] of Object.entries({
                stereo: current.channels === 2 ? "1" : "0",
                "sprop-stereo": current.channels === 2 ? "1" : "0",
                useinbandfec: "1",
                usedtx: "0",
                minptime: "10",
              }))
                values.set(key, value);
              const fmtp = `a=fmtp:${payloadType} ${[...values]
                .map(([key, value]) => `${key}=${value}`)
                .join(";")}`;
              const next = fmtpPattern.test(section)
                ? section.replace(fmtpPattern, fmtp)
                : `${section.trimEnd()}\r\n${fmtp}\r\n`;
              return /^a=ptime:/im.test(next)
                ? next.replace(/^a=ptime:[^\r\n]*/im, "a=ptime:10")
                : `${next.trimEnd()}\r\na=ptime:10\r\n`;
            })
            .join("");

        const context = new AudioContext({ sampleRate: 48000 });
        await context.resume();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.frequency.value = 440;
        oscillator.connect(destination);
        oscillator.connect(context.destination);
        oscillator.start();
        const senderPeer = new RTCPeerConnection();
        const receiverPeer = new RTCPeerConnection();
        const receiverAudio = new Audio();
        receiverAudio.autoplay = true;
        receiverPeer.addEventListener("track", (event) => {
          receiverAudio.srcObject =
            event.streams[0] || new MediaStream([event.track]);
          receiverAudio.play().catch(() => {});
        });
        const sender = senderPeer.addTrack(
          destination.stream.getAudioTracks()[0],
          destination.stream,
        );
        const opus = RTCRtpSender.getCapabilities("audio")?.codecs?.filter(
          (codec) => codec.mimeType.toLowerCase() === "audio/opus",
        );
        const transceiver = senderPeer
          .getTransceivers()
          .find((item) => item.sender === sender);
        if (opus?.length && transceiver?.setCodecPreferences)
          transceiver.setCodecPreferences(opus);
        const parameters = sender.getParameters();
        parameters.encodings ||= [{}];
        parameters.encodings[0].maxBitrate = current.maxBitrateBps;
        parameters.encodings[0].priority = "high";
        parameters.encodings[0].networkPriority = "high";
        await sender.setParameters(parameters);
        const waitForIceGathering = (pc) =>
          pc.iceGatheringState === "complete"
            ? Promise.resolve()
            : new Promise((resolve) => {
                const listener = () => {
                  if (pc.iceGatheringState !== "complete") return;
                  pc.removeEventListener("icegatheringstatechange", listener);
                  resolve();
                };
                pc.addEventListener("icegatheringstatechange", listener);
              });
        const offer = await senderPeer.createOffer();
        await senderPeer.setLocalDescription(offer);
        await waitForIceGathering(senderPeer);
        const localOffer = {
          type: senderPeer.localDescription.type,
          sdp: setOpusPolicy(senderPeer.localDescription.sdp),
        };
        await receiverPeer.setRemoteDescription(localOffer);
        const answer = await receiverPeer.createAnswer();
        await receiverPeer.setLocalDescription(answer);
        await waitForIceGathering(receiverPeer);
        await senderPeer.setRemoteDescription(receiverPeer.localDescription);
        const deadline = Date.now() + 5000;
        while (
          !["connected", "completed"].includes(senderPeer.iceConnectionState) &&
          Date.now() < deadline
        )
          await sleep(50);
        if (!["connected", "completed"].includes(senderPeer.iceConnectionState))
          throw new Error(`ICE did not connect for ${current.name}`);
        await sleep(2000);
        const getOutboundAudio = async () => {
          const stats = await sender.getStats();
          return [...stats].find(
            (stat) =>
              stat.type === "outbound-rtp" &&
              (stat.kind === "audio" || stat.mediaType === "audio"),
          );
        };
        const before = await getOutboundAudio();
        await sleep(2000);
        const after = await getOutboundAudio();
        const durationSeconds =
          (Number(after?.timestamp) - Number(before?.timestamp)) / 1000;
        const actualBitrateBps =
          before && after && durationSeconds > 0
            ? ((Number(after.bytesSent) - Number(before.bytesSent)) * 8) /
              durationSeconds
            : null;
        const result = {
          ...current,
          actualBitrateBps,
          iceConnectionState: senderPeer.iceConnectionState,
          sdpHasOpus: /opus\/48000\/2/i.test(localOffer.sdp),
          sdpHasTenMsPtime: /a=ptime:10/i.test(localOffer.sdp),
          sdpHasFec: /useinbandfec=1/i.test(localOffer.sdp),
          outboundStats: [...(await sender.getStats())]
            .filter((stat) => stat.type === "outbound-rtp")
            .map((stat) => ({
              kind: stat.kind || null,
              mediaType: stat.mediaType || null,
              bytesSent: stat.bytesSent || 0,
            })),
        };
        oscillator.stop();
        senderPeer.close();
        receiverPeer.close();
        await context.close();
        return result;
      }, profile),
    );
  }
  const report = {
    generatedAt: new Date().toISOString(),
    browserPath,
    networkCondition: "clean-local-loopback",
    note: "This harness measures negotiated local WebRTC behavior only. Loss and WAN cases require external network shaping.",
    results,
  };
  const serialized = JSON.stringify(report, null, 2);
  if (outputPath) await writeFile(outputPath, `${serialized}\n`);
  process.stdout.write(`${serialized}\n`);
} finally {
  await browser.close();
  await rm(userDataDir, { recursive: true, force: true });
}
