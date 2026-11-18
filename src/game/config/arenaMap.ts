import type { Rect } from '../core/math';

export const TILE = 64;

export type IslandStyle = 'sand' | 'grass';

export interface IslandDef {
  /** Tile coordinates and size (each island is at least 3×3, grass islands at least 4×4). */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  style: IslandStyle;
  /** Decorative tiles placed on top of the island (tile coords, absolute). */
  props?: { tx: number; ty: number; tile: number }[];
}

export interface ArenaMap {
  /** Logical arena size in world units. The canvas is scaled to fit while preserving it. */
  width: number;
  height: number;
  islands: IslandDef[];
  playerStart: { x: number; y: number; heading: number };
  /** Island collision rects are inset by this amount because the sand edges are rounded. */
  collisionInset: number;
}

export const ARENA_MAP: ArenaMap = {
  width: 20 * TILE,
  height: 12 * TILE,
  collisionInset: 10,
  playerStart: { x: 10 * TILE, y: 5 * TILE, heading: -Math.PI / 2 },
  islands: [
    {
      tx: 3,
      ty: 1,
      tw: 4,
      th: 4,
      style: 'grass',
      props: [
        { tx: 4, ty: 2, tile: 71 },
        { tx: 5, ty: 3, tile: 72 },
      ],
    },
    { tx: 14, ty: 1, tw: 3, th: 3, style: 'sand', props: [{ tx: 15, ty: 2, tile: 50 }] },
    {
      tx: 12,
      ty: 7,
      tw: 4,
      th: 4,
      style: 'grass',
      props: [
        { tx: 13, ty: 8, tile: 70 },
        { tx: 14, ty: 9, tile: 71 },
      ],
    },
    { tx: 2, ty: 8, tw: 3, th: 3, style: 'sand', props: [{ tx: 3, ty: 9, tile: 66 }] },
  ],
};

export function islandRects(map: ArenaMap = ARENA_MAP): Rect[] {
  const inset = map.collisionInset;
  return map.islands.map((i) => ({
    x: i.tx * TILE + inset,
    y: i.ty * TILE + inset,
    w: i.tw * TILE - inset * 2,
    h: i.th * TILE - inset * 2,
  }));
}

/** Picks the tile id for a cell of an island using the 9-slice layout of the tilesheet. */
export function islandTileAt(style: IslandStyle, col: number, row: number, cols: number, rows: number): number {
  const left = col === 0;
  const right = col === cols - 1;
  const top = row === 0;
  const bottom = row === rows - 1;
  if (style === 'sand') {
    // 3×3 sand set: 1 2 3 / 17 18 19 / 33 34 35
    const c = left ? 0 : right ? 2 : 1;
    const r = top ? 0 : bottom ? 2 : 1;
    return 1 + c + r * 16;
  }
  // 4×4 grass-on-sand set: 6 7 8 9 / 22..25 / 38..41 / 54..57
  const c = left ? 0 : right ? 3 : 1 + ((col - 1) % 2);
  const r = top ? 0 : bottom ? 3 : 1 + ((row - 1) % 2);
  return 6 + c + r * 16;
}
