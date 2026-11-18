import { Assets, Rectangle, Texture, type Spritesheet } from 'pixi.js';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets`;

export type AtlasDensity = 1 | 2;

export interface GameTextures {
  ship(name: string): Texture;
  tile(id: number): Texture;
  ui(name: string): Texture;
  /** Pre-cut fill textures (frames are in logical units in Pixi v8, whatever the atlas density) (0..STEPS) so health bars never allocate at runtime. */
  healthFill(kind: 'player' | 'enemy', color: 'green' | 'amber' | 'red', fraction: number): Texture;
  water: Texture;
}

export const FILL_STEPS = 40;

interface FillSpec {
  frame: string;
  x0: number;
  x1: number;
}

const FILLS: Record<'player' | 'enemy', Record<'green' | 'amber' | 'red', FillSpec>> = {
  player: {
    green: { frame: 'health_fill_green', x0: 27, x1: 229 },
    amber: { frame: 'health_fill_amber', x0: 27, x1: 229 },
    red: { frame: 'health_fill_red', x0: 27, x1: 229 },
  },
  enemy: {
    green: { frame: 'enemy_health_fill_green', x0: 21, x1: 139 },
    amber: { frame: 'enemy_health_fill_green', x0: 21, x1: 139 },
    red: { frame: 'enemy_health_fill_red', x0: 21, x1: 139 },
  },
};

function atlasUrls(density: AtlasDensity) {
  return {
    ships: `${ASSET_BASE}/atlas/ships.json`,
    tiles: density === 2 ? `${ASSET_BASE}/atlas/tiles@2x.json` : `${ASSET_BASE}/atlas/tiles.json`,
    ui: density === 2 ? `${ASSET_BASE}/spritesheet/ui_sheet_retina.json` : `${ASSET_BASE}/spritesheet/ui_sheet.json`,
  };
}

export class AssetLoadError extends Error {
  constructor(
    message: string,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

let cached: { density: AtlasDensity; promise: Promise<GameTextures> } | null = null;

/**
 * Loads (once) and returns the textures needed by a match. Successful loads are cached and
 * reused across matches; failed loads are not cached so `retry` performs a fresh request.
 */
export function loadGameTextures(density: AtlasDensity, onProgress?: (p: number) => void): Promise<GameTextures> {
  if (cached && cached.density === density) {
    onProgress?.(1);
    return cached.promise;
  }
  const promise = doLoad(density, onProgress);
  cached = { density, promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

export function isTexturesCached(density: AtlasDensity): boolean {
  return cached?.density === density;
}

async function doLoad(density: AtlasDensity, onProgress?: (p: number) => void): Promise<GameTextures> {
  const urls = atlasUrls(density);
  const list = [urls.ships, urls.tiles, urls.ui];
  let sheets: Record<string, Spritesheet>;
  try {
    sheets = (await Assets.load(list, {
      onProgress: (p: number) => onProgress?.(p),
      strategy: 'retry',
      retryCount: 1,
      retryDelay: 300,
    })) as Record<string, Spritesheet>;
  } catch (err) {
    const url = err instanceof Error ? /https?:\/\/\S+|\/assets\/\S+/.exec(err.message)?.[0] : undefined;
    throw new AssetLoadError('Some game assets could not be loaded.', url);
  }
  const ships = sheets[urls.ships];
  const tiles = sheets[urls.tiles];
  const ui = sheets[urls.ui];
  if (!ships?.textures || !tiles?.textures || !ui?.textures) {
    throw new AssetLoadError('Game atlases are missing or malformed.');
  }

  const get = (sheet: Spritesheet, name: string): Texture => {
    const t = sheet.textures[name];
    if (!t) throw new AssetLoadError(`Missing texture "${name}".`);
    return t;
  };

  // Validate that every texture used by the game exists before combat starts.
  const requiredShips = [
    ...Array.from({ length: 24 }, (_, i) => `ship_${i + 1}`),
    'cannon_ball',
    'explosion_1',
    'explosion_2',
    'explosion_3',
    'fire_1',
    'fire_2',
    'wood_1',
    'wood_2',
    'wood_3',
    'wood_4',
  ];
  requiredShips.forEach((n) => get(ships, n));
  ['health_frame', 'enemy_health_frame'].forEach((n) => get(ui, n));

  const fillCache = new Map<string, Texture[]>();
  for (const kind of ['player', 'enemy'] as const) {
    for (const color of ['green', 'amber', 'red'] as const) {
      const spec = FILLS[kind][color];
      const base = get(ui, spec.frame);
      const frames: Texture[] = [];
      for (let s = 0; s <= FILL_STEPS; s++) {
        const w = Math.max(1, Math.round(spec.x0 + (spec.x1 - spec.x0) * (s / FILL_STEPS)));
        frames.push(
          new Texture({
            source: base.source,
            frame: new Rectangle(base.frame.x, base.frame.y, Math.min(base.frame.width, w), base.frame.height),
          }),
        );
      }
      fillCache.set(`${kind}:${color}`, frames);
    }
  }

  const textures: GameTextures = {
    ship: (name) => get(ships, name),
    tile: (id) => get(tiles, `tile_${id}`),
    ui: (name) => get(ui, name),
    healthFill: (kind, color, fraction) => {
      const frames = fillCache.get(`${kind}:${color}`)!;
      const idx = Math.max(0, Math.min(FILL_STEPS, Math.round(fraction * FILL_STEPS)));
      return frames[idx]!;
    },
    water: get(tiles, 'tile_73'),
  };
  onProgress?.(1);
  return textures;
}

/** Test/diagnostic helper: drops cached textures so the next load hits the network. */
export async function unloadGameTextures(): Promise<void> {
  if (!cached) return;
  const d = cached.density;
  cached = null;
  const urls = atlasUrls(d);
  await Assets.unload([urls.ships, urls.tiles, urls.ui]).catch(() => undefined);
}
