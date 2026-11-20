// ============================================================================
// REALISM — 18-Biome Earth-Scale World Generation, Abyssal Garden Set-Pieces,
// Continuous Point-to-Point Creature Anatomy, Zero-Slide IK & Survival FSM
// ============================================================================
import {
  PI, TAU, DEG2RAD, sin, cos, abs, hypot, min, max, sqrt, floor, round, atan2, pow,
  clamp, saturate, lerp, smoothstep, smin, solveTwoBoneIK,
  normAngle, lerpAngle, yawToForward, velocityToYaw,
  WORLD_SEED, seedRng, rnd, rr, noise2, fbm2, MeshBuilder
} from './math.js';
import {
  WATER_LEVEL, BIOME_CATALOG,
  LAGOON_POS, POND_POS, CYPRESS_POS, AMAZON_POS, MANGROVE_POS,
  CLEARING_POS, PLANTATION_POS, SAVANNA_POS, BAMBOO_POS, HIGHLAND_POS,
  BEACH_POS, REEF_POS, ABYSS_POS, ROOKERY_POS, POLAR_POS,
  FIRE_POS, VOLCANO_POS, FORGOTTEN_POS, DUNE_POS,
  wrapDelta, terrainAt, evaluateHazardAt, getActiveOrigin, latLonToLocalMeters
} from './biomes.js';
import { THIN, MAX_PARTICLES_BUDGET } from './quality.js';

const REGION_HALF = 540;

const VEG_DENSITY_SCALE = 1 / THIN;
const SIZE_VAR_MIN = 0.82;
const SIZE_VAR_MAX = 1.24;

// ============================================================================
// Flora & Set-Piece Archetype Mesh Generators
// ============================================================================
function buildCypressMesh() {
  const m = new MeshBuilder();
  const barkDark = [0.22, 0.16, 0.12], barkMid = [0.30, 0.22, 0.16], barkTop = [0.34, 0.25, 0.18];
  const trunkPath = [[0, -0.4, 0], [0, 1.2, 0], [0.05, 4.0, -0.04], [-0.04, 7.5, 0.05], [0, 11.2, 0], [0, 14.2, 0]];
  const trunkRad = [[1.18, 1.12], [0.68, 0.65], [0.46, 0.46], [0.35, 0.35], [0.24, 0.24], [0.10, 0.10]];
  const trunkCols = [barkDark, barkDark, barkMid, barkMid, barkTop, barkTop];
  const trunkUvs = [[0, 0], [0, 0.05], [0, 0.18], [0, 0.35], [0, 0.55], [0, 0.75]];
  m.tube(trunkPath, trunkRad, trunkCols, trunkUvs, 8, true);

  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3;
    const kx = cos(a) * 1.45, kz = sin(a) * 1.45;
    const kh = 0.75 + (k % 3) * 0.28;
    m.tube([[kx, -0.35, kz], [kx * 0.92, kh * 0.6, kz * 0.92], [kx * 0.86, kh, kz * 0.86]], [0.24, 0.15, 0.05], [barkDark, barkMid, barkTop], [[0, 0], [0, 0.05], [0, 0.08]], 5, true);
  }

  const leafDark = [0.11, 0.26, 0.10], leafMid = [0.18, 0.39, 0.14], leafLit = [0.27, 0.50, 0.18];
  const mossCol = [0.38, 0.47, 0.30];
  for (let b = 0; b < 7; b++) {
    const a = b * 2.39996 + 0.4;
    const y0 = 7.2 + b * 0.92;
    const len = 3.2 + (1 - b / 7) * 1.9;
    const p0 = [0, y0, 0];
    const p1 = [cos(a) * len * 0.55, y0 + 0.7, sin(a) * len * 0.55];
    const p2 = [cos(a) * len, y0 + 1.05, sin(a) * len];
    m.tube([p0, p1, p2], [0.18, 0.11, 0.04], [barkMid, barkTop, barkTop], [[0, 0.4], [0, 0.65], [0, 0.85]], 5, true);
    m.ellipsoid(p2[0], p2[1] + 0.25, p2[2], 1.75, 0.68, 1.55, b % 2 ? leafMid : leafLit, 1, 0.85, 5, 7);
    m.ellipsoid(p1[0], p1[1] + 0.35, p1[2], 1.35, 0.55, 1.25, leafDark, 1, 0.65, 4, 6);
    for (let s = 0; s < 2; s++) {
      const mx = lerp(p1[0], p2[0], s * 0.55 + 0.25);
      const my = lerp(p1[1], p2[1], s * 0.55 + 0.25);
      const mz = lerp(p1[2], p2[2], s * 0.55 + 0.25);
      const mh = 1.6 + ((b + s) % 3) * 0.65;
      m.ribbon([mx, my, mz], [mx + 0.08, my - mh, mz - 0.06], 0.18, 0.05, 0.06, mossCol, [0.30, 0.39, 0.24], 1, 0.65, 1.0, 3);
    }
  }
  m.ellipsoid(0, 14.6, 0, 2.5, 0.95, 2.3, leafLit, 1, 0.92, 5, 7);
  return m.build();
}

function buildKapokMesh() {
  const m = new MeshBuilder();
  const b0 = [0.27, 0.20, 0.14], b1 = [0.35, 0.27, 0.19], b2 = [0.40, 0.31, 0.22];
  const path = [[0, -0.5, 0], [0, 2.6, 0], [0.08, 7.0, -0.05], [-0.06, 12.2, 0.06], [0, 16.8, 0], [0, 20.5, 0]];
  const rad = [[1.55, 1.48], [0.82, 0.80], [0.62, 0.62], [0.48, 0.48], [0.34, 0.34], [0.16, 0.16]];
  m.tube(path, rad, [b0, b0, b1, b1, b2, b2], [[0, 0], [0, 0.08], [0, 0.25], [0, 0.48], [0, 0.70], [0, 0.88]], 8, true);

  for (let fin = 0; fin < 5; fin++) {
    const a = (fin / 5) * TAU;
    const fx = cos(a) * 2.15, fz = sin(a) * 2.15;
    m.tube([[0, 3.2, 0], [fx * 0.55, 1.3, fz * 0.55], [fx, -0.4, fz]], [[0.18, 0.42], [0.22, 0.55], [0.14, 0.35]], [b1, b0, b0], [[0, 0.1], [0, 0.04], [0, 0]], 5, true);
  }

  for (let v = 0; v < 4; v++) {
    const a = v * 1.57 + 0.5;
    const r = 1.6 + (v % 2) * 0.7;
    const vx = cos(a) * r, vz = sin(a) * r;
    m.tube([[vx, 15.2, vz], [vx * 0.82 + 0.3, 10.0, vz * 0.82], [vx * 0.65, 4.8, vz * 0.65], [vx * 0.45, 0.2, vz * 0.45]], [0.05, 0.045, 0.045, 0.05], [[0.20, 0.28, 0.14], [0.22, 0.30, 0.15], [0.20, 0.26, 0.13], [0.18, 0.22, 0.11]], [[0, 0.7], [0, 0.85], [0, 0.65], [0, 0.2]], 4, false);
  }

  const cDark = [0.08, 0.24, 0.09], cMid = [0.15, 0.36, 0.13], cBright = [0.24, 0.48, 0.16];
  for (let b = 0; b < 8; b++) {
    const a = b * 2.39996 + 1.1;
    const y0 = 13.0 + (b / 8) * 6.5;
    const len = 4.6 + (1 - b / 8) * 2.4;
    const p1 = [cos(a) * len * 0.55, y0 + 1.1, sin(a) * len * 0.55];
    const p2 = [cos(a) * len, y0 + 1.9, sin(a) * len];
    m.tube([[0, y0, 0], p1, p2], [0.25, 0.15, 0.06], [b1, b2, b2], [[0, 0.55], [0, 0.75], [0, 0.90]], 5, true);
    m.ellipsoid(p2[0], p2[1] + 0.4, p2[2], 2.55, 0.92, 2.35, b % 2 ? cBright : cMid, 1, 0.92, 5, 7);
    m.ellipsoid(p1[0], p1[1] + 0.35, p1[2], 1.85, 0.75, 1.75, cDark, 1, 0.75, 4, 6);
  }
  m.ellipsoid(0, 21.3, 0, 3.4, 1.15, 3.2, cBright, 1, 0.98, 5, 8);
  return m.build();
}

function buildPalmMesh() {
  const m = new MeshBuilder();
  const b0 = [0.34, 0.26, 0.18], b1 = [0.42, 0.33, 0.23];
  const path = [], rad = [], cols = [], uvs = [];
  for (let i = 0; i <= 7; i++) {
    const f = i / 7;
    path.push([sin(f * 1.35) * 1.15, f * 9.6 - 0.3, cos(f * 0.9) * 0.35 - 0.35]);
    rad.push(lerp(0.28, 0.12, f));
    cols.push(i % 2 ? b0 : b1);
    uvs.push([0, f * 0.75]);
  }
  m.tube(path, rad, cols, uvs, 6, true);
  const top = path[path.length - 1];
  const fCol0 = [0.16, 0.38, 0.12], fCol1 = [0.32, 0.56, 0.18];
  for (let f = 0; f < 11; f++) {
    const a = (f / 11) * TAU;
    const drop = (f % 3) * 0.25 - 0.35;
    const len = 3.1 + (f % 2) * 0.45;
    const tip = [top[0] + cos(a) * len, top[1] + drop, top[2] + sin(a) * len];
    m.ribbon([top[0], top[1] + 0.1, top[2]], tip, 0.12, 0.42, 0.85, fCol0, fCol1, 1, 0.72, 1.0, 5);
  }
  return m.build();
}

function buildMangroveMesh() {
  const m = new MeshBuilder();
  const b0 = [0.24, 0.16, 0.11], b1 = [0.32, 0.22, 0.15];
  m.tube([[0, 0.7, 0], [0.06, 2.3, -0.04], [-0.04, 4.1, 0.05], [0, 5.6, 0]], [0.28, 0.22, 0.16, 0.08], [b0, b1, b1, b1], [[0, 0.1], [0, 0.3], [0, 0.55], [0, 0.75]], 6, true);
  for (let r = 0; r < 9; r++) {
    const a = (r / 9) * TAU + (r % 2) * 0.2;
    const rad = 1.45 + (r % 3) * 0.45;
    const yStart = 1.2 + (r % 3) * 0.38;
    const rx = cos(a) * rad, rz = sin(a) * rad;
    m.tube([[0, yStart, 0], [rx * 0.58, yStart * 0.65, rz * 0.58], [rx * 0.88, 0.1, rz * 0.88], [rx, -1.2, rz]], [0.075, 0.065, 0.055, 0.045], [b1, b0, b0, b0], [[0, 0.15], [0, 0.08], [0, 0.02], [0, 0]], 5, true);
  }
  const l0 = [0.14, 0.34, 0.11], l1 = [0.24, 0.46, 0.15];
  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * TAU;
    m.ellipsoid(cos(a) * 1.4, 5.2 + (c % 2) * 0.5, sin(a) * 1.4, 1.65, 0.78, 1.55, c % 2 ? l1 : l0, 1, 0.8, 5, 6);
  }
  m.ellipsoid(0, 5.9, 0, 1.9, 0.85, 1.8, l1, 1, 0.9, 5, 6);
  return m.build();
}

function buildUnderstoryMesh() {
  const m = new MeshBuilder();
  const c0 = [0.12, 0.34, 0.10], c1 = [0.28, 0.54, 0.16];
  const flCols = [[0.92, 0.24, 0.18], [0.95, 0.68, 0.14], [0.82, 0.28, 0.78]];
  for (let f = 0; f < 12; f++) {
    const a = (f / 12) * TAU + (f % 2) * 0.15;
    const len = 1.15 + (f % 3) * 0.35;
    const h = 0.45 + (f % 2) * 0.32;
    m.ribbon([0, 0.05, 0], [cos(a) * len, h, sin(a) * len], 0.08, 0.28, 0.38, c0, c1, 1, 0.15, 0.95, 4);
  }
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * TAU + 0.4;
    m.ellipsoid(cos(a) * 0.28, 0.62 + b * 0.12, sin(a) * 0.28, 0.11, 0.16, 0.11, flCols[b], 2, 0.85, 4, 5);
  }
  return m.build();
}

function buildRockLogFungusMesh() {
  const m = new MeshBuilder();
  // Fractured granite core boulder with angular secondary slabs & stratified karst shelf
  const g0 = [0.24, 0.26, 0.23], g1 = [0.30, 0.31, 0.28], gDark = [0.16, 0.17, 0.15];
  m.ellipsoid(0, 0.28, 0, 1.18, 0.68, 0.94, g0, 0, 0, 5, 7);
  m.ellipsoid(-0.55, 0.34, -0.28, 0.68, 0.52, 0.54, g1, 0, 0, 4, 6);
  m.ellipsoid(0.62, 0.22, -0.35, 0.58, 0.38, 0.48, gDark, 0, 0, 4, 5);
  // Stratified limestone / basalt hexagonal column spurs
  for (let c = 0; c < 3; c++) {
    const cx = -0.35 + c * 0.34, cz = -0.45 + (c % 2) * 0.18;
    const ch = 0.62 + (c === 1 ? 0.28 : 0.08);
    m.tube([[cx, 0.0, cz], [cx, ch, cz]], [0.22, 0.19], [gDark, g1], [[0, 0], [0, 0]], 6, true);
  }
  // Emerald bryophyte moss cushion on upper rock shelf
  m.ellipsoid(0.32, 0.62, 0.10, 0.78, 0.26, 0.62, [0.16, 0.39, 0.12], 0, 0, 4, 6);
  // Fallen hollow nurse log with weathered bark
  const bark = [0.22, 0.15, 0.10], heartwood = [0.34, 0.22, 0.14];
  m.tube([[-1.42, 0.22, 0.55], [0, 0.29, 0.64], [1.48, 0.18, 0.48]], [0.27, 0.24, 0.20], [bark, bark, heartwood], [[0, 0], [0, 0], [0, 0]], 6, true);
  // Bioluminescent Mycena chlorophos fungi clusters along the nurse log
  const glow = [0.32, 0.96, 0.64], stemCol = [0.20, 0.62, 0.46];
  for (let g = 0; g < 6; g++) {
    const gx = -0.82 + g * 0.32;
    const gy = 0.50 + (g % 2) * 0.05;
    const gz = 0.62 + ((g % 3) - 1) * 0.04;
    m.tube([[gx, gy - 0.10, gz], [gx, gy, gz]], [0.018, 0.012], [stemCol, glow], [[2, 0.1], [2, 0.2]], 4, false);
    m.ellipsoid(gx, gy + 0.02, gz, 0.11, 0.042, 0.11, glow, 2, 0.25, 4, 5);
  }
  return m.build();
}

function buildWaterFloraMesh() {
  const m = new MeshBuilder();
  const pad0 = [0.15, 0.42, 0.14], pad1 = [0.25, 0.54, 0.18];
  for (let p = 0; p < 4; p++) {
    const a = p * 1.57 + 0.3;
    const px = cos(a) * (0.45 + p * 0.18), pz = sin(a) * (0.45 + p * 0.18);
    const pr = 0.38 + (p % 2) * 0.14;
    m.ellipsoid(px, 0.02, pz, pr, 0.018, pr, p % 2 ? pad1 : pad0, 1, 0.2, 3, 7);
  }
  m.ellipsoid(0.35, 0.08, 0.2, 0.12, 0.09, 0.12, [0.95, 0.82, 0.88], 2, 0.3, 4, 6);
  const reed0 = [0.18, 0.36, 0.12], reed1 = [0.34, 0.52, 0.18];
  for (let r = 0; r < 9; r++) {
    const a = (r / 9) * TAU;
    const rx = cos(a) * 0.28, rz = sin(a) * 0.28;
    const h = 1.15 + (r % 3) * 0.38;
    m.ribbon([rx, -0.2, rz], [rx + cos(a) * 0.22, h, rz + sin(a) * 0.22], 0.035, 0.01, 0.08, reed0, reed1, 1, 0.1, 0.95, 3);
  }
  return m.build();
}

// Abyssal Garden Sunken Wooden Galleon Shipwreck (meshShip)
function buildSunkenGalleonMesh() {
  const m = new MeshBuilder();
  const darkOak = [0.18, 0.12, 0.08], midOak = [0.26, 0.18, 0.11], mossOak = [0.14, 0.26, 0.18];
  // Keel spine (-9m stern to +9m bow)
  m.tube([[0, 0.2, -9.0], [0, 0.0, -3.0], [0, 0.0, 4.0], [0, 1.8, 9.5]], [0.38, 0.42, 0.38, 0.24], [darkOak, darkOak, midOak, midOak], [[0, 0], [0, 0], [0, 0], [0, 0]], 6, true);
  // Curved hull ribs with starboard hull breach (skip ribs 4..6 on right side)
  for (let r = 0; r < 11; r++) {
    const f = r / 10;
    const z = lerp(-8.2, 8.2, f);
    const beam = sin(f * PI * 0.88 + 0.15) * 3.4 + 0.6;
    const deckH = 2.8 + (1 - f) * 1.4;
    // Port rib
    m.tube([[0, 0.1, z], [-beam * 0.85, deckH * 0.45, z], [-beam, deckH, z]], [0.18, 0.16, 0.14], [darkOak, midOak, mossOak], [[0, 0], [0, 0], [0, 0]], 5, true);
    // Starboard rib (breached in mid-hull)
    if (r < 4 || r > 6) {
      m.tube([[0, 0.1, z], [beam * 0.85, deckH * 0.45, z], [beam, deckH, z]], [0.18, 0.16, 0.14], [darkOak, midOak, mossOak], [[0, 0], [0, 0], [0, 0]], 5, true);
    }
  }
  // Longitudinal hull strakes & elevated stern castle
  for (let s = 1; s <= 3; s++) {
    const hFrac = s / 3;
    const yL = hFrac * 2.8;
    const wMid = 3.3 * sin(hFrac * 1.2 + 0.3);
    m.tube([[0, yL + 1.0, -8.5], [-wMid, yL, 0], [0, yL + 0.8, 9.0]], [0.16, 0.22, 0.14], [midOak, mossOak, midOak], [[0, 0], [0, 0], [0, 0]], 5, true);
    if (s !== 2) {
      m.tube([[0, yL + 1.0, -8.5], [wMid, yL, 0], [0, yL + 0.8, 9.0]], [0.16, 0.22, 0.14], [midOak, mossOak, midOak], [[0, 0], [0, 0], [0, 0]], 5, true);
    }
  }
  // Stern castle & transom cabin
  m.ellipsoid(0, 4.2, -7.2, 2.4, 1.3, 2.2, midOak, 0, 0, 5, 6);
  // Foremast with cross-yard, broken mainmast, and bowsprit
  m.tube([[0, 1.2, 3.8], [0.2, 6.5, 3.9], [0.35, 11.2, 4.0]], [0.26, 0.20, 0.11], [darkOak, midOak, mossOak], [[0, 0], [0, 0.2], [0, 0.5]], 6, true);
  m.tube([[-3.2, 8.8, 3.9], [0.25, 9.0, 3.9], [3.4, 8.6, 3.9]], [0.10, 0.15, 0.10], [midOak, midOak, midOak], [[0, 0.3], [0, 0.3], [0, 0.3]], 5, true);
  m.tube([[0, 0.8, -1.2], [-0.3, 4.8, -1.0], [-0.8, 7.2, -0.6]], [0.30, 0.24, 0.14], [darkOak, midOak, darkOak], [[0, 0], [0, 0.1], [0, 0.2]], 6, true);
  m.tube([[0, 2.2, 8.2], [0, 3.8, 11.5], [0, 4.8, 13.8]], [0.20, 0.14, 0.08], [midOak, midOak, mossOak], [[0, 0], [0, 0.2], [0, 0.4]], 5, true);
  return m.build();
}

// Abyssal Garden Multi-Species Segmented Kelp (Macrocystis), Eelgrass, Sargassum & Bioluminescent Coral
function buildKelpCoralReefMesh() {
  const m = new MeshBuilder();
  const holdfastCol = [0.16, 0.24, 0.14];
  const stipeCol = [0.14, 0.42, 0.18];
  const bladderCol = [0.42, 0.64, 0.22];
  const bladeBase = [0.12, 0.46, 0.20];
  const bladeTip = [0.28, 0.68, 0.26];

  // 1. Giant Kelp (Macrocystis pyrifera): Holdfast anchors + segmented stipes + pneumatocyst bladders + corrugated blades
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.25;
    const kx = cos(a) * 0.46, kz = sin(a) * 0.46;
    const kh = 3.8 + (k % 2) * 1.45;
    // Holdfast haptera roots anchoring stipe base
    m.ellipsoid(kx, 0.04, kz, 0.20, 0.10, 0.20, holdfastCol, 0, 0, 3, 5);
    // Segmented stipe column (uv.x = 1.0, uv.y = 0..1 height fraction for traveling-wave current shader)
    const stipePath = [
      [kx, 0.0, kz],
      [kx + sin(k) * 0.10, kh * 0.32, kz + cos(k) * 0.10],
      [kx - cos(k) * 0.14, kh * 0.66, kz + sin(k) * 0.14],
      [kx + sin(k) * 0.18, kh, kz - cos(k) * 0.12]
    ];
    m.tube(stipePath, [0.036, 0.028, 0.022, 0.014], [holdfastCol, stipeCol, stipeCol, bladeTip], [[1, 0.0], [1, 0.32], [1, 0.66], [1, 1.0]], 5, true);

    // Gas-bladder pneumatocysts (uv.x = 1.5) & Lateral corrugated kelp blades (uv.x = 1.2)
    for (let n = 1; n <= 5; n++) {
      const f = n / 5.4;
      const ny = kh * f;
      const nx = kx + sin(k + f * 2.2) * 0.12;
      const nz = kz + cos(k + f * 2.2) * 0.12;
      const bAng = a + n * 1.35;
      const bLen = 0.68 + (1 - f * 0.35) * 0.45;
      // Pneumatocyst gas bladder at blade junction
      m.ellipsoid(nx + cos(bAng) * 0.045, ny, nz + sin(bAng) * 0.045, 0.038, 0.052, 0.038, bladderCol, 1.5, f, 3, 4);
      // Corrugated lateral blade trailing in current
      const tipX = nx + cos(bAng) * bLen;
      const tipY = ny + 0.18 + (n % 2) * 0.12;
      const tipZ = nz + sin(bAng) * bLen;
      m.ribbon([nx, ny, nz], [tipX, tipY, tipZ], 0.15, 0.04, 0.18, bladeBase, bladeTip, 1.2, f, min(1.0, f + 0.18), 4);
    }
  }

  // 2. Eelgrass (Zostera) & Sargassum meadow ribbons around reef perimeter
  const eel0 = [0.09, 0.36, 0.18], eel1 = [0.22, 0.58, 0.28];
  for (let e = 0; e < 7; e++) {
    const a = (e / 7) * TAU + 0.6;
    const r = 0.72 + (e % 2) * 0.25;
    const ex = cos(a) * r, ez = sin(a) * r;
    const eh = 1.35 + (e % 3) * 0.48;
    m.ribbon([ex, -0.05, ez], [ex + cos(a) * 0.26, eh, ez + sin(a) * 0.26], 0.08, 0.025, 0.16, eel0, eel1, 1.0, 0.0, 0.75, 4);
  }

  // 3. Bioluminescent Staghorn Coral, Sea Anemones & Hydrothermal Tube Worms (uv.x = 2.0)
  const coralCols = [[0.94, 0.22, 0.58], [0.18, 0.88, 0.95], [0.96, 0.54, 0.14]];
  for (let c = 0; c < 6; c++) {
    const a = (c / 6) * TAU + 0.4;
    const cx = cos(a) * 0.85, cz = sin(a) * 0.85;
    const col = coralCols[c % 3];
    m.tube([[cx * 0.38, 0, cz * 0.38], [cx * 0.75, 0.56, cz * 0.75], [cx, 1.18, cz]], [0.11, 0.085, 0.048], [col, col, [0.98, 0.90, 0.96]], [[2, 0.1], [2, 0.35], [2, 0.7]], 5, true);
  }
  // Grooved Brain Coral Dome at center
  m.ellipsoid(0, 0.28, 0, 0.64, 0.40, 0.62, [0.72, 0.24, 0.52], 2, 0.15, 5, 7);
  return m.build();
}

// Savanna Umbrella Acacia, Misty Bamboo & Heritage Plantation Banana/Cacao Tree
function buildAcaciaBambooMesh() {
  const m = new MeshBuilder();
  const bark0 = [0.28, 0.22, 0.15], bark1 = [0.36, 0.28, 0.19];
  // Main spreading trunk + flat umbrella savanna crown + bamboo culms
  m.tube([[0, -0.3, 0], [0.2, 2.4, 0.1], [-0.3, 5.2, -0.2], [0.4, 7.8, 0.2]], [0.42, 0.30, 0.22, 0.12], [bark0, bark0, bark1, bark1], [[0, 0], [0, 0.2], [0, 0.5], [0, 0.8]], 6, true);
  const crownCol0 = [0.26, 0.42, 0.14], crownCol1 = [0.38, 0.52, 0.18];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * TAU;
    const bx = cos(a) * 2.8, bz = sin(a) * 2.8;
    const by = 7.2 + (b % 2) * 0.55;
    m.tube([[0, 5.0, 0], [bx * 0.6, by - 0.5, bz * 0.6], [bx, by, bz]], [0.16, 0.10, 0.05], [bark1, bark1, bark1], [[0, 0.4], [0, 0.65], [0, 0.85]], 5, true);
    m.ellipsoid(bx, by + 0.22, bz, 2.35, 0.42, 2.15, b % 2 ? crownCol1 : crownCol0, 1, 0.88, 4, 7);
  }
  m.ellipsoid(0, 8.1, 0, 2.8, 0.45, 2.6, crownCol1, 1, 0.92, 4, 7);
  return m.build();
}

// ============================================================================
// Continuous Point-to-Point Creature Anatomy Generators (smoothLimb + smin)
// Expressive Facial Encoding for W_ANIMAL:
//   uv.x = 0.12 -> Wet Cornea / Iris Eye (high specular catchlight)
//   uv.x = 0.18 -> Articulated Lower Jaw / Mandible / Beak / Vocal Sac
//   uv.x = 0.25 -> Mobile Ear Pinnae (independent twitch, swivel & pinning)
// ============================================================================
function addExpressiveFace(m, headY, headZ, headRx, headRy, headRz, jawCol, earCol, eyeCol = [0.06, 0.05, 0.04], hasEars = true) {
  const eyeR = clamp(min(headRx, headRy) * 0.24, 0.014, 0.055);
  for (const s of [-1, 1]) {
    // Wet specular cornea & iris (uv.x = 0.12)
    m.ellipsoid(s * headRx * 0.66, headY + headRy * 0.18, headZ + headRz * 0.36, eyeR, eyeR, eyeR * 1.1, eyeCol, 0.12, 0.96, 4, 5);
    // Expressive supraorbital brow ridge
    m.ellipsoid(s * headRx * 0.62, headY + headRy * 0.42, headZ + headRz * 0.38, eyeR * 1.45, eyeR * 0.55, eyeR * 1.35, earCol, 0.5, 0.96, 3, 4);
    if (hasEars) {
      // Mobile ear pinnae (uv.x = 0.25)
      m.ellipsoid(s * headRx * 0.78, headY + headRy * 0.85, headZ - headRz * 0.18, headRx * 0.28, headRy * 0.46, headRz * 0.20, earCol, 0.25, 0.92, 4, 5);
    }
  }
  // Articulated lower jaw / mandible (uv.x = 0.18)
  m.ellipsoid(0, headY - headRy * 0.48, headZ + headRz * 0.46, headRx * 0.54, headRy * 0.30, headRz * 0.68, jawCol, 0.18, 0.98, 4, 6);
}

function buildBigCatMesh(coat, belly, hasMane = false) {
  const m = new MeshBuilder();
  const dark = [coat[0] * 0.35, coat[1] * 0.35, coat[2] * 0.35];
  // Continuous Catmull-Rom spine from tail tip to nose bridge
  m.smoothLimb(
    [[0, 0.40, -1.12], [0, 0.56, -0.78], [0, 0.68, -0.45], [0, 0.66, 0.0], [0, 0.70, 0.42], [0, 0.82, 0.68], [0, 0.80, 0.90], [0, 0.74, 1.06]],
    [[0.035, 0.035], [0.05, 0.05], [0.18, 0.21], [0.20, 0.23], [0.22, 0.25], [0.16, 0.18], [0.14, 0.15], [0.08, 0.09]],
    [dark, coat, coat, coat, coat, coat, coat, belly],
    [[0.8, 0], [0.7, 0.1], [0.5, 0.25], [0.5, 0.5], [0.5, 0.7], [0.5, 0.85], [0.5, 0.95], [0.5, 1.0]],
    8, 0.09
  );
  if (hasMane) {
    // Sculpted Lion Mane Collar around neck & shoulders
    const maneCol = [coat[0] * 0.48, coat[1] * 0.32, coat[2] * 0.16];
    m.ellipsoid(0, 0.76, 0.56, 0.32, 0.34, 0.30, maneCol, 0.5, 0.8, 6, 8);
  }
  addExpressiveFace(m, 0.80, 0.88, 0.14, 0.15, 0.18, belly, dark, [0.85, 0.62, 0.12], true);
  for (const s of [-1, 1]) {
    // Upper front leg (uv.x = 0.36) & lower front leg/paw (uv.x = 0.42)
    m.smoothLimb(
      [[s * 0.14, 0.66, 0.36], [s * 0.16, 0.38, 0.38]],
      [[0.092, 0.11], [0.068, 0.078]],
      [coat, coat], [[0.36, 0.05], [0.36, 0.48]], 6, 0.10
    );
    m.smoothLimb(
      [[s * 0.16, 0.38, 0.38], [s * 0.15, 0.14, 0.35], [s * 0.15, 0.01, 0.41]],
      [[0.064, 0.072], [0.048, 0.052], [0.062, 0.075]],
      [coat, belly, belly], [[0.42, 0.50], [0.42, 0.80], [0.42, 1.0]], 6, 0.06
    );
    // Upper hind leg (uv.x = 0.38) & lower hind leg/paw (uv.x = 0.44)
    m.smoothLimb(
      [[s * 0.15, 0.66, -0.40], [s * 0.16, 0.38, -0.46]],
      [[0.105, 0.125], [0.070, 0.082]],
      [coat, coat], [[0.38, 0.05], [0.38, 0.48]], 6, 0.11
    );
    m.smoothLimb(
      [[s * 0.16, 0.38, -0.46], [s * 0.15, 0.15, -0.42], [s * 0.15, 0.01, -0.36]],
      [[0.066, 0.076], [0.048, 0.052], [0.062, 0.075]],
      [coat, belly, belly], [[0.44, 0.50], [0.44, 0.80], [0.44, 1.0]], 6, 0.06
    );
  }
  return m.build();
}

// Continuous Silverback Mountain Gorilla & Chimpanzee Primate Anatomy
function buildApeMesh(coat, saddleCol, isGorilla = true) {
  const m = new MeshBuilder();
  const faceCol = [0.10, 0.09, 0.09];
  const scaleH = isGorilla ? 1.0 : 0.72;
  // Continuous inclined spine from pelvis to broad chest and sagittal-crest head
  m.smoothLimb(
    [[0, 0.42 * scaleH, -0.38], [0, 0.62 * scaleH, -0.10], [0, 0.84 * scaleH, 0.22], [0, 1.04 * scaleH, 0.36], [0, 1.02 * scaleH, 0.50]],
    [[0.22 * scaleH, 0.20 * scaleH], [0.28 * scaleH, 0.25 * scaleH], [0.34 * scaleH, 0.29 * scaleH], [0.19 * scaleH, 0.21 * scaleH], [0.12 * scaleH, 0.13 * scaleH]],
    [coat, saddleCol, coat, coat, faceCol],
    [[0.5, 0.2], [0.5, 0.45], [0.5, 0.75], [0.5, 0.92], [0.5, 1.0]],
    8, 0.12
  );
  addExpressiveFace(m, 1.02 * scaleH, 0.46, 0.14 * scaleH, 0.14 * scaleH, 0.14 * scaleH, faceCol, faceCol, [0.18, 0.10, 0.05], !isGorilla);
  for (const s of [-1, 1]) {
    // Massive knuckle-walking arms with deltoid & forearm musculature
    m.smoothLimb(
      [[s * 0.28 * scaleH, 0.84 * scaleH, 0.24], [s * 0.32 * scaleH, 0.50 * scaleH, 0.32], [s * 0.26 * scaleH, 0.22 * scaleH, 0.36], [s * 0.24 * scaleH, 0.03, 0.38]],
      [[0.13 * scaleH, 0.13 * scaleH], [0.10 * scaleH, 0.11 * scaleH], [0.085 * scaleH, 0.09 * scaleH], [0.09 * scaleH, 0.10 * scaleH]],
      [coat, coat, coat, faceCol],
      [[0.4, 0.7], [0.4, 0.8], [0.4, 0.9], [0.4, 1.0]],
      6, 0.15
    );
    // Muscular hind legs
    m.smoothLimb(
      [[s * 0.18 * scaleH, 0.46 * scaleH, -0.32], [s * 0.20 * scaleH, 0.24 * scaleH, -0.34], [s * 0.18 * scaleH, 0.03, -0.28]],
      [[0.12 * scaleH, 0.13 * scaleH], [0.085 * scaleH, 0.09 * scaleH], [0.08 * scaleH, 0.11 * scaleH]],
      [coat, coat, faceCol],
      [[0.4, 0.3], [0.4, 0.15], [0.4, 0.0]],
      6, 0.12
    );
  }
  return m.build();
}

// Continuous African Bush Elephant with Articulated Trunk, Tusks & Pinnae Ears
function buildElephantMesh() {
  const m = new MeshBuilder();
  const hide = [0.38, 0.36, 0.35], darkHide = [0.28, 0.26, 0.25], ivory = [0.95, 0.92, 0.82];
  // Continuous torso -> domed skull -> sweeping prehensile trunk
  m.smoothLimb(
    [[0, 0.85, -1.25], [0, 1.45, -0.85], [0, 1.62, -0.15], [0, 1.68, 0.52], [0, 1.62, 0.98], [0, 1.22, 1.32], [0, 0.68, 1.45], [0, 0.28, 1.56]],
    [[0.04, 0.04], [0.48, 0.52], [0.58, 0.64], [0.55, 0.62], [0.38, 0.42], [0.16, 0.16], [0.11, 0.11], [0.07, 0.07]],
    [darkHide, hide, hide, hide, hide, hide, darkHide, darkHide],
    [[0.8, 0], [0.5, 0.2], [0.5, 0.5], [0.5, 0.75], [0.5, 0.88], [0.5, 0.94], [0.5, 0.98], [0.5, 1.0]],
    8, 0.08
  );
  addExpressiveFace(m, 1.56, 0.96, 0.34, 0.32, 0.28, darkHide, darkHide, [0.12, 0.08, 0.05], false);
  for (const s of [-1, 1]) {
    // Large fan-shaped African elephant ears tagged with uv.x = 0.25 for live ear-fanning!
    m.ellipsoid(s * 0.52, 1.56, 0.72, 0.36, 0.48, 0.08, darkHide, 0.25, 0.88, 5, 6);
    // Curved ivory tusks
    m.smoothLimb(
      [[s * 0.18, 1.26, 1.05], [s * 0.24, 1.02, 1.42], [s * 0.20, 1.16, 1.74]],
      [0.065, 0.048, 0.015],
      [ivory, ivory, ivory],
      [[0.5, 0.9], [0.5, 0.95], [0.5, 1.0]],
      5, 0.02
    );
    // Columnar gravigrade fore and hind legs
    m.smoothLimb(
      [[s * 0.32, 1.25, 0.48], [s * 0.32, 0.62, 0.48], [s * 0.32, 0.02, 0.50]],
      [0.21, 0.17, 0.19],
      [hide, hide, darkHide],
      [[0.4, 0.7], [0.4, 0.85], [0.4, 1.0]],
      6, 0.05
    );
    m.smoothLimb(
      [[s * 0.30, 1.22, -0.68], [s * 0.30, 0.60, -0.68], [s * 0.30, 0.02, -0.66]],
      [0.22, 0.17, 0.19],
      [hide, hide, darkHide],
      [[0.4, 0.3], [0.4, 0.15], [0.4, 0.0]],
      6, 0.05
    );
  }
  return m.build();
}

// Continuous Reticulated Giraffe & Plains Zebra Meshes
function buildGiraffeMesh() {
  const m = new MeshBuilder();
  const coat = [0.76, 0.52, 0.24], cream = [0.92, 0.86, 0.70], dark = [0.22, 0.14, 0.08];
  m.smoothLimb(
    [[0, 0.95, -0.82], [0, 1.38, -0.52], [0, 1.62, 0.18], [0, 2.35, 0.55], [0, 3.08, 0.84], [0, 3.16, 1.08]],
    [[0.03, 0.03], [0.24, 0.28], [0.32, 0.38], [0.14, 0.16], [0.11, 0.12], [0.07, 0.08]],
    [dark, coat, coat, coat, coat, cream],
    [[0.8, 0], [0.5, 0.25], [0.5, 0.55], [0.5, 0.78], [0.5, 0.92], [0.5, 1.0]],
    7, 0.06
  );
  addExpressiveFace(m, 3.12, 0.92, 0.10, 0.11, 0.16, cream, coat, [0.08, 0.06, 0.04], true);
  for (const s of [-1, 1]) {
    m.tube([[s * 0.05, 3.16, 0.86], [s * 0.05, 3.32, 0.86]], [0.02, 0.025], [dark, dark], [[0.5, 1], [0.5, 1]], 4, true);
    m.smoothLimb([[s * 0.18, 1.42, 0.24], [s * 0.18, 0.72, 0.25], [s * 0.18, 0.02, 0.27]], [0.10, 0.06, 0.065], [coat, cream, dark], [[0.4, 0.6], [0.4, 0.8], [0.4, 1.0]], 5, 0.06);
    m.smoothLimb([[s * 0.18, 1.28, -0.48], [s * 0.18, 0.66, -0.50], [s * 0.18, 0.02, -0.46]], [0.11, 0.06, 0.065], [coat, cream, dark], [[0.4, 0.3], [0.4, 0.15], [0.4, 0.0]], 5, 0.06);
  }
  return m.build();
}

function buildZebraMesh() {
  const m = new MeshBuilder();
  const base = [0.88, 0.88, 0.86], dark = [0.08, 0.08, 0.10];
  m.smoothLimb(
    [[0, 0.68, -0.82], [0, 0.88, -0.46], [0, 0.86, 0.05], [0, 0.92, 0.42], [0, 1.24, 0.68], [0, 1.18, 0.94]],
    [[0.035, 0.035], [0.19, 0.22], [0.22, 0.25], [0.21, 0.24], [0.12, 0.15], [0.072, 0.085]],
    [dark, base, base, base, base, dark],
    [[0.8, 0], [0.5, 0.25], [0.5, 0.5], [0.5, 0.72], [0.5, 0.90], [0.5, 1.0]],
    7, 0.06
  );
  addExpressiveFace(m, 1.22, 0.78, 0.11, 0.13, 0.16, dark, dark, [0.06, 0.05, 0.04], true);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.14, 0.82, 0.36], [s * 0.14, 0.44, 0.37]], [0.082, 0.056], [base, base], [[0.36, 0.05], [0.36, 0.48]], 5, 0.06);
    m.smoothLimb([[s * 0.14, 0.44, 0.37], [s * 0.14, 0.01, 0.39]], [0.052, 0.052], [base, dark], [[0.42, 0.50], [0.42, 1.0]], 5, 0.04);
    m.smoothLimb([[s * 0.14, 0.84, -0.44], [s * 0.14, 0.44, -0.48]], [0.092, 0.056], [base, base], [[0.38, 0.05], [0.38, 0.48]], 5, 0.06);
    m.smoothLimb([[s * 0.14, 0.44, -0.48], [s * 0.14, 0.01, -0.42]], [0.052, 0.052], [base, dark], [[0.44, 0.50], [0.44, 1.0]], 5, 0.04);
  }
  return m.build();
}

// ============================================================================
// Distinct Species-Specific Marine Megafauna Anatomy (Universal +Y Up, +Z Fwd)
// ============================================================================

// 1. Humpback Whale (Megaptera novaeangliae): ~14m adult length
// Broad rostrum with tubercles, ventral throat pleats, blowhole, huge scalloped
// pectoral flippers, dorsal hump, tapered peduncle & broad notched tail flukes.
function buildHumpbackWhaleMesh() {
  const m = new MeshBuilder();
  const dorsal = [0.11, 0.16, 0.23];
  const flank  = [0.18, 0.24, 0.31];
  const pleat  = [0.68, 0.74, 0.80];
  const white  = [0.88, 0.91, 0.94];

  // Primary 14m body profile from peduncle (-6.6) to broad flattened rostrum (+6.8)
  m.smoothLimb(
    [
      [0,  0.04, -6.55],
      [0,  0.06, -5.10],
      [0,  0.10, -3.20],
      [0,  0.14, -1.10],
      [0,  0.16,  1.40],
      [0,  0.10,  3.60],
      [0,  0.02,  5.50],
      [0, -0.02,  6.85]
    ],
    [
      [0.16, 0.22],
      [0.42, 0.54],
      [0.92, 1.02],
      [1.46, 1.38],
      [1.72, 1.54],
      [1.56, 1.24],
      [1.22, 0.68],
      [0.52, 0.24]
    ],
    [dorsal, dorsal, dorsal, flank, flank, dorsal, dorsal, flank],
    [[0.92, 0.0], [0.80, 0.14], [0.65, 0.30], [0.55, 0.48], [0.50, 0.66], [0.50, 0.82], [0.50, 0.94], [0.50, 1.0]],
    10, 0.05
  );

  // Ventral throat pleats (expanded lower jaw & longitudinal pleated grooves)
  for (let p = -3; p <= 3; p++) {
    const px = p * 0.22;
    const drop = -1.28 + abs(p) * 0.14;
    m.smoothLimb(
      [[px * 0.7, drop * 0.72, 0.4], [px, drop, 2.8], [px * 0.85, drop * 0.68, 5.1], [px * 0.42, -0.18, 6.65]],
      [0.10, 0.13, 0.11, 0.07],
      [pleat, white, pleat, white],
      [[0.18, 0.70], [0.18, 0.82], [0.18, 0.92], [0.18, 0.99]],
      5, 0.02
    );
  }

  // Characteristic Humpback rostrum tubercles (sensory knobs along upper snout)
  for (let t = 0; t < 5; t++) {
    const tz = 4.3 + t * 0.54;
    const tw = lerp(0.95, 0.36, t / 4);
    m.ellipsoid(0, 0.72 - t * 0.09, tz, 0.14, 0.09, 0.14, flank, 0.5, 0.92, 3, 4);
    for (const s of [-1, 1]) {
      m.ellipsoid(s * tw, 0.42 - t * 0.07, tz, 0.13, 0.09, 0.13, flank, 0.5, 0.92, 3, 4);
    }
  }

  // Paired dorsal blowholes & small laterally-placed wet eyes
  for (const s of [-1, 1]) {
    m.ellipsoid(s * 0.14, 1.24, 3.85, 0.08, 0.04, 0.18, [0.05, 0.07, 0.10], 0.5, 0.86, 3, 4);
    m.ellipsoid(s * 1.48, -0.04, 3.65, 0.09, 0.08, 0.10, [0.04, 0.05, 0.07], 0.12, 0.85, 4, 5);
  }

  // Characteristic low stepped dorsal hump (distinct from Orca's tall sword fin!)
  m.smoothLimb(
    [[0, 1.32, -1.05], [0, 1.66, -1.65], [0, 1.50, -2.25]],
    [[0.22, 0.34], [0.14, 0.24], [0.06, 0.14]],
    [dorsal, dorsal, flank],
    [[0.55, 0.45], [0.55, 0.42], [0.55, 0.38]],
    6, 0.03
  );

  // Enormous scalloped Humpback pectoral flippers (~4.6m span each, pale undersides)
  for (const s of [-1, 1]) {
    m.ribbon([s * 1.35, -0.45, 2.35], [s * 3.55, -0.82, 1.30], 0.72, 0.52, -0.08, dorsal, white, 0.62, 0.70, 0.78, 5);
    m.ribbon([s * 3.55, -0.82, 1.30], [s * 5.45, -0.96, 0.32], 0.52, 0.14, -0.06, white, white, 0.62, 0.76, 0.84, 5);
    // Scalloped leading-edge knobs on flipper
    for (let k = 0; k < 4; k++) {
      const f = (k + 0.5) / 4;
      m.ellipsoid(s * lerp(2.0, 4.9, f), lerp(-0.56, -0.92, f), lerp(2.25, 0.62, f), 0.12, 0.08, 0.14, white, 0.62, 0.75, 3, 4);
    }
    // Broad horizontal notched tail flukes (4.4m span, central V-notch at x=0)
    m.ribbon([s * 0.18, 0.04, -6.25], [s * 2.25, 0.06, -7.25], 0.68, 0.12, 0.05, dorsal, white, 0.94, 0.05, 0.0, 5);
  }
  return m.build();
}

// 2. Orca / Killer Whale (Orcinus orca): ~7.6m adult length (completely separate mesh!)
// Robust black-and-white countershaded torpedo, rounded melon, oval white eye patch,
// grey dorsal saddle, tall 1.5m curved dorsal sword fin, rounded paddles & flukes.
function buildOrcaMesh() {
  const m = new MeshBuilder();
  const jet    = [0.04, 0.05, 0.07];
  const saddle = [0.36, 0.40, 0.45];
  const white  = [0.95, 0.96, 0.98];

  m.smoothLimb(
    [
      [0,  0.02, -3.65],
      [0,  0.04, -2.55],
      [0,  0.08, -1.10],
      [0,  0.12,  0.45],
      [0,  0.08,  1.85],
      [0,  0.02,  2.95],
      [0, -0.04,  3.75]
    ],
    [
      [0.10, 0.14],
      [0.28, 0.38],
      [0.58, 0.72],
      [0.78, 0.88],
      [0.72, 0.76],
      [0.48, 0.50],
      [0.18, 0.16]
    ],
    [jet, jet, jet, jet, jet, jet, jet],
    [[0.92, 0.0], [0.78, 0.16], [0.62, 0.36], [0.50, 0.56], [0.50, 0.76], [0.50, 0.92], [0.50, 1.0]],
    9, 0.05
  );

  // Crisp white chin, throat, belly & sweeping rear flank patches
  m.smoothLimb(
    [[0, -0.45, -1.65], [0, -0.72, -0.20], [0, -0.68, 1.45], [0, -0.34, 2.95], [0, -0.10, 3.60]],
    [[0.22, 0.16], [0.52, 0.24], [0.56, 0.26], [0.36, 0.20], [0.14, 0.10]],
    [white, white, white, white, white],
    [[0.62, 0.26], [0.50, 0.50], [0.50, 0.74], [0.18, 0.90], [0.18, 0.98]],
    7, 0.03
  );
  // Iconic grey saddle patch behind dorsal fin
  m.ellipsoid(0, 0.62, -0.72, 0.58, 0.26, 0.62, saddle, 0.52, 0.42, 4, 6);

  // Tall iconic Orca sword dorsal fin (1.45m high!)
  m.smoothLimb(
    [[0, 0.78, 0.25], [0, 1.48, -0.05], [0, 2.15, -0.45]],
    [[0.12, 0.42], [0.075, 0.28], [0.025, 0.08]],
    [jet, jet, jet],
    [[0.52, 0.52], [0.52, 0.50], [0.52, 0.48]],
    6, 0.02
  );

  for (const s of [-1, 1]) {
    // Iconic oval white post-ocular eye patch + dark wet eye + white flank flare
    m.ellipsoid(s * 0.56, 0.24, 2.35, 0.10, 0.14, 0.34, white, 0.5, 0.84, 4, 5);
    m.ellipsoid(s * 0.50, 0.08, 2.82, 0.055, 0.055, 0.06, [0.02, 0.02, 0.03], 0.12, 0.90, 3, 4);
    m.ellipsoid(s * 0.46, -0.18, -1.35, 0.18, 0.18, 0.58, white, 0.62, 0.30, 4, 5);
    // Broad rounded paddle pectoral flippers
    m.ribbon([s * 0.64, -0.34, 1.45], [s * 1.65, -0.56, 0.85], 0.46, 0.28, -0.04, jet, jet, 0.60, 0.70, 0.76, 4);
    // Broad notched horizontal tail flukes
    m.ribbon([s * 0.10, 0.02, -3.45], [s * 1.38, 0.04, -4.15], 0.42, 0.08, 0.03, jet, white, 0.94, 0.05, 0.0, 5);
  }
  return m.build();
}

// 3. Great White Shark (Carcharodon carcharias): ~4.8m adult length
// Pointed conical snout, countershaded fusiform body, underslung mouth with white
// teeth, 5 visible gill slits, 1st & 2nd dorsal fins, pectorals, pelvics, anal fin,
// and asymmetric heterocercal crescent caudal fin.
function buildSharkMesh() {
  const m = new MeshBuilder();
  const slate  = [0.26, 0.31, 0.37];
  const dark   = [0.15, 0.18, 0.22];
  const belly  = [0.90, 0.92, 0.94];
  const gillC  = [0.06, 0.07, 0.09];
  const teeth  = [0.96, 0.95, 0.90];

  // Streamlined fusiform shark body (-2.35 caudal peduncle to +2.45 pointed snout)
  m.smoothLimb(
    [
      [0,  0.00, -2.25],
      [0,  0.01, -1.45],
      [0,  0.03, -0.50],
      [0,  0.05,  0.50],
      [0,  0.04,  1.35],
      [0,  0.06,  1.98],
      [0,  0.05,  2.48]
    ],
    [
      [0.065, 0.085],
      [0.19,  0.24],
      [0.42,  0.48],
      [0.52,  0.55],
      [0.42,  0.40],
      [0.24,  0.20],
      [0.055, 0.045]
    ],
    [slate, slate, slate, slate, slate, slate, dark],
    [[0.94, 0.0], [0.80, 0.18], [0.64, 0.42], [0.52, 0.62], [0.50, 0.80], [0.50, 0.92], [0.50, 1.0]],
    10, 0.04
  );

  // Crisp countershaded white ventral belly
  m.smoothLimb(
    [[0, -0.18, -1.25], [0, -0.36, -0.25], [0, -0.40, 0.65], [0, -0.28, 1.52], [0, -0.10, 2.08]],
    [[0.16, 0.10], [0.36, 0.18], [0.42, 0.20], [0.30, 0.14], [0.14, 0.07]],
    [belly, belly, belly, belly, belly],
    [[0.74, 0.22], [0.58, 0.46], [0.52, 0.66], [0.50, 0.84], [0.50, 0.95]],
    7, 0.02
  );

  // Underslung crescent jaw (uv.x = 0.18) & serrated white teeth row
  m.ellipsoid(0, -0.15, 1.82, 0.22, 0.09, 0.24, belly, 0.18, 0.92, 4, 5);
  for (let t = -3; t <= 3; t++) {
    const a = t * 0.28;
    m.ellipsoid(sin(a) * 0.18, -0.11, 1.86 + cos(a) * 0.14, 0.022, 0.032, 0.018, teeth, 0.18, 0.93, 3, 3);
  }

  for (const s of [-1, 1]) {
    // Jet-black shark eye
    m.ellipsoid(s * 0.25, 0.08, 1.88, 0.042, 0.042, 0.045, [0.02, 0.02, 0.03], 0.12, 0.92, 3, 4);
    // FIVE distinct vertical gill slits behind head
    for (let g = 0; g < 5; g++) {
      const gz = 1.24 - g * 0.105;
      m.ribbon([s * 0.44, 0.16, gz], [s * 0.44, -0.18, gz - 0.02], 0.018, 0.015, 0.01, gillC, gillC, 0.5, 0.74, 0.74, 2);
    }
    // Large swept triangular pectoral fins
    m.ribbon([s * 0.42, -0.22, 0.82], [s * 1.48, -0.44, 0.22], 0.38, 0.06, -0.04, slate, belly, 0.56, 0.66, 0.74, 5);
    // Paired pelvic fins
    m.ribbon([s * 0.24, -0.34, -0.68], [s * 0.64, -0.46, -0.96], 0.18, 0.04, -0.02, slate, belly, 0.72, 0.34, 0.40, 3);
  }

  // Large iconic First Dorsal Fin + small Second Dorsal Fin + Anal Fin
  m.smoothLimb(
    [[0, 0.48, 0.34], [0, 0.96, 0.12], [0, 1.28, -0.12]],
    [[0.08, 0.34], [0.048, 0.22], [0.018, 0.06]],
    [slate, slate, dark], [[0.54, 0.56], [0.54, 0.54], [0.54, 0.52]], 5, 0.02
  );
  m.smoothLimb(
    [[0, 0.22, -1.32], [0, 0.40, -1.46]],
    [[0.04, 0.12], [0.015, 0.04]],
    [slate, dark], [[0.82, 0.18], [0.82, 0.16]], 4, 0.01
  );
  m.smoothLimb(
    [[0, -0.18, -1.38], [0, -0.34, -1.52]],
    [[0.035, 0.10], [0.014, 0.035]],
    [belly, slate], [[0.82, 0.16], [0.82, 0.14]], 4, 0.01
  );

  // Asymmetric Heterocercal Crescent Caudal Tail Fin (upper lobe longer than lower lobe)
  m.smoothLimb(
    [[0, 0.02, -2.18], [0, 0.46, -2.52], [0, 0.92, -2.86]],
    [[0.055, 0.20], [0.04, 0.18], [0.015, 0.05]],
    [slate, slate, dark], [[0.96, 0.04], [0.98, 0.02], [1.0, 0.0]], 5, 0.01
  );
  m.smoothLimb(
    [[0, -0.02, -2.18], [0, -0.38, -2.48], [0, -0.72, -2.74]],
    [[0.052, 0.18], [0.036, 0.16], [0.014, 0.045]],
    [slate, belly, belly], [[0.96, 0.04], [0.98, 0.02], [1.0, 0.0]], 5, 0.01
  );
  return m.build();
}

// 4. Oceanic Manta Ray (Mobula birostris): ~4.6m wingspan
// Broad flattened diamond disc, white ventral gill-slit underside, wide tapered
// pectoral wings, cephalic horn fins & slender whip tail.
function buildMantaMesh() {
  const m = new MeshBuilder();
  const dark   = [0.07, 0.10, 0.15];
  const shldr  = [0.22, 0.28, 0.36];
  const white  = [0.86, 0.90, 0.93];
  const gillC  = [0.28, 0.34, 0.40];

  // Central flattened diamond disc body
  m.smoothLimb(
    [[0, 0.0, -1.15], [0, 0.02, -0.40], [0, 0.04, 0.25], [0, 0.02, 0.85], [0, 0.0, 1.12]],
    [[0.16, 0.055], [0.46, 0.11], [0.68, 0.14], [0.54, 0.10], [0.36, 0.05]],
    [dark, dark, shldr, dark, dark],
    [[0.70, 0.25], [0.58, 0.45], [0.50, 0.65], [0.50, 0.85], [0.50, 0.96]],
    8, 0.02
  );
  // Pale ventral underside plate + 5 paired gill slits
  m.ellipsoid(0, -0.06, 0.20, 0.56, 0.06, 0.72, white, 0.50, 0.60, 4, 6);
  // Long slender whip tail + tiny dorsal finlet at tail base
  m.smoothLimb(
    [[0, 0.0, -1.05], [0, -0.01, -1.85], [0, -0.02, -2.75]],
    [0.036, 0.018, 0.008], [dark, dark, dark], [[0.92, 0.12], [0.96, 0.05], [1.0, 0.0]], 5, 0.0
  );
  m.smoothLimb([[0, 0.06, -0.92], [0, 0.18, -1.08]], [0.025, 0.01], [dark, shldr], [[0.80, 0.22], [0.80, 0.20]], 4, 0.0);

  for (const s of [-1, 1]) {
    // Broad sweeping diamond pectoral wings (span to x = +-2.30m)
    m.ribbon([s * 0.36, 0.01, 0.32], [s * 1.42, 0.02, 0.08], 0.72, 0.44, 0.04, dark, shldr, 0.80, 0.55, 0.75, 5);
    m.ribbon([s * 1.42, 0.02, 0.08], [s * 2.32, 0.00, -0.32], 0.44, 0.05, 0.03, shldr, white, 0.80, 0.75, 0.95, 5);
    // Forward-projecting curved cephalic horn fins flanking wide mouth
    m.ribbon([s * 0.28, -0.01, 0.96], [s * 0.34, -0.05, 1.56], 0.12, 0.04, 0.02, dark, white, 0.50, 0.94, 1.0, 4);
    // Lateral eye on outer cephalic base
    m.ellipsoid(s * 0.42, 0.03, 0.98, 0.035, 0.032, 0.04, [0.02, 0.03, 0.04], 0.12, 0.92, 3, 4);
    // 5 ventral gill slits
    for (let g = 0; g < 5; g++) {
      m.ellipsoid(s * (0.20 + g * 0.01), -0.115, 0.48 - g * 0.09, 0.08, 0.01, 0.012, gillC, 0.5, 0.65, 2, 3);
    }
  }
  return m.build();
}

// Emperor Penguin Mesh (upright +Y, beak +Z, grounded feet y = 0)
function buildPenguinMesh() {
  const m = new MeshBuilder();
  const back = [0.07, 0.09, 0.13], belly = [0.92, 0.93, 0.94], gold = [0.92, 0.68, 0.16], beak = [0.88, 0.44, 0.12];
  m.smoothLimb(
    [[0, 0.05, -0.05], [0, 0.26, 0.0], [0, 0.50, 0.02], [0, 0.70, 0.04], [0, 0.80, 0.08], [0, 0.77, 0.22]],
    [[0.12, 0.11], [0.17, 0.16], [0.16, 0.15], [0.105, 0.105], [0.082, 0.082], [0.018, 0.018]],
    [back, back, back, gold, back, beak],
    [[0.5, 0], [0.5, 0.3], [0.5, 0.6], [0.5, 0.85], [0.5, 0.95], [0.5, 1.0]],
    7, 0.04
  );
  m.ellipsoid(0, 0.36, 0.09, 0.12, 0.25, 0.08, belly, 0.5, 0.5, 5, 6);
  addExpressiveFace(m, 0.79, 0.10, 0.08, 0.08, 0.10, beak, back, [0.04, 0.04, 0.05], false);
  for (const s of [-1, 1]) {
    m.ribbon([s * 0.15, 0.54, 0.02], [s * 0.23, 0.22, -0.02], 0.068, 0.022, 0.02, back, back, 0.6, 0.5, 0.8, 3);
    m.smoothLimb([[s * 0.07, 0.10, 0.01], [s * 0.08, 0.005, 0.10]], [0.04, 0.048], [back, back], [[0.42, 0.75], [0.42, 1.0]], 4, 0.02);
  }
  return m.build();
}

// Anatomically Accurate White-Tailed Deer (Odocoileus virginianus)
// Slender tapered chest/ribcage, lean tucked waist, proportional hindquarters
// (zero bulbous rump!), graceful arched neck, narrow muzzle, antlers, and
// 2-segment articulated upper/lower legs with distinct elbow, knee, stifle, hock & hooves.
function buildDeerMesh() {
  const m = new MeshBuilder();
  const coat   = [0.62, 0.41, 0.22];
  const flank  = [0.56, 0.37, 0.20];
  const belly  = [0.90, 0.86, 0.78];
  const dark   = [0.18, 0.13, 0.09];
  const antler = [0.78, 0.72, 0.58];

  // Anatomically proportioned torso: lean pelvis (-0.42) -> tucked waist (-0.08) -> deep chest (+0.28) -> withers (+0.38)
  m.smoothLimb(
    [
      [0, 0.86, -0.48],  // lean croup / pelvis
      [0, 0.88, -0.24],  // lumbar loin
      [0, 0.85,  0.04],  // ribcage mid
      [0, 0.89,  0.32],  // deep chest / withers
      [0, 1.12,  0.50],  // slender arched neck mid
      [0, 1.28,  0.62],  // upper neck / occiput
      [0, 1.27,  0.76],  // cranium
      [0, 1.21,  0.94]   // tapered narrow muzzle
    ],
    [
      [0.128, 0.152],    // proportional hindquarters (NOT oversized!)
      [0.118, 0.145],    // lean waist / flank tuck
      [0.138, 0.178],    // deep slender ribcage
      [0.142, 0.182],    // muscular chest & shoulders
      [0.078, 0.102],    // graceful neck
      [0.068, 0.082],    // poll
      [0.076, 0.086],    // skull
      [0.038, 0.044]     // nose
    ],
    [coat, flank, coat, coat, coat, coat, coat, dark],
    [[0.50, 0.18], [0.50, 0.38], [0.50, 0.56], [0.50, 0.72], [0.50, 0.84], [0.50, 0.92], [0.50, 0.96], [0.50, 1.0]],
    8, 0.03
  );
  // Crisp white underbelly & white-tailed deer flag tail (uv.x = 0.82 for gentle tail flick)
  m.ellipsoid(0, 0.73, 0.08, 0.105, 0.065, 0.34, belly, 0.50, 0.54, 4, 6);
  m.smoothLimb(
    [[0, 0.86, -0.49], [0, 0.82, -0.60], [0, 0.74, -0.66]],
    [[0.045, 0.052], [0.048, 0.060], [0.022, 0.028]],
    [coat, belly, belly], [[0.82, 0.04], [0.82, 0.02], [0.82, 0.0]], 5, 0.02
  );

  // Expressive head: wet eyes (0.12), articulated jaw (0.18), tall alert deer ears (0.25)
  addExpressiveFace(m, 1.26, 0.75, 0.075, 0.082, 0.13, belly, coat, [0.05, 0.035, 0.025], true);

  for (const s of [-1, 1]) {
    // Multi-tine branching antlers
    m.tube([[s * 0.045, 1.34, 0.70], [s * 0.14, 1.50, 0.64], [s * 0.22, 1.66, 0.70], [s * 0.19, 1.78, 0.80]], [0.017, 0.014, 0.011, 0.005], [antler, antler, antler, antler], [[0.5, 0.96], [0.5, 0.98], [0.5, 0.99], [0.5, 1.0]], 4, true);
    m.tube([[s * 0.14, 1.50, 0.64], [s * 0.12, 1.62, 0.76]], [0.011, 0.005], [antler, antler], [[0.5, 0.98], [0.5, 1.0]], 4, true);

    // FRONT LEG: shoulder -> humerus -> elbow (uv.x = 0.36 upper) -> forearm/carpus -> cannon -> cloven hoof (uv.x = 0.42 lower)
    m.smoothLimb(
      [[s * 0.115, 0.82, 0.31], [s * 0.110, 0.62, 0.26], [s * 0.105, 0.44, 0.29]],
      [[0.068, 0.078], [0.050, 0.056], [0.036, 0.040]],
      [coat, coat, coat], [[0.36, 0.05], [0.36, 0.28], [0.36, 0.48]], 6, 0.04
    );
    m.smoothLimb(
      [[s * 0.105, 0.44, 0.29], [s * 0.102, 0.22, 0.29], [s * 0.102, 0.06, 0.31], [s * 0.102, 0.005, 0.33]],
      [[0.034, 0.038], [0.024, 0.026], [0.022, 0.025], [0.030, 0.038]],
      [coat, flank, dark, dark], [[0.42, 0.50], [0.42, 0.76], [0.42, 0.94], [0.42, 1.0]], 6, 0.02
    );

    // HIND LEG: hip -> tapered thigh -> stifle -> angled hock (uv.x = 0.38 upper) -> slender cannon -> cloven hoof (uv.x = 0.44 lower)
    m.smoothLimb(
      [[s * 0.118, 0.82, -0.38], [s * 0.118, 0.62, -0.34], [s * 0.110, 0.44, -0.47]],
      [[0.078, 0.095], [0.058, 0.068], [0.036, 0.044]],
      [coat, flank, coat], [[0.38, 0.05], [0.38, 0.28], [0.38, 0.48]], 6, 0.05
    );
    m.smoothLimb(
      [[s * 0.110, 0.44, -0.47], [s * 0.105, 0.22, -0.44], [s * 0.105, 0.06, -0.41], [s * 0.105, 0.005, -0.39]],
      [[0.034, 0.040], [0.024, 0.026], [0.022, 0.025], [0.030, 0.038]],
      [coat, flank, dark, dark], [[0.44, 0.50], [0.44, 0.76], [0.44, 0.94], [0.44, 1.0]], 6, 0.02
    );
  }
  return m.build();
}

function buildCapybaraMesh() {
  const m = new MeshBuilder();
  const c0 = [0.50, 0.36, 0.22], c1 = [0.38, 0.26, 0.16];
  m.smoothLimb(
    [[0, 0.34, -0.42], [0, 0.38, 0.0], [0, 0.42, 0.32], [0, 0.46, 0.54]],
    [[0.18, 0.20], [0.22, 0.24], [0.19, 0.21], [0.11, 0.13]],
    [c0, c0, c0, c1],
    [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8], [0.5, 1.0]],
    7, 0.06
  );
  addExpressiveFace(m, 0.45, 0.44, 0.11, 0.12, 0.12, c1, c1, [0.05, 0.04, 0.03], true);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.12, 0.30, 0.22], [s * 0.12, 0.14, 0.23], [s * 0.12, 0.0, 0.24]], [0.065, 0.05, 0.045], [c0, c1, c1], [[0.4, 0.7], [0.4, 0.85], [0.4, 1]], 5, 0.06);
    m.smoothLimb([[s * 0.13, 0.30, -0.26], [s * 0.13, 0.14, -0.27], [s * 0.13, 0.0, -0.25]], [0.075, 0.05, 0.045], [c0, c1, c1], [[0.4, 0.3], [0.4, 0.15], [0.4, 0]], 5, 0.06);
  }
  return m.build();
}

function buildBearTapirMesh(isTapir = false) {
  const m = new MeshBuilder();
  const c0 = isTapir ? [0.24, 0.20, 0.18] : [0.15, 0.12, 0.10];
  const c1 = isTapir ? [0.34, 0.28, 0.25] : [0.26, 0.20, 0.14];
  m.smoothLimb(
    [[0, 0.54, -0.58], [0, 0.64, -0.10], [0, 0.66, 0.34], [0, 0.62, 0.64], [0, isTapir ? 0.48 : 0.58, 0.82]],
    [[0.26, 0.28], [0.30, 0.32], [0.27, 0.29], [0.17, 0.18], [0.07, 0.08]],
    [c0, c0, c0, c1, c1],
    [[0.5, 0.1], [0.5, 0.45], [0.5, 0.75], [0.5, 0.92], [0.5, 1.0]],
    7, 0.08
  );
  addExpressiveFace(m, 0.62, 0.66, 0.16, 0.16, 0.16, c1, c0, [0.06, 0.05, 0.04], true);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.18, 0.52, 0.28], [s * 0.18, 0.25, 0.29], [s * 0.18, 0.0, 0.31]], [0.11, 0.085, 0.08], [c0, c0, c0], [[0.4, 0.7], [0.4, 0.85], [0.4, 1]], 5, 0.08);
    m.smoothLimb([[s * 0.19, 0.52, -0.36], [s * 0.19, 0.25, -0.37], [s * 0.19, 0.0, -0.35]], [0.12, 0.085, 0.08], [c0, c0, c0], [[0.4, 0.3], [0.4, 0.15], [0.4, 0]], 5, 0.08);
  }
  return m.build();
}

function buildSmallMammalMesh(coat, stripedTail = false) {
  const m = new MeshBuilder();
  const dark = [0.12, 0.10, 0.09], light = [0.82, 0.80, 0.76];
  m.smoothLimb(
    [[0, 0.18, -0.62], [0, 0.22, -0.35], [0, 0.24, 0.0], [0, 0.26, 0.26], [0, 0.24, 0.44]],
    [[0.04, 0.04], [0.09, 0.10], [0.12, 0.13], [0.10, 0.11], [0.045, 0.05]],
    [stripedTail ? dark : coat, stripedTail ? light : coat, coat, coat, dark],
    [[0.8, 0], [0.6, 0.2], [0.5, 0.5], [0.5, 0.8], [0.5, 1.0]],
    6, 0.07
  );
  addExpressiveFace(m, 0.26, 0.30, 0.08, 0.08, 0.10, light, coat, [0.05, 0.05, 0.05], true);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.08, 0.20, 0.16], [s * 0.08, 0.0, 0.18]], [0.04, 0.03], [coat, dark], [[0.4, 0.7], [0.4, 1.0]], 4, 0.05);
    m.smoothLimb([[s * 0.08, 0.20, -0.18], [s * 0.08, 0.0, -0.16]], [0.045, 0.03], [coat, dark], [[0.4, 0.3], [0.4, 0.0]], 4, 0.05);
  }
  return m.build();
}

function buildMonkeySlothMesh(coat, isSloth = false) {
  const m = new MeshBuilder();
  const face = [0.68, 0.56, 0.46];
  m.smoothLimb(
    [[0, 0.26, -0.24], [0, 0.28, 0.04], [0, 0.34, 0.26], [0, 0.34, 0.34]],
    [[0.10, 0.11], [0.12, 0.13], [0.09, 0.09], [0.06, 0.06]],
    [coat, coat, coat, face],
    [[0.5, 0.2], [0.5, 0.5], [0.5, 0.85], [0.5, 1.0]],
    6, 0.06
  );
  addExpressiveFace(m, 0.34, 0.28, 0.07, 0.07, 0.08, face, coat, [0.06, 0.04, 0.03], !isSloth);
  if (!isSloth) {
    m.smoothLimb([[0, 0.26, -0.20], [0, 0.42, -0.48], [0, 0.62, -0.62], [0, 0.54, -0.72]], [0.03, 0.025, 0.02, 0.015], [coat, coat, coat, coat], [[0.8, 0], [0.8, 0], [0.8, 0], [0.8, 0]], 4, 0.02);
  }
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.10, 0.28, 0.12], [s * 0.16, 0.06, 0.16]], [0.04, 0.03], [coat, coat], [[0.4, 0.6], [0.4, 1]], 4, 0.05);
    m.smoothLimb([[s * 0.10, 0.26, -0.16], [s * 0.14, 0.04, -0.18]], [0.04, 0.03], [coat, coat], [[0.4, 0.3], [0.4, 0]], 4, 0.05);
  }
  return m.build();
}

function buildAlligatorMesh() {
  const m = new MeshBuilder();
  const dark = [0.13, 0.19, 0.11], mid = [0.20, 0.27, 0.15], belly = [0.42, 0.44, 0.32];
  const path = [[0, 0.08, -1.65], [0, 0.12, -1.05], [0, 0.16, -0.45], [0, 0.18, 0.15], [0, 0.16, 0.65], [0, 0.12, 1.12]];
  const rad = [[0.03, 0.05], [0.10, 0.14], [0.22, 0.16], [0.24, 0.17], [0.17, 0.12], [0.11, 0.07]];
  m.smoothLimb(path, rad, [dark, dark, mid, mid, dark, belly], [[0.9, 0], [0.8, 0.2], [0.5, 0.4], [0.5, 0.6], [0.5, 0.8], [0.5, 1]], 7, 0.05);
  // Articulated lower alligator jaw (uv.x = 0.18)
  m.ellipsoid(0, 0.07, 0.88, 0.10, 0.04, 0.24, belly, 0.18, 0.96, 4, 5);
  for (const s of [-1, 1]) {
    // Raised golden reptilian eyes (uv.x = 0.12)
    m.ellipsoid(s * 0.08, 0.24, 0.62, 0.035, 0.035, 0.045, [0.78, 0.68, 0.16], 0.12, 0.92, 3, 4);
    m.smoothLimb([[s * 0.20, 0.14, 0.25], [s * 0.34, 0.04, 0.28], [s * 0.36, 0.0, 0.35]], [0.06, 0.045, 0.04], [mid, dark, dark], [[0.4, 0.6], [0.4, 0.8], [0.4, 1]], 4, 0.05);
    m.smoothLimb([[s * 0.20, 0.14, -0.35], [s * 0.34, 0.04, -0.38], [s * 0.36, 0.0, -0.32]], [0.065, 0.045, 0.04], [mid, dark, dark], [[0.4, 0.3], [0.4, 0.2], [0.4, 0]], 4, 0.05);
  }
  return m.build();
}

function buildAnacondaMesh() {
  const m = new MeshBuilder();
  const olive = [0.24, 0.30, 0.14], dark = [0.10, 0.12, 0.06];
  const path = [], rad = [], cols = [], uvs = [];
  for (let i = 0; i <= 14; i++) {
    const f = i / 14;
    const z = lerp(-1.8, 1.8, f);
    const x = sin(f * PI * 2.5) * 0.28;
    path.push([x, 0.09, z]);
    rad.push(sin(f * PI * 0.9 + 0.1) * 0.11 + 0.02);
    cols.push(i % 2 ? olive : dark);
    uvs.push([0.9, f]);
  }
  m.smoothLimb(path, rad, cols, uvs, 6, 0.04);
  return m.build();
}

function buildTurtleMesh() {
  const m = new MeshBuilder();
  const shell = [0.22, 0.26, 0.16], skin = [0.28, 0.36, 0.22];
  m.ellipsoid(0, 0.14, 0, 0.28, 0.13, 0.34, shell, 0.5, 0.5, 5, 7);
  m.ellipsoid(0, 0.15, 0.38, 0.07, 0.06, 0.09, skin, 0.5, 0.9, 4, 5);
  addExpressiveFace(m, 0.15, 0.38, 0.07, 0.06, 0.08, skin, skin, [0.05, 0.05, 0.05], false);
  for (const s of [-1, 1]) {
    m.ribbon([s * 0.22, 0.10, 0.14], [s * 0.42, 0.02, 0.22], 0.07, 0.03, 0.02, skin, skin, 0.4, 0.6, 0.9, 3);
    m.ribbon([s * 0.20, 0.10, -0.16], [s * 0.34, 0.02, -0.24], 0.06, 0.03, 0.02, skin, skin, 0.4, 0.2, 0.4, 3);
  }
  return m.build();
}

function buildIguanaMesh() {
  const m = new MeshBuilder();
  const grn = [0.24, 0.58, 0.20], tail = [0.18, 0.40, 0.16];
  m.smoothLimb([[0, 0.10, -0.75], [0, 0.14, -0.25], [0, 0.16, 0.15], [0, 0.20, 0.36]], [0.02, 0.07, 0.09, 0.06], [tail, grn, grn, grn], [[0.9, 0], [0.5, 0.4], [0.5, 0.7], [0.5, 1]], 6, 0.05);
  addExpressiveFace(m, 0.20, 0.34, 0.06, 0.06, 0.08, grn, tail, [0.06, 0.05, 0.04], false);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.08, 0.14, 0.12], [s * 0.15, 0.0, 0.16]], [0.03, 0.02], [grn, tail], [[0.4, 0.7], [0.4, 1]], 4, 0.04);
    m.smoothLimb([[s * 0.08, 0.14, -0.14], [s * 0.15, 0.0, -0.16]], [0.035, 0.02], [grn, tail], [[0.4, 0.3], [0.4, 0]], 4, 0.04);
  }
  return m.build();
}

function buildFrogMesh(bodyCol, isRedEye = false) {
  const m = new MeshBuilder();
  const eyeCol = isRedEye ? [0.92, 0.14, 0.10] : [0.08, 0.08, 0.10];
  m.smoothLimb([[0, 0.08, -0.10], [0, 0.11, 0.04], [0, 0.11, 0.14]], [[0.08, 0.07], [0.09, 0.08], [0.06, 0.05]], [bodyCol, bodyCol, bodyCol], [[0.5, 0.3], [0.5, 0.7], [0.5, 1.0]], 5, 0.05);
  // Inflatable throat vocal sac (uv.x = 0.18)
  m.ellipsoid(0, 0.07, 0.12, 0.05, 0.035, 0.05, bodyCol, 0.18, 0.95, 3, 4);
  for (const s of [-1, 1]) {
    m.ellipsoid(s * 0.045, 0.15, 0.10, 0.025, 0.025, 0.025, eyeCol, 0.12, 0.95, 3, 4);
  }
  return m.build();
}

function buildBirdMesh(bodyCol, wingCol, beakCol, wingSpan = 0.85, beakLen = 0.16, longLegs = false, accentCol = null) {
  const m = new MeshBuilder();
  const bAcc = accentCol || wingCol;
  m.smoothLimb(
    [[0, -0.02, -0.38], [0, 0.0, -0.12], [0, 0.02, 0.12], [0, 0.09, 0.25], [0, 0.08, 0.25 + beakLen]],
    [[0.04, 0.02], [0.10, 0.09], [0.11, 0.10], [0.075, 0.075], [0.015, 0.015]],
    [bAcc, bodyCol, bodyCol, bAcc, beakCol],
    [[0.5, 0], [0.5, 0.35], [0.5, 0.7], [0.5, 0.9], [0.5, 1.0]],
    6, 0.05
  );
  addExpressiveFace(m, 0.09, 0.25, 0.07, 0.07, 0.09, beakCol, bAcc, [0.05, 0.05, 0.05], false);
  m.ribbon([0, 0, -0.14], [0, -0.03, -0.46], 0.05, 0.11, 0.02, bodyCol, bAcc, 0.5, 0.1, 0.0, 3);
  for (const s of [-1, 1]) {
    const midX = s * wingSpan * 0.46;
    const tipX = s * wingSpan;
    m.ribbon([s * 0.07, 0.02, 0.04], [midX, 0.04, 0.0], 0.14, 0.16, 0.04, bodyCol, wingCol, 0.75, 0.4, 0.7, 3);
    m.ribbon([midX, 0.04, 0.0], [tipX, 0.02, -0.08], 0.16, 0.04, 0.03, wingCol, bAcc, 0.95, 0.7, 1.0, 3);
    if (longLegs) {
      m.tube([[s * 0.05, -0.05, 0.0], [s * 0.05, -0.48, -0.02]], [0.015, 0.012], [beakCol, beakCol], [[0.4, 0.5], [0.4, 1.0]], 4, true);
    }
  }
  return m.build();
}

function buildFishManateeMesh(col, isManatee = false) {
  const m = new MeshBuilder();
  const c2 = [col[0] * 0.72, col[1] * 0.76, col[2] * 0.82];
  const belly = [min(1.0, col[0] * 0.65 + 0.35), min(1.0, col[1] * 0.65 + 0.35), min(1.0, col[2] * 0.65 + 0.35)];
  if (isManatee) {
    const rx = 0.28, ry = 0.24, rz = 0.68;
    m.smoothLimb(
      [[0, 0, -rz * 1.35], [0, 0, -rz * 0.5], [0, 0, rz * 0.3], [0, 0, rz * 0.95]],
      [[0.02, 0.03], [rx * 0.7, ry * 0.75], [rx, ry], [rx * 0.45, ry * 0.45]],
      [c2, col, col, c2],
      [[0.9, 0], [0.6, 0.3], [0.5, 0.65], [0.5, 1.0]],
      6, 0.05
    );
    addExpressiveFace(m, 0.02, rz * 0.85, rx * 0.42, ry * 0.42, rz * 0.20, belly, c2, [0.05, 0.05, 0.05], false);
    m.ribbon([0, 0, -rz * 0.85], [0, 0, -rz * 1.45], ry * 0.35, ry * 1.15, 0.02, col, c2, 0.9, 0.2, 0.0, 3);
    for (const s of [-1, 1]) {
      m.ribbon([s * rx * 0.78, -ry * 0.35, rz * 0.32], [s * rx * 1.45, -ry * 0.62, rz * 0.14], 0.14, 0.06, -0.02, col, c2, 0.5, 0.65, 0.8, 3);
    }
    return m.build();
  }

  // Anatomical 3D Reef & Pelagic Fish (facing +Z):
  // Streamlined fusiform body from caudal peduncle (-0.28) to rostrum (+0.25)
  const rx = 0.058, ry = 0.096, rz = 0.24;
  m.smoothLimb(
    [[0, 0, -rz * 1.18], [0, 0, -rz * 0.65], [0, 0.005, -rz * 0.10], [0, 0.008, rz * 0.38], [0, 0.0, rz * 0.82], [0, -0.006, rz * 1.08]],
    [[0.012, 0.022], [rx * 0.52, ry * 0.58], [rx * 0.94, ry * 0.96], [rx, ry], [rx * 0.68, ry * 0.66], [rx * 0.26, ry * 0.24]],
    [c2, col, col, col, c2, belly],
    [[0.92, 0.0], [0.75, 0.22], [0.55, 0.48], [0.5, 0.70], [0.5, 0.88], [0.5, 1.0]],
    7, 0.035
  );
  // Expressive fish head: wet specular eyes (uv.x = 0.12) & articulated lower jaw (uv.x = 0.18)
  addExpressiveFace(m, 0.008, rz * 0.82, rx * 0.72, ry * 0.55, rz * 0.26, belly, c2, [0.04, 0.05, 0.07], false);
  // Sculpted gill operculum plates & lateral pectoral fins
  for (const s of [-1, 1]) {
    m.ellipsoid(s * rx * 0.86, 0.0, rz * 0.54, rx * 0.22, ry * 0.52, rz * 0.16, c2, 0.5, 0.78, 3, 4);
    m.ribbon([s * rx * 0.84, -ry * 0.24, rz * 0.42], [s * (rx * 2.45), -ry * 0.48, rz * 0.16], 0.058, 0.018, -0.01, col, belly, 0.65, 0.62, 0.76, 3);
    // Paired ventral pelvic fins
    m.ribbon([s * rx * 0.38, -ry * 0.82, rz * 0.12], [s * rx * 0.95, -ry * 1.28, -rz * 0.08], 0.042, 0.012, -0.01, c2, belly, 0.6, 0.45, 0.55, 2);
  }
  // Swept dorsal fin & ventral anal fin
  m.ribbon([0, ry * 0.86, rz * 0.18], [0, ry * 1.72, -rz * 0.34], 0.095, 0.022, 0.02, col, c2, 0.7, 0.40, 0.65, 4);
  m.ribbon([0, -ry * 0.76, -rz * 0.25], [0, -ry * 1.36, -rz * 0.62], 0.068, 0.016, -0.015, c2, belly, 0.75, 0.25, 0.42, 3);
  // Deeply forked homocercal caudal tail fin (upper & lower lobes)
  m.ribbon([0, 0.008, -rz * 1.05], [0, ry * 1.28, -rz * 1.68], 0.056, 0.016, 0.018, col, c2, 0.95, 0.12, 0.0, 3);
  m.ribbon([0, -0.008, -rz * 1.05], [0, -ry * 1.18, -rz * 1.64], 0.054, 0.016, -0.018, col, belly, 0.95, 0.12, 0.0, 3);
  return m.build();
}

function buildButterflyInsectMesh(col0, col1, isDragonfly = false) {
  const m = new MeshBuilder();
  m.tube([[0, 0, -0.10], [0, 0, 0.10]], [0.014, 0.014], [[0.1, 0.1, 0.1], [0.1, 0.1, 0.1]], [[0.5, 0], [0.5, 1]], 4, true);
  for (const s of [-1, 1]) {
    if (isDragonfly) {
      m.ribbon([0, 0.01, 0.03], [s * 0.24, 0.02, 0.05], 0.025, 0.035, 0.01, col0, col1, 0.9, 0.5, 1.0, 2);
      m.ribbon([0, 0.01, -0.02], [s * 0.22, 0.01, -0.04], 0.025, 0.03, 0.01, col0, col1, 0.9, 0.5, 1.0, 2);
    } else {
      m.ribbon([0, 0, 0.02], [s * 0.18, 0.03, 0.04], 0.08, 0.12, 0.02, col0, col1, 0.9, 0.5, 1.0, 2);
    }
  }
  return m.build();
}

function buildBeetleMesh() {
  const m = new MeshBuilder();
  m.ellipsoid(0, 0.04, 0, 0.06, 0.04, 0.09, [0.12, 0.52, 0.28], 0.5, 0.5, 4, 5);
  m.tube([[0, 0.05, 0.08], [0, 0.09, 0.18]], [0.018, 0.006], [[0.08, 0.25, 0.14], [0.08, 0.25, 0.14]], [[0.5, 0.8], [0.5, 1.0]], 4, true);
  return m.build();
}

function buildLookdevMesh() {
  const m = new MeshBuilder();
  m.ellipsoid(0, 0, 0, 0.22, 0.22, 0.22, [0.8, 0.8, 0.8], 0.5, 0.5, 14, 18);
  return m.build();
}
function buildSwatchBarMesh() {
  const m = new MeshBuilder();
  const swatches = [
    [0.14, 0.38, 0.12], [0.28, 0.20, 0.14], [0.08, 0.26, 0.20],
    [0.86, 0.16, 0.12], [0.14, 0.44, 0.86], [0.92, 0.72, 0.14],
    [0.90, 0.90, 0.90], [0.18, 0.18, 0.18], [0.04, 0.04, 0.04]
  ];
  for (let i = 0; i < swatches.length; i++) {
    const y = (i - 4) * 0.068;
    m.ellipsoid(0, y, 0, 0.075, 0.028, 0.018, swatches[i], 0.5, 0.5, 4, 6);
  }
  return m.build();
}

// ============================================================================
// Regional Floating-Origin Flora, Collision Grid & Planetary Wildlife Cohorts
// ============================================================================
function buildWorld() {
  seedRng(WORLD_SEED);

  // Build flora & set-piece meshes (including Noniv/abyssal-garden Sunken Galleon, Reef Kelp/Coral, Savanna Acacia)
  const meshes = [
    buildCypressMesh(),          // 0: Bald Cypress & Spanish Moss
    buildKapokMesh(),            // 1: Giant Kapok & Lianas
    buildPalmMesh(),             // 2: Royal / Sabal / Coconut Palm
    buildMangroveMesh(),         // 3: Red Mangrove Prop Roots
    buildUnderstoryMesh(),       // 4: Ferns, Monstera, Heliconia & Bromeliads
    buildRockLogFungusMesh(),    // 5: Boulders, Fallen Logs & Glowing Mycena
    buildWaterFloraMesh(),       // 6: Water Lilies, Sawgrass & Cattails
    buildSunkenGalleonMesh(),    // 7: Noniv/abyssal-garden Sunken Wooden Galleon (meshShip)
    buildKelpCoralReefMesh(),    // 8: Noniv/abyssal-garden Swaying Kelp, Anemones & Reef Coral
    buildAcaciaBambooMesh()      // 9: Savanna Umbrella Acacia, Misty Bamboo & Heritage Plantation Trees
  ];

  // Uniform 2D Spatial Hash Grid for O(1) solid obstacle collision within [-REGION_HALF, +REGION_HALF]
  const GRID_CELLS = 64;
  const CELL_SPAN = (REGION_HALF * 2) / GRID_CELLS;
  const colliders = [];
  const colliderCells = Array.from({ length: GRID_CELLS * GRID_CELLS }, () => []);
  const t = {};

  const vegBuffers = meshes.map((mesh) => ({
    verts: mesh.verts,
    indices: mesh.indices,
    count: mesh.count,
    instData: new Float32Array(8),
    instCount: 0
  }));
  let vegVersion = 0;
  let activeRegionBiomeId = 0;

  function clearColliders() {
    colliders.length = 0;
    for (let i = 0; i < colliderCells.length; i++) colliderCells[i].length = 0;
  }

  function addCollider(x, z, r, maxY) {
    if (abs(x) > REGION_HALF || abs(z) > REGION_HALF) return;
    const id = colliders.length;
    colliders.push({ x, z, r, maxY });
    const minCx = clamp(floor((x - r + REGION_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const maxCx = clamp(floor((x + r + REGION_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const minCz = clamp(floor((z - r + REGION_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const maxCz = clamp(floor((z + r + REGION_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        colliderCells[cz * GRID_CELLS + cx].push(id);
      }
    }
  }

  // Deterministic Earth-Anchored Cell Flora Streamer (515 m radius, zero pop-in on floating-origin rebase)
  const _llTmp = {};
  const _lmTmp = {};
  function cellRng(seedInt) {
    let s = seedInt >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let z = Math.imul(s ^ (s >>> 15), 1 | s);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  function populateRegionFlora(biomeId = 0, _seedOffset = 0) {
    activeRegionBiomeId = biomeId;
    clearColliders();
    const instances = [[], [], [], [], [], [], [], [], [], []];

    function pushInst(mIdx, x, y, z, scale, rot, seed, charAmt, wetness, colRadius = 0, colHeight = 0) {
      instances[mIdx].push(x, y, z, scale, rot, seed, charAmt, wetness);
      if (colRadius > 0.05) {
        addCollider(x, z, colRadius * scale, y + colHeight * scale);
      }
    }

    const origin = getActiveOrigin();
    const CELL_M = 64.0;
    const STREAM_RAD = 515.0;
    const CELL_LAT_DEG = CELL_M / 111320.0;

    // Anchor iconic landmarks (Abyssal Sunken Galleon, River Lagoon & Wildlife Clearing) to their true Earth coords
    const isMarineRegion = biomeId === 10 || biomeId === 11;
    const isBeachRegion = biomeId === 9;
    const isPolarRegion = biomeId === 12 || biomeId === 13;
    const isSavannaRegion = biomeId === 6;
    const isBambooRegion = biomeId === 7;
    const isPlantationRegion = biomeId === 5;
    const isHighlandRegion = biomeId === 8;
    const isAridRegion = biomeId === 17;
    const isVolcanicRegion = biomeId === 14 || biomeId === 15;

    const riverCenter = latLonToLocalMeters(BIOME_CATALOG[0].latDeg, BIOME_CATALOG[0].lonDeg, origin, { x: 0, z: 0 });
    const clearingCenter = latLonToLocalMeters(BIOME_CATALOG[4].latDeg, BIOME_CATALOG[4].lonDeg, origin, { x: 0, z: 0 });

    if (isMarineRegion) {
      const bRef = BIOME_CATALOG[biomeId];
      latLonToLocalMeters(bRef.latDeg, bRef.lonDeg, origin, _lmTmp);
      const gx = _lmTmp.x - 6;
      const gz = _lmTmp.z - 4;
      if (hypot(gx, gz) < STREAM_RAD) {
        terrainAt(gx, gz, t);
        pushInst(7, gx, min(-1.5, t.h) + 0.25, gz, 1.35, 0.42, 0.5, 0, 1.0, 3.2, 8.0);
      }
    }

    const latCellCenter = Math.floor(origin.latDeg / CELL_LAT_DEG);
    const latRadiusCells = Math.ceil(STREAM_RAD / CELL_M) + 1;

    // Per-64m-cell budgets tuned for rich forests out to 515m while keeping GPU draw count lean
    const treesPerCell = max(2, round((isMarineRegion || isPolarRegion || isAridRegion ? 2 : 9) * VEG_DENSITY_SCALE));
    const underPerCell = max(1, round((isMarineRegion || isPolarRegion || isAridRegion ? 1 : 9) * VEG_DENSITY_SCALE));
    const rocksPerCell = max(1, round(3 * VEG_DENSITY_SCALE));
    const reefPerCell = max(1, round((isMarineRegion ? 7 : 2) * VEG_DENSITY_SCALE));
    const waterFloraPerCell = max(1, round(4 * VEG_DENSITY_SCALE));

    for (let dLat = -latRadiusCells; dLat <= latRadiusCells; dLat++) {
      const ciLat = latCellCenter + dLat;
      const cellLatBase = ciLat * CELL_LAT_DEG;
      const cellCosLat = max(0.14, cos((cellLatBase + CELL_LAT_DEG * 0.5) * DEG2RAD));
      const cellLonDeg = CELL_M / (111320.0 * cellCosLat);
      const lonCellCenter = Math.floor(origin.lonDeg / cellLonDeg);
      const lonRadiusCells = Math.ceil(STREAM_RAD / CELL_M) + 1;

      for (let dLon = -lonRadiusCells; dLon <= lonRadiusCells; dLon++) {
        const ciLon = lonCellCenter + dLon;
        const cLatMid = (ciLat + 0.5) * CELL_LAT_DEG;
        const cLonMid = (ciLon + 0.5) * cellLonDeg;
        latLonToLocalMeters(cLatMid, cLonMid, origin, _llTmp);
        const cellDist = hypot(_llTmp.x, _llTmp.z);
        if (cellDist > STREAM_RAD + CELL_M * 0.72) continue;

        // Deterministic hash strictly from Earth cell indices (ciLat, ciLon) — NEVER depends on floating origin!
        const hash = (Math.imul(ciLat | 0, 73856093) ^ Math.imul(ciLon | 0, 19349663) ^ WORLD_SEED) >>> 0;
        const cRand = cellRng(hash);
        const cRange = (a, b) => a + (b - a) * cRand();

        const samplePosInCell = () => {
          const latD = (ciLat + cRand()) * CELL_LAT_DEG;
          const lonD = (ciLon + cRand()) * cellLonDeg;
          latLonToLocalMeters(latD, lonD, origin, _llTmp);
          return _llTmp;
        };

        // 1. Primary Canopy Trees & Biome Groves (Streamed seamlessly out to 515 m!)
        for (let i = 0; i < treesPerCell; i++) {
          const pos = samplePosInCell();
          const x = pos.x, z = pos.z;
          const rSeed = cRand(), rRot = cRand() * TAU, rScale = cRange(0.85, 1.42), rPick = cRand();
          if (hypot(x, z) > STREAM_RAD) continue;
          if (hypot(x - riverCenter.x, z - riverCenter.z) < 22) continue;
          if (hypot(x - clearingCenter.x, z - clearingCenter.z) < 42 && rPick < 0.84) continue;
          terrainAt(x, z, t);
          if (t.h < -0.55 || t.polar > 0.45 || t.dune > 0.55 || t.volcano > 0.55) continue;
          if ((isSavannaRegion || t.savanna > 0.48) && rPick < 0.65) continue;
          const charAmt = saturate(t.fire * (0.6 + rSeed * 0.65));

          if (isBeachRegion && t.h > 0.2 && t.h < 6.5 && t.polar < 0.25) {
            pushInst(2, x, t.h, z, rScale, rRot, rSeed, charAmt, t.wetness, 0.34, 9.0);
          } else if (t.mangrove > 0.32 || biomeId === 3 || (t.h < 0.18 && t.river > 0.25)) {
            pushInst(3, x, max(-0.28, t.h), z, rScale * 0.94, rRot, rSeed, charAmt, t.wetness, 0.55, 5.2);
          } else if (t.swamp > 0.28 || biomeId === 1 || (t.wetness > 0.52 && rPick < 0.52)) {
            pushInst(0, x, max(-0.22, t.h), z, rScale, rRot, rSeed, charAmt, t.wetness, 0.72, 13.5);
          } else if (isSavannaRegion || isBambooRegion || isPlantationRegion || t.savanna > 0.42 || t.bamboo > 0.32) {
            const mIdx = isPlantationRegion && rPick < 0.32 ? 2 : 9;
            pushInst(mIdx, x, t.h, z, rScale, rRot, rSeed, charAmt, t.wetness, 0.55, 10.0);
          } else if (isHighlandRegion || t.amazon > 0.25 || t.highland > 0.25 || rPick < 0.55) {
            pushInst(1, x, t.h, z, rScale, rRot, rSeed, charAmt, t.wetness, 0.92, 19.5);
          } else {
            pushInst(2, x, t.h, z, rScale * 0.96, rRot, rSeed, charAmt, t.wetness, 0.34, 9.0);
          }
        }

        // 2. Underwater Kelp Forests, Fluorescent Anemones & Reef Corals (within 340 m)
        if (cellDist < 340) {
          for (let i = 0; i < reefPerCell; i++) {
            const pos = samplePosInCell();
            const x = pos.x, z = pos.z;
            const rScale = cRange(0.85, 1.75), rRot = cRand() * TAU, rSeed = cRand();
            if (hypot(x, z) > 335) continue;
            terrainAt(x, z, t);
            if (t.h < -0.55 && t.h > -36.0 && t.polar < 0.7) {
              pushInst(8, x, t.h - 0.05, z, rScale, rRot, rSeed, 0, 1.0);
            }
          }
        }

        // 3. Boulders, Kopjes, Obsidian Rocks & Polar Glacial Ice Blocks (within 420 m)
        if (cellDist < 420) {
          for (let i = 0; i < rocksPerCell; i++) {
            const pos = samplePosInCell();
            const x = pos.x, z = pos.z;
            const rScale = (isPolarRegion || isVolcanicRegion) ? cRange(1.1, 2.3) : cRange(0.75, 1.8);
            const rRot = cRand() * TAU, rSeed = cRand();
            if (hypot(x, z) > 410) continue;
            terrainAt(x, z, t);
            if (t.h < -1.5 && !isMarineRegion && !isPolarRegion) continue;
            pushInst(5, x, t.h - 0.08, z, rScale, rRot, rSeed, saturate(t.fire), t.wetness, 0.78, 0.95);
          }
        }

        // 4. Close-to-Mid Understory Ferns & Grasses (within 270 m — blends softly in shader)
        if (cellDist < 275) {
          for (let i = 0; i < underPerCell; i++) {
            const pos = samplePosInCell();
            const x = pos.x, z = pos.z;
            const rScale = cRange(0.75, 1.55), rRot = cRand() * TAU, rSeed = cRand();
            if (hypot(x, z) > 265) continue;
            terrainAt(x, z, t);
            if (t.h < 0.02 || t.dune > 0.55 || t.volcano > 0.55 || t.polar > 0.38) continue;
            pushInst(4, x, t.h, z, rScale, rRot, rSeed, saturate(t.fire * 1.1), t.wetness);
          }
        }

        // 5. Water Lilies, Sawgrass & Cattails in warm freshwater shallows (within 260 m)
        if (!isPolarRegion && !isMarineRegion && !isAridRegion && cellDist < 265) {
          for (let i = 0; i < waterFloraPerCell; i++) {
            const pos = samplePosInCell();
            const x = pos.x, z = pos.z;
            const rScale = cRange(0.75, 1.45), rRot = cRand() * TAU, rSeed = cRand();
            if (hypot(x, z) > 255) continue;
            terrainAt(x, z, t);
            if (t.h > -1.4 && t.h < 0.28 && t.polar < 0.15) {
              pushInst(6, x, 0.01, z, rScale, rRot, rSeed, saturate(t.fire * 0.8), 1.0);
            }
          }
        }
      }
    }

    // Update vegBuffers (ensure every buffer has at least 1 dummy 0-scale instance if empty so WebGPU draw stays safe)
    for (let idx = 0; idx < meshes.length; idx++) {
      const arr = instances[idx];
      if (arr.length === 0) {
        vegBuffers[idx].instData = new Float32Array([0, -9999, 0, 0, 0, 0, 0, 0]);
        vegBuffers[idx].instCount = 0;
      } else {
        vegBuffers[idx].instData = new Float32Array(arr);
        vegBuffers[idx].instCount = (arr.length / 8) | 0;
      }
    }
    vegVersion++;
  }

  populateRegionFlora(0, 0);

  // ==========================================================================
  // Solid Obstacle + Ground Collision Solver (Regional Meters, Zero Wrapping!)
  // ==========================================================================
  const _colT = {};
  function resolveWorldCollision(x, y, z, radius, vx, vz, out = {}, minGroundOffset = 0.62) {
    let nx = Number.isFinite(x) ? x : 0;
    let ny = Number.isFinite(y) ? y : 2.5;
    let nz = Number.isFinite(z) ? z : 0;
    let nvx = Number.isFinite(vx) ? vx : 0;
    let nvz = Number.isFinite(vz) ? vz : 0;
    let hit = false, hitGround = false;
    let hitNx = 0, hitNz = 0;

    terrainAt(nx, nz, _colT);
    const minY = _colT.h + minGroundOffset;
    if (ny < minY) {
      ny = minY;
      hitGround = true;
    }

    // Only check regional tree/rock colliders when inside the active regional bounds and below canopy height
    if (ny < 60 && abs(nx) < REGION_HALF - 1 && abs(nz) < REGION_HALF - 1) {
      const cx = clamp(floor((nx + REGION_HALF) / CELL_SPAN) || 0, 0, GRID_CELLS - 1);
      const cz = clamp(floor((nz + REGION_HALF) / CELL_SPAN) || 0, 0, GRID_CELLS - 1);
      for (let dz = -1; dz <= 1; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= GRID_CELLS) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx;
          if (gx < 0 || gx >= GRID_CELLS) continue;
          const bucket = colliderCells[gz * GRID_CELLS + gx];
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const c = colliders[bucket[k]];
            if (!c || ny > c.maxY) continue;
            const ox = nx - c.x, oz = nz - c.z;
            const minDist = c.r + radius;
            const d2 = ox * ox + oz * oz;
            if (d2 < minDist * minDist && d2 > 1e-9) {
              const d = sqrt(d2);
              const push = minDist - d;
              const ux = ox / d, uz = oz / d;
              nx += ux * push;
              nz += uz * push;
              const vn = nvx * ux + nvz * uz;
              if (vn < 0) {
                nvx -= vn * ux * 1.15;
                nvz -= vn * uz * 1.15;
              }
              hit = true;
              hitNx = ux;
              hitNz = uz;
            }
          }
        }
      }
    }

    out.x = nx; out.y = ny; out.z = nz;
    out.vx = nvx; out.vz = nvz;
    out.hit = hit; out.hitGround = hitGround;
    out.nx = hitNx; out.nz = hitNz;
    out.groundH = _colT.h;
    return out;
  }

  // ==========================================================================
  // Planetary Wildlife Cohorts (43 Cohorts Across Land, Air, Ocean & Polar)
  // 12 floats per instance:
  //   inst0: x, y, z, scale
  //   inst1: yaw, phase, emoAndSpeed, packedMode
  //   inst2: pitch, roll, ikFrontFlex, ikHindFlex
  // ==========================================================================
  const SIM_HZ = 120;
  const SIM_DT = 1 / SIM_HZ;
  const ANIMAL_INST_FLOATS = 12;
  const wildlifeGroups = [];

  function addCohort(name, mesh, items, speciesId, flightDist = 18, meta = {}) {
    const dom = meta.domain || 'land';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.speciesId = speciesId;
      it.flightDist = flightDist;
      it.state = 'forage';
      it.emotion = i % 3; // 0=Calm/Grazing, 1=Curious, 2=Alert, 3=Dominant/Stalk/Chase, 4=Startled/Flee
      it.emotionTimer = rr(3, 10);
      it.roarTimer = 0;
      it.fleeTimer = 0;
      it.restTimer = (i % 4 === 0) ? rr(2, 6) : 0;
      it.goalTimer = rr(4, 14);
      it.packedMode = speciesId * 16 + (it.mode || 0);
      it.strideLen = meta.strideLen || (0.85 * (it.scale || 1.0));
      it.role = meta.role || 'herbivore';
      it.domain = dom;
      it.ang = it.phase ?? rr(0, TAU);
      it.homeX = it.cx ?? it.x ?? 0;
      it.homeZ = it.cz ?? it.z ?? 0;
      it.wanderRad = max(8, (it.rad || 14) * 1.45);
      if (it.x === undefined) {
        const a0 = rr(0, TAU), r0 = rr(2, it.wanderRad * 0.75);
        it.x = it.homeX + cos(a0) * r0;
        it.z = it.homeZ + sin(a0) * r0;
      }
      if (it.y === undefined) {
        terrainAt(it.x, it.z, t);
        it.y = dom === 'water' ? min(-1.4, t.h + 2.0) : max(-0.08, t.h);
      }
      it.baseY = it.baseY ?? it.y;
      it.prevX = it.x;
      it.prevY = it.y;
      it.prevZ = it.z;
      it.yaw = normAngle(it.yaw ?? rr(-PI, PI));
      it.prevYaw = it.yaw;
      it.pitch = 0;
      it.prevPitch = 0;
      it.roll = 0;
      it.prevRoll = 0;
      it.ikFrontFlex = 0;
      it.ikHindFlex = 0;
      it.vx = 0;
      it.vy = 0;
      it.vz = 0;
      it.curSpeed = 0;
      it.cruiseSpeed = meta.cruiseSpeed || (dom === 'air' ? 9.5 : dom === 'water' ? 2.8 : 1.65);
      it.maxSpeed = meta.baseSpeed || 6.5;
      it.turnRate = meta.turnRate || (dom === 'water' ? 1.05 : 2.1);
      it.goalX = it.homeX + rr(-it.wanderRad, it.wanderRad);
      it.goalZ = it.homeZ + rr(-it.wanderRad, it.wanderRad);
      it.goalY = it.baseY;
      it.boidsX = 0;
      it.boidsY = 0;
      it.boidsZ = 0;
      it.aiTickOffset = (i * 7 + speciesId * 3) % 8;

      // Event-driven Whale & Orca Breaching FSM (NEVER for sharks or mantas!)
      const isBreacher = (speciesId === 31 || speciesId === 32);
      it.canBreach = isBreacher;
      it.breachState = 'cruise';
      it.breachTimer = 0;
      it.breachCooldown = isBreacher ? rr(speciesId === 31 ? 26 : 18, speciesId === 31 ? 62 : 46) : Infinity;
      it.breachRollDir = (i % 2 === 0 ? 1 : -1);
      it.breachPeakVy = speciesId === 31 ? rr(10.2, 12.6) : rr(8.6, 10.8);
    }
    wildlifeGroups.push({
      name,
      speciesId,
      label: meta.label || name,
      domain: dom,
      role: meta.role || 'herbivore',
      nativeBiomes: meta.nativeBiomes || [0],
      eyeOffset: meta.eyeOffset || [0, 0.75, 0.55],
      followDist: meta.followDist || 4.8,
      baseSpeed: meta.baseSpeed || 6.5,
      bodyHalfLen: meta.bodyHalfLen || 0.55,
      legLength: meta.legLength || 0.42,
      verts: mesh.verts,
      indices: mesh.indices,
      count: mesh.count,
      items,
      instData: new Float32Array(items.length * ANIMAL_INST_FLOATS),
      instCount: items.length
    });
  }

  // --- Reptiles & Amphibians ---
  const gators = [];
  for (let i = 0; i < 12; i++) {
    gators.push({ type: 'swim', cx: rr(-85, 85), cz: rr(-55, 55), y: -0.05, rad: rr(8, 22), speed: rr(0.8, 1.5), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 0.85, mode: 1 });
  }
  addCohort('alligators', buildAlligatorMesh(), gators, 2, 12, { label: 'American Alligator', domain: 'water', role: 'predator', nativeBiomes: [0, 1, 3], eyeOffset: [0, 0.28, 0.72], followDist: 4.2, baseSpeed: 5.5, cruiseSpeed: 1.2 });

  const caimans = [];
  for (let i = 0; i < 8; i++) {
    caimans.push({ type: 'swim', cx: rr(-75, 75), cz: rr(-55, 55), y: -0.05, rad: rr(6, 16), speed: rr(0.9, 1.6), phase: rr(0, TAU), scale: rr(0.65, 0.88), animSpeed: 1.0, mode: 1 });
  }
  addCohort('caimans', buildAlligatorMesh(), caimans, 2, 14, { label: 'Black Caiman', domain: 'water', role: 'predator', nativeBiomes: [0, 1, 3], eyeOffset: [0, 0.25, 0.65], followDist: 3.8, baseSpeed: 5.8, cruiseSpeed: 1.3 });

  const anacondas = [];
  for (let i = 0; i < 6; i++) {
    anacondas.push({ type: 'swim', cx: rr(-65, 65), cz: rr(-50, 50), y: -0.04, rad: rr(6, 15), speed: rr(0.7, 1.3), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.15, mode: 1 });
  }
  addCohort('anacondas', buildAnacondaMesh(), anacondas, 15, 10, { label: 'Green Anaconda', domain: 'water', role: 'predator', nativeBiomes: [0, 1, 2], eyeOffset: [0, 0.16, 1.2], followDist: 3.6, baseSpeed: 4.8, cruiseSpeed: 1.1 });

  const turtles = [];
  for (let i = 0; i < 16; i++) {
    const ty = i >= 10 ? rr(-4.2, -1.4) : -0.08;
    turtles.push({ type: 'swim', cx: rr(-85, 85), cz: rr(-65, 65), y: ty, rad: rr(8, 22), speed: rr(0.8, 1.6), phase: rr(0, TAU), scale: rr(0.85, 1.35), animSpeed: 0.85, mode: 1 });
  }
  addCohort('turtles', buildTurtleMesh(), turtles, 3, 10, { label: 'Green Sea Turtle', domain: 'water', role: 'herbivore', nativeBiomes: [0, 9, 10, 11], eyeOffset: [0, 0.20, 0.38], followDist: 3.2, baseSpeed: 5.2, cruiseSpeed: 1.4 });

  const iguanas = [];
  for (let i = 0; i < 10; i++) {
    const cx = rr(-75, 75), cz = rr(-65, 65);
    terrainAt(cx, cz, t);
    iguanas.push({ type: 'idle', x: cx, y: max(0.1, t.h), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(0.9, 1.25), animSpeed: 0.7, mode: 0 });
  }
  addCohort('iguanas', buildIguanaMesh(), iguanas, 15, 14, { label: 'Green Iguana', domain: 'land', nativeBiomes: [0, 2, 3, 9] });

  const dartFrogs = [];
  for (let i = 0; i < 12; i++) {
    const cx = rr(-70, 70), cz = rr(-70, 70);
    terrainAt(cx, cz, t);
    dartFrogs.push({ type: 'idle', x: cx, y: max(0.2, t.h + rr(0.05, 0.35)), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.1, 1.5), animSpeed: 1.2, mode: 4 });
  }
  addCohort('dartFrogs', buildFrogMesh([0.12, 0.46, 0.88], false), dartFrogs, 16, 6, { label: 'Blue Poison Dart Frog', nativeBiomes: [0, 2] });

  const treeFrogs = [];
  for (let i = 0; i < 12; i++) {
    const cx = rr(-70, 70), cz = rr(-70, 70);
    terrainAt(cx, cz, t);
    treeFrogs.push({ type: 'idle', x: cx, y: max(0.2, t.h + rr(0.05, 0.35)), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.1, 1.45), animSpeed: 1.2, mode: 4 });
  }
  addCohort('treeFrogs', buildFrogMesh([0.26, 0.78, 0.20], true), treeFrogs, 17, 6, { label: 'Red-Eyed Tree Frog', nativeBiomes: [0, 1, 2] });

  // --- Rainforest & Wetland Mammals ---
  const jaguars = [];
  for (let i = 0; i < 6; i++) {
    jaguars.push({ type: 'walk', cx: rr(-95, 95), cz: rr(-95, 95), rad: rr(14, 30), speed: rr(1.4, 2.2), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.0, mode: 3 });
  }
  addCohort('jaguars', buildBigCatMesh([0.84, 0.56, 0.20], [0.88, 0.84, 0.72], false), jaguars, 1, 25, { label: 'Amazonian Jaguar', domain: 'land', role: 'predator', nativeBiomes: [0, 2, 16], eyeOffset: [0, 0.86, 0.88], followDist: 4.5, baseSpeed: 11.5, cruiseSpeed: 1.8, bodyHalfLen: 0.56, legLength: 0.44 });

  const panthers = [];
  for (let i = 0; i < 5; i++) {
    panthers.push({ type: 'walk', cx: rr(-95, 95), cz: rr(-95, 95), rad: rr(14, 30), speed: rr(1.4, 2.2), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.0, mode: 3 });
  }
  addCohort('panthers', buildBigCatMesh([0.66, 0.45, 0.28], [0.84, 0.74, 0.60], false), panthers, 11, 40, { label: 'Florida Panther', domain: 'land', role: 'predator', nativeBiomes: [1, 3, 4], eyeOffset: [0, 0.84, 0.86], followDist: 4.4, baseSpeed: 11.8, cruiseSpeed: 1.9, bodyHalfLen: 0.54, legLength: 0.44 });

  // Redesigned Slender White-Tailed Deer with full 2-bone IK articulation
  const deer = [];
  for (let i = 0; i < 12; i++) {
    const s = i < 3 ? 0.62 : rr(0.92, 1.14);
    deer.push({ type: 'walk', cx: rr(-75, 75), cz: rr(-75, 75), rad: rr(14, 34), speed: rr(1.2, 2.1), phase: rr(0, TAU), scale: s, animSpeed: 0.92, mode: 3 });
  }
  addCohort('deer', buildDeerMesh(), deer, 13, 42, { label: 'White-Tailed Deer', domain: 'land', role: 'herbivore', nativeBiomes: [0, 4, 5], eyeOffset: [0, 1.18, 0.76], followDist: 4.6, baseSpeed: 12.0, cruiseSpeed: 1.65, strideLen: 1.15, bodyHalfLen: 0.52, legLength: 0.44 });

  const capys = [];
  for (let i = 0; i < 16; i++) {
    capys.push({ type: 'walk', cx: rr(-70, 70), cz: rr(-55, 55), rad: rr(8, 18), speed: rr(0.9, 1.5), phase: rr(0, TAU), scale: i < 4 ? 0.48 : rr(0.9, 1.15), animSpeed: 0.75, mode: 3 });
  }
  addCohort('capybaras', buildCapybaraMesh(), capys, 11, 20, { label: 'Giant Capybara', domain: 'land', role: 'herbivore', nativeBiomes: [0, 1, 2], eyeOffset: [0, 0.48, 0.48], followDist: 3.2, baseSpeed: 6.2, cruiseSpeed: 1.2, bodyHalfLen: 0.34, legLength: 0.22 });

  const bears = [];
  for (let i = 0; i < 4; i++) {
    bears.push({ type: 'walk', cx: rr(-105, 105), cz: rr(-105, 105), rad: rr(16, 34), speed: rr(1.3, 2.0), phase: rr(0, TAU), scale: rr(0.92, 1.18), animSpeed: 0.85, mode: 3 });
  }
  addCohort('bears', buildBearTapirMesh(false), bears, 11, 55, { label: 'Black Bear', domain: 'land', role: 'predator', nativeBiomes: [4, 14], eyeOffset: [0, 0.68, 0.74], followDist: 4.6, baseSpeed: 9.0, cruiseSpeed: 1.7, bodyHalfLen: 0.52, legLength: 0.36 });

  const tapirs = [];
  for (let i = 0; i < 5; i++) {
    tapirs.push({ type: 'walk', cx: rr(-85, 85), cz: rr(-85, 85), rad: rr(12, 26), speed: rr(1.1, 1.8), phase: rr(0, TAU), scale: i === 0 ? 0.58 : rr(SIZE_VAR_MIN, 1.05), animSpeed: 0.85, mode: 3 });
  }
  addCohort('tapirs', buildBearTapirMesh(true), tapirs, 20, 35, { label: 'Amazonian Tapir', domain: 'land', role: 'herbivore', nativeBiomes: [0, 2], eyeOffset: [0, 0.62, 0.72], followDist: 4.2, baseSpeed: 7.5, cruiseSpeed: 1.5, bodyHalfLen: 0.48, legLength: 0.32 });

  const raccoons = [];
  for (let i = 0; i < 10; i++) {
    raccoons.push({ type: 'walk', cx: rr(-85, 85), cz: rr(-85, 85), rad: rr(8, 18), speed: rr(1.1, 1.9), phase: rr(0, TAU), scale: rr(0.92, 1.25), animSpeed: 1.3, mode: 3 });
  }
  addCohort('raccoons', buildSmallMammalMesh([0.48, 0.46, 0.42], true), raccoons, 12, 12, { label: 'Mangrove Raccoon', nativeBiomes: [0, 1, 3, 4], cruiseSpeed: 1.4 });

  const otters = [];
  for (let i = 0; i < 10; i++) {
    otters.push({ type: 'walk', cx: rr(-65, 65), cz: rr(-45, 45), rad: rr(8, 18), speed: rr(1.2, 2.0), phase: rr(0, TAU), scale: rr(0.92, 1.25), animSpeed: 1.35, mode: 3 });
  }
  addCohort('otters', buildSmallMammalMesh([0.36, 0.27, 0.20], false), otters, 11, 15, { label: 'Giant River Otter', domain: 'land', nativeBiomes: [0, 1, 3], eyeOffset: [0, 0.28, 0.42], followDist: 2.8, baseSpeed: 7.0, cruiseSpeed: 1.6 });

  const monkeys = [];
  for (let i = 0; i < 16; i++) {
    monkeys.push({ type: 'fly', cx: rr(-90, 90), cz: rr(-90, 90), y: rr(14, 24), rad: rr(10, 24), speed: rr(2.2, 3.8), phase: rr(0, TAU), scale: rr(1.05, 1.38), animSpeed: 1.5, mode: 4 });
  }
  addCohort('monkeys', buildMonkeySlothMesh([0.28, 0.20, 0.14], false), monkeys, 11, 25, { label: 'Spider Monkey', domain: 'air', nativeBiomes: [0, 2, 5, 8], cruiseSpeed: 3.0 });

  const sloths = [];
  for (let i = 0; i < 10; i++) {
    sloths.push({ type: 'idle', x: rr(-85, 85), y: rr(13, 21), z: rr(-85, 85), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.08, 1.35), animSpeed: 0.45, mode: 4 });
  }
  addCohort('sloths', buildMonkeySlothMesh([0.48, 0.44, 0.38], true), sloths, 11, 5, { label: 'Three-Toed Sloth', nativeBiomes: [0, 2] });

  const manatees = [];
  for (let i = 0; i < 5; i++) {
    manatees.push({ type: 'swim', cx: rr(-55, 55), cz: rr(-45, 45), y: -0.95, rad: rr(10, 22), speed: rr(0.7, 1.3), phase: rr(0, TAU), scale: i === 0 ? 0.62 : rr(0.92, 1.15), animSpeed: 0.65, mode: 1 });
  }
  addCohort('manatees', buildFishManateeMesh([0.44, 0.48, 0.50], true), manatees, 14, 10, { label: 'West Indian Manatee', domain: 'water', nativeBiomes: [0, 3, 9], cruiseSpeed: 1.1 });

  // --- Savanna, Bamboo Jungle, Ape Highlands & Plantation Megafauna ---
  const lions = [];
  for (let i = 0; i < 10; i++) {
    lions.push({ type: 'walk', cx: rr(-110, 110), cz: rr(-110, 110), rad: rr(18, 42), speed: rr(1.4, 2.4), phase: rr(0, TAU), scale: rr(1.05, 1.32), animSpeed: 1.0, mode: 3 });
  }
  addCohort('lions', buildBigCatMesh([0.82, 0.64, 0.34], [0.92, 0.86, 0.72], true), lions, 24, 30, { label: 'African Lion', domain: 'land', role: 'predator', nativeBiomes: [6, 17], eyeOffset: [0, 0.92, 0.92], followDist: 4.8, baseSpeed: 13.0, cruiseSpeed: 1.85, bodyHalfLen: 0.62, legLength: 0.46 });

  const tigers = [];
  for (let i = 0; i < 8; i++) {
    tigers.push({ type: 'walk', cx: rr(-110, 110), cz: rr(-110, 110), rad: rr(16, 36), speed: rr(1.5, 2.5), phase: rr(0, TAU), scale: rr(1.08, 1.35), animSpeed: 1.05, mode: 3 });
  }
  addCohort('tigers', buildBigCatMesh([0.92, 0.46, 0.12], [0.96, 0.94, 0.90], false), tigers, 25, 32, { label: 'Bengal Tiger', domain: 'land', role: 'predator', nativeBiomes: [7], eyeOffset: [0, 0.90, 0.92], followDist: 4.8, baseSpeed: 13.2, cruiseSpeed: 1.95, bodyHalfLen: 0.62, legLength: 0.46 });

  const gorillas = [];
  for (let i = 0; i < 9; i++) {
    gorillas.push({ type: 'walk', cx: rr(-95, 95), cz: rr(-95, 95), rad: rr(12, 26), speed: rr(1.1, 1.8), phase: rr(0, TAU), scale: rr(1.12, 1.42), animSpeed: 0.9, mode: 3 });
  }
  addCohort('gorillas', buildApeMesh([0.12, 0.13, 0.15], [0.74, 0.76, 0.80], true), gorillas, 26, 28, { label: 'Silverback Mountain Gorilla', domain: 'land', role: 'herbivore', nativeBiomes: [8], eyeOffset: [0, 1.12, 0.48], followDist: 4.6, baseSpeed: 8.8, cruiseSpeed: 1.5, bodyHalfLen: 0.45, legLength: 0.36 });

  const chimpanzees = [];
  for (let i = 0; i < 12; i++) {
    chimpanzees.push({ type: 'walk', cx: rr(-95, 95), cz: rr(-95, 95), rad: rr(12, 28), speed: rr(1.4, 2.3), phase: rr(0, TAU), scale: rr(0.95, 1.18), animSpeed: 1.25, mode: 3 });
  }
  addCohort('chimpanzees', buildApeMesh([0.16, 0.14, 0.12], [0.18, 0.15, 0.13], false), chimpanzees, 27, 25, { label: 'Wild Chimpanzee', domain: 'land', role: 'herbivore', nativeBiomes: [5, 8], eyeOffset: [0, 0.78, 0.38], followDist: 3.8, baseSpeed: 9.2, cruiseSpeed: 1.8, bodyHalfLen: 0.36, legLength: 0.32 });

  const elephants = [];
  for (let i = 0; i < 8; i++) {
    elephants.push({ type: 'walk', cx: rr(-115, 115), cz: rr(-115, 115), rad: rr(22, 48), speed: rr(1.2, 1.9), phase: rr(0, TAU), scale: i === 0 ? 0.65 : rr(1.05, 1.35), animSpeed: 0.72, mode: 3 });
  }
  addCohort('elephants', buildElephantMesh(), elephants, 28, 22, { label: 'African Bush Elephant', domain: 'land', role: 'herbivore', nativeBiomes: [6, 17], eyeOffset: [0, 1.85, 1.05], followDist: 7.5, baseSpeed: 7.8, cruiseSpeed: 1.6, strideLen: 1.65, bodyHalfLen: 0.92, legLength: 0.68 });

  const giraffes = [];
  for (let i = 0; i < 8; i++) {
    giraffes.push({ type: 'walk', cx: rr(-115, 115), cz: rr(-115, 115), rad: rr(20, 44), speed: rr(1.3, 2.2), phase: rr(0, TAU), scale: rr(1.02, 1.28), animSpeed: 0.78, mode: 3 });
  }
  addCohort('giraffes', buildGiraffeMesh(), giraffes, 29, 30, { label: 'Reticulated Giraffe', domain: 'land', role: 'herbivore', nativeBiomes: [6], eyeOffset: [0, 3.25, 0.95], followDist: 7.2, baseSpeed: 10.5, cruiseSpeed: 1.8, strideLen: 1.55, bodyHalfLen: 0.68, legLength: 0.85 });

  const zebras = [];
  for (let i = 0; i < 16; i++) {
    zebras.push({ type: 'walk', cx: rr(-110, 110), cz: rr(-110, 110), rad: rr(18, 42), speed: rr(1.5, 2.5), phase: rr(0, TAU), scale: rr(0.95, 1.18), animSpeed: 1.05, mode: 3 });
  }
  addCohort('zebras', buildZebraMesh(), zebras, 30, 42, { label: 'Plains Zebra', domain: 'land', role: 'herbivore', nativeBiomes: [6], eyeOffset: [0, 1.24, 0.85], followDist: 4.8, baseSpeed: 12.5, cruiseSpeed: 2.0, strideLen: 1.18, bodyHalfLen: 0.56, legLength: 0.48 });

  // --- Rebuilt Pelagic & Polar Marine Megafauna (True Adult Meter Lengths!) ---
  const whales = [];
  for (let i = 0; i < 6; i++) {
    whales.push({ type: 'swim', cx: rr(-135, 135), cz: rr(-135, 135), y: rr(-10.5, -5.0), rad: rr(32, 68), speed: rr(2.2, 3.6), phase: rr(0, TAU), scale: rr(0.88, 1.14), animSpeed: 0.68, mode: 1 });
  }
  addCohort('whales', buildHumpbackWhaleMesh(), whales, 31, 18, { label: 'Humpback Whale', domain: 'water', role: 'herbivore', nativeBiomes: [10, 11, 12, 13], eyeOffset: [0, 0.85, 5.2], followDist: 19.0, baseSpeed: 6.8, cruiseSpeed: 2.8, strideLen: 6.4, turnRate: 0.45 });

  const orcas = [];
  for (let i = 0; i < 7; i++) {
    orcas.push({ type: 'swim', cx: rr(-120, 120), cz: rr(-120, 120), y: rr(-8.5, -3.2), rad: rr(26, 56), speed: rr(3.0, 4.6), phase: rr(0, TAU), scale: rr(0.88, 1.12), animSpeed: 0.95, mode: 1 });
  }
  addCohort('orcas', buildOrcaMesh(), orcas, 32, 20, { label: 'Orca (Killer Whale)', domain: 'water', role: 'predator', nativeBiomes: [10, 11, 12, 13], eyeOffset: [0, 0.55, 2.7], followDist: 12.0, baseSpeed: 9.8, cruiseSpeed: 3.8, strideLen: 3.8, turnRate: 0.78 });

  const sharks = [];
  for (let i = 0; i < 8; i++) {
    sharks.push({ type: 'swim', cx: rr(-115, 115), cz: rr(-115, 115), y: rr(-9.5, -2.8), rad: rr(22, 48), speed: rr(2.4, 3.8), phase: rr(0, TAU), scale: rr(0.88, 1.18), animSpeed: 1.05, mode: 1 });
  }
  addCohort('sharks', buildSharkMesh(), sharks, 33, 20, { label: 'Great White Shark', domain: 'water', role: 'predator', nativeBiomes: [9, 10, 11], eyeOffset: [0, 0.28, 1.8], followDist: 7.5, baseSpeed: 8.6, cruiseSpeed: 3.0, strideLen: 2.4, turnRate: 0.92 });

  const mantas = [];
  for (let i = 0; i < 10; i++) {
    mantas.push({ type: 'swim', cx: rr(-110, 110), cz: rr(-110, 110), y: rr(-7.5, -2.2), rad: rr(20, 42), speed: rr(1.8, 3.0), phase: rr(0, TAU), scale: rr(0.88, 1.18), animSpeed: 0.85, mode: 1 });
  }
  addCohort('mantas', buildMantaMesh(), mantas, 34, 16, { label: 'Oceanic Manta Ray', domain: 'water', role: 'herbivore', nativeBiomes: [9, 10, 11], eyeOffset: [0, 0.22, 1.3], followDist: 7.0, baseSpeed: 6.4, cruiseSpeed: 2.3, strideLen: 2.6, turnRate: 0.85 });

  const penguins = [];
  for (let i = 0; i < 32; i++) {
    penguins.push({ type: 'walk', cx: rr(-90, 90), cz: rr(-90, 90), rad: rr(10, 26), speed: rr(0.9, 1.6), phase: rr(0, TAU), scale: rr(0.92, 1.18), animSpeed: 1.35, mode: 3 });
  }
  addCohort('penguins', buildPenguinMesh(), penguins, 35, 22, { label: 'Emperor Penguin', domain: 'land', role: 'herbivore', nativeBiomes: [12, 13], eyeOffset: [0, 0.78, 0.18], followDist: 3.2, baseSpeed: 5.5, cruiseSpeed: 1.15, bodyHalfLen: 0.16, legLength: 0.20 });

  const polarBears = [];
  for (let i = 0; i < 10; i++) {
    polarBears.push({ type: 'walk', cx: rr(-105, 105), cz: rr(-105, 105), rad: rr(16, 34), speed: rr(1.3, 2.1), phase: rr(0, TAU), scale: rr(1.15, 1.42), animSpeed: 0.85, mode: 3 });
  }
  addCohort('polarBears', buildBearTapirMesh(false), polarBears, 36, 28, { label: 'Polar Bear', domain: 'land', role: 'predator', nativeBiomes: [12, 13], eyeOffset: [0, 0.78, 0.82], followDist: 5.0, baseSpeed: 9.2, cruiseSpeed: 1.7, bodyHalfLen: 0.56, legLength: 0.38 });

  const seals = [];
  for (let i = 0; i < 14; i++) {
    seals.push({ type: 'swim', cx: rr(-95, 95), cz: rr(-95, 95), y: -1.4, rad: rr(14, 30), speed: rr(2.0, 3.2), phase: rr(0, TAU), scale: rr(0.95, 1.25), animSpeed: 1.05, mode: 1 });
  }
  addCohort('seals', buildFishManateeMesh([0.52, 0.56, 0.62], true), seals, 37, 20, { label: 'Leopard Seal', domain: 'water', role: 'predator', nativeBiomes: [12, 13], eyeOffset: [0, 0.24, 0.65], followDist: 4.0, baseSpeed: 8.5, cruiseSpeed: 2.5 });

  // --- Birds (8 Cohorts) ---
  const macaws = [];
  for (let i = 0; i < 22; i++) {
    macaws.push({ type: 'fly', cx: rr(-115, 115), cz: rr(-115, 115), y: rr(14, 30), rad: rr(24, 58), speed: rr(7.5, 11.5), phase: rr(0, TAU), scale: rr(1.15, 1.55), animSpeed: 1.45, mode: 2 });
  }
  addCohort('macaws', buildBirdMesh([0.86, 0.16, 0.12], [0.16, 0.42, 0.85], [0.88, 0.80, 0.52], 0.95, 0.16, false), macaws, 4, 30, { label: 'Scarlet Macaw', domain: 'air', nativeBiomes: [0, 1, 2, 3, 4, 5], eyeOffset: [0, 0.16, 0.35], followDist: 3.6, baseSpeed: 14.0, cruiseSpeed: 9.5 });

  const toucans = [];
  for (let i = 0; i < 12; i++) {
    toucans.push({ type: 'fly', cx: rr(-100, 100), cz: rr(-100, 100), y: rr(14, 26), rad: rr(18, 42), speed: rr(6.5, 9.5), phase: rr(0, TAU), scale: rr(1.1, 1.45), animSpeed: 1.2, mode: 2 });
  }
  addCohort('toucans', buildBirdMesh([0.14, 0.14, 0.16], [0.18, 0.18, 0.22], [0.90, 0.56, 0.10], 0.78, 0.34, false, [0.90, 0.74, 0.14]), toucans, 5, 20, { label: 'Toco Toucan', domain: 'air', nativeBiomes: [0, 2, 4], eyeOffset: [0, 0.15, 0.32], followDist: 3.4, baseSpeed: 12.5, cruiseSpeed: 8.2 });

  const eagles = [];
  for (let i = 0; i < 10; i++) {
    eagles.push({ type: 'fly', cx: rr(-140, 140), cz: rr(-140, 140), y: rr(34, 64), rad: rr(45, 95), speed: rr(10.0, 14.5), phase: rr(0, TAU), scale: rr(1.55, 2.1), animSpeed: 0.55, mode: 2 });
  }
  addCohort('eagles', buildBirdMesh([0.28, 0.20, 0.14], [0.22, 0.16, 0.11], [0.88, 0.72, 0.22], 1.45, 0.18, false, [0.90, 0.90, 0.88]), eagles, 6, 50, { label: 'Crowned Harpy Eagle', domain: 'air', role: 'predator', nativeBiomes: [0, 2, 4, 6, 7, 8, 9, 14, 15, 17], eyeOffset: [0, 0.22, 0.45], followDist: 4.6, baseSpeed: 18.0, cruiseSpeed: 12.0 });

  const owls = [];
  for (let i = 0; i < 8; i++) {
    owls.push({ type: 'idle', x: rr(-75, 75), y: rr(8, 16), z: rr(-75, 75), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.0, 1.25), animSpeed: 0.6, mode: 0 });
  }
  addCohort('owls', buildBirdMesh([0.46, 0.34, 0.22], [0.38, 0.28, 0.18], [0.42, 0.36, 0.24], 0.85, 0.10, false), owls, 7, 12, { label: 'Spectacled Owl', domain: 'air', nativeBiomes: [0, 1, 2, 16] });

  const kingfishers = [];
  for (let i = 0; i < 10; i++) {
    kingfishers.push({ type: 'fly', cx: rr(-75, 75), cz: rr(-55, 55), y: rr(2.5, 6.5), rad: rr(10, 24), speed: rr(6.5, 10.0), phase: rr(0, TAU), scale: rr(0.75, 1.0), animSpeed: 2.0, mode: 2 });
  }
  addCohort('kingfishers', buildBirdMesh([0.76, 0.36, 0.16], [0.10, 0.56, 0.78], [0.16, 0.16, 0.18], 0.52, 0.22, false, [0.12, 0.58, 0.82]), kingfishers, 10, 20, { label: 'Amazon Kingfisher', domain: 'air', nativeBiomes: [0, 1, 3, 9], cruiseSpeed: 8.0 });

  const flamingos = [];
  for (let i = 0; i < 18; i++) {
    flamingos.push({ type: 'idle', x: rr(-55, 55), y: 0.35, z: rr(-55, 55), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.08, 1.32), animSpeed: 0.6, mode: 0 });
  }
  addCohort('flamingos', buildBirdMesh([0.90, 0.44, 0.54], [0.86, 0.34, 0.44], [0.18, 0.16, 0.18], 0.8, 0.2, true), flamingos, 9, 40, { label: 'Caribbean Flamingo', domain: 'land', nativeBiomes: [0, 3, 9] });

  const herons = [];
  for (let i = 0; i < 14; i++) {
    herons.push({ type: 'idle', x: rr(-65, 65), y: 0.38, z: rr(-65, 65), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.12, 1.40), animSpeed: 0.6, mode: 0 });
  }
  addCohort('herons', buildBirdMesh([0.88, 0.90, 0.90], [0.80, 0.84, 0.88], [0.88, 0.66, 0.18], 0.95, 0.26, true), herons, 9, 25, { label: 'Great White Egret', domain: 'land', nativeBiomes: [0, 1, 3, 9] });

  const woodpeckers = [];
  for (let i = 0; i < 8; i++) {
    woodpeckers.push({ type: 'fly', cx: rr(-85, 85), cz: rr(-85, 85), y: rr(6, 16), rad: rr(12, 26), speed: rr(6.0, 9.0), phase: rr(0, TAU), scale: rr(0.85, 1.15), animSpeed: 1.6, mode: 2 });
  }
  addCohort('woodpeckers', buildBirdMesh([0.14, 0.14, 0.16], [0.18, 0.18, 0.20], [0.35, 0.32, 0.30], 0.56, 0.20, false, [0.82, 0.14, 0.12]), woodpeckers, 8, 22, { label: 'Pileated Woodpecker', domain: 'air', nativeBiomes: [0, 1, 2, 4, 7], cruiseSpeed: 7.5 });

  // --- Fish Schools & Invertebrates ---
  const fish = [];
  for (let s = 0; s < 10; s++) {
    const sx = rr(-85, 85);
    const sz = rr(-75, 75);
    const baseDepth = s >= 5 ? -3.4 : -0.95;
    for (let k = 0; k < 14; k++) {
      fish.push({
        type: 'swim',
        schoolId: s,
        cx: sx + rr(-4, 4),
        cz: sz + rr(-4, 4),
        y: baseDepth + rr(-1.5, 0.4),
        baseY: baseDepth + rr(-1.5, 0.4),
        rad: rr(8, 22),
        speed: rr(1.8, 3.2),
        phase: rr(0, TAU),
        scale: rr(0.85, 1.45),
        animSpeed: 2.2,
        mode: 1
      });
    }
  }
  addCohort('fish', buildFishManateeMesh([0.88, 0.64, 0.22], false), fish, 0, 8, { label: 'Golden Reef & River Fish', domain: 'water', nativeBiomes: [0, 1, 3, 9, 10, 11, 16], eyeOffset: [0, 0.06, 0.22], followDist: 2.4, baseSpeed: 6.5, cruiseSpeed: 2.4 });

  const butterflies = [];
  for (let i = 0; i < 80; i++) {
    const cx = rr(-95, 95), cz = rr(-95, 95);
    terrainAt(cx, cz, t);
    butterflies.push({ type: 'fly', cx, cz, y: max(0.9, t.h + rr(0.9, 3.4)), rad: rr(4, 14), speed: rr(1.8, 3.2), phase: rr(0, TAU), scale: rr(0.9, 1.40), animSpeed: 2.2, mode: 2 });
  }
  addCohort('butterflies', buildButterflyInsectMesh([0.16, 0.62, 0.88], [0.88, 0.60, 0.14], false), butterflies, 18, 4, { label: 'Blue Morpho Butterfly', domain: 'air', nativeBiomes: [0, 2, 4, 5, 7], cruiseSpeed: 2.4 });

  const dragonflies = [];
  for (let i = 0; i < 32; i++) {
    dragonflies.push({ type: 'fly', cx: rr(-75, 75), cz: rr(-55, 55), y: rr(0.45, 1.8), rad: rr(5, 14), speed: rr(2.4, 4.2), phase: rr(0, TAU), scale: rr(0.95, 1.35), animSpeed: 3.0, mode: 2 });
  }
  addCohort('dragonflies', buildButterflyInsectMesh([0.22, 0.68, 0.64], [0.76, 0.84, 0.88], true), dragonflies, 19, 4, { label: 'Emerald Dragonfly', domain: 'air', nativeBiomes: [0, 1, 3, 16], cruiseSpeed: 3.2 });

  const beetles = [];
  for (let i = 0; i < 24; i++) {
    const cx = rr(-70, 70), cz = rr(-70, 70);
    terrainAt(cx, cz, t);
    beetles.push({ type: 'walk', cx, cz, rad: rr(2, 6), speed: rr(0.25, 0.55), phase: rr(0, TAU), scale: rr(0.9, 1.3), animSpeed: 1.5, mode: 0 });
  }
  addCohort('beetles', buildBeetleMesh(), beetles, 19, 3, { label: 'Hercules Rhinoceros Beetle', domain: 'land', nativeBiomes: [0, 2, 5, 7], cruiseSpeed: 0.4 });

  const lookdevRig = {
    sphereMesh: buildLookdevMesh(),
    swatchMesh: buildSwatchBarMesh(),
    instData: new Float32Array(3 * ANIMAL_INST_FLOATS)
  };

  // Relocate native & non-native cohorts cleanly onto valid local terrain/water when changing regions
  // When shiftMeters = { dx, dz } is supplied (continuous walking/flying rebase), preserve nearby animal positions seamlessly!
  function syncRegion(biomeId = 0, seedOffset = 0, shiftMeters = null) {
    populateRegionFlora(biomeId, seedOffset);
    seedRng(WORLD_SEED + biomeId * 4129 + seedOffset * 71);
    const st = {};
    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      const isNative = grp.nativeBiomes.includes(biomeId);
      for (let i = 0; i < grp.items.length; i++) {
        const it = grp.items[i];
        if (it.playerControlled) continue;
        if (!isNative) {
          // Park non-native cohorts out of local regional view so each continent displays authentic native fauna
          it.x = it.prevX = it.homeX = 2400 + g * 18;
          it.z = it.prevZ = it.homeZ = 2400 + i * 6;
          it.y = it.prevY = grp.domain === 'water' ? -12 : 0;
          it.inactiveInRegion = true;
          continue;
        }
        // Continuous floating-origin shift: keep nearby visible animals locked in place on Earth (zero pop!)
        if (shiftMeters && !it.inactiveInRegion) {
          const sx = it.x - shiftMeters.dx;
          const sz = it.z - shiftMeters.dz;
          if (hypot(sx, sz) < 285) {
            it.x = sx;
            it.prevX -= shiftMeters.dx;
            it.homeX -= shiftMeters.dx;
            it.goalX -= shiftMeters.dx;
            it.z = sz;
            it.prevZ -= shiftMeters.dz;
            it.homeZ -= shiftMeters.dz;
            it.goalZ -= shiftMeters.dz;
            continue;
          }
        }
        it.inactiveInRegion = false;
        let placed = false;
        for (let tries = 0; tries < 22; tries++) {
          const rMax = grp.domain === 'water' ? 145 : 135;
          const px = shiftMeters ? rr(120, 265) * (rnd() < 0.5 ? 1 : -1) : rr(-rMax, rMax);
          const pz = shiftMeters ? rr(120, 265) * (rnd() < 0.5 ? 1 : -1) : rr(-rMax, rMax);
          terrainAt(px, pz, st);
          if (grp.domain === 'water') {
            const minNeed = (grp.speciesId === 31 || grp.speciesId === 32) ? -4.5 : grp.speciesId === 33 ? -3.2 : -0.6;
            if (st.h <= minNeed) {
              const py = clamp(lerp(st.h + 1.4, -1.6, 0.55), st.h + 1.0, grp.speciesId === 33 ? -1.8 : -0.25);
              it.x = it.prevX = it.homeX = px;
              it.z = it.prevZ = it.homeZ = pz;
              it.y = it.prevY = it.baseY = py;
              placed = true;
              break;
            }
          } else if (grp.domain === 'air') {
            it.x = it.prevX = it.homeX = px;
            it.z = it.prevZ = it.homeZ = pz;
            it.y = it.prevY = it.baseY = max(st.h + rr(5, 28), rr(6, 30));
            placed = true;
            break;
          } else {
            if (st.h >= -0.05 && st.h < 65) {
              it.x = it.prevX = it.homeX = px;
              it.z = it.prevZ = it.homeZ = pz;
              it.y = it.prevY = it.baseY = st.h;
              placed = true;
              break;
            }
          }
        }
        if (!placed) {
          terrainAt(0, 0, st);
          it.x = it.prevX = it.homeX = rr(-45, 45);
          it.z = it.prevZ = it.homeZ = rr(-45, 45);
          terrainAt(it.x, it.z, st);
          it.y = it.prevY = it.baseY = grp.domain === 'water' ? min(-2.5, st.h + 1.5) : grp.domain === 'air' ? max(12, st.h + 12) : max(0, st.h);
        }
        it.goalX = it.homeX + rr(-it.wanderRad, it.wanderRad);
        it.goalZ = it.homeZ + rr(-it.wanderRad, it.wanderRad);
        it.goalY = it.baseY;
        it.breachState = 'cruise';
        it.breachTimer = 0;
        it.pitch = it.prevPitch = 0;
        it.roll = it.prevRoll = 0;
      }
    }
  }

  // Initial startup placement for River Sanctuary (biomeId = 0)
  syncRegion(0, 0);

  // ==========================================================================
  // Partitioned GPU Particles: [base + breach splashes] -> [bubbles] -> [rain]
  // ==========================================================================
  const MAX_PARTICLES = MAX_PARTICLES_BUDGET;
  const particles = new Float32Array(MAX_PARTICLES * 8);
  const particleState = [];
  const baseCount = Math.floor(MAX_PARTICLES * 0.72);
  const splashStart = Math.floor(baseCount * 0.84);
  const splashCount = baseCount - splashStart;
  const bubbleStart = baseCount;
  const bubbleCount = Math.floor(MAX_PARTICLES * 0.08);
  const rainStart = bubbleStart + bubbleCount;
  const rainCount = MAX_PARTICLES - rainStart;
  const particleRanges = { baseCount, splashStart, splashCount, bubbleStart, bubbleCount, rainStart, rainCount };

  for (let i = 0; i < MAX_PARTICLES; i++) {
    let kind = 3, x = 0, y = 0, z = 0, size = 0.2, r = 0.5, g = 0.7, b = 0.3, vx = 0, vy = 0, vz = 0, life = rnd();
    if (i < splashStart) {
      const f = i / splashStart;
      if (f < 0.14) {
        kind = 0; // Fire flames (active when near Burning Forest / Caldera)
        const a = rr(0, TAU), rad = rr(0, 26);
        x = cos(a) * rad; z = sin(a) * rad;
        terrainAt(x, z, t);
        y = t.h + 0.5; size = rr(1.1, 2.5); r = 1; g = 0.5; b = 0.1; vy = rr(1.8, 3.8);
      } else if (f < 0.30) {
        kind = 1; // Smoke / volcanic plume
        const a = rr(0, TAU), rad = rr(0, 34);
        x = cos(a) * rad; z = sin(a) * rad;
        terrainAt(x, z, t);
        y = t.h + rr(2, 32); size = rr(3.5, 8.2); r = 0.85; g = 0.45; b = 0.08;
        vx = rr(-0.6, -0.2); vy = rr(1.6, 3.2); vz = rr(-0.4, 0.2);
      } else if (f < 0.48) {
        kind = 2; // Bioluminescent fireflies / embers
        x = rr(-75, 75); z = rr(-75, 75);
        terrainAt(x, z, t);
        y = max(0.5, t.h + rr(0.6, 6.0)); size = rr(0.10, 0.22); r = 0.25; g = 0.98; b = 0.72; vy = rr(-0.15, 0.15);
      } else if (f < 0.78) {
        kind = 3; // Drifting leaves / petals
        x = rr(-140, 140); z = rr(-140, 140);
        terrainAt(x, z, t);
        y = max(1, t.h + rr(1, 24)); size = rr(0.10, 0.20);
        const isPetal = i % 7 === 0;
        r = isPetal ? rr(0.82, 0.92) : rr(0.42, 0.78);
        g = isPetal ? rr(0.45, 0.66) : rr(0.60, 0.85);
        b = isPetal ? rr(0.60, 0.78) : rr(0.20, 0.38);
        vy = rr(-0.55, -0.15);
      } else {
        kind = 5; // Atmospheric pollen / Underwater marine snow
        x = rr(-36, 36); y = rr(-8, 16); z = rr(-36, 36);
        size = rr(0.055, 0.13); r = 0.90; g = 0.88; b = 0.72; vy = rr(-0.08, 0.12);
      }
    } else if (i < baseCount) {
      kind = 7; // Dynamic whale breach splash & spray droplets (inactive until spawned)
      x = 0; y = -999; z = 0; size = 0; r = 0.88; g = 0.95; b = 1.0; life = 0;
    } else if (i < rainStart) {
      kind = 6; // Underwater rising hydrothermal & reef bubbles (Abyssal Garden)
      x = rr(-24, 24); y = rr(-14.0, -0.2); z = rr(-24, 24);
      size = rr(0.035, 0.085); r = 0.8; g = 0.94; b = 0.96; vy = rr(0.55, 1.35);
    } else {
      kind = 4; // Rain / Polar blizzard snow streaks
      const layer = (i - rainStart) % 3;
      const span = layer === 0 ? 5.5 : layer === 1 ? 16 : 34;
      x = rr(-span, span); y = rr(-6, 26); z = rr(-span, span);
      size = layer === 0 ? rr(0.06, 0.10) : rr(0.08, 0.14);
      r = 0.78; g = 0.86; b = 0.92; vy = -21;
    }
    particleState.push({ kind, bx: x, by: y, bz: z, x, y, z, vx, vy, vz, size, r, g, b, life, maxLife: 1.8, phase: rr(0, TAU) });
  }

  let splashCursor = splashStart;
  function spawnBreachSplash(wx, wy, wz, count = 48, power = 1.0) {
    for (let k = 0; k < count; k++) {
      const p = particleState[splashCursor];
      splashCursor = splashStart + ((splashCursor - splashStart + 1) % max(1, splashCount));
      const a = rr(0, TAU);
      const radSpd = rr(1.5, 7.5) * power;
      p.x = wx + cos(a) * rr(0.3, 2.2) * power;
      p.y = max(0.05, wy);
      p.z = wz + sin(a) * rr(0.3, 2.2) * power;
      p.vx = cos(a) * radSpd;
      p.vy = rr(4.5, 11.8) * power;
      p.vz = sin(a) * radSpd;
      p.size = rr(0.38, 1.35) * power;
      p.r = 0.86; p.g = 0.95; p.b = 1.0;
      p.life = 1.0;
      p.maxLife = rr(1.1, 2.2);
    }
  }

  const _anCol = {};
  const _ikOutF = {};
  const _ikOutH = {};
  const _hazardOut = {};
  const _tFront = {};
  const _tRear = {};

  // ==========================================================================
  // Fixed-Rate (120 Hz) Ecological Survival FSM + Event-Driven Breaching + IK
  // ==========================================================================
  let simTime = 0;
  let simTick = 0;
  let hazardAvoidanceEnabled = true;
  let activeSurvivalEvent = 'Herds foraging and patrolling across living continents';
  let marineEventCb = null;

  const predatorGroups = wildlifeGroups.filter((g) => g.role === 'predator');
  const preyGroups = wildlifeGroups.filter((g) => g.role === 'herbivore' && g.items.length > 0);
  const QUADRUPED_SPECIES = new Set([0, 1, 2, 3, 4, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 35, 36, 37, 38, 39]);

  const EMOTION_NAMES = [
    'Calm · Grazing & Breathing',
    'Curious · Social Head-Tilt',
    'Alert · Horizon Vigilance',
    'Dominant · Vocalizing / Stalking',
    'Startled · Evading Threat'
  ];

  function emitMarineEvent(type, x, y, z, power = 1.0) {
    if (marineEventCb) marineEventCb({ type, x, y, z, power });
  }

  function triggerWhaleBreach(groupName = 'whales', itemIdx = 0) {
    const grp = wildlifeGroups.find((g) => g.name === groupName && (g.speciesId === 31 || g.speciesId === 32));
    if (!grp || grp.items.length === 0) return false;
    const it = grp.items[clamp(itemIdx, 0, grp.items.length - 1)];
    if (!it || it.playerControlled || !it.canBreach || it.inactiveInRegion) return false;
    if (it.breachState !== 'cruise') return false;
    terrainAt(it.x, it.z, t);
    if (t.h > -4.5) return false; // Need deep water to breach safely
    it.breachState = 'approach';
    it.breachTimer = 0;
    it.breachRollDir = (rnd() < 0.5 ? -1 : 1);
    it.breachPeakVy = grp.speciesId === 31 ? rr(9.6, 12.2) : rr(10.2, 13.0);
    it.emotion = 3;
    activeSurvivalEvent = `${grp.label} initiating deep-water breach ascent`;
    return true;
  }

  function pickOrganicGoal(it, grp) {
    const st = {};
    const rad = it.wanderRad || 28;
    for (let a = 0; a < 8; a++) {
      const ang = rr(0, TAU);
      const r = rr(rad * 0.25, rad);
      const gx = clamp(it.homeX + cos(ang) * r, -REGION_HALF + 20, REGION_HALF - 20);
      const gz = clamp(it.homeZ + sin(ang) * r, -REGION_HALF + 20, REGION_HALF - 20);
      terrainAt(gx, gz, st);
      if (grp.domain === 'water') {
        const minDepth = grp.speciesId === 31 ? -6.5 : grp.speciesId === 32 || grp.speciesId === 33 ? -4.5 : -1.8;
        if (st.h < minDepth) {
          it.goalX = gx;
          it.goalZ = gz;
          it.goalY = clamp(rr(max(st.h + 1.5, -18), grp.speciesId === 33 ? -1.8 : -1.2), -22, -0.5);
          it.goalTimer = rr(5.5, 13.5);
          return;
        }
      } else if (grp.domain === 'land') {
        if (st.h > 0.25) {
          it.goalX = gx;
          it.goalZ = gz;
          it.goalY = st.h;
          it.goalTimer = rr(4.5, 11.5);
          return;
        }
      } else {
        it.goalX = gx;
        it.goalZ = gz;
        it.goalY = max(st.h + 6.0, it.baseY + rr(-4.5, 6.0));
        it.goalTimer = rr(4.0, 9.5);
        return;
      }
    }
    it.goalX = it.homeX;
    it.goalZ = it.homeZ;
    it.goalTimer = rr(4.0, 8.0);
  }

  function stepWhaleBreachFSM(it, grp, dt) {
    terrainAt(it.x, it.z, t);
    const seabed = t.h;
    const isHumpback = grp.speciesId === 31;
    const cruiseDepth = isHumpback ? clamp(seabed * 0.45, -14.0, -4.8) : clamp(seabed * 0.35, -9.5, -3.2);
    const [fx, fz] = yawToForward(it.yaw);
    it.breachTimer += dt;

    if (it.breachState === 'approach') {
      // Dive slightly deeper & align forward in deep water
      const targetY = max(seabed + 2.8, isHumpback ? -11.5 : -8.5);
      it.y = lerp(it.y, targetY, min(1, dt * 1.4));
      it.curSpeed = lerp(it.curSpeed, it.cruiseSpeed * 1.25, min(1, dt * 2.0));
      it.x += fx * it.curSpeed * dt;
      it.z += fz * it.curSpeed * dt;
      it.pitch = lerp(it.pitch, -0.18, min(1, dt * 2.2));
      it.roll = lerp(it.roll, 0, min(1, dt * 2.5));
      if (it.breachTimer > 1.8 || it.y <= targetY + 0.6) {
        it.breachState = 'pitch_up';
        it.breachTimer = 0;
      }
    } else if (it.breachState === 'pitch_up') {
      // Angle snout strongly upward (~46 deg)
      it.curSpeed = lerp(it.curSpeed, it.maxSpeed * 0.9, min(1, dt * 2.5));
      it.pitch = lerp(it.pitch, 0.78, min(1, dt * 2.8));
      it.x += fx * it.curSpeed * cos(it.pitch) * dt;
      it.z += fz * it.curSpeed * cos(it.pitch) * dt;
      it.y += it.curSpeed * sin(it.pitch) * dt;
      if (it.breachTimer > 0.95) {
        it.breachState = 'accelerate';
        it.breachTimer = 0;
      }
    } else if (it.breachState === 'accelerate') {
      // Powerful fluke-driven surge toward ocean surface
      it.curSpeed = lerp(it.curSpeed, it.maxSpeed * 1.45, min(1, dt * 4.0));
      it.pitch = lerp(it.pitch, 0.92, min(1, dt * 3.0));
      it.x += fx * it.curSpeed * cos(it.pitch) * dt;
      it.z += fz * it.curSpeed * cos(it.pitch) * dt;
      it.y += it.curSpeed * sin(it.pitch) * dt;
      if (it.y >= -0.35) {
        it.breachState = 'launch';
        it.breachTimer = 0;
        it.vy = it.breachPeakVy || (isHumpback ? 10.6 : 11.4);
        it.vx = fx * it.curSpeed * 0.62;
        it.vz = fz * it.curSpeed * 0.62;
        spawnBreachSplash(it.x, 0.12, it.z, isHumpback ? 42 : 30, isHumpback ? 1.15 : 0.85);
        emitMarineEvent('breach_launch', it.x, 0.2, it.z, isHumpback ? 1.0 : 0.75);
        activeSurvivalEvent = `${grp.label} breaching clear of the ocean surface!`;
      }
    } else if (it.breachState === 'launch') {
      // Brief surface exit transition into ballistic arc
      it.vy -= 9.81 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      it.pitch = clamp(atan2(it.vy, max(1.0, hypot(it.vx, it.vz))), -1.1, 1.15);
      it.roll += it.breachRollDir * 1.15 * dt;
      if (it.breachTimer > 0.22) {
        it.breachState = 'ballistic';
        it.breachTimer = 0;
      }
    } else if (it.breachState === 'ballistic') {
      // True ballistic free-fall gravity & dramatic mid-air twist/roll
      it.vy -= 9.81 * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      it.pitch = clamp(atan2(it.vy, max(1.0, hypot(it.vx, it.vz))), -1.15, 1.15);
      it.roll = clamp(it.roll + it.breachRollDir * 1.65 * dt, -2.35, 2.35);
      if (it.y <= 0.15 && it.vy < 0) {
        it.breachState = 'impact';
        it.breachTimer = 0;
        const impactPower = clamp(abs(it.vy) / 9.5, 0.65, 1.65) * (isHumpback ? 1.25 : 0.9);
        spawnBreachSplash(it.x, 0.15, it.z, isHumpback ? 68 : 48, impactPower);
        emitMarineEvent('breach_impact', it.x, 0.0, it.z, impactPower);
      }
    } else if (it.breachState === 'impact') {
      // Hydrodynamic splashdown deceleration
      it.vx *= max(0, 1 - dt * 3.2);
      it.vz *= max(0, 1 - dt * 3.2);
      it.vy = lerp(it.vy, -2.6, min(1, dt * 4.5));
      it.x += it.vx * dt;
      it.y = max(seabed + 1.8, it.y + it.vy * dt);
      it.z += it.vz * dt;
      it.pitch = lerp(it.pitch, -0.42, min(1, dt * 3.0));
      it.roll = lerp(it.roll, it.breachRollDir * 0.9, min(1, dt * 2.5));
      if (it.breachTimer > 0.85) {
        it.breachState = 'recovery';
        it.breachTimer = 0;
      }
    } else if (it.breachState === 'recovery') {
      // Righting body upright underwater
      it.curSpeed = lerp(it.curSpeed, it.cruiseSpeed * 0.85, min(1, dt * 2.0));
      it.x += fx * it.curSpeed * dt;
      it.z += fz * it.curSpeed * dt;
      it.y = lerp(it.y, max(seabed + 2.2, cruiseDepth), min(1, dt * 1.1));
      it.pitch = lerp(it.pitch, -0.1, min(1, dt * 2.4));
      it.roll = lerp(it.roll, 0, min(1, dt * 2.4));
      if (it.breachTimer > 2.2) {
        it.breachState = 'dive_return';
        it.breachTimer = 0;
      }
    } else if (it.breachState === 'dive_return') {
      it.curSpeed = lerp(it.curSpeed, it.cruiseSpeed, min(1, dt * 1.8));
      it.x += fx * it.curSpeed * dt;
      it.z += fz * it.curSpeed * dt;
      it.y = lerp(it.y, cruiseDepth, min(1, dt * 1.6));
      it.pitch = lerp(it.pitch, 0, min(1, dt * 2.5));
      it.roll = lerp(it.roll, 0, min(1, dt * 3.0));
      if (it.breachTimer > 2.4 || abs(it.y - cruiseDepth) < 0.6) {
        it.breachState = 'cruise';
        it.breachTimer = 0;
        it.breachCooldown = isHumpback ? rr(28.0, 56.0) : rr(22.0, 44.0);
        it.emotion = 0;
      }
    }
    it.phase = (it.phase + dt * (it.breachState === 'accelerate' ? 4.2 : 1.6)) % TAU;
  }

  function stepSim(dt, camX, camY, camZ, rainIntensity, windStrength = 0.45) {
    simTime += dt;
    simTick++;

    // Real nearest-prey scanning across ALL prey individuals (never hardcoded items[0]!)
    const scanIdx = simTick % max(1, predatorGroups.length);
    const predGrp = predatorGroups[scanIdx];
    if (predGrp && predGrp.items.length > 0) {
      const pItem = predGrp.items[(simTick >> 3) % predGrp.items.length];
      if (!pItem.playerControlled && !pItem.inactiveInRegion) {
        let bestPrey = null, bestPreyGrp = null, bestD = 75.0;
        for (let pg = 0; pg < preyGroups.length; pg++) {
          const preyGrp = preyGroups[pg];
          if (preyGrp.domain !== predGrp.domain && predGrp.name !== 'orcas') continue;
          const pItems = preyGrp.items;
          for (let pi = 0; pi < pItems.length; pi++) {
            const pr = pItems[pi];
            if (pr.inactiveInRegion) continue;
            const d = hypot(pItem.x - pr.x, pItem.z - pr.z);
            if (d < bestD) {
              bestD = d;
              bestPrey = pr;
              bestPreyGrp = preyGrp;
            }
          }
        }
        if (bestPrey && bestPreyGrp) {
          pItem.state = bestD < 28 ? 'chase' : 'stalk';
          pItem.emotion = 3;
          pItem.goalX = bestPrey.x;
          pItem.goalZ = bestPrey.z;
          pItem.goalTimer = 2.0;
          const awayX = bestPrey.x - pItem.x;
          const awayZ = bestPrey.z - pItem.z;
          const awayLen = max(0.01, hypot(awayX, awayZ));
          bestPrey.state = 'flee';
          bestPrey.emotion = 4;
          bestPrey.fleeTimer = 3.8;
          bestPrey.goalX = clamp(bestPrey.x + (awayX / awayLen) * 38, -REGION_HALF + 20, REGION_HALF - 20);
          bestPrey.goalZ = clamp(bestPrey.z + (awayZ / awayLen) * 38, -REGION_HALF + 20, REGION_HALF - 20);
          bestPrey.goalTimer = 3.2;
          activeSurvivalEvent = `${predGrp.label} ${pItem.state === 'chase' ? 'pursuing' : 'stalking'} ${bestPreyGrp.label}`;
        }
      }
    }

    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      const items = grp.items;
      const isFishSchool = grp.name === 'fish';
      const isQuadruped = QUADRUPED_SPECIES.has(grp.speciesId);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.prevX = it.x;
        it.prevY = it.y;
        it.prevZ = it.z;
        it.prevYaw = it.yaw;
        it.prevPitch = it.pitch;
        it.prevRoll = it.roll;

        if (it.inactiveInRegion) continue;

        if (it.roarTimer > 0) {
          it.roarTimer = max(0, it.roarTimer - dt);
          it.emotion = 3;
        }
        if (it.playerControlled) continue;

        // Distance-LOD AI throttling: far animals update steering every 4th tick while integrating smoothly
        const dCam = hypot(it.x - camX, it.z - camZ);
        const aiUpdate = (dCam < 95) || (((simTick + it.aiTickOffset) & 3) === 0);

        // Ambient marine vocalization / surfacing breath spatial audio triggers
        if (grp.domain === 'water' && (grp.speciesId === 31 || grp.speciesId === 32) && dCam < 220) {
          it.vocalTimer = (it.vocalTimer ?? rr(6, 18)) - dt;
          if (it.vocalTimer <= 0) {
            it.vocalTimer = grp.speciesId === 31 ? rr(12, 26) : rr(8, 19);
            emitMarineEvent(grp.speciesId === 31 ? 'whale_song' : 'orca_call', it.x, it.y, it.z, 1.0);
          }
        }

        // Dynamic emotional state machine
        it.emotionTimer -= dt;
        if (it.roarTimer <= 0 && aiUpdate) {
          if (it.state === 'flee') {
            it.emotion = 4;
          } else if (it.state === 'chase' || it.state === 'stalk') {
            it.emotion = 3;
          } else if (dCam < it.flightDist * 1.45) {
            it.emotion = (i % 2 === 0) ? 2 : 1;
          } else if (it.emotionTimer <= 0) {
            it.emotionTimer = rr(3.5, 9.5);
            const r = rnd();
            if (grp.role === 'predator' || grp.speciesId === 26 || grp.speciesId === 28) {
              it.emotion = r < 0.42 ? 0 : r < 0.68 ? 2 : r < 0.86 ? 3 : 1;
            } else {
              it.emotion = r < 0.52 ? 0 : r < 0.78 ? 1 : 2;
            }
          }
        }

        if (it.type === 'walk') {
          if (dCam < it.flightDist && it.flightDist >= 10 && grp.role !== 'predator') {
            it.state = 'flee';
            it.emotion = 4;
            it.fleeTimer = 2.4;
            const ax = it.x - camX, az = it.z - camZ;
            const al = max(0.01, hypot(ax, az));
            it.goalX = clamp(it.x + (ax / al) * 28, -REGION_HALF + 18, REGION_HALF - 18);
            it.goalZ = clamp(it.z + (az / al) * 28, -REGION_HALF + 18, REGION_HALF - 18);
          } else if (it.fleeTimer > 0) {
            it.fleeTimer -= dt;
            if (it.fleeTimer <= 0) it.state = 'forage';
          }

          if (it.restTimer > 0 && it.state !== 'flee' && it.state !== 'chase') {
            it.restTimer -= dt;
            it.curSpeed = lerp(it.curSpeed, 0.0, min(1, dt * 6.0));
          } else {
            it.goalTimer -= dt;
            const dGoal = hypot(it.goalX - it.x, it.goalZ - it.z);
            if (aiUpdate && (it.goalTimer <= 0 || dGoal < 2.2)) {
              if (it.state !== 'flee' && it.state !== 'chase' && rnd() < 0.34) {
                it.restTimer = rr(2.2, 6.2); // Natural grazing / resting pause
                it.state = 'graze';
              } else {
                it.state = 'forage';
                pickOrganicGoal(it, grp);
              }
            }

            let wantSpd = it.cruiseSpeed;
            if (it.state === 'flee' || it.state === 'chase') wantSpd = it.maxSpeed;
            else if (it.state === 'stalk') wantSpd = it.cruiseSpeed * 0.52;
            else if (rainIntensity > 0.65) wantSpd *= 0.72;
            it.curSpeed = lerp(it.curSpeed, wantSpd, min(1, dt * 4.0));
          }

          let steerX = it.goalX - it.x;
          let steerZ = it.goalZ - it.z;
          const sLen = hypot(steerX, steerZ);
          if (sLen > 0.05) { steerX /= sLen; steerZ /= sLen; }

          if (hazardAvoidanceEnabled && aiUpdate) {
            evaluateHazardAt(it.x + steerX * 4.0, it.z + steerZ * 4.0, 0, _hazardOut);
            if (_hazardOut.hazard > 0.16) {
              steerX -= _hazardOut.gradX * _hazardOut.hazard * 2.8;
              steerZ -= _hazardOut.gradZ * _hazardOut.hazard * 2.8;
              if (_hazardOut.hazard > 0.55) pickOrganicGoal(it, grp);
            }
          }

          const prevYaw = it.yaw;
          if (it.curSpeed > 0.08 && (abs(steerX) + abs(steerZ)) > 0.01) {
            const targetYaw = velocityToYaw(steerX, steerZ, it.yaw);
            it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * it.turnRate * 2.2));
          }
          const yawDelta = normAngle(it.yaw - prevYaw);
          it.roll = lerp(it.roll, clamp(-yawDelta * 8.5, -0.16, 0.16), min(1, dt * 6.0));

          const [fx, fz] = yawToForward(it.yaw);
          const nx = clamp(it.x + fx * it.curSpeed * dt, -REGION_HALF + 12, REGION_HALF - 12);
          const nz = clamp(it.z + fz * it.curSpeed * dt, -REGION_HALF + 12, REGION_HALF - 12);
          terrainAt(nx, nz, t);
          const colR = clamp(0.45 * it.scale, 0.18, 0.95);
          resolveWorldCollision(nx, max(-0.1, t.h) + 0.25, nz, colR, 0, 0, _anCol, 0.0);
          it.x = _anCol.x;
          it.z = _anCol.z;
          terrainAt(it.x, it.z, t);
          it.y = t.h;

          const mvx = it.x - it.prevX, mvz = it.z - it.prevZ;
          const stepDist = hypot(mvx, mvz);
          it.vx = mvx / max(1e-5, dt);
          it.vz = mvz / max(1e-5, dt);
          it.phase = (it.phase + (stepDist / max(0.18, it.strideLen)) * 1.15) % TAU;

          // Real CPU 2-Bone Analytical IK & Terrain Slope Alignment
          const halfBody = clamp(0.55 * it.scale, 0.22, 1.85);
          terrainAt(it.x + fx * halfBody, it.z + fz * halfBody, _tFront);
          terrainAt(it.x - fx * halfBody, it.z - fz * halfBody, _tRear);
          const slopePitch = clamp(atan2(_tFront.h - _tRear.h, max(0.25, halfBody * 2.0)), -0.45, 0.45);
          it.pitch = lerp(it.pitch, slopePitch, min(1, dt * 10.0));

          if (isQuadruped) {
            const legSeg = 0.38 * it.scale;
            const speedNorm = clamp(it.curSpeed / max(0.4, it.maxSpeed), 0, 1);
            const swingF = max(0, sin(it.phase)) * legSeg * 0.62 * speedNorm;
            const swingH = max(0, sin(it.phase + 2.35)) * legSeg * 0.62 * speedNorm;
            const hipH = legSeg * 1.92;
            const footFY = _tFront.h + swingF;
            const footHY = _tRear.h + swingH;
            solveTwoBoneIK(
              it.x + fx * halfBody, it.y + hipH + sin(it.pitch) * halfBody, it.z + fz * halfBody,
              it.x + fx * halfBody, footFY, it.z + fz * halfBody,
              fx, 0, fz, legSeg, legSeg, _ikOutF
            );
            solveTwoBoneIK(
              it.x - fx * halfBody, it.y + hipH - sin(it.pitch) * halfBody, it.z - fz * halfBody,
              it.x - fx * halfBody, footHY, it.z - fz * halfBody,
              -fx, 0, -fz, legSeg, legSeg, _ikOutH
            );
            // Convert actual 2-bone IK reach compression into normalized joint bend [0..1]
            const reachF = clamp(abs((it.y + hipH + sin(it.pitch) * halfBody) - footFY) / max(0.01, legSeg * 2.0), 0.25, 1.0);
            const reachH = clamp(abs((it.y + hipH - sin(it.pitch) * halfBody) - footHY) / max(0.01, legSeg * 2.0), 0.25, 1.0);
            it.ikFrontFlex = clamp(Math.acos(reachF) / 1.25, 0.04, 1.0);
            it.ikHindFlex = clamp(Math.acos(reachH) / 1.25, 0.04, 1.0);
          } else {
            it.ikFrontFlex = 0.08;
            it.ikHindFlex = 0.08;
          }
        } else if (it.type === 'swim') {
          // Event-Driven Whale & Orca Breaching FSM (STRICTLY never sharks!)
          if (it.canBreach && (grp.speciesId === 31 || grp.speciesId === 32)) {
            if (it.breachState !== 'cruise') {
              stepWhaleBreachFSM(it, grp, dt);
              continue;
            }
            it.breachCooldown = max(0, (it.breachCooldown ?? 18) - dt);
            if (it.breachCooldown <= 0 && dCam < 260 && aiUpdate) {
              terrainAt(it.x, it.z, t);
              if (t.h < -5.2 && rnd() < 0.06) {
                triggerWhaleBreach(grp.name, i);
                stepWhaleBreachFSM(it, grp, dt);
                continue;
              } else {
                it.breachCooldown = rr(6.0, 14.0);
              }
            }
          }

          it.goalTimer -= dt;
          const dGoal = hypot(it.goalX - it.x, it.goalZ - it.z);
          if (aiUpdate && (it.goalTimer <= 0 || dGoal < 3.5)) {
            pickOrganicGoal(it, grp);
          }

          let wantSpd = it.cruiseSpeed * (dCam < it.flightDist ? 1.55 : 1.0);
          if (it.state === 'chase' || it.state === 'flee') wantSpd = it.maxSpeed;
          it.curSpeed = lerp(it.curSpeed, wantSpd, min(1, dt * 3.0));

          let steerX = it.goalX - it.x;
          let steerZ = it.goalZ - it.z;
          const sLen = hypot(steerX, steerZ);
          if (sLen > 0.05) { steerX /= sLen; steerZ /= sLen; }

          // 3D Boids schooling for fish
          if (isFishSchool && aiUpdate) {
            const schoolStart = (i / 14 | 0) * 14;
            const schoolEnd = min(items.length, schoolStart + 14);
            let sepX = 0, sepY = 0, sepZ = 0, cohX = 0, cohY = 0, cohZ = 0, neighbors = 0;
            for (let j = schoolStart; j < schoolEnd; j++) {
              if (j === i) continue;
              const nb = items[j];
              const dx = it.x - nb.x, dy = it.y - nb.y, dz = it.z - nb.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < 25.0 && d2 > 1e-6) {
                const d = sqrt(d2);
                if (d < 1.35) {
                  const rep = (1.35 - d) / d;
                  sepX += dx * rep; sepY += dy * rep; sepZ += dz * rep;
                }
                cohX += nb.x; cohY += nb.y; cohZ += nb.z;
                neighbors++;
              }
            }
            if (neighbors > 0) {
              const invN = 1 / neighbors;
              it.boidsX = clamp(lerp(it.boidsX, sepX * 0.9 + (cohX * invN - it.x) * 0.25, dt * 4.0), -2.2, 2.2);
              it.boidsY = clamp(lerp(it.boidsY, sepY * 0.45 + (cohY * invN - it.y) * 0.25, dt * 3.0), -0.8, 0.8);
              it.boidsZ = clamp(lerp(it.boidsZ, sepZ * 0.9 + (cohZ * invN - it.z) * 0.25, dt * 4.0), -2.2, 2.2);
              steerX += it.boidsX * 0.45;
              steerZ += it.boidsZ * 0.45;
            }
          }

          // Marine shallow-water stranding avoidance (marine domain = 1 ignores fire/lava!)
          if (hazardAvoidanceEnabled && aiUpdate) {
            evaluateHazardAt(it.x + steerX * 6.0, it.z + steerZ * 6.0, 1, _hazardOut);
            if (_hazardOut.hazard > 0.20) {
              steerX -= _hazardOut.gradX * _hazardOut.hazard * 3.0;
              steerZ -= _hazardOut.gradZ * _hazardOut.hazard * 3.0;
            }
          }

          const prevYaw = it.yaw;
          if ((abs(steerX) + abs(steerZ)) > 0.01) {
            const targetYaw = velocityToYaw(steerX, steerZ, it.yaw);
            it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * it.turnRate * 2.0));
          }
          const yawDelta = normAngle(it.yaw - prevYaw);
          it.roll = lerp(it.roll, clamp(-yawDelta * 9.5, -0.32, 0.32), min(1, dt * 4.5));

          const [fx, fz] = yawToForward(it.yaw);
          const nx = clamp(it.x + fx * it.curSpeed * dt, -REGION_HALF + 14, REGION_HALF - 14);
          const nz = clamp(it.z + fz * it.curSpeed * dt, -REGION_HALF + 14, REGION_HALF - 14);
          resolveWorldCollision(nx, it.y + 0.15, nz, clamp(0.42 * it.scale, 0.16, 0.85), 0, 0, _anCol, -24.0);
          it.x = _anCol.x;
          it.z = _anCol.z;

          terrainAt(it.x, it.z, t);
          const seabed = t.h;
          const targetDepth = it.goalY + sin(simTime * 0.65 + it.phase) * 0.45 + (isFishSchool ? it.boidsY : 0);
          // STRICT SHARK UNDERWATER CLAMP: Great White Sharks NEVER breach or rise above -1.25 m!
          const maxSwimY = grp.speciesId === 33 ? -1.25 : grp.speciesId === 34 ? -0.9 : -0.35;
          const minSwimY = min(maxSwimY - 0.2, max(-24.0, seabed + (grp.speciesId === 31 ? 2.2 : 0.9)));
          const prevY = it.y;
          it.y = lerp(it.y, clamp(targetDepth, minSwimY, maxSwimY), min(1, dt * 1.4));
          it.y = clamp(it.y, minSwimY, maxSwimY);
          const dy = it.y - prevY;
          it.pitch = lerp(it.pitch, clamp(atan2(dy / max(1e-4, dt), max(0.6, it.curSpeed)), -0.45, 0.45), min(1, dt * 4.0));

          // Periodic calm whale surfacing breath (distinct from breaching!)
          if ((grp.speciesId === 31 || grp.speciesId === 32) && prevY < -0.65 && it.y >= -0.65) {
            emitMarineEvent('surfacing_breath', it.x, 0.1, it.z, 0.8);
          }

          const mvx = it.x - it.prevX, mvz = it.z - it.prevZ;
          const stepDist = hypot(mvx, mvz);
          it.vx = mvx / max(1e-5, dt);
          it.vz = mvz / max(1e-5, dt);
          it.phase = (it.phase + (stepDist / max(0.30, it.strideLen)) * 0.95) % TAU;
        } else if (it.type === 'fly') {
          it.goalTimer -= dt;
          const dGoal = hypot(it.goalX - it.x, it.goalZ - it.z);
          if (aiUpdate && (it.goalTimer <= 0 || dGoal < 4.0)) {
            pickOrganicGoal(it, grp);
          }
          const wantSpd = it.cruiseSpeed * (rainIntensity > 0.7 ? 0.75 : 1.0);
          it.curSpeed = lerp(it.curSpeed, wantSpd, min(1, dt * 3.0));
          const steerX = it.goalX - it.x, steerZ = it.goalZ - it.z;
          const prevYaw = it.yaw;
          if (hypot(steerX, steerZ) > 0.05) {
            const targetYaw = velocityToYaw(steerX, steerZ, it.yaw);
            it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * it.turnRate * 2.4));
          }
          const yawDelta = normAngle(it.yaw - prevYaw);
          it.roll = lerp(it.roll, clamp(-yawDelta * 14.0, -0.55, 0.55), min(1, dt * 6.0));
          const [fx, fz] = yawToForward(it.yaw);
          const nx = clamp(it.x + fx * it.curSpeed * dt, -REGION_HALF + 16, REGION_HALF - 16);
          const nz = clamp(it.z + fz * it.curSpeed * dt, -REGION_HALF + 16, REGION_HALF - 16);
          const ty = it.goalY + sin(simTime * 1.1 + it.phase) * 0.95;
          const prevY = it.y;
          resolveWorldCollision(nx, lerp(it.y, ty, min(1, dt * 1.5)), nz, 0.45, 0, 0, _anCol, 0.35);
          it.x = _anCol.x;
          it.y = _anCol.y;
          it.z = _anCol.z;
          it.pitch = lerp(it.pitch, clamp(atan2((it.y - prevY) / max(1e-4, dt), max(1.0, it.curSpeed)), -0.35, 0.35), min(1, dt * 4.5));
          it.vx = (it.x - it.prevX) / max(1e-5, dt);
          it.vz = (it.z - it.prevZ) / max(1e-5, dt);
        }
      }
    }

    const doRain = rainIntensity >= 0.02 && camY >= 0 && camY < 4500;
    const doBubbles = camY < 0.8;
    const hasFireBiome = activeRegionBiomeId === 9 || activeRegionBiomeId === 10;

    for (let i = 0; i < splashStart; i++) {
      const p = particleState[i];
      if (p.kind === 5) {
        p.x = camX + p.bx + sin(simTime * 0.55 + p.phase) * 2.2;
        p.y = camY + p.by + cos(simTime * 0.42 + p.phase) * 1.4;
        p.z = camZ + p.bz + sin(simTime * 0.48 + p.phase * 1.3) * 2.2;
      } else if (p.kind === 0 || p.kind === 1) {
        if (!hasFireBiome) { p.y = -999; continue; }
        p.life = (p.life + dt * (p.kind === 0 ? 0.85 : 0.14)) % 1;
        const hMax = p.kind === 0 ? 5.5 : 46.0;
        p.x = p.bx + sin(simTime * 1.8 + p.phase) * (p.kind === 0 ? 0.5 : p.life * 6.5) - (p.kind === 1 ? p.life * 8 * windStrength : 0);
        p.y = p.by + p.life * hMax;
        p.z = p.bz + cos(simTime * 1.5 + p.phase) * (p.kind === 0 ? 0.5 : p.life * 4.5);
      } else if (p.kind === 2) {
        p.life = (p.life + dt * 0.25) % 1;
        p.x = p.bx + sin(simTime * 1.7 + p.phase) * 1.8;
        p.y = p.by + (p.vy > 0 ? p.life * 14 : sin(simTime * 2.1 + p.phase) * 0.85);
        p.z = p.bz + cos(simTime * 1.4 + p.phase) * 1.8;
      } else {
        p.life = (p.life + dt * 0.08) % 1;
        p.x = p.bx + sin(simTime * 0.9 + p.phase) * 2.5 + sin(simTime * 2.3 + p.phase) * 0.45 * windStrength;
        p.y = p.by + (1 - p.life) * 14 - 4;
        p.z = p.bz + cos(simTime * 0.8 + p.phase) * 2.5;
      }
    }
    // Dynamic ballistic whale breach splash droplets (kind = 7)
    for (let i = splashStart; i < baseCount; i++) {
      const p = particleState[i];
      if (p.life > 0) {
        p.life = max(0, p.life - dt / max(0.3, p.maxLife));
        p.vy -= 9.81 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < -0.5) p.life = 0;
      } else {
        p.y = -999;
      }
    }
    if (doBubbles) {
      for (let i = bubbleStart; i < rainStart; i++) {
        const p = particleState[i];
        p.life = (p.life + dt * 0.35) % 1;
        p.x = camX + p.bx + sin(simTime * 2.1 + p.phase) * 0.18;
        p.y = min(-0.08, camY - 4.2 + p.life * 6.5);
        p.z = camZ + p.bz + cos(simTime * 1.9 + p.phase) * 0.18;
      }
    }
    if (doRain) {
      for (let i = rainStart; i < MAX_PARTICLES; i++) {
        const p = particleState[i];
        p.y -= 23 * dt;
        if (p.y < -6) p.y += 32;
        p.x = camX + p.bx;
        p.z = camZ + p.bz;
      }
    }
  }

  function interpolateSim(alpha, camY, rainIntensity) {
    const a = clamp(alpha, 0, 1);
    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      const items = grp.items;
      const out = grp.instData;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const o = i * ANIMAL_INST_FLOATS;
        if (it.inactiveInRegion) {
          out[o] = 0; out[o + 1] = -9999; out[o + 2] = 0; out[o + 3] = 0.0001;
          out[o + 4] = 0; out[o + 5] = 0; out[o + 6] = 0; out[o + 7] = it.packedMode;
          out[o + 8] = 0; out[o + 9] = 0; out[o + 10] = 0; out[o + 11] = 0;
          continue;
        }
        out[o]     = lerp(it.prevX, it.x, a);
        out[o + 1] = lerp(it.prevY, it.y, a);
        out[o + 2] = lerp(it.prevZ, it.z, a);
        out[o + 3] = it.scale;
        out[o + 4] = lerpAngle(it.prevYaw, it.yaw, a);
        out[o + 5] = it.phase;
        // Speed-coupled animation amplitude: zero gait wobble when grazing/resting!
        const speedRatio = it.type === 'walk'
          ? clamp(it.curSpeed / max(0.3, it.cruiseSpeed), 0.0, 2.2)
          : it.type === 'swim'
            ? clamp(it.curSpeed / max(0.5, it.cruiseSpeed), 0.25, 2.2)
            : 1.0;
        const effSpd = it.animSpeed * speedRatio;
        const emo = clamp(round(it.emotion || 0), 0, 4);
        out[o + 6] = emo + clamp(effSpd * 0.1, 0.01, 0.95);
        out[o + 7] = it.packedMode;
        out[o + 8] = lerp(it.prevPitch, it.pitch, a);
        out[o + 9] = lerp(it.prevRoll, it.roll, a);
        out[o + 10] = it.ikFrontFlex || 0;
        out[o + 11] = it.ikHindFlex || 0;
      }
    }

    for (let i = 0; i < baseCount; i++) {
      const p = particleState[i];
      const o = i * 8;
      particles[o]     = p.x;
      particles[o + 1] = p.y;
      particles[o + 2] = p.z;
      if (p.kind === 7) {
        particles[o + 3] = p.life > 0 ? p.size * (0.4 + p.life * 0.9) : 0;
      } else if (p.kind === 0 || p.kind === 1) {
        particles[o + 3] = p.y < -500 ? 0 : p.size * (p.kind === 0 ? (1 - p.life * 0.7) : (0.6 + p.life * 1.3));
      } else if (p.kind === 2) {
        const pulse = p.vy > 0 ? (1 - p.life * 0.5) : max(0.08, sin(simTime * 3.8 + p.phase));
        particles[o + 3] = p.size * pulse;
      } else {
        particles[o + 3] = p.size;
      }
      particles[o + 4] = p.r;
      particles[o + 5] = p.g;
      particles[o + 6] = p.b;
      particles[o + 7] = p.kind;
    }

    if (camY < 0.8) {
      for (let i = bubbleStart; i < rainStart; i++) {
        const p = particleState[i];
        const o = i * 8;
        particles[o] = p.x; particles[o + 1] = p.y; particles[o + 2] = p.z;
        particles[o + 3] = p.size;
        particles[o + 4] = p.r; particles[o + 5] = p.g; particles[o + 6] = p.b; particles[o + 7] = p.kind;
      }
    }

    if (rainIntensity >= 0.02 && camY >= 0 && camY < 4500) {
      for (let i = rainStart; i < MAX_PARTICLES; i++) {
        const p = particleState[i];
        const o = i * 8;
        particles[o] = p.x; particles[o + 1] = p.y; particles[o + 2] = p.z;
        particles[o + 3] = p.size;
        particles[o + 4] = p.r; particles[o + 5] = p.g; particles[o + 6] = p.b; particles[o + 7] = p.kind;
      }
    }
  }

  function updateDynamic(time, dt, camX, camY, camZ, rainIntensity, windStrength = 0.45) {
    simTime = time;
    stepSim(dt, camX, camY, camZ, rainIntensity, windStrength);
    interpolateSim(1.0, camY, rainIntensity);
  }

  function updateLookdevRig(camX, camY, camZ, yaw, pit) {
    const cy = cos(yaw), sy = sin(yaw), cp = cos(pit), sp = sin(pit);
    const fx = sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, rz = sy;
    const cx = camX + fx * 2.4, cy_ = camY + fy * 2.4 - 0.15, cz = camZ + fz * 2.4;
    const d = lookdevRig.instData;
    const s = ANIMAL_INST_FLOATS;
    d[0] = cx - rx * 0.56; d[1] = cy_; d[2] = cz - rz * 0.56; d[3] = 1.0;
    d[4] = yaw; d[5] = 0; d[6] = 0.1; d[7] = 21 * 16; d[8] = 0; d[9] = 0; d[10] = 0; d[11] = 0;
    d[s] = cx; d[s + 1] = cy_; d[s + 2] = cz; d[s + 3] = 1.0;
    d[s + 4] = yaw; d[s + 5] = 0; d[s + 6] = 0.1; d[s + 7] = 22 * 16; d[s + 8] = 0; d[s + 9] = 0; d[s + 10] = 0; d[s + 11] = 0;
    d[s * 2] = cx + rx * 0.62; d[s * 2 + 1] = cy_; d[s * 2 + 2] = cz + rz * 0.62; d[s * 2 + 3] = 1.0;
    d[s * 2 + 4] = yaw; d[s * 2 + 5] = 0; d[s * 2 + 6] = 0.1; d[s * 2 + 7] = 23 * 16; d[s * 2 + 8] = 0; d[s * 2 + 9] = 0; d[s * 2 + 10] = 0; d[s * 2 + 11] = 0;
  }

  function findNearestAnimal(x, y, z, maxDist = 45) {
    let bestGrp = -1, bestIdx = -1, bestD = maxDist;
    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      for (let i = 0; i < grp.items.length; i++) {
        const it = grp.items[i];
        if (it.inactiveInRegion) continue;
        const d = hypot(it.x - x, it.y - y, it.z - z);
        if (d < bestD) {
          bestD = d;
          bestGrp = g;
          bestIdx = i;
        }
      }
    }
    return bestGrp >= 0 ? { groupIdx: bestGrp, itemIdx: bestIdx, dist: bestD } : null;
  }

  return {
    GRID_CELLS, CELL_SPAN, REGION_HALF, SIM_HZ, SIM_DT, ANIMAL_INST_FLOATS,
    vegBuffers, getVegVersion: () => vegVersion, getActiveRegionBiomeId: () => activeRegionBiomeId,
    syncRegion, wildlifeGroups, lookdevRig,
    colliders, colliderCells, resolveWorldCollision,
    particles, particleState, particleRanges, MAX_PARTICLES,
    stepSim, interpolateSim, updateDynamic, updateLookdevRig,
    findNearestAnimal, triggerWhaleBreach,
    setMarineEventCallback: (cb) => { marineEventCb = cb; },
    setHazardAvoidance: (enabled) => { hazardAvoidanceEnabled = !!enabled; },
    getHazardAvoidance: () => hazardAvoidanceEnabled,
    EMOTION_NAMES,
    getActiveSurvivalEvent: () => activeSurvivalEvent
  };
}

export { buildWorld };
