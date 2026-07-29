export class LocalBroadcastCapture {
  constructor({ createAudioContext, createMediaElement, onStateChange }) {
    this.createAudioContext = createAudioContext;
    this.createMediaElement = createMediaElement;
    this.onStateChange = onStateChange;

    this.audioContext = null;
    this.audioElement = null;
    this.mediaSourceNode = null;
    this.destNode = null;
    this.stream = null;
    this.track = null;
    this.state = "stopped";
    this.endedHandler = null;
    this.started = false;
  }

  async start({ url }) {
    if (this.started) throw new Error("Broadcast is already started");

    this.setState("connecting");

    this.audioContext = this.createAudioContext();
    await this.audioContext.resume();

    this.audioElement = this.createMediaElement();
    this.audioElement.crossOrigin = "anonymous";
    this.audioElement.preload = "auto";
    this.audioElement.src = url;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Stream load timed out")),
        15000,
      );
      this.audioElement.addEventListener(
        "canplay",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      this.audioElement.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          const errMsg =
            this.audioElement.error?.message ||
            `Failed to load stream from ${url}`;
          reject(new Error(errMsg));
        },
        { once: true },
      );
      this.audioElement.load();
    });

    this.mediaSourceNode = this.audioContext.createMediaElementSource(
      this.audioElement,
    );
    this.destNode = this.audioContext.createMediaStreamDestination();
    this.mediaSourceNode.connect(this.destNode);

    await this.audioElement.play();

    this.stream = this.destNode.stream;
    this.track = this.stream.getAudioTracks()[0];
    this.track.contentHint = "music";

    this.endedHandler = () => {
      if (this.started) this.stop();
    };
    this.track.addEventListener("ended", this.endedHandler);

    this.started = true;
    this.setState("live");

    return {
      source: "broadcast-audio",
      stream: this.stream,
      track: this.track,
      captureTrack: this.track,
      ownerSource: "local-broadcast",
    };
  }

  async stop() {
    if (!this.started && this.state === "stopped") return;

    this.setState("stopped");

    if (this.endedHandler && this.track) {
      this.track.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }

    if (this.track) {
      this.track.stop();
      this.track = null;
    }

    this.stream = null;

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
      this.audioElement.load();
      this.audioElement = null;
    }

    if (this.destNode) {
      this.destNode.disconnect();
      this.destNode = null;
    }

    this.mediaSourceNode = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close();
      } catch (_) {
        /* noop */
      }
      this.audioContext = null;
    }

    this.started = false;
  }

  getState() {
    return this.state;
  }

  setState(state) {
    this.state = state;
    this.onStateChange?.(state);
  }
}
