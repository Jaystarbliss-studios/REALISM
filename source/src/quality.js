// ============================================================================
// Quality Tiers, Dynamic Resolution Constants & Persistent Settings
// LV: 0 = Low, 1 = Medium, 2 = High (default desktop), 3 = Ultra (Photo Mode)
// ============================================================================
const QUALITY_NAMES = ['Low', 'Medium', 'High', 'Ultra'];
const RES_SCALE_MIN = 0.60;
const RES_SCALE_MAX = 1.00;
const TARGET_GPU_MS = 9.4;

const mob = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;
const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };

let SV = [], LV = 2, badLoad = false;
try {
  SV = (localStorage.verdantForestV2 || '').split(',');
  badLoad = !!localStorage.verdantLoad;
} catch {}

LV = SV[0] !== '' && SV[0] !== undefined ? +SV[0] : (mob ? (mem > 7 ? 1 : 0) : mem <= 4 ? 0 : 2);
if (Number.isNaN(LV) || LV < 0 || LV > 3) LV = 2;
if (badLoad && LV > 0) {
  LV--;
  SV = [LV];
  keep('verdantForestV2', LV);
}

// Density divisor & GPU pass budgets per quality tier
const THIN = LV === 3 ? 0.85 : LV === 2 ? 1.0 : LV === 1 ? 2.0 : 4.0;
const SHADOW_SIZE = LV >= 2 ? 2048 : LV === 1 ? 1536 : 1024;
const AA_SAMPLES = LV === 0 ? 1 : 4;
const RAY_STEPS = LV === 3 ? 32 : LV === 2 ? 22 : LV === 1 ? 14 : 8;
const DRAW_RADIUS = LV === 3 ? 350 : LV === 2 ? 310 : LV === 1 ? 240 : 180;
const MAX_PARTICLES_BUDGET = LV === 3 ? 12000 : LV === 2 ? 9600 : LV === 1 ? 5600 : 2800;

export {
  QUALITY_NAMES, RES_SCALE_MIN, RES_SCALE_MAX, TARGET_GPU_MS,
  LV, THIN, SHADOW_SIZE, AA_SAMPLES, RAY_STEPS, DRAW_RADIUS, MAX_PARTICLES_BUDGET,
  SV, keep
};
