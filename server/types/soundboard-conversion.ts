export interface SoundboardConversionResult {
  bytes: Buffer;
  duration: number;
}

export type SoundboardConversionOperation<T> = () => Promise<T>;
