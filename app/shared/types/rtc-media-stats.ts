export interface RtpStatsSample {
  timestamp: number;
  frameCounter: number | null;
  bytes: number | null;
  totalCodecTime: number | null;
}

export interface AudioStatsSample {
  timestamp: number;
  bytes: number | null;
}
