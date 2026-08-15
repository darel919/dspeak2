import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nativeRtpCodecMetadata } from "../app/shared/native-mediasoup-diagnostics.ts";

describe("native RTP codec diagnostics", () => {
  it("reports the negotiated software VP9 path instead of the planned H264 path", () => {
    const metadata = nativeRtpCodecMetadata(
      [
        {
          type: "codec",
          id: "codec-vp9",
          mimeType: "video/VP9",
          clockRate: 90000,
        },
        {
          type: "outbound-rtp",
          id: "outbound-video",
          kind: "video",
          mid: "1",
          codecId: "codec-vp9",
          encoderImplementation: "libvpx",
          powerEfficientEncoder: false,
          framesEncoded: 10,
        },
      ],
      "outbound-rtp",
      {
        kind: "video",
        mid: "1",
        codec: "H264",
        codecAcceleration: "hardware",
        codecImplementation: "VideoToolbox",
      },
    );

    assert.equal(metadata.codec, "VP9");
    assert.equal(metadata.actualCodec, "VP9");
    assert.equal(metadata.codecAcceleration, "software");
    assert.equal(metadata.actualCodecAcceleration, "software");
    assert.equal(metadata.codecImplementation, "libvpx");
    assert.equal(metadata.plannedCodec, "H264");
    assert.equal(metadata.plannedCodecAcceleration, "hardware");
    assert.equal(metadata.codecSource, "rtp-stats");
    assert.equal(metadata.codecMismatch, true);
  });

  it("does not claim a codec when RTP identifies the track but not its codec", () => {
    const metadata = nativeRtpCodecMetadata(
      [
        {
          type: "outbound-rtp",
          id: "outbound-video",
          kind: "video",
          mid: "1",
          framesEncoded: 10,
        },
      ],
      "outbound-rtp",
      { kind: "video", mid: "1", codec: "H264" },
    );

    assert.equal(metadata.codec, null);
    assert.equal(metadata.actualCodec, null);
    assert.equal(metadata.codecSource, "rtp-stats-unresolved");
    assert.equal(metadata.codecMismatch, false);
  });

  it("uses the routing plan only until actual RTP stats are available", () => {
    const metadata = nativeRtpCodecMetadata([], "outbound-rtp", {
      kind: "video",
      mid: "1",
      codec: "H264",
      codecAcceleration: "hardware",
      codecImplementation: "VideoToolbox",
    });

    assert.equal(metadata.codec, "H264");
    assert.equal(metadata.actualCodec, null);
    assert.equal(metadata.codecSource, "routing-plan");
    assert.equal(metadata.codecMismatch, false);
  });

  it("keeps audio entries independent from video codec metadata", () => {
    const metadata = nativeRtpCodecMetadata(
      [
        {
          type: "codec",
          id: "codec-opus",
          mimeType: "audio/opus",
          clockRate: 48000,
        },
        {
          type: "outbound-rtp",
          id: "outbound-audio",
          kind: "audio",
          mid: "0",
          codecId: "codec-opus",
        },
      ],
      "outbound-rtp",
      {
        kind: "audio",
        mid: "0",
        codec: "H264",
        codecAcceleration: "hardware",
        codecImplementation: "VideoToolbox",
      },
    );

    assert.equal(metadata.codec, null);
    assert.equal(metadata.plannedCodec, null);
    assert.equal(metadata.actualCodec, null);
    assert.equal(metadata.codecSource, "rtp-stats-unresolved");
  });

  it("reports hardware decoder implementations from inbound RTP stats", () => {
    const metadata = nativeRtpCodecMetadata(
      [
        {
          type: "codec",
          id: "codec-h264",
          mimeType: "video/H264",
          clockRate: 90000,
        },
        {
          type: "inbound-rtp",
          id: "inbound-video",
          kind: "video",
          mid: "1",
          codecId: "codec-h264",
          decoderImplementation: "VideoToolbox",
          powerEfficientDecoder: true,
          framesDecoded: 10,
        },
      ],
      "inbound-rtp",
      { kind: "video", mid: "1", codec: "H264" },
    );

    assert.equal(metadata.codec, "H264");
    assert.equal(metadata.actualCodecAcceleration, "hardware");
    assert.equal(metadata.actualCodecImplementation, "VideoToolbox");
    assert.equal(metadata.codecMismatch, false);
  });

  it("matches mixed peer-connection outbound stats through media-source identity", () => {
    const metadata = nativeRtpCodecMetadata(
      [
        {
          type: "codec",
          id: "codec-h264",
          mimeType: "video/H264",
          clockRate: 90000,
        },
        {
          type: "codec",
          id: "codec-vp9",
          mimeType: "video/VP9",
          clockRate: 90000,
        },
        {
          type: "media-source",
          id: "source-camera",
          kind: "video",
          trackIdentifier: "camera_capture_video",
        },
        {
          type: "media-source",
          id: "source-screen",
          kind: "video",
          trackIdentifier: "desktop_capture_video",
        },
        {
          type: "outbound-rtp",
          id: "outbound-camera",
          kind: "video",
          mediaSourceId: "source-camera",
          codecId: "codec-h264",
          encoderImplementation: "VideoToolbox",
          powerEfficientEncoder: true,
          framesEncoded: 30,
        },
        {
          type: "outbound-rtp",
          id: "outbound-screen",
          kind: "video",
          mediaSourceId: "source-screen",
          codecId: "codec-vp9",
          encoderImplementation: "libvpx",
          powerEfficientEncoder: false,
          framesEncoded: 30,
        },
      ],
      "outbound-rtp",
      {
        kind: "video",
        trackId: "desktop_capture_video",
        source: "screen",
        codec: "H264",
        codecAcceleration: "hardware",
        codecImplementation: "VideoToolbox",
      },
    );

    assert.equal(metadata.codec, "VP9");
    assert.equal(metadata.actualCodec, "VP9");
    assert.equal(metadata.codecAcceleration, "software");
    assert.equal(metadata.codecImplementation, "libvpx");
    assert.equal(metadata.codecMismatch, true);
  });
});
