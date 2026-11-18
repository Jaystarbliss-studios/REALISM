// ============================================================================
// Terra Primordia — Main WebGPU Engine, Interactive Planetary Map Teleport,
// Playable Animal Embodiment (1st & 3rd Person POV) & 8 Weather Phenomena
// ============================================================================
import {
  SHADOW_SIZE, AA_SAMPLES, TARGET_GPU_MS, RES_SCALE_MIN, RES_SCALE_MAX, keep
} from './quality.js';

const DPR_CAP = 2.0;
const SHADOW_RES = SHADOW_SIZE;
const RAY_SCALE = 0.5;
const MSAA_SAMPLES = AA_SAMPLES;
import {
  PI, TAU, sin, cos, tan, abs, hypot, min, max, floor, round, atan2, exp, pow,
  clamp, saturate, lerp, smoothstep, WORLD_SEED, rr,
  m4Mul, m4Persp, m4Ortho, m4Look, m4Inv
} from './math.js';
import {
  WORLD_HALF, FIRE_POS, VOLCANO_POS, SAVANNA_POS, BEACH_POS, REEF_POS, ABYSS_POS, POLAR_POS,
  BIOME_CATALOG, terrainAt, POSES, biomeLabelAt
} from './biomes.js';
import { uploadMaterialTextureArray } from './assets.js';
import {
  W_SKY, W_TERRAIN, W_VEG, W_ANIMAL, W_WATER, W_PARTICLE, W_RAYS, W_RAYS_MS, W_POST, W_POST_MS
} from './shaders.js';
import { buildWorld } from './world.js';
import { initAudio, updateAudio, setVolume, toggleMute, triggerSpeciesCall } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const lt = $('lt');
const lb = $('lb');
const errBox = $('err');
const goBtn = $('go');
const locEl = $('loc');
const weatherEl = $('weatherLabel');
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
// Camera, Weather, Embodiment & Telemetry State
// ============================================================================
const F = new Float64Array(16);
const TIME = 0, LAST = 1, FLT = 2, CX = 3, CY = 4, CZ = 5, VX = 6, VY = 7, VZ = 8, YAW = 9, PIT = 10;

let menu = true;
let flyActive = false;
let showHud = false;
let cleanUi = false;
let photoMode = false;
let lookdevMode = false;
let autoExplore = false;
let speedMult = 1.0;
let weatherMode = -1; // -1 = dynamic cycle, 0..7 = 8 planetary weather phenomena
let todIdx = 0;
let instinctPulse = 0.0; // [Q] Instinct Sense bio-aura wave 0..1

let focalMm = 33;
let apertureF = 2.8;
let focusDistM = 18;
let evComp = 0.0;

let lastActivityAt = performance.now();
const IDLE_EXPLORE_SEC = 30.0;
let autoTargetIdx = 0;
let autoLegTimer = 0;
let autoTargetX = 0, autoTargetY = 4, autoTargetZ = 0;

// Playable Animal Embodiment State
const embodiedState = {
  active: false,
  groupIdx: -1,
  itemIdx: 0,
  pov: '3rd', // '3rd' = 3rd-Person Cinema Follow, '1st' = 1st-Person True Eye POV
  vy: 0,
  pitch: 0
};

const TOD_PRESETS = [
  { name: 'Golden Hour', sunElev: 0.25, sunAz: 0.62, sunInt: 1.08, sunCol: [1.0, 0.80, 0.52], zen: [0.09, 0.27, 0.44], hor: [0.76, 0.56, 0.34], fog: [0.34, 0.42, 0.30] },
  { name: 'High Noon',   sunElev: 0.82, sunAz: 0.30, sunInt: 1.22, sunCol: [1.0, 0.96, 0.88], zen: [0.08, 0.34, 0.62], hor: [0.52, 0.68, 0.72], fog: [0.36, 0.48, 0.44] },
  { name: 'Blue Dusk',   sunElev: 0.07, sunAz: -0.55, sunInt: 0.42, sunCol: [0.92, 0.48, 0.32], zen: [0.04, 0.09, 0.20], hor: [0.28, 0.24, 0.32], fog: [0.12, 0.17, 0.22] }
];
const TOD_NAMES = TOD_PRESETS.map((p) => p.name);

// 8 Planetary Weather & Natural Phenomena Presets
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

function syncBodyClasses() {
  document.body.className = menu ? 'm' : 'g';
  if (cleanUi) document.body.classList.add('clean');
  if (photoMode) document.body.classList.add('photo');
}
function setMenu(open) {
  menu = open;
  syncBodyClasses();
}
function noteUserActivity() {
  lastActivityAt = performance.now();
  if (autoExplore) autoExplore = false;
}

function lookAtPose(cx, cy, cz, tx, ty, tz) {
  F[CX] = cx; F[CY] = cy; F[CZ] = cz;
  F[VX] = F[VY] = F[VZ] = 0;
  const dx = tx - cx, dy = ty - cy, dz = tz - cz;
  const d = hypot(dx, dy, dz) || 1;
  F[YAW] = atan2(dx, -dz);
  F[PIT] = Math.asin(clamp(dy / d, -0.98, 0.98));
}

// ============================================================================
// Build Procedural World & Wire Up Interactive Planetary Map + Embodiment UI
// ============================================================================
await say('Sculpting 18 planetary biomes, Abyssal Garden reefs & continuous wildlife anatomy…', 0.22);
const world = buildWorld();
const _camT = {};
const _camCol = {};
const audioState = { camX: 0, camY: 3, camZ: 0 };

lookAtPose(...POSES[0]);

function enterWilderness() {
  initAudio(audioState);
  noteUserActivity();
  if (mapModal) mapModal.classList.remove('open');
  if (embodimentModal) embodimentModal.classList.remove('open');
  setMenu(false);
  canvas.requestPointerLock?.();
}

// --- Playable Animal Embodiment Controller ---
function updateEmbodimentUI() {
  if (!embodiedState.active || embodiedState.groupIdx < 0) {
    if (embodyLabelEl) embodyLabelEl.textContent = 'Observer: Free-Fly';
    if (embodyHintEl) embodyHintEl.textContent = 'WASD Move · Mouse Look · [E] Inhabit Nearest Animal · [M] Planetary Map · [Tab] Species Index';
    if (togglePovBtn) togglePovBtn.textContent = 'POV: Free [V]';
    if (modalPovToggleBtn) modalPovToggleBtn.textContent = `POV: ${embodiedState.pov === '1st' ? '1st Person' : '3rd Person'} [V]`;
  } else {
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp.items[embodiedState.itemIdx];
    const emoName = (world.EMOTION_NAMES && it) ? world.EMOTION_NAMES[clamp(round(it.emotion || 0), 0, 4)] : 'Active';
    const povText = embodiedState.pov === '1st' ? '1st POV' : '3rd POV';
    if (embodyLabelEl) embodyLabelEl.textContent = `${grp.label} (${povText}) · ${emoName}`;
    if (embodyHintEl) {
      const actionVerb = grp.domain === 'water' ? '[Space] Breach · [C] Dive' : grp.domain === 'air' ? '[Space] Climb · [C] Stoop' : '[Space] Pounce/Display · [Shift] Sprint';
      embodyHintEl.textContent = `WASD Move · [V] 1st/3rd POV · ${actionVerb} · [R] Vocalize/Roar · [Q] Sense`;
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
  const idx = clamp(itemIdx, 0, grp.items.length - 1);
  const it = grp.items[idx];
  if (!it) return;
  it.playerControlled = true;
  embodiedState.active = true;
  embodiedState.groupIdx = groupIdx;
  embodiedState.itemIdx = idx;
  embodiedState.vy = 0;
  embodiedState.pitch = 0;
  flyActive = false;
  autoExplore = false;
  F[YAW] = it.yaw || 0;
  F[PIT] = -0.08;
  F[CX] = it.x - sin(F[YAW]) * grp.followDist;
  F[CY] = it.y + grp.eyeOffset[1] + 0.8;
  F[CZ] = it.z + cos(F[YAW]) * grp.followDist;
  triggerSpeciesCall(grp.speciesId);
  updateEmbodimentUI();
}

function togglePovMode() {
  if (embodiedState.active) {
    embodiedState.pov = embodiedState.pov === '3rd' ? '1st' : '3rd';
    updateEmbodimentUI();
  } else {
    // If in Free-Fly Spirit mode, pressing [V] inhabits the nearest animal or opens POV
    const nearest = world.findNearestAnimal(F[CX], F[CY], F[CZ], 85);
    if (nearest) {
      inhabitAnimal(nearest.groupIdx, nearest.itemIdx);
    } else {
      inhabitAnimal(0, 0);
    }
  }
}

// Populate Playable Species Grid in Embodiment Modal
const FEATURED_SPECIES = [
  'lions', 'tigers', 'gorillas', 'chimpanzees', 'elephants', 'giraffes', 'zebras',
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

// --- Interactive Planetary Topographic & Bathymetric Map Renderer ---
let mapBaseImageData = null;
function ensureMapBaseImage(ctx, w, h) {
  if (mapBaseImageData && mapBaseImageData.width === w && mapBaseImageData.height === h) return;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const mt = {};
  for (let py = 0; py < h; py++) {
    const wz = ((py / (h - 1)) * 2 - 1) * WORLD_HALF;
    for (let px = 0; px < w; px++) {
      const wx = ((px / (w - 1)) * 2 - 1) * WORLD_HALF;
      terrainAt(wx, wz, mt);
      const el = mt.h;
      let r = 24, g = 58, b = 34;

      if (el < -0.15) {
        // Bathymetry: River channel, Sunlit Coral Reef & Deep Abyssal Garden Trench
        const depthT = clamp((-el) / 18.0, 0, 1);
        r = round(lerp(24, 6, depthT));
        g = round(lerp(132, 28, depthT));
        b = round(lerp(158, 56, depthT));
        if (mt.archMask > 0.1) { r += 35; g += 25; b += 40; }
      } else {
        // Land Biomes
        r = round(28 + clamp(el * 3.2, 0, 65));
        g = round(68 + clamp(el * 2.4, 0, 52));
        b = round(34 + clamp(el * 1.4, 0, 35));
        if (mt.savanna > 0.15) {
          r = round(lerp(r, 168, mt.savanna * 0.85));
          g = round(lerp(g, 134, mt.savanna * 0.85));
          b = round(lerp(b, 62, mt.savanna * 0.85));
        }
        if (mt.plantation > 0.15) {
          r = round(lerp(r, 74, mt.plantation * 0.8));
          g = round(lerp(g, 138, mt.plantation * 0.8));
          b = round(lerp(b, 56, mt.plantation * 0.8));
        }
        if (mt.beach > 0.15 || (wz > 160 && el < 2.2 && el >= -0.15)) {
          const bw = max(mt.beach, smoothstep(2.2, 0.0, el));
          r = round(lerp(r, 214, bw * 0.85));
          g = round(lerp(g, 192, bw * 0.85));
          b = round(lerp(b, 136, bw * 0.85));
        }
        if (mt.polar > 0.15) {
          r = round(lerp(r, 215, mt.polar * 0.9));
          g = round(lerp(g, 234, mt.polar * 0.9));
          b = round(lerp(b, 250, mt.polar * 0.9));
        }
        if (mt.dune > 0.15) {
          r = round(lerp(r, 196, mt.dune * 0.88));
          g = round(lerp(g, 92, mt.dune * 0.88));
          b = round(lerp(b, 48, mt.dune * 0.88));
        }
        if (mt.fire > 0.15 || mt.volcano > 0.15) {
          const fw = max(mt.fire, mt.volcano);
          r = round(lerp(r, 165, fw * 0.85));
          g = round(lerp(g, 52, fw * 0.85));
          b = round(lerp(b, 24, fw * 0.85));
        }
        if (mt.cenote > 0.2) {
          r = round(lerp(r, 64, mt.cenote * 0.75));
          g = round(lerp(g, 148, mt.cenote * 0.75));
          b = round(lerp(b, 156, mt.cenote * 0.75));
        }
      }

      // Topographic & bathymetric contour lines every 2.5m
      const contour = abs(((el + 30) % 2.5) - 1.25);
      if (contour < 0.08) {
        r = round(r * 0.82); g = round(g * 0.82); b = round(b * 0.82);
      }

      const idx = (py * w + px) * 4;
      d[idx] = clamp(r, 0, 255);
      d[idx + 1] = clamp(g, 0, 255);
      d[idx + 2] = clamp(b, 0, 255);
      d[idx + 3] = 255;
    }
  }
  mapBaseImageData = img;
}

function worldToMapPx(wx, wz, w, h) {
  return [
    ((wx / WORLD_HALF) * 0.5 + 0.5) * w,
    ((wz / WORLD_HALF) * 0.5 + 0.5) * h
  ];
}
function mapPxToWorld(px, py, w, h) {
  return [
    ((px / w) * 2 - 1) * WORLD_HALF,
    ((py / h) * 2 - 1) * WORLD_HALF
  ];
}

function renderPlanetaryMap() {
  if (!planetMapCanvas) return;
  const ctx = planetMapCanvas.getContext('2d');
  if (!ctx) return;
  const w = planetMapCanvas.width;
  const h = planetMapCanvas.height;
  ensureMapBaseImage(ctx, w, h);
  ctx.putImageData(mapBaseImageData, 0, 0);

  // Draw live wildlife herd positions
  for (let g = 0; g < world.wildlifeGroups.length; g++) {
    const grp = world.wildlifeGroups[g];
    ctx.fillStyle = grp.role === 'predator' ? '#f87171' : grp.domain === 'water' ? '#38bdf8' : grp.domain === 'air' ? '#fde047' : '#86efac';
    for (let i = 0; i < grp.items.length; i += 2) {
      const it = grp.items[i];
      const [mx, my] = worldToMapPx(it.x, it.z, w, h);
      ctx.beginPath();
      ctx.arc(mx, my, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  // Draw all 18 Biome & Forbidden Zone Interactive Pins (Crisp Architectural Squares)
  ctx.font = '600 10px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const [bx, by] = worldToMapPx(b.pos[0], b.pos[1], w, h);
    const isForbidden = b.category === 'Forbidden Zones';
    const isOcean = b.category === 'Coast & Ocean' || b.category === 'Polar Realm';
    ctx.fillStyle = isForbidden ? 'rgba(220, 58, 58, 0.94)' : isOcean ? 'rgba(20, 148, 212, 0.94)' : 'rgba(226, 184, 87, 0.94)';
    ctx.strokeStyle = '#060d0a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx - 9, by - 9, 18, 18);
    ctx.strokeRect(bx - 9, by - 9, 18, 18);
    ctx.fillStyle = isForbidden || isOcean ? '#ffffff' : '#09100c';
    ctx.fillText(String(i + 1).padStart(2, '0'), bx, by + 0.5);
  }

  // Draw Player / Embodied Animal Current Position & View Cone
  const [cx, cy] = worldToMapPx(F[CX], F[CZ], w, h);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(F[YAW]);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.26)';
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

function teleportToWorldCoord(wx, wz, poseIdx = -1) {
  flyActive = false;
  autoExplore = false;
  if (poseIdx >= 0 && POSES[poseIdx]) {
    const p = POSES[poseIdx];
    if (embodiedState.active && embodiedState.groupIdx >= 0) {
      const grp = world.wildlifeGroups[embodiedState.groupIdx];
      const it = grp.items[embodiedState.itemIdx];
      if (it) {
        it.x = it.prevX = it.cx = p[0];
        it.z = it.prevZ = it.cz = p[2];
        terrainAt(it.x, it.z, _camT);
        it.y = it.prevY = grp.domain === 'water' ? min(-1.2, _camT.h + 2.0) : grp.domain === 'air' ? max(15, _camT.h + 12) : max(0.05, _camT.h);
      }
    }
    lookAtPose(p[0], p[1], p[2], p[3], p[4], p[5]);
  } else {
    const tx = clamp(wx, -WORLD_HALF + 15, WORLD_HALF - 15);
    const tz = clamp(wz, -WORLD_HALF + 15, WORLD_HALF - 15);
    terrainAt(tx, tz, _camT);
    const ty = _camT.h < -0.5 ? max(_camT.h + 2.5, -4.5) : _camT.h + 2.6;
    if (embodiedState.active && embodiedState.groupIdx >= 0) {
      const grp = world.wildlifeGroups[embodiedState.groupIdx];
      const it = grp.items[embodiedState.itemIdx];
      if (it) {
        it.x = it.prevX = it.cx = tx;
        it.z = it.prevZ = it.cz = tz;
        it.y = it.prevY = grp.domain === 'water' ? min(-1.0, _camT.h + 2.2) : grp.domain === 'air' ? max(14, _camT.h + 10) : max(0.05, _camT.h);
      }
    }
    lookAtPose(tx, ty, tz, tx + sin(F[YAW]) * 18, ty - 0.5, tz - cos(F[YAW]) * 18);
  }
  if (locEl) locEl.textContent = biomeLabelAt(F[CX], F[CY], F[CZ]);
  enterWilderness();
}

// Populate Map Pin Quick-Bar & Canvas Events
if (mapPinBar) {
  mapPinBar.innerHTML = '';
  BIOME_CATALOG.forEach((b, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'loc-btn';
    btn.textContent = `${String(idx + 1).padStart(2, '0')} ${b.name}`;
    btn.onclick = () => teleportToWorldCoord(b.pos[0], b.pos[1], idx);
    mapPinBar.appendChild(btn);
  });
}

if (planetMapCanvas) {
  planetMapCanvas.addEventListener('mousemove', (e) => {
    const rect = planetMapCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * planetMapCanvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * planetMapCanvas.height;
    const [wx, wz] = mapPxToWorld(px, py, planetMapCanvas.width, planetMapCanvas.height);
    terrainAt(wx, wz, _camT);

    // Check if hovering near one of the 18 Biome pins
    let nearPin = null;
    for (let i = 0; i < BIOME_CATALOG.length; i++) {
      const b = BIOME_CATALOG[i];
      const [bx, by] = worldToMapPx(b.pos[0], b.pos[1], planetMapCanvas.width, planetMapCanvas.height);
      if (hypot(px - bx, py - by) < 16) {
        nearPin = b;
        break;
      }
    }
    if (mapTooltip) {
      mapTooltip.style.display = 'block';
      mapTooltip.style.left = clamp(e.clientX - rect.left + 14, 8, rect.width - 250) + 'px';
      mapTooltip.style.top = clamp(e.clientY - rect.top + 14, 8, rect.height - 95) + 'px';
      const elStr = (_camT.h >= 0 ? '+' : '') + _camT.h.toFixed(1) + 'm';
      if (nearPin) {
        mapTooltip.innerHTML = `<strong style="color:#fde047">${nearPin.id + 1}. ${nearPin.name}</strong><br><span>${nearPin.category} · Elev ${nearPin.elev} · ${nearPin.weather}</span><br><span style="color:#93c5fd">Fauna: ${nearPin.species}</span>`;
      } else {
        const bName = biomeLabelAt(wx, _camT.h < -0.5 ? _camT.h * 0.5 : _camT.h + 1.5, wz);
        mapTooltip.innerHTML = `<strong style="color:#fde047">${bName}</strong><br><span>Coords (${round(wx)}, ${round(wz)}) · Elev/Depth ${elStr}</span><br><span style="color:#86efac">Click to teleport directly here</span>`;
      }
    }
  });
  planetMapCanvas.addEventListener('mouseleave', () => {
    if (mapTooltip) mapTooltip.style.display = 'none';
  });
  planetMapCanvas.addEventListener('click', (e) => {
    const rect = planetMapCanvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * planetMapCanvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * planetMapCanvas.height;
    for (let i = 0; i < BIOME_CATALOG.length; i++) {
      const b = BIOME_CATALOG[i];
      const [bx, by] = worldToMapPx(b.pos[0], b.pos[1], planetMapCanvas.width, planetMapCanvas.height);
      if (hypot(px - bx, py - by) < 16) {
        teleportToWorldCoord(b.pos[0], b.pos[1], i);
        return;
      }
    }
    const [wx, wz] = mapPxToWorld(px, py, planetMapCanvas.width, planetMapCanvas.height);
    teleportToWorldCoord(wx, wz, -1);
  });
}

function toggleMapModal(forceState) {
  if (!mapModal) return;
  const open = forceState !== undefined ? forceState : !mapModal.classList.contains('open');
  if (open) {
    if (embodimentModal) embodimentModal.classList.remove('open');
    document.exitPointerLock?.();
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
    document.exitPointerLock?.();
    updateEmbodimentUI();
    embodimentModal.classList.add('open');
  } else {
    embodimentModal.classList.remove('open');
  }
}

// Wire up HUD & Menu Buttons immediately so they work in all environments
if ($('openMapBtn')) $('openMapBtn').onclick = () => toggleMapModal();
if ($('menuMapBtn')) $('menuMapBtn').onclick = () => toggleMapModal(true);
if ($('closeMapBtn')) $('closeMapBtn').onclick = () => toggleMapModal(false);
if ($('openEmbodyBtn')) $('openEmbodyBtn').onclick = () => toggleEmbodimentModal();
if ($('menuEmbodyBtn')) $('menuEmbodyBtn').onclick = () => toggleEmbodimentModal(true);
if ($('closeEmbodyBtn')) $('closeEmbodyBtn').onclick = () => toggleEmbodimentModal(false);
if ($('disembodyBtn')) $('disembodyBtn').onclick = () => { disembodyAnimal(); toggleEmbodimentModal(false); };
if (togglePovBtn) togglePovBtn.onclick = () => togglePovMode();
if (modalPovToggleBtn) modalPovToggleBtn.onclick = () => togglePovMode();
if ($('instinctBtn')) $('instinctBtn').onclick = () => { instinctPulse = 0.02; };
if ($('weatherCycleBtn')) {
  $('weatherCycleBtn').onclick = () => {
    weatherMode = weatherMode < 0 ? 0 : (weatherMode + 1) >= WEATHER_PRESETS.length ? -1 : weatherMode + 1;
    const sel = $('weatherSel');
    if (sel) sel.value = String(weatherMode);
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

// Expose planetary test & inspection hooks on window
window.__terraPrimordia = {
  world,
  BIOME_CATALOG,
  POSES,
  embodiedState,
  inhabitAnimal,
  disembodyAnimal,
  togglePovMode,
  teleportToWorldCoord,
  toggleMapModal,
  toggleEmbodimentModal,
  getCameraPos: () => [F[CX], F[CY], F[CZ]]
};

// ============================================================================
// Keyboard, Mouse, Touch & UI Event Listeners
// ============================================================================
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, kShift = 0, kCtrl = 0;
let mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0;

function pickNextExploreTarget() {
  autoTargetIdx = (autoTargetIdx + 1 + floor(rr(0, POSES.length - 1))) % POSES.length;
  const p = POSES[autoTargetIdx];
  autoTargetX = p[0] + rr(-18, 18);
  autoTargetY = max(2.2, p[1] + rr(-0.5, 2.5));
  autoTargetZ = p[2] + rr(-18, 18);
  autoLegTimer = rr(14, 24);
}

const KEY_MAP = {
  KeyW: (v) => { kf = v; }, ArrowUp:    (v) => { kf = v; },
  KeyS: (v) => { kb = v; }, ArrowDown:  (v) => { kb = v; },
  KeyA: (v) => { kl = v; }, ArrowLeft:  (v) => { kl = v; },
  KeyD: (v) => { kr = v; }, ArrowRight: (v) => { kr = v; },
  Space: (v) => {
    ku = v;
    if (v && embodiedState.active && embodiedState.groupIdx >= 0) {
      embodiedState.vy = 7.8;
      const grp = world.wildlifeGroups[embodiedState.groupIdx];
      const it = grp?.items[embodiedState.itemIdx];
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
    triggerSpeciesCall(grp.speciesId);
    updateEmbodimentUI();
    return;
  }
  if (KEY_MAP[e.code]) {
    KEY_MAP[e.code](1);
    return;
  }
  if (e.code === 'Escape') {
    if (mapModal?.classList.contains('open')) { toggleMapModal(false); return; }
    if (embodimentModal?.classList.contains('open')) { toggleEmbodimentModal(false); return; }
    setMenu(!menu);
    if (menu) document.exitPointerLock?.();
  } else if (e.code === 'KeyF') {
    disembodyAnimal();
    flyActive = !flyActive;
    F[FLT] = 0;
    if (flyActive && menu) enterWilderness();
  } else if (e.code === 'KeyH') {
    showHud = !showHud;
    if (infoEl) infoEl.style.display = showHud ? 'block' : 'none';
  } else if (e.code === 'KeyU') {
    cleanUi = !cleanUi;
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
    const sel = $('weatherSel');
    if (sel) sel.value = String(weatherMode);
  } else if (e.code === 'KeyT') {
    todIdx = (todIdx + 1) % TOD_PRESETS.length;
  } else if (e.code === 'KeyN') {
    initAudio(audioState);
    const m = toggleMute();
    const mb = $('muteBtn');
    if (mb) mb.textContent = m ? 'Audio: Off' : 'Audio: On';
  } else if (e.code.startsWith('Digit')) {
    const idx = parseInt(e.code.slice(5), 10) - 1;
    if (POSES[idx]) teleportToWorldCoord(POSES[idx][0], POSES[idx][2], idx);
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
    speedMult = parseFloat(speedSlider.value);
    if (speedVal) speedVal.textContent = speedMult.toFixed(1) + 'x';
  };
}
const weatherSel = $('weatherSel');
if (weatherSel) {
  weatherSel.onchange = () => { weatherMode = parseInt(weatherSel.value, 10); };
}
const muteBtn = $('muteBtn');
if (muteBtn) {
  muteBtn.onclick = () => {
    initAudio(audioState);
    const m = toggleMute();
    muteBtn.textContent = m ? 'Audio: Off' : 'Audio: On';
  };
}
const volRange = $('volRange');
if (volRange) {
  volRange.oninput = () => {
    initAudio(audioState);
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

await say('Synthesizing 16-layer procedural material texture array…', 0.48);
const { tex: matTex } = uploadMaterialTextureArray(device);
const matSmp = device.createSampler({
  magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
  addressModeU: 'repeat', addressModeV: 'repeat'
});

await say('Uploading planetary heightmap, sunken galleon & continuous wildlife meshes…', 0.62);

function makeBuf(data, usage) {
  const b = device.createBuffer({
    size: (data.byteLength + 3) & ~3,
    usage,
    mappedAtCreation: true
  });
  new data.constructor(b.getMappedRange()).set(data);
  b.unmap();
  return b;
}

const UB_FLOATS = 96;
const UB = new Float32Array(UB_FLOATS);
const uBuf = device.createBuffer({
  size: UB.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const hTex = device.createTexture({
  size: [world.hSize, world.hSize],
  format: 'rgba32float',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
});
device.queue.writeTexture(
  { texture: hTex },
  world.hData,
  { bytesPerRow: world.hSize * 16 },
  [world.hSize, world.hSize]
);

const terVBuf = makeBuf(world.chunks.verts, GPUBufferUsage.VERTEX);
const terIBuf = makeBuf(world.chunks.indices, GPUBufferUsage.INDEX);
const chunkInstData = new Float32Array(world.chunks.chunks.length * 4);
for (let i = 0; i < world.chunks.chunks.length; i++) {
  const c = world.chunks.chunks[i];
  chunkInstData[i * 4]     = c.ox;
  chunkInstData[i * 4 + 1] = c.oz;
  chunkInstData[i * 4 + 2] = c.scale;
  chunkInstData[i * 4 + 3] = 0;
}
const terInstBuf = makeBuf(chunkInstData, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);

const watVBuf = makeBuf(world.skirt.verts, GPUBufferUsage.VERTEX);
const watIBuf = makeBuf(world.skirt.indices, GPUBufferUsage.INDEX);

const vegGpu = world.vegBuffers.map((vb) => ({
  vBuf: makeBuf(vb.verts, GPUBufferUsage.VERTEX),
  iBuf: makeBuf(vb.indices, GPUBufferUsage.INDEX),
  instBuf: makeBuf(vb.instData, GPUBufferUsage.VERTEX),
  count: vb.count,
  instCount: vb.instCount
}));

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
// Compile WGSL Render & Post Pipelines
// ============================================================================
await say('Compiling WGSL planetary, ocean caustic & micro-coat shaders…', 0.78);

const bglFrame = device.createBindGroupLayout({
  entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
});
const bgFrame = device.createBindGroup({
  layout: bglFrame,
  entries: [{ binding: 0, resource: { buffer: uBuf } }]
});

const bglEnv = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array', sampleType: 'float' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
  ]
});
const bgEnv = device.createBindGroup({
  layout: bglEnv,
  entries: [
    { binding: 0, resource: hTex.createView() },
    { binding: 1, resource: shadowView },
    { binding: 2, resource: shadowSmp },
    { binding: 3, resource: matTex.createView({ dimension: '2d-array' }) },
    { binding: 4, resource: matSmp }
  ]
});

const bglWater = device.createBindGroupLayout({
  entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }]
});
const bgWater = device.createBindGroup({
  layout: bglWater,
  entries: [{ binding: 0, resource: hTex.createView() }]
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
const plWater = device.createPipelineLayout({ bindGroupLayouts: [bglFrame, bglWater] });
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
const instVLayout = {
  arrayStride: 32,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 4, offset: 0,  format: 'float32x4' },
    { shaderLocation: 5, offset: 16, format: 'float32x4' }
  ]
};
const terVLayouts = [
  { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
  { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] }
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
  primitive: { topology: 'triangle-list', cullMode: 'back' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeTerShadow = device.createRenderPipeline({
  layout: plWater,
  vertex: { module: modTer, entryPoint: 'vsShadow', buffers: terVLayouts },
  primitive: { topology: 'triangle-list', cullMode: 'back' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 }
});

const pipeVeg = device.createRenderPipeline({
  layout: plEnv,
  vertex: { module: modVeg, entryPoint: 'vs', buffers: [meshVLayout, instVLayout] },
  fragment: { module: modVeg, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeVegShadow = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modVeg, entryPoint: 'vsShadow', buffers: [meshVLayout, instVLayout] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 }
});

const pipeAni = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modAni, entryPoint: 'vs', buffers: [meshVLayout, instVLayout] },
  fragment: { module: modAni, entryPoint: 'fs', targets: [{ format: HDR_FMT }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: DEPTH_FMT, depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: MSAA_SAMPLES }
});

const pipeAniShadow = device.createRenderPipeline({
  layout: plFrameOnly,
  vertex: { module: modAni, entryPoint: 'vsShadow', buffers: [meshVLayout, instVLayout] },
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
  layout: plWater,
  vertex: { module: modWat, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
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
let W = 0, H = 0, resScale = 1.0;
let hdrTex = null, hdrMsaaTex = null, depthTex = null, rayTex = null;
let hdrView = null, hdrMsaaView = null, depthView = null, rayView = null;
let bgRays = null, bgPost = null;

function rebuildTargets() {
  const dpr = min(window.devicePixelRatio || 1, DPR_CAP) * resScale;
  const nw = max(64, floor(window.innerWidth * dpr));
  const nh = max(64, floor(window.innerHeight * dpr));
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
}
rebuildTargets();
window.addEventListener('resize', rebuildTargets);

let qs = null, qResolveBuf = null, qReadBuf = null, qPending = false, gpuMs = 0;
if (canTimestamp) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolveBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  qReadBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
}

// ============================================================================
// Choreographed Planetary FlythroughSpline
// ============================================================================
const FLY_DURATION = 52;
function flyAt(sec) {
  const u = ((sec % FLY_DURATION) / FLY_DURATION) * POSES.length;
  const i0 = floor(u) % POSES.length;
  const i1 = (i0 + 1) % POSES.length;
  const f = smoothstep(0, 1, u - floor(u));
  const a = POSES[i0], b = POSES[i1];
  const cx = lerp(a[0], b[0], f) + sin(sec * 0.45) * 3.5;
  const cy = lerp(a[1], b[1], f) + sin(sec * 0.65) * 0.6;
  const cz = lerp(a[2], b[2], f) + cos(sec * 0.45) * 3.5;
  const tx = lerp(a[3], b[3], f);
  const ty = lerp(a[4], b[4], f);
  const tz = lerp(a[5], b[5], f);
  lookAtPose(cx, cy, cz, tx, ty, tz);
}

// ============================================================================
// Frame Uniforms & Render Pass Execution
// ============================================================================
const mProj = new Float32Array(16);
const mView = new Float32Array(16);
const mVp = new Float32Array(16);
const mInvVp = new Float32Array(16);
const mSunProj = m4Ortho(-220, 220, -220, 220, -240, 260);
const mSunView = new Float32Array(16);
const mSunVp = new Float32Array(16);
const eyeV = [0, 0, 0], tgtV = [0, 0, 0], upV = [0, 1, 0];

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

  const fov = 2 * Math.atan(18 / max(12, focalMm));
  const asp = W / max(1, H);
  eyeV[0] = F[CX]; eyeV[1] = F[CY]; eyeV[2] = F[CZ];
  tgtV[0] = F[CX] + fx; tgtV[1] = F[CY] + fy; tgtV[2] = F[CZ] + fz;
  m4Persp(fov, asp, 0.15, 720, mProj);
  m4Look(eyeV, tgtV, upV, mView);
  m4Mul(mProj, mView, mVp);
  m4Inv(mVp, mInvVp);

  m4Look([F[CX] + sx * 80, sy * 80, F[CZ] + sz * 80], [F[CX], 0, F[CZ]], [0, 1, 0], mSunView);
  m4Mul(mSunProj, mSunView, mSunVp);

  const dofStrength = photoMode ? clamp((4.5 - apertureF) / 3.1, 0.08, 1.0) : 0.0;
  evScale = pow(2, evComp) * (todIdx === 2 ? 1.35 : 1.0);
  const shutterSec = clamp((apertureF * apertureF) / (max(0.15, sunInt) * 1800 * pow(2, evComp)), 1 / 4000, 1 / 15);
  if (shutterValEl) shutterValEl.textContent = `1/${round(1 / shutterSec)}s`;

  if (instinctPulse > 0) {
    instinctPulse += dt * 0.45;
    if (instinctPulse >= 0.99) instinctPulse = 0;
  }

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
  // Nearest fire/volcano heat source + focusDistM in firePos.w
  const dFire = hypot(F[CX] - FIRE_POS[0], F[CZ] - FIRE_POS[1]);
  const dVolc = hypot(F[CX] - VOLCANO_POS[0], F[CZ] - VOLCANO_POS[1]);
  const heatPos = dVolc < dFire ? VOLCANO_POS : FIRE_POS;
  UB[84] = heatPos[0]; UB[85] = 4.5; UB[86] = heatPos[1]; UB[87] = focusDistM;
  // wind.xy = windDir, wind.z = windSpeed, wind.w = exposureScale
  UB[88] = 0.82; UB[89] = 0.57; UB[90] = windLevel; UB[91] = evScale;
  // misc.x = weatherMode, misc.y = rainIntensity, misc.z = dofStrength, misc.w = instinctPulse (+10 if lookdev)
  UB[92] = activeWeatherIdx;
  UB[93] = rainLevel;
  UB[94] = dofStrength;
  UB[95] = (lookdevMode ? 10.0 : 0.0) + clamp(instinctPulse, 0, 0.98);

  Q.writeBuffer(uBuf, 0, UB);

  if (lookdevMode) {
    world.updateLookdevRig(F[CX], F[CY], F[CZ], F[YAW], F[PIT]);
    Q.writeBuffer(lookdevGpu.instBuf, 0, world.lookdevRig.instData);
  }
  updateAudio(F[CX], F[CY], F[CZ], activeWeatherIdx, fireStr, windLevel);
}

function render(dt) {
  updateUniforms(dt);

  for (let i = 0; i < animalGpu.length; i++) {
    Q.writeBuffer(animalGpu[i].instBuf, 0, world.wildlifeGroups[i].instData);
  }

  const pRanges = world.particleRanges;
  const includeBubbles = F[CY] < 0.8 || F[CZ] > 175;
  const includeRain = rainLevel >= 0.02 && F[CY] >= 0;
  const activeParticleFloats = includeRain
    ? world.MAX_PARTICLES * 8
    : includeBubbles
      ? pRanges.rainStart * 8
      : pRanges.baseCount * 8;
  Q.writeBuffer(partInstBuf, 0, world.particles.subarray(0, activeParticleFloats));

  const enc = device.createCommandEncoder();

  // 1. Directional Sun Shadow Pass
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
  sp.setBindGroup(1, bgWater);
  sp.setVertexBuffer(0, terVBuf);
  sp.setVertexBuffer(1, terInstBuf);
  sp.setIndexBuffer(terIBuf, 'uint32');
  sp.drawIndexed(world.chunks.count, world.chunks.chunks.length);

  sp.setPipeline(pipeVegShadow);
  sp.setBindGroup(0, bgFrame);
  for (let i = 0; i < 4; i++) {
    const vg = vegGpu[i];
    if (vg.instCount > 0) {
      sp.setVertexBuffer(0, vg.vBuf);
      sp.setVertexBuffer(1, vg.instBuf);
      sp.setIndexBuffer(vg.iBuf, 'uint32');
      sp.drawIndexed(vg.count, vg.instCount);
    }
  }
  // Also cast shadow from Sunken Galleon & Savanna Acacias
  for (const idx of [7, 9]) {
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

  // 2. Main Forward HDR Scene Pass
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

  mp.setPipeline(pipeTer);
  mp.setBindGroup(0, bgFrame);
  mp.setBindGroup(1, bgEnv);
  mp.setVertexBuffer(0, terVBuf);
  mp.setVertexBuffer(1, terInstBuf);
  mp.setIndexBuffer(terIBuf, 'uint32');
  mp.drawIndexed(world.chunks.count, world.chunks.chunks.length);

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
    mp.setVertexBuffer(1, lookdevGpu.instBuf, 0, 64);
    mp.setIndexBuffer(lookdevGpu.sphereIBuf, 'uint32');
    mp.drawIndexed(lookdevGpu.sphereCount, 2);

    mp.setVertexBuffer(0, lookdevGpu.swatchVBuf);
    mp.setVertexBuffer(1, lookdevGpu.instBuf, 64, 32);
    mp.setIndexBuffer(lookdevGpu.swatchIBuf, 'uint32');
    mp.drawIndexed(lookdevGpu.swatchCount, 1);
  }

  mp.setPipeline(pipeWat);
  mp.setBindGroup(0, bgFrame);
  mp.setBindGroup(1, bgWater);
  mp.setVertexBuffer(0, watVBuf);
  mp.setIndexBuffer(watIBuf, 'uint32');
  mp.drawIndexed(world.skirt.count);

  mp.setPipeline(pipePar);
  mp.setBindGroup(0, bgFrame);
  mp.setVertexBuffer(0, partQBuf);
  mp.setVertexBuffer(1, partInstBuf);
  mp.draw(6, pRanges.baseCount, 0, 0);
  if (includeBubbles) {
    mp.draw(6, pRanges.bubbleCount, 0, pRanges.bubbleStart);
  }
  if (includeRain) {
    mp.draw(6, pRanges.rainCount, 0, pRanges.rainStart);
  }
  mp.end();

  // 3. Half-Resolution Crepuscular God-Ray / Underwater Volumetric Shaft Pass
  const rp = enc.beginRenderPass({
    colorAttachments: [{ view: rayView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }]
  });
  rp.setPipeline(pipeRay);
  rp.setBindGroup(0, bgFrame);
  rp.setBindGroup(1, bgRays);
  rp.draw(3);
  rp.end();

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
// Main Frame Loop (120 Hz Fixed-Step Accumulator, Zero-Slide Embodiment & Map)
// ============================================================================
let dynT = 0, dynN = 0, dynG = 0, dynGN = 0;
let simAcc = 0;
const FIXED_DT = world.SIM_DT;

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST];
  F[LAST] = now;
  const dt = clamp(dtr / 1000, 0.001, 0.05);
  F[TIME] += dt;

  if (!photoMode && dtr < 500 && dynT >= 0) {
    dynT += dtr; dynN++;
    if (gpuMs > 0) { dynG += gpuMs; dynGN++; }
    if (dynT > 1500) {
      const avgG = dynGN ? dynG / dynGN : 0;
      const avgF = dynT / dynN;
      let newScale = resScale;
      if (avgG > TARGET_GPU_MS || (!avgG && avgF > 18.0)) newScale = max(RES_SCALE_MIN, resScale * 0.88);
      else if (avgG > 0 && avgG < TARGET_GPU_MS * 0.68 && resScale < RES_SCALE_MAX) newScale = min(RES_SCALE_MAX, resScale * 1.08);
      if (abs(newScale - resScale) > 0.03) {
        resScale = newScale;
        rebuildTargets();
      }
      dynT = dynN = dynG = dynGN = 0;
    }
  }

  if (menu && typeof window.__flyOverride === 'undefined') {
    flyAt(F[TIME] * 0.35);
    noteUserActivity();
  } else if (!menu && flyActive && typeof window.__flyOverride === 'undefined') {
    F[FLT] += dt;
    flyAt(F[FLT]);
    if (F[FLT] >= FLY_DURATION) flyActive = false;
  } else if (!menu && embodiedState.active && embodiedState.groupIdx >= 0 && typeof window.__flyOverride === 'undefined') {
    // ========================================================================
    // Playable Animal Embodiment Controller (1st-Person & 3rd-Person POV)
    // ========================================================================
    const grp = world.wildlifeGroups[embodiedState.groupIdx];
    const it = grp.items[embodiedState.itemIdx];

    // Smooth mouse look + A/D turn
    const kq = 1 - exp(-dt * 28);
    lkx += mdx * 0.0022; lky += mdy * 0.0022;
    mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq;
    lkx -= ax; lky -= ay;
    F[YAW] += ax + (kr - kl) * 1.85 * dt;
    F[PIT] = clamp(F[PIT] - ay, -1.35, 1.35);

    it.prevX = it.x; it.prevY = it.y; it.prevZ = it.z; it.prevYaw = it.yaw;
    it.yaw = F[YAW];

    const moveFwd = kf - kb;
    const moveUp = ku - kd;
    const speedFactor = kShift ? 1.95 : kCtrl ? 0.42 : 1.0;
    const spd = grp.baseSpeed * speedMult * speedFactor;

    const dirX = sin(F[YAW]), dirZ = -cos(F[YAW]);
    const wantVx = dirX * moveFwd * spd;
    const wantVz = dirZ * moveFwd * spd;
    const kVel = 1 - exp(-dt * 6.5);
    F[VX] = lerp(F[VX], wantVx, kVel);
    F[VZ] = lerp(F[VZ], wantVz, kVel);

    let nextX = clamp(it.x + F[VX] * dt, -WORLD_HALF + 10, WORLD_HALF - 10);
    let nextZ = clamp(it.z + F[VZ] * dt, -WORLD_HALF + 10, WORLD_HALF - 10);
    terrainAt(nextX, nextZ, _camT);

    if (grp.domain === 'water') {
      // 6-DOF Marine Swimming + Surface Breaching
      const wantVy = (sin(F[PIT]) * moveFwd + moveUp * 0.75) * spd * 0.65;
      embodiedState.vy = lerp(embodiedState.vy, wantVy, kVel);
      let nextY = it.y + embodiedState.vy * dt;
      if (it.y > 0.1) {
        // Gravity arc during Whale/Orca surface breach
        embodiedState.vy -= 14.5 * dt;
        nextY = it.y + embodiedState.vy * dt;
      }
      nextY = clamp(nextY, _camT.h + 0.45, 4.8);
      it.x = nextX; it.y = nextY; it.z = nextZ;
    } else if (grp.domain === 'air') {
      // Avian Wingbeat Climb, Thermal Soaring & Raptor Stoop Dive
      const wantVy = (sin(F[PIT]) * moveFwd + moveUp * 0.85) * spd * 0.72;
      embodiedState.vy = lerp(embodiedState.vy, wantVy, kVel);
      const nextY = clamp(it.y + embodiedState.vy * dt, _camT.h + 0.6, 95);
      it.x = nextX; it.y = nextY; it.z = nextZ;
    } else {
      // Terrestrial Zero-Slide IK Quadruped / Biped / Ape Locomotion
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

    // Zero-Slide Stride Phase Coupling: advance limb animation strictly with actual distance moved
    const stepDist = hypot(it.x - it.prevX, it.z - it.prevZ);
    if (stepDist > 1e-4) {
      it.phase = (it.phase + (stepDist / max(0.18, it.strideLen)) * 1.45) % TAU;
      it.state = kShift ? 'chase' : 'forage';
      if (it.roarTimer <= 0) it.emotion = kShift ? 3 : 2;
    } else {
      it.state = 'forage';
      if (it.roarTimer <= 0) it.emotion = 0;
    }

    // Mount Camera to either 1st-Person True Eye POV or 3rd-Person Cinema Follow POV
    const eyeH = grp.eyeOffset[1] * it.scale;
    const eyeFwd = grp.eyeOffset[2] * it.scale;
    if (embodiedState.pov === '1st') {
      const bob = sin(it.phase * 2.0) * 0.04 * min(1, stepDist * 25);
      F[CX] = it.x + dirX * (eyeFwd + 0.22 * it.scale);
      F[CY] = it.y + eyeH + bob;
      F[CZ] = it.z + dirZ * (eyeFwd + 0.22 * it.scale);
    } else {
      const dist = grp.followDist * max(0.85, it.scale * 0.9);
      const camTargetX = it.x - dirX * dist * cos(F[PIT] * 0.5);
      const camTargetZ = it.z - dirZ * dist * cos(F[PIT] * 0.5);
      terrainAt(camTargetX, camTargetZ, _camT);
      const camTargetY = max(_camT.h + 0.45, it.y + eyeH + 0.85 - sin(F[PIT]) * dist * 0.55);
      F[CX] = lerp(F[CX], camTargetX, 1 - exp(-dt * 12));
      F[CY] = lerp(F[CY], camTargetY, 1 - exp(-dt * 12));
      F[CZ] = lerp(F[CZ], camTargetZ, 1 - exp(-dt * 12));
    }
  } else if (!menu && typeof window.__flyOverride === 'undefined') {
    const idleSec = (now - lastActivityAt) / 1000;
    if (!autoExplore && !photoMode && !lookdevMode && idleSec >= IDLE_EXPLORE_SEC) {
      autoExplore = true;
      pickNextExploreTarget();
    }

    if (autoExplore) {
      autoLegTimer -= dt;
      const dxT = autoTargetX - F[CX], dzT = autoTargetZ - F[CZ];
      const distT = hypot(dxT, dzT);
      if (distT < 8.5 || autoLegTimer <= 0) pickNextExploreTarget();

      const wantYaw = atan2(dxT, -dzT) + sin(F[TIME] * 0.24) * 0.28;
      let dYaw = wantYaw - F[YAW];
      while (dYaw > PI) dYaw -= TAU;
      while (dYaw < -PI) dYaw += TAU;
      F[YAW] += dYaw * (1 - exp(-dt * 1.15));

      terrainAt(F[CX], F[CZ], _camT);
      const cruiseAlt = max(_camT.h + 2.4, autoTargetY + sin(F[TIME] * 0.31) * 1.8);
      const wantPit = clamp(atan2(cruiseAlt - F[CY], max(12, distT)) * 0.55 - 0.06, -0.45, 0.38);
      F[PIT] = lerp(F[PIT], wantPit, 1 - exp(-dt * 1.2));

      const dirX = sin(F[YAW]), dirZ = -cos(F[YAW]);
      const cruiseSpd = 4.6;
      const kVel = 1 - exp(-dt * 2.4);
      F[VX] = lerp(F[VX], dirX * cruiseSpd, kVel);
      F[VY] = lerp(F[VY], clamp((cruiseAlt - F[CY]) * 0.85, -3.5, 3.5), kVel);
      F[VZ] = lerp(F[VZ], dirZ * cruiseSpd, kVel);

      const nextX = clamp(F[CX] + F[VX] * dt, -WORLD_HALF + 15, WORLD_HALF - 15);
      const nextY = clamp(F[CY] + F[VY] * dt, -20.0, 115);
      const nextZ = clamp(F[CZ] + F[VZ] * dt, -WORLD_HALF + 15, WORLD_HALF - 15);
      world.resolveWorldCollision(nextX, nextY, nextZ, 0.72, F[VX], F[VZ], _camCol, 0.75);
      F[CX] = _camCol.x; F[CY] = _camCol.y; F[CZ] = _camCol.z;
      F[VX] = _camCol.vx; F[VZ] = _camCol.vz;
    } else {
      const kq = 1 - exp(-dt * 28);
      lkx += mdx * 0.0022; lky += mdy * 0.0022;
      mdx = 0; mdy = 0;
      const ax = lkx * kq, ay = lky * kq;
      lkx -= ax; lky -= ay;
      l2x += ax; l2y += ay;
      const dyw = l2x * kq, dpt = l2y * kq;
      l2x -= dyw; l2y -= dpt;
      F[YAW] += dyw;
      F[PIT] = clamp(F[PIT] - dpt, -1.52, 1.52);

      const baseSpeed = kShift ? 28.0 : kCtrl ? 3.2 : 10.5;
      const sp = baseSpeed * speedMult;
      const mf = kf - kb;
      const mr = kr - kl;
      const mu = ku - kd;
      const cp = cos(F[PIT]), sy = sin(F[YAW]), cy = cos(F[YAW]);
      const tx = (sy * cp * mf + cy * mr) * sp;
      const ty = (sin(F[PIT]) * mf + mu) * sp;
      const tz = (-cy * cp * mf + sy * mr) * sp;
      const kVel = 1 - exp(-dt * 5.2);
      F[VX] = lerp(F[VX], tx, kVel);
      F[VY] = lerp(F[VY], ty, kVel);
      F[VZ] = lerp(F[VZ], tz, kVel);

      const nextX = clamp(F[CX] + F[VX] * dt, -WORLD_HALF + 12, WORLD_HALF - 12);
      const nextY = clamp(F[CY] + F[VY] * dt, -22.0, 115);
      const nextZ = clamp(F[CZ] + F[VZ] * dt, -WORLD_HALF + 12, WORLD_HALF - 12);
      const minClear = nextY < 0.05 ? 0.42 : 0.58;
      world.resolveWorldCollision(nextX, nextY, nextZ, 0.65, F[VX], F[VZ], _camCol, minClear);
      F[CX] = clamp(_camCol.x, -WORLD_HALF + 12, WORLD_HALF - 12);
      F[CY] = clamp(_camCol.y, -22.0, 115);
      F[CZ] = clamp(_camCol.z, -WORLD_HALF + 12, WORLD_HALF - 12);
      F[VX] = _camCol.vx;
      F[VZ] = _camCol.vz;
      if (_camCol.hitGround && F[VY] < 0) F[VY] = 0;
    }
  }

  audioState.camX = F[CX];
  audioState.camY = F[CY];
  audioState.camZ = F[CZ];

  simAcc = min(simAcc + dt, FIXED_DT * 4);
  while (simAcc >= FIXED_DT) {
    world.stepSim(FIXED_DT, F[CX], F[CY], F[CZ], rainLevel, windLevel);
    simAcc -= FIXED_DT;
  }
  world.interpolateSim(simAcc / FIXED_DT, F[CY], rainLevel);

  render(dt);

  // Refresh live Planetary Map if open
  if (mapModal?.classList.contains('open')) {
    renderPlanetaryMap();
  }

  hudFrames++;
  hudT += dtr;
  if (dtr > hudMax) hudMax = dtr;
  hudTextTimer += dtr;
  if (hudTextTimer > 420) {
    if (locEl) locEl.textContent = biomeLabelAt(F[CX], F[CY], F[CZ]);
    if (weatherEl) {
      const exploreTag = autoExplore ? ' · Auto' : '';
      weatherEl.textContent = `${WEATHER_NAMES[activeWeatherIdx]} · ${TOD_NAMES[todIdx]} · ${focalMm}mm${exploreTag}`;
    }
    if (embodiedState.active && embodiedState.groupIdx >= 0) {
      updateEmbodimentUI();
    } else if (embodyLabelEl) {
      const near = world.findNearestAnimal(F[CX], F[CY], F[CZ], 36);
      if (near) {
        const nGrp = world.wildlifeGroups[near.groupIdx];
        const nIt = nGrp.items[near.itemIdx];
        const emoStr = world.EMOTION_NAMES ? world.EMOTION_NAMES[clamp(round(nIt.emotion || 0), 0, 4)] : '';
        embodyLabelEl.textContent = `Nearby: ${nGrp.label} (${emoStr})`;
      } else {
        embodyLabelEl.textContent = 'Observer: Free-Fly';
      }
    }
    if (survivalLabelEl && world.getActiveSurvivalEvent) {
      survivalLabelEl.textContent = world.getActiveSurvivalEvent();
    }
    if (showHud && infoEl) {
      const fps = round((hudFrames * 1000) / max(1, hudT));
      const modeTag = embodiedState.active ? ` · Embody (${embodiedState.pov})` : autoExplore ? ' · Auto-Explore' : lookdevMode ? ' · Lookdev' : photoMode ? ' · Photo' : F[CY] < -0.02 ? ' · Submerged' : '';
      infoEl.textContent = `${fps} fps · max ${hudMax.toFixed(1)} ms · GPU ${gpuMs ? gpuMs.toFixed(2) + ' ms' : 'n/a'} · ${W}×${H}\nSeed ${WORLD_SEED} · ${focalMm}mm f/${apertureF.toFixed(1)} · EV ${(evScale).toFixed(2)}${modeTag}`;
    }
    hudFrames = 0; hudT = 0; hudMax = 0; hudTextTimer = 0;
  }
}

// ============================================================================
// Initial First Frame & Reveal
// ============================================================================
await say('Warming shaders & illuminating the 18 planetary biomes…', 0.92);
keep('verdantLoad', 1);
addEventListener('pagehide', () => keep('verdantLoad', ''));

lookAtPose(...POSES[0]);
world.updateDynamic(0, 0.016, F[CX], F[CY], F[CZ], 0, 0.45);
device.pushErrorScope('validation');
render(0.016);
const firstFrameErr = await device.popErrorScope();
if (firstFrameErr || gpuValidationErr) {
  throw new Error('WebGPU render pass error: ' + (firstFrameErr?.message || gpuValidationErr));
}
await Q.onSubmittedWorkDone();
setTimeout(() => keep('verdantLoad', ''), 12000);

const autoStart = new URLSearchParams(location.search).get('autostart') === '1';
if (autoStart) {
  setMenu(false);
} else {
  setMenu(true);
}

requestAnimationFrame((t) => {
  F[LAST] = t;
  requestAnimationFrame(frame);
});
