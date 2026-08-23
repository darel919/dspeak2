type PipDocument = {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

function pipDocument() {
  const doc: PipDocument = document;
  return doc;
}

function canRequestPictureInPicture(video: HTMLVideoElement | null) {
  return Boolean(video?.requestPictureInPicture);
}

export function webPopOutSupported() {
  if (!import.meta.client) return false;
  return Boolean(pipDocument().pictureInPictureEnabled);
}

export async function enterWebPopOut(video: HTMLVideoElement | null) {
  if (!canRequestPictureInPicture(video)) return false;
  if (isWebPopOutActive()) return true;
  try {
    await video?.requestPictureInPicture();
    return true;
  } catch (error) {
    console.warn("[Media] browser pop-out failed", error);
    return false;
  }
}

export function isWebPopOutActive() {
  if (!import.meta.client) return false;
  return Boolean(pipDocument().pictureInPictureElement);
}

export async function exitWebPopOut() {
  const doc = pipDocument();
  if (!doc.exitPictureInPicture || !doc.pictureInPictureElement) return;
  try {
    await doc.exitPictureInPicture();
  } catch (error) {
    console.warn("[Media] browser pop-in failed", error);
  }
}

const UPPER_BARS = [
  "#c0c0c0",
  "#c0c000",
  "#00c0c0",
  "#00c000",
  "#c000c0",
  "#c00000",
  "#0000c0",
];
const LOWER_BARS = [
  "#0000c0",
  "#101010",
  "#c000c0",
  "#101010",
  "#00c0c0",
  "#101010",
  "#c0c0c0",
];

export function drawSmpteBars(
  canvas: HTMLCanvasElement,
  label: string,
  width: number,
  height: number,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = width;
  canvas.height = height;
  const barWidth = width / UPPER_BARS.length;
  for (const [index, color] of UPPER_BARS.entries()) {
    context.fillStyle = color;
    context.fillRect(
      index * barWidth,
      0,
      barWidth + 1,
      Math.floor(height * 0.75),
    );
  }
  const lowerHeight = Math.floor(height * 0.1);
  for (const [index, color] of LOWER_BARS.entries()) {
    context.fillStyle = color;
    context.fillRect(
      index * barWidth,
      Math.floor(height * 0.75),
      barWidth + 1,
      lowerHeight,
    );
  }
  context.fillStyle = "#000";
  context.fillRect(
    0,
    Math.floor(height * 0.85),
    width,
    Math.ceil(height * 0.15),
  );
  context.fillStyle = "#fff";
  context.font = `bold ${Math.max(12, Math.floor(height * 0.06))}px system-ui, sans-serif`;
  context.textBaseline = "middle";
  context.fillText(label.slice(0, 48), 16, Math.floor(height * 0.925));
  const status = "NO SIGNAL";
  const statusWidth = context.measureText(status).width;
  context.fillText(
    status,
    width - statusWidth - 16,
    Math.floor(height * 0.925),
  );
}

type SmptePipSession = {
  stop: () => void;
};

export function showSmpteWhilePoppedOut(
  video: HTMLVideoElement | null,
  label: string,
): SmptePipSession | null {
  if (!import.meta.client || !video || isWebPopOutActive()) return null;
  const canvas = document.createElement("canvas");
  const previousStream = video.srcObject;
  const stream = canvas.captureStream(24);
  let stopped = false;

  const render = () => {
    if (stopped) return;
    drawSmpteBars(canvas, label, 640, 360);
  };
  render();
  video.srcObject = stream;
  void video.play?.().catch(() => {});

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      video.srcObject = previousStream;
      void video.play?.().catch(() => {});
    },
  };
}
