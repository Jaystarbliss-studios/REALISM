// ============================================================================
// REALISM — Main WebGPU Engine, True Earth-Scale Cube-Sphere Quadtree,
// Continuous Atmospheric Re-Entry, Unified 3D Planetary Globe & 2D Map,
// Playable Animal Embodiment (1st & 3rd Person Orbit POV) & Settings Panel
// ============================================================================
import {
  SHADOW_SIZE, AA_SAMPLES, TARGET_GPU_MS, RES_SCALE_MIN, RES_SCALE_MAX, keep,
  QUALITY_TIERS, loadSettings, saveSettings, resetSettings, createQualityController
} from './quality.js';

const DPR_CAP = 1.25;
const SHADOW_RES = SHADOW_SIZE;
const RAY_SCALE = 0.35;
const MSAA_SAMPLES = AA_SAMPLES;
import {
  PI, TAU, DEG2RAD, RAD2DEG, sin, cos, tan, abs, hypot, min, max, sqrt, floor, round, atan2, exp, pow,
  clamp, saturate, lerp, smoothstep, WORLD_SEED, rr,
  normAngle, lerpAngle, yawToForward, velocityToYaw,
  oblateRadiusAtSinLat, latLonToDir, dirToLatLon, geodeticToEcef, localENUFrame,
  moveAlongGeodesic, greatCircleDistanceMeters, dirToCubeFaceUV,
  m4Mul, m4Persp, m4Ortho, m4Look, m4Inv
} from './math.js';
import {
  PLANET_RADIUS, KARMAN_LINE_ALT, ATMOSPHERE_LAYERS,
  atmosphericDensityAt, atmosphericLayerAt, reentryStageAt, stepAtmosphericReentry,
  BIOME_CATALOG, POSES, setActiveOrigin, getActiveOrigin,
  localMetersToLatLon, latLonToLocalMeters, samplePlanetAtLatLon, terrainAt,
  nearestBiomeAtGeo, biomeLabelAtGeo, spaceSectorAt,
  classifyEcoregionAt, upgradeEarthGeoAtlas,
  TILE_GRID, TILE_TOTAL_VERTS, TILE_FLOATS_PER_VERT, CubeSphereQuadtree
} from './biomes.js';
import {
  ensureSpeciesCatalogueLoaded, queryRegionalSpeciesRoster, getLoadedSpeciesCatalogue
} from './species_engine.js';
import {
  AU_METERS, SOLAR_BODIES, SOLAR_BODY_BY_ID, EARTH_ORBIT_HANDOFF_ALT,
  createSolarSystemState, updateSolarEphemeris, syncSolarFromEarthCam,
  solarToEarthGeodetic, stepInterplanetaryFlight, projectSolarBodiesToENU,
  formatDistanceSI, formatSpeedSI, formatEtaSI
} from './solar_system.js';
import { uploadMaterialTextureArray } from './assets.js';
import {
  W_SKY, W_TERRAIN, W_VEG, W_ANIMAL, W_WATER, W_PARTICLE, W_RAYS, W_RAYS_MS, W_POST, W_POST_MS
} from './shaders.js';
import { buildWorld } from './world.js';
import {
  initAudio, updateAudio, setVolume, setAudioSettings, toggleMute,
  triggerSpeciesCall, triggerWhaleSong, triggerOrcaCall, triggerBreachSplash, triggerSurfacingBreath
} from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const lt = $('lt');
const lb = $('lb');
const errBox = $('err');
const goBtn = $('go');
const locEl = $('loc');
const weatherEl = $('weatherLabel');
const coordBadgeEl = $('coordBadge');
const layerLabelEl = $('layerLabel');
const coordLabelEl = $('coordLabel');
const embodyLabelEl = $('embodyLabel');
const embodyHintEl = $('embodyHint');
const survivalLabelEl = $('survivalLabel');
const infoEl = $('info');
const shutterValEl = $('shutterVal');

const mapModal = $('mapModal');
const planetMapCanvas = $('planetMapCanvas');
const mapTooltip = $('mapTooltip');
const mapPinBar = $('mapPinBar');
const embodimentModal = $('embodimentModal');
const speciesGrid = $('speciesGrid');
const togglePovBtn = $('togglePovBtn');
const modalPovToggleBtn = $('modalPovToggleBtn');
const settingsModal = $('settingsModal');

const say = async (t, p) => {
  if (lt) lt.textContent = t;
  if (lb) lb.style.width = round(p * 100) + '%';
  await new Promise((r) => requestAnimationFrame(r));
};
const fail = (msg) => {
  if (errBox) {
    errBox.style.display = 'block';
    errBox.textContent = msg;
  }
  if (lt) lt.textContent = 'Unable to start WebGPU renderer.';
  throw new Error(msg);
};

// ============================================================================
// Double-Precision Planetary Geodetic Camera & Floating-Origin State
// ============================================================================
const F = new Float64Array(16);
const TIME = 0, LAST = 1, FLT = 2, CX = 3, CY = 4, CZ = 5, VX = 6, VY = 7, VZ = 8, YAW = 9, PIT = 10;

const startBiome = BIOME_CATALOG[0];
const camState = {
  latDeg: startBiome.latDeg,
  lonDeg: startBiome.lonDeg,
  latRad: startBiome.latDeg * DEG2RAD,
  lonRad: startBiome.lonDeg * DEG2RAD,
  altMeters: 6.5,
  velE: 0,
  velN: 0,
  velU: 0,
  yaw: 0,
  pitch: -0.08,
  reentryHeat: 0,
  groundH: 0,
  grounded: false,
  layer: atmosphericLayerAt(6.5),
  stage: reentryStageAt(6.5, 0, 0),
  autopilot: null // null | 'ascent' | 'descent'
};

let settings = loadSettings();
const qualityCtrl = createQualityController(settings.qualityTier);
const solarState = createSolarSystemState();
let solarInterplanetaryBlend = 0.0;

let menu = true;
let flyActive = false;
let showHud = Boolean(settings.showTelemetry);
let cleanUi = settings.showHud === false;
let photoMode = false;
let lookdevMode = false;
let autoExplore = false;
let speedMult = settings.moveSpeedMult || 1.0;
let weatherMode = settings.weatherMode !== undefined ? settings.weatherMode : -1;
let todIdx = settings.todIdx || 0;
let instinctPulse = 0.0;

let focalMm = round(18 / tan(((settings.fov || 54) * PI) / 360));
let apertureF = 2.8;
let focusDistM = 18;
let evComp = 0.0;

let lastActivityAt = performance.now();
const IDLE_EXPLORE_SEC = 35.0;
let autoTargetX = 0, autoTargetY = 6, autoTargetZ = 0, autoLegTimer = 0;

// Playable Animal Embodiment State with Decoupled 3rd-Person Orbit Camera
const embodiedState = {
  active: false,
  groupIdx: -1,
  itemIdx: 0,
  pov: settings.defaultPov === 1 ? '1st' : '3rd',
  vy: 0,
  pitch: 0,
  orbitYaw: 0,
  orbitPitch: 0.22
};

const TOD_PRESETS = [
  { name: 'Golden Hour', sunElev: 0.25, sunAz: 0.62, sunInt: 1.08, sunCol: [1.0, 0.80, 0.52], zen: [0.09, 0.27, 0.44], hor: [0.76, 0.56, 0.34], fog: [0.34, 0.42, 0.30] },
  { name: 'High Noon',   sunElev: 0.82, sunAz: 0.30, sunInt: 1.22, sunCol: [1.0, 0.96, 0.88], zen: [0.08, 0.34, 0.62], hor: [0.52, 0.68, 0.72], fog: [0.36, 0.48, 0.44] },
  { name: 'Blue Dusk',   sunElev: 0.07, sunAz: -0.55, sunInt: 0.42, sunCol: [0.92, 0.48, 0.32], zen: [0.04, 0.09, 0.20], hor: [0.28, 0.24, 0.32], fog: [0.12, 0.17, 0.22] }
];
const TOD_NAMES = TOD_PRESETS.map((p) => p.name);

const WEATHER_NAMES = [
  'Golden Sunlight',
  'Swamp Morning Mist',
  'Tropical Monsoon Storm',
  'Savanna Heat Haze & Dust Devils',
  'Coastal Shorebreak Surf',
  'Polar Blizzard',
  'Polar Night & Aurora',
  'Volcanic Ash & Wildfire'
];
const WEATHER_PRESETS = [
  { fogD: 0.0020, mist: 0.38, cloud: 0.28, fire: 0.42, wind: 0.36, rain: 0.0,  sunScale: 1.05, skyTint: [1.0, 1.0, 1.0] },
  { fogD: 0.0048, mist: 1.32, cloud: 0.62, fire: 0.25, wind: 0.24, rain: 0.06, sunScale: 0.76, skyTint: [0.85, 0.94, 0.88] },
  { fogD: 0.0058, mist: 0.95, cloud: 0.92, fire: 0.15, wind: 0.92, rain: 1.0,  sunScale: 0.45, skyTint: [0.55, 0.64, 0.70] },
  { fogD: 0.0032, mist: 0.55, cloud: 0.18, fire: 0.35, wind: 0.65, rain: 0.0,  sunScale: 1.18, skyTint: [1.08, 0.92, 0.74] },
  { fogD: 0.0018, mist: 0.32, cloud: 0.34, fire: 0.20, wind: 0.58, rain: 0.0,  sunScale: 1.12, skyTint: [0.92, 1.02, 1.06] },
  { fogD: 0.0064, mist: 1.40, cloud: 0.95, fire: 0.10, wind: 1.15, rain: 0.95, sunScale: 0.62, skyTint: [0.82, 0.92, 1.05] },
  { fogD: 0.0016, mist: 0.28, cloud: 0.15, fire: 0.35, wind: 0.30, rain: 0.0,  sunScale: 0.14, skyTint: [0.18, 0.32, 0.48] },
  { fogD: 0.0044, mist: 0.68, cloud: 0.74, fire: 1.38, wind: 0.78, rain: 0.0,  sunScale: 0.82, skyTint: [1.15, 0.72, 0.52] }
];

let wakeBrandWordmark = () => {};

function syncBodyClasses() {
  document.body.className = menu ? 'm' : 'g';
  if (cleanUi) document.body.classList.add('clean');
  if (settings.showMiniMap === false) document.body.classList.add('hide-minimap');
  if (photoMode) document.body.classList.add('photo');
}
let menuNeedsBackdrop = false;
function setMenu(open) {
  menu = open;
  syncBodyClasses();
  if (open) {
    wakeBrandWordmark();
  } else {
    F[LAST] = performance.now();
    forceSyncTiles = true;
    simAcc = 0;
  }
}
function noteUserActivity() {
  lastActivityAt = performance.now();
  if (autoExplore) autoExplore = false;
}

// ============================================================================
// Interactive Pixel-by-Pixel Wavy "REALISM" Welcome Wordmark
// Bespoke architectural bitmap pixel mosaic with spring-damped wave physics,
// live mouse/touch wake ripples, and zero CPU cost once in-game.
// ============================================================================
(function initInteractiveBrandWordmark() {
  const bc = $('brandCanvas');
  if (!bc) return;
  const ctx = bc.getContext('2d');
  if (!ctx) return;

  const GLYPHS = {
    R: [
      '########.',
      '#########',
      '##.....##',
      '##.....##',
      '##....###',
      '########.',
      '#######..',
      '##...##..',
      '##....##.',
      '##.....##',
      '##.....##'
    ],
    E: [
      '########',
      '########',
      '##......',
      '##......',
      '#######.',
      '#######.',
      '##......',
      '##......',
      '##......',
      '########',
      '########'
    ],
    A: [
      '..#####..',
      '.#######.',
      '##.....##',
      '##.....##',
      '##.....##',
      '#########',
      '#########',
      '##.....##',
      '##.....##',
      '##.....##',
      '##.....##'
    ],
    L: [
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '########',
      '########'
    ],
    I: [
      '######',
      '######',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '######',
      '######'
    ],
    S: [
      '.#######.',
      '#########',
      '##.....##',
      '##.......',
      '.######..',
      '..######.',
      '.......##',
      '.......##',
      '##.....##',
      '#########',
      '.#######.'
    ],
    M: [
      '###.....###',
      '####...####',
      '#####.#####',
      '###########',
      '##.#####.##',
      '##..###..##',
      '##...#...##',
      '##.......##',
      '##.......##',
      '##.......##',
      '##.......##'
    ]
  };

  const WORD = 'REALISM';
  const LOGICAL_W = 920;
  const LOGICAL_H = 250;
  const LETTER_GAP = 3;
  const SUB = 2; // 2x2 micro-pixel mosaic per glyph cell for fluid pixel-by-pixel waves

  // Compute total macro grid width
  let totalCols = 0;
  for (let i = 0; i < WORD.length; i++) {
    totalCols += GLYPHS[WORD[i]][0].length;
    if (i < WORD.length - 1) totalCols += LETTER_GAP;
  }
  const totalRows = 11;
  const macroStep = 10;
  const subPitch = macroStep / SUB; // 5px per individual pixel tile
  const pixelDrawSize = 4.1;        // Crisp 0.9px architectural hairline gap between pixels
  const wordW = totalCols * macroStep;
  const wordH = totalRows * macroStep;
  const startX = (LOGICAL_W - wordW) * 0.5;
  const startY = (LOGICAL_H - wordH) * 0.5;

  const pixels = [];
  let colCursor = 0;
  for (let li = 0; li < WORD.length; li++) {
    const ch = WORD[li];
    const rows = GLYPHS[ch];
    const cols = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (rows[r][c] !== '#') continue;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const hx = startX + (colCursor + c) * macroStep + sx * subPitch + subPitch * 0.5;
            const hy = startY + r * macroStep + sy * subPitch + subPitch * 0.5;
            const normX = (hx - startX) / wordW;
            const normY = (hy - startY) / wordH;
            pixels.push({
              hx, hy,
              x: hx, y: hy,
              vx: 0, vy: 0,
              z: 0,
              normX, normY,
              phase: normX * 9.5 + normY * 2.8 + (sx + sy) * 0.35
            });
          }
        }
      }
    }
    colCursor += cols + LETTER_GAP;
  }

  // Precomputed quantized palette (zero per-pixel string allocations per frame!)
  const GLOW_STEPS = 16;
  const PHASE_STEPS = 4;
  const PALETTE = [];
  const ECHO_PALETTE = [];
  for (let ph = 0; ph < PHASE_STEPS; ph++) {
    const cyanT = (ph / (PHASE_STEPS - 1)) * 0.45;
    const crestR = lerp(226, 92, cyanT);
    const crestG = lerp(184, 200, cyanT);
    const crestB = lerp(87, 242, cyanT);
    const row = [];
    for (let g = 0; g < GLOW_STEPS; g++) {
      const gw = (g / (GLOW_STEPS - 1)) * 0.88;
      const rCol = round(lerp(236, crestR, gw));
      const gCol = round(lerp(234, crestG, gw));
      const bCol = round(lerp(224, crestB, gw));
      row.push(`rgb(${rCol},${gCol},${bCol})`);
    }
    PALETTE.push(row);
  }
  for (let g = 0; g < GLOW_STEPS; g++) {
    const gw = g / (GLOW_STEPS - 1);
    ECHO_PALETTE.push(`rgba(218,196,132,${(gw * 0.24).toFixed(2)})`);
  }

  let dpr = 1;
  function resizeCanvas() {
    dpr = clamp(window.devicePixelRatio || 1, 1, 1.5);
    bc.width = Math.round(LOGICAL_W * dpr);
    bc.height = Math.round(LOGICAL_H * dpr);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, active: false, lastRippleAt: 0 };
  const ripples = []; // { x, y, born, strength, speed }

  function mapClientToCanvas(clientX, clientY) {
    const rect = bc.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * LOGICAL_W,
      y: ((clientY - rect.top) / rect.height) * LOGICAL_H
    };
  }

  function pushRipple(x, y, strength = 1.0, speed = 260) {
    if (reducedMotion) return;
    ripples.push({ x, y, born: performance.now() * 0.001, strength, speed });
    if (ripples.length > 6) ripples.shift();
  }

  const menuEl = $('m');
  if (menuEl) {
    menuEl.addEventListener('pointermove', (e) => {
      if (document.body.classList.contains('g')) return;
      const pt = mapClientToCanvas(e.clientX, e.clientY);
      if (!pt) return;
      const dx = pointer.active ? pt.x - pointer.x : 0;
      const dy = pointer.active ? pt.y - pointer.y : 0;
      pointer.vx = lerp(pointer.vx, clamp(dx, -48, 48), 0.45);
      pointer.vy = lerp(pointer.vy, clamp(dy, -48, 48), 0.45);
      pointer.x = pt.x;
      pointer.y = pt.y;
      pointer.active = true;

      const now = performance.now();
      const speed = hypot(dx, dy);
      if (speed > 4.0 && now - pointer.lastRippleAt > 75 && pt.y > -40 && pt.y < LOGICAL_H + 40) {
        pushRipple(pt.x, pt.y, clamp(0.45 + speed * 0.035, 0.5, 1.35), 255);
        pointer.lastRippleAt = now;
      }
    });
    menuEl.addEventListener('pointerleave', () => {
      pointer.active = false;
    });
  }

  bc.addEventListener('pointerdown', (e) => {
    const pt = mapClientToCanvas(e.clientX, e.clientY);
    if (!pt) return;
    pointer.x = pt.x;
    pointer.y = pt.y;
    pointer.active = true;
    pushRipple(pt.x, pt.y, 1.95, 340);
  });

  let rafId = 0;
  let lastT = performance.now() * 0.001;
  let lastDrawMs = 0;

  function renderFrame() {
    rafId = 0;
    if (document.body.classList.contains('g') || document.hidden) return; // 0% overhead while playing or hidden

    const nowMs = performance.now();
    // Ultra-light 30 Hz idle breathing when cursor isn't hovering; instant 60+ Hz when interactive
    const isInteractive = pointer.active || ripples.length > 0;
    if (!isInteractive && nowMs - lastDrawMs < 32) {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }
    lastDrawMs = nowMs;

    const now = nowMs * 0.001;
    const dt = clamp(now - lastT, 0.004, 0.04);
    lastT = now;
    const stepScale = dt * 60;

    pointer.vx *= Math.pow(0.86, stepScale);
    pointer.vy *= Math.pow(0.86, stepScale);

    // Prune expired ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      if (now - ripples[i].born > 1.85) ripples.splice(i, 1);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    const springK = 0.145 * stepScale;
    const damp = Math.pow(0.79, stepScale);
    const hoverRad = 128;
    const hoverRadSq = hoverRad * hoverRad;
    const ripLen = ripples.length;

    let lastFill = '';
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      let targetWaveY = 0;
      let targetWaveX = 0;
      let waveEnergy = 0;

      if (!reducedMotion) {
        const idleWave = sin(p.normX * 7.2 - now * 1.95 + p.normY * 1.6) * 1.65;
        targetWaveY += idleWave;

        if (pointer.active) {
          const dx = p.hx - pointer.x;
          const dy = p.hy - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < hoverRadSq) {
            const dist = sqrt(d2) + 0.001;
            const falloff = 1.0 - dist / hoverRad;
            const f2 = falloff * falloff;
            const crest = sin(dist * 0.095 - now * 11.5);
            targetWaveY += crest * 18.0 * f2 + pointer.vy * 0.55 * f2;
            targetWaveX += (dx / dist) * (crest * 7.5 + 8.5) * f2 + pointer.vx * 0.45 * f2;
            waveEnergy = max(waveEnergy, f2 * (0.65 + abs(crest) * 0.55));
          }
        }

        for (let r = 0; r < ripLen; r++) {
          const rp = ripples[r];
          const age = now - rp.born;
          const radius = age * rp.speed;
          const dx = p.hx - rp.x;
          const dy = p.hy - rp.y;
          const d2 = dx * dx + dy * dy;
          const maxR = radius + 76;
          const minR = max(0, radius - 76);
          if (d2 > maxR * maxR || d2 < minR * minR) continue;
          const dist = sqrt(d2) + 0.001;
          const delta = dist - radius;
          const env = exp(-(delta * delta) / 920) * (1.0 - age / 1.85) * rp.strength;
          const osc = sin(delta * 0.14);
          targetWaveY += osc * 16.5 * env;
          targetWaveX += (dx / dist) * osc * 9.0 * env;
          waveEnergy = max(waveEnergy, abs(osc) * env * 1.15);
        }

        const tx = p.hx + targetWaveX;
        const ty = p.hy + targetWaveY;
        p.vx = (p.vx + (tx - p.x) * springK) * damp;
        p.vy = (p.vy + (ty - p.y) * springK) * damp;
        p.x += p.vx * stepScale;
        p.y += p.vy * stepScale;
        p.z = lerp(p.z, waveEnergy, clamp(dt * 14, 0, 1));
      } else {
        p.x = p.hx;
        p.y = p.hy;
        p.z = 0;
      }

      const dpx = p.x - p.hx;
      const dpy = p.y - p.hy;
      const disp = sqrt(dpx * dpx + dpy * dpy);
      const glow = clamp(p.z + disp * 0.032, 0, 1);

      const sz = pixelDrawSize * (1.0 + glow * 0.16);
      const half = sz * 0.5;
      const gIdx = min(GLOW_STEPS - 1, floor(glow * GLOW_STEPS));

      if (glow > 0.30) {
        const echoFill = ECHO_PALETTE[gIdx];
        if (echoFill !== lastFill) {
          ctx.fillStyle = echoFill;
          lastFill = echoFill;
        }
        ctx.fillRect(p.hx - half * 0.85, p.hy - half * 0.85, sz * 0.85, sz * 0.85);
      }

      const phIdx = gIdx > 0
        ? min(PHASE_STEPS - 1, floor((0.5 + 0.5 * sin(p.phase - now * 4.2 + dpy * 0.12)) * PHASE_STEPS))
        : 0;
      const fill = PALETTE[phIdx][gIdx];
      if (fill !== lastFill) {
        ctx.fillStyle = fill;
        lastFill = fill;
      }
      ctx.fillRect(p.x - half, p.y - half, sz, sz);
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  wakeBrandWordmark = () => {
    if (!rafId && !document.body.classList.contains('g') && !document.hidden) {
      lastT = performance.now() * 0.001;
      rafId = requestAnimationFrame(renderFrame);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !document.body.classList.contains('g')) wakeBrandWordmark();
  });
  wakeBrandWordmark();
})();

const _locTmp = {};
const _camT = {};
const _camCol = {};

function syncCamStateFromLocal() {
  const ll = localMetersToLatLon(F[CX], F[CZ], getActiveOrigin(), _locTmp);
  camState.latDeg = ll.latDeg;
  camState.lonDeg = ll.lonDeg;
  camState.latRad = ll.latRad;
  camState.lonRad = ll.lonRad;
  camState.altMeters = F[CY];
  camState.yaw = F[YAW];
  camState.pitch = F[PIT];
  camState.layer = atmosphericLayerAt(camState.altMeters);
  camState.stage = reentryStageAt(camState.altMeters, camState.groundH, camState.velU);
}

function syncLocalFromCamState() {
  const loc = latLonToLocalMeters(camState.latDeg, camState.lonDeg, getActiveOrigin(), _locTmp);
  F[CX] = loc.x;
  F[CY] = camState.altMeters;
  F[CZ] = loc.z;
  F[YAW] = camState.yaw;
  F[PIT] = camState.pitch;
}

function lookAtPose(cx, cy, cz, tx, ty, tz) {
  F[CX] = cx; F[CY] = cy; F[CZ] = cz;
  F[VX] = F[VY] = F[VZ] = 0;
  const dx = tx - cx, dy = ty - cy, dz = tz - cz;
  const d = hypot(dx, dy, dz) || 1;
  F[YAW] = atan2(dx, -dz);
  F[PIT] = Math.asin(clamp(dy / d, -0.98, 0.98));
  camState.velE = camState.velN = camState.velU = 0;
  syncCamStateFromLocal();
}

// ============================================================================
// Build Procedural World & Genuine 6-Face Cube-Sphere Quadtree Streamer
// ============================================================================
await say('Initializing Earth-scale Cube-Sphere Quadtree, 18 continental biomes & wildlife IK…', 0.22);
setActiveOrigin(startBiome.latDeg, startBiome.lonDeg, startBiome.id);
const world = buildWorld();
const planetQuadtree = new CubeSphereQuadtree({
  maxLod: 16,
  maxCachedTiles: 220,
  maxTilesPerFrame: 12,
  maxActiveTiles: 144
});

let activeRegionBiomeId = startBiome.id;
let forceSyncTiles = true;
const audioState = { camX: 0, camY: 3, camZ: 0 };

// Wire marine breach, humpback song, orca calls & surfacing breath into spatial audio
world.setMarineEventCallback((ev) => {
  if (!ev) return;
  const dx = (ev.x ?? 0) - F[CX];
  const dy = (ev.y ?? 0) - F[CY];
  const dz = (ev.z ?? 0) - F[CZ];
  const dist = hypot(dx, dy, dz);
  const isUw = F[CY] < 0.0;
  if (ev.type === 'breach_impact') triggerBreachSplash(dist, ev.power ?? 1.0);
  else if (ev.type === 'whale_song') triggerWhaleSong(dist, isUw);
  else if (ev.type === 'orca_call') triggerOrcaCall(dist, isUw);
  else if (ev.type === 'surface_breath') triggerSurfacingBreath(dist);
});

function rebaseRegionalOrigin(latDeg, lonDeg, preferredBiomeId = -1, continuousShift = false) {
  const prevOrigin = continuousShift ? { ...getActiveOrigin() } : null;
  const near = nearestBiomeAtGeo(latDeg, lonDeg);
  const biomeId = preferredBiomeId >= 0 ? preferredBiomeId : near.biome.id;
  let shiftMeters = null;
  if (prevOrigin) {
    const delta = latLonToLocalMeters(latDeg, lonDeg, prevOrigin, { x: 0, z: 0 });
    shiftMeters = { dx: delta.x, dz: delta.z };
  }
  setActiveOrigin(latDeg, lonDeg, biomeId);
  activeRegionBiomeId = biomeId;
  const regionSeed = (round(latDeg * 20) * 97 + round(lonDeg * 20) * 31) | 0;
  world.syncRegion(biomeId, regionSeed, shiftMeters);
  syncLocalFromCamState();
}

// ============================================================================
// Live 5 km GPS-Style Navigation Instrument (Bottom-Right HUD)
// Samples real planetary topography/bathymetry/hydrology over a 5 km radius
// with North-Up / Track-Up modes, distinct Camera Heading vs Velocity Ground
// Track, breadcrumb movement trail, waypoints with bearing/distance/ETA,
// landmarks, compass rose & dynamic scale bar. (Simulation coordinates only)
// ============================================================================
const miniMapWrap = $('miniMapWrap');
const miniMapCanvas = $('miniMapCanvas');
const mmModeBtn = $('mmModeBtn');
const mmScaleLabelEl = $('mmScaleLabel');
const mmWaypointRowEl = $('mmWaypointRow');
const mmWpTargetEl = $('mmWpTarget');
const mmWpDistEl = $('mmWpDist');
const mmHeadingEl = $('mmHeading');
const mmElevEl = $('mmElev');
const mmRegionEl = $('mmRegion');
const mmSpeedEl = $('mmSpeed');

const navTrail = [];
const NAV_TRAIL_MAX = 120;
let activeWaypoint = null; // { latDeg, lonDeg, name }

function recordNavTrailPoint(latDeg, lonDeg) {
  if (solarState.mode === 'interplanetary' || camState.altMeters > 80000) return;
  const last = navTrail.length > 0 ? navTrail[navTrail.length - 1] : null;
  if (!last || greatCircleDistanceMeters(last.latDeg, last.lonDeg, latDeg, lonDeg) >= 35.0) {
    navTrail.push({ latDeg, lonDeg });
    if (navTrail.length > NAV_TRAIL_MAX) navTrail.shift();
  }
}

function setWaypoint(latDeg, lonDeg, name = '') {
  const cleanLat = clamp(latDeg, -89.8, 89.8);
  const cleanLon = normAngle(lonDeg * DEG2RAD) * RAD2DEG;
  const label = name || biomeLabelAtGeo(cleanLat, cleanLon, 10);
  activeWaypoint = { latDeg: cleanLat, lonDeg: cleanLon, name: label };
  if ($('clearWaypointBtn')) $('clearWaypointBtn').style.display = '';
  if (mmWaypointRowEl) mmWaypointRowEl.classList.add('active');
}

function clearWaypoint() {
  activeWaypoint = null;
  if ($('clearWaypointBtn')) $('clearWaypointBtn').style.display = 'none';
  if (mmWaypointRowEl) mmWaypointRowEl.classList.remove('active');
}

function computeBearingDeg(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const p1 = lat1Deg * DEG2RAD, p2 = lat2Deg * DEG2RAD;
  const dL = (lon2Deg - lon1Deg) * DEG2RAD;
  const y = sin(dL) * cos(p2);
  const x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dL);
  return ((atan2(y, x) * RAD2DEG) % 360 + 360) % 360;
}

if (mmModeBtn) {
  mmModeBtn.onclick = (e) => {
    e.stopPropagation();
    settings.miniMapMode = settings.miniMapMode === 'track-up' ? 'north-up' : 'track-up';
    saveSettings(settings);
    mmModeBtn.textContent = settings.miniMapMode === 'track-up' ? 'TRK-UP' : 'N-UP';
    if ($('setMiniMapMode')) $('setMiniMapMode').value = settings.miniMapMode;
  };
}
if (miniMapWrap) {
  miniMapWrap.onclick = () => toggleMapModal(true);
}

const MM_RADIUS_M = 5000.0; // Exact 5 km surrounding radius
const MM_RASTER_RES = 84;
const mmOffCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (mmOffCanvas) { mmOffCanvas.width = MM_RASTER_RES; mmOffCanvas.height = MM_RASTER_RES; }
const mmOffCtx = mmOffCanvas ? mmOffCanvas.getContext('2d') : null;
const mmImgData = mmOffCtx ? mmOffCtx.createImageData(MM_RASTER_RES, MM_RASTER_RES) : null;
let mmCacheLat = 999, mmCacheLon = 999, mmLastDrawMs = 0;
let mmSmoothTrackRad = 0;
const _mmTmp = {};
const _mmTmpN = {};
const _mmPinLoc = {};

function rebuildMiniMapTerrainRaster(centerLatDeg, centerLonDeg) {
  if (!mmOffCtx || !mmImgData) return;
  const data = mmImgData.data;
  const cosLat = max(0.14, cos(centerLatDeg * DEG2RAD));
  const degPerM_Lat = 1.0 / 111320.0;
  const degPerM_Lon = 1.0 / (111320.0 * cosLat);
  const spanM = MM_RADIUS_M * 1.45; // Overscan by sqrt(2) so Track-Up rotation has zero corner gaps
  const stepM = (spanM * 2.0) / MM_RASTER_RES;

  for (let py = 0; py < MM_RASTER_RES; py++) {
    const northM = spanM - (py + 0.5) * stepM;
    const lat = clamp(centerLatDeg + northM * degPerM_Lat, -89.9, 89.9);
    for (let px = 0; px < MM_RASTER_RES; px++) {
      const eastM = -spanM + (px + 0.5) * stepM;
      const lon = normAngle((centerLonDeg + eastM * degPerM_Lon) * DEG2RAD) * RAD2DEG;
      samplePlanetAtLatLon(lat, lon, _mmTmp, 1);

      const latN = clamp(lat + stepM * 0.7 * degPerM_Lat, -89.9, 89.9);
      const lonE = normAngle((lon + stepM * 0.7 * degPerM_Lon) * DEG2RAD) * RAD2DEG;
      samplePlanetAtLatLon(latN, lonE, _mmTmpN, 1);
      const slopeShade = clamp(0.86 + (_mmTmp.h - _mmTmpN.h) * 0.012, 0.50, 1.34);

      let r = 0, g = 0, b = 0;
      const h = _mmTmp.h;
      if (h < 0.0) {
        const depthT = saturate(-h / 180.0);
        const shallowT = smoothstep(-14.0, -0.2, h);
        r = lerp(lerp(16, 6, depthT), 48, shallowT * 0.72);
        g = lerp(lerp(62, 22, depthT), 144, shallowT * 0.72);
        b = lerp(lerp(94, 48, depthT), 164, shallowT * 0.72);
        if (abs(((h % 25) + 25) % 25) < 1.8) { r += 8; g += 14; b += 18; }
      } else {
        r = (_mmTmp.colR ?? 0.28) * 255 * slopeShade;
        g = (_mmTmp.colG ?? 0.34) * 255 * slopeShade;
        b = (_mmTmp.colB ?? 0.24) * 255 * slopeShade;
        if ((_mmTmp.lakeFrac || 0) > 0.26 || (_mmTmp.riverFrac || 0) > 0.28) {
          r = lerp(r, 38, 0.72);
          g = lerp(g, 118, 0.72);
          b = lerp(b, 152, 0.72);
        } else if (h < 2.2) {
          r = lerp(r, 185, 0.52);
          g = lerp(g, 212, 0.52);
          b = lerp(b, 182, 0.52);
        } else {
          const modC = h % 40.0;
          if (modC < 2.2) { r *= 0.80; g *= 0.82; b *= 0.80; }
        }
      }
      const idx = (py * MM_RASTER_RES + px) * 4;
      data[idx] = clamp(round(r), 0, 255);
      data[idx + 1] = clamp(round(g), 0, 255);
      data[idx + 2] = clamp(round(b), 0, 255);
      data[idx + 3] = 255;
    }
  }
  mmOffCtx.putImageData(mmImgData, 0, 0);
  mmCacheLat = centerLatDeg;
  mmCacheLon = centerLonDeg;
}

function renderLiveMiniMap(nowMs) {
  if (!miniMapCanvas || menu || photoMode || settings.showMiniMap === false) return;
  if (nowMs - mmLastDrawMs < 80) return; // Smooth ~12.5 Hz live GPS refresh
  mmLastDrawMs = nowMs;

  const ctx = miniMapCanvas.getContext('2d');
  if (!ctx) return;
  const w = miniMapCanvas.width;
  const h = miniMapCanvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const mapRadiusPx = min(w, h) * 0.48;
  const pxPerM = mapRadiusPx / MM_RADIUS_M;

  const isInterplanetary = solarState.mode === 'interplanetary';
  const trackUp = settings.miniMapMode === 'track-up';
  if (mmModeBtn) mmModeBtn.textContent = trackUp ? 'TRK-UP' : 'N-UP';

  // Camera Heading (0 = North, +PI/2 = East) vs Velocity Ground Track
  const camHdgRad = normAngle(F[YAW]);
  const groundSpeed = isInterplanetary
    ? solarState.speedMps
    : hypot(camState.velE || 0, camState.velN || 0);
  const hasVelocityTrack = !isInterplanetary && groundSpeed >= 0.35;
  const velTrackRad = hasVelocityTrack ? atan2(camState.velE, camState.velN) : null;

  // Smooth orientation rotation in Track-Up mode (falls back cleanly to camera heading when stationary)
  const targetUpRad = trackUp ? (hasVelocityTrack ? velTrackRad : camHdgRad) : 0.0;
  mmSmoothTrackRad = trackUp ? lerpAngle(mmSmoothTrackRad, targetUpRad, 0.22) : 0.0;
  const rotRad = trackUp ? -mmSmoothTrackRad : 0.0;

  ctx.clearRect(0, 0, w, h);

  if (isInterplanetary) {
    // Deep-space tactical radar showing nearby Solar System bodies relative to spacecraft
    ctx.fillStyle = '#040a0e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(92, 200, 242, 0.22)';
    ctx.lineWidth = 1;
    for (const rFrac of [0.33, 0.66, 0.96]) {
      ctx.beginPath();
      ctx.arc(cx, cy, mapRadiusPx * rFrac, 0, TAU);
      ctx.stroke();
    }
    const sunP = solarState.positions.get('sun');
    const shipX = solarState.posM[0] - sunP[0];
    const shipZ = solarState.posM[2] - sunP[2];
    const maxLog = Math.log10(1 + 32 * 12);
    const mapHelio = (mx, mz) => {
      const au = hypot(mx, mz) / AU_METERS;
      const rNorm = Math.log10(1 + au * 12) / maxLog;
      const ang = atan2(mz, mx);
      return [cx + cos(ang) * rNorm * mapRadiusPx * 0.94, cy + sin(ang) * rNorm * mapRadiusPx * 0.94];
    };
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = SOLAR_BODIES[i];
      const bp = solarState.positions.get(b.id);
      const [bx, by] = mapHelio(bp[0], bp[2]);
      ctx.fillStyle = b.id === 'sun' ? '#fde047' : b.id === solarState.targetBodyId ? '#5cc8f2' : `rgb(${round(b.color[0] * 255)},${round(b.color[1] * 255)},${round(b.color[2] * 255)})`;
      ctx.beginPath();
      ctx.arc(bx, by, b.id === 'sun' ? 4.5 : b.id === solarState.targetBodyId ? 3.5 : 2.3, 0, TAU);
      ctx.fill();
    }
    const [sx, sy] = mapHelio(shipX, shipZ);
    const tgtP = solarState.positions.get(solarState.targetBodyId);
    if (tgtP) {
      const [tx, ty] = mapHelio(tgtP[0], tgtP[2]);
      ctx.strokeStyle = 'rgba(92, 200, 242, 0.65)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    if (mmScaleLabelEl) mmScaleLabelEl.textContent = '30 AU';
    if (mmHeadingEl) mmHeadingEl.textContent = `SUN ${(solarState.distFromSunM / AU_METERS).toFixed(2)} AU`;
    if (mmElevEl) mmElevEl.textContent = formatDistanceSI(solarState.distToTargetM);
    if (mmRegionEl) mmRegionEl.textContent = `SOLAR · ${(SOLAR_BODY_BY_ID[solarState.activeBodyId]?.name || 'Deep Space').toUpperCase()}`;
    if (mmSpeedEl) mmSpeedEl.textContent = formatSpeedSI(solarState.speedMps);
    if (mmWaypointRowEl) {
      mmWaypointRowEl.classList.add('active');
      if (mmWpTargetEl) mmWpTargetEl.textContent = `TGT ${(SOLAR_BODY_BY_ID[solarState.targetBodyId]?.name || 'MARS').toUpperCase()}`;
      if (mmWpDistEl) mmWpDistEl.textContent = `ETA ${formatEtaSI(solarState.etaSeconds)}`;
    }
    return;
  }

  // Earth-anchored 5 km live GPS topographic/bathymetric raster
  const movedM = mmCacheLat > 90
    ? 99999
    : greatCircleDistanceMeters(mmCacheLat, mmCacheLon, camState.latDeg, camState.lonDeg);
  if (movedM > 40.0) {
    rebuildMiniMapTerrainRaster(camState.latDeg, camState.lonDeg);
  }

  const curOrigin = {
    latDeg: camState.latDeg,
    lonDeg: camState.lonDeg,
    latRad: camState.latRad,
    lonRad: camState.lonRad,
    enu: localENUFrame(camState.latRad, camState.lonRad)
  };

  // Draw rotated terrain raster, breadcrumb trail, landmarks & waypoint vector
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  if (mmOffCanvas) {
    ctx.imageSmoothingEnabled = true;
    const drawSpanPx = mapRadiusPx * 1.45 * 2.0;
    ctx.drawImage(mmOffCanvas, -drawSpanPx * 0.5, -drawSpanPx * 0.5, drawSpanPx, drawSpanPx);
  }

  // Live breadcrumb movement trail
  if (navTrail.length >= 2) {
    ctx.strokeStyle = 'rgba(92, 200, 242, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < navTrail.length; i++) {
      latLonToLocalMeters(navTrail[i].latDeg, navTrail[i].lonDeg, curOrigin, _mmPinLoc);
      const tx = _mmPinLoc.x * pxPerM;
      const ty = _mmPinLoc.z * pxPerM;
      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    }
    ctx.lineTo(0, 0);
    ctx.stroke();
  }

  // Curated landmark pins within surrounding 5 km radius
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const dM = greatCircleDistanceMeters(camState.latDeg, camState.lonDeg, b.latDeg, b.lonDeg);
    if (dM <= MM_RADIUS_M * 1.05) {
      latLonToLocalMeters(b.latDeg, b.lonDeg, curOrigin, _mmPinLoc);
      const px = _mmPinLoc.x * pxPerM;
      const py = _mmPinLoc.z * pxPerM;
      ctx.fillStyle = b.forbidden ? '#f87171' : '#e2b857';
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.strokeStyle = '#060d0a';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 3, py - 3, 6, 6);
    }
  }

  // Active Waypoint vector & pin (clipped neatly onto compass rim if beyond 5 km)
  if (activeWaypoint) {
    const wpDistM = greatCircleDistanceMeters(camState.latDeg, camState.lonDeg, activeWaypoint.latDeg, activeWaypoint.lonDeg);
    const wpBrgRad = computeBearingDeg(camState.latDeg, camState.lonDeg, activeWaypoint.latDeg, activeWaypoint.lonDeg) * DEG2RAD;
    const clampedR = min(mapRadiusPx * 0.94, wpDistM * pxPerM);
    const wx = sin(wpBrgRad) * clampedR;
    const wy = -cos(wpBrgRad) * clampedR;

    ctx.strokeStyle = 'rgba(92, 200, 242, 0.72)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(PI * 0.25);
    ctx.fillStyle = '#5cc8f2';
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.strokeStyle = '#060d0a';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-3.5, -3.5, 7, 7);
    ctx.restore();
  }

  // Camera Heading FOV Cone (gold)
  const canvasHdgAng = camHdgRad - PI * 0.5;
  const fovHalf = clamp((settings.fov || 54) * DEG2RAD * 0.52, 0.34, 0.84);
  const coneR = 34;
  const coneGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, coneR);
  coneGrad.addColorStop(0, 'rgba(226, 184, 87, 0.52)');
  coneGrad.addColorStop(1, 'rgba(226, 184, 87, 0.0)');
  ctx.fillStyle = coneGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, coneR, canvasHdgAng - fovHalf, canvasHdgAng + fovHalf);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(226, 184, 87, 0.92)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(cos(canvasHdgAng) * 18, sin(canvasHdgAng) * 18);
  ctx.stroke();

  // Distinct Velocity Ground-Track Vector Arrow (cyan, shown when actually moving >= 0.35 m/s)
  if (hasVelocityTrack && velTrackRad !== null) {
    const trkAng = velTrackRad - PI * 0.5;
    const trkLen = clamp(12 + Math.log10(1 + groundSpeed) * 10, 14, 28);
    const ex = cos(trkAng) * trkLen;
    const ey = sin(trkAng) * trkLen;
    ctx.strokeStyle = '#5cc8f2';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#5cc8f2';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - cos(trkAng - 0.45) * 6, ey - sin(trkAng - 0.45) * 6);
    ctx.lineTo(ex - cos(trkAng + 0.45) * 6, ey - sin(trkAng + 0.45) * 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Subtle architectural vignette
  const vig = ctx.createRadialGradient(cx, cy, mapRadiusPx * 0.65, cx, cy, max(w, h) * 0.65);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(4,10,8,0.52)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // Concentric range rings (1 km, 2.5 km, 5 km) + crosshair
  ctx.save();
  ctx.strokeStyle = 'rgba(242, 240, 230, 0.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const rKm of [1.0, 2.5, 4.92]) {
    ctx.beginPath();
    ctx.arc(cx, cy, rKm * 1000.0 * pxPerM, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(242, 240, 230, 0.10)';
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.stroke();

  // Rotating Compass Rose Cardinals (N, E, S, W)
  ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cardDist = mapRadiusPx - 9;
  const cardinals = [
    { lbl: 'N', ang: -PI * 0.5 + rotRad, col: '#e2b857' },
    { lbl: 'E', ang: rotRad, col: 'rgba(242, 240, 230, 0.62)' },
    { lbl: 'S', ang: PI * 0.5 + rotRad, col: 'rgba(242, 240, 230, 0.62)' },
    { lbl: 'W', ang: PI + rotRad, col: 'rgba(242, 240, 230, 0.62)' }
  ];
  for (const c of cardinals) {
    ctx.fillStyle = c.col;
    ctx.fillText(c.lbl, cx + cos(c.ang) * cardDist, cy + sin(c.ang) * cardDist);
  }

  // Dynamic Scale Bar (1 km bar bottom-left inside canvas)
  const barPx = 1000.0 * pxPerM;
  const bx0 = 9, by0 = h - 10;
  ctx.strokeStyle = 'rgba(242, 240, 230, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx0, by0 - 3); ctx.lineTo(bx0, by0); ctx.lineTo(bx0 + barPx, by0); ctx.lineTo(bx0 + barPx, by0 - 3);
  ctx.stroke();
  ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(242, 240, 230, 0.78)';
  ctx.fillText('1 KM', bx0 + barPx + 4, by0 - 1);

  // Live Player Marker (square architectural reticle at center)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 3, cy - 3, 6, 6);
  ctx.strokeStyle = '#060d0a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 3, cy - 3, 6, 6);
  ctx.restore();

  // Telemetry Footer Updates: Distinct Heading vs Ground Track, MSL/AGL, Ecoregion, Speed & Waypoint ETA
  const hdgDeg = ((round(camHdgRad * RAD2DEG) % 360) + 360) % 360;
  const trkDeg = hasVelocityTrack && velTrackRad !== null ? ((round(velTrackRad * RAD2DEG) % 360) + 360) % 360 : null;
  if (mmScaleLabelEl) mmScaleLabelEl.textContent = '5 KM';
  if (mmHeadingEl) {
    mmHeadingEl.textContent = trkDeg !== null
      ? `HDG ${String(hdgDeg).padStart(3, '0')}° · TRK ${String(trkDeg).padStart(3, '0')}°`
      : `HDG ${String(hdgDeg).padStart(3, '0')}° · STAT`;
  }
  if (mmElevEl) {
    const msl = camState.altMeters;
    const agl = max(0, msl - max(0, camState.groundH || 0));
    mmElevEl.textContent = abs(msl) >= 10000
      ? `MSL ${(msl / 1000).toFixed(1)}km`
      : `MSL ${msl >= 0 ? '+' : ''}${round(msl)}m · AGL ${round(agl)}m`;
  }
  if (mmRegionEl) {
    mmRegionEl.textContent = biomeLabelAtGeo(camState.latDeg, camState.lonDeg, camState.altMeters);
  }
  if (mmSpeedEl) {
    mmSpeedEl.textContent = formatSpeedSI(groundSpeed);
  }
  if (mmWaypointRowEl) {
    if (activeWaypoint) {
      mmWaypointRowEl.classList.add('active');
      const dM = greatCircleDistanceMeters(camState.latDeg, camState.lonDeg, activeWaypoint.latDeg, activeWaypoint.lonDeg);
      const brg = round(computeBearingDeg(camState.latDeg, camState.lonDeg, activeWaypoint.latDeg, activeWaypoint.lonDeg));
      const eta = groundSpeed >= 0.5 ? ` · ${formatEtaSI(dM / groundSpeed)}` : '';
      if (mmWpTargetEl) mmWpTargetEl.textContent = `WP ${String(brg).padStart(3, '0')}° ${activeWaypoint.name.slice(0, 14)}`;
      if (mmWpDistEl) mmWpDistEl.textContent = `${formatDistanceSI(dM)}${eta}`;
    } else {
      mmWaypointRowEl.classList.remove('active');
    }
  }
}

function applyBiomePose(biomeIdx) {
  const b = BIOME_CATALOG[clamp(biomeIdx, 0, BIOME_CATALOG.length - 1)];
  const p = POSES[b.id] || [-14, 4.8, 18, 5, 2.2, -6];
  camState.latDeg = b.latDeg;
  camState.lonDeg = b.lonDeg;
  camState.latRad = b.latDeg * DEG2RAD;
  camState.lonRad = b.lonDeg * DEG2RAD;
  camState.velE = camState.velN = camState.velU = 0;
  camState.autopilot = null;
  camState.reentryHeat = 0;
  rebaseRegionalOrigin(b.latDeg, b.lonDeg, b.id);
  terrainAt(p[0], p[2], _camT);
  const camAlt = (b.id === 10 || b.id === 11)
    ? min(-1.5, max(_camT.h + 2.6, p[1]))
    : max(_camT.h + 2.2, _camT.h + max(1.8, p[1] * 0.65));
  const tgtAlt = (b.id === 10 || b.id === 11) ? min(-2.5, _camT.h + 1.2) : max(_camT.h + 1.2, camAlt - 1.4);
  lookAtPose(p[0], camAlt, p[2], p[3], tgtAlt, p[5]);
  forceSyncTiles = true;
}

applyBiomePose(0);

function enterWilderness() {
  initAudio();
  setAudioSettings(settings);
  noteUserActivity();
  if (mapModal) mapModal.classList.remove('open');
  if (embodimentModal) embodimentModal.classList.remove('open');
  if (settingsModal) settingsModal.classList.remove('open');
  setMenu(false);
  canvas.requestPointerLock?.();
}

// --- Playable Animal Embodiment Controller ---
function updateEmbodimentUI() {
  if (!embodiedState.active || embodiedState.groupIdx < 0) {
    if (embodyLabelEl) embodyLabelEl.textContent = 'Observer: Free-Fly';
    if (embodyHintEl) embodyHintEl.textContent = 'WASD Move · Mouse Look · [E] Inhabit Nearest Animal · [M] 3D Planetary Globe · [G] Orbit/Re-Entry · [O] Settings';
    if (togglePovBtn) togglePovBtn.textContent = 'POV: Free [V]';
    if (modalPovToggleBtn) modalPovToggleBtn.textContent = `POV: ${embodiedState.pov === '1st' ? '1st Person' : '3rd Person'} [V]`;
  } else {
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp.items[embodiedState.itemIdx];
    const emoName = (world.EMOTION_NAMES && it) ? world.EMOTION_NAMES[clamp(round(it.emotion || 0), 0, 4)] : 'Active';
    const povText = embodiedState.pov === '1st' ? '1st POV' : '3rd Orbit';
    if (embodyLabelEl) embodyLabelEl.textContent = `${grp.label} (${povText}) · ${emoName}`;
    if (embodyHintEl) {
      const actionVerb = grp.domain === 'water'
        ? (grp.name === 'whales' || grp.name === 'orcas' ? '[Space] Breach · [C] Dive' : '[Space] Ascend · [C] Dive')
        : grp.domain === 'air' ? '[Space] Climb · [C] Stoop' : '[Space] Leap/Display · [Shift] Sprint';
      embodyHintEl.textContent = `WASD Move · Mouse Orbit · [V] 1st/3rd POV · ${actionVerb} · [R] Vocalize · [Q] Sense`;
    }
    if (togglePovBtn) togglePovBtn.textContent = `POV: ${embodiedState.pov === '1st' ? '1st' : '3rd'} [V]`;
    if (modalPovToggleBtn) modalPovToggleBtn.textContent = `POV: ${embodiedState.pov === '1st' ? '1st Person' : '3rd Person'} [V]`;
  }
  if (speciesGrid) {
    speciesGrid.querySelectorAll('.sp-card').forEach((card) => {
      const gIdx = parseInt(card.dataset.groupIdx, 10);
      card.classList.toggle('active', embodiedState.active && embodiedState.groupIdx === gIdx);
    });
  }
}

function disembodyAnimal() {
  if (embodiedState.active && embodiedState.groupIdx >= 0) {
    const prevGrp = world.wildlifeGroups[embodiedState.groupIdx];
    if (prevGrp && prevGrp.items[embodiedState.itemIdx]) {
      prevGrp.items[embodiedState.itemIdx].playerControlled = false;
    }
  }
  embodiedState.active = false;
  embodiedState.groupIdx = -1;
  updateEmbodimentUI();
}

function inhabitAnimal(groupIdx, itemIdx = 0) {
  if (groupIdx < 0 || groupIdx >= world.wildlifeGroups.length) return;
  disembodyAnimal();
  const grp = world.wildlifeGroups[groupIdx];
  // If this species is not native to current region, relocate smoothly to its primary native biome
  if (grp.nativeBiomes && grp.nativeBiomes.length > 0 && !grp.nativeBiomes.includes(activeRegionBiomeId)) {
    const homeBiome = BIOME_CATALOG[grp.nativeBiomes[0]];
    if (homeBiome) {
      camState.latDeg = homeBiome.latDeg;
      camState.lonDeg = homeBiome.lonDeg;
      camState.latRad = homeBiome.latDeg * DEG2RAD;
      camState.lonRad = homeBiome.lonDeg * DEG2RAD;
      camState.autopilot = null;
      rebaseRegionalOrigin(homeBiome.latDeg, homeBiome.lonDeg, homeBiome.id);
      forceSyncTiles = true;
    }
  }
  const idx = clamp(itemIdx, 0, grp.items.length - 1);
  const it = grp.items[idx];
  if (!it) return;
  it.inactiveInRegion = false;
  it.playerControlled = true;
  embodiedState.active = true;
  embodiedState.groupIdx = groupIdx;
  embodiedState.itemIdx = idx;
  embodiedState.vy = 0;
  embodiedState.pitch = 0;
  embodiedState.orbitYaw = 0;
  embodiedState.orbitPitch = 0.22;
  flyActive = false;
  autoExplore = false;
  camState.autopilot = null;

  // Canonical local +Z -> world forward (-sin(yaw), 0, cos(yaw)); camera spawns BEHIND creature
  const [fwdX, fwdZ] = yawToForward(it.yaw || 0);
  const dist = grp.followDist * max(0.85, (it.scale || 1) * 0.9) * (settings.followDistance || 1.0);
  const eyeH = (grp.eyeOffset[1] * (it.scale || 1) + 0.85) * (settings.followHeight || 1.0);
  F[CX] = it.x - fwdX * dist;
  F[CY] = it.y + eyeH;
  F[CZ] = it.z - fwdZ * dist;
  lookAtPose(F[CX], F[CY], F[CZ], it.x + fwdX * 1.5, it.y + grp.eyeOffset[1] * (it.scale || 1), it.z + fwdZ * 1.5);
  triggerSpeciesCall(grp.speciesId, 5, F[CY] < 0);
  updateEmbodimentUI();
}

function togglePovMode() {
  if (embodiedState.active) {
    embodiedState.pov = embodiedState.pov === '3rd' ? '1st' : '3rd';
    embodiedState.orbitYaw = 0;
    updateEmbodimentUI();
  } else {
    const nearest = world.findNearestAnimal(F[CX], F[CY], F[CZ], 85);
    if (nearest) inhabitAnimal(nearest.groupIdx, nearest.itemIdx);
    else inhabitAnimal(0, 0);
  }
}

const FEATURED_SPECIES = [
  'lions', 'tigers', 'gorillas', 'chimpanzees', 'elephants', 'giraffes', 'zebras',
  'wolves', 'bison', 'rhinos', 'hippos', 'kangaroos',
  'whales', 'orcas', 'sharks', 'mantas', 'turtles',
  'penguins', 'polarBears', 'seals',
  'eagles', 'macaws', 'toucans',
  'jaguars', 'panthers', 'deer', 'alligators', 'anacondas', 'otters'
];
if (speciesGrid) {
  speciesGrid.innerHTML = '';
  FEATURED_SPECIES.forEach((spName) => {
    const gIdx = world.wildlifeGroups.findIndex((g) => g.name === spName);
    if (gIdx < 0) return;
    const grp = world.wildlifeGroups[gIdx];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-card';
    btn.dataset.groupIdx = String(gIdx);
    btn.dataset.speciesName = grp.name;
    const domainBadge = grp.domain === 'water' ? 'Marine / Amphibious' : grp.domain === 'air' ? 'Avian Soarer' : 'Terrestrial IK';
    btn.innerHTML = `<b>${grp.label}</b><span>${domainBadge} · ${grp.items.length} active · Speed ${grp.baseSpeed.toFixed(1)}m/s</span>`;
    btn.onclick = () => {
      inhabitAnimal(gIdx, 0);
      enterWilderness();
    };
    speciesGrid.appendChild(btn);
  });
}

// ============================================================================
// Unified 3D Planetary Globe & 2D Topographic Map (Exact Same Planet Data!)
// Samples samplePlanetAtLatLon(latDeg, lonDeg) directly so globe == surface.
// ============================================================================
let mapBaseImageData = null;
let mapViewMode = 'globe'; // 'globe' | 'flat' | 'solar'
let mapClickMode = 'travel'; // 'travel' | 'waypoint'
let globeYaw = 0.55;
let globePitch = 0.22;
let globeDragging = false;
let globeDragMoved = false;
let globeLastX = 0;
let globeLastY = 0;
let projectedGlobePins = [];
let projectedSolarPins = [];

function ensureMapBaseImage(ctx, w, h) {
  if (mapBaseImageData && mapBaseImageData.width === w && mapBaseImageData.height === h) return;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const mt = {};
  for (let py = 0; py < h; py++) {
    const latDeg = 90.0 - (py / (h - 1)) * 180.0;
    for (let px = 0; px < w; px++) {
      const lonDeg = (px / (w - 1)) * 360.0 - 180.0;
      samplePlanetAtLatLon(latDeg, lonDeg, mt, 0);
      let r = mt.colR * 255;
      let g = mt.colG * 255;
      let b = mt.colB * 255;
      if (mt.h < 0.0) {
        const depthT = clamp((-mt.h) / 4200.0, 0, 1);
        r = lerp(24, 5, depthT);
        g = lerp(128, 22, depthT);
        b = lerp(164, 58, depthT);
        if (mt.reef > 0.2) { r += 18; g += 44; b += 22; }
      } else {
        // Subtle hypsometric relief shading
        const elevShade = clamp(0.84 + mt.h * 0.00018, 0.80, 1.24);
        r *= elevShade; g *= elevShade; b *= elevShade;
        const contour = abs(((mt.h + 4000) % 450) - 225);
        if (contour < 14) { r *= 0.86; g *= 0.86; b *= 0.86; }
      }
      const idx = (py * w + px) * 4;
      d[idx]     = clamp(round(r), 0, 255);
      d[idx + 1] = clamp(round(g), 0, 255);
      d[idx + 2] = clamp(round(b), 0, 255);
      d[idx + 3] = 255;
    }
  }
  mapBaseImageData = img;
}

function latLonToMapPx(latDeg, lonDeg, w, h) {
  return [
    ((lonDeg + 180.0) / 360.0) * w,
    ((90.0 - latDeg) / 180.0) * h
  ];
}
function mapPxToLatLon(px, py, w, h) {
  return [
    clamp(90.0 - (py / h) * 180.0, -89.5, 89.5),
    clamp((px / w) * 360.0 - 180.0, -180.0, 180.0)
  ];
}

function latLonToGlobePoint(latDeg, lonDeg, cx, cy, rad) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cl = cos(lat), sl = sin(lat);
  const sx = cl * sin(lon);
  const sy = sl;
  const sz = cl * cos(lon);

  const cyw = cos(globeYaw), syw = sin(globeYaw);
  const x1 = sx * cyw - sz * syw;
  const z1 = sx * syw + sz * cyw;
  const cp = cos(globePitch), sp = sin(globePitch);
  const y2 = sy * cp - z1 * sp;
  const z2 = sy * sp + z1 * cp;

  return {
    px: cx + x1 * rad,
    py: cy - y2 * rad,
    vis: z2 > -0.04,
    z: z2
  };
}

function globePxToLatLon(px, py, cx, cy, rad) {
  const nx = (px - cx) / rad;
  const ny = -(py - cy) / rad;
  const r2 = nx * nx + ny * ny;
  if (r2 > 1.0) return null;
  const nz = sqrt(max(0, 1.0 - r2));

  const cp = cos(globePitch), sp = sin(globePitch);
  const sy = ny * cp + nz * sp;
  const z1 = -ny * sp + nz * cp;
  const cyw = cos(globeYaw), syw = sin(globeYaw);
  const sx = nx * cyw + z1 * syw;
  const sz = -nx * syw + z1 * cyw;

  const latDeg = Math.asin(clamp(sy, -0.9995, 0.9995)) * RAD2DEG;
  const lonDeg = atan2(sx, sz) * RAD2DEG;
  return [latDeg, lonDeg];
}

function updateMapRegionInfo() {
  const ecoEl = $('mapEcoSummary');
  const spEl = $('mapSpeciesSummary');
  if (!ecoEl || !spEl) return;
  samplePlanetAtLatLon(camState.latDeg, camState.lonDeg, _camT, 1);
  const eco = _camT.ecoregion || classifyEcoregionAt(camState.latDeg, camState.lonDeg, _camT.h, _camT.tempC, _camT.rainfall, _camT.aridity || 0, _camT.glacier || 0);
  ecoEl.innerHTML = `<strong>Ecoregion:</strong> ${eco.name} · ${eco.realm} · Lithology: ${eco.lithology}`;
  const cat = getLoadedSpeciesCatalogue();
  if (cat) {
    const roster = queryRegionalSpeciesRoster(camState.latDeg, camState.lonDeg, _camT.h, _camT.tempC, _camT.rainfall, _camT.aridity || 0, _camT.glacier || 0, 5);
    const names = roster.species.map((s) => s.commonName || s.scientificName).slice(0, 3).join(', ');
    const totalSp = cat.totalAcceptedSpecies || cat.records.length;
    spEl.textContent = `GBIF Verified: ${totalSp.toLocaleString()} species · Regional: ${names || 'Sparse extreme habitat'}`;
  } else {
    spEl.textContent = 'GBIF Verified Catalogue loading…';
  }
}

function renderSolarSystemMap(ctx, w, h) {
  projectedSolarPins = [];
  ctx.fillStyle = '#04080d';
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = min(w, h) * 0.44;
  const maxLog = Math.log10(1.0 + 32.0 * 12.0);
  const auToPx = (au) => lerp(24, maxR, Math.log10(1.0 + max(0, au) * 12.0) / maxLog);

  // Subtle ecliptic coordinate crosshair & AU reference rings
  ctx.strokeStyle = 'rgba(92, 200, 242, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 12); ctx.lineTo(cx, h - 12);
  ctx.moveTo(12, cy); ctx.lineTo(w - 12, cy);
  ctx.stroke();

  // Orbital ellipses (logarithmic radial display for simultaneous inner+outer readability)
  for (let i = 1; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const rPx = auToPx(b.aAU);
    ctx.strokeStyle = b.id === solarState.targetBodyId ? 'rgba(92, 200, 242, 0.55)' : 'rgba(242, 240, 230, 0.14)';
    ctx.lineWidth = b.id === solarState.targetBodyId ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, TAU);
    ctx.stroke();
  }

  // Sun core glow
  const sunGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  sunGlow.addColorStop(0, 'rgba(255, 246, 204, 0.98)');
  sunGlow.addColorStop(0.35, 'rgba(255, 192, 82, 0.48)');
  sunGlow.addColorStop(1, 'rgba(255, 160, 48, 0.0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, TAU);
  ctx.fill();

  const mapHelioPx = (pos) => {
    const au = hypot(pos[0], pos[2]) / AU_METERS;
    const r = au < 1e-4 ? 0 : auToPx(au);
    const ang = atan2(pos[2], pos[0]);
    return [cx + cos(ang) * r, cy + sin(ang) * r];
  };

  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const bp = solarState.positions.get(b.id);
    const [bx, by] = mapHelioPx(bp);
    const dotR = b.id === 'sun' ? 9 : b.type === 'gas_giant' ? 6.5 : b.type === 'ice_giant' ? 5.2 : 4.2;
    projectedSolarPins.push({ body: b, px: bx, py: by, r: max(14, dotR + 8) });

    if (b.ringOuterM) {
      ctx.strokeStyle = 'rgba(232, 212, 162, 0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(bx, by, dotR * 2.1, dotR * 0.72, -0.35, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = `rgb(${round(b.color[0] * 255)},${round(b.color[1] * 255)},${round(b.color[2] * 255)})`;
    ctx.beginPath();
    ctx.arc(bx, by, dotR, 0, TAU);
    ctx.fill();

    if (b.id === solarState.targetBodyId) {
      ctx.strokeStyle = '#5cc8f2';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx - dotR - 4, by - dotR - 4, (dotR + 4) * 2, (dotR + 4) * 2);
    }

    ctx.fillStyle = b.id === solarState.targetBodyId ? '#5cc8f2' : 'rgba(242, 240, 230, 0.84)';
    ctx.textAlign = 'left';
    ctx.fillText(b.name.toUpperCase(), bx + dotR + 6, by);
  }

  // Spacecraft position + course vector line to target
  const [sx, sy] = mapHelioPx(solarState.posM);
  const tgtP = solarState.positions.get(solarState.targetBodyId);
  if (tgtP) {
    const [tx, ty] = mapHelioPx(tgtP);
    ctx.strokeStyle = solarState.autopilotCourse ? '#5cc8f2' : 'rgba(226, 184, 87, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx - 4, sy - 4, 8, 8);
  ctx.strokeStyle = '#5cc8f2';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx - 4, sy - 4, 8, 8);

  if ($('solarTelemetry')) {
    const tgt = SOLAR_BODY_BY_ID[solarState.targetBodyId] || SOLAR_BODY_BY_ID.earth;
    const sunAu = (solarState.distFromSunM / AU_METERS).toFixed(3);
    const etaStr = Number.isFinite(solarState.etaSeconds) ? ` · ETA ${formatEtaSI(solarState.etaSeconds)}` : '';
    $('solarTelemetry').textContent = `SUN ${sunAu} AU · TGT ${tgt.name.toUpperCase()} (${formatDistanceSI(solarState.distToTargetM)})${etaStr}`;
  }
}

function renderPlanetaryMap() {
  if (!planetMapCanvas) return;
  const ctx = planetMapCanvas.getContext('2d');
  if (!ctx) return;
  const w = planetMapCanvas.width;
  const h = planetMapCanvas.height;

  projectedGlobePins = [];
  if (mapViewMode === 'solar') {
    renderSolarSystemMap(ctx, w, h);
    return;
  }

  ensureMapBaseImage(ctx, w, h);

  if (mapViewMode === 'globe') {
    const out = ctx.createImageData(w, h);
    const od = out.data;
    const sd = mapBaseImageData.data;
    const cx = w * 0.5, cy = h * 0.5;
    const rad = min(w, h) * 0.43;

    const tod = TOD_PRESETS[todIdx] || TOD_PRESETS[0];
    const lx = cos(tod.sunElev) * sin(tod.sunAz + 0.5);
    const ly = sin(tod.sunElev + 0.25);
    const lz = max(0.35, cos(tod.sunElev) * cos(tod.sunAz));
    const cp = cos(globePitch), sp = sin(globePitch);
    const cyw = cos(globeYaw), syw = sin(globeYaw);

    for (let py = 0; py < h; py++) {
      const ny = -(py - cy) / rad;
      for (let px = 0; px < w; px++) {
        const nx = (px - cx) / rad;
        const r2 = nx * nx + ny * ny;
        const oIdx = (py * w + px) * 4;

        if (r2 > 1.0) {
          const rDist = sqrt(r2);
          const halo = exp(-max(0, rDist - 1.0) * 14.0);
          const starHash = ((px * 73856093) ^ (py * 19349663)) & 1023;
          const star = starHash === 1 ? 155 : starHash === 7 ? 90 : 0;
          od[oIdx]     = clamp(round(4 + halo * 38 + star), 0, 255);
          od[oIdx + 1] = clamp(round(9 + halo * 118 + star), 0, 255);
          od[oIdx + 2] = clamp(round(18 + halo * 215 + star), 0, 255);
          od[oIdx + 3] = 255;
          continue;
        }

        const nz = sqrt(max(0, 1.0 - r2));
        const sy = ny * cp + nz * sp;
        const z1 = -ny * sp + nz * cp;
        const sx = nx * cyw + z1 * syw;
        const sz = -nx * syw + z1 * cyw;

        const lat = Math.asin(clamp(sy, -0.9999, 0.9999));
        const lon = atan2(sx, sz);

        const u = clamp(lon / TAU + 0.5, 0, 0.9999);
        const v = clamp(0.5 - lat / PI, 0, 0.9999);
        const tx = floor(u * (w - 1));
        const ty = floor(v * (h - 1));
        const sIdx = (ty * w + tx) * 4;

        const ndl = nx * lx + ny * ly + nz * lz;
        const light = clamp(ndl * 0.78 + 0.42, 0.16, 1.18);
        const limb = pow(1.0 - nz, 2.6);

        let r = sd[sIdx] * light + limb * 48;
        let g = sd[sIdx + 1] * light + limb * 135;
        let b = sd[sIdx + 2] * light + limb * 225;

        od[oIdx]     = clamp(round(r), 0, 255);
        od[oIdx + 1] = clamp(round(g), 0, 255);
        od[oIdx + 2] = clamp(round(b), 0, 255);
        od[oIdx + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);

    // Real spherical graticule
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.16)';
    ctx.lineWidth = 1;
    for (let lonDeg = -150; lonDeg <= 180; lonDeg += 30) {
      ctx.beginPath();
      let started = false;
      for (let latDeg = -85; latDeg <= 85; latDeg += 5) {
        const pt = latLonToGlobePoint(latDeg, lonDeg, cx, cy, rad);
        if (pt.vis) {
          if (!started) { ctx.moveTo(pt.px, pt.py); started = true; }
          else ctx.lineTo(pt.px, pt.py);
        } else started = false;
      }
      ctx.stroke();
    }
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      ctx.beginPath();
      let started = false;
      for (let lonDeg = -180; lonDeg <= 180; lonDeg += 6) {
        const pt = latLonToGlobePoint(latDeg, lonDeg, cx, cy, rad);
        if (pt.vis) {
          if (!started) { ctx.moveTo(pt.px, pt.py); started = true; }
          else ctx.lineTo(pt.px, pt.py);
        } else started = false;
      }
      ctx.stroke();
    }

    // Breadcrumb trail on globe
    if (navTrail.length >= 2) {
      ctx.strokeStyle = 'rgba(92, 200, 242, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < navTrail.length; i++) {
        const pt = latLonToGlobePoint(navTrail[i].latDeg, navTrail[i].lonDeg, cx, cy, rad);
        if (pt.vis) {
          if (!started) { ctx.moveTo(pt.px, pt.py); started = true; }
          else ctx.lineTo(pt.px, pt.py);
        } else started = false;
      }
      ctx.stroke();
    }

    ctx.font = '600 10px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BIOME_CATALOG.length; i++) {
      const b = BIOME_CATALOG[i];
      const pt = latLonToGlobePoint(b.latDeg, b.lonDeg, cx, cy, rad);
      projectedGlobePins.push({ biome: b, idx: i, px: pt.px, py: pt.py, vis: pt.vis });
      if (!pt.vis) continue;
      const isForbidden = b.forbidden;
      const isOcean = b.category === 'Coast & Ocean' || b.category === 'Polar Realm';
      ctx.fillStyle = isForbidden ? 'rgba(220, 58, 58, 0.94)' : isOcean ? 'rgba(20, 148, 212, 0.94)' : 'rgba(226, 184, 87, 0.94)';
      ctx.strokeStyle = '#060d0a';
      ctx.lineWidth = 1.5;
      ctx.fillRect(pt.px - 9, pt.py - 9, 18, 18);
      ctx.strokeRect(pt.px - 9, pt.py - 9, 18, 18);
      ctx.fillStyle = isForbidden || isOcean ? '#ffffff' : '#09100c';
      ctx.fillText(String(i + 1).padStart(2, '0'), pt.px, pt.py + 0.5);
    }

    if (activeWaypoint) {
      const wpPt = latLonToGlobePoint(activeWaypoint.latDeg, activeWaypoint.lonDeg, cx, cy, rad);
      if (wpPt.vis) {
        ctx.save();
        ctx.translate(wpPt.px, wpPt.py);
        ctx.rotate(PI * 0.25);
        ctx.fillStyle = '#5cc8f2';
        ctx.fillRect(-6, -6, 12, 12);
        ctx.strokeStyle = '#060d0a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
      }
    }

    const pPt = latLonToGlobePoint(camState.latDeg, camState.lonDeg, cx, cy, rad);
    if (pPt.vis) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pPt.px, pPt.py, 6, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    return;
  }

  // --- 2D Equirectangular Planetary Topographic & Bathymetric Map ---
  ctx.putImageData(mapBaseImageData, 0, 0);

  ctx.strokeStyle = 'rgba(125, 211, 252, 0.14)';
  ctx.lineWidth = 1;
  for (let lonDeg = -150; lonDeg <= 150; lonDeg += 30) {
    const x = ((lonDeg + 180) / 360) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    const y = ((90 - latDeg) / 180) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (navTrail.length >= 2) {
    ctx.strokeStyle = 'rgba(92, 200, 242, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < navTrail.length; i++) {
      const [tx, ty] = latLonToMapPx(navTrail[i].latDeg, navTrail[i].lonDeg, w, h);
      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    }
    ctx.stroke();
  }

  ctx.font = '600 10px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const [bx, by] = latLonToMapPx(b.latDeg, b.lonDeg, w, h);
    projectedGlobePins.push({ biome: b, idx: i, px: bx, py: by, vis: true });
    const isForbidden = b.forbidden;
    const isOcean = b.category === 'Coast & Ocean' || b.category === 'Polar Realm';
    ctx.fillStyle = isForbidden ? 'rgba(220, 58, 58, 0.94)' : isOcean ? 'rgba(20, 148, 212, 0.94)' : 'rgba(226, 184, 87, 0.94)';
    ctx.strokeStyle = '#060d0a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx - 9, by - 9, 18, 18);
    ctx.strokeRect(bx - 9, by - 9, 18, 18);
    ctx.fillStyle = isForbidden || isOcean ? '#ffffff' : '#09100c';
    ctx.fillText(String(i + 1).padStart(2, '0'), bx, by + 0.5);
  }

  const [cx, cy] = latLonToMapPx(camState.latDeg, camState.lonDeg, w, h);
  if (activeWaypoint) {
    const [wx, wy] = latLonToMapPx(activeWaypoint.latDeg, activeWaypoint.lonDeg, w, h);
    ctx.strokeStyle = 'rgba(92, 200, 242, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(wx, wy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(PI * 0.25);
    ctx.fillStyle = '#5cc8f2';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeStyle = '#060d0a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(camState.yaw);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 28, -PI * 0.72, -PI * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5.5, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

// Continuous Orbital Ascent <-> Atmospheric Re-Entry Toggle (NO Teleportation!)
function ascendToPlanetaryOrbit() {
  disembodyAnimal();
  flyActive = false;
  autoExplore = false;
  if (solarState.mode === 'interplanetary') {
    // Engage guided continuous return flight back to Earth
    solarState.targetBodyId = 'earth';
    solarState.autopilotCourse = true;
    enterWilderness();
    return;
  }
  if (camState.altMeters < 180000) {
    camState.autopilot = 'ascent';
    camState.velU = max(camState.velU, 85);
  } else {
    camState.autopilot = 'descent';
    camState.velU = min(camState.velU, -260);
  }
  enterWilderness();
}

// Optional fast-travel convenience via 3D Planetary Globe / 2D Map / Quick-Bar
function teleportToLatLon(latDeg, lonDeg, poseIdx = -1) {
  flyActive = false;
  autoExplore = false;
  camState.autopilot = null;
  solarState.mode = 'earth_geodetic';
  solarState.autopilotCourse = false;
  solarInterplanetaryBlend = 0.0;
  if (poseIdx >= 0 && BIOME_CATALOG[poseIdx]) {
    applyBiomePose(poseIdx);
  } else {
    camState.latDeg = clamp(latDeg, -89.8, 89.8);
    camState.lonDeg = normAngle(lonDeg * DEG2RAD) * RAD2DEG;
    camState.latRad = camState.latDeg * DEG2RAD;
    camState.lonRad = camState.lonDeg * DEG2RAD;
    camState.velE = camState.velN = camState.velU = 0;
    camState.reentryHeat = 0;
    rebaseRegionalOrigin(camState.latDeg, camState.lonDeg, -1);
    const surf = samplePlanetAtLatLon(camState.latDeg, camState.lonDeg, _camT, 2);
    const ty = surf.h < -0.5 ? max(surf.h + 2.5, -5.5) : surf.h + 3.2;
    lookAtPose(0, ty, 0, sin(F[YAW]) * 18, ty - 0.6, -cos(F[YAW]) * 18);
    forceSyncTiles = true;
  }
  if (embodiedState.active && embodiedState.groupIdx >= 0) {
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp.items[embodiedState.itemIdx];
    if (it) {
      it.x = it.prevX = it.cx = 0;
      it.z = it.prevZ = it.cz = 0;
      terrainAt(0, 0, _camT);
      it.y = it.prevY = grp.domain === 'water' ? min(-1.5, _camT.h + 2.2) : grp.domain === 'air' ? max(16, _camT.h + 12) : max(0.05, _camT.h);
    }
  }
  recordNavTrailPoint(camState.latDeg, camState.lonDeg);
  if (locEl) locEl.textContent = biomeLabelAtGeo(camState.latDeg, camState.lonDeg, camState.altMeters);
  enterWilderness();
}

function teleportToWorldCoord(xOrLat, zOrLon, poseIdx = -1) {
  if (poseIdx >= 0 && BIOME_CATALOG[poseIdx]) {
    teleportToLatLon(BIOME_CATALOG[poseIdx].latDeg, BIOME_CATALOG[poseIdx].lonDeg, poseIdx);
    return;
  }
  const ll = localMetersToLatLon(xOrLat, zOrLon, getActiveOrigin());
  teleportToLatLon(ll.latDeg, ll.lonDeg, -1);
}

if (mapPinBar) {
  mapPinBar.innerHTML = '';
  BIOME_CATALOG.forEach((b, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'loc-btn';
    btn.textContent = `${String(idx + 1).padStart(2, '0')} ${b.name}`;
    btn.onclick = () => {
      if (mapClickMode === 'waypoint') {
        setWaypoint(b.latDeg, b.lonDeg, b.name);
        renderPlanetaryMap();
      } else {
        teleportToLatLon(b.latDeg, b.lonDeg, idx);
      }
    };
    mapPinBar.appendChild(btn);
  });
}

if (planetMapCanvas) {
  planetMapCanvas.addEventListener('mousedown', (e) => {
    if (mapViewMode === 'globe') {
      globeDragging = true;
      globeDragMoved = false;
      globeLastX = e.clientX;
      globeLastY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => {
    globeDragging = false;
  });
  planetMapCanvas.addEventListener('mousemove', (e) => {
    const rect = planetMapCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * planetMapCanvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * planetMapCanvas.height;

    if (mapViewMode === 'solar') {
      let nearBody = null;
      for (let i = 0; i < projectedSolarPins.length; i++) {
        const p = projectedSolarPins[i];
        if (hypot(px - p.px, py - p.py) <= p.r) {
          nearBody = p.body;
          break;
        }
      }
      if (mapTooltip) {
        if (!nearBody) {
          mapTooltip.style.display = 'none';
          return;
        }
        const bp = solarState.positions.get(nearBody.id);
        const dM = max(0, hypot(bp[0] - solarState.posM[0], bp[1] - solarState.posM[1], bp[2] - solarState.posM[2]) - nearBody.radiusM);
        mapTooltip.style.display = 'block';
        mapTooltip.style.left = clamp(e.clientX - rect.left + 14, 8, rect.width - 265) + 'px';
        mapTooltip.style.top = clamp(e.clientY - rect.top + 14, 8, rect.height - 105) + 'px';
        mapTooltip.innerHTML = `<strong style="color:#fde047">${nearBody.name}</strong><br><span>Orbit: ${nearBody.aAU.toFixed(3)} AU · Radius: ${(nearBody.radiusM / 1000).toLocaleString()} km · Dist: ${formatDistanceSI(dM)}</span><br><span style="color:#93c5fd">${nearBody.desc}</span>`;
      }
      return;
    }

    if (mapViewMode === 'globe' && globeDragging) {
      const dx = e.clientX - globeLastX;
      const dy = e.clientY - globeLastY;
      if (hypot(dx, dy) > 2) globeDragMoved = true;
      globeYaw = normAngle(globeYaw - dx * 0.008);
      globePitch = clamp(globePitch + dy * 0.008, -1.35, 1.35);
      globeLastX = e.clientX;
      globeLastY = e.clientY;
      renderPlanetaryMap();
      return;
    }

    let nearPin = null;
    for (let i = 0; i < projectedGlobePins.length; i++) {
      const p = projectedGlobePins[i];
      if (p.vis && hypot(px - p.px, py - p.py) < 16) {
        nearPin = p.biome;
        break;
      }
    }

    let geoCoord = null;
    if (mapViewMode === 'globe') {
      const w = planetMapCanvas.width, h = planetMapCanvas.height;
      geoCoord = globePxToLatLon(px, py, w * 0.5, h * 0.5, min(w, h) * 0.43);
    } else {
      geoCoord = mapPxToLatLon(px, py, planetMapCanvas.width, planetMapCanvas.height);
    }

    if (mapTooltip) {
      if (!nearPin && !geoCoord) {
        mapTooltip.style.display = 'none';
        return;
      }
      mapTooltip.style.display = 'block';
      mapTooltip.style.left = clamp(e.clientX - rect.left + 14, 8, rect.width - 265) + 'px';
      mapTooltip.style.top = clamp(e.clientY - rect.top + 14, 8, rect.height - 105) + 'px';
      const actionVerb = mapClickMode === 'waypoint' ? 'Click to set GPS waypoint' : 'Click to travel';
      if (nearPin) {
        const distKm = greatCircleDistanceMeters(camState.latDeg, camState.lonDeg, nearPin.latDeg, nearPin.lonDeg) * 0.001;
        const latS = `${abs(nearPin.latDeg).toFixed(1)}°${nearPin.latDeg >= 0 ? 'N' : 'S'}`;
        const lonS = `${abs(nearPin.lonDeg).toFixed(1)}°${nearPin.lonDeg >= 0 ? 'E' : 'W'}`;
        mapTooltip.innerHTML = `<strong style="color:#fde047">${nearPin.id + 1}. ${nearPin.name}</strong><br><span>${nearPin.continent} · ${latS} ${lonS} · ${round(distKm).toLocaleString()} km away</span><br><span style="color:#93c5fd">Fauna: ${nearPin.species} · ${actionVerb}</span>`;
      } else if (geoCoord) {
        const [latDeg, lonDeg] = geoCoord;
        samplePlanetAtLatLon(latDeg, lonDeg, _camT, 1);
        const distKm = greatCircleDistanceMeters(camState.latDeg, camState.lonDeg, latDeg, lonDeg) * 0.001;
        const elStr = (_camT.h >= 0 ? '+' : '') + round(_camT.h) + 'm';
        const bName = biomeLabelAtGeo(latDeg, lonDeg, _camT.h < -0.5 ? _camT.h * 0.5 : _camT.h + 2.0);
        const latS = `${abs(latDeg).toFixed(1)}°${latDeg >= 0 ? 'N' : 'S'}`;
        const lonS = `${abs(lonDeg).toFixed(1)}°${lonDeg >= 0 ? 'E' : 'W'}`;
        mapTooltip.innerHTML = `<strong style="color:#fde047">${bName}</strong><br><span>${latS} ${lonS} · Elev ${elStr} · ${round(distKm).toLocaleString()} km away</span><br><span style="color:#86efac">${actionVerb} · Drag globe to rotate</span>`;
      }
    }
  });
  planetMapCanvas.addEventListener('mouseleave', () => {
    if (mapTooltip) mapTooltip.style.display = 'none';
  });
  planetMapCanvas.addEventListener('click', (e) => {
    if (mapViewMode === 'globe' && globeDragMoved) {
      globeDragMoved = false;
      return;
    }
    const rect = planetMapCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * planetMapCanvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * planetMapCanvas.height;

    if (mapViewMode === 'solar') {
      for (let i = 0; i < projectedSolarPins.length; i++) {
        const p = projectedSolarPins[i];
        if (hypot(px - p.px, py - p.py) <= p.r) {
          solarState.targetBodyId = p.body.id;
          if ($('solarTargetSel')) $('solarTargetSel').value = p.body.id;
          renderPlanetaryMap();
          return;
        }
      }
      return;
    }

    for (let i = 0; i < projectedGlobePins.length; i++) {
      const p = projectedGlobePins[i];
      if (p.vis && hypot(px - p.px, py - p.py) < 16) {
        if (mapClickMode === 'waypoint') {
          setWaypoint(p.biome.latDeg, p.biome.lonDeg, p.biome.name);
          renderPlanetaryMap();
        } else {
          teleportToLatLon(p.biome.latDeg, p.biome.lonDeg, p.idx);
        }
        return;
      }
    }
    let gc = null;
    if (mapViewMode === 'globe') {
      const w = planetMapCanvas.width, h = planetMapCanvas.height;
      gc = globePxToLatLon(px, py, w * 0.5, h * 0.5, min(w, h) * 0.43);
    } else {
      gc = mapPxToLatLon(px, py, planetMapCanvas.width, planetMapCanvas.height);
    }
    if (gc) {
      if (mapClickMode === 'waypoint') {
        setWaypoint(gc[0], gc[1]);
        renderPlanetaryMap();
      } else {
        teleportToLatLon(gc[0], gc[1], -1);
      }
    }
  });
}

function setMapViewMode(mode) {
  mapViewMode = mode;
  if ($('mapModeGlobeBtn')) $('mapModeGlobeBtn').classList.toggle('active', mode === 'globe');
  if ($('mapModeFlatBtn')) $('mapModeFlatBtn').classList.toggle('active', mode === 'flat');
  if ($('mapModeSolarBtn')) $('mapModeSolarBtn').classList.toggle('active', mode === 'solar');
  if ($('solarControlsBar')) $('solarControlsBar').classList.toggle('open', mode === 'solar');
  if ($('mapPinBar')) $('mapPinBar').style.display = mode === 'solar' ? 'none' : '';
  renderPlanetaryMap();
}
if ($('mapModeGlobeBtn')) $('mapModeGlobeBtn').onclick = () => setMapViewMode('globe');
if ($('mapModeFlatBtn')) $('mapModeFlatBtn').onclick = () => setMapViewMode('flat');
if ($('mapModeSolarBtn')) $('mapModeSolarBtn').onclick = () => setMapViewMode('solar');
if ($('mapClickModeBtn')) {
  $('mapClickModeBtn').onclick = () => {
    mapClickMode = mapClickMode === 'travel' ? 'waypoint' : 'travel';
    $('mapClickModeBtn').textContent = mapClickMode === 'waypoint' ? 'Click: Waypoint' : 'Click: Travel';
    $('mapClickModeBtn').classList.toggle('active', mapClickMode === 'waypoint');
  };
}
if ($('clearWaypointBtn')) {
  $('clearWaypointBtn').onclick = () => {
    clearWaypoint();
    renderPlanetaryMap();
  };
}
if ($('solarTargetSel')) {
  $('solarTargetSel').onchange = (e) => {
    solarState.targetBodyId = e.target.value;
    renderPlanetaryMap();
  };
}
if ($('solarGuideBtn')) {
  $('solarGuideBtn').onclick = () => {
    if (solarState.autopilotCourse) {
      solarState.autopilotCourse = false;
      $('solarGuideBtn').textContent = 'Engage Course Guidance';
      $('solarGuideBtn').classList.remove('active');
    } else {
      disembodyAnimal();
      flyActive = false;
      autoExplore = false;
      camState.autopilot = null;
      if (solarState.mode !== 'interplanetary') {
        // Begin continuous outward heliocentric flight from current Earth position (NO teleport!)
        const launchAlt = max(camState.altMeters, EARTH_ORBIT_HANDOFF_ALT + 5000.0);
        if (camState.altMeters < EARTH_ORBIT_HANDOFF_ALT) {
          camState.altMeters = launchAlt;
        }
        syncSolarFromEarthCam(solarState, camState.latRad, camState.lonRad, camState.altMeters);
        solarState.mode = 'interplanetary';
      }
      solarState.autopilotCourse = true;
      $('solarGuideBtn').textContent = 'Disengage Guidance';
      $('solarGuideBtn').classList.add('active');
      enterWilderness();
    }
  };
}
if ($('solarThrustRange')) {
  $('solarThrustRange').oninput = (e) => {
    const v = parseFloat(e.target.value) || 4.0;
    solarState.propulsionScale = v;
    speedMult = v;
    if ($('solarThrustVal')) $('solarThrustVal').textContent = v.toFixed(1);
  };
}
if ($('solarTimeWarpRange')) {
  $('solarTimeWarpRange').oninput = (e) => {
    const expVal = parseFloat(e.target.value) || 0;
    const warp = expVal <= 0.05 ? 1.0 : pow(10, expVal);
    solarState.timeAccel = warp;
    if ($('solarTimeWarpVal')) {
      $('solarTimeWarpVal').textContent = warp >= 1e6 ? `${(warp / 1e6).toFixed(1)}Mx` : warp >= 1e3 ? `${(warp / 1e3).toFixed(0)}kx` : `${round(warp)}x`;
    }
  };
}
if ($('mapOrbitBtn')) $('mapOrbitBtn').onclick = () => ascendToPlanetaryOrbit();
if ($('orbitBtn')) $('orbitBtn').onclick = () => ascendToPlanetaryOrbit();

function toggleMapModal(forceState) {
  if (!mapModal) return;
  const open = forceState !== undefined ? forceState : !mapModal.classList.contains('open');
  if (open) {
    if (embodimentModal) embodimentModal.classList.remove('open');
    if (settingsModal) settingsModal.classList.remove('open');
    document.exitPointerLock?.();
    updateMapRegionInfo();
    renderPlanetaryMap();
    mapModal.classList.add('open');
  } else {
    mapModal.classList.remove('open');
  }
}

function toggleEmbodimentModal(forceState) {
  if (!embodimentModal) return;
  const open = forceState !== undefined ? forceState : !embodimentModal.classList.contains('open');
  if (open) {
    if (mapModal) mapModal.classList.remove('open');
    if (settingsModal) settingsModal.classList.remove('open');
    document.exitPointerLock?.();
    updateEmbodimentUI();
    embodimentModal.classList.add('open');
  } else {
    embodimentModal.classList.remove('open');
  }
}

function toggleSettingsModal(forceState) {
  if (!settingsModal) return;
  const open = forceState !== undefined ? forceState : !settingsModal.classList.contains('open');
  if (open) {
    if (mapModal) mapModal.classList.remove('open');
    if (embodimentModal) embodimentModal.classList.remove('open');
    document.exitPointerLock?.();
    syncSettingsUI();
    settingsModal.classList.add('open');
  } else {
    settingsModal.classList.remove('open');
  }
}

// ============================================================================
// Full In-Game Settings Control Panel Synchronization & Persistence
// ============================================================================
let applySettingsToRenderer = () => {};

function applySettings() {
  saveSettings(settings);
  qualityCtrl.setTier(Number(settings.qualityTier) || 0);
  qualityCtrl.setAuto(Boolean(settings.autoQuality));
  showHud = Boolean(settings.showTelemetry);
  cleanUi = settings.showHud === false;
  syncBodyClasses();
  if (infoEl) infoEl.style.display = showHud ? 'block' : 'none';
  if (coordBadgeEl) coordBadgeEl.style.display = settings.showCoordinates ? '' : 'none';
  focalMm = round(18 / tan((clamp(settings.fov || 54, 35, 110) * PI) / 360));
  if ($('focalRange')) $('focalRange').value = String(focalMm);
  if ($('focalVal')) $('focalVal').textContent = `${focalMm}mm`;

  speedMult = clamp(settings.moveSpeedMult || 1.0, 0.2, 10.0);
  if ($('speedRange')) $('speedRange').value = String(speedMult);
  if ($('speedVal')) $('speedVal').textContent = speedMult.toFixed(1) + 'x';

  if (world.setHazardAvoidance) world.setHazardAvoidance(Boolean(settings.hazardAvoidance));
  setAudioSettings(settings);
  if ($('volRange')) $('volRange').value = String(settings.masterVolume);

  applySettingsToRenderer();
}

function syncSettingsUI() {
  const setVal = (id, v) => { const el = $(id); if (el) el.value = String(v); };
  const setChk = (id, v) => { const el = $(id); if (el) el.checked = Boolean(v); };
  const setTxt = (id, t) => { const el = $(id); if (el) el.textContent = t; };

  setVal('setQualityTier', settings.qualityTier);
  setChk('setAutoQuality', settings.autoQuality);
  setVal('setResScale', settings.resolutionScale);
  setTxt('setResScaleVal', `${round(settings.resolutionScale * 100)}%`);
  setVal('setViewDist', settings.viewDistance);
  setTxt('setViewDistVal', `${Number(settings.viewDistance).toFixed(2)}x`);
  setVal('setVegDensity', settings.foliageDensity);
  setTxt('setVegDensityVal', `${round(settings.foliageDensity * 100)}%`);
  setVal('setWaterQuality', settings.waterQuality);
  setTxt('setWaterQualityVal', `${round(settings.waterQuality * 100)}%`);

  setChk('setShowHud', settings.showHud);
  setChk('setShowMiniMap', settings.showMiniMap !== false);
  setVal('setMiniMapMode', settings.miniMapMode || 'north-up');
  setChk('setShowCoords', settings.showCoordinates);
  setChk('setShowTelemetry', settings.showTelemetry);
  setVal('setFov', settings.fov);
  setTxt('setFovVal', `${round(settings.fov)}°`);

  setVal('setDefaultPov', settings.defaultPov);
  setVal('setMouseSens', settings.mouseSensitivity);
  setTxt('setMouseSensVal', `${Number(settings.mouseSensitivity).toFixed(1)}x`);
  setChk('setInvertY', settings.invertY);
  setVal('setFollowDist', settings.followDistance);
  setTxt('setFollowDistVal', `${Number(settings.followDistance).toFixed(2)}x`);
  setVal('setFollowHeight', settings.followHeight);
  setTxt('setFollowHeightVal', `${Number(settings.followHeight).toFixed(2)}x`);
  setVal('setCamSmooth', settings.cameraSmoothing);
  setTxt('setCamSmoothVal', `${round(settings.cameraSmoothing * 100)}%`);
  setChk('setAutoRecenter', settings.autoRecenter);

  setVal('setMasterVol', settings.masterVolume);
  setTxt('setMasterVolVal', `${round(settings.masterVolume * 100)}%`);
  setVal('setAmbientVol', settings.ambientVolume);
  setTxt('setAmbientVolVal', `${round(settings.ambientVolume * 100)}%`);
  setVal('setWildlifeVol', settings.wildlifeVolume);
  setTxt('setWildlifeVolVal', `${round(settings.wildlifeVolume * 100)}%`);
  setVal('setWaterVol', settings.waterVolume);
  setTxt('setWaterVolVal', `${round(settings.waterVolume * 100)}%`);
  setVal('setWeatherVol', settings.weatherVolume);
  setTxt('setWeatherVolVal', `${round(settings.weatherVolume * 100)}%`);

  setVal('setTurnSens', settings.turnSensitivity);
  setTxt('setTurnSensVal', `${Number(settings.turnSensitivity).toFixed(1)}x`);
  setVal('setMoveSpeed', settings.moveSpeedMult);
  setTxt('setMoveSpeedVal', `${Number(settings.moveSpeedMult).toFixed(1)}x`);

  setChk('setHazardAvoid', settings.hazardAvoidance);
  setVal('setTimeSpeed', settings.timeSpeedMult);
  setTxt('setTimeSpeedVal', `${Number(settings.timeSpeedMult).toFixed(1)}x`);
  setVal('weatherSel', weatherMode);
  const nearB = nearestBiomeAtGeo(camState.latDeg, camState.lonDeg);
  if (nearB) setVal('setBiomeJump', nearB.id);
}

if ($('setQualityTier')) {
  $('setQualityTier').onchange = (e) => {
    const tierIdx = parseInt(e.target.value, 10) || 0;
    settings.qualityTier = tierIdx;
    const preset = QUALITY_TIERS[tierIdx];
    if (preset) {
      settings.resolutionScale = preset.scale;
      settings.viewDistance = preset.terrainLodBias;
      settings.foliageDensity = preset.vegRatio;
      settings.animalDetail = preset.animalRatio;
    }
    syncSettingsUI();
    applySettings();
  };
}
const bindSettingRange = (id, valId, key, fmt) => {
  const el = $(id);
  if (!el) return;
  el.oninput = () => {
    const v = parseFloat(el.value);
    settings[key] = v;
    const vEl = $(valId);
    if (vEl) vEl.textContent = fmt(v);
    applySettings();
  };
};
bindSettingRange('setResScale', 'setResScaleVal', 'resolutionScale', (v) => `${round(v * 100)}%`);
bindSettingRange('setViewDist', 'setViewDistVal', 'viewDistance', (v) => `${v.toFixed(2)}x`);
bindSettingRange('setVegDensity', 'setVegDensityVal', 'foliageDensity', (v) => `${round(v * 100)}%`);
bindSettingRange('setWaterQuality', 'setWaterQualityVal', 'waterQuality', (v) => `${round(v * 100)}%`);
bindSettingRange('setFov', 'setFovVal', 'fov', (v) => `${round(v)}°`);
bindSettingRange('setMouseSens', 'setMouseSensVal', 'mouseSensitivity', (v) => `${v.toFixed(1)}x`);
bindSettingRange('setFollowDist', 'setFollowDistVal', 'followDistance', (v) => `${v.toFixed(2)}x`);
bindSettingRange('setFollowHeight', 'setFollowHeightVal', 'followHeight', (v) => `${v.toFixed(2)}x`);
bindSettingRange('setCamSmooth', 'setCamSmoothVal', 'cameraSmoothing', (v) => `${round(v * 100)}%`);
bindSettingRange('setMasterVol', 'setMasterVolVal', 'masterVolume', (v) => `${round(v * 100)}%`);
bindSettingRange('setAmbientVol', 'setAmbientVolVal', 'ambientVolume', (v) => `${round(v * 100)}%`);
bindSettingRange('setWildlifeVol', 'setWildlifeVolVal', 'wildlifeVolume', (v) => `${round(v * 100)}%`);
bindSettingRange('setWaterVol', 'setWaterVolVal', 'waterVolume', (v) => `${round(v * 100)}%`);
bindSettingRange('setWeatherVol', 'setWeatherVolVal', 'weatherVolume', (v) => `${round(v * 100)}%`);
bindSettingRange('setTurnSens', 'setTurnSensVal', 'turnSensitivity', (v) => `${v.toFixed(1)}x`);
bindSettingRange('setMoveSpeed', 'setMoveSpeedVal', 'moveSpeedMult', (v) => `${v.toFixed(1)}x`);
bindSettingRange('setTimeSpeed', 'setTimeSpeedVal', 'timeSpeedMult', (v) => `${v.toFixed(1)}x`);

const bindSettingCheck = (id, key) => {
  const el = $(id);
  if (!el) return;
  el.onchange = () => {
    settings[key] = Boolean(el.checked);
    applySettings();
  };
};
bindSettingCheck('setAutoQuality', 'autoQuality');
bindSettingCheck('setShowHud', 'showHud');
bindSettingCheck('setShowMiniMap', 'showMiniMap');
bindSettingCheck('setShowCoords', 'showCoordinates');
bindSettingCheck('setShowTelemetry', 'showTelemetry');
bindSettingCheck('setInvertY', 'invertY');
bindSettingCheck('setAutoRecenter', 'autoRecenter');
bindSettingCheck('setHazardAvoid', 'hazardAvoidance');

if ($('setMiniMapMode')) {
  $('setMiniMapMode').onchange = (e) => {
    settings.miniMapMode = e.target.value === 'track-up' ? 'track-up' : 'north-up';
    if (mmModeBtn) mmModeBtn.textContent = settings.miniMapMode === 'track-up' ? 'TRK-UP' : 'N-UP';
    applySettings();
  };
}
if ($('setDefaultPov')) {
  $('setDefaultPov').onchange = (e) => {
    settings.defaultPov = parseInt(e.target.value, 10) === 1 ? 1 : 0;
    embodiedState.pov = settings.defaultPov === 1 ? '1st' : '3rd';
    updateEmbodimentUI();
    applySettings();
  };
}
if ($('resetSettingsBtn')) {
  $('resetSettingsBtn').onclick = () => {
    settings = resetSettings();
    syncSettingsUI();
    applySettings();
  };
}

// Wire up HUD & Menu Buttons immediately so they work in all environments
if ($('openMapBtn')) $('openMapBtn').onclick = () => toggleMapModal();
if ($('menuMapBtn')) $('menuMapBtn').onclick = () => toggleMapModal(true);
if ($('closeMapBtn')) $('closeMapBtn').onclick = () => toggleMapModal(false);
if ($('openEmbodyBtn')) $('openEmbodyBtn').onclick = () => toggleEmbodimentModal();
if ($('menuEmbodyBtn')) $('menuEmbodyBtn').onclick = () => toggleEmbodimentModal(true);
if ($('closeEmbodyBtn')) $('closeEmbodyBtn').onclick = () => toggleEmbodimentModal(false);
if ($('openSettingsBtn')) $('openSettingsBtn').onclick = () => toggleSettingsModal();
if ($('menuSettingsBtn')) $('menuSettingsBtn').onclick = () => toggleSettingsModal(true);
if ($('closeSettingsBtn')) $('closeSettingsBtn').onclick = () => toggleSettingsModal(false);
if ($('disembodyBtn')) $('disembodyBtn').onclick = () => { disembodyAnimal(); toggleEmbodimentModal(false); };
if (togglePovBtn) togglePovBtn.onclick = () => togglePovMode();
if (modalPovToggleBtn) modalPovToggleBtn.onclick = () => togglePovMode();
if ($('instinctBtn')) $('instinctBtn').onclick = () => { instinctPulse = 0.02; };
if ($('weatherCycleBtn')) {
  $('weatherCycleBtn').onclick = () => {
    weatherMode = weatherMode < 0 ? 0 : (weatherMode + 1) >= WEATHER_PRESETS.length ? -1 : weatherMode + 1;
    settings.weatherMode = weatherMode;
    const sel = $('weatherSel');
    if (sel) sel.value = String(weatherMode);
    saveSettings(settings);
  };
}
if (goBtn) goBtn.onclick = enterWilderness;

// Location quick jump buttons
document.querySelectorAll('[data-pose]').forEach((btn) => {
  btn.onclick = () => {
    const idx = parseInt(btn.dataset.pose, 10);
    if (POSES[idx]) teleportToWorldCoord(POSES[idx][0], POSES[idx][2], idx);
  };
});

syncSettingsUI();
applySettings();

// Expose planetary test & inspection hooks on window
window.__terraPrimordia = {
  world,
  planetQuadtree,
  camState,
  solarState,
  navTrail,
  settings,
  BIOME_CATALOG,
  POSES,
  embodiedState,
  inhabitAnimal,
  disembodyAnimal,
  togglePovMode,
  setWaypoint,
  clearWaypoint,
  teleportToLatLon,
  teleportToWorldCoord,
  ascendToPlanetaryOrbit,
  triggerWhaleBreach: (idx = 0) => world.triggerWhaleBreach('whales', idx),
  toggleMapModal,
  toggleEmbodimentModal,
  toggleSettingsModal,
  getCameraPos: () => [F[CX], F[CY], F[CZ]],
  getGeoPos: () => ({ latDeg: camState.latDeg, lonDeg: camState.lonDeg, altMeters: camState.altMeters, layer: camState.layer, stage: camState.stage, solarMode: solarState.mode })
};
window.__realism = window.__terraPrimordia;

// ============================================================================
// Keyboard, Mouse, Touch & UI Event Listeners
// ============================================================================
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, kShift = 0, kCtrl = 0;
let mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0;

function pickNextExploreTarget() {
  const ang = rr(0, TAU);
  const dist = rr(28, 85);
  autoTargetX = F[CX] + cos(ang) * dist;
  autoTargetZ = F[CZ] + sin(ang) * dist;
  terrainAt(autoTargetX, autoTargetZ, _camT);
  autoTargetY = max(_camT.h + 2.8, 3.2) + rr(0, 4.5);
  autoLegTimer = rr(12, 22);
}

const KEY_MAP = {
  KeyW: (v) => { kf = v; }, ArrowUp:    (v) => { kf = v; },
  KeyS: (v) => { kb = v; }, ArrowDown:  (v) => { kb = v; },
  KeyA: (v) => { kl = v; }, ArrowLeft:  (v) => { kl = v; },
  KeyD: (v) => { kr = v; }, ArrowRight: (v) => { kr = v; },
  Space: (v) => {
    ku = v;
    if (v && embodiedState.active && embodiedState.groupIdx >= 0) {
      const grp = world.wildlifeGroups[embodiedState.groupIdx];
      const it = grp?.items[embodiedState.itemIdx];
      // Sharks stay submerged; whales & orcas can breach cleanly when near the surface
      if (grp.name === 'sharks') {
        embodiedState.vy = 2.4;
      } else {
        embodiedState.vy = grp.name === 'whales' || grp.name === 'orcas' ? 9.5 : 7.8;
      }
      if (it) {
        it.roarTimer = 2.2;
        it.emotion = 3;
      }
    }
  },
  KeyC: (v) => { kd = v; },
  ShiftLeft: (v) => { kShift = v; }, ShiftRight: (v) => { kShift = v; },
  ControlLeft: (v) => { kCtrl = v; }, ControlRight: (v) => { kCtrl = v; }
};

window.addEventListener('keydown', (e) => {
  noteUserActivity();
  if (e.code === 'KeyM') {
    e.preventDefault();
    toggleMapModal();
    return;
  }
  if (e.code === 'KeyO') {
    e.preventDefault();
    toggleSettingsModal();
    return;
  }
  if (e.code === 'KeyG') {
    e.preventDefault();
    ascendToPlanetaryOrbit();
    return;
  }
  if (e.code === 'KeyB') {
    world.triggerWhaleBreach('whales', 0);
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    toggleEmbodimentModal();
    return;
  }
  if (e.code === 'KeyV') {
    e.preventDefault();
    togglePovMode();
    return;
  }
  if (e.code === 'KeyE') {
    const nearest = world.findNearestAnimal(F[CX], F[CY], F[CZ], 65);
    if (nearest) inhabitAnimal(nearest.groupIdx, nearest.itemIdx);
    return;
  }
  if (e.code === 'KeyQ') {
    instinctPulse = 0.02;
    return;
  }
  if (e.code === 'KeyR' && embodiedState.active && embodiedState.groupIdx >= 0) {
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp?.items[embodiedState.itemIdx];
    if (it) {
      it.roarTimer = 2.8;
      it.emotion = 3;
    }
    triggerSpeciesCall(grp.speciesId, 5, F[CY] < 0);
    updateEmbodimentUI();
    return;
  }
  if (KEY_MAP[e.code]) {
    if (camState.autopilot && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'Space' || e.code === 'KeyC')) {
      camState.autopilot = null;
    }
    KEY_MAP[e.code](1);
    return;
  }
  if (e.code === 'Escape') {
    if (settingsModal?.classList.contains('open')) { toggleSettingsModal(false); return; }
    if (mapModal?.classList.contains('open')) { toggleMapModal(false); return; }
    if (embodimentModal?.classList.contains('open')) { toggleEmbodimentModal(false); return; }
    setMenu(!menu);
    if (menu) document.exitPointerLock?.();
  } else if (e.code === 'KeyF') {
    disembodyAnimal();
    camState.autopilot = null;
    flyActive = !flyActive;
    F[FLT] = 0;
    if (flyActive && menu) enterWilderness();
  } else if (e.code === 'KeyH') {
    showHud = !showHud;
    settings.showTelemetry = showHud;
    saveSettings(settings);
    if (infoEl) infoEl.style.display = showHud ? 'block' : 'none';
  } else if (e.code === 'KeyU') {
    cleanUi = !cleanUi;
    settings.showHud = !cleanUi;
    saveSettings(settings);
    syncBodyClasses();
  } else if (e.code === 'KeyP') {
    photoMode = !photoMode;
    if (photoMode && menu) setMenu(false);
    syncBodyClasses();
  } else if (e.code === 'KeyL') {
    lookdevMode = !lookdevMode;
    if (lookdevMode && menu) setMenu(false);
    syncBodyClasses();
  } else if (e.code === 'KeyW' && e.altKey) {
    weatherMode = weatherMode < 0 ? 0 : (weatherMode + 1) >= WEATHER_PRESETS.length ? -1 : weatherMode + 1;
    settings.weatherMode = weatherMode;
    saveSettings(settings);
    const sel = $('weatherSel');
    if (sel) sel.value = String(weatherMode);
  } else if (e.code === 'KeyT') {
    todIdx = (todIdx + 1) % TOD_PRESETS.length;
    settings.todIdx = todIdx;
    saveSettings(settings);
  } else if (e.code === 'KeyN') {
    initAudio();
    const m = toggleMute();
    settings.muteAudio = m;
    saveSettings(settings);
    const mb = $('muteBtn');
    if (mb) mb.textContent = m ? 'Audio: Off' : 'Audio: On';
  } else if (e.code.startsWith('Digit')) {
    const idx = parseInt(e.code.slice(5), 10) - 1;
    if (BIOME_CATALOG[idx]) teleportToLatLon(BIOME_CATALOG[idx].latDeg, BIOME_CATALOG[idx].lonDeg, idx);
  }
});

window.addEventListener('keyup', (e) => {
  if (KEY_MAP[e.code]) KEY_MAP[e.code](0);
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas || (!menu && e.buttons === 1)) {
    noteUserActivity();
    mdx += e.movementX;
    mdy += e.movementY;
  }
});

canvas.addEventListener('click', () => {
  noteUserActivity();
  if (!menu && !photoMode && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
});

// Sliders & selectors
const bindSlider = (id, valId, fmt, cb) => {
  const el = $(id), vEl = $(valId);
  if (!el) return;
  el.oninput = () => {
    const v = parseFloat(el.value);
    if (vEl) vEl.textContent = fmt(v);
    cb(v);
  };
};
bindSlider('focalRange', 'focalVal', (v) => `${round(v)}mm`, (v) => { focalMm = v; });
bindSlider('apertureRange', 'apertureVal', (v) => `f/${v.toFixed(1)}`, (v) => { apertureF = v; });
bindSlider('focusRange', 'focusVal', (v) => `${round(v)}m`, (v) => { focusDistM = v; });
bindSlider('evRange', 'evVal', (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)), (v) => { evComp = v; });
if ($('cleanUiBtn')) $('cleanUiBtn').onclick = () => { cleanUi = !cleanUi; syncBodyClasses(); };

const speedSlider = $('speedRange'), speedVal = $('speedVal');
if (speedSlider) {
  speedSlider.oninput = () => {
    speedMult = clamp(parseFloat(speedSlider.value) || 1.0, 0.2, 10.0);
    settings.moveSpeedMult = speedMult;
    if (speedVal) speedVal.textContent = speedMult.toFixed(1) + 'x';
    if ($('setMoveSpeed')) $('setMoveSpeed').value = String(speedMult);
    if ($('setMoveSpeedVal')) $('setMoveSpeedVal').textContent = speedMult.toFixed(1) + 'x';
    saveSettings(settings);
  };
}
const weatherSel = $('weatherSel');
if (weatherSel) {
  weatherSel.onchange = () => {
    weatherMode = parseInt(weatherSel.value, 10);
    settings.weatherMode = weatherMode;
    saveSettings(settings);
  };
}
const setBiomeJump = $('setBiomeJump');
if (setBiomeJump) {
  setBiomeJump.onchange = () => {
    const idx = parseInt(setBiomeJump.value, 10);
    if (BIOME_CATALOG[idx]) {
      toggleSettingsModal(false);
      applyBiomePose(idx);
      enterWilderness();
    }
  };
}
const muteBtn = $('muteBtn');
if (muteBtn) {
  muteBtn.onclick = () => {
    initAudio();
    const m = toggleMute();
    muteBtn.textContent = m ? 'Audio: Off' : 'Audio: On';
  };
}
const volRange = $('volRange');
if (volRange) {
  volRange.oninput = () => {
    initAudio();
    setVolume(parseFloat(volRange.value));
  };
}
document.addEventListener('pointerlockchange', syncBodyClasses);

// ============================================================================
// WebGPU Initialization
// ============================================================================
let adapter = null;
if (navigator.gpu) {
  await say('Requesting high-performance WebGPU adapter…', 0.35);
  adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) adapter = await navigator.gpu.requestAdapter();
}
if (!navigator.gpu || !adapter) {
  setMenu(true);
  if (errBox) {
    errBox.style.display = 'block';
    errBox.textContent = 'WebGPU hardware adapter not detected in this browser session — Interactive Planetary Map [M] and Animal Embodiment [Tab] remain available.';
  }
  return;
}

const canTimestamp = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: canTimestamp ? ['timestamp-query'] : []
});

let gpuValidationErr = '';
device.addEventListener('uncapturederror', (e) => {
  if (!gpuValidationErr) gpuValidationErr = e.error?.message || String(e.error);
});

const ctx = canvas.getContext('webgpu');
const canvasFmt = navigator.gpu.getPreferredCanvasFormat();
const HDR_FMT = 'rgba16float';
const DEPTH_FMT = 'depth32float';

await say('Synthesizing 32-material procedural texture array…', 0.48);
const { tex: matTex } = uploadMaterialTextureArray(device);
const matSmp = device.createSampler({
  magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
  addressModeU: 'repeat', addressModeV: 'repeat'
});

await say('Allocating Cube-Sphere Quadtree tile VRAM pool & anatomical wildlife meshes…', 0.62);

function makeBuf(data, usage) {
  const b = device.createBuffer({
    size: max(16, (data.byteLength + 3) & ~3),
    usage,
    mappedAtCreation: true
  });
  new data.constructor(b.getMappedRange()).set(data);
  b.unmap();
  return b;
}

// FrameU (96 floats = 384 bytes) + PlanetU (16 floats = 64 bytes)
const UB_FLOATS = 96;
const UB = new Float32Array(UB_FLOATS);
const uBuf = device.createBuffer({
  size: UB.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const PB_FLOATS = 16;
const PB = new Float32Array(PB_FLOATS);
const pBuf = device.createBuffer({
  size: PB.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const SB_FLOATS = 112;
const SB = new Float32Array(SB_FLOATS);
const sBuf = device.createBuffer({
  size: SB.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

// Genuine 6-Face Cube-Sphere Quadtree GPU Pool (bounded VRAM, deterministic slot reuse)
const TILE_VERT_STRIDE_BYTES = TILE_FLOATS_PER_VERT * 4; // 48 bytes
const TILE_BYTES = TILE_TOTAL_VERTS * TILE_VERT_STRIDE_BYTES; // 357 * 48 = 17,136 bytes
const terTilePoolBuf = device.createBuffer({
  size: planetQuadtree.maxCachedTiles * TILE_BYTES,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
const terTileIBuf = makeBuf(planetQuadtree.indices, GPUBufferUsage.INDEX);
const terTileIdxCount = planetQuadtree.indices.length;
const terTileSurfIdxCount = TILE_GRID * TILE_GRID * 6; // Surface-only indices for ocean water

const terTileInstData = new Float32Array(planetQuadtree.maxActiveTiles * 4);
const terTileInstBuf = device.createBuffer({
  size: terTileInstData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
let activeTiles = [];

// Regional Instanced Flora & Set-Pieces (re-synced automatically whenever region origin rebases)
let uploadedVegVersion = world.getVegVersion();
const vegGpu = world.vegBuffers.map((vb) => ({
  vBuf: makeBuf(vb.verts, GPUBufferUsage.VERTEX),
  iBuf: makeBuf(vb.indices, GPUBufferUsage.INDEX),
  instBuf: makeBuf(vb.instData, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
  instCapBytes: max(16, (vb.instData.byteLength + 3) & ~3),
  count: vb.count,
  instCount: vb.instCount
}));

function syncVegGpuBuffers() {
  const curVer = world.getVegVersion();
  if (curVer === uploadedVegVersion) return;
  uploadedVegVersion = curVer;
  for (let i = 0; i < vegGpu.length; i++) {
    const vb = world.vegBuffers[i];
    const vg = vegGpu[i];
    const needed = max(16, (vb.instData.byteLength + 3) & ~3);
    if (needed > vg.instCapBytes) {
      vg.instBuf.destroy();
      vg.instBuf = makeBuf(vb.instData, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
      vg.instCapBytes = needed;
    } else if (vb.instData.byteLength > 0) {
      device.queue.writeBuffer(vg.instBuf, 0, vb.instData);
    }
    vg.instCount = vb.instCount;
  }
}

// 43 Species Wildlife Cohorts (12-float instance buffers with real CPU IK, pitch & roll)
const animalGpu = world.wildlifeGroups.map((ag) => ({
  vBuf: makeBuf(ag.verts, GPUBufferUsage.VERTEX),
  iBuf: makeBuf(ag.indices, GPUBufferUsage.INDEX),
  instBuf: makeBuf(ag.instData, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
  count: ag.count,
  instCount: ag.instCount
}));

const lookdevGpu = {
  sphereVBuf: makeBuf(world.lookdevRig.sphereMesh.verts, GPUBufferUsage.VERTEX),
  sphereIBuf: makeBuf(world.lookdevRig.sphereMesh.indices, GPUBufferUsage.INDEX),
  sphereCount: world.lookdevRig.sphereMesh.count,
  swatchVBuf: makeBuf(world.lookdevRig.swatchMesh.verts, GPUBufferUsage.VERTEX),
  swatchIBuf: makeBuf(world.lookdevRig.swatchMesh.indices, GPUBufferUsage.INDEX),
  swatchCount: world.lookdevRig.swatchMesh.count,
  instBuf: makeBuf(world.lookdevRig.instData, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
};

const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
const partQBuf = makeBuf(quadVerts, GPUBufferUsage.VERTEX);
const partInstBuf = makeBuf(world.particles, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);

const shadowTex = device.createTexture({
  size: [SHADOW_RES, SHADOW_RES],
  format: DEPTH_FMT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
});
const shadowView = shadowTex.createView();
const shadowSmp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
const postSmp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

// ============================================================================
// Compile WGSL Render & Post Pipelines (Unified Cube-Sphere Planet & Ocean)
// ============================================================================
await say('Compiling WGSL Cube-Sphere planetary, ocean caustic & IK wildlife shaders…', 0.78);

const bglFrame = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
  ]
});
const bgFrame = device.createBindGroup({
  layout: bglFrame,
  entries: [
    { binding: 0, resource: { buffer: uBuf } },
    { binding: 1, resource: { buffer: pBuf } },
    { binding: 2, resource: { buffer: sBuf } }
  ]
});

const bglEnv = device.createBindGroupLayout({
  entries: [
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array', sampleType: 'float' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
  ]
});
const bgEnv = device.createBindGroup({
  layout: bglEnv,
  entries: [
    { binding: 1, resource: shadowView },
    { binding: 2, resource: shadowSmp },
    { binding: 3, resource: matTex.createView({ dimension: '2d-array' }) },
    { binding: 4, resource: matSmp }
  ]
});

const bglRays = device.createBindGroupLayout({
  entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: MSAA_SAMPLES > 1 } }]
});
const bglPost = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: MSAA_SAMPLES > 1 } }
  ]
});

const plFrameOnly = device.createPipelineLayout({ bindGroupLayouts: [bglFrame] });
const plEnv = device.createPipelineLayout({ bindGroupLayouts: [bglFrame, bglEnv] });
const plRays = device.createPipelineLayout({ bindGroupLayouts: [bglFrame, bglRays] });
const plPost = device.createPipelineLayout({ bindGroupLayouts: [bglFrame, bglPost] });

async function makeModule(label, code) {
  const m = device.createShaderModule({ label, code });
  if (m.getCompilationInfo) {
    const info = await m.getCompilationInfo();
    for (const msg of info.messages) {
      if (msg.type === 'error') {
        fail(`WGSL error in ${label} (line ${msg.lineNum}): ${msg.message}`);
      }
    }
  }
  return m;
}

const [modSky, modTer, modVeg, modAni, modWat, modPar, modRay, modPost] = await Promise.all([
  makeModule('sky', W_SKY),
  makeModule('terrain', W_TERRAIN),
  makeModule('veg', W_VEG),
  makeModule('animal', W_ANIMAL),
  makeModule('water', W_WATER),
  makeModule('particle', W_PARTICLE),
  makeModule('rays', MSAA_SAMPLES > 1 ? W_RAYS_MS : W_RAYS),
  makeModule('post', MSAA_SAMPLES > 1 ? W_POST_MS : W_POST)
]);

const meshVLayout = {
  arrayStride: 44,
  attributes: [
    { shaderLocation: 0, offset: 0,  format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x3' },
    { shaderLocation: 3, offset: 36, format: 'float32x2' }
  ]
};
const vegInstVLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 4, offset: 0,  format: 'float32x4' },
    { shaderLocation: 5, offset: 16, format: 'float32x4' }
  ]
};
const aniInstVLayout = {
  arrayStride: 48, // 12 floats: posScale(4), yawPhaseAnimSp(4), bodyPitchRollIK(4)
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 4, offset: 0,  format: 'float32x4' },
    { shaderLocation: 5, offset: 16, format: 'float32x4' },
    { shaderLocation: 6, offset: 32, format: 'float32x4' }
  ]
};
const terVLayouts = [
  {
    arrayStride: TILE_VERT_STRIDE_BYTES,
    attributes: [
      { shaderLocation: 0, offset: 0,  format: 'float32x3' }, // posOffEcef
      { shaderLocation: 1, offset: 12, format: 'float32'   }, // elev
      { shaderLocation: 2, offset: 16, format: 'float32x3' }, // normEcef
      { shaderLocation: 3, offset: 28, format: 'float32'   }, // wetness
      { shaderLocation: 4, offset: 32, format: 'float32x3' }, // tileCol
      { shaderLocation: 5, offset: 44, format: 'float32'   }  // biomePacked
    ]
  },
  {
    arrayStride: 16,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 6, offset: 0, format: 'float32x4' }   // tileRelENU + tileArcMeters
    ]
  }
];

const pipeSky = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modSky, entryPoint: 'vs' },
  fragment: { module: modSky, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: false, depthCompare: 'always' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeTer = device.createRenderPipeline({
  layout: plEnv,
  vertex: { module: modTer, entryPoint: 'vs', buffers: terVLayouts },
  fragment: { module: modTer, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeTerShadow = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modTer, entryPoint: 'vsShadow', buffers: terVLayouts },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 }
});

const pipeVeg = device.createRenderPipeline({
  layout: plEnv,
  vertex: { module: modVeg, entryPoint: 'vs', buffers: [meshVLayout, vegInstVLayout] },
  fragment: { module: modVeg, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeVegShadow = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modVeg, entryPoint: 'vsShadow', buffers: [meshVLayout, vegInstVLayout] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 }
});

const pipeAni = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modAni, entryPoint: 'vs', buffers: [meshVLayout, aniInstVLayout] },
  fragment: { module: modAni, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeAniShadow = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modAni, entryPoint: 'vsShadow', buffers: [meshVLayout, aniInstVLayout] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' }
});

const alphaBlend = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
};
const addBlend = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
};

const pipeWat = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modWat, entryPoint: 'vs', buffers: terVLayouts },
  fragment: { module: modWat, entryPoint: 'fs', targets: [{ format: HDR_FMT, blend: alphaBlend }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: false, depthCompare: 'less-equal' },
  multisample: { count: MSAA_SAMPLES }
});

const pipePar = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: {
    module: modPar,
    entryPoint: 'vs',
    buffers: [
      { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
      {
        arrayStride: 32,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 1, offset: 0,  format: 'float32x4' },
          { shaderLocation: 2, offset: 16, format: 'float32x4' }
        ]
      }
    ]
  },
  fragment: { module: modPar, entryPoint: 'fs', targets: [{ format: HDR_FMT, blend: addBlend }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: false, depthCompare: 'less-equal' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeRay = device.createRenderPipeline({
  layout: plRays,
  vertex: { module: modRay, entryPoint: 'vs' },
  fragment: { module: modRay, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list' }
});

const pipePost = device.createRenderPipeline({
  layout: plPost,
  vertex: { module: modPost, entryPoint: 'vs' },
  fragment: { module: modPost, entryPoint: 'fs', targets: [{ format: canvasFmt }] },
  primitive: { topology: 'triangle-list' }
});

// ============================================================================
// Dynamic Resolution Render Targets & Timestamp Query Setup
// ============================================================================
let W = 0, H = 0, resScale = clamp(settings.resolutionScale || 0.85, RES_SCALE_MIN, RES_SCALE_MAX);
let hdrTex = null, hdrMsaaTex = null, depthTex = null, rayTex = null;
let hdrView = null, hdrMsaaView = null, depthView = null, rayView = null;
let bgRays = null, bgPost = null;
let rayTexDirty = true;

function rebuildTargets() {
  const dpr = min(window.devicePixelRatio || 1, DPR_CAP) * resScale;
  let nw = max(64, floor(window.innerWidth * dpr));
  let nh = max(64, floor(window.innerHeight * dpr));
  // Cap internal pixel budget so 4K/Retina screens stay silky 60 FPS
  const maxW = floor(1920 * max(1.0, resScale));
  const maxH = floor(1080 * max(1.0, resScale));
  if (nw > maxW || nh > maxH) {
    const k = min(maxW / nw, maxH / nh);
    nw = max(64, floor(nw * k));
    nh = max(64, floor(nh * k));
  }
  if (nw === W && nh === H && hdrTex) return;
  W = nw; H = nh;
  canvas.width = W;
  canvas.height = H;
  ctx.configure({ device, format: canvasFmt, alphaMode: 'opaque' });

  hdrTex?.destroy();
  hdrMsaaTex?.destroy();
  depthTex?.destroy();
  rayTex?.destroy();

  hdrTex = device.createTexture({
    size: [W, H],
    format: HDR_FMT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });
  hdrView = hdrTex.createView();

  if (MSAA_SAMPLES > 1) {
    hdrMsaaTex = device.createTexture({
      size: [W, H],
      sampleCount: MSAA_SAMPLES,
      format: HDR_FMT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    hdrMsaaView = hdrMsaaTex.createView();
  }

  depthTex = device.createTexture({
    size: [W, H],
    sampleCount: MSAA_SAMPLES,
    format: DEPTH_FMT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });
  depthView = depthTex.createView();

  const rw = max(32, floor(W * RAY_SCALE));
  const rh = max(32, floor(H * RAY_SCALE));
  rayTex = device.createTexture({
    size: [rw, rh],
    format: HDR_FMT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });
  rayView = rayTex.createView();
  rayTexDirty = true;

  bgRays = device.createBindGroup({
    layout: bglRays,
    entries: [{ binding: 0, resource: depthView }]
  });
  bgPost = device.createBindGroup({
    layout: bglPost,
    entries: [
      { binding: 0, resource: hdrView },
      { binding: 1, resource: rayView },
      { binding: 2, resource: postSmp },
      { binding: 3, resource: depthView }
    ]
  });
  if (menu) menuNeedsBackdrop = true;
}
rebuildTargets();
window.addEventListener('resize', rebuildTargets);

applySettingsToRenderer = () => {
  const wantScale = clamp(settings.resolutionScale || 1.0, RES_SCALE_MIN, RES_SCALE_MAX);
  if (abs(wantScale - resScale) > 0.01) {
    resScale = wantScale;
    rebuildTargets();
  }
};

let qs = null, qResolveBuf = null, qReadBuf = null, qPending = false, gpuMs = 0;
if (canTimestamp) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolveBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  qReadBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
}

// ============================================================================
// Gentle Local Scenic Orbit Flythrough (Title Screen / [F] Tour)
// ============================================================================
const FLY_DURATION = 48;
function flyAt(sec) {
  const ang = (sec / FLY_DURATION) * TAU;
  const rad = 26 + sin(sec * 0.25) * 6;
  const cx = sin(ang) * rad;
  const cz = cos(ang) * rad;
  terrainAt(cx, cz, _camT);
  const cy = max(_camT.h + 5.5, 6.2) + sin(sec * 0.45) * 1.4;
  terrainAt(0, 0, _camT);
  const ty = max(_camT.h + 1.5, 1.8);
  lookAtPose(cx, cy, cz, 0, ty, 0);
}

// ============================================================================
// Frame Uniforms, PlanetU & Cube-Sphere Quadtree Streaming
// ============================================================================
const mProj = new Float32Array(16);
const mView = new Float32Array(16);
const mVp = new Float32Array(16);
const mInvVp = new Float32Array(16);
const mSunProj = m4Ortho(-180, 180, -180, 180, -220, 260);
const mSunView = new Float32Array(16);
const mSunVp = new Float32Array(16);
const zeroEye = [0, 0, 0], tgtV = [0, 0, -1], upV = [0, 1, 0];
const camEcef = [0, 0, 0];
const enuFrame = {};

let activeWeatherIdx = 0;
let rainLevel = 0;
let windLevel = 0.45;
let evScale = 1.0;
let hudFrames = 0, hudT = 0, hudMax = 0, hudTextTimer = 0;
const Q = device.queue;

function updateUniforms(dt) {
  const t = F[TIME];
  let w0 = 0, w1 = 0, wf = 0;
  if (weatherMode >= 0) {
    w0 = w1 = weatherMode;
    activeWeatherIdx = weatherMode;
  } else {
    const cyc = (t * 0.016) % WEATHER_PRESETS.length;
    w0 = floor(cyc) % WEATHER_PRESETS.length;
    w1 = (w0 + 1) % WEATHER_PRESETS.length;
    wf = smoothstep(0.68, 1.0, cyc - floor(cyc));
    activeWeatherIdx = wf > 0.5 ? w1 : w0;
  }
  const wp0 = WEATHER_PRESETS[w0], wp1 = WEATHER_PRESETS[w1];
  const fogD = lerp(wp0.fogD, wp1.fogD, wf);
  const mist = lerp(wp0.mist, wp1.mist, wf);
  const cloud = lerp(wp0.cloud, wp1.cloud, wf);
  const fireStr = lerp(wp0.fire, wp1.fire, wf);
  windLevel = lerp(wp0.wind, wp1.wind, wf);
  rainLevel = lerp(wp0.rain, wp1.rain, wf);
  const wSunScale = lerp(wp0.sunScale, wp1.sunScale, wf);
  const sTint = [
    lerp(wp0.skyTint[0], wp1.skyTint[0], wf),
    lerp(wp0.skyTint[1], wp1.skyTint[1], wf),
    lerp(wp0.skyTint[2], wp1.skyTint[2], wf)
  ];

  const tod = TOD_PRESETS[todIdx];
  const sunElev = tod.sunElev + sin(t * 0.015) * 0.03;
  const sunAz = tod.sunAz + cos(t * 0.012) * 0.05;
  const sx = cos(sunElev) * sin(sunAz);
  const sy = sin(sunElev);
  const sz = cos(sunElev) * cos(sunAz);
  const sunInt = tod.sunInt * wSunScale;

  const cp = cos(F[PIT]), sp = sin(F[PIT]), cy = cos(F[YAW]), syw = sin(F[YAW]);
  const fx = syw * cp, fy = sp, fz = -cy * cp;
  const rx = cy, ry = 0, rz = syw;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

  // Camera-relative ENU projection with altitude-adaptive near/far planes for 32-bit depth precision
  const fov = 2 * Math.atan(18 / max(10, focalMm));
  const asp = W / max(1, H);
  const agl = max(0.5, camState.altMeters - (camState.groundH || 0));
  const nearPlane = clamp(max(0.22, agl * 0.0028), 0.22, 35000.0);
  const farPlane = clamp(max(450000.0, camState.altMeters * 8.5 + 3.2e7), 450000.0, 2.2e8);
  tgtV[0] = fx; tgtV[1] = fy; tgtV[2] = fz;
  m4Persp(fov, asp, nearPlane, farPlane, mProj);
  m4Look(zeroEye, tgtV, upV, mView);
  m4Mul(mProj, mView, mVp);
  m4Inv(mVp, mInvVp);

  // Camera-relative ENU directional shadow frustum
  m4Look([sx * 95, sy * 95, sz * 95], zeroEye, upV, mSunView);
  m4Mul(mSunProj, mSunView, mSunVp);

  const dofStrength = photoMode ? clamp((4.5 - apertureF) / 3.1, 0.08, 1.0) : 0.0;
  evScale = pow(2, evComp) * (todIdx === 2 ? 1.35 : 1.0);
  const shutterSec = clamp((apertureF * apertureF) / (max(0.15, sunInt) * 1800 * pow(2, evComp)), 1 / 4000, 1 / 15);
  if (shutterValEl) shutterValEl.textContent = `1/${round(1 / shutterSec)}s`;

  if (instinctPulse > 0) {
    instinctPulse += dt * 0.45;
    if (instinctPulse >= 0.99) instinctPulse = 0;
  }

  // FrameU (96 floats)
  UB.set(mVp, 0);
  UB.set(mInvVp, 16);
  UB.set(mSunVp, 32);
  UB[48] = F[CX]; UB[49] = F[CY]; UB[50] = F[CZ]; UB[51] = t;
  UB[52] = fx; UB[53] = fy; UB[54] = fz; UB[55] = tan(fov * 0.5);
  UB[56] = rx; UB[57] = ry; UB[58] = rz; UB[59] = asp;
  UB[60] = ux; UB[61] = uy; UB[62] = uz; UB[63] = 0.0;
  UB[64] = sx; UB[65] = sy; UB[66] = sz; UB[67] = sunInt;
  UB[68] = tod.sunCol[0] * sTint[0]; UB[69] = tod.sunCol[1] * sTint[1]; UB[70] = tod.sunCol[2] * sTint[2]; UB[71] = fogD;
  UB[72] = tod.zen[0] * sTint[0]; UB[73] = tod.zen[1] * sTint[1]; UB[74] = tod.zen[2] * sTint[2]; UB[75] = cloud;
  UB[76] = tod.hor[0] * sTint[0]; UB[77] = tod.hor[1] * sTint[1]; UB[78] = tod.hor[2] * sTint[2]; UB[79] = mist;
  UB[80] = tod.fog[0] * sTint[0]; UB[81] = tod.fog[1] * sTint[1]; UB[82] = tod.fog[2] * sTint[2]; UB[83] = fireStr;
  // Local heat origin (only active in volcanic/wildfire biomes) + focusDistM in w
  const heatActive = (activeRegionBiomeId === 14 || activeRegionBiomeId === 15) ? 1.0 : 0.0;
  UB[84] = 0.0; UB[85] = heatActive > 0.5 ? 4.5 : -999.0; UB[86] = 0.0; UB[87] = focusDistM;
  UB[88] = 0.82; UB[89] = 0.57; UB[90] = windLevel; UB[91] = evScale;
  UB[92] = activeWeatherIdx;
  UB[93] = rainLevel;
  UB[94] = dofStrength;
  UB[95] = (lookdevMode ? 10.0 : 0.0) + clamp(instinctPulse, 0, 0.98);
  Q.writeBuffer(uBuf, 0, UB);

  // PlanetU (16 floats): Camera ECEF ENU basis, true altitude, WGS-84 radius, re-entry heat, density
  geodeticToEcef(camState.latRad, camState.lonRad, camState.altMeters, camEcef);
  localENUFrame(camState.latRad, camState.lonRad, enuFrame);
  const planetR = oblateRadiusAtSinLat(sin(camState.latRad));
  const atmoRho = solarState.mode === 'interplanetary' ? 0.0 : atmosphericDensityAt(camState.altMeters);

  PB[0]  = enuFrame.east[0];  PB[1]  = enuFrame.east[1];  PB[2]  = enuFrame.east[2];  PB[3]  = camState.altMeters;
  PB[4]  = enuFrame.up[0];    PB[5]  = enuFrame.up[1];    PB[6]  = enuFrame.up[2];    PB[7]  = planetR;
  PB[8]  = enuFrame.south[0]; PB[9]  = enuFrame.south[1]; PB[10] = enuFrame.south[2]; PB[11] = camState.reentryHeat || 0.0;
  PB[12] = camState.latRad;   PB[13] = camState.lonRad;   PB[14] = atmoRho;           PB[15] = activeRegionBiomeId;
  Q.writeBuffer(pBuf, 0, PB);

  // SolarU (112 floats): Real physical-scale heliocentric Solar System projected to ENU
  if (solarState.mode !== 'interplanetary') {
    updateSolarEphemeris(solarState, dt);
    syncSolarFromEarthCam(solarState, camState.latRad, camState.lonRad, camState.altMeters);
    solarInterplanetaryBlend = 0.0;
  } else {
    const earthCenter = solarState.positions.get('earth');
    const distEarthSurf = max(0, hypot(
      solarState.posM[0] - earthCenter[0],
      solarState.posM[1] - earthCenter[1],
      solarState.posM[2] - earthCenter[2]
    ) - PLANET_RADIUS);
    solarInterplanetaryBlend = smoothstep(8.0e6, 2.2e7, distEarthSurf);
  }
  const projBodies = projectSolarBodiesToENU(solarState, enuFrame);
  const sunDirENU = projBodies[0]?.dirENU || [sx, sy, sz];
  for (let i = 0; i < 9; i++) {
    const pb = projBodies[i];
    if (!pb) continue;
    const b = pb.body;
    const o4 = i * 4;
    SB[o4]     = pb.dirENU[0];
    SB[o4 + 1] = pb.dirENU[1];
    SB[o4 + 2] = pb.dirENU[2];
    SB[o4 + 3] = pb.angRad;

    const visMag = b.id === 'sun' ? -26.7 : clamp(5.0 * Math.log10(max(1e6, pb.distM) / max(1e5, b.radiusM)) - 12.0, -4.5, 6.0);
    const ringScale = b.ringOuterM ? (b.ringOuterM / b.radiusM) : 0.0;
    SB[36 + o4]     = i;
    SB[36 + o4 + 1] = visMag;
    SB[36 + o4 + 2] = ringScale;
    SB[36 + o4 + 3] = (b.axialTiltDeg || 0) * DEG2RAD;

    const atmoW = b.atmoHeightM > 0 ? clamp(b.atmoHeightM / max(1e5, b.radiusM * 0.08), 0.15, 1.0) : 0.0;
    SB[72 + o4]     = b.color[0];
    SB[72 + o4 + 1] = b.color[1];
    SB[72 + o4 + 2] = b.color[2];
    SB[72 + o4 + 3] = atmoW;
  }
  SB[108] = sunDirENU[0];
  SB[109] = sunDirENU[1];
  SB[110] = sunDirENU[2];
  SB[111] = solarInterplanetaryBlend;
  Q.writeBuffer(sBuf, 0, SB);

  // Genuine 6-Face Cube-Sphere Quadtree Tile Selection & Bounded GPU Pool Upload
  const sseThreshold = 19.5 / clamp(settings.viewDistance || 1.0, 0.5, 2.0);
  const camMovedEcef = hypot(
    camEcef[0] - lastTileCamEcef[0],
    camEcef[1] - lastTileCamEcef[1],
    camEcef[2] - lastTileCamEcef[2]
  );
  if (forceSyncTiles || activeTiles.length === 0 || camMovedEcef > 0.35) {
    activeTiles = planetQuadtree.selectTiles(camEcef, camState.altMeters, fov, max(360, H), sseThreshold, forceSyncTiles);
    forceSyncTiles = false;
    lastTileCamEcef[0] = camEcef[0];
    lastTileCamEcef[1] = camEcef[1];
    lastTileCamEcef[2] = camEcef[2];
  }

  const E = enuFrame.east, Uv = enuFrame.up, S = enuFrame.south;
  for (let i = 0; i < activeTiles.length; i++) {
    const tile = activeTiles[i];
    if (tile.needsUpload) {
      Q.writeBuffer(terTilePoolBuf, tile.gpuSlot * TILE_BYTES, tile.verts);
      tile.needsUpload = false;
    }
    // Float64 subtraction (tile.ecefCenter - camEcef) -> exact zero-jitter ENU offset!
    const dx = tile.ecefCenter[0] - camEcef[0];
    const dy = tile.ecefCenter[1] - camEcef[1];
    const dz = tile.ecefCenter[2] - camEcef[2];
    terTileInstData[i * 4]     = dx * E[0]  + dy * E[1]  + dz * E[2];
    terTileInstData[i * 4 + 1] = dx * Uv[0] + dy * Uv[1] + dz * Uv[2];
    terTileInstData[i * 4 + 2] = dx * S[0]  + dy * S[1]  + dz * S[2];
    terTileInstData[i * 4 + 3] = tile.tileArcMeters;
  }
  if (activeTiles.length > 0) {
    Q.writeBuffer(terTileInstBuf, 0, terTileInstData.subarray(0, activeTiles.length * 4));
  }

  syncVegGpuBuffers();

  if (lookdevMode) {
    world.updateLookdevRig(F[CX], F[CY], F[CZ], F[YAW], F[PIT]);
    Q.writeBuffer(lookdevGpu.instBuf, 0, world.lookdevRig.instData);
  }
  updateAudio(F[CX], camState.altMeters, F[CZ], activeWeatherIdx, fireStr, windLevel, activeRegionBiomeId, camState.reentryHeat || 0);
}

const lastTileCamEcef = [NaN, NaN, NaN];

function render(dt) {
  updateUniforms(dt);

  const nearSurface = camState.altMeters < 1800;
  const doShadows = camState.altMeters < 420;
  if (nearSurface) {
    const vegScale = clamp(settings.foliageDensity || 1.0, 0.25, 1.25);
    for (let i = 0; i < vegGpu.length; i++) {
      const baseCount = world.vegBuffers[i].instCount;
      vegGpu[i].instCount = i === 7 ? baseCount : baseCount > 0 ? max(1, round(baseCount * min(1.0, vegScale))) : 0;
    }

    const faunaScale = clamp(settings.animalDetail || 1.0, 0.25, 1.25);
    for (let i = 0; i < animalGpu.length; i++) {
      const baseCount = world.wildlifeGroups[i].instCount;
      const cnt = baseCount > 0 ? max(1, round(baseCount * min(1.0, faunaScale))) : 0;
      animalGpu[i].instCount = cnt;
      if (cnt > 0) {
        Q.writeBuffer(animalGpu[i].instBuf, 0, world.wildlifeGroups[i].instData.subarray(0, cnt * 12));
      }
    }

    const pRanges = world.particleRanges;
    const includeBubbles = camState.altMeters < 1.5 || activeRegionBiomeId === 9 || activeRegionBiomeId === 10 || activeRegionBiomeId === 11;
    const includeRain = rainLevel >= 0.02 && camState.altMeters >= 0;
    const activeParticleFloats = includeRain
      ? world.MAX_PARTICLES * 8
      : includeBubbles
        ? pRanges.rainStart * 8
        : pRanges.baseCount * 8;
    Q.writeBuffer(partInstBuf, 0, world.particles.subarray(0, activeParticleFloats));
  }

  const enc = device.createCommandEncoder();

  // 1. Directional Sun Shadow Pass (only when low enough for local directional shadows to be visible)
  if (doShadows) {
    const sp = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: shadowView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
    sp.setPipeline(pipeTerShadow);
    sp.setBindGroup(0, bgFrame);
    sp.setVertexBuffer(0, terTilePoolBuf);
    sp.setVertexBuffer(1, terTileInstBuf);
    sp.setIndexBuffer(terTileIBuf, 'uint32');
    for (let i = 0; i < activeTiles.length; i++) {
      const tile = activeTiles[i];
      if (tile.lod >= 11) {
        sp.drawIndexed(terTileIdxCount, 1, 0, tile.gpuSlot * TILE_TOTAL_VERTS, i);
      }
    }

    sp.setPipeline(pipeVegShadow);
    sp.setBindGroup(0, bgFrame);
    for (const idx of [0, 1, 2, 3, 7, 9, 10, 11, 12, 14, 15, 16, 17]) {
      const vg = vegGpu[idx];
      if (vg && vg.instCount > 0) {
        sp.setVertexBuffer(0, vg.vBuf);
        sp.setVertexBuffer(1, vg.instBuf);
        sp.setIndexBuffer(vg.iBuf, 'uint32');
        sp.drawIndexed(vg.count, vg.instCount);
      }
    }

    sp.setPipeline(pipeAniShadow);
    for (let i = 0; i < animalGpu.length; i++) {
      const ag = animalGpu[i];
      if (ag.instCount > 0) {
        sp.setVertexBuffer(0, ag.vBuf);
        sp.setVertexBuffer(1, ag.instBuf);
        sp.setIndexBuffer(ag.iBuf, 'uint32');
        sp.drawIndexed(ag.count, ag.instCount);
      }
    }
    sp.end();
  }

  // 2. Main Forward HDR Scene Pass (Unified Cube-Sphere Planet from -10 km Abyss to Deep Space)
  const mainAttach = MSAA_SAMPLES > 1
    ? { view: hdrMsaaView, resolveTarget: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }
    : { view: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' };

  const passDesc = {
    colorAttachments: [mainAttach],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    }
  };
  if (canTimestamp && !qPending) {
    passDesc.timestampWrites = { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  const mp = enc.beginRenderPass(passDesc);
  mp.setPipeline(pipeSky);
  mp.setBindGroup(0, bgFrame);
  mp.draw(3);

  // Unified Cube-Sphere Quadtree Planet Terrain (handed off smoothly to SolarU Earth sphere > 22,000 km)
  const renderCubeSphereEarth = solarInterplanetaryBlend < 0.96;
  if (renderCubeSphereEarth) {
    mp.setPipeline(pipeTer);
    mp.setBindGroup(0, bgFrame);
    mp.setBindGroup(1, bgEnv);
    mp.setVertexBuffer(0, terTilePoolBuf);
    mp.setVertexBuffer(1, terTileInstBuf);
    mp.setIndexBuffer(terTileIBuf, 'uint32');
    for (let i = 0; i < activeTiles.length; i++) {
      mp.drawIndexed(terTileIdxCount, 1, 0, activeTiles[i].gpuSlot * TILE_TOTAL_VERTS, i);
    }
  }

  if (nearSurface) {
    mp.setPipeline(pipeVeg);
    mp.setBindGroup(0, bgFrame);
    mp.setBindGroup(1, bgEnv);
    for (let i = 0; i < vegGpu.length; i++) {
      const vg = vegGpu[i];
      if (vg.instCount > 0) {
        mp.setVertexBuffer(0, vg.vBuf);
        mp.setVertexBuffer(1, vg.instBuf);
        mp.setIndexBuffer(vg.iBuf, 'uint32');
        mp.drawIndexed(vg.count, vg.instCount);
      }
    }

    mp.setPipeline(pipeAni);
    mp.setBindGroup(0, bgFrame);
    for (let i = 0; i < animalGpu.length; i++) {
      const ag = animalGpu[i];
      if (ag.instCount > 0) {
        mp.setVertexBuffer(0, ag.vBuf);
        mp.setVertexBuffer(1, ag.instBuf);
        mp.setIndexBuffer(ag.iBuf, 'uint32');
        mp.drawIndexed(ag.count, ag.instCount);
      }
    }

    if (lookdevMode) {
      mp.setVertexBuffer(0, lookdevGpu.sphereVBuf);
      mp.setVertexBuffer(1, lookdevGpu.instBuf, 0, 96);
      mp.setIndexBuffer(lookdevGpu.sphereIBuf, 'uint32');
      mp.drawIndexed(lookdevGpu.sphereCount, 2);

      mp.setVertexBuffer(0, lookdevGpu.swatchVBuf);
      mp.setVertexBuffer(1, lookdevGpu.instBuf, 96, 48);
      mp.setIndexBuffer(lookdevGpu.swatchIBuf, 'uint32');
      mp.drawIndexed(lookdevGpu.swatchCount, 1);
    }
  }

  // Unified Spherical Planetary Ocean (Same Cube-Sphere Tiles, Surface Triangles Only, All Altitudes!)
  if (renderCubeSphereEarth) {
    mp.setPipeline(pipeWat);
    mp.setBindGroup(0, bgFrame);
    mp.setVertexBuffer(0, terTilePoolBuf);
    mp.setVertexBuffer(1, terTileInstBuf);
    mp.setIndexBuffer(terTileIBuf, 'uint32');
    for (let i = 0; i < activeTiles.length; i++) {
      if (activeTiles[i].hasOcean) {
        mp.drawIndexed(terTileSurfIdxCount, 1, 0, activeTiles[i].gpuSlot * TILE_TOTAL_VERTS, i);
      }
    }
  }

  if (nearSurface) {
    const pRanges = world.particleRanges;
    const includeBubbles = camState.altMeters < 1.5 || activeRegionBiomeId === 9 || activeRegionBiomeId === 10 || activeRegionBiomeId === 11;
    const includeRain = rainLevel >= 0.02 && camState.altMeters >= 0;
    mp.setPipeline(pipePar);
    mp.setBindGroup(0, bgFrame);
    mp.setVertexBuffer(0, partQBuf);
    mp.setVertexBuffer(1, partInstBuf);
    mp.draw(6, pRanges.baseCount, 0, 0);
    if (includeBubbles) mp.draw(6, pRanges.bubbleCount, 0, pRanges.bubbleStart);
    if (includeRain) mp.draw(6, pRanges.rainCount, 0, pRanges.rainStart);
  }
  mp.end();

  // 3. Crepuscular God-Ray / Underwater Volumetric Shaft Pass (skipped when sun is behind camera or in space)
  const sunFacing = UB[52] * UB[64] + UB[53] * UB[65] + UB[54] * UB[66];
  const doRays = settings.volumetrics !== false && camState.altMeters <= 18000 && sunFacing > 0.03;
  if (doRays) {
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: rayView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
    });
    rp.setPipeline(pipeRay);
    rp.setBindGroup(0, bgFrame);
    rp.setBindGroup(1, bgRays);
    rp.draw(3);
    rp.end();
    rayTexDirty = true;
  } else if (rayTexDirty) {
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: rayView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
    });
    rp.end();
    rayTexDirty = false;
  }

  // 4. Final Composite & Tone-Mapping Pass
  const pp = enc.beginRenderPass({
    colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
  });
  pp.setPipeline(pipePost);
  pp.setBindGroup(0, bgFrame);
  pp.setBindGroup(1, bgPost);
  pp.draw(3);
  pp.end();

  if (canTimestamp && !qPending) {
    enc.resolveQuerySet(qs, 0, 2, qResolveBuf, 0);
    enc.copyBufferToBuffer(qResolveBuf, 0, qReadBuf, 0, 16);
    qPending = true;
  }

  Q.submit([enc.finish()]);

  if (canTimestamp && qPending && qReadBuf.mapState === 'unmapped') {
    qReadBuf.mapAsync(GPUMapMode.READ).then(() => {
      const times = new BigInt64Array(qReadBuf.getMappedRange());
      const ns = Number(times[1] - times[0]);
      if (ns > 0 && ns < 1e9) gpuMs = ns / 1e6;
      qReadBuf.unmap();
      qPending = false;
    }).catch(() => { qPending = false; });
  }
}

// ============================================================================
// Main Frame Loop (120 Hz Fixed-Step, Continuous Atmospheric Re-Entry & IK)
// ============================================================================
let dynT = 0, dynN = 0, dynG = 0, dynGN = 0;
let simAcc = 0;
const FIXED_DT = world.SIM_DT;
const reentryInput = { thrustE: 0, thrustN: 0, thrustU: 0, gravityScale: 0, allowUnderwater: true, clearance: 0.72 };

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    F[LAST] = now;
    return;
  }
  const dtr = now - F[LAST];
  F[LAST] = now;

  // ZERO-LAG HOMESCREEN: Pause 3D WebGPU engine & 120 Hz wildlife physics while welcome overlay is active
  if (menu && typeof window.__flyOverride === 'undefined') {
    if (menuNeedsBackdrop) {
      menuNeedsBackdrop = false;
      render(0.016);
    }
    return;
  }

  const dt = clamp(dtr / 1000, 0.001, 0.05);
  const timeScale = clamp(settings.timeSpeedMult ?? 1.0, 0.0, 10.0);
  F[TIME] += dt * max(0.05, timeScale);

  if (!photoMode && dtr < 500 && dynT >= 0 && settings.autoQuality) {
    dynT += dtr; dynN++;
    if (gpuMs > 0) { dynG += gpuMs; dynGN++; }
    if (dynT > 850) {
      const avgG = dynGN ? dynG / dynGN : 0;
      const avgF = dynT / dynN;
      let newScale = resScale;
      if (avgG > TARGET_GPU_MS || (!avgG && avgF > 18.5)) newScale = max(RES_SCALE_MIN, resScale * 0.86);
      else if (avgG > 0 && avgG < TARGET_GPU_MS * 0.65 && avgF < 16.0 && resScale < RES_SCALE_MAX) newScale = min(RES_SCALE_MAX, resScale * 1.06);
      if (abs(newScale - resScale) > 0.03) {
        resScale = newScale;
        rebuildTargets();
      }
      dynT = dynN = dynG = dynGN = 0;
    }
  }

  if (!menu && flyActive && typeof window.__flyOverride === 'undefined') {
    F[FLT] += dt;
    flyAt(F[FLT]);
    if (F[FLT] >= FLY_DURATION) flyActive = false;
  } else if (!menu && embodiedState.active && embodiedState.groupIdx >= 0 && typeof window.__flyOverride === 'undefined') {
    // ========================================================================
    // Playable Animal Embodiment Controller (Canonical +Z Forward & Orbit POV)
    // ========================================================================
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp.items[embodiedState.itemIdx];

    const mSens = 0.0022 * (settings.mouseSensitivity || 1.0);
    const ySign = settings.invertY ? -1 : 1;
    const hadMouseInput = abs(mdx) > 0.01 || abs(mdy) > 0.01;
    const kq = 1 - exp(-dt * 28);
    lkx += mdx * mSens;
    lky += mdy * mSens * ySign;
    mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq;
    lkx -= ax; lky -= ay;

    embodiedState.orbitYaw = normAngle(embodiedState.orbitYaw + ax);
    embodiedState.orbitPitch = clamp(embodiedState.orbitPitch + ay, -0.75, 1.25);

    it.prevX = it.x; it.prevY = it.y; it.prevZ = it.z; it.prevYaw = it.yaw;

    const turnInput = kl - kr;
    const turnRate = (grp.turnSpeed || 2.1) * (settings.turnSensitivity || 1.0);
    it.yaw = normAngle(it.yaw + turnInput * turnRate * dt);

    const moveFwd = kf - kb;
    const moveUp = ku - kd;
    const speedFactor = kShift ? 1.95 : kCtrl ? 0.42 : 1.0;
    const spd = grp.baseSpeed * clamp(speedMult, 0.2, 4.0) * speedFactor;

    if (abs(moveFwd) > 0.01 && abs(embodiedState.orbitYaw) > 0.005) {
      const alignRate = hadMouseInput ? 2.4 : (settings.autoRecenter ? 4.2 : 1.6);
      const steerDelta = embodiedState.orbitYaw * min(1, dt * alignRate);
      it.yaw = normAngle(it.yaw + steerDelta);
      if (settings.autoRecenter && !hadMouseInput) {
        embodiedState.orbitYaw = normAngle(embodiedState.orbitYaw - steerDelta);
      }
    }

    const [fwdX, fwdZ] = yawToForward(it.yaw);
    const wantVx = fwdX * moveFwd * spd;
    const wantVz = fwdZ * moveFwd * spd;
    const kVel = 1 - exp(-dt * 7.5);
    F[VX] = lerp(F[VX], wantVx, kVel);
    F[VZ] = lerp(F[VZ], wantVz, kVel);

    let nextX = it.x + F[VX] * dt;
    let nextZ = it.z + F[VZ] * dt;
    terrainAt(nextX, nextZ, _camT);

    if (grp.domain === 'water') {
      const pitchClimb = -sin(embodiedState.orbitPitch) * moveFwd;
      const wantVy = (pitchClimb + moveUp * 0.75) * spd * 0.65;
      embodiedState.vy = lerp(embodiedState.vy, wantVy, kVel);
      let nextY = it.y + embodiedState.vy * dt;
      if (it.y > 0.1) {
        embodiedState.vy -= 14.5 * dt;
        nextY = it.y + embodiedState.vy * dt;
      }
      // Sharks remain strictly underwater; whales/orcas may breach above surface
      const maxSurfaceY = grp.name === 'sharks' ? -1.25 : (grp.name === 'whales' || grp.name === 'orcas') ? 7.5 : -0.45;
      nextY = clamp(nextY, _camT.h + 0.55, maxSurfaceY);
      it.x = nextX; it.y = nextY; it.z = nextZ;
      it.pitch = clamp(atan2(embodiedState.vy, max(1.5, hypot(F[VX], F[VZ]))), -0.65, 0.75);
    } else if (grp.domain === 'air') {
      const pitchClimb = -sin(embodiedState.orbitPitch) * moveFwd;
      const wantVy = (pitchClimb + moveUp * 0.85) * spd * 0.72;
      embodiedState.vy = lerp(embodiedState.vy, wantVy, kVel);
      const nextY = clamp(it.y + embodiedState.vy * dt, _camT.h + 0.6, 260);
      it.x = nextX; it.y = nextY; it.z = nextZ;
      it.pitch = clamp(atan2(embodiedState.vy, max(2.0, hypot(F[VX], F[VZ]))), -0.55, 0.55);
    } else {
      embodiedState.vy -= 18.5 * dt;
      let nextY = it.y + embodiedState.vy * dt;
      if (nextY <= _camT.h) {
        nextY = _camT.h;
        embodiedState.vy = 0;
      }
      world.resolveWorldCollision(nextX, nextY + 0.35, nextZ, clamp(0.45 * it.scale, 0.2, 0.95), F[VX], F[VZ], _camCol, 0.0);
      it.x = _camCol.x;
      it.z = _camCol.z;
      terrainAt(it.x, it.z, _camT);
      it.y = max(_camT.h, nextY);
    }

    const stepDist = hypot(it.x - it.prevX, it.z - it.prevZ);
    if (stepDist > 1e-4) {
      it.phase = (it.phase + (stepDist / max(0.18, it.strideLen)) * 1.45) % TAU;
      it.state = kShift ? 'chase' : 'forage';
      if (it.roarTimer <= 0) it.emotion = kShift ? 3 : 2;
    } else {
      it.state = 'forage';
      if (it.roarTimer <= 0) it.emotion = 0;
    }

    const sc = it.scale || 1.0;
    const eyeH = grp.eyeOffset[1] * sc;
    const eyeFwd = grp.eyeOffset[2] * sc;
    if (embodiedState.pov === '1st') {
      const bob = sin(it.phase * 2.0) * 0.04 * min(1, stepDist * 25);
      F[CX] = it.x + fwdX * (eyeFwd + 0.24 * sc);
      F[CY] = it.y + eyeH + bob;
      F[CZ] = it.z + fwdZ * (eyeFwd + 0.24 * sc);
      const lookYaw = normAngle(it.yaw + embodiedState.orbitYaw);
      const [lfx, lfz] = yawToForward(lookYaw);
      F[YAW] = atan2(lfx, -lfz);
      F[PIT] = clamp(-embodiedState.orbitPitch, -1.35, 1.35);
    } else {
      const camAnimalYaw = normAngle(it.yaw + embodiedState.orbitYaw);
      const [camFwdX, camFwdZ] = yawToForward(camAnimalYaw);
      const dist = grp.followDist * max(0.85, sc * 0.9) * (settings.followDistance || 1.0);
      const hMult = settings.followHeight || 1.0;
      const cp = cos(embodiedState.orbitPitch), sp = sin(embodiedState.orbitPitch);

      const camTargetX = it.x - camFwdX * dist * cp;
      const camTargetZ = it.z - camFwdZ * dist * cp;
      terrainAt(camTargetX, camTargetZ, _camT);
      const camTargetY = max(_camT.h + 0.45, it.y + (eyeH + 0.65) * hMult + sp * dist * 0.65);

      const smoothRate = lerp(24, 6, clamp(settings.cameraSmoothing || 0.85, 0.1, 0.98));
      const kCam = 1 - exp(-dt * smoothRate);
      F[CX] = lerp(F[CX], camTargetX, kCam);
      F[CY] = lerp(F[CY], camTargetY, kCam);
      F[CZ] = lerp(F[CZ], camTargetZ, kCam);

      const lookTargetX = it.x + fwdX * (eyeFwd * 0.65);
      const lookTargetY = it.y + eyeH * 0.95;
      const lookTargetZ = it.z + fwdZ * (eyeFwd * 0.65);
      const dx = lookTargetX - F[CX];
      const dy = lookTargetY - F[CY];
      const dz = lookTargetZ - F[CZ];
      const d = hypot(dx, dy, dz) || 1;
      F[YAW] = atan2(dx, -dz);
      F[PIT] = Math.asin(clamp(dy / d, -0.98, 0.98));
    }
    syncCamStateFromLocal();
  } else if (!menu && typeof window.__flyOverride === 'undefined') {
    const idleSec = (now - lastActivityAt) / 1000;
    if (!autoExplore && !photoMode && !lookdevMode && !camState.autopilot && camState.altMeters < 450 && idleSec >= IDLE_EXPLORE_SEC) {
      autoExplore = true;
      pickNextExploreTarget();
    }

    if (autoExplore) {
      autoLegTimer -= dt;
      const dxT = autoTargetX - F[CX], dzT = autoTargetZ - F[CZ];
      const distT = hypot(dxT, dzT);
      if (distT < 8.5 || autoLegTimer <= 0) pickNextExploreTarget();

      const wantYaw = atan2(dxT, -dzT) + sin(F[TIME] * 0.24) * 0.25;
      F[YAW] = lerpAngle(F[YAW], wantYaw, 1 - exp(-dt * 1.15));

      terrainAt(F[CX], F[CZ], _camT);
      const cruiseAlt = max(_camT.h + 2.6, autoTargetY + sin(F[TIME] * 0.31) * 1.6);
      const wantPit = clamp(atan2(cruiseAlt - F[CY], max(12, distT)) * 0.55 - 0.06, -0.45, 0.38);
      F[PIT] = lerp(F[PIT], wantPit, 1 - exp(-dt * 1.2));

      const dirX = sin(F[YAW]), dirZ = -cos(F[YAW]);
      const cruiseSpd = 4.6;
      const kVel = 1 - exp(-dt * 2.4);
      F[VX] = lerp(F[VX], dirX * cruiseSpd, kVel);
      F[VY] = lerp(F[VY], clamp((cruiseAlt - F[CY]) * 0.85, -3.5, 3.5), kVel);
      F[VZ] = lerp(F[VZ], dirZ * cruiseSpd, kVel);

      world.resolveWorldCollision(F[CX] + F[VX] * dt, F[CY] + F[VY] * dt, F[CZ] + F[VZ] * dt, 0.72, F[VX], F[VZ], _camCol, 0.75);
      F[CX] = _camCol.x; F[CY] = _camCol.y; F[CZ] = _camCol.z;
      F[VX] = _camCol.vx; F[VZ] = _camCol.vz;
      syncCamStateFromLocal();
    } else {
      // ======================================================================
      // Continuous Earth-Scale Geodetic Flight & Atmospheric Re-Entry Engine
      // Seamless travel from -10 km ocean trenches -> troposphere -> clouds
      // -> stratosphere -> mesosphere -> 100 km Kármán -> LEO -> Deep Universe
      // and back down to ANY coordinate on Earth with zero teleportation!
      // ======================================================================
      const mSens = 0.0022 * (settings.mouseSensitivity || 1.0);
      const ySign = settings.invertY ? -1 : 1;
      const kq = 1 - exp(-dt * 28);
      lkx += mdx * mSens;
      lky += mdy * mSens * ySign;
      mdx = 0; mdy = 0;
      const ax = lkx * kq, ay = lky * kq;
      lkx -= ax; lky -= ay;
      l2x += ax; l2y += ay;
      const dyw = l2x * kq, dpt = l2y * kq;
      l2x -= dyw; l2y -= dpt;
      camState.yaw = normAngle(camState.yaw + dyw + (kr - kl) * 0.35 * (settings.turnSensitivity || 1.0) * dt);
      camState.pitch = clamp(camState.pitch - dpt, -1.52, 1.52);

      // Continuous Heliocentric Interplanetary Space Flight (unified SI meters)
      if (solarState.mode === 'interplanetary') {
        const cp = cos(camState.pitch), sp = sin(camState.pitch);
        const sy = sin(camState.yaw), cy = cos(camState.yaw);
        localENUFrame(camState.latRad, camState.lonRad, enuFrame);
        const E = enuFrame.east, Uv = enuFrame.up, S = enuFrame.south;
        // Camera forward in ENU is (sy*cp, sp, -cy*cp) -> convert to world ECEF/Helio
        const fwdE = sy * cp, fwdU = sp, fwdS = -cy * cp;
        const rgtE = cy, rgtU = 0, rgtS = sy;
        const camFwdW = [
          E[0] * fwdE + Uv[0] * fwdU + S[0] * fwdS,
          E[1] * fwdE + Uv[1] * fwdU + S[1] * fwdS,
          E[2] * fwdE + Uv[2] * fwdU + S[2] * fwdS
        ];
        const camRgtW = [
          E[0] * rgtE + Uv[0] * rgtU + S[0] * rgtS,
          E[1] * rgtE + Uv[1] * rgtU + S[1] * rgtS,
          E[2] * rgtE + Uv[2] * rgtU + S[2] * rgtS
        ];
        stepInterplanetaryFlight(solarState, camFwdW, camRgtW, {
          fwd: kf - kb,
          right: kr - kl,
          up: ku - kd,
          speedMult: max(speedMult, solarState.propulsionScale || 1.0),
          boost: Boolean(kShift),
          slow: Boolean(kCtrl)
        }, dt);

        // Update Earth-relative geodetic preview continuously; seamlessly hand back to Earth re-entry below 400 km!
        const earthGeo = solarToEarthGeodetic(solarState, {});
        camState.latDeg = earthGeo.latDeg;
        camState.lonDeg = earthGeo.lonDeg;
        camState.latRad = earthGeo.latRad;
        camState.lonRad = earthGeo.lonRad;
        camState.altMeters = max(1000.0, earthGeo.altMeters);
        camState.layer = atmosphericLayerAt(camState.altMeters);
        camState.stage = reentryStageAt(camState.altMeters, solarState.speedMps, 0);
        F[YAW] = camState.yaw;
        F[PIT] = camState.pitch;
        F[CY] = camState.altMeters;

        if (earthGeo.altMeters < EARTH_ORBIT_HANDOFF_ALT - 20000.0) {
          solarState.mode = 'earth_geodetic';
          solarState.autopilotCourse = false;
          solarInterplanetaryBlend = 0.0;
          camState.velE = 0; camState.velN = 0; camState.velU = -180;
          rebaseRegionalOrigin(camState.latDeg, camState.lonDeg, -1);
          forceSyncTiles = true;
          if ($('solarGuideBtn')) {
            $('solarGuideBtn').textContent = 'Engage Course Guidance';
            $('solarGuideBtn').classList.remove('active');
          }
        }
      } else {
        // Continuous Autopilot Ascent / Re-Entry (press [G] or click Orbit button)
        if (camState.autopilot === 'ascent') {
          const targetAlt = 450000; // 450 km LEO
          const remain = targetAlt - camState.altMeters;
          if (remain <= 800) {
            camState.autopilot = null;
            camState.velU *= 0.25;
          } else {
            // Smooth multi-stage atmospheric ascent pacing so cloud decks, stratosphere & curvature unfold gradually
            const alt = max(0, camState.altMeters);
            const wantClimb = alt < 12000
              ? lerp(65, 320, smoothstep(0, 12000, alt))
              : alt < 50000
                ? lerp(320, 1800, smoothstep(12000, 50000, alt))
                : alt < 110000
                  ? lerp(1800, 6800, smoothstep(50000, 110000, alt))
                  : lerp(6800, 38000, smoothstep(110000, 420000, alt));
            reentryInput.thrustE = 0;
            reentryInput.thrustN = 0;
            reentryInput.thrustU = (wantClimb - camState.velU) * 3.2;
            reentryInput.gravityScale = 0.0;
            reentryInput.allowUnderwater = true;
            camState.pitch = lerp(camState.pitch, -0.52, dt * 0.45);
          }
        } else if (camState.autopilot === 'descent') {
          const agl = camState.altMeters - (camState.groundH || 0);
          if (agl <= 42) {
            camState.autopilot = null;
            camState.velU = 0;
          } else {
            const wantDesc = -clamp(max(18, agl * 0.36), 18, 65000);
            reentryInput.thrustE = 0;
            reentryInput.thrustN = 0;
            reentryInput.thrustU = (wantDesc - camState.velU) * 2.8;
            reentryInput.gravityScale = 1.0;
            reentryInput.allowUnderwater = false;
            camState.pitch = lerp(camState.pitch, agl > 8000 ? -0.68 : -0.18, dt * 0.85);
          }
        } else {
          // Manual real-meter altitude-adaptive flight control (1x..10x planetary warp)
          const alt = max(0, camState.altMeters);
          const altScale = 1.0 + max(0, alt - 35) * 0.018 + pow(max(0, alt - 500), 1.08) * 0.024;
          const warpMult = speedMult <= 3.0 ? speedMult : 3.0 * pow(speedMult / 3.0, 2.45);
          const targetSpd = (kShift ? 42.0 : kCtrl ? 3.5 : 14.0) * altScale * warpMult;

          const mf = kf - kb;
          const mr = kr - kl;
          const mu = ku - kd;
          const cp = cos(camState.pitch), sp = sin(camState.pitch);
          const sy = sin(camState.yaw), cy = cos(camState.yaw);
          const fwdE = sy * cp, fwdN = cy * cp, fwdU = sp;
          const rgtE = cy, rgtN = -sy;

          const wantE = (fwdE * mf + rgtE * mr) * targetSpd;
          const wantN = (fwdN * mf + rgtN * mr) * targetSpd;
          const wantU = (fwdU * mf + mu) * targetSpd;

          const resp = 5.4;
          reentryInput.thrustE = (wantE - camState.velE) * resp;
          reentryInput.thrustN = (wantN - camState.velN) * resp;
          reentryInput.thrustU = (wantU - camState.velU) * resp;
          reentryInput.gravityScale = (alt > 4000 && abs(mu) < 0.01 && abs(mf) < 0.01 && camState.velU < -25) ? 0.5 : 0.0;
          reentryInput.allowUnderwater = true;
        }

        reentryInput.clearance = camState.altMeters < 0.2 ? 0.45 : 0.72;
        stepAtmosphericReentry(camState, reentryInput, dt);
        camState.altMeters = clamp(camState.altMeters, -11000, 2.5e7);
        syncLocalFromCamState();

        // Continuous seamless handoff into heliocentric interplanetary space when ascending beyond 460 km
        if (!camState.autopilot && camState.altMeters > 460000 && camState.velU > 200) {
          syncSolarFromEarthCam(solarState, camState.latRad, camState.lonRad, camState.altMeters);
          solarState.mode = 'interplanetary';
        }

        // Solid flora/tree/rock collision ONLY when near surface (< 160m AGL)
        if (camState.altMeters < (camState.groundH || 0) + 160) {
          world.resolveWorldCollision(F[CX], F[CY], F[CZ], 0.65, camState.velE, -camState.velN, _camCol, reentryInput.clearance);
          if (_camCol.hit) {
            F[CX] = _camCol.x;
            F[CZ] = _camCol.z;
            camState.velE = _camCol.vx;
            camState.velN = -_camCol.vz;
            syncCamStateFromLocal();
          }
        }

        // Floating-origin rebasing: seamlessly stream Earth-anchored flora/wildlife with ZERO pop-in
        if (camState.altMeters < 2200 && hypot(F[CX], F[CZ]) > 155) {
          rebaseRegionalOrigin(camState.latDeg, camState.lonDeg, -1, true);
        }
      }
      recordNavTrailPoint(camState.latDeg, camState.lonDeg);
    }
  }

  audioState.camX = F[CX];
  audioState.camY = camState.altMeters;
  audioState.camZ = F[CZ];

  // Step local ecosystem & wildlife simulation only when within regional distance (capped to max 2 substeps)
  if (camState.altMeters < 1600) {
    simAcc = min(simAcc + dt, FIXED_DT * 2);
    while (simAcc >= FIXED_DT) {
      world.stepSim(FIXED_DT, F[CX], F[CY], F[CZ], rainLevel, windLevel);
      simAcc -= FIXED_DT;
    }
    world.interpolateSim(simAcc / FIXED_DT, F[CY], rainLevel);
  }

  render(dt);
  renderLiveMiniMap(now);

  if (mapModal?.classList.contains('open') && !globeDragging) {
    renderPlanetaryMap();
  }

  hudFrames++;
  hudT += dtr;
  if (dtr > hudMax) hudMax = dtr;
  hudTextTimer += dtr;
  if (hudTextTimer > 360) {
    if (locEl) {
      locEl.textContent = solarState.mode === 'interplanetary'
        ? `Solar System · Near ${(SOLAR_BODY_BY_ID[solarState.activeBodyId]?.name || 'Deep Space')}`
        : biomeLabelAtGeo(camState.latDeg, camState.lonDeg, camState.altMeters);
    }
    if (weatherEl) {
      const exploreTag = autoExplore ? ' · Auto' : camState.autopilot ? ` · ${camState.autopilot === 'ascent' ? 'Ascending' : 'Re-Entry'}` : '';
      weatherEl.textContent = solarState.mode === 'interplanetary'
        ? `Heliocentric Space · ${formatSpeedSI(solarState.speedMps)} · Sun ${(solarState.distFromSunM / AU_METERS).toFixed(3)} AU`
        : `${WEATHER_NAMES[activeWeatherIdx]} · ${TOD_NAMES[todIdx]} · ${focalMm}mm${exploreTag}`;
    }
    if (settings.showCoordinates && layerLabelEl && coordLabelEl) {
      if (solarState.mode === 'interplanetary') {
        const tgt = SOLAR_BODY_BY_ID[solarState.targetBodyId] || SOLAR_BODY_BY_ID.earth;
        layerLabelEl.textContent = 'SOL';
        coordLabelEl.textContent = `SUN ${(solarState.distFromSunM / AU_METERS).toFixed(3)} AU · ${tgt.name.toUpperCase()} ${formatDistanceSI(solarState.distToTargetM)}`;
      } else {
        const layer = camState.layer || atmosphericLayerAt(camState.altMeters);
        const latDir = camState.latDeg >= 0 ? 'N' : 'S';
        const lonDir = camState.lonDeg >= 0 ? 'E' : 'W';
        const altM = camState.altMeters;
        const altTxt = abs(altM) >= 10000
          ? `${(altM / 1000).toFixed(0)} km`
          : abs(altM) >= 1000
            ? `${(altM / 1000).toFixed(2)} km`
            : `${altM >= 0 ? '+' : ''}${altM.toFixed(1)} m`;
        layerLabelEl.textContent = layer.code;
        coordLabelEl.textContent = `${abs(camState.latDeg).toFixed(2)}°${latDir} ${abs(camState.lonDeg).toFixed(2)}°${lonDir} · ${altTxt}`;
      }
    }
    if (embodiedState.active && embodiedState.groupIdx >= 0) {
      updateEmbodimentUI();
    } else if (embodyLabelEl) {
      if (solarState.mode === 'interplanetary') {
        const tgt = SOLAR_BODY_BY_ID[solarState.targetBodyId] || SOLAR_BODY_BY_ID.earth;
        embodyLabelEl.textContent = solarState.approachWarning || `Interplanetary Flight · Target ${tgt.name} (${formatEtaSI(solarState.etaSeconds)})`;
      } else if (camState.altMeters >= 12000) {
        const stg = camState.stage?.label || camState.layer?.name || 'Orbital Flight';
        const sec = spaceSectorAt(camState.latDeg, camState.lonDeg, camState.altMeters);
        embodyLabelEl.textContent = `${stg} · ${sec.name}`;
      } else {
        const near = world.findNearestAnimal(F[CX], F[CY], F[CZ], 36);
        if (near) {
          const nGrp = world.wildlifeGroups[near.groupIdx];
          const nIt = nGrp.items[near.itemIdx];
          const emoStr = world.EMOTION_NAMES ? world.EMOTION_NAMES[clamp(round(nIt.emotion || 0), 0, 4)] : '';
          embodyLabelEl.textContent = `Nearby: ${nGrp.label} (${emoStr})`;
        } else {
          const nb = nearestBiomeAtGeo(camState.latDeg, camState.lonDeg);
          embodyLabelEl.textContent = nb.distanceKm > 5 ? `Observer · ${round(nb.distanceKm)} km to ${nb.biome.name}` : 'Observer: Free-Fly';
        }
      }
    }
    if (survivalLabelEl && world.getActiveSurvivalEvent) {
      survivalLabelEl.textContent = solarState.approachWarning
        ? solarState.approachWarning
        : camState.reentryHeat > 0.08
          ? `Atmospheric Re-Entry Plasma · Heat ${round(camState.reentryHeat * 100)}% · ${camState.stage?.label || ''}`
          : world.getActiveSurvivalEvent();
    }
    if (showHud && infoEl) {
      const fps = round((hudFrames * 1000) / max(1, hudT));
      const cDir = latLonToDir(camState.latRad, camState.lonRad);
      const cs = dirToCubeFaceUV(cDir[0], cDir[1], cDir[2]);
      const qt = planetQuadtree.stats;
      const modeTag = embodiedState.active ? ` · Embody (${embodiedState.pov})` : camState.autopilot ? ` · ${camState.autopilot}` : lookdevMode ? ' · Lookdev' : photoMode ? ' · Photo' : camState.altMeters < -0.02 ? ' · Submerged' : camState.altMeters >= KARMAN_LINE_ALT ? ' · Space' : '';
      infoEl.textContent = `${fps} fps · max ${hudMax.toFixed(1)} ms · GPU ${gpuMs ? gpuMs.toFixed(2) + ' ms' : 'n/a'} · ${W}×${H} · Face ${cs.face} · Tiles ${qt.activeCount}/${qt.cachedCount} LOD${qt.maxLodActive}\nSeed ${WORLD_SEED} · ${focalMm}mm f/${apertureF.toFixed(1)} · EV ${evScale.toFixed(2)}${modeTag}`;
    }
    hudFrames = 0; hudT = 0; hudMax = 0; hudTextTimer = 0;
  }
}

// ============================================================================
// Initial First Frame & Reveal
// ============================================================================
await say('Warming Cube-Sphere planetary & IK wildlife shaders…', 0.92);
keep('verdantLoad', 1);
addEventListener('pagehide', () => keep('verdantLoad', ''));

applyBiomePose(0);
world.updateDynamic(0, 0.016, F[CX], F[CY], F[CZ], 0, 0.45);
device.pushErrorScope('validation');
render(0.016);
menuNeedsBackdrop = false;
const firstFrameErr = await device.popErrorScope();
if (firstFrameErr || gpuValidationErr) {
  throw new Error('WebGPU render pass error: ' + (firstFrameErr?.message || gpuValidationErr));
}
await Q.onSubmittedWorkDone();
setTimeout(() => keep('verdantLoad', ''), 12000);

const autoStart = new URLSearchParams(location.search).get('autostart') === '1';
setMenu(!autoStart);

// Non-blocking background loaders for verified GBIF species dataset & high-res Natural Earth atlas
ensureSpeciesCatalogueLoaded('assets/species-catalogue.json').then(() => {
  if (mapModal?.classList.contains('open')) updateMapRegionInfo();
});
if (typeof fetch === 'function') {
  fetch('assets/earth-geo.bin')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (buf && upgradeEarthGeoAtlas(buf)) {
        mapBaseImageData = null;
        mmCacheLat = 999;
      }
    })
    .catch(() => {});
}

requestAnimationFrame((t) => {
  F[LAST] = t;
  requestAnimationFrame(frame);
});
