#!/usr/bin/env node
// Generate platform app icons from assets/icon.svg with zero external deps.
//
// macOS-only build step (uses qlmanage + sips + iconutil, all built in). Run it
// when the logo changes; the generated binaries (icon.icns / icon.ico / icon.png)
// are committed so `npm run package`/`make` works on any OS without regenerating.
//
//   icon.icns  — macOS (iconutil from a .iconset)
//   icon.ico   — Windows (hand-packed, PNG-embedded — Vista+; no native dep)
//   icon.png   — Linux (512px)
//
// Usage: node scripts/generate-icons.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SRC = path.join(ASSETS, 'icon.svg');

if (process.platform !== 'darwin') {
  console.error('generate-icons: macOS only (uses qlmanage/sips/iconutil). Commit the generated assets instead.');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`generate-icons: missing ${SRC}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-icons-'));

// 1) Rasterize the SVG once at full size (qlmanage handles SVG via ImageIO).
execFileSync('qlmanage', ['-t', '-s', '1024', '-o', tmp, SRC], { stdio: 'ignore' });
const master = path.join(tmp, 'icon.svg.png');
if (!fs.existsSync(master)) {
  console.error('generate-icons: rasterization failed (qlmanage produced no PNG).');
  process.exit(1);
}

// Downscale the master PNG to a square of `size` (sips PNG→PNG is reliable).
function pngAt(size, out) {
  fs.copyFileSync(master, out);
  execFileSync('sips', ['-z', String(size), String(size), out], { stdio: 'ignore' });
  return out;
}

// 2) macOS .icns via a .iconset of the conventional sizes.
const iconset = path.join(tmp, 'icon.iconset');
fs.mkdirSync(iconset);
for (const [size, name] of [
  [16, 'icon_16x16'],
  [32, 'icon_16x16@2x'],
  [32, 'icon_32x32'],
  [64, 'icon_32x32@2x'],
  [128, 'icon_128x128'],
  [256, 'icon_128x128@2x'],
  [256, 'icon_256x256'],
  [512, 'icon_256x256@2x'],
  [512, 'icon_512x512'],
  [1024, 'icon_512x512@2x'],
]) {
  pngAt(size, path.join(iconset, `${name}.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ASSETS, 'icon.icns')]);

// 3) Linux .png (512).
pngAt(512, path.join(ASSETS, 'icon.png'));

// 4) Windows .ico — pack PNG-encoded images for each size (Vista+ supports
//    PNG-compressed icon entries, so no BMP/native encoder needed).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = icoSizes.map((s) => fs.readFileSync(pngAt(s, path.join(tmp, `ico_${s}.png`))));
const count = icoSizes.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4);
const entries = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
icoSizes.forEach((s, i) => {
  const e = i * 16;
  entries.writeUInt8(s >= 256 ? 0 : s, e + 0); // width (0 = 256)
  entries.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
  entries.writeUInt8(0, e + 2); // palette
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // color planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(pngs[i].length, e + 8); // size of image data
  entries.writeUInt32LE(offset, e + 12); // offset
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), Buffer.concat([header, entries, ...pngs]));

fs.rmSync(tmp, { recursive: true, force: true });

for (const f of ['icon.icns', 'icon.ico', 'icon.png']) {
  const st = fs.statSync(path.join(ASSETS, f));
  console.log(`  ${f.padEnd(12)} ${(st.size / 1024).toFixed(1)} KB`);
}
console.log('generate-icons: done.');
