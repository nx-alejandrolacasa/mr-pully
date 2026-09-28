// Rasterize the extension icon (same design as assets/icons/icon.svg) and
// the background-free toolbar glyph (assets/icons/toolbar-*.svg) to PNGs for
// Chrome, which doesn't accept SVG manifest icons. Pure Node, no
// dependencies: signed-distance fields for the shapes and a minimal PNG
// encoder. The Chrome build calls it, so no binary is committed.
import { deflateSync } from "node:zlib";

const SIZE = 128;

const BACKGROUND = [0, 0, 0];
const PAPER = [255, 255, 255];
export const TOOLBAR_DARK = [0x1f, 0x23, 0x28];
export const TOOLBAR_LIGHT = [255, 255, 255];
// The glyph's bounding square, the toolbar SVGs' viewBox.
const TOOLBAR_ORIGIN = 18;
const TOOLBAR_SPAN = 92;

const HALF_STROKE = 4;
type Point = readonly [number, number];
const ARROW: readonly Point[] = [
  [58, 34],
  [70, 23],
  [70, 45],
];
const ARROW_STROKE = 1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const coverage = (distance: number) => clamp01(0.5 - distance);
const blend = (rgb: number[], over: number[], t: number) => rgb.map((c, i) => mix(c, over[i] ?? c, t));

function roundedRectSDF(x: number, y: number, half: number, radius: number): number {
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

function ringSDF(x: number, y: number, cx: number, cy: number, r: number): number {
  return Math.abs(Math.hypot(x - cx, y - cy) - r) - HALF_STROKE;
}

function segmentSDF(x: number, y: number, [ax, ay]: Point, [bx, by]: Point): number {
  const ex = bx - ax;
  const ey = by - ay;
  const t = clamp01(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey));
  return Math.hypot(x - ax - ex * t, y - ay - ey * t) - HALF_STROKE;
}

// Quarter arc of the SVG's "A14 14 0 0 0 74 34": centre (74, 48), from the
// right (88, 48) up to the top (74, 34).
function cornerSDF(x: number, y: number): number {
  const [cx, cy, r] = [74, 48, 14];
  if (x >= cx && y <= cy) return Math.abs(Math.hypot(x - cx, y - cy) - r) - HALF_STROKE;
  return Math.min(Math.hypot(x - 88, y - 48), Math.hypot(x - 74, y - 34)) - HALF_STROKE;
}

function polygonSDF(px: number, py: number, vertices: readonly Point[]): number {
  const first = vertices[0];
  if (!first) return Infinity;
  let d = (px - first[0]) ** 2 + (py - first[1]) ** 2;
  let sign = 1;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (!a || !b) continue;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const wx = px - a[0];
    const wy = py - a[1];
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
    const qx = wx - ex * t;
    const qy = wy - ey * t;
    d = Math.min(d, qx * qx + qy * qy);
    const c1 = py >= a[1];
    const c2 = py < b[1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d);
}

function glyphSDF(x: number, y: number): number {
  return Math.min(
    ringSDF(x, y, 40, 34, 10),
    ringSDF(x, y, 40, 94, 10),
    ringSDF(x, y, 88, 94, 10),
    segmentSDF(x, y, [40, 44], [40, 84]),
    segmentSDF(x, y, [88, 84], [88, 48]),
    cornerSDF(x, y),
    segmentSDF(x, y, [74, 34], [70, 34]),
    polygonSDF(x, y, ARROW) - ARROW_STROKE
  );
}

function pixel(x: number, y: number): number[] {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const shape = coverage(roundedRectSDF(cx, cy, SIZE / 2, 28));
  if (shape === 0) return [0, 0, 0, 0];

  const rgb = blend(BACKGROUND, PAPER, coverage(glyphSDF(cx, cy)));

  return [...rgb.map(Math.round), Math.round(shape * 255)];
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) ---
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function renderIconPng(): Buffer {
  return encodePng(SIZE, pixel);
}

export function renderToolbarPng(size: number, color: readonly number[]): Buffer {
  const scale = TOOLBAR_SPAN / size;
  return encodePng(size, (x, y) => {
    const distance = glyphSDF(TOOLBAR_ORIGIN + (x + 0.5) * scale, TOOLBAR_ORIGIN + (y + 0.5) * scale);
    return [...color, Math.round(coverage(distance / scale) * 255)];
  });
}

function encodePng(size: number, pixelAt: (x: number, y: number) => number[]): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixelAt(x, y), row + 1 + x * 4);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
