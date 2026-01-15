/**
 * Generate simple PNG icons for the Word add-in
 * Creates blue square icons with "N" letter at different sizes
 */

import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CRC32 lookup table for PNG
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const crcData = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));

  return Buffer.concat([length, typeBytes, data, crc]);
}

function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(2, 9);   // color type (RGB)
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace

  // IDAT chunk (image data)
  // Add filter byte (0) at start of each row
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter type: none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      rawData.push(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    }
  }
  const compressed = deflateSync(Buffer.from(rawData));

  // IEND chunk
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', iend)
  ]);
}

function createIcon(size) {
  const pixels = new Uint8Array(size * size * 3);

  // Colors
  const bgColor = [59, 130, 246];   // Blue (#3B82F6)
  const fgColor = [255, 255, 255];  // White

  // Fill background
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = bgColor[0];
    pixels[i + 1] = bgColor[1];
    pixels[i + 2] = bgColor[2];
  }

  // Draw "N" letter
  const padding = Math.floor(size * 0.2);
  const strokeWidth = Math.max(2, Math.floor(size * 0.15));

  const left = padding;
  const right = size - padding - strokeWidth;
  const top = padding;
  const bottom = size - padding;

  // Draw letter "N"
  for (let y = top; y < bottom; y++) {
    // Left vertical line
    for (let x = left; x < left + strokeWidth; x++) {
      const idx = (y * size + x) * 3;
      pixels[idx] = fgColor[0];
      pixels[idx + 1] = fgColor[1];
      pixels[idx + 2] = fgColor[2];
    }

    // Right vertical line
    for (let x = right; x < right + strokeWidth; x++) {
      const idx = (y * size + x) * 3;
      pixels[idx] = fgColor[0];
      pixels[idx + 1] = fgColor[1];
      pixels[idx + 2] = fgColor[2];
    }

    // Diagonal line
    const progress = (y - top) / (bottom - top - 1);
    const diagX = Math.floor(left + strokeWidth + progress * (right - left - strokeWidth));
    for (let dx = 0; dx < strokeWidth; dx++) {
      const x = diagX + dx;
      if (x >= 0 && x < size) {
        const idx = (y * size + x) * 3;
        pixels[idx] = fgColor[0];
        pixels[idx + 1] = fgColor[1];
        pixels[idx + 2] = fgColor[2];
      }
    }
  }

  return createPNG(size, size, pixels);
}

// Generate icons
const sizes = [16, 32, 80];
const outputDir = process.cwd() + '/public/assets';

try {
  mkdirSync(outputDir, { recursive: true });
} catch (e) {
  // Directory exists
}

for (const size of sizes) {
  const png = createIcon(size);
  const path = `${outputDir}/icon-${size}.png`;
  writeFileSync(path, png);
  console.log(`Created ${path} (${png.length} bytes)`);
}

console.log('Icon generation complete!');
