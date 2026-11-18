// ============================================================================
// Procedural PBR Material Texture Array Generator (Zero External URLs)
// 16 Tileable Layers (128x128 RGBA8) covering 32 Planetary & Marine Materials
// ============================================================================
import {
  PI, TAU, sin, cos, abs, min, max, floor, sqrt, clamp, lerp, smoothstep, hash2, noise2, fbm2
} from './math.js';

const TEX_SIZE = 128;
const TEX_LAYERS = 16;

const PROCEDURAL_MATERIALS = [
  // Soils, Sediments & Seabed
  { id: 0,  name: 'alluvial_loam',      layer: 0,  category: 'soil' },
  { id: 1,  name: 'forest_humus',       layer: 0,  category: 'soil' },
  { id: 2,  name: 'cypress_peat_mud',   layer: 1,  category: 'mud' },
  { id: 3,  name: 'mangrove_silt',      layer: 1,  category: 'mud' },
  { id: 4,  name: 'quartz_river_sand',  layer: 2,  category: 'sand' },
  { id: 5,  name: 'coralline_beach_sand', layer: 2, category: 'sand' },
  // Groundcover, Savanna, Plantations & Leaf Litter
  { id: 6,  name: 'bryophyte_moss',     layer: 3,  category: 'moss' },
  { id: 7,  name: 'swamp_duckweed',     layer: 3,  category: 'moss' },
  { id: 8,  name: 'sawgrass_meadow',    layer: 4,  category: 'grass' },
  { id: 9,  name: 'savanna_gold_grass', layer: 4,  category: 'grass' },
  { id: 10, name: 'amazon_leaf_litter', layer: 5,  category: 'litter' },
  { id: 11, name: 'plantation_mulch',   layer: 5,  category: 'litter' },
  // Rocks, Reefs, Ice & Volcanic Minerals
  { id: 12, name: 'river_cobble',       layer: 6,  category: 'rock' },
  { id: 13, name: 'laterite_gravel',    layer: 6,  category: 'rock' },
  { id: 14, name: 'karst_limestone',    layer: 7,  category: 'rock' },
  { id: 15, name: 'glacial_shelf_ice',  layer: 7,  category: 'ice' },
  { id: 16, name: 'abyssal_mesa_rock',  layer: 8,  category: 'rock' },
  { id: 17, name: 'kopje_granite',      layer: 8,  category: 'rock' },
  // Tree Barks & Shipwreck Timber
  { id: 18, name: 'bald_cypress_bark',  layer: 9,  category: 'bark' },
  { id: 19, name: 'sunken_galleon_oak', layer: 9,  category: 'wood' },
  { id: 20, name: 'kapok_buttress_bark',layer: 10, category: 'bark' },
  { id: 21, name: 'acacia_savanna_bark',layer: 10, category: 'bark' },
  { id: 22, name: 'royal_palm_rings',   layer: 11, category: 'bark' },
  { id: 23, name: 'giant_bamboo_culm',  layer: 11, category: 'bark' },
  // Wildfire Char & Volcanic Obsidian
  { id: 24, name: 'alligatored_char',   layer: 12, category: 'char' },
  { id: 25, name: 'volcanic_obsidian',  layer: 12, category: 'char' },
  // Foliage, Kelp & Corals
  { id: 26, name: 'kapok_canopy_leaf',  layer: 13, category: 'foliage' },
  { id: 27, name: 'abyssal_ribbon_kelp',layer: 13, category: 'kelp' },
  { id: 28, name: 'palm_frond_pinnae',  layer: 14, category: 'foliage' },
  { id: 29, name: 'banana_plantation_frond', layer: 14, category: 'foliage' },
  { id: 30, name: 'monstera_fern_lamina', layer: 15, category: 'foliage' },
  { id: 31, name: 'staghorn_reef_coral', layer: 15, category: 'coral' }
];

function tileFbm(u, v, freq, seedOff, oct = 3) {
  const ax = cos(u * TAU) * freq, ay = sin(u * TAU) * freq;
  const bx = cos(v * TAU) * freq, by = sin(v * TAU) * freq;
  return fbm2(ax + bx * 0.45 + seedOff, ay + by * 0.45 - seedOff * 0.7, oct);
}

function tileVoronoi(u, v, cells) {
  const px = u * cells, py = v * cells;
  const ix = floor(px), iy = floor(py);
  const fx = px - ix, fy = py - iy;
  let d1 = 8.0, d2 = 8.0, cid = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ((ix + dx) % cells + cells) % cells;
      const cy = ((iy + dy) % cells + cells) % cells;
      const ox = hash2(cx * 13 + 7, cy * 29 + 3);
      const oy = hash2(cx * 31 + 11, cy * 17 + 19);
      const rx = dx + ox - fx, ry = dy + oy - fy;
      const d = rx * rx + ry * ry;
      if (d < d1) {
        d2 = d1; d1 = d;
        cid = hash2(cx + 101, cy + 211);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  const s1 = sqrt(d1), s2 = sqrt(d2);
  return [s1, s2 - s1, cid];
}

function generateMaterialAtlas(size = TEX_SIZE) {
  const totalBytes = size * size * TEX_LAYERS * 4;
  const out = new Uint8Array(totalBytes);
  const inv = 1 / size;

  for (let layer = 0; layer < TEX_LAYERS; layer++) {
    const layerOffset = layer * size * size * 4;
    for (let y = 0; y < size; y++) {
      const v = y * inv;
      for (let x = 0; x < size; x++) {
        const u = x * inv;
        const n0 = tileFbm(u, v, 2.0, layer * 11.3 + 1.7, 3);
        const n1 = tileFbm(u + 0.23, v + 0.41, 4.2, layer * 7.9 + 3.1, 3);
        const fine = tileFbm(u, v, 8.5, layer * 19.1, 2);
        const [f1, edge, cid] = tileVoronoi(u + n0 * 0.06, v + n1 * 0.06, 6);

        let r = 80, g = 80, b = 80, a = 128;

        switch (layer) {
          case 0: { // Rich Alluvial Loam & Humus
            const crum = 0.55 + 0.45 * n0;
            r = (68 + 30 * n1) * crum;
            g = (50 + 22 * n0) * crum;
            b = (34 + 16 * fine) * crum;
            a = 60 + 160 * (1 - f1 * 0.8);
            break;
          }
          case 1: { // Wet Cypress Peat Mud & Mangrove Silt
            const wet = smoothstep(0.25, 0.75, n0);
            r = lerp(42, 26, wet) + fine * 14;
            g = lerp(36, 22, wet) + fine * 12;
            b = lerp(28, 18, wet) + fine * 10;
            a = 40 + 190 * (1 - wet * 0.7);
            break;
          }
          case 2: { // Quartz River Sand & Golden Tropical Beach Sand
            const ripple = sin((u * 8 + n0 * 1.2) * TAU) * 0.5 + 0.5;
            const spark = fine > 0.72 ? 28 : 0;
            r = 164 + 38 * ripple + spark;
            g = 148 + 34 * ripple + spark;
            b = 112 + 26 * ripple + spark;
            a = 95 + 125 * ripple;
            break;
          }
          case 3: { // Velvet Bryophyte Moss
            const tuft = clamp(1 - f1 * 1.35, 0, 1);
            r = 38 + 36 * tuft + 18 * n0;
            g = 88 + 72 * tuft + 24 * n1;
            b = 26 + 22 * tuft;
            a = 75 + 165 * tuft;
            break;
          }
          case 4: { // Sawgrass & Savanna Meadow Blades
            const blade = abs(sin((u * 22 + n0 * 2.5) * PI) * cos((v * 16 + n1 * 2.0) * PI));
            r = 52 + 46 * blade + 20 * n1;
            g = 102 + 68 * blade + 24 * n0;
            b = 34 + 24 * blade;
            a = 80 + 150 * blade;
            break;
          }
          case 5: { // Fallen Leaf Litter & Twigs
            const leaf = smoothstep(0.32, 0.06, f1);
            r = lerp(58, 96 + 48 * cid, leaf);
            g = lerp(42, 64 + 34 * cid, leaf);
            b = lerp(28, 32 + 18 * cid, leaf);
            a = 55 + 170 * leaf;
            break;
          }
          case 6: { // River Cobble & Laterite Gravel
            const stone = smoothstep(0.04, 0.18, edge);
            const shade = 0.65 + 0.35 * cid;
            r = (112 * shade + 24 * n0) * stone;
            g = (98 * shade + 20 * n1) * stone;
            b = (84 * shade + 16 * fine) * stone;
            a = 40 + 195 * stone;
            break;
          }
          case 7: { // Karst Limestone & Glacial Shelf Ice
            const pit = smoothstep(0.18, 0.45, f1);
            const base = 132 + 48 * n0 - (1 - pit) * 38;
            r = base + 8;
            g = base + 6;
            b = base - 4;
            a = 70 + 165 * pit * n1;
            break;
          }
          case 8: { // Noniv/abyssal-garden Procedural Rock Detail & Kopje Granite
            const ridge = 1.0 - abs(n0 * 2.0 - 1.0);
            const crack = smoothstep(0.02, 0.12, edge);
            const rockH = (n0 * 0.55 + ridge * 0.45) * crack;
            r = (76 + 58 * rockH + 22 * cid);
            g = (74 + 54 * rockH + 18 * cid);
            b = (78 + 56 * rockH + 20 * cid);
            a = clamp(floor(rockH * 245), 10, 250);
            break;
          }
          case 9: { // Bald Cypress Fibrous Bark & Sunken Galleon Oak
            const strip = abs(sin((u * 16 + n0 * 1.4) * PI));
            const furrow = 0.52 + 0.48 * strip;
            r = 104 * furrow + 18 * n1;
            g = 82 * furrow + 14 * n1;
            b = 64 * furrow + 10 * n1;
            a = 50 + 180 * strip;
            break;
          }
          case 10: { // Kapok Buttress Bark & Lenticels
            const lent = smoothstep(0.68, 0.88, sin(v * TAU * 16 + n1 * 4.0) * 0.5 + 0.5);
            const lichen = smoothstep(0.72, 0.88, n0 * 0.6 + fine * 0.4);
            r = lerp(88 + lent * 26, 128, lichen * 0.5);
            g = lerp(70 + lent * 22, 142, lichen * 0.5);
            b = lerp(54 + lent * 16, 108, lichen * 0.5);
            a = 75 + 145 * (n0 * 0.7 + lent * 0.3);
            break;
          }
          case 11: { // Royal Palm Ring Scars & Giant Bamboo Culms
            const ring = abs(sin((v * 14 + n0 * 0.6) * PI));
            const tone = 0.62 + 0.38 * ring;
            r = 118 * tone;
            g = 98 * tone;
            b = 76 * tone;
            a = 65 + 165 * ring;
            break;
          }
          case 12: { // Wildfire Alligatored Char & Volcanic Obsidian
            const block = smoothstep(0.03, 0.14, edge);
            const ash = smoothstep(0.72, 0.92, fine) * (1 - block * 0.5);
            r = lerp(16, 36, block) + ash * 54;
            g = lerp(15, 32, block) + ash * 52;
            b = lerp(15, 30, block) + ash * 50;
            a = 25 + 195 * block;
            break;
          }
          case 13: { // Broadleaf Lamina & Abyssal Ribbon Kelp
            const mx = abs(u - 0.5);
            const midrib = 1 - smoothstep(0.008, 0.032, mx);
            const sec = 1 - smoothstep(0.05, 0.16, abs(sin((v * 10 - mx * 8.5) * PI)));
            const vein = max(midrib, sec * 0.7);
            const mask = 1 - smoothstep(0.36, 0.48, mx + (1 - sin(v * PI)) * 0.18);
            r = 38 + 48 * vein + 20 * n0;
            g = 92 + 64 * vein + 34 * n1;
            b = 26 + 22 * vein;
            a = clamp(floor(mask * 255), 0, 255);
            break;
          }
          case 14: { // Palm Frond Pinnae & Banana Plantation Leaves
            const pinna = abs(sin(v * 24 * PI));
            const alpha = smoothstep(0.18, 0.45, pinna);
            r = 46 + 34 * n0;
            g = 108 + 56 * pinna;
            b = 28 + 18 * n1;
            a = clamp(floor(alpha * 255), 0, 255);
            break;
          }
          case 15:
          default: { // Monstera Fenestrated Frond & Reef Coral
            const hole = smoothstep(0.14, 0.22, f1);
            r = 34 + 32 * n0;
            g = 96 + 58 * n1;
            b = 28 + 20 * fine;
            a = clamp(floor(hole * 255), 0, 255);
            break;
          }
        }

        const idx = layerOffset + (y * size + x) * 4;
        out[idx]     = clamp(floor(r), 4, 240);
        out[idx + 1] = clamp(floor(g), 4, 240);
        out[idx + 2] = clamp(floor(b), 4, 240);
        out[idx + 3] = clamp(floor(a), 0, 255);
      }
    }
  }
  return out;
}

function downsampleLayer(src, sw, sh) {
  const dw = max(1, sw >> 1), dh = max(1, sh >> 1);
  const dst = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = y * 2, y1 = min(sh - 1, y0 + 1);
    for (let x = 0; x < dw; x++) {
      const x0 = x * 2, x1 = min(sw - 1, x0 + 1);
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        dst[o + c] = (src[i00 + c] + src[i10 + c] + src[i01 + c] + src[i11 + c] + 2) >> 2;
      }
    }
  }
  return { data: dst, w: dw, h: dh };
}

function uploadMaterialTextureArray(device) {
  const atlas = generateMaterialAtlas(TEX_SIZE);
  const mipCount = Math.floor(Math.log2(TEX_SIZE)) + 1;
  const tex = device.createTexture({
    size: [TEX_SIZE, TEX_SIZE, TEX_LAYERS],
    mipLevelCount: mipCount,
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  const layerBytes = TEX_SIZE * TEX_SIZE * 4;
  for (let layer = 0; layer < TEX_LAYERS; layer++) {
    let cur = atlas.subarray(layer * layerBytes, (layer + 1) * layerBytes);
    let w = TEX_SIZE, h = TEX_SIZE;
    for (let mip = 0; mip < mipCount; mip++) {
      device.queue.writeTexture(
        { texture: tex, mipLevel: mip, origin: [0, 0, layer] },
        cur,
        { bytesPerRow: w * 4, rowsPerImage: h },
        [w, h, 1]
      );
      if (mip + 1 < mipCount) {
        const next = downsampleLayer(cur, w, h);
        cur = next.data;
        w = next.w;
        h = next.h;
      }
    }
  }
  return { tex, atlas };
}

export {
  TEX_SIZE,
  TEX_LAYERS,
  PROCEDURAL_MATERIALS,
  generateMaterialAtlas,
  uploadMaterialTextureArray
};
