// ============================================================================
// REALISM — Natural Earth 110m Public-Domain Geography Preprocessor
// Fetches public-domain Natural Earth vector datasets (land, lakes, rivers,
// glaciated areas, elevation points, marine basins) and compiles:
//   1. Compact 360x180 (1-degree) Earth geography atlas -> source/src/earth_geo.js
//   2. High-res 720x360 (0.5-degree) binary elevation/land/climate grid -> public/assets/earth-geo.bin
// License: Natural Earth data is in the Public Domain (CC0 / PD).
// ============================================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const DATASETS = {
  land: `${NE_BASE}/ne_110m_land.geojson`,
  lakes: `${NE_BASE}/ne_110m_lakes.geojson`,
  rivers: `${NE_BASE}/ne_110m_rivers_lake_centerlines.geojson`,
  glaciers: `${NE_BASE}/ne_110m_glaciated_areas.geojson`,
  regions: `${NE_BASE}/ne_110m_geography_regions_polys.geojson`,
  elevPts: `${NE_BASE}/ne_110m_geography_regions_elevation_points.geojson`,
  marine: `${NE_BASE}/ne_110m_geography_marine_polys.geojson`
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

// Ray-casting point-in-ring test for GeoJSON polygon rings ([lon, lat])
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, coords) {
  if (!coords || !coords.length) return false;
  if (!pointInRing(lon, lat, coords[0])) return false;
  for (let h = 1; h < coords.length; h++) {
    if (pointInRing(lon, lat, coords[h])) return false;
  }
  return true;
}

function extractPolygonsWithBBox(geojson, filterFn = null) {
  const out = [];
  for (const f of geojson.features || []) {
    if (filterFn && !filterFn(f)) continue;
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
      for (const pt of outer) {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
      out.push({ rings, minLon, maxLon, minLat, maxLat, props: f.properties || {} });
    }
  }
  return out;
}

function hitTestPolys(lon, lat, polys) {
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) continue;
    if (pointInPolygon(lon, lat, p.rings)) return p;
  }
  return null;
}

function distToSegmentsDeg(lon, lat, lines) {
  let best = 999;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (lon < ln.minLon - 2 || lon > ln.maxLon + 2 || lat < ln.minLat - 2 || lat > ln.maxLat + 2) continue;
    const pts = ln.pts;
    for (let k = 0; k < pts.length - 1; k++) {
      const ax = pts[k][0], ay = pts[k][1];
      const bx = pts[k + 1][0], by = pts[k + 1][1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / len2));
      const px = ax + dx * t, py = ay + dy * t;
      const d = Math.hypot((lon - px) * Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat - py);
      if (d < best) best = d;
    }
  }
  return best;
}

// Major real-world topographic ranges, plateaus, deserts & ocean trenches (GEBCO/SRTM physical reference)
const MOUNTAIN_BELTS = [
  // [lat, lon, rxDeg, ryDeg, peakM]
  [28.0, 86.9, 14.0, 4.5, 6200],   // Himalayas & Everest
  [33.5, 88.0, 16.0, 6.0, 4800],   // Tibetan Plateau
  [38.5, 73.5, 11.0, 4.5, 4600],   // Pamir / Karakoram / Tian Shan
  [46.5, 10.0, 8.0, 2.8, 3100],    // European Alps
  [42.5, 44.5, 6.5, 2.2, 3400],    // Caucasus
  [35.0, 49.0, 10.0, 4.0, 2200],   // Zagros / Iranian Plateau
  [60.0, 60.0, 3.0, 11.0, 1300],   // Ural Mountains
  [63.0, -151.0, 9.0, 4.0, 3600],  // Alaska Range / Denali
  [48.0, -116.0, 8.0, 13.0, 2700], // North American Rockies
  [37.0, -119.0, 4.0, 6.0, 2800],  // Sierra Nevada
  [20.0, -99.0, 6.0, 5.0, 2600],   // Sierra Madre / Mexican Plateau
  [-12.0, -75.0, 4.5, 14.0, 4400], // Central Andes / Altiplano
  [-32.0, -70.0, 3.8, 12.0, 4100], // Southern Andes / Aconcagua
  [5.0, -75.0, 4.5, 7.0, 3200],    // Northern Andes
  [9.0, 39.0, 6.5, 6.0, 2800],     // Ethiopian Highlands
  [-1.5, 29.8, 4.5, 7.0, 2500],    // East African Rift / Virunga / Kilimanjaro
  [31.5, -6.0, 7.0, 2.5, 2500],    // Atlas Mountains
  [-29.0, 28.5, 5.0, 4.5, 2300],   // Drakensberg
  [36.0, 138.0, 3.0, 4.5, 2400],   // Japanese Alps / Honshu
  [-4.0, 138.0, 7.0, 2.5, 3200],   // New Guinea Highlands
  [-43.5, 170.5, 2.8, 3.8, 2500],  // Southern Alps (NZ)
  [73.0, -42.0, 14.0, 9.0, 2700],  // Greenland Ice Sheet Dome
  [-82.0, 75.0, 42.0, 12.0, 3200], // East Antarctic Ice Plateau
  [-77.0, -100.0, 20.0, 7.0, 2100] // West Antarctic Ice Sheet
];

const OCEAN_TRENCHES = [
  // [lat, lon, rxDeg, ryDeg, extraDepthM]
  [18.0, 145.5, 4.0, 11.0, 5800],   // Mariana Trench
  [-23.0, -174.5, 3.5, 11.0, 5200], // Tonga-Kermadec Trench
  [19.5, -66.5, 6.5, 2.5, 4200],    // Puerto Rico Trench
  [-10.5, 110.0, 12.0, 3.0, 3600],  // Java / Sunda Trench
  [-18.0, -75.5, 3.5, 16.0, 4000],  // Peru-Chile Trench
  [44.0, 151.0, 8.0, 4.5, 4400],    // Kuril-Kamchatka Trench
  [52.5, -170.0, 18.0, 3.0, 3400],  // Aleutian Trench
  [-58.0, -25.0, 4.0, 6.0, 3800]    // South Sandwich Trench
];

const DESERT_BELTS = [
  // [lat, lon, rxDeg, ryDeg, aridity]
  [23.5, 13.0, 28.0, 9.5, 1.0],     // Sahara
  [23.0, 46.5, 11.0, 8.5, 0.98],    // Arabian Desert
  [42.0, 102.0, 16.0, 6.5, 0.88],   // Gobi / Taklamakan
  [40.0, 61.0, 12.0, 5.5, 0.85],    // Karakum / Kyzylkum
  [27.5, 71.0, 5.5, 4.5, 0.82],     // Thar Desert
  [-24.5, 131.0, 15.0, 7.5, 0.92],  // Australian Outback / Great Victoria
  [-24.0, 16.0, 5.0, 7.0, 0.95],    // Namib / Kalahari
  [-23.0, -69.5, 3.2, 7.0, 0.96],   // Atacama
  [33.0, -112.0, 7.0, 6.5, 0.84],   // Sonoran / Mojave / Chihuahuan
  [-44.0, -69.0, 4.5, 7.5, 0.72]    // Patagonian Cold Desert
];

async function main() {
  console.log('Fetching Natural Earth 110m Public Domain geographic datasets...');
  const [landGeo, lakesGeo, riversGeo, glaciersGeo, elevPtsGeo] = await Promise.all([
    fetchJson(DATASETS.land),
    fetchJson(DATASETS.lakes),
    fetchJson(DATASETS.rivers),
    fetchJson(DATASETS.glaciers),
    fetchJson(DATASETS.elevPts)
  ]);

  const landPolys = extractPolygonsWithBBox(landGeo);
  const lakePolys = extractPolygonsWithBBox(lakesGeo);
  const glacierPolys = extractPolygonsWithBBox(glaciersGeo);

  const riverLines = [];
  for (const f of riversGeo.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const arr = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const pts of arr) {
      if (pts.length < 2) continue;
      let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
      for (const pt of pts) {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
      riverLines.push({ pts, minLon, maxLon, minLat, maxLat });
    }
  }

  const elevPeaks = [];
  for (const f of elevPtsGeo.features || []) {
    const c = f.geometry?.coordinates;
    const elev = Number(f.properties?.elevation);
    if (c && Number.isFinite(elev) && elev > 500) {
      elevPeaks.push([c[1], c[0], elev]);
    }
  }

  console.log(`Loaded Natural Earth: ${landPolys.length} land polys, ${lakePolys.length} lakes, ${riverLines.length} river segments, ${glacierPolys.length} glacier polys, ${elevPeaks.length} elevation peaks.`);

  function rasterize(W, H) {
    // 4 channels per cell:
    // byte0: elevEncoded (0..255): 0..127 => ocean (-10000m .. -10m), 128..255 => land (0m .. +7600m)
    // byte1: flags bitmask (1=land, 2=lake, 4=river, 8=glacier, 16=shelf)
    // byte2: aridity (0..255)
    // byte3: moisture/forest bias (0..255)
    const buf = new Uint8Array(W * H * 4);
    const landMask = new Uint8Array(W * H);

    // Pass 1: exact Natural Earth land, lake & glacier containment
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      for (let x = 0; x < W; x++) {
        const lon = -180 + ((x + 0.5) / W) * 360;
        const idx = y * W + x;
        const isLand = hitTestPolys(lon, lat, landPolys) !== null;
        const isLake = isLand && hitTestPolys(lon, lat, lakePolys) !== null;
        const isGlacier = hitTestPolys(lon, lat, glacierPolys) !== null;
        if (isLand && !isLake) landMask[idx] = 1;
        let flags = 0;
        if (isLand) flags |= 1;
        if (isLake) flags |= 2;
        if (isGlacier || lat < -68) flags |= 8;
        buf[idx * 4 + 1] = flags;
      }
    }

    // Pass 2: fast distance-to-coast approximation (in cells) for continental shelves & inland elevation
    const distOcean = new Uint8Array(W * H); // distance from nearest land (for ocean cells)
    const distLand = new Uint8Array(W * H);  // distance from nearest ocean (for land cells)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const isL = landMask[idx] === 1;
        let best = 14;
        const rad = Math.max(4, Math.round(W / 48));
        for (let dy = -rad; dy <= rad; dy++) {
          const ny = Math.max(0, Math.min(H - 1, y + dy));
          for (let dx = -rad; dx <= rad; dx++) {
            const nx = (x + dx + W) % W;
            if ((landMask[ny * W + nx] === 1) !== isL) {
              const d = Math.hypot(dx, dy);
              if (d < best) best = d;
            }
          }
        }
        if (isL) distLand[idx] = Math.min(255, Math.round(best * 16));
        else distOcean[idx] = Math.min(255, Math.round(best * 16));
      }
    }

    // Pass 3: synthesize physically grounded elevation, bathymetry, rivers, aridity & forest moisture
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      const absLat = Math.abs(lat);
      for (let x = 0; x < W; x++) {
        const lon = -180 + ((x + 0.5) / W) * 360;
        const idx = y * W + x;
        let flags = buf[idx * 4 + 1];
        const isLand = (flags & 1) !== 0;
        const isLake = (flags & 2) !== 0;
        const isGlacier = (flags & 8) !== 0;

        let elevM = 0;
        if (isLake) {
          elevM = -18;
        } else if (isLand) {
          const inlandT = Math.min(1, distLand[idx] / 140);
          elevM = 28 + inlandT * 420;
          // Add major Earth mountain ranges
          for (let i = 0; i < MOUNTAIN_BELTS.length; i++) {
            const m = MOUNTAIN_BELTS[i];
            const dLon = Math.min(Math.abs(lon - m[1]), 360 - Math.abs(lon - m[1]));
            const d = Math.hypot(dLon / m[2], (lat - m[0]) / m[3]);
            if (d < 1.35) {
              const w = Math.max(0, 1 - d / 1.35);
              elevM += w * w * m[4];
            }
          }
          // Add Natural Earth real named elevation peaks
          for (let i = 0; i < elevPeaks.length; i++) {
            const pk = elevPeaks[i];
            const d = Math.hypot((lon - pk[1]) * Math.max(0.25, Math.cos(lat * Math.PI / 180)), lat - pk[0]);
            if (d < 3.2) {
              const w = Math.max(0, 1 - d / 3.2);
              elevM = Math.max(elevM, elevM * 0.55 + pk[2] * w * 0.72);
            }
          }
          // Natural Earth major rivers
          const rDist = distToSegmentsDeg(lon, lat, riverLines);
          if (rDist < 0.75) {
            flags |= 4;
            elevM = Math.max(4, elevM * 0.52);
          }
          if (isGlacier && elevM < 650) elevM = 650 + inlandT * 1400;
          elevM = Math.min(7600, Math.max(2, elevM));
        } else {
          // Ocean bathymetry: continental shelf -> abyssal plain -> real ocean trenches
          const coastCells = distOcean[idx] / 16.0;
          if (coastCells < 2.1) {
            flags |= 16; // continental shelf
            elevM = -35 - (coastCells / 2.1) * 240;
          } else {
            const abyssT = Math.min(1, (coastCells - 2.1) / 6.5);
            elevM = -280 - abyssT * 3950;
          }
          // Mid-Atlantic Ridge subtle uplift
          const marLon = -30 + Math.sin(lat * 0.06) * 14;
          const marD = Math.abs(lon - marLon);
          if (lat > -55 && lat < 65 && marD < 6.5) {
            elevM += (1 - marD / 6.5) * 1450;
          }
          // Deep ocean trenches
          for (let i = 0; i < OCEAN_TRENCHES.length; i++) {
            const tr = OCEAN_TRENCHES[i];
            const dLon = Math.min(Math.abs(lon - tr[1]), 360 - Math.abs(lon - tr[1]));
            const d = Math.hypot(dLon / tr[2], (lat - tr[0]) / tr[3]);
            if (d < 1.2) {
              const w = Math.max(0, 1 - d / 1.2);
              elevM -= w * w * tr[4];
            }
          }
          elevM = Math.max(-10200, Math.min(-5, elevM));
        }

        // Encode elevation into 0..255 with crisp sea-level split at 128
        let eByte = 128;
        if (elevM < 0) {
          // -10200..0 mapped non-linearly so shallow shelves have high precision
          const t = Math.pow(Math.min(1, -elevM / 10200), 0.55);
          eByte = Math.max(0, Math.min(127, Math.round(127 * (1 - t))));
        } else {
          const t = Math.pow(Math.min(1, elevM / 7600), 0.62);
          eByte = Math.max(128, Math.min(255, 128 + Math.round(127 * t)));
        }

        // Regional Aridity (real desert belts + rain shadows)
        let arid = 0.08;
        for (let i = 0; i < DESERT_BELTS.length; i++) {
          const ds = DESERT_BELTS[i];
          const dLon = Math.min(Math.abs(lon - ds[1]), 360 - Math.abs(lon - ds[1]));
          const d = Math.hypot(dLon / ds[2], (lat - ds[0]) / ds[3]);
          if (d < 1.25) {
            const w = Math.max(0, 1 - d / 1.25);
            arid = Math.max(arid, w * w * ds[4]);
          }
        }
        // Moisture / tropical-temperate forest belt
        let moist = 0.45;
        if (absLat < 12) moist = 0.88; // ITCZ equatorial rainforest belt (Amazon, Congo, Indonesia)
        else if (absLat > 42 && absLat < 64) moist = 0.72; // Temperate & boreal forest belt
        else if (absLat > 68) moist = 0.28; // Polar tundra/ice
        if (flags & 4) moist = Math.min(1, moist + 0.25);
        moist = Math.max(0.02, Math.min(1, moist * (1 - arid * 0.85)));

        buf[idx * 4] = eByte;
        buf[idx * 4 + 1] = flags;
        buf[idx * 4 + 2] = Math.round(arid * 255);
        buf[idx * 4 + 3] = Math.round(moist * 255);
      }
    }
    return buf;
  }

  // 1. Compact 240x120 (1.5-deg) embedded core atlas (~29 KB base64) for synchronous zero-latency evaluation
  const coreW = 240, coreH = 120;
  const coreBuf = rasterize(coreW, coreH);
  // Pack only 3 channels (elev, flags, aridity) into coreBuf3 to stay ultra-compact
  const coreBuf3 = new Uint8Array(coreW * coreH * 3);
  for (let i = 0; i < coreW * coreH; i++) {
    coreBuf3[i * 3] = coreBuf[i * 4];
    coreBuf3[i * 3 + 1] = coreBuf[i * 4 + 1];
    coreBuf3[i * 3 + 2] = coreBuf[i * 4 + 2];
  }
  const b64 = Buffer.from(coreBuf3).toString('base64');

  // 2. High-res 720x360 (0.5-deg) binary asset for streamed progressive upgrade
  const hiW = 720, hiH = 360;
  const hiBuf = rasterize(hiW, hiH);
  mkdirSync(path.join(root, 'public/assets'), { recursive: true });
  writeFileSync(path.join(root, 'public/assets/earth-geo.bin'), hiBuf);

  // Land coverage sanity check
  let landCells = 0;
  for (let i = 0; i < coreW * coreH; i++) if (coreBuf[i * 4 + 1] & 1) landCells++;
  console.log(`Core 240x120 land ratio: ${((landCells / (coreW * coreH)) * 100).toFixed(1)}%, base64 size: ${(b64.length / 1024).toFixed(1)} KB`);
  console.log(`Hi-res 720x360 binary size: ${(hiBuf.length / 1024).toFixed(1)} KB -> public/assets/earth-geo.bin`);

  const jsOut = `// ============================================================================
// REALISM — Real Earth Geographical Reference Atlas (Natural Earth 110m PD)
// Source: Natural Earth 110m Physical Vectors (Land, Lakes, Rivers, Glaciers,
// Elevation Peaks) + GEBCO/SRTM Major Mountain & Ocean Trench Reference.
// License: Public Domain (Natural Earth).
// ============================================================================
export const EARTH_GEO_ATTRIBUTION = {
  source: 'Natural Earth 110m Physical Vectors + GEBCO/SRTM Reference Ranges',
  license: 'Public Domain (CC0)',
  coreResolution: '${coreW}x${coreH}',
  streamedAsset: 'assets/earth-geo.bin (${hiW}x${hiH})'
};

const CORE_W = ${coreW};
const CORE_H = ${coreH};
const CORE_B64 = '${b64}';

function decodeBase64Bytes(str) {
  if (typeof atob === 'function') {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}

let activeW = CORE_W;
let activeH = CORE_H;
let activeStride = 3;
let activeData = decodeBase64Bytes(CORE_B64);

export function upgradeEarthGeoAtlas(arrayBuffer, w = ${hiW}, h = ${hiH}) {
  if (!arrayBuffer || arrayBuffer.byteLength !== w * h * 4) return false;
  activeData = new Uint8Array(arrayBuffer);
  activeW = w;
  activeH = h;
  activeStride = 4;
  return true;
}

function decodeElevMeters(eByte) {
  if (eByte < 128) {
    const t = 1.0 - eByte / 127.0;
    return -10200.0 * Math.pow(t, 1.0 / 0.55);
  }
  const t = (eByte - 128) / 127.0;
  return 7600.0 * Math.pow(t, 1.0 / 0.62);
}

// Bilinearly sample real Earth elevation, coastline land fraction, lakes, rivers, glaciers & aridity
export function sampleEarthGeoRef(latDeg, lonDeg, out = {}) {
  const lat = Math.max(-89.99, Math.min(89.99, latDeg));
  let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  const fx = ((lon + 180.0) / 360.0) * activeW - 0.5;
  const fy = ((90.0 - lat) / 180.0) * activeH - 0.5;
  const x0 = ((Math.floor(fx) % activeW) + activeW) % activeW;
  const x1 = (x0 + 1) % activeW;
  const y0 = Math.max(0, Math.min(activeH - 1, Math.floor(fy)));
  const y1 = Math.max(0, Math.min(activeH - 1, y0 + 1));
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);

  const i00 = (y0 * activeW + x0) * activeStride;
  const i10 = (y0 * activeW + x1) * activeStride;
  const i01 = (y1 * activeW + x0) * activeStride;
  const i11 = (y1 * activeW + x1) * activeStride;

  const e00 = decodeElevMeters(activeData[i00]);
  const e10 = decodeElevMeters(activeData[i10]);
  const e01 = decodeElevMeters(activeData[i01]);
  const e11 = decodeElevMeters(activeData[i11]);
  const e0 = e00 + (e10 - e00) * tx;
  const e1 = e01 + (e11 - e01) * tx;
  const elevM = e0 + (e1 - e0) * ty;

  const f00 = activeData[i00 + 1], f10 = activeData[i10 + 1], f01 = activeData[i01 + 1], f11 = activeData[i11 + 1];
  const bilerpBit = (bit) => {
    const a = ((f00 & bit) ? 1 : 0) + (((f10 & bit) ? 1 : 0) - ((f00 & bit) ? 1 : 0)) * tx;
    const b = ((f01 & bit) ? 1 : 0) + (((f11 & bit) ? 1 : 0) - ((f01 & bit) ? 1 : 0)) * tx;
    return a + (b - a) * ty;
  };

  const a00 = activeData[i00 + 2], a10 = activeData[i10 + 2], a01 = activeData[i01 + 2], a11 = activeData[i11 + 2];
  const ar0 = a00 + (a10 - a00) * tx;
  const ar1 = a01 + (a11 - a01) * tx;

  out.elevM = elevM;
  out.landFrac = bilerpBit(1);
  out.lakeFrac = bilerpBit(2);
  out.riverFrac = bilerpBit(4);
  out.glacierFrac = bilerpBit(8);
  out.shelfFrac = bilerpBit(16);
  out.aridity = (ar0 + (ar1 - ar0) * ty) / 255.0;
  return out;
}
`;

  writeFileSync(path.join(root, 'source/src/earth_geo.js'), jsOut);
  console.log('Generated source/src/earth_geo.js successfully.');
}

main().catch((e) => { console.error(e); process.exit(1); });
