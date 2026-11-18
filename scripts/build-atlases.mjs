// Converts the Starling/XML ship atlas and the fixed-grid tile sheet into
// PixiJS-compatible JSON spritesheets. Output is committed under public/assets/atlas.
// Usage: npm run atlases
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'public/assets');
const outDir = resolve(assets, 'atlas');
mkdirSync(outDir, { recursive: true });

function frame(x, y, w, h) {
  return {
    frame: { x, y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
  };
}

function convertXml(xmlFile, imageRel, size, outName) {
  const xml = readFileSync(resolve(assets, xmlFile), 'utf8');
  const frames = {};
  const re = /<SubTexture name="([^"]+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\s*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = m[1].replace(/\.png$/, '');
    frames[name] = frame(+m[2], +m[3], +m[4], +m[5]);
  }
  const json = { frames, meta: { image: imageRel, format: 'RGBA8888', size, scale: '1' } };
  writeFileSync(resolve(outDir, outName), JSON.stringify(json, null, 1));
  return Object.keys(frames).length;
}

function tileGrid(imageRel, cols, rows, tile, scale, outName) {
  const frames = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c + 1;
      frames[`tile_${id}`] = frame(c * tile, r * tile, tile, tile);
    }
  }
  const json = {
    frames,
    meta: { image: imageRel, format: 'RGBA8888', size: { w: cols * tile, h: rows * tile }, scale: String(scale) },
  };
  writeFileSync(resolve(outDir, outName), JSON.stringify(json));
  return cols * rows;
}

const ships = convertXml(
  'spritesheet/ships_miscellaneous_sheet.xml',
  '../spritesheet/ships_miscellaneous_sheet.png',
  { w: 1024, h: 512 },
  'ships.json',
);
const tiles1 = tileGrid('../tilesheet/tiles_sheet.png', 16, 6, 64, 1, 'tiles.json');
const tiles2 = tileGrid('../tilesheet/tiles_sheet_retina.png', 16, 6, 128, 2, 'tiles@2x.json');
console.log(`ships: ${ships} frames, tiles: ${tiles1}/${tiles2} frames -> ${outDir}`);
