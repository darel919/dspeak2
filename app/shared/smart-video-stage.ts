export type SmartVideoTile =
  | {
      key: string;
      type: "feed";
      source: string;
    }
  | {
      key: string;
      type: "broadcast" | "participant";
    };

export interface SmartVideoStageLayout {
  mode: "grid" | "spotlight";
  heroKey: string | null;
}

export function getSmartVideoStageLayout(
  tiles: readonly SmartVideoTile[],
): SmartVideoStageLayout {
  const screenTile = tiles.find(
    (tile) => tile.type === "feed" && tile.source === "screen",
  );
  const feedTiles = tiles.filter((tile) => tile.type === "feed");
  const heroTile =
    screenTile ||
    (feedTiles.length === 1 ? feedTiles[0] : null) ||
    (tiles.length === 1 && tiles[0]?.type === "broadcast" ? tiles[0] : null);

  if (!heroTile) {
    return {
      mode: "grid",
      heroKey: null,
    };
  }

  return {
    mode: "spotlight",
    heroKey: heroTile.key,
  };
}
