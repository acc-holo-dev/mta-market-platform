// Минимальный PNG-энкодер (только Node built-ins: zlib) для dev-датасета
// PLAN-003 Q: настоящие изображения обложек/скриншотов без сторонних
// зависимостей и без fake stock photos — абстрактные градиенты с фигурами.
import zlib from "zlib";

type RGB = [number, number, number];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  // PNG chunk CRC хранится big-endian (как и length).
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * Сгенерировать PNG по пиксельной функции draw(x, y) -> [r, g, b]
 * (alpha всегда 255).
 */
export function generatePng(
  width: number,
  height: number,
  draw: (x: number, y: number) => RGB
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = draw(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = 255;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

interface Palette {
  from: RGB;
  to: RGB;
  accent: RGB;
  variant: number;
}

/** Детерминированная палитра по seed-строке (slug). */
export function styleFor(seed: string, variantCount = 6): Palette {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hueBase = (Math.abs(hash) % 360) / 360;
  const h2 = (hueBase + (40 + (Math.abs(hash >> 3) % 80)) / 360) % 1;
  const h3 = (hueBase + 0.5) % 1;
  return {
    from: hslToRgb(hueBase, 0.55, 0.32),
    to: hslToRgb(h2, 0.5, 0.16),
    accent: hslToRgb(h3, 0.7, 0.62),
    variant: Math.abs(Math.imul(hash >> 5, 2654435761)) % variantCount,
  };
}

/** Абстрактная обложка: диагональный градиент + мягкое пятно акцента. */
export function generateCover(slug: string, width = 640, height = 360): Buffer {
  const { from, to, accent, variant } = styleFor(slug);
  return generatePng(width, height, (x, y) => {
    const t = (x / width + y / height) / 2;
    let rgb = mix(from, to, t);
    const cx = width * (0.25 + 0.5 * ((variant % 3) / 3));
    const cy = height * (variant % 2 === 0 ? 0.45 : 0.6);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < height * 0.28) {
      rgb = mix(rgb, accent, 0.55 * (1 - dist / (height * 0.28)));
    }
    if (x % 48 === 0 || y % 48 === 0) {
      rgb = mix(rgb, [255, 255, 255], 0.05);
    }
    return rgb;
  });
}

/** Скриншот: другая композиция — горизонтальные «панели». */
export function generateScreenshot(
  slug: string,
  index: number,
  width = 640,
  height = 360
): Buffer {
  const { from, to, accent, variant } = styleFor(`${slug}-shot-${index + 1}`);
  const shift = (variant * 37 + index * 61) % 100;
  return generatePng(width, height, (x, y) => {
    const band = Math.floor((y / height) * 5 + shift / 40) % 5;
    const base: RGB = band % 2 === 0 ? from : mix(from, to, 0.6);
    let rgb = mix(base, to, (y / height) * 0.5);
    if (band === 2 && x > width * 0.15 && x < width * 0.85 && y > height * 0.35 && y < height * 0.75) {
      rgb = mix(rgb, accent, 0.35);
    }
    return rgb;
  });
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}
