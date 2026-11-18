// ============================================================================
// REALISM — 18-Biome Earth-Scale World Generation, Abyssal Garden Set-Pieces,
// Continuous Point-to-Point Creature Anatomy, Zero-Slide IK & Survival FSM
// ============================================================================
import {
  PI, TAU, sin, cos, abs, hypot, min, max, sqrt, floor, round, atan2, pow,
  clamp, saturate, lerp, smoothstep, smin, solveTwoBoneIK,
  normAngle, lerpAngle, yawToForward, velocityToYaw,
  WORLD_SEED, seedRng, rnd, rr, noise2, fbm2, MeshBuilder
} from './math.js';
import {
  WORLD_HALF,
  LAGOON_POS, POND_POS, CYPRESS_POS, AMAZON_POS, MANGROVE_POS,
  CLEARING_POS, PLANTATION_POS, SAVANNA_POS, BAMBOO_POS, HIGHLAND_POS,
  BEACH_POS, REEF_POS, ABYSS_POS, ROOKERY_POS, POLAR_POS,
  FIRE_POS, VOLCANO_POS, FORGOTTEN_POS, DUNE_POS,
  wrapCoord, wrapDelta, terrainAt, evaluateHazardAt
} from './biomes.js';
import { THIN, MAX_PARTICLES_BUDGET } from './quality.js';

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
    // Continuous front & hind limbs with shoulder/thigh muscle bellies and paws
    m.smoothLimb(
      [[s * 0.14, 0.66, 0.36], [s * 0.16, 0.36, 0.38], [s * 0.15, 0.14, 0.35], [s * 0.15, 0.02, 0.41]],
      [[0.095, 0.115], [0.068, 0.078], [0.050, 0.055], [0.065, 0.078]],
      [coat, coat, belly, belly],
      [[0.4, 0.7], [0.4, 0.8], [0.4, 0.9], [0.4, 1.0]],
      6, 0.12
    );
    m.smoothLimb(
      [[s * 0.15, 0.66, -0.40], [s * 0.16, 0.38, -0.46], [s * 0.15, 0.15, -0.42], [s * 0.15, 0.02, -0.36]],
      [[0.11, 0.13], [0.072, 0.085], [0.050, 0.055], [0.065, 0.078]],
      [coat, coat, belly, belly],
      [[0.4, 0.3], [0.4, 0.2], [0.4, 0.1], [0.4, 0.0]],
      6, 0.14
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
    [[0, 0.62, -0.82], [0, 0.88, -0.48], [0, 0.86, 0.05], [0, 0.92, 0.42], [0, 1.24, 0.68], [0, 1.18, 0.94]],
    [[0.035, 0.035], [0.22, 0.25], [0.24, 0.27], [0.22, 0.25], [0.13, 0.16], [0.075, 0.09]],
    [dark, base, base, base, base, dark],
    [[0.8, 0], [0.5, 0.25], [0.5, 0.5], [0.5, 0.72], [0.5, 0.90], [0.5, 1.0]],
    7, 0.08
  );
  addExpressiveFace(m, 1.22, 0.78, 0.11, 0.13, 0.16, dark, dark, [0.06, 0.05, 0.04], true);
  for (const s of [-1, 1]) {
    m.smoothLimb([[s * 0.14, 0.80, 0.36], [s * 0.14, 0.42, 0.37], [s * 0.14, 0.02, 0.39]], [0.09, 0.055, 0.06], [base, base, dark], [[0.4, 0.7], [0.4, 0.85], [0.4, 1.0]], 5, 0.08);
    m.smoothLimb([[s * 0.15, 0.82, -0.44], [s * 0.15, 0.42, -0.46], [s * 0.15, 0.02, -0.42]], [0.10, 0.055, 0.06], [base, base, dark], [[0.4, 0.3], [0.4, 0.15], [0.4, 0.0]], 5, 0.09);
  }
  return m.build();
}

// Marine Megafauna: Humpback/Blue Whale, Orca, Great White Shark & Noniv/abyssal-garden Manta Ray
function buildWhaleOrcaMesh(colDorsal, colVentral, isOrca = false) {
  const m = new MeshBuilder();
  const len = isOrca ? 1.85 : 3.2;
  const rad = isOrca ? 0.38 : 0.58;
  // Continuous hydrofoil spline body from rostrum to tail peduncle
  m.smoothLimb(
    [[0, 0.02, -len * 0.95], [0, 0.0, -len * 0.55], [0, 0.02, -len * 0.15], [0, 0.04, len * 0.32], [0, 0.0, len * 0.75], [0, -0.02, len * 0.98]],
    [[0.06, 0.05], [rad * 0.45, rad * 0.52], [rad * 0.88, rad * 0.95], [rad, rad * 0.96], [rad * 0.68, rad * 0.52], [rad * 0.22, rad * 0.15]],
    [colDorsal, colDorsal, colDorsal, colDorsal, colDorsal, colVentral],
    [[0.9, 0], [0.7, 0.2], [0.5, 0.45], [0.5, 0.7], [0.5, 0.9], [0.5, 1.0]],
    8, 0.06
  );
  addExpressiveFace(m, 0.02, len * 0.72, rad * 0.65, rad * 0.42, len * 0.20, colVentral, colDorsal, [0.05, 0.06, 0.08], false);
  // Broad horizontal cetacean tail flukes
  for (const s of [-1, 1]) {
    m.ribbon([0, 0.02, -len * 0.82], [s * rad * 1.65, 0.04, -len * 1.08], rad * 0.36, 0.05, 0.04, colDorsal, colVentral, 0.9, 0.0, 0.2, 4);
    // Pectoral flippers (elongated scalloped flippers on Humpback, rounded paddles on Orca)
    const flipLen = isOrca ? rad * 1.45 : rad * 2.55;
    m.ribbon([s * rad * 0.75, -rad * 0.28, len * 0.22], [s * (rad * 0.75 + flipLen), -rad * 0.52, len * 0.02], rad * 0.38, 0.08, -0.05, colDorsal, colVentral, 0.5, 0.6, 0.8, 5);
  }
  // Dorsal fin (tall 1.8m sword fin on Orca, low step hump on Humpback)
  const dH = isOrca ? rad * 1.65 : rad * 0.42;
  m.ribbon([0, rad * 0.72, -len * 0.12], [0, rad * 0.72 + dH, -len * 0.26], rad * 0.32, 0.04, 0.04, colDorsal, colDorsal, 0.5, 0.4, 0.5, 4);
  return m.build();
}

function buildSharkMesh() {
  const m = new MeshBuilder();
  const slate = [0.28, 0.34, 0.40], belly = [0.88, 0.90, 0.92];
  m.smoothLimb(
    [[0, 0.0, -1.65], [0, 0.0, -0.95], [0, 0.02, -0.20], [0, 0.03, 0.45], [0, 0.0, 1.05], [0, 0.02, 1.42]],
    [[0.05, 0.06], [0.16, 0.20], [0.30, 0.34], [0.32, 0.35], [0.22, 0.18], [0.06, 0.05]],
    [slate, slate, slate, slate, slate, belly],
    [[0.9, 0], [0.7, 0.2], [0.5, 0.5], [0.5, 0.75], [0.5, 0.9], [0.5, 1.0]],
    8, 0.06
  );
  addExpressiveFace(m, 0.0, 1.05, 0.22, 0.18, 0.28, belly, slate, [0.03, 0.04, 0.05], false);
  // First dorsal fin & lunate heterocercal caudal fin
  m.ribbon([0, 0.28, 0.12], [0, 0.72, -0.08], 0.22, 0.03, 0.03, slate, slate, 0.5, 0.5, 0.6, 4);
  m.ribbon([0, 0.0, -1.52], [0, 0.52, -1.88], 0.18, 0.03, 0.04, slate, slate, 0.9, 0.0, 0.1, 4);
  m.ribbon([0, 0.0, -1.52], [0, -0.38, -1.80], 0.15, 0.03, -0.03, slate, belly, 0.9, 0.0, 0.1, 3);
  for (const s of [-1, 1]) {
    m.ribbon([s * 0.26, -0.14, 0.38], [s * 0.88, -0.26, 0.15], 0.22, 0.04, -0.02, slate, belly, 0.5, 0.6, 0.7, 4);
  }
  return m.build();
}

// Exact Noniv/abyssal-garden Manta Ray (meshManta) with diamond disc & cephalic horn fins
function buildMantaMesh() {
  const m = new MeshBuilder();
  const dark = [0.10, 0.14, 0.20], rim = [0.22, 0.30, 0.38], horn = [0.78, 0.82, 0.86];
  m.smoothLimb(
    [[0, 0.0, -1.85], [0, 0.0, -0.65], [0, 0.02, 0.0], [0, 0.02, 0.65], [0, 0.0, 0.95]],
    [[0.015, 0.015], [0.18, 0.06], [0.42, 0.11], [0.36, 0.09], [0.24, 0.05]],
    [dark, dark, dark, dark, horn],
    [[0.9, 0], [0.6, 0.3], [0.5, 0.5], [0.5, 0.8], [0.5, 1.0]],
    7, 0.04
  );
  for (const s of [-1, 1]) {
    // Broad diamond pectoral wings (span out to x = +-1.65 so shader amp = 0.36 * pow(abs(x), 1.6) flaps authentically)
    m.ribbon([s * 0.22, 0.0, 0.08], [s * 1.65, 0.0, -0.12], 0.58, 0.05, 0.03, dark, rim, 0.8, 0.4, 0.9, 6);
    // Forward-projecting cephalic fins
    m.ribbon([s * 0.18, 0.0, 0.85], [s * 0.24, -0.04, 1.28], 0.09, 0.03, 0.02, dark, horn, 0.5, 0.9, 1.0, 3);
  }
  return m.build();
}

// Emperor Penguin & Leopard Seal Meshes
function buildPenguinMesh() {
  const m = new MeshBuilder();
  const back = [0.08, 0.10, 0.14], beak = [0.92, 0.48, 0.12];
  m.smoothLimb(
    [[0, 0.04, -0.06], [0, 0.24, 0.0], [0, 0.48, 0.02], [0, 0.68, 0.04], [0, 0.78, 0.08], [0, 0.76, 0.22]],
    [[0.12, 0.12], [0.18, 0.17], [0.17, 0.16], [0.11, 0.11], [0.085, 0.085], [0.02, 0.02]],
    [back, back, back, back, back, beak],
    [[0.5, 0], [0.5, 0.3], [0.5, 0.6], [0.5, 0.85], [0.5, 0.95], [0.5, 1.0]],
    7, 0.05
  );
  addExpressiveFace(m, 0.77, 0.10, 0.08, 0.08, 0.10, beak, back, [0.05, 0.05, 0.05], false);
  for (const s of [-1, 1]) {
    m.ribbon([s * 0.15, 0.52, 0.02], [s * 0.24, 0.22, -0.02], 0.07, 0.025, 0.02, back, back, 0.6, 0.5, 0.8, 3);
    m.smoothLimb([[s * 0.07, 0.12, 0.02], [s * 0.08, 0.01, 0.10]], [0.045, 0.055], [back, back], [[0.4, 0.1], [0.4, 0.0]], 4, 0.02);
  }
  return m.build();
}

function buildDeerMesh() {
  const m = new MeshBuilder();
  const coat = [0.64, 0.42, 0.22], belly = [0.88, 0.82, 0.72], dark = [0.22, 0.15, 0.10], antler = [0.76, 0.70, 0.56];
  m.smoothLimb(
    [[0, 0.70, -0.68], [0, 0.78, -0.45], [0, 0.76, 0.0], [0, 0.80, 0.38], [0, 1.08, 0.58], [0, 1.16, 0.72], [0, 1.12, 0.88]],
    [[0.05, 0.05], [0.17, 0.20], [0.19, 0.22], [0.18, 0.21], [0.10, 0.12], [0.09, 0.10], [0.045, 0.055]],
    [belly, coat, coat, coat, coat, coat, dark],
    [[0.8, 0], [0.5, 0.2], [0.5, 0.5], [0.5, 0.75], [0.5, 0.88], [0.5, 0.95], [0.5, 1.0]],
    7, 0.08
  );
  addExpressiveFace(m, 1.15, 0.74, 0.09, 0.10, 0.14, belly, coat, [0.06, 0.04, 0.03], true);
  for (const s of [-1, 1]) {
    m.tube([[s * 0.06, 1.24, 0.68], [s * 0.18, 1.44, 0.62], [s * 0.24, 1.58, 0.70]], [0.02, 0.016, 0.008], [antler, antler, antler], [[0.5, 0.9], [0.5, 0.95], [0.5, 1]], 4, true);
    m.smoothLimb([[s * 0.12, 0.72, 0.32], [s * 0.12, 0.38, 0.33], [s * 0.12, 0.0, 0.35]], [0.075, 0.045, 0.04], [coat, coat, dark], [[0.4, 0.7], [0.4, 0.85], [0.4, 1.0]], 5, 0.08);
    m.smoothLimb([[s * 0.13, 0.74, -0.38], [s * 0.13, 0.38, -0.42], [s * 0.13, 0.0, -0.38]], [0.085, 0.048, 0.04], [coat, coat, dark], [[0.4, 0.3], [0.4, 0.15], [0.4, 0.0]], 5, 0.08);
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
// Terrain Clipmap Chunks, Heightmap & Spatial Hash Collision Grid
// ============================================================================
function buildTerrainChunks(chunkCells = 16, worldChunks = 16) {
  const step = 2 / chunkCells;
  const v = [];
  const idx = [];
  const stride = chunkCells + 1;
  for (let z = 0; z <= chunkCells; z++) {
    for (let x = 0; x <= chunkCells; x++) {
      v.push(-1 + x * step, -1 + z * step);
    }
  }
  for (let z = 0; z < chunkCells; z++) {
    for (let x = 0; x < chunkCells; x++) {
      const r0 = z * stride + x;
      const r1 = r0 + stride;
      idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
    }
  }
  const chunkScale = WORLD_HALF / worldChunks;
  const chunks = [];
  for (let cz = 0; cz < worldChunks; cz++) {
    for (let cx = 0; cx < worldChunks; cx++) {
      const ox = -WORLD_HALF + (cx + 0.5) * chunkScale * 2;
      const oz = -WORLD_HALF + (cz + 0.5) * chunkScale * 2;
      chunks.push({ ox, oz, scale: chunkScale });
    }
  }
  return {
    verts: new Float32Array(v),
    indices: new Uint32Array(idx),
    count: idx.length,
    chunks
  };
}

function buildWaterSkirt(n = 150) {
  const v = [];
  const idx = [];
  const step = 2 / n;
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      v.push(-1 + x * step, -1 + z * step);
    }
  }
  const stride = n + 1;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const r0 = z * stride + x;
      const r1 = r0 + stride;
      idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
    }
  }
  return { verts: new Float32Array(v), indices: new Uint32Array(idx), count: idx.length };
}

function buildWorld() {
  seedRng(WORLD_SEED);

  const hSize = 512;
  const hData = new Float32Array(hSize * hSize * 4);
  const t = {};
  for (let z = 0; z < hSize; z++) {
    const wz = ((z / (hSize - 1)) * 2 - 1) * WORLD_HALF;
    for (let x = 0; x < hSize; x++) {
      const wx = ((x / (hSize - 1)) * 2 - 1) * WORLD_HALF;
      terrainAt(wx, wz, t);
      const o = (z * hSize + x) * 4;
      hData[o]     = t.h;
      hData[o + 1] = t.wetness;
      hData[o + 2] = t.moisture;
      hData[o + 3] = t.fire;
    }
  }

  const chunks = buildTerrainChunks(16, 16);
  const skirt = buildWaterSkirt(150);

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
  const instances = [[], [], [], [], [], [], [], [], [], []];

  // Uniform 2D Spatial Hash Grid for O(1) solid obstacle collision
  const GRID_CELLS = 64;
  const CELL_SPAN = (WORLD_HALF * 2) / GRID_CELLS;
  const colliders = [];
  const colliderCells = Array.from({ length: GRID_CELLS * GRID_CELLS }, () => []);

  function addCollider(x, z, r, maxY) {
    const id = colliders.length;
    colliders.push({ x, z, r, maxY });
    const minCx = clamp(floor((x - r + WORLD_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const maxCx = clamp(floor((x + r + WORLD_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const minCz = clamp(floor((z - r + WORLD_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    const maxCz = clamp(floor((z + r + WORLD_HALF) / CELL_SPAN), 0, GRID_CELLS - 1);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        colliderCells[cz * GRID_CELLS + cx].push(id);
      }
    }
  }

  function pushInst(mIdx, x, y, z, scale, rot, seed, charAmt, wetness, colRadius = 0, colHeight = 0) {
    instances[mIdx].push(x, y, z, scale, rot, seed, charAmt, wetness);
    if (colRadius > 0.05) {
      addCollider(x, z, colRadius * scale, y + colHeight * scale);
    }
  }

  // Place the iconic Noniv/abyssal-garden Sunken Wooden Galleon in the Abyssal Trench
  terrainAt(ABYSS_POS[0] - 4, ABYSS_POS[1] - 2, t);
  pushInst(7, ABYSS_POS[0] - 4, t.h + 0.25, ABYSS_POS[1] - 2, 1.35, 0.42, 0.5, 0, 1.0, 3.2, 8.0);

  // Place Kelp Forests, Fluorescent Anemones & Staghorn/Brain Corals across Coral Reef & Abyssal Garden
  const reefCount = round(260 * VEG_DENSITY_SCALE);
  for (let i = 0; i < reefCount; i++) {
    const inAbyss = i % 3 === 0;
    const cx = (inAbyss ? ABYSS_POS[0] : REEF_POS[0]) + rr(-78, 78);
    const cz = (inAbyss ? ABYSS_POS[1] : REEF_POS[1]) + rr(-48, 52);
    terrainAt(cx, cz, t);
    if (t.h < -0.6) {
      pushInst(8, cx, t.h - 0.05, cz, rr(0.85, 1.75), rr(0, TAU), rnd(), 0, 1.0);
    }
  }

  // Place Coconut Palms along Golden Tropical Beach
  for (let i = 0; i < round(65 * VEG_DENSITY_SCALE); i++) {
    const x = BEACH_POS[0] + rr(-75, 75), z = BEACH_POS[1] + rr(-24, 10);
    terrainAt(x, z, t);
    if (t.h > 0.15 && t.h < 3.6) {
      pushInst(2, x, t.h, z, rr(0.95, 1.42), rr(0, TAU), rnd(), 0, t.wetness, 0.34, 9.0);
    }
  }

  // Place Umbrella Acacias, Misty Bamboo Groves, Heritage Plantation Trees & Virunga Cloud Trees
  for (let i = 0; i < round(240 * VEG_DENSITY_SCALE); i++) {
    const zone = i % 4;
    const base = zone === 0 ? SAVANNA_POS : zone === 1 ? BAMBOO_POS : zone === 2 ? PLANTATION_POS : HIGHLAND_POS;
    const x = base[0] + rr(-82, 82), z = base[1] + rr(-72, 72);
    terrainAt(x, z, t);
    if (t.h > 0.35) {
      const mIdx = zone === 2 && i % 2 === 0 ? 2 : zone === 3 && i % 2 === 0 ? 1 : 9;
      pushInst(mIdx, x, t.h, z, rr(0.88, 1.48), rr(0, TAU), rnd(), 0, t.wetness, 0.55, 10.0);
    }
  }

  // Interior & Global Canopy Trees (Cypress, Kapok, Palm, Mangrove across the entire planetary domain)
  const treeCount = round(920 * VEG_DENSITY_SCALE);
  for (let i = 0; i < treeCount; i++) {
    const x = rr(-350, 350), z = rr(-215, 225);
    if (hypot(x - LAGOON_POS[0], z - LAGOON_POS[1]) < 22) continue;
    terrainAt(x, z, t);
    if (t.h < -0.55 || (t.clearing > 0.62 && rnd() < 0.85) || t.savanna > 0.55 || t.dune > 0.45 || t.volcano > 0.45 || t.polar > 0.25) continue;
    const rot = rr(0, TAU), seed = rnd(), charAmt = saturate(t.fire * rr(0.6, 1.25));
    if (t.mangrove > 0.32 || (t.h < 0.18 && t.river > 0.25)) {
      pushInst(3, x, max(-0.28, t.h), z, rr(0.85, 1.32), rot, seed, charAmt, t.wetness, 0.55, 5.2);
    } else if (t.swamp > 0.28 || (t.wetness > 0.5 && rnd() < 0.55)) {
      pushInst(0, x, max(-0.22, t.h), z, rr(0.88, 1.38), rot, seed, charAmt, t.wetness, 0.72, 13.5);
    } else if (t.amazon > 0.25 || t.highland > 0.25 || rnd() < 0.48) {
      pushInst(1, x, t.h, z, rr(0.85, 1.40), rot, seed, charAmt, t.wetness, 0.92, 19.5);
    } else {
      pushInst(2, x, t.h, z, rr(0.85, 1.35), rot, seed, charAmt, t.wetness, 0.34, 9.0);
    }
  }

  // Dense Understory (Ferns, Monstera, Heliconia, Wildflowers across the full planetary belt)
  const underCount = round(1600 * VEG_DENSITY_SCALE);
  for (let i = 0; i < underCount; i++) {
    const x = rr(-350, 350), z = rr(-215, 225);
    terrainAt(x, z, t);
    if (t.h < -0.05 || t.h > 19 || t.dune > 0.45 || t.volcano > 0.45 || t.polar > 0.25) continue;
    pushInst(4, x, t.h, z, rr(0.75, 1.55), rr(0, TAU), rnd(), saturate(t.fire * 1.1), t.wetness);
  }

  // Boulders, Fallen Logs, Kopje Rocks, Cenote Karst & North/South Polar Glacial Icebergs
  const rockCount = round(640 * VEG_DENSITY_SCALE);
  for (let i = 0; i < rockCount; i++) {
    const x = rr(-352, 352), z = rr(-352, 352);
    terrainAt(x, z, t);
    if (t.h < -1.2 && z > -210 && z < 180) continue;
    const sc = (z < -225 || z > 235) ? rr(1.15, 2.45) : rr(0.75, 1.85);
    pushInst(5, x, t.h - 0.08, z, sc, rr(0, TAU), rnd(), saturate(t.fire), t.wetness, 0.78, 0.95);
  }

  // Water Lilies, Sawgrass & Cattails across main river and outer tributary channels
  const waterFloraCount = round(760 * VEG_DENSITY_SCALE);
  for (let i = 0; i < waterFloraCount; i++) {
    const x = rr(-345, 345), z = rr(-205, 175);
    terrainAt(x, z, t);
    if (t.h > -1.35 && t.h < 0.28 && t.polar < 0.1) {
      pushInst(6, x, 0.01, z, rr(0.75, 1.45), rr(0, TAU), rnd(), saturate(t.fire * 0.8), 1.0);
    }
  }

  const vegBuffers = meshes.map((mesh, idx) => ({
    verts: mesh.verts,
    indices: mesh.indices,
    count: mesh.count,
    instData: new Float32Array(instances[idx]),
    instCount: (instances[idx].length / 8) | 0
  }));

  // ==========================================================================
  // Solid Obstacle + Ground Collision Solver (Camera & Wildlife, Geodesic-Wrapped)
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

    const wx = wrapCoord(nx);
    const wz = wrapCoord(nz);
    const cx = clamp(floor((wx + WORLD_HALF) / CELL_SPAN) || 0, 0, GRID_CELLS - 1);
    const cz = clamp(floor((wz + WORLD_HALF) / CELL_SPAN) || 0, 0, GRID_CELLS - 1);
    for (let dz = -1; dz <= 1; dz++) {
      const gz = (cz + dz + GRID_CELLS) % GRID_CELLS;
      for (let dx = -1; dx <= 1; dx++) {
        const gx = (cx + dx + GRID_CELLS) % GRID_CELLS;
        const bucket = colliderCells[gz * GRID_CELLS + gx];
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const c = colliders[bucket[k]];
          if (ny > c.maxY) continue;
          const ox = wrapDelta(wx, c.x), oz = wrapDelta(wz, c.z);
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

    out.x = nx; out.y = ny; out.z = nz;
    out.vx = nvx; out.vz = nvz;
    out.hit = hit; out.hitGround = hitGround;
    out.nx = hitNx; out.nz = hitNz;
    out.groundH = _colT.h;
    return out;
  }

  // ==========================================================================
  // Planetary Wildlife Cohorts (43 Cohorts Across Land, Air, Ocean & Polar)
  // ==========================================================================
  const SIM_HZ = 120;
  const SIM_DT = 1 / SIM_HZ;
  const wildlifeGroups = [];

  function addCohort(name, mesh, items, speciesId, flightDist = 18, meta = {}) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.speciesId = speciesId;
      it.flightDist = flightDist;
      it.state = 'forage';
      it.emotion = i % 3; // 0 = Calm/Grazing, 1 = Curious/Social, 2 = Alert/Scanning, 3 = Dominant/Roar/Stalk, 4 = Startled/Fleeing
      it.emotionTimer = rr(3, 9);
      it.roarTimer = 0;
      it.fleeTimer = 0;
      it.actionTimer = rr(2, 12);
      it.ang = it.phase;
      it.packedMode = speciesId * 16 + (it.mode || 0);
      it.strideLen = meta.strideLen || (0.85 * (it.scale || 1.0));
      it.role = meta.role || 'herbivore';
      it.domain = meta.domain || (it.type === 'flyCircle' ? 'air' : it.type === 'swimCircle' ? 'water' : 'land');
      if (it.x === undefined) {
        it.x = it.cx + cos(it.ang) * it.rad;
        it.z = it.cz + sin(it.ang) * it.rad;
        if (it.y === undefined) {
          terrainAt(it.x, it.z, t);
          it.y = max(-0.08, t.h);
        }
      }
      it.prevX = it.x;
      it.prevY = it.y;
      it.prevZ = it.z;
      // Canonical local +Z forward rotates to world (-sin(yaw), cos(yaw)),
      // matching circular velocity (-sin(ang), cos(ang)) when yaw === ang
      it.yaw = normAngle(it.yaw ?? it.ang);
      it.prevYaw = it.yaw;
      it.pitch = 0;
      it.roll = 0;
      it.vx = 0;
      it.vz = 0;
      it.boidsX = 0;
      it.boidsY = 0;
      it.boidsZ = 0;
    }
    wildlifeGroups.push({
      name,
      speciesId,
      label: meta.label || name,
      domain: meta.domain || 'land',
      role: meta.role || 'herbivore',
      eyeOffset: meta.eyeOffset || [0, 0.75, 0.55],
      followDist: meta.followDist || 4.8,
      baseSpeed: meta.baseSpeed || 6.5,
      verts: mesh.verts,
      indices: mesh.indices,
      count: mesh.count,
      items,
      instData: new Float32Array(items.length * 8),
      instCount: items.length
    });
  }

  // --- Reptiles & Amphibians ---
  const gators = [];
  for (let i = 0; i < 12; i++) {
    const inSwamp = i < 7;
    const cx = inSwamp ? CYPRESS_POS[0] + rr(-45, 45) : rr(-70, 95);
    const cz = inSwamp ? CYPRESS_POS[1] + rr(-45, 45) : 14 + rr(-14, 14);
    gators.push({ type: 'swimCircle', cx, cz, y: -0.04, rad: rr(4, 12), speed: rr(0.08, 0.16), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 0.85, mode: 1 });
  }
  addCohort('alligators', buildAlligatorMesh(), gators, 2, 12, { label: 'American Alligator', domain: 'water', role: 'predator', eyeOffset: [0, 0.28, 0.72], followDist: 4.2, baseSpeed: 6.0 });

  const caimans = [];
  for (let i = 0; i < 8; i++) {
    const cx = MANGROVE_POS[0] + rr(-38, 38), cz = MANGROVE_POS[1] + rr(-38, 38);
    caimans.push({ type: 'swimCircle', cx, cz, y: -0.04, rad: rr(3, 8), speed: rr(0.10, 0.18), phase: rr(0, TAU), scale: rr(0.65, 0.88), animSpeed: 1.0, mode: 1 });
  }
  addCohort('caimans', buildAlligatorMesh(), caimans, 2, 14, { label: 'Black Caiman', domain: 'water', role: 'predator', eyeOffset: [0, 0.25, 0.65], followDist: 3.8, baseSpeed: 6.2 });

  const anacondas = [];
  for (let i = 0; i < 6; i++) {
    const cx = CYPRESS_POS[0] + rr(-40, 60), cz = CYPRESS_POS[1] + rr(-35, 35);
    anacondas.push({ type: 'swimCircle', cx, cz, y: -0.03, rad: rr(3, 7), speed: rr(0.12, 0.22), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.15, mode: 1 });
  }
  addCohort('anacondas', buildAnacondaMesh(), anacondas, 15, 10, { label: 'Green Anaconda', domain: 'water', role: 'predator', eyeOffset: [0, 0.16, 1.2], followDist: 3.6, baseSpeed: 5.2 });

  const turtles = [];
  for (let i = 0; i < 16; i++) {
    const inOcean = i >= 10;
    const cx = inOcean ? REEF_POS[0] + rr(-45, 45) : LAGOON_POS[0] + rr(-45, 55);
    const cz = inOcean ? REEF_POS[1] + rr(-35, 35) : LAGOON_POS[1] + rr(-18, 22);
    const ty = inOcean ? rr(-3.8, -1.2) : 0.02;
    turtles.push({ type: 'swimCircle', cx, cz, y: ty, rad: rr(2, 9), speed: rr(0.08, 0.22), phase: rr(0, TAU), scale: rr(0.85, 1.35), animSpeed: 0.85, mode: 1 });
  }
  addCohort('turtles', buildTurtleMesh(), turtles, 3, 10, { label: 'Green Sea Turtle', domain: 'water', role: 'herbivore', eyeOffset: [0, 0.20, 0.38], followDist: 3.2, baseSpeed: 5.5 });

  const iguanas = [];
  for (let i = 0; i < 10; i++) {
    const cx = MANGROVE_POS[0] + rr(-35, 35), cz = MANGROVE_POS[1] + rr(-35, 35);
    terrainAt(cx, cz, t);
    iguanas.push({ type: 'idle', x: cx, y: max(0.1, t.h), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(0.9, 1.25), animSpeed: 0.7, mode: 0 });
  }
  addCohort('iguanas', buildIguanaMesh(), iguanas, 15, 14, { label: 'Green Iguana', domain: 'land' });

  const dartFrogs = [];
  for (let i = 0; i < 12; i++) {
    const cx = AMAZON_POS[0] + rr(-45, 45), cz = AMAZON_POS[1] + rr(-45, 45);
    terrainAt(cx, cz, t);
    dartFrogs.push({ type: 'idle', x: cx, y: max(0.2, t.h + rr(0.1, 2.2)), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.1, 1.5), animSpeed: 1.2, mode: 4 });
  }
  addCohort('dartFrogs', buildFrogMesh([0.12, 0.46, 0.88], false), dartFrogs, 16, 6, { label: 'Blue Poison Dart Frog' });

  const treeFrogs = [];
  for (let i = 0; i < 12; i++) {
    const cx = CYPRESS_POS[0] + rr(-40, 40), cz = CYPRESS_POS[1] + rr(-40, 40);
    terrainAt(cx, cz, t);
    treeFrogs.push({ type: 'idle', x: cx, y: max(0.2, t.h + rr(0.2, 2.5)), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.1, 1.45), animSpeed: 1.2, mode: 4 });
  }
  addCohort('treeFrogs', buildFrogMesh([0.26, 0.78, 0.20], true), treeFrogs, 17, 6, { label: 'Red-Eyed Tree Frog' });

  // --- Interior Rainforest & Wetland Mammals ---
  const jaguars = [];
  for (let i = 0; i < 6; i++) {
    const cx = FORGOTTEN_POS[0] + rr(-45, 45), cz = FORGOTTEN_POS[1] + rr(-45, 45);
    jaguars.push({ type: 'walkCircle', cx, cz, rad: rr(8, 18), speed: rr(0.14, 0.24), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.0, mode: 3 });
  }
  addCohort('jaguars', buildBigCatMesh([0.84, 0.56, 0.20], [0.88, 0.84, 0.72], false), jaguars, 1, 25, { label: 'Amazonian Jaguar', domain: 'land', role: 'predator', eyeOffset: [0, 0.86, 0.88], followDist: 4.5, baseSpeed: 10.5 });

  const panthers = [];
  for (let i = 0; i < 5; i++) {
    const cx = CYPRESS_POS[0] + rr(-35, 50), cz = CYPRESS_POS[1] + rr(10, 65);
    panthers.push({ type: 'walkCircle', cx, cz, rad: rr(9, 18), speed: rr(0.14, 0.24), phase: rr(0, TAU), scale: rr(SIZE_VAR_MIN, SIZE_VAR_MAX), animSpeed: 1.0, mode: 3 });
  }
  addCohort('panthers', buildBigCatMesh([0.66, 0.45, 0.28], [0.84, 0.74, 0.60], false), panthers, 11, 40, { label: 'Florida Panther', domain: 'land', role: 'predator', eyeOffset: [0, 0.84, 0.86], followDist: 4.4, baseSpeed: 10.8 });

  const deer = [];
  for (let i = 0; i < 12; i++) {
    const cx = CLEARING_POS[0] + rr(-38, 38), cz = CLEARING_POS[1] + rr(-32, 32);
    const s = i < 4 ? 0.55 : rr(SIZE_VAR_MIN, SIZE_VAR_MAX);
    deer.push({ type: 'walkCircle', cx, cz, rad: rr(5, 13), speed: rr(0.11, 0.22), phase: rr(0, TAU), scale: s, animSpeed: 0.9, mode: 3 });
  }
  addCohort('deer', buildDeerMesh(), deer, 13, 50, { label: 'White-Tailed Deer', domain: 'land', role: 'herbivore', eyeOffset: [0, 1.18, 0.72], followDist: 4.6, baseSpeed: 11.0 });

  const capys = [];
  for (let i = 0; i < 16; i++) {
    const cx = rr(-35, 70), cz = 18 + rr(-16, 18);
    capys.push({ type: 'walkCircle', cx, cz, rad: rr(2.5, 6.5), speed: rr(0.08, 0.18), phase: rr(0, TAU), scale: i < 4 ? 0.45 : rr(0.9, 1.15), animSpeed: 0.75, mode: 3 });
  }
  addCohort('capybaras', buildCapybaraMesh(), capys, 11, 20, { label: 'Giant Capybara', domain: 'land', role: 'herbivore', eyeOffset: [0, 0.48, 0.48], followDist: 3.2, baseSpeed: 6.2 });

  const bears = [];
  for (let i = 0; i < 4; i++) {
    bears.push({ type: 'walkCircle', cx: CLEARING_POS[0] + rr(-50, 10), cz: CLEARING_POS[1] + rr(-40, 40), rad: rr(6, 15), speed: rr(0.10, 0.20), phase: rr(0, TAU), scale: rr(0.92, 1.18), animSpeed: 0.85, mode: 3 });
  }
  addCohort('bears', buildBearTapirMesh(false), bears, 11, 60, { label: 'Black Bear', domain: 'land', role: 'predator', eyeOffset: [0, 0.68, 0.74], followDist: 4.6, baseSpeed: 8.5 });

  const tapirs = [];
  for (let i = 0; i < 5; i++) {
    tapirs.push({ type: 'walkCircle', cx: AMAZON_POS[0] + rr(-45, 45), cz: AMAZON_POS[1] + rr(-45, 45), rad: rr(6, 15), speed: rr(0.10, 0.20), phase: rr(0, TAU), scale: i === 0 ? 0.58 : rr(SIZE_VAR_MIN, 1.05), animSpeed: 0.85, mode: 3 });
  }
  addCohort('tapirs', buildBearTapirMesh(true), tapirs, 20, 35, { label: 'Amazonian Tapir', domain: 'land', role: 'herbivore', eyeOffset: [0, 0.62, 0.72], followDist: 4.2, baseSpeed: 7.5 });

  const raccoons = [];
  for (let i = 0; i < 10; i++) {
    raccoons.push({ type: 'walkCircle', cx: MANGROVE_POS[0] + rr(-30, 30), cz: MANGROVE_POS[1] + rr(-30, 30), rad: rr(2, 6), speed: rr(0.22, 0.45), phase: rr(0, TAU), scale: rr(0.92, 1.25), animSpeed: 1.4, mode: 3 });
  }
  addCohort('raccoons', buildSmallMammalMesh([0.48, 0.46, 0.42], true), raccoons, 12, 12, { label: 'Mangrove Raccoon' });

  const otters = [];
  for (let i = 0; i < 10; i++) {
    otters.push({ type: 'walkCircle', cx: LAGOON_POS[0] + rr(-55, 55), cz: LAGOON_POS[1] + rr(-25, 25), rad: rr(2, 6), speed: rr(0.25, 0.48), phase: rr(0, TAU), scale: rr(0.92, 1.25), animSpeed: 1.4, mode: 3 });
  }
  addCohort('otters', buildSmallMammalMesh([0.36, 0.27, 0.20], false), otters, 11, 15, { label: 'Giant River Otter', domain: 'land', eyeOffset: [0, 0.28, 0.42], followDist: 2.8, baseSpeed: 7.0 });

  const monkeys = [];
  for (let i = 0; i < 16; i++) {
    monkeys.push({ type: 'flyCircle', cx: AMAZON_POS[0] + rr(-55, 55), cz: AMAZON_POS[1] + rr(-55, 55), y: rr(14, 24), rad: rr(3, 8), speed: rr(0.35, 0.7), phase: rr(0, TAU), scale: rr(1.05, 1.38), animSpeed: 1.5, mode: 4 });
  }
  addCohort('monkeys', buildMonkeySlothMesh([0.28, 0.20, 0.14], false), monkeys, 11, 25, { label: 'Spider Monkey', domain: 'air' });

  const sloths = [];
  for (let i = 0; i < 10; i++) {
    sloths.push({ type: 'idle', x: AMAZON_POS[0] + rr(-50, 50), y: rr(13, 21), z: AMAZON_POS[1] + rr(-50, 50), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.08, 1.35), animSpeed: 0.45, mode: 4 });
  }
  addCohort('sloths', buildMonkeySlothMesh([0.48, 0.44, 0.38], true), sloths, 11, 5, { label: 'Three-Toed Sloth' });

  const manatees = [];
  for (let i = 0; i < 5; i++) {
    manatees.push({ type: 'swimCircle', cx: LAGOON_POS[0] + rr(-25, 35), cz: LAGOON_POS[1] + rr(-12, 14), y: -0.85, rad: rr(6, 14), speed: rr(0.07, 0.14), phase: rr(0, TAU), scale: i === 0 ? 0.62 : rr(0.92, 1.15), animSpeed: 0.65, mode: 1 });
  }
  addCohort('manatees', buildFishManateeMesh([0.44, 0.48, 0.50], true), manatees, 14, 10, { label: 'West Indian Manatee', domain: 'water' });

  // --- Savanna, Misty Bamboo Jungle, Ape Highlands & Plantation Megafauna ---
  const lions = [];
  for (let i = 0; i < 10; i++) {
    const inDune = i >= 8;
    const base = inDune ? DUNE_POS : SAVANNA_POS;
    lions.push({ type: 'walkCircle', cx: base[0] + rr(-55, 55), cz: base[1] + rr(-48, 48), rad: rr(10, 22), speed: rr(0.14, 0.25), phase: rr(0, TAU), scale: rr(1.05, 1.32), animSpeed: 1.0, mode: 3 });
  }
  addCohort('lions', buildBigCatMesh([0.82, 0.64, 0.34], [0.92, 0.86, 0.72], true), lions, 24, 30, { label: 'African Lion', domain: 'land', role: 'predator', eyeOffset: [0, 0.92, 0.92], followDist: 4.8, baseSpeed: 11.5 });

  const tigers = [];
  for (let i = 0; i < 8; i++) {
    tigers.push({ type: 'walkCircle', cx: BAMBOO_POS[0] + rr(-55, 55), cz: BAMBOO_POS[1] + rr(-48, 48), rad: rr(9, 20), speed: rr(0.15, 0.26), phase: rr(0, TAU), scale: rr(1.08, 1.35), animSpeed: 1.05, mode: 3 });
  }
  addCohort('tigers', buildBigCatMesh([0.92, 0.46, 0.12], [0.96, 0.94, 0.90], false), tigers, 25, 32, { label: 'Bengal Tiger', domain: 'land', role: 'predator', eyeOffset: [0, 0.90, 0.92], followDist: 4.8, baseSpeed: 11.8 });

  const gorillas = [];
  for (let i = 0; i < 9; i++) {
    gorillas.push({ type: 'walkCircle', cx: HIGHLAND_POS[0] + rr(-48, 48), cz: HIGHLAND_POS[1] + rr(-45, 45), rad: rr(6, 14), speed: rr(0.10, 0.18), phase: rr(0, TAU), scale: rr(1.12, 1.42), animSpeed: 0.9, mode: 3 });
  }
  addCohort('gorillas', buildApeMesh([0.12, 0.13, 0.15], [0.74, 0.76, 0.80], true), gorillas, 26, 28, { label: 'Silverback Mountain Gorilla', domain: 'land', role: 'herbivore', eyeOffset: [0, 1.12, 0.48], followDist: 4.6, baseSpeed: 8.8 });

  const chimpanzees = [];
  for (let i = 0; i < 12; i++) {
    const inPlantation = i < 6;
    const base = inPlantation ? PLANTATION_POS : HIGHLAND_POS;
    chimpanzees.push({ type: 'walkCircle', cx: base[0] + rr(-45, 45), cz: base[1] + rr(-42, 42), rad: rr(6, 15), speed: rr(0.18, 0.32), phase: rr(0, TAU), scale: rr(0.95, 1.18), animSpeed: 1.25, mode: 3 });
  }
  addCohort('chimpanzees', buildApeMesh([0.16, 0.14, 0.12], [0.18, 0.15, 0.13], false), chimpanzees, 27, 25, { label: 'Wild Chimpanzee', domain: 'land', role: 'herbivore', eyeOffset: [0, 0.78, 0.38], followDist: 3.8, baseSpeed: 9.2 });

  const elephants = [];
  for (let i = 0; i < 8; i++) {
    const inDune = i >= 6;
    const base = inDune ? DUNE_POS : SAVANNA_POS;
    elephants.push({ type: 'walkCircle', cx: base[0] + rr(-65, 65), cz: base[1] + rr(-55, 55), rad: rr(12, 26), speed: rr(0.07, 0.14), phase: rr(0, TAU), scale: i === 0 ? 0.65 : rr(1.05, 1.35), animSpeed: 0.72, mode: 3 });
  }
  addCohort('elephants', buildElephantMesh(), elephants, 28, 22, { label: 'African Bush Elephant', domain: 'land', role: 'herbivore', eyeOffset: [0, 1.85, 1.05], followDist: 7.5, baseSpeed: 7.8, strideLen: 1.65 });

  const giraffes = [];
  for (let i = 0; i < 8; i++) {
    giraffes.push({ type: 'walkCircle', cx: SAVANNA_POS[0] + rr(-62, 62), cz: SAVANNA_POS[1] + rr(-52, 52), rad: rr(12, 24), speed: rr(0.09, 0.16), phase: rr(0, TAU), scale: rr(1.02, 1.28), animSpeed: 0.78, mode: 3 });
  }
  addCohort('giraffes', buildGiraffeMesh(), giraffes, 29, 30, { label: 'Reticulated Giraffe', domain: 'land', role: 'herbivore', eyeOffset: [0, 3.25, 0.95], followDist: 7.2, baseSpeed: 9.5, strideLen: 1.55 });

  const zebras = [];
  for (let i = 0; i < 16; i++) {
    zebras.push({ type: 'walkCircle', cx: SAVANNA_POS[0] + rr(-60, 60), cz: SAVANNA_POS[1] + rr(-50, 50), rad: rr(10, 22), speed: rr(0.14, 0.26), phase: rr(0, TAU), scale: rr(0.95, 1.18), animSpeed: 1.05, mode: 3 });
  }
  addCohort('zebras', buildZebraMesh(), zebras, 30, 42, { label: 'Plains Zebra', domain: 'land', role: 'herbivore', eyeOffset: [0, 1.24, 0.85], followDist: 4.8, baseSpeed: 11.5 });

  // --- Ocean & Polar Megafauna (Whales, Orcas, Sharks, Mantas, Penguins, Polar Bears, Seals) ---
  const whales = [];
  for (let i = 0; i < 6; i++) {
    const inPolar = i >= 4;
    const base = inPolar ? POLAR_POS : ABYSS_POS;
    whales.push({ type: 'swimCircle', cx: base[0] + rr(-55, 55), cz: base[1] + rr(-35, 35), y: rr(-8.5, -3.2), rad: rr(18, 36), speed: rr(0.08, 0.15), phase: rr(0, TAU), scale: rr(1.35, 1.85), animSpeed: 0.75, mode: 1 });
  }
  addCohort('whales', buildWhaleOrcaMesh([0.14, 0.22, 0.32], [0.82, 0.86, 0.90], false), whales, 31, 15, { label: 'Humpback Whale', domain: 'water', role: 'herbivore', eyeOffset: [0, 0.35, 2.2], followDist: 10.5, baseSpeed: 9.5 });

  const orcas = [];
  for (let i = 0; i < 7; i++) {
    const inRookery = i >= 4;
    const base = inRookery ? ROOKERY_POS : ABYSS_POS;
    orcas.push({ type: 'swimCircle', cx: base[0] + rr(-48, 48), cz: base[1] + rr(-32, 32), y: rr(-6.2, -1.8), rad: rr(14, 28), speed: rr(0.14, 0.24), phase: rr(0, TAU), scale: rr(1.15, 1.45), animSpeed: 1.05, mode: 1 });
  }
  addCohort('orcas', buildWhaleOrcaMesh([0.05, 0.06, 0.08], [0.95, 0.96, 0.98], true), orcas, 32, 18, { label: 'Orca (Killer Whale)', domain: 'water', role: 'predator', eyeOffset: [0, 0.28, 1.45], followDist: 7.2, baseSpeed: 11.5 });

  const sharks = [];
  for (let i = 0; i < 8; i++) {
    const base = i < 4 ? REEF_POS : ABYSS_POS;
    sharks.push({ type: 'swimCircle', cx: base[0] + rr(-52, 52), cz: base[1] + rr(-35, 35), y: rr(-7.5, -2.0), rad: rr(12, 24), speed: rr(0.16, 0.28), phase: rr(0, TAU), scale: rr(1.08, 1.42), animSpeed: 1.15, mode: 1 });
  }
  addCohort('sharks', buildSharkMesh(), sharks, 33, 18, { label: 'Great White Shark', domain: 'water', role: 'predator', eyeOffset: [0, 0.18, 1.15], followDist: 5.8, baseSpeed: 11.2 });

  const mantas = [];
  for (let i = 0; i < 10; i++) {
    const base = i < 6 ? REEF_POS : ABYSS_POS;
    mantas.push({ type: 'swimCircle', cx: base[0] + rr(-55, 55), cz: base[1] + rr(-35, 35), y: rr(-6.5, -1.6), rad: rr(10, 22), speed: rr(0.12, 0.22), phase: rr(0, TAU), scale: rr(1.05, 1.45), animSpeed: 0.95, mode: 1 });
  }
  addCohort('mantas', buildMantaMesh(), mantas, 34, 16, { label: 'Oceanic Manta Ray', domain: 'water', role: 'herbivore', eyeOffset: [0, 0.14, 0.95], followDist: 5.5, baseSpeed: 9.0 });

  const penguins = [];
  for (let i = 0; i < 32; i++) {
    // Populate BOTH South Polar (ROOKERY_POS / POLAR_POS) AND North Antarctica Continent (z < -250)
    const inNorthAntarctica = i >= 20;
    const inPolar = i >= 10 && i < 20;
    const cx = inNorthAntarctica ? rr(-280, 280) : (inPolar ? POLAR_POS[0] : ROOKERY_POS[0]) + rr(-58, 58);
    const cz = inNorthAntarctica ? rr(-330, -245) : (inPolar ? POLAR_POS[1] : ROOKERY_POS[1]) + rr(-45, 45);
    penguins.push({ type: 'walkCircle', cx, cz, rad: rr(4, 14), speed: rr(0.12, 0.24), phase: rr(0, TAU), scale: rr(0.92, 1.18), animSpeed: 1.35, mode: 3 });
  }
  addCohort('penguins', buildPenguinMesh(), penguins, 35, 22, { label: 'Emperor Penguin', domain: 'land', role: 'herbivore', eyeOffset: [0, 0.78, 0.18], followDist: 3.2, baseSpeed: 6.5 });

  const polarBears = [];
  for (let i = 0; i < 10; i++) {
    const inNorthAntarctica = i >= 5;
    const cx = inNorthAntarctica ? rr(-260, 260) : POLAR_POS[0] + rr(-58, 58);
    const cz = inNorthAntarctica ? rr(-335, -248) : POLAR_POS[1] + rr(-45, 45);
    polarBears.push({ type: 'walkCircle', cx, cz, rad: rr(8, 18), speed: rr(0.10, 0.18), phase: rr(0, TAU), scale: rr(1.15, 1.42), animSpeed: 0.85, mode: 3 });
  }
  addCohort('polarBears', buildBearTapirMesh(false), polarBears, 36, 28, { label: 'Polar Bear', domain: 'land', role: 'predator', eyeOffset: [0, 0.78, 0.82], followDist: 5.0, baseSpeed: 9.2 });

  const seals = [];
  for (let i = 0; i < 14; i++) {
    const inNorthAntarctica = i >= 10;
    const base = i < 6 ? ROOKERY_POS : POLAR_POS;
    const cx = inNorthAntarctica ? rr(-250, 250) : base[0] + rr(-48, 48);
    const cz = inNorthAntarctica ? rr(-245, -222) : base[1] + rr(-38, 38);
    seals.push({ type: 'swimCircle', cx, cz, y: -0.65, rad: rr(6, 15), speed: rr(0.14, 0.25), phase: rr(0, TAU), scale: rr(0.95, 1.25), animSpeed: 1.05, mode: 1 });
  }
  addCohort('seals', buildFishManateeMesh([0.52, 0.56, 0.62], true), seals, 37, 20, { label: 'Leopard Seal', domain: 'water', role: 'predator', eyeOffset: [0, 0.24, 0.65], followDist: 4.0, baseSpeed: 8.5 });

  // --- Birds (8 Cohorts) ---
  const macaws = [];
  for (let i = 0; i < 22; i++) {
    macaws.push({ type: 'flyCircle', cx: AMAZON_POS[0] + rr(-85, 85), cz: AMAZON_POS[1] + rr(-75, 95), y: rr(13, 30), rad: rr(14, 38), speed: rr(0.28, 0.55), phase: rr(0, TAU), scale: rr(1.15, 1.55), animSpeed: 1.45, mode: 2 });
  }
  addCohort('macaws', buildBirdMesh([0.86, 0.16, 0.12], [0.16, 0.42, 0.85], [0.88, 0.80, 0.52], 0.95, 0.16, false), macaws, 4, 30, { label: 'Scarlet Macaw', domain: 'air', eyeOffset: [0, 0.16, 0.35], followDist: 3.6, baseSpeed: 14.0 });

  const toucans = [];
  for (let i = 0; i < 12; i++) {
    toucans.push({ type: 'flyCircle', cx: AMAZON_POS[0] + rr(-65, 65), cz: AMAZON_POS[1] + rr(-65, 65), y: rr(14, 25), rad: rr(8, 20), speed: rr(0.22, 0.42), phase: rr(0, TAU), scale: rr(1.1, 1.45), animSpeed: 1.2, mode: 2 });
  }
  addCohort('toucans', buildBirdMesh([0.14, 0.14, 0.16], [0.18, 0.18, 0.22], [0.90, 0.56, 0.10], 0.78, 0.34, false, [0.90, 0.74, 0.14]), toucans, 5, 20, { label: 'Toco Toucan', domain: 'air', eyeOffset: [0, 0.15, 0.32], followDist: 3.4, baseSpeed: 12.5 });

  const eagles = [];
  for (let i = 0; i < 10; i++) {
    eagles.push({ type: 'flyCircle', cx: rr(-180, 180), cz: rr(-180, 180), y: rr(36, 62), rad: rr(32, 68), speed: rr(0.14, 0.25), phase: rr(0, TAU), scale: rr(1.55, 2.1), animSpeed: 0.55, mode: 2 });
  }
  addCohort('eagles', buildBirdMesh([0.28, 0.20, 0.14], [0.22, 0.16, 0.11], [0.88, 0.72, 0.22], 1.45, 0.18, false, [0.90, 0.90, 0.88]), eagles, 6, 50, { label: 'Crowned Harpy Eagle', domain: 'air', role: 'predator', eyeOffset: [0, 0.22, 0.45], followDist: 4.6, baseSpeed: 16.5 });

  const owls = [];
  for (let i = 0; i < 8; i++) {
    const cx = FORGOTTEN_POS[0] + rr(-40, 40), cz = FORGOTTEN_POS[1] + rr(-40, 40);
    owls.push({ type: 'idle', x: cx, y: rr(7, 15), z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.0, 1.25), animSpeed: 0.6, mode: 0 });
  }
  addCohort('owls', buildBirdMesh([0.46, 0.34, 0.22], [0.38, 0.28, 0.18], [0.42, 0.36, 0.24], 0.85, 0.10, false), owls, 7, 12, { label: 'Spectacled Owl', domain: 'air' });

  const kingfishers = [];
  for (let i = 0; i < 10; i++) {
    kingfishers.push({ type: 'flyCircle', cx: LAGOON_POS[0] + rr(-50, 50), cz: LAGOON_POS[1] + rr(-20, 20), y: rr(2.5, 6.5), rad: rr(4, 10), speed: rr(0.45, 0.85), phase: rr(0, TAU), scale: rr(0.75, 1.0), animSpeed: 2.0, mode: 2 });
  }
  addCohort('kingfishers', buildBirdMesh([0.76, 0.36, 0.16], [0.10, 0.56, 0.78], [0.16, 0.16, 0.18], 0.52, 0.22, false, [0.12, 0.58, 0.82]), kingfishers, 10, 20, { label: 'Amazon Kingfisher', domain: 'air' });

  const flamingos = [];
  for (let i = 0; i < 18; i++) {
    const onBeach = i >= 12;
    const base = onBeach ? BEACH_POS : POND_POS;
    flamingos.push({ type: 'idle', x: base[0] + rr(-18, 18), y: 0.45, z: base[1] + rr(-14, 14), yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.08, 1.32), animSpeed: 0.6, mode: 0 });
  }
  addCohort('flamingos', buildBirdMesh([0.90, 0.44, 0.54], [0.86, 0.34, 0.44], [0.18, 0.16, 0.18], 0.8, 0.2, true), flamingos, 9, 40, { label: 'Caribbean Flamingo', domain: 'land' });

  const herons = [];
  for (let i = 0; i < 14; i++) {
    const inSwamp = i < 8;
    const cx = inSwamp ? CYPRESS_POS[0] + rr(-45, 45) : MANGROVE_POS[0] + rr(-30, 30);
    const cz = inSwamp ? CYPRESS_POS[1] + rr(-45, 45) : MANGROVE_POS[1] + rr(-30, 30);
    herons.push({ type: 'idle', x: cx, y: 0.48, z: cz, yaw: rr(0, TAU), phase: rr(0, TAU), scale: rr(1.12, 1.40), animSpeed: 0.6, mode: 0 });
  }
  addCohort('herons', buildBirdMesh([0.88, 0.90, 0.90], [0.80, 0.84, 0.88], [0.88, 0.66, 0.18], 0.95, 0.26, true), herons, 9, 25, { label: 'Great White Egret', domain: 'land' });

  const woodpeckers = [];
  for (let i = 0; i < 8; i++) {
    const cx = CYPRESS_POS[0] + rr(-55, 55), cz = CYPRESS_POS[1] + rr(-55, 55);
    woodpeckers.push({ type: 'flyCircle', cx, cz, y: rr(6, 15), rad: rr(6, 14), speed: rr(0.35, 0.65), phase: rr(0, TAU), scale: rr(0.85, 1.15), animSpeed: 1.6, mode: 2 });
  }
  addCohort('woodpeckers', buildBirdMesh([0.14, 0.14, 0.16], [0.18, 0.18, 0.20], [0.35, 0.32, 0.30], 0.56, 0.20, false, [0.82, 0.14, 0.12]), woodpeckers, 8, 22, { label: 'Pileated Woodpecker', domain: 'air' });

  // --- Fish Schools & Invertebrates ---
  const fish = [];
  for (let s = 0; s < 10; s++) {
    const inReef = s >= 5;
    const sx = inReef ? lerp(-130, 95, (s - 5) / 4) : lerp(-60, 110, s / 4);
    const sz = inReef ? 235 + sin(s) * 28 : 14 + sin(s) * 18;
    const baseDepth = inReef ? -3.4 : -0.85;
    for (let k = 0; k < 14; k++) {
      fish.push({
        type: 'swimCircle',
        schoolId: s,
        cx: sx + rr(-4, 4),
        cz: sz + rr(-4, 4),
        y: baseDepth + rr(-1.8, 0.6),
        baseY: baseDepth + rr(-1.8, 0.6),
        rad: rr(2.5, 7.5),
        speed: rr(0.45, 0.95),
        phase: rr(0, TAU),
        scale: rr(0.85, 1.45),
        animSpeed: 2.2,
        mode: 1
      });
    }
  }
  addCohort('fish', buildFishManateeMesh([0.88, 0.64, 0.22], false), fish, 0, 8, { label: 'Golden Reef & River Fish', domain: 'water', eyeOffset: [0, 0.06, 0.22], followDist: 2.4, baseSpeed: 7.5 });

  const butterflies = [];
  for (let i = 0; i < 80; i++) {
    const inClearing = i < 45;
    const cx = inClearing ? CLEARING_POS[0] + rr(-38, 38) : rr(-90, 90);
    const cz = inClearing ? CLEARING_POS[1] + rr(-35, 35) : rr(-70, 70);
    terrainAt(cx, cz, t);
    butterflies.push({ type: 'flyCircle', cx, cz, y: max(0.8, t.h + rr(0.9, 3.2)), rad: rr(1.2, 4.5), speed: rr(0.8, 1.8), phase: rr(0, TAU), scale: rr(0.9, 1.40), animSpeed: 2.2, mode: 2 });
  }
  addCohort('butterflies', buildButterflyInsectMesh([0.16, 0.62, 0.88], [0.88, 0.60, 0.14], false), butterflies, 18, 4, { label: 'Blue Morpho Butterfly', domain: 'air' });

  const dragonflies = [];
  for (let i = 0; i < 32; i++) {
    const inLagoon = i < 18;
    const cx = inLagoon ? LAGOON_POS[0] + rr(-42, 42) : POND_POS[0] + rr(-18, 18);
    const cz = inLagoon ? LAGOON_POS[1] + rr(-20, 20) : POND_POS[1] + rr(-18, 18);
    dragonflies.push({ type: 'flyCircle', cx, cz, y: rr(0.35, 1.6), rad: rr(1.5, 4.0), speed: rr(1.1, 2.2), phase: rr(0, TAU), scale: rr(0.95, 1.35), animSpeed: 3.0, mode: 2 });
  }
  addCohort('dragonflies', buildButterflyInsectMesh([0.22, 0.68, 0.64], [0.76, 0.84, 0.88], true), dragonflies, 19, 4, { label: 'Emerald Dragonfly', domain: 'air' });

  const beetles = [];
  for (let i = 0; i < 24; i++) {
    const cx = AMAZON_POS[0] + rr(-48, 48), cz = AMAZON_POS[1] + rr(-48, 48);
    terrainAt(cx, cz, t);
    beetles.push({ type: 'walkCircle', cx, cz, rad: rr(0.6, 2.2), speed: rr(0.25, 0.55), phase: rr(0, TAU), scale: rr(0.9, 1.3), animSpeed: 1.5, mode: 0 });
  }
  addCohort('beetles', buildBeetleMesh(), beetles, 19, 3, { label: 'Hercules Rhinoceros Beetle', domain: 'land' });

  const lookdevRig = {
    sphereMesh: buildLookdevMesh(),
    swatchMesh: buildSwatchBarMesh(),
    instData: new Float32Array(24)
  };

  // ==========================================================================
  // Partitioned GPU Particles: [base] -> [bubbles] -> [rain]
  // ==========================================================================
  const MAX_PARTICLES = MAX_PARTICLES_BUDGET;
  const particles = new Float32Array(MAX_PARTICLES * 8);
  const particleState = [];
  const baseCount = Math.floor(MAX_PARTICLES * 0.72);
  const bubbleStart = baseCount;
  const bubbleCount = Math.floor(MAX_PARTICLES * 0.08);
  const rainStart = bubbleStart + bubbleCount;
  const rainCount = MAX_PARTICLES - rainStart;
  const particleRanges = { baseCount, bubbleStart, bubbleCount, rainStart, rainCount };

  for (let i = 0; i < MAX_PARTICLES; i++) {
    let kind = 3, x = 0, y = 0, z = 0, size = 0.2, r = 0.5, g = 0.7, b = 0.3, vx = 0, vy = 0, vz = 0, life = rnd();
    if (i < baseCount) {
      const f = i / baseCount;
      if (f < 0.16) {
        kind = 0;
        const useVolcano = i % 3 === 0;
        const base = useVolcano ? VOLCANO_POS : FIRE_POS;
        const a = rr(0, TAU), rad = rr(0, 26);
        x = base[0] + cos(a) * rad; z = base[1] + sin(a) * rad;
        terrainAt(x, z, t);
        y = t.h + 0.5; size = rr(1.1, 2.7); r = 1; g = 0.5; b = 0.1; vy = rr(1.8, 3.8);
      } else if (f < 0.34) {
        kind = 1;
        const useVolcano = i % 3 === 0;
        const base = useVolcano ? VOLCANO_POS : FIRE_POS;
        const a = rr(0, TAU), rad = rr(0, 34);
        x = base[0] + cos(a) * rad; z = base[1] + sin(a) * rad;
        terrainAt(x, z, t);
        y = t.h + rr(2, 36); size = rr(3.5, 8.8); r = 0.9; g = y < 18 ? 0.6 : 0.1; b = 0;
        vx = rr(-0.6, -0.2); vy = rr(1.6, 3.2); vz = rr(-0.4, 0.2);
      } else if (f < 0.50) {
        kind = 2;
        if (i % 2 === 0) {
          x = FIRE_POS[0] + rr(-36, 36); z = FIRE_POS[1] + rr(-36, 36);
          terrainAt(x, z, t);
          y = t.h + rr(1, 24); size = rr(0.12, 0.28); r = 1.0; g = 0.42; b = 0.08; vy = rr(1.2, 2.8);
        } else {
          x = FORGOTTEN_POS[0] + rr(-60, 60); z = FORGOTTEN_POS[1] + rr(-60, 60);
          terrainAt(x, z, t);
          y = max(0.5, t.h + rr(0.6, 6.0)); size = rr(0.10, 0.22); r = 0.25; g = 0.98; b = 0.72; vy = rr(-0.15, 0.15);
        }
      } else if (f < 0.80) {
        kind = 3;
        x = rr(-240, 240); z = rr(-220, 220);
        terrainAt(x, z, t);
        y = max(1, t.h + rr(1, 26)); size = rr(0.10, 0.20);
        const isPetal = i % 7 === 0;
        r = isPetal ? rr(0.82, 0.92) : rr(0.42, 0.78);
        g = isPetal ? rr(0.45, 0.66) : rr(0.60, 0.85);
        b = isPetal ? rr(0.60, 0.78) : rr(0.20, 0.38);
        vy = rr(-0.55, -0.15);
      } else {
        kind = 5; // Atmospheric pollen / Underwater marine snow
        x = rr(-42, 42); y = rr(-8, 18); z = rr(-42, 42);
        size = rr(0.06, 0.14); r = 0.90; g = 0.88; b = 0.68; vy = rr(-0.08, 0.12);
      }
    } else if (i < rainStart) {
      kind = 6; // Underwater rising hydrothermal & reef bubbles (Abyssal Garden)
      x = rr(-24, 24); y = rr(-14.0, -0.2); z = rr(-24, 24);
      size = rr(0.035, 0.085); r = 0.8; g = 0.94; b = 0.96; vy = rr(0.55, 1.35);
    } else {
      kind = 4; // Marshall-Palmer rain / Polar blizzard snow streaks
      const layer = (i - rainStart) % 3;
      const span = layer === 0 ? 5.5 : layer === 1 ? 16 : 34;
      x = rr(-span, span); y = rr(-6, 26); z = rr(-span, span);
      size = layer === 0 ? rr(0.06, 0.10) : rr(0.08, 0.14);
      r = 0.78; g = 0.86; b = 0.92; vy = -21;
    }
    particleState.push({ kind, bx: x, by: y, bz: z, x, y, z, vx, vy, vz, size, r, g, b, life, phase: rr(0, TAU) });
  }

  // Push idle ground wildlife cleanly outside trees/rocks on startup
  const _anCol = {};
  const _ikOut = {};
  const _hazardOut = {};
  for (let g = 0; g < wildlifeGroups.length; g++) {
    const grp = wildlifeGroups[g];
    for (let i = 0; i < grp.items.length; i++) {
      const it = grp.items[i];
      if (it.type === 'idle' && it.y < 4.0) {
        resolveWorldCollision(it.x, it.y + 0.3, it.z, clamp(0.45 * it.scale, 0.2, 0.9), 0, 0, _anCol, 0.02);
        if (_anCol.hit) {
          it.x = it.prevX = _anCol.x;
          it.z = it.prevZ = _anCol.z;
          terrainAt(it.x, it.z, t);
          it.y = it.prevY = max(-0.05, t.h);
        }
      }
    }
  }

  // ==========================================================================
  // Fixed-Rate (120 Hz) Ecological Survival FSM + Canonical IK Locomotion
  // ==========================================================================
  let simTime = 0;
  let hazardAvoidanceEnabled = true;
  let activeSurvivalEvent = 'Lions stalking Plains Zebras across the Serengeti Savanna';

  // Quick lookup for predator-prey interactions
  const predatorGroups = wildlifeGroups.filter((g) => g.role === 'predator');
  const preyGroups = wildlifeGroups.filter((g) => g.role === 'herbivore' && g.items.length > 0);

  const EMOTION_NAMES = [
    'Calm · Grazing & Breathing',
    'Curious · Social Head-Tilt',
    'Alert · Horizon Vigilance',
    'Dominant · Vocalizing / Stalking',
    'Startled · Evading Threat'
  ];

  function stepSim(dt, camX, camY, camZ, rainIntensity, windStrength = 0.45) {
    simTime += dt;

    // Periodic predator-prey awareness & hunt trigger (throttled across frames)
    const scanIdx = floor(simTime * 12) % max(1, predatorGroups.length);
    const predGrp = predatorGroups[scanIdx];
    if (predGrp && predGrp.items.length > 0) {
      const pItem = predGrp.items[floor(simTime * 3) % predGrp.items.length];
      if (!pItem.playerControlled) {
        for (let pg = 0; pg < preyGroups.length; pg++) {
          const preyGrp = preyGroups[pg];
          if (preyGrp.domain !== predGrp.domain && predGrp.name !== 'orcas') continue;
          const prItem = preyGrp.items[0];
          const distPP = hypot(pItem.x - prItem.x, pItem.z - prItem.z);
          if (distPP < 65) {
            pItem.state = distPP < 26 ? 'chase' : 'stalk';
            pItem.emotion = 3;
            prItem.state = 'flee';
            prItem.emotion = 4;
            prItem.fleeTimer = 3.5;
            activeSurvivalEvent = `${predGrp.label} ${pItem.state === 'chase' ? 'hunting' : 'stalking'} ${preyGrp.label}`;
            break;
          }
        }
      }
    }

    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      const items = grp.items;
      const isFishSchool = grp.name === 'fish';

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.prevX = it.x;
        it.prevY = it.y;
        it.prevZ = it.z;
        it.prevYaw = it.yaw;

        if (it.roarTimer > 0) {
          it.roarTimer = max(0, it.roarTimer - dt);
          it.emotion = 3;
        }

        // Skip autonomous steering if currently embodied & controlled by the player!
        if (it.playerControlled) continue;

        const dCam = hypot(wrapDelta(it.x, camX), wrapDelta(it.z, camZ));
        const dFire = hypot(wrapDelta(it.x, FIRE_POS[0]), wrapDelta(it.z, FIRE_POS[1]));

        // Dynamic emotional & behavioral expression state machine
        it.emotionTimer -= dt;
        if (it.roarTimer <= 0) {
          if (it.state === 'flee' || dFire < 35) {
            it.emotion = 4;
          } else if (it.state === 'chase' || it.state === 'stalk') {
            it.emotion = 3;
          } else if (dCam < it.flightDist * 1.45) {
            it.emotion = (i % 2 === 0) ? 2 : 1; // Alert scan or Curious head-tilt toward observer
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

        if (it.type === 'walkCircle') {
          let spd = it.speed;
          if (dCam < it.flightDist && it.flightDist >= 10 && grp.role !== 'predator') {
            it.state = 'flee';
            it.emotion = 4;
            it.fleeTimer = 2.0;
          } else if (it.fleeTimer > 0) {
            it.fleeTimer -= dt;
            if (it.fleeTimer <= 0) it.state = 'forage';
          }
          if (it.state === 'flee' || it.state === 'chase' || dFire < 35) spd *= 2.25;
          else if (it.state === 'stalk') spd *= 0.55;
          else if (rainIntensity > 0.65) spd *= 0.68;

          it.ang += spd * dt;
          let tx = it.cx + cos(it.ang) * it.rad;
          let tz = it.cz + sin(it.ang) * it.rad;

          // Hazard avoidance steering (deep water, steep cliffs, fire, volcanic lava)
          if (hazardAvoidanceEnabled) {
            evaluateHazardAt(tx, tz, 0, _hazardOut);
            if (_hazardOut.hazard > 0.18) {
              const pushStr = _hazardOut.hazard * 2.2;
              it.cx = clamp(it.cx - _hazardOut.gradX * pushStr * dt, -WORLD_HALF + 18, WORLD_HALF - 18);
              it.cz = clamp(it.cz - _hazardOut.gradZ * pushStr * dt, -WORLD_HALF + 18, WORLD_HALF - 18);
              tx -= _hazardOut.gradX * pushStr * 0.35;
              tz -= _hazardOut.gradZ * pushStr * 0.35;
            }
          }

          terrainAt(tx, tz, t);
          const colR = clamp(0.45 * it.scale, 0.18, 0.95);
          resolveWorldCollision(tx, max(-0.1, t.h) + 0.25, tz, colR, 0, 0, _anCol, 0.0);
          it.x = _anCol.x;
          it.z = _anCol.z;
          terrainAt(it.x, it.z, t);

          // Analytical 2-Bone IK Foot-Pinning & Zero-Slide Stride Coupling (v = f_stride * L_stride)
          const mvx = it.x - it.prevX, mvz = it.z - it.prevZ;
          const stepDist = hypot(mvx, mvz);
          it.vx = mvx / max(1e-5, dt);
          it.vz = mvz / max(1e-5, dt);
          it.phase = (it.phase + (stepDist / max(0.18, it.strideLen)) * 1.15) % TAU;

          // Canonical heading: local +Z forward rotates to world (-sin(yaw), cos(yaw))
          const targetYaw = (stepDist > 1e-5) ? velocityToYaw(mvx, mvz, it.yaw) : normAngle(it.ang);
          it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * 24.0));

          const [fx, fz] = yawToForward(it.yaw);
          const legLen = 0.42 * it.scale;
          solveTwoBoneIK(it.x, t.h + legLen * 1.85, it.z, it.x, t.h, it.z, fx, 0, fz, legLen, legLen, _ikOut);
          it.y = t.h;
        } else if (it.type === 'swimCircle') {
          let spd = it.speed;
          if (dCam < it.flightDist) spd *= 1.65;
          it.ang += spd * dt;
          let tx = it.cx + cos(it.ang) * it.rad;
          let tz = it.cz + sin(it.ang) * it.rad;

          // 3D Boids Schooling for Reef & River Fish Cohorts (Separation + Alignment + Cohesion + Depth-Keeping)
          if (isFishSchool) {
            const schoolStart = (i / 14 | 0) * 14;
            const schoolEnd = min(items.length, schoolStart + 14);
            let sepX = 0, sepY = 0, sepZ = 0;
            let cohX = 0, cohY = 0, cohZ = 0;
            let aliSpd = 0, neighbors = 0;
            for (let j = schoolStart; j < schoolEnd; j++) {
              if (j === i) continue;
              const nb = items[j];
              const dx = it.x - nb.x, dy = it.y - nb.y, dz = it.z - nb.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < 25.0 && d2 > 1e-6) {
                const d = sqrt(d2);
                if (d < 1.35) {
                  const rep = (1.35 - d) / d;
                  sepX += dx * rep;
                  sepY += dy * rep;
                  sepZ += dz * rep;
                }
                cohX += nb.x;
                cohY += nb.y;
                cohZ += nb.z;
                aliSpd += nb.speed;
                neighbors++;
              }
            }
            if (neighbors > 0) {
              const invN = 1 / neighbors;
              const toCenterX = (cohX * invN - it.x) * 0.22;
              const toCenterY = (cohY * invN - it.y) * 0.25;
              const toCenterZ = (cohZ * invN - it.z) * 0.22;
              it.boidsX = clamp(lerp(it.boidsX, sepX * 0.85 + toCenterX, dt * 4.5), -2.4, 2.4);
              it.boidsY = clamp(lerp(it.boidsY, sepY * 0.45 + toCenterY, dt * 3.5), -0.85, 0.85);
              it.boidsZ = clamp(lerp(it.boidsZ, sepZ * 0.85 + toCenterZ, dt * 4.5), -2.4, 2.4);
              it.speed = lerp(it.speed, aliSpd * invN, dt * 1.5);
            }
            tx += it.boidsX;
            tz += it.boidsZ;
            const baseDepth = it.baseY ?? (it.baseY = it.y);
            it.y = clamp(baseDepth + it.boidsY + sin(simTime * 1.4 + it.phase) * 0.14, -18.0, -0.22);
          }

          // Marine shallow-water stranding avoidance
          if (hazardAvoidanceEnabled) {
            evaluateHazardAt(tx, tz, 1, _hazardOut);
            if (_hazardOut.hazard > 0.25) {
              const pushStr = _hazardOut.hazard * 1.8;
              tx -= _hazardOut.gradX * pushStr * 0.35;
              tz -= _hazardOut.gradZ * pushStr * 0.35;
            }
          }

          const colR = clamp(0.42 * it.scale, 0.16, 0.85);
          resolveWorldCollision(tx, it.y + 0.15, tz, colR, 0, 0, _anCol, -22.0);
          it.x = _anCol.x;
          it.z = _anCol.z;
          // Periodic surface breaching for Humpback Whales & Orcas
          if (grp.speciesId === 31 || grp.speciesId === 32) {
            const baseDepth = it.baseY ?? (it.baseY = it.y);
            const breachWave = sin(simTime * 0.45 + it.phase);
            it.y = breachWave > 0.82 ? lerp(baseDepth, 1.4, (breachWave - 0.82) / 0.18) : baseDepth + sin(simTime * 0.8 + it.phase) * 0.6;
          }
          const mvx = it.x - it.prevX, mvz = it.z - it.prevZ;
          const stepDist = hypot(mvx, mvz);
          it.vx = mvx / max(1e-5, dt);
          it.vz = mvz / max(1e-5, dt);
          it.phase = (it.phase + (stepDist / max(0.25, it.strideLen)) * 0.95) % TAU;
          const targetYaw = (stepDist > 1e-5) ? velocityToYaw(mvx, mvz, it.yaw) : normAngle(it.ang);
          it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * 24.0));
        } else if (it.type === 'flyCircle') {
          const spd = it.speed * (rainIntensity > 0.7 ? 0.72 : 1.0);
          it.ang += spd * dt;
          const tx = it.cx + cos(it.ang) * it.rad;
          const tz = it.cz + sin(it.ang) * it.rad;
          const baseAlt = it.baseY ?? (it.baseY = it.y);
          const ty = baseAlt + sin(simTime * 1.15 + it.phase) * 0.9 + sin(simTime * 2.67 + it.phase * 1.7) * 0.35;
          resolveWorldCollision(tx, ty, tz, 0.45, 0, 0, _anCol, 0.35);
          it.x = _anCol.x;
          it.y = _anCol.y;
          it.z = _anCol.z;
          const mvx = it.x - it.prevX, mvz = it.z - it.prevZ;
          const stepDist = hypot(mvx, mvz);
          it.vx = mvx / max(1e-5, dt);
          it.vz = mvz / max(1e-5, dt);
          const targetYaw = (stepDist > 1e-5) ? velocityToYaw(mvx, mvz, it.yaw) : normAngle(it.ang);
          it.yaw = lerpAngle(it.yaw, targetYaw, min(1.0, dt * 24.0));
        }
      }
    }

    const doRain = rainIntensity >= 0.02 && camY >= 0;
    const doBubbles = camY < 0.8 || camZ > 175;

    for (let i = 0; i < baseCount; i++) {
      const p = particleState[i];
      if (p.kind === 5) {
        p.x = camX + p.bx + sin(simTime * 0.55 + p.phase) * 2.2;
        p.y = camY + p.by + cos(simTime * 0.42 + p.phase) * 1.4;
        p.z = camZ + p.bz + sin(simTime * 0.48 + p.phase * 1.3) * 2.2;
      } else if (p.kind === 0 || p.kind === 1) {
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
        const o = i * 8;
        out[o]     = lerp(it.prevX, it.x, a);
        out[o + 1] = lerp(it.prevY, it.y, a);
        out[o + 2] = lerp(it.prevZ, it.z, a);
        out[o + 3] = it.scale;
        out[o + 4] = lerpAngle(it.prevYaw, it.yaw, a);
        out[o + 5] = it.phase;
        const effSpd = (it.state === 'flee' || it.state === 'chase') ? it.animSpeed * 2.1 : it.animSpeed;
        const emo = clamp(round(it.emotion || 0), 0, 4);
        out[o + 6] = emo + clamp(effSpd * 0.1, 0.03, 0.95);
        out[o + 7] = it.packedMode;
      }
    }

    for (let i = 0; i < baseCount; i++) {
      const p = particleState[i];
      const o = i * 8;
      particles[o]     = p.x;
      particles[o + 1] = p.y;
      particles[o + 2] = p.z;
      if (p.kind === 0 || p.kind === 1) {
        particles[o + 3] = p.size * (p.kind === 0 ? (1 - p.life * 0.7) : (0.6 + p.life * 1.3));
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

    if (rainIntensity >= 0.02 && camY >= 0) {
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
    d[0] = cx - rx * 0.56; d[1] = cy_; d[2] = cz - rz * 0.56; d[3] = 1.0;
    d[4] = yaw; d[5] = 0; d[6] = 0.1; d[7] = 21 * 16;
    d[8] = cx; d[9] = cy_; d[10] = cz; d[11] = 1.0;
    d[12] = yaw; d[13] = 0; d[14] = 0.1; d[15] = 22 * 16;
    d[16] = cx + rx * 0.62; d[17] = cy_; d[18] = cz + rz * 0.62; d[19] = 1.0;
    d[20] = yaw; d[21] = 0; d[22] = 0.1; d[23] = 23 * 16;
  }

  function findNearestAnimal(x, y, z, maxDist = 45) {
    let bestGrp = -1, bestIdx = -1, bestD = maxDist;
    for (let g = 0; g < wildlifeGroups.length; g++) {
      const grp = wildlifeGroups[g];
      for (let i = 0; i < grp.items.length; i++) {
        const it = grp.items[i];
        const d = hypot(wrapDelta(it.x, x), it.y - y, wrapDelta(it.z, z));
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
    GRID_CELLS, CELL_SPAN, SIM_HZ, SIM_DT,
    chunks, skirt, hData, hSize,
    vegBuffers, wildlifeGroups, lookdevRig,
    colliders, colliderCells, resolveWorldCollision,
    particles, particleState, particleRanges, MAX_PARTICLES,
    stepSim, interpolateSim, updateDynamic, updateLookdevRig,
    findNearestAnimal,
    setHazardAvoidance: (enabled) => { hazardAvoidanceEnabled = !!enabled; },
    getHazardAvoidance: () => hazardAvoidanceEnabled,
    EMOTION_NAMES,
    getActiveSurvivalEvent: () => activeSurvivalEvent
  };
}

export { buildWorld };
