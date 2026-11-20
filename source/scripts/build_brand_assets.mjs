// ============================================================================
// REALISM — Pixelated Uppercase 'R' Favicon (SVG + Raster PNGs) & Exact 1200x630
// Open Graph Social Preview Asset Generator
// ============================================================================
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'public/assets');
mkdirSync(outDir, { recursive: true });

// Crisp 16x16 architectural pixel-art uppercase 'R' grid (consistent with REALISM pixel wordmark)
const R_GRID = [
  '................',
  '................',
  '...#########....',
  '...##########...',
  '...###....###...',
  '...###....###...',
  '...###....###...',
  '...##########...',
  '...#########....',
  '...###...###....',
  '...###....###...',
  '...###....###...',
  '...###.....###..',
  '...###.....###..',
  '................',
  '................'
];

// 1. Minimal crisp SVG favicon (pixelated uppercase R on #060d0a architectural field)
const rects = [];
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    if (R_GRID[y][x] === '#') {
      // Subtle champagne-gold top highlight on upper crossbar, warm ivory body
      const fill = y <= 3 ? '#e2b857' : '#f2f0e6';
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    }
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#060d0a"/><rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="#e2b857" stroke-opacity="0.35" stroke-width="0.5"/>${rects.join('')}</svg>\n`;
writeFileSync(path.join(outDir, 'favicon.svg'), svg);

// Minimal pure-Node PNG encoder for sharp pixel-art raster favicons (32x32, 180x180, 512x512)
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}
function encodeRgbaPng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function renderPixelR(size) {
  const buf = Buffer.alloc(size * size * 4);
  const border = Math.max(1, Math.round(size / 32));
  for (let y = 0; y < size; y++) {
    const gy = Math.floor((y / size) * 16);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x / size) * 16);
      const isBorder = x < border || y < border || x >= size - border || y >= size - border;
      let r = 6, g = 13, b = 10;
      if (R_GRID[gy][gx] === '#') {
        if (gy <= 3) { r = 226; g = 184; b = 87; }
        else { r = 242; g = 240; b = 230; }
      } else if (isBorder) {
        r = 78; g = 68; b = 38;
      }
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  return encodeRgbaPng(size, size, buf);
}

writeFileSync(path.join(outDir, 'favicon-32x32.png'), renderPixelR(32));
writeFileSync(path.join(outDir, 'apple-touch-icon.png'), renderPixelR(180));
console.log('Generated pixelated R favicons: favicon.svg, favicon-32x32.png, apple-touch-icon.png');

// 2. Ensure exact 1200x630 PNG for Open Graph social preview from generated artwork
const srcJpg = path.join(root, 'src/assets/images/realism_social_preview_1795166720628.jpg');
const dstPng = path.join(outDir, 'realism-social-preview.png');
if (existsSync(srcJpg)) {
  try {
    execSync(`python3 -c "from PIL import Image; im=Image.open('${srcJpg}').convert('RGB'); tw,th=1200,630; sw,sh=im.size; sc=max(tw/sw,th/sh); nw,nh=int(round(sw*sc)),int(round(sh*sc)); im=im.resize((nw,nh),Image.LANCZOS); l=(nw-tw)//2; t=(nh-th)//2; im.crop((l,t,l+tw,t+th)).save('${dstPng}','PNG',optimize=True); print('Saved 1200x630 PNG via PIL')"`, { stdio: 'inherit' });
  } catch {
    execSync(`ffmpeg -y -i "${srcJpg}" -vf "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630" "${dstPng}"`, { stdio: 'inherit' });
  }
}
