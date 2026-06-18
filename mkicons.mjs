// Generates a simple sticky-note PNG icon without external deps.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZE = 128;
const PAPER = [244, 211, 94]; // yellow
const HEADER = [212, 175, 55]; // darker yellow header strip
const ANCHOR = [51, 51, 51]; // dark anchor mark centered on the note body
const BG = [0, 0, 0, 0]; // transparent

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
};

const inRoundedRect = (x, y, size, radius) => {
  const min = radius;
  const max = size - radius;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

// Distance from point (px,py) to the segment (ax,ay)-(bx,by).
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.min(Math.max(t, 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// An anchor (⚓) drawn from primitives, centered on the note body.
const ANCHOR_SCALE = 0.8; // 20% smaller
const ANCHOR_SHIFT_Y = 8; // nudged down
const inAnchor = (px, py) => {
  // Map the screen point back into the anchor's design space so the same
  // primitive coordinates render scaled + shifted.
  const ax = 64;
  const ay = 65;
  const x = (px - ax) / ANCHOR_SCALE + ax;
  const y = (py - ay - ANCHOR_SHIFT_Y) / ANCHOR_SCALE + ay;
  const cx = 64;
  const ringD = Math.hypot(x - cx, y - 42);
  const ring = ringD <= 10.5 && ringD >= 5; // top ring (annulus)
  const shank = segDist(x, y, cx, 38, cx, 93) <= 3; // vertical shank
  const stock = segDist(x, y, cx - 19, 55, cx + 19, 55) <= 3; // horizontal crossbar
  const arcD = Math.hypot(x - cx, y - 64);
  const arc = Math.abs(arcD - 25) <= 3 && y >= 64; // bottom bend
  const flukeL = segDist(x, y, cx - 24, 66, cx - 34, 50) <= 3.2; // left fluke
  const flukeR = segDist(x, y, cx + 24, 66, cx + 34, 50) <= 3.2; // right fluke
  return ring || shank || stock || arc || flukeL || flukeR;
};

const MARGIN = 8;
const INNER = SIZE - MARGIN * 2;
const RADIUS = 16;
const SS = 4; // supersampling factor for anti-aliased edges

// Color (with alpha) of a single sample point in image space.
const sampleColor = (fx, fy) => {
  const lx = fx - MARGIN;
  const ly = fy - MARGIN;
  const inside = lx >= 0 && ly >= 0 && lx < INNER && ly < INNER && inRoundedRect(lx, ly, INNER, RADIUS);
  if (!inside) return BG;
  if (inAnchor(fx, fy)) return [...ANCHOR, 255];
  return ly < INNER * 0.18 ? [...HEADER, 255] : [...PAPER, 255];
};

const buildImage = () => {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  const samples = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // filter byte: none
    for (let x = 0; x < SIZE; x++) {
      // Average SS×SS sub-samples using premultiplied alpha so transparent
      // edges blend cleanly instead of darkening toward black.
      let ra = 0;
      let ga = 0;
      let ba = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, sa] = sampleColor(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          ra += r * sa;
          ga += g * sa;
          ba += b * sa;
          a += sa;
        }
      }
      const off = y * stride + 1 + x * 4;
      const outA = a / samples;
      raw[off] = a ? Math.round(ra / a) : 0;
      raw[off + 1] = a ? Math.round(ga / a) : 0;
      raw[off + 2] = a ? Math.round(ba / a) : 0;
      raw[off + 3] = Math.round(outA);
    }
  }
  return raw;
};

const encodePng = () => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(buildImage());
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
};

mkdirSync("icons", { recursive: true });
const png = encodePng();
writeFileSync("icons/icon-128.png", png);
console.log("icons/icon-128.png written", png.length, "bytes");
