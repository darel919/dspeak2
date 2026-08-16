import {
  computed,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  type Ref,
} from "vue";

const TARGET_ASPECT_RATIO = 16 / 9;
const DEFAULT_GAP = 12;
const SCORE_EPSILON = 1e-6;

export interface AdaptiveVideoGridLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
}

export function calculateAdaptiveVideoGrid(
  count: number,
  containerWidth: number,
  containerHeight: number,
  options?: {
    gap?: number;
    aspectRatio?: number;
  },
): AdaptiveVideoGridLayout {
  const gap = options?.gap ?? DEFAULT_GAP;
  const aspectRatio = options?.aspectRatio ?? TARGET_ASPECT_RATIO;

  if (count <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return {
      columns: 0,
      rows: 0,
      tileWidth: 0,
      tileHeight: 0,
      gap,
    };
  }

  if (count === 1) {
    const maxTileWidth = Math.min(
      containerWidth,
      containerHeight * aspectRatio,
    );
    const maxTileHeight = maxTileWidth / aspectRatio;
    const safeWidth = Math.floor(maxTileWidth);
    const safeHeight = Math.floor(maxTileHeight);
    return {
      columns: 1,
      rows: 1,
      tileWidth: safeWidth,
      tileHeight: safeHeight,
      gap,
    };
  }

  let bestLayout: AdaptiveVideoGridLayout = {
    columns: 1,
    rows: count,
    tileWidth: 0,
    tileHeight: 0,
    gap,
  };
  let bestArea = -1;
  let bestUnusedCells = Infinity;
  let bestShapeDiff = Infinity;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);

    const usableWidth = containerWidth - gap * Math.max(0, columns - 1);
    const usableHeight = containerHeight - gap * Math.max(0, rows - 1);

    if (usableWidth <= 0 || usableHeight <= 0) continue;

    const cellWidth = usableWidth / columns;
    const cellHeight = usableHeight / rows;

    const tileWidth = Math.min(cellWidth, cellHeight * aspectRatio);
    const tileHeight = tileWidth / aspectRatio;

    const area = tileWidth * tileHeight;
    const unusedCells = rows * columns - count;
    const shapeDiff = Math.abs(
      containerWidth / containerHeight -
        (tileWidth * columns) / (tileHeight * rows),
    );

    const areaBetter = area > bestArea + SCORE_EPSILON;
    const areaEqual = Math.abs(area - bestArea) <= SCORE_EPSILON;
    const unusedBetter = unusedCells < bestUnusedCells;
    const shapeBetter = shapeDiff < bestShapeDiff - SCORE_EPSILON;

    if (
      areaBetter ||
      (areaEqual && unusedBetter) ||
      (areaEqual && !unusedBetter && shapeBetter)
    ) {
      bestArea = area;
      bestUnusedCells = unusedCells;
      bestShapeDiff = shapeDiff;
      bestLayout = {
        columns,
        rows,
        tileWidth: Math.floor(tileWidth),
        tileHeight: Math.floor(tileHeight),
        gap,
      };
    }
  }

  return bestLayout;
}

export function useAdaptiveVideoGrid(
  stageElement: Ref<HTMLElement | null>,
  tileCount: Ref<number>,
) {
  const stageSize = shallowRef({
    width: 0,
    height: 0,
  });

  let observer: ResizeObserver | null = null;

  onMounted(() => {
    if (typeof ResizeObserver === "undefined") return;

    observer = new ResizeObserver(([entry]) => {
      if (!entry) return;

      const borderBox = entry.borderBoxSize?.[0];

      const width = borderBox?.inlineSize ?? entry.contentRect.width;
      const height = borderBox?.blockSize ?? entry.contentRect.height;

      if (
        width === stageSize.value.width &&
        height === stageSize.value.height
      ) {
        return;
      }

      stageSize.value = { width, height };
    });

    if (stageElement.value) {
      observer.observe(stageElement.value);
    }
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  const layout = computed(() =>
    calculateAdaptiveVideoGrid(
      tileCount.value,
      stageSize.value.width,
      stageSize.value.height,
    ),
  );

  return {
    stageSize,
    layout,
  };
}
