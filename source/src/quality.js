// ============================================================================
// REALISM — Dynamic Quality Tiers, Persistent Settings & Hardware Budgets
// ============================================================================

export const SHADOW_SIZE = 1024;
export const AA_SAMPLES = 1;
export const TARGET_GPU_MS = 10.5;
export const RES_SCALE_MIN = 0.50;
export const RES_SCALE_MAX = 1.25;
export const THIN = 1.0;
export const MAX_PARTICLES_BUDGET = 1800;

export const keep = (key, val) => {
  try {
    if (typeof localStorage !== 'undefined') {
      if (val === '' || val === null || val === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, String(val));
      }
    }
  } catch {
    // ignore storage errors in restricted iframes
  }
};

export const QUALITY_TIERS = [
  {
    name: 'Ultra',
    scale: 1.0,
    shadowSize: 1024,
    reflSize: 384,
    raySteps: 16,
    vegRatio: 1.0,
    animalRatio: 1.0,
    particleRatio: 1.0,
    bloomRatio: 0.5,
    terrainLodBias: 1.0
  },
  {
    name: 'High',
    scale: 0.85,
    shadowSize: 1024,
    reflSize: 256,
    raySteps: 12,
    vegRatio: 0.85,
    animalRatio: 1.0,
    particleRatio: 0.80,
    bloomRatio: 0.4,
    terrainLodBias: 0.88
  },
  {
    name: 'Balanced',
    scale: 0.72,
    shadowSize: 1024,
    reflSize: 256,
    raySteps: 10,
    vegRatio: 0.70,
    animalRatio: 0.85,
    particleRatio: 0.60,
    bloomRatio: 0.3,
    terrainLodBias: 0.76
  },
  {
    name: 'Performance',
    scale: 0.58,
    shadowSize: 1024,
    reflSize: 192,
    raySteps: 8,
    vegRatio: 0.50,
    animalRatio: 0.70,
    particleRatio: 0.40,
    bloomRatio: 0.2,
    terrainLodBias: 0.62
  }
];

export const DEFAULT_SETTINGS = {
  // 1. Graphics
  qualityTier: 1, // 0=Ultra, 1=High, 2=Balanced, 3=Performance
  autoQuality: true,
  resolutionScale: 0.85,
  viewDistance: 1.0,
  foliageDensity: 1.0,
  animalDetail: 1.0,
  waterQuality: 1.0,
  volumetrics: true,
  // 2. Display
  showHud: true,
  showMiniMap: true,
  miniMapMode: 'north-up', // 'north-up' | 'track-up'
  showTelemetry: false,
  showCoordinates: true,
  // 3. Camera
  defaultPov: 0, // 0=3rd-Person Behind, 1=1st-Person Eyes
  mouseSensitivity: 1.0,
  invertY: false,
  followDistance: 1.0,
  followHeight: 1.0,
  cameraSmoothing: 0.85,
  autoRecenter: true,
  fov: 54,
  // 4. Audio
  masterVolume: 0.75,
  ambientVolume: 0.85,
  wildlifeVolume: 0.90,
  waterVolume: 0.85,
  weatherVolume: 0.80,
  // 5. Controls
  turnSensitivity: 1.0,
  flightAssist: true,
  // 6. Gameplay & Planet
  moveSpeedMult: 1.0,
  hazardAvoidance: true,
  timeSpeedMult: 1.0,
  autoExploreIdle: true
};

export const STORAGE_KEY = 'realism_planet_settings_v1';

export const normalizeSettings = (parsed = null) => {
  const merged = { ...DEFAULT_SETTINGS };
  if (parsed && typeof parsed === 'object') {
    Object.assign(merged, parsed);
    // Migrate legacy hudVisible -> showHud cleanly without losing user intent
    if (typeof parsed.showHud !== 'boolean' && typeof parsed.hudVisible === 'boolean') {
      merged.showHud = parsed.hudVisible;
    }
    delete merged.hudVisible;
  }
  if (typeof merged.showHud !== 'boolean') merged.showHud = true;
  if (typeof merged.showMiniMap !== 'boolean') merged.showMiniMap = true;
  if (merged.miniMapMode !== 'north-up' && merged.miniMapMode !== 'track-up') {
    merged.miniMapMode = 'north-up';
  }
  return merged;
};

export const loadSettings = () => {
  try {
    if (typeof localStorage === 'undefined') return normalizeSettings(null);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeSettings(null);
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(null);
  }
};

export const saveSettings = (settings) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    }
  } catch {
    // ignore storage errors in restricted iframes
  }
};

export const resetSettings = () => {
  const fresh = normalizeSettings(null);
  saveSettings(fresh);
  return fresh;
};

export const createQualityController = (initialTier = 1) => {
  let tierIndex = Math.max(0, Math.min(QUALITY_TIERS.length - 1, initialTier));
  let autoMode = true;
  let emaFrameMs = 16.6;
  let highLoadTimer = 0;
  let lowLoadTimer = 0;
  let cooldown = 0;

  return {
    get tierIndex() {
      return tierIndex;
    },
    get tier() {
      return QUALITY_TIERS[tierIndex];
    },
    get autoMode() {
      return autoMode;
    },
    get emaFrameMs() {
      return emaFrameMs;
    },
    setAuto(enabled) {
      autoMode = !!enabled;
    },
    setTier(idx) {
      tierIndex = Math.max(0, Math.min(QUALITY_TIERS.length - 1, idx));
      cooldown = 2.5;
      highLoadTimer = 0;
      lowLoadTimer = 0;
      return QUALITY_TIERS[tierIndex];
    },
    cycleTier() {
      if (autoMode) {
        autoMode = false;
        tierIndex = 0;
      } else if (tierIndex < QUALITY_TIERS.length - 1) {
        tierIndex++;
      } else {
        autoMode = true;
        tierIndex = 1;
      }
      cooldown = 2.0;
      return { tier: QUALITY_TIERS[tierIndex], autoMode };
    },
    update(dtSeconds) {
      const frameMs = Math.min(100, Math.max(4, dtSeconds * 1000));
      emaFrameMs = emaFrameMs * 0.92 + frameMs * 0.08;

      if (!autoMode) return false;
      if (cooldown > 0) {
        cooldown -= dtSeconds;
        return false;
      }

      if (emaFrameMs > 22.0) {
        highLoadTimer += dtSeconds;
        lowLoadTimer = 0;
        if (highLoadTimer > 1.3 && tierIndex < QUALITY_TIERS.length - 1) {
          tierIndex++;
          highLoadTimer = 0;
          cooldown = 3.0;
          return true;
        }
      } else if (emaFrameMs < 14.2) {
        lowLoadTimer += dtSeconds;
        highLoadTimer = 0;
        if (lowLoadTimer > 4.5 && tierIndex > 0) {
          tierIndex--;
          lowLoadTimer = 0;
          cooldown = 4.0;
          return true;
        }
      } else {
        highLoadTimer = Math.max(0, highLoadTimer - dtSeconds * 0.5);
        lowLoadTimer = Math.max(0, lowLoadTimer - dtSeconds * 0.5);
      }
      return false;
    }
  };
};
