// Generates a simple sticky-note PNG icon without external deps.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZE = 128;
const PAPER = [244, 211, 94]; // yellow
const HEADER = [212, 175, 55]; // darker yellow header strip
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

const buildImage = () => {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  const radius = 16;
  const margin = 8;
  const inner = SIZE - margin * 2;
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // filter byte: none
    for (let x = 0; x < SIZE; x++) {
      const off = y * stride + 1 + x * 4;
      const lx = x - margin;
      const ly = y - margin;
      const inside = lx >= 0 && ly >= 0 && lx < inner && ly < inner && inRoundedRect(lx, ly, inner, radius);
      let px = BG;
      if (inside) px = ly < inner * 0.18 ? [...HEADER, 255] : [...PAPER, 255];
      raw[off] = px[0];
      raw[off + 1] = px[1];
      raw[off + 2] = px[2];
      raw[off + 3] = px[3];
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
