export class FakeMediaStreamTrack
  extends EventTarget
  implements MediaStreamTrack
{
  contentHint = "";
  enabled = true;
  readonly id: string;
  readonly kind: "audio" | "video";
  readonly label: string;
  readonly muted = false;
  onended: ((this: MediaStreamTrack, event: Event) => void) | null = null;
  onmute: ((this: MediaStreamTrack, event: Event) => void) | null = null;
  onunmute: ((this: MediaStreamTrack, event: Event) => void) | null = null;
  private state: MediaStreamTrackState = "live";

  constructor(kind: "audio" | "video", id: string) {
    super();
    this.kind = kind;
    this.id = id;
    this.label = id;
  }

  get readyState(): MediaStreamTrackState {
    return this.state;
  }

  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  clone(): MediaStreamTrack {
    return new FakeMediaStreamTrack(this.kind, `${this.id}-clone`);
  }

  getCapabilities(): MediaTrackCapabilities {
    return {};
  }

  getConstraints(): MediaTrackConstraints {
    return {};
  }

  getSettings(): MediaTrackSettings {
    return {};
  }

  stop(): void {
    this.state = "ended";
  }

  addEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (
      this: MediaStreamTrack,
      event: MediaStreamTrackEventMap[K],
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    EventTarget.prototype.addEventListener.call(this, type, listener, options);
  }

  removeEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (
      this: MediaStreamTrack,
      event: MediaStreamTrackEventMap[K],
    ) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    EventTarget.prototype.removeEventListener.call(
      this,
      type,
      listener,
      options,
    );
  }
}

export class FakeMediaStream extends EventTarget implements MediaStream {
  readonly id: string;
  onaddtrack:
    ((this: MediaStream, event: MediaStreamTrackEvent) => void) | null = null;
  onremovetrack:
    ((this: MediaStream, event: MediaStreamTrackEvent) => void) | null = null;
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = [], id = "fake-stream") {
    super();
    this.tracks = [...tracks];
    this.id = id;
  }

  get active(): boolean {
    return this.tracks.some((track) => track.readyState === "live");
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  clone(): MediaStream {
    return new FakeMediaStream(this.tracks, `${this.id}-clone`);
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getTrackById(trackId: string): MediaStreamTrack | null {
    return this.tracks.find((track) => track.id === trackId) || null;
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  removeTrack(track: MediaStreamTrack): void {
    const index = this.tracks.indexOf(track);
    if (index >= 0) this.tracks.splice(index, 1);
  }

  addEventListener<K extends keyof MediaStreamEventMap>(
    type: K,
    listener: (this: MediaStream, event: MediaStreamEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    EventTarget.prototype.addEventListener.call(this, type, listener, options);
  }

  removeEventListener<K extends keyof MediaStreamEventMap>(
    type: K,
    listener: (this: MediaStream, event: MediaStreamEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    EventTarget.prototype.removeEventListener.call(
      this,
      type,
      listener,
      options,
    );
  }
}
