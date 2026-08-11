import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AudioCodecPolicy,
  getAudioCodecPolicy,
  toMediasoupProducerOptions,
  toCloudflareTrackOptions,
  toP2PCodecConstraints,
  getCaptureConstraints,
} from "../shared/audio-codec-policy.ts";

describe("audio-codec-policy", () => {
  describe("AudioCodecPolicy constants", () => {
    it("has standard microphone profile", () => {
      const p = AudioCodecPolicy.STANDARD_MICROPHONE;
      assert.equal(p.codec, "opus");
      assert.equal(p.clockRate, 48000);
      assert.equal(p.channels, 1);
      assert.equal(p.maxBitrateBps, 96000);
      assert.equal(p.ptimeMs, 10);
      assert.equal(p.fec, true);
      assert.equal(p.dtx, false);
      assert.equal(p.nack, true);
      assert.equal(p.content, "speech");
      assert.equal(p.priority, "high");
    });

    it("has HD microphone profile", () => {
      const p = AudioCodecPolicy.HD_MICROPHONE;
      assert.equal(p.codec, "opus");
      assert.equal(p.clockRate, 48000);
      assert.equal(p.channels, 2);
      assert.equal(p.maxBitrateBps, 160000);
      assert.equal(p.ptimeMs, 10);
      assert.equal(p.fec, true);
      assert.equal(p.dtx, false);
      assert.equal(p.nack, true);
      assert.equal(p.content, "music");
      assert.equal(p.priority, "high");
    });

    it("has shared audio profile", () => {
      const p = AudioCodecPolicy.SHARED_AUDIO;
      assert.equal(p.codec, "opus");
      assert.equal(p.clockRate, 48000);
      assert.equal(p.channels, 2);
      assert.equal(p.maxBitrateBps, 160000);
      assert.equal(p.ptimeMs, 10);
      assert.equal(p.fec, true);
      assert.equal(p.dtx, false);
      assert.equal(p.nack, true);
      assert.equal(p.content, "music");
      assert.equal(p.priority, "high");
    });

    it("has capture processing modes", () => {
      assert.equal(AudioCodecPolicy.CaptureProcessingMode.RAW, "raw");
      assert.equal(
        AudioCodecPolicy.CaptureProcessingMode.VOICE_SAFE,
        "voice-safe",
      );
      assert.equal(AudioCodecPolicy.CaptureProcessingMode.DEFAULT, "default");
    });

    it("has shared audio max kbps", () => {
      assert.equal(AudioCodecPolicy.SHARED_AUDIO_MAX_KBPS, 256);
    });
  });

  describe("getAudioCodecPolicy", () => {
    it("returns standard microphone for microphone source without HD", () => {
      const policy = getAudioCodecPolicy("microphone", false);
      assert.equal(policy.maxBitrateBps, 96000);
      assert.equal(policy.channels, 1);
    });

    it("returns HD microphone for microphone source with HD", () => {
      const policy = getAudioCodecPolicy("microphone", true);
      assert.equal(policy.maxBitrateBps, 160000);
      assert.equal(policy.channels, 2);
    });

    it("returns shared audio profile for screen-audio source", () => {
      const policy = getAudioCodecPolicy("shared-audio", false);
      assert.equal(policy.maxBitrateBps, 160000);
      assert.equal(policy.channels, 2);
    });
  });

  describe("toMediasoupProducerOptions", () => {
    it("maps standard microphone policy correctly", () => {
      const mockTrack = { kind: "audio" };
      const options = toMediasoupProducerOptions(
        AudioCodecPolicy.STANDARD_MICROPHONE,
        mockTrack,
      );
      assert.equal(options.track, mockTrack);
      assert.equal(options.encodings[0].maxBitrate, 96000);
      assert.equal(options.encodings[0].priority, "high");
      assert.equal(options.codecOptions.opusDtx, false);
      assert.equal(options.codecOptions.opusFec, true);
      assert.equal(options.codecOptions.opusNack, true);
      assert.equal(options.codecOptions.opusStereo, false);
      assert.equal(options.codecOptions.opusPtime, 10);
    });

    it("maps HD microphone policy correctly", () => {
      const mockTrack = { kind: "audio" };
      const options = toMediasoupProducerOptions(
        AudioCodecPolicy.HD_MICROPHONE,
        mockTrack,
      );
      assert.equal(options.encodings[0].maxBitrate, 160000);
      assert.equal(options.codecOptions.opusStereo, true);
    });
  });

  describe("toCloudflareTrackOptions", () => {
    it("maps policy to Cloudflare track options", () => {
      const options = toCloudflareTrackOptions(
        AudioCodecPolicy.STANDARD_MICROPHONE,
      );
      assert.equal(options.codec, "opus");
      assert.equal(options.channels, 1);
      assert.equal(options.bitrate, 96000);
      assert.equal(options.ptime, 10);
      assert.equal(options.fec, true);
      assert.equal(options.dtx, false);
      assert.equal(options.nack, true);
      assert.equal(options.contentHint, "speech");
    });
  });

  describe("toP2PCodecConstraints", () => {
    it("maps policy to P2P codec constraints", () => {
      const options = toP2PCodecConstraints(
        AudioCodecPolicy.STANDARD_MICROPHONE,
      );
      assert.equal(options.opus.stereo, false);
      assert.equal(options.opus.maxBitrate, 96000);
      assert.equal(options.opus.fec, true);
      assert.equal(options.opus.dtx, false);
      assert.equal(options.opus.ptime, 10);
    });

    it("sets stereo true for HD", () => {
      const options = toP2PCodecConstraints(AudioCodecPolicy.HD_MICROPHONE);
      assert.equal(options.opus.stereo, true);
    });
  });

  describe("getCaptureConstraints", () => {
    it("returns audio constraints for microphone with default mode", () => {
      const constraints = getCaptureConstraints("microphone");
      assert.ok(constraints.audio);
      assert.equal(constraints.audio.sampleRate, 48000);
      assert.equal(constraints.audio.channelCount, 1);
      assert.equal(constraints.audio.echoCancellation, true);
      assert.equal(constraints.audio.noiseSuppression, true);
      assert.equal(constraints.audio.autoGainControl, true);
    });

    it("disables all processing for raw mode", () => {
      const constraints = getCaptureConstraints(
        "microphone",
        AudioCodecPolicy.CaptureProcessingMode.RAW,
      );
      assert.equal(constraints.audio.echoCancellation, false);
      assert.equal(constraints.audio.noiseSuppression, false);
      assert.equal(constraints.audio.autoGainControl, false);
    });

    it("minimal processing for voice-safe mode", () => {
      const constraints = getCaptureConstraints(
        "microphone",
        AudioCodecPolicy.CaptureProcessingMode.VOICE_SAFE,
      );
      assert.equal(constraints.audio.echoCancellation, true);
      assert.equal(constraints.audio.noiseSuppression, false);
      assert.equal(constraints.audio.autoGainControl, false);
    });

    it("disables processing for screen-audio", () => {
      const constraints = getCaptureConstraints("screen-audio");
      assert.equal(constraints.audio.echoCancellation, false);
      assert.equal(constraints.audio.noiseSuppression, false);
      assert.equal(constraints.audio.autoGainControl, false);
    });

    it("returns video constraints for camera", () => {
      const constraints = getCaptureConstraints("camera");
      assert.ok(constraints.video);
      assert.equal(constraints.video.width.ideal, 1280);
      assert.equal(constraints.video.height.ideal, 720);
    });

    it("returns video constraints for screen-video", () => {
      const constraints = getCaptureConstraints("screen-video");
      assert.ok(constraints.video);
      assert.equal(constraints.video.width.ideal, 1920);
      assert.equal(constraints.video.height.ideal, 1080);
    });
  });
});
