// ============================================================================
// REALISM — Earth-Scale Planetary Geodesy (6,371 km Radius), 6-Face Cube-Sphere
// Quadtree Terrain Streamer, Atmospheric-to-Space Layers & 18 Seamless Biomes
// ============================================================================
import {
  PI, TAU, sin, cos, abs, hypot, min, max, sqrt, floor, atan2,
  clamp, saturate, lerp, smoothstep, fbm2
} from './math.js';

export const WORLD_SIZE = 720;
export const WORLD_HALF = 360;
export const WATER_LEVEL = 0.0;

// Earth-Scale Planetary Constants (WGS-84 Oblate Spheroid & Geodesic Reference)
export const PLANET_RADIUS = 6371000;            // Mean Earth radius in meters (6,371 km)
export const PLANET_EQUATORIAL_RADIUS = 6378137; // Equatorial radius in meters
export const PLANET_POLAR_RADIUS = 6356752;      // Polar radius in meters
export const PLANET_CIRCUMFERENCE = 40075017;    // Equatorial circumference in meters (40,075 km)
export const PLANET_SURFACE_KM2 = 510072000;     // 510.072 million sq km (~196.94 million sq miles)
export const KARMAN_LINE_ALT = 100000;           // 100 km atmospheric exit boundary
export const OCEAN_COVERAGE = 0.71;              // 71% Marine/Ocean, 29% Continental Land

// Vertical Atmospheric & Orbital Space Layers
export const ATMOSPHERE_LAYERS = [
  { id: 0, name: 'Abyssal & Pelagic Ocean', code: 'OCEAN', minAlt: -12000, maxAlt: -0.05, realKm: '-11 - 0 km', desc: 'Photic coral reefs, mesopelagic twilight & Abyssal Garden hydrothermal trenches' },
  { id: 1, name: 'Troposphere', code: 'TROPO', minAlt: -0.05, maxAlt: 160, realKm: '0 - 12 km', desc: 'Dense breathable air, cumulus clouds, active weather & terrestrial biosphere' },
  { id: 2, name: 'Stratosphere', code: 'STRATO', minAlt: 160, maxAlt: 380, realKm: '12 - 50 km', desc: 'Ozone layer, calm winds, deep cobalt sky & curved planetary horizon limb' },
  { id: 3, name: 'Mesosphere', code: 'MESO', minAlt: 380, maxAlt: 720, realKm: '50 - 85 km', desc: 'Rarified upper air, noctilucent ice crystals & emerging celestial starfield' },
  { id: 4, name: 'Thermosphere', code: 'THERMO', minAlt: 720, maxAlt: 1250, realKm: '85 - 600 km', desc: 'Geomagnetic auroral curtains, low-Earth orbital horizon & near-vacuum sky' },
  { id: 5, name: 'Exosphere', code: 'EXO', minAlt: 1250, maxAlt: 2300, realKm: '600 - 10,000 km', desc: 'Kármán orbital space, full 3D spherical planet globe & atmospheric limb halo' },
  { id: 6, name: 'Deep Universe', code: 'COSMOS', minAlt: 2300, maxAlt: 1e12, realKm: '> 10,000 km', desc: 'Unbounded procedural universe, star clusters, nebulae & galactic sectors' }
];

export const atmosphericLayerAt = (altMeters) => {
  for (let i = ATMOSPHERE_LAYERS.length - 1; i >= 0; i--) {
    if (altMeters >= ATMOSPHERE_LAYERS[i].minAlt) {
      const layer = ATMOSPHERE_LAYERS[i];
      const span = Math.max(1, layer.maxAlt - layer.minAlt);
      const t = clamp((altMeters - layer.minAlt) / span, 0, 1);
      let equivKm = 0;
      if (altMeters < 0) equivKm = (altMeters / 22) * 4.2;
      else if (altMeters < 160) equivKm = (altMeters / 160) * 12;
      else if (altMeters < 380) equivKm = 12 + ((altMeters - 160) / 220) * 38;
      else if (altMeters < 720) equivKm = 50 + ((altMeters - 380) / 340) * 35;
      else if (altMeters < 1250) equivKm = 85 + ((altMeters - 720) / 530) * 515;
      else if (altMeters < 2300) equivKm = 600 + ((altMeters - 1250) / 1050) * 9400;
      else equivKm = 10000 + (altMeters - 2300) * 28;
      const spaceFactor = clamp((altMeters - 140) / 960, 0, 1);
      return { ...layer, progress: t, equivKm, spaceFactor };
    }
  }
  return { ...ATMOSPHERE_LAYERS[0], progress: 0, equivKm: -1.0, spaceFactor: 0 };
};

// Geodesic Spherical Wrapping:
// Moving continuously across the planetary surface wraps smoothly around the globe (period = WORLD_SIZE)
export const wrapCoord = (v) => {
  if (!Number.isFinite(v)) return 0;
  const s = WORLD_SIZE;
  return ((((v + WORLD_HALF) % s) + s) % s) - WORLD_HALF;
};

export const wrapDelta = (a, b = 0) => wrapCoord(a - b);

// Convert continuous world (x, y, z) to Spherical Geodesic (latDeg, lonDeg, altMeters, unitNormal)
// and 6-Face Cube-Sphere coordinates (face 0..5, u, v in [-1, 1])
export const worldToLatLonAlt = (x, y, z) => {
  const wx = wrapCoord(x);
  const wz = wrapCoord(z);
  const lonDeg = (wx / WORLD_HALF) * 180.0;
  const latDeg = clamp((-wz / WORLD_HALF) * 85.0, -89.9, 89.9);
  const latRad = (latDeg * PI) / 180.0;
  const lonRad = (lonDeg * PI) / 180.0;
  const cl = cos(latRad);
  const nx = cl * sin(lonRad);
  const ny = sin(latRad);
  const nz = cl * cos(lonRad);
  const earthArcKm = hypot(x, z) * (40075.017 / WORLD_SIZE);
  const layer = atmosphericLayerAt(y);
  return {
    lat: latDeg,
    lon: lonDeg,
    latDeg,
    lonDeg,
    altMeters: y,
    altKm: layer.equivKm,
    nx,
    ny,
    nz,
    wrappedX: wx,
    wrappedZ: wz,
    earthArcKm
  };
};

export const latLonToWorld = (latDeg, lonDeg) => {
  const x = (clamp(lonDeg, -180, 180) / 180.0) * WORLD_HALF;
  const z = (-clamp(latDeg, -85, 85) / 85.0) * WORLD_HALF;
  return { x, z };
};

// 6-Face Cube-Sphere Projection (+X=0, -X=1, +Y=2, -Y=3, +Z=4, -Z=5)
export const worldToCubeSphere = (x, y, z) => {
  const g = worldToLatLonAlt(x, y, z);
  const ax = abs(g.nx), ay = abs(g.ny), az = abs(g.nz);
  let face = 0, u = 0, v = 0, ma = ax;
  if (ax >= ay && ax >= az) {
    ma = ax;
    face = g.nx >= 0 ? 0 : 1;
    u = (g.nx >= 0 ? -g.nz : g.nz) / ma;
    v = g.ny / ma;
  } else if (ay >= ax && ay >= az) {
    ma = ay;
    face = g.ny >= 0 ? 2 : 3;
    u = g.nx / ma;
    v = (g.ny >= 0 ? -g.nz : g.nz) / ma;
  } else {
    ma = az || 1;
    face = g.nz >= 0 ? 4 : 5;
    u = (g.nz >= 0 ? g.nx : -g.nx) / ma;
    v = g.ny / ma;
  }
  // Oblate spheroid radius at latitude
  const sinLat2 = g.ny * g.ny;
  const radiusAtLat = lerp(PLANET_EQUATORIAL_RADIUS, PLANET_POLAR_RADIUS, sinLat2);
  return {
    face,
    u,
    v,
    nx: g.nx,
    ny: g.ny,
    nz: g.nz,
    radiusAtLat,
    latDeg: g.latDeg,
    lonDeg: g.lonDeg
  };
};

// Dynamic Camera-Centered Quadtree Chunk Streamer (Floating-Origin Terrain Grid)
// Streams terrain chunks continuously around (camX, camZ) so the player can circumnavigate
// the entire planet without ever reaching the edge of the terrain mesh.
export const updateQuadtreeChunks = (camX, camY, camZ, baseChunks, outInstData, viewDistScale = 1.0) => {
  const snapSize = 45.0;
  const anchorX = Math.round(camX / snapSize) * snapSize;
  const anchorZ = Math.round(camZ / snapSize) * snapSize;
  const altScale = clamp(1.0 + Math.max(0, camY - 90) * 0.008, 1.0, 4.5) * clamp(viewDistScale, 0.6, 1.6);

  for (let i = 0; i < baseChunks.length; i++) {
    const c = baseChunks[i];
    outInstData[i * 4]     = anchorX + c.ox * altScale;
    outInstData[i * 4 + 1] = anchorZ + c.oz * altScale;
    outInstData[i * 4 + 2] = c.scale * altScale;
    outInstData[i * 4 + 3] = 0;
  }
  return outInstData;
};

// Deterministic procedural universe sector generator for high-altitude / deep-space exploration
export const spaceSectorAt = (x, y, z) => {
  const sx = Math.floor(x / 500);
  const sy = Math.floor(Math.max(0, y - 1100) / 500);
  const sz = Math.floor(z / 500);
  const h = Math.abs(Math.sin(sx * 127.1 + sy * 311.7 + sz * 74.7) * 43758.5453);
  const idx = Math.floor((h % 1) * 6);
  const names = [
    'Orion-Cygnus Spiral Arm',
    'Carina Nebula Filament',
    'Magellanic Tidal Stream',
    'Perseus Molecular Cloud',
    'Vela Supernova Remnant',
    'Local Bubble Interstellar Void'
  ];
  return {
    sectorX: sx,
    sectorY: sy,
    sectorZ: sz,
    name: names[idx] || names[0]
  };
};

// ============================================================================
// 18 Canonical Planetary Biome Coordinates (Aligned with W_TERRAIN & W_WATER)
// ============================================================================
export const LAGOON_POS     = [22, 16];
export const POND_POS       = [-35, -30];
export const CYPRESS_POS    = [-95, 25];
export const AMAZON_POS     = [108, -72];
export const MANGROVE_POS   = [82, 58];
export const CLEARING_POS   = [-18, -88];
export const PLANTATION_POS = [64, -148];
export const SAVANNA_POS    = [-215, -35];
export const BAMBOO_POS     = [192, -142];
export const HIGHLAND_POS   = [198, 22];
export const BEACH_POS      = [0, 168];
export const REEF_POS       = [-55, 225];
export const ABYSS_POS      = [55, 265];
export const ROOKERY_POS    = [-215, 245];
export const POLAR_POS      = [215, 255];
export const FIRE_POS       = [-128, 118];
export const VOLCANO_POS    = [245, 38];
export const FORGOTTEN_POS  = [-148, -125];
export const DUNE_POS       = [-235, -185];

export const BIOME_CATALOG = [
  {
    id: 0,
    key: 'river',
    name: 'The River Sanctuary',
    subtitle: 'Emerald Floodplain, Otter Lagoon & Heron Shallows',
    category: 'Wetlands & Rivers',
    region: 'Central Basin',
    forbidden: false,
    pos: LAGOON_POS,
    center: LAGOON_POS,
    radius: 75,
    elev: '-1.4m to +3.2m',
    weather: 'Golden Sunlight',
    species: 'Giant River Otter, Manatee, Alligator, Kingfisher'
  },
  {
    id: 1,
    key: 'swamp',
    name: 'The Cypress Swamp',
    subtitle: 'Buttressed Knees, Duckweed Bayous & Spanish Moss',
    category: 'Wetlands & Rivers',
    region: 'Western Lowlands',
    forbidden: false,
    pos: CYPRESS_POS,
    center: CYPRESS_POS,
    radius: 78,
    elev: '-0.8m to +2.1m',
    weather: 'Swamp Morning Mist',
    species: 'American Alligator, Green Anaconda, Great White Egret, Florida Panther'
  },
  {
    id: 2,
    key: 'canopy',
    name: 'The Amazon Emerald Canopy',
    subtitle: 'Layered Kapok Crowns, Lianas & Macaw Thermals',
    category: 'Rainforests',
    region: 'Eastern Rainforest',
    forbidden: false,
    pos: AMAZON_POS,
    center: AMAZON_POS,
    radius: 82,
    elev: '+2.5m to +14.8m',
    weather: 'Golden Sunlight',
    species: 'Scarlet Macaw, Toco Toucan, Spider Monkey, Three-Toed Sloth, Tapir'
  },
  {
    id: 3,
    key: 'mangrove',
    name: 'The Mangrove Passage',
    subtitle: 'Intertidal Stilt Roots, Brackish Channels & Caimans',
    category: 'Wetlands & Rivers',
    region: 'Southeast Estuary',
    forbidden: false,
    pos: MANGROVE_POS,
    center: MANGROVE_POS,
    radius: 72,
    elev: '-0.9m to +1.8m',
    weather: 'Golden Sunlight',
    species: 'Black Caiman, Mangrove Raccoon, Green Iguana, Roseate Spoonbill'
  },
  {
    id: 4,
    key: 'clearing',
    name: 'The Sunlit Wildlife Clearing',
    subtitle: 'Wildflower Meadows, Clover & Grazing Deer Herds',
    category: 'Grasslands & Terraces',
    region: 'Heartland Terrace',
    forbidden: false,
    pos: CLEARING_POS,
    center: CLEARING_POS,
    radius: 74,
    elev: '+1.8m to +4.5m',
    weather: 'Golden Sunlight',
    species: 'White-Tailed Deer, Black Bear, Blue Morpho Butterfly'
  },
  {
    id: 5,
    key: 'plantation',
    name: 'Overgrown Heritage Plantations',
    subtitle: 'Wild-Reclaimed Banana, Cacao & Bamboo Terraces',
    category: 'Grasslands & Terraces',
    region: 'Northern Terraces',
    forbidden: false,
    pos: PLANTATION_POS,
    center: PLANTATION_POS,
    radius: 76,
    elev: '+2.8m to +7.4m',
    weather: 'Golden Sunlight',
    species: 'Wild Chimpanzee, Toco Toucan, Hercules Beetle'
  },
  {
    id: 6,
    key: 'savanna',
    name: 'The Serengeti Savanna & Kopjes',
    subtitle: 'Golden Grasslands, Umbrella Acacias & Lion Prides',
    category: 'Grasslands & Terraces',
    region: 'Western Plains',
    forbidden: false,
    pos: SAVANNA_POS,
    center: SAVANNA_POS,
    radius: 92,
    elev: '+1.6m to +8.2m',
    weather: 'Savanna Heat Haze & Dust Devils',
    species: 'African Lion, African Bush Elephant, Reticulated Giraffe, Plains Zebra'
  },
  {
    id: 7,
    key: 'bamboo',
    name: 'The Misty Bamboo & Monsoon Jungle',
    subtitle: 'Giant Culm Grottos, Bengal Tigers & Monsoon Mist',
    category: 'Rainforests',
    region: 'Northeast Highlands',
    forbidden: false,
    pos: BAMBOO_POS,
    center: BAMBOO_POS,
    radius: 85,
    elev: '+3.5m to +12.4m',
    weather: 'Tropical Monsoon Storm',
    species: 'Bengal Tiger, Crowned Harpy Eagle, Pileated Woodpecker'
  },
  {
    id: 8,
    key: 'ape_highlands',
    name: 'The Virunga Ape Highlands',
    subtitle: 'Cloud-Forest Ridges, Silverback Gorillas & Chimpanzees',
    category: 'Rainforests',
    region: 'Eastern Escarpment',
    forbidden: false,
    pos: HIGHLAND_POS,
    center: HIGHLAND_POS,
    radius: 86,
    elev: '+5.5m to +16.2m',
    weather: 'Swamp Morning Mist',
    species: 'Silverback Mountain Gorilla, Wild Chimpanzee, Harpy Eagle'
  },
  {
    id: 9,
    key: 'beach',
    name: 'The Golden Tropical Beach & Atoll',
    subtitle: 'Coconut Palms, Wet Swash Zone & Shorebreak Surf',
    category: 'Coast & Ocean',
    region: 'Southern Coastline',
    forbidden: false,
    pos: BEACH_POS,
    center: BEACH_POS,
    radius: 78,
    elev: '-0.5m to +2.4m',
    weather: 'Coastal Shorebreak Surf',
    species: 'Caribbean Flamingo, Green Sea Turtle, Coconut Crab'
  },
  {
    id: 10,
    key: 'coral_reef',
    name: 'The Sunlit Coral Reef & Kelp Basin',
    subtitle: 'Caustic Shallows, Giant Kelp Forests & Reef Schools',
    category: 'Coast & Ocean',
    region: 'Pelagic Shelf',
    forbidden: false,
    pos: REEF_POS,
    center: REEF_POS,
    radius: 84,
    elev: '-6.8m to -2.2m',
    weather: 'Coastal Shorebreak Surf',
    species: 'Oceanic Manta Ray, Great White Shark, Green Sea Turtle, Reef Fish Schools'
  },
  {
    id: 11,
    key: 'abyssal_garden',
    name: 'The Abyssal Garden & Hydrothermal Trench',
    subtitle: 'Sunken Galleon, Bioluminescent Plumes & Whale Pods',
    category: 'Coast & Ocean',
    region: 'Deep Ocean Trench',
    forbidden: false,
    pos: ABYSS_POS,
    center: ABYSS_POS,
    radius: 90,
    elev: '-16.5m to -7.5m',
    weather: 'Coastal Shorebreak Surf',
    species: 'Humpback Whale, Orca, Great White Shark, Oceanic Manta Ray'
  },
  {
    id: 12,
    key: 'sub_antarctic',
    name: 'The Sub-Antarctic Penguin Rookery',
    subtitle: 'Basalt Headlands, Tussock Grass & Diving Penguins',
    category: 'Polar Realm',
    region: 'Southwest Convergence',
    forbidden: false,
    pos: ROOKERY_POS,
    center: ROOKERY_POS,
    radius: 84,
    elev: '-1.5m to +6.5m',
    weather: 'Polar Blizzard',
    species: 'Emperor Penguin, Leopard Seal, Orca'
  },
  {
    id: 13,
    key: 'ice_planet',
    name: 'The Polar Ice Planet & Glacial Shelf',
    subtitle: 'Tabular Icebergs, Sea-Ice Leads, Polar Bears & Aurora',
    category: 'Polar Realm',
    region: 'Southeast Antarctic Pole',
    forbidden: false,
    pos: POLAR_POS,
    center: POLAR_POS,
    radius: 96,
    elev: '-2.0m to +9.5m',
    weather: 'Polar Night & Aurora',
    species: 'Polar Bear, Emperor Penguin, Leopard Seal, Humpback Whale'
  },
  {
    id: 14,
    key: 'burning_forest',
    name: 'Forbidden Zone I: The Burning Forest',
    subtitle: 'Lightning Wildfire Front, Glowing Embers & Ash Plumes',
    category: 'Forbidden Zones',
    region: 'Forbidden Southwest',
    forbidden: true,
    pos: FIRE_POS,
    center: FIRE_POS,
    radius: 82,
    elev: '+1.2m to +7.8m',
    weather: 'Volcanic Ash & Wildfire',
    species: 'Fleeing Wildlife & Fire-Adapted Raptors'
  },
  {
    id: 15,
    key: 'volcanic_caldera',
    name: 'Forbidden Zone II: Obsidian Volcanic Caldera',
    subtitle: 'Molten Pahoehoe Lava Rivers, Basalt Columns & Steam Vents',
    category: 'Forbidden Zones',
    region: 'Forbidden East Rim',
    forbidden: true,
    pos: VOLCANO_POS,
    center: VOLCANO_POS,
    radius: 84,
    elev: '+2.5m to +18.5m',
    weather: 'Volcanic Ash & Wildfire',
    species: 'Thermophilic Vents & Circling Eagles'
  },
  {
    id: 16,
    key: 'cenote_cavern',
    name: 'Forbidden Zone III: Bioluminescent Cenote',
    subtitle: 'Collapsed Karst Sinkhole, Turquoise Pool & Glow Spores',
    category: 'Forbidden Zones',
    region: 'Forbidden Northwest Sinkhole',
    forbidden: true,
    pos: FORGOTTEN_POS,
    center: FORGOTTEN_POS,
    radius: 76,
    elev: '-3.5m to +8.4m',
    weather: 'Swamp Morning Mist',
    species: 'Amazonian Jaguar, Spectacled Owl, Bioluminescent Mycena'
  },
  {
    id: 17,
    key: 'skeleton_coast',
    name: 'Forbidden Zone IV: The Skeleton Coast & Red Dunes',
    subtitle: 'Towering Iron-Oxide Dunes, Desert Lions & Surf Fog',
    category: 'Forbidden Zones',
    region: 'Forbidden Northwest Desert',
    forbidden: true,
    pos: DUNE_POS,
    center: DUNE_POS,
    radius: 84,
    elev: '+2.0m to +14.5m',
    weather: 'Savanna Heat Haze & Dust Devils',
    species: 'Desert-Adapted Lion, Desert Elephant'
  }
];

export const BIOMES = BIOME_CATALOG;

// 18 Cinematic Camera Poses [cx, cy, cz, tx, ty, tz] for the 18 Planetary Biomes
export const POSES = [
  [LAGOON_POS[0] - 12,     3.2,  LAGOON_POS[1] + 18,     LAGOON_POS[0] + 6,      1.2,  LAGOON_POS[1] - 6],
  [CYPRESS_POS[0] - 14,    2.8,  CYPRESS_POS[1] + 16,    CYPRESS_POS[0] + 4,     1.4,  CYPRESS_POS[1] - 8],
  [AMAZON_POS[0] - 16,     7.5,  AMAZON_POS[1] + 18,     AMAZON_POS[0] + 6,      5.5,  AMAZON_POS[1] - 8],
  [MANGROVE_POS[0] - 12,   2.6,  MANGROVE_POS[1] + 15,   MANGROVE_POS[0] + 5,    1.2,  MANGROVE_POS[1] - 6],
  [CLEARING_POS[0] - 14,   4.2,  CLEARING_POS[1] + 18,   CLEARING_POS[0] + 4,    2.6,  CLEARING_POS[1] - 6],
  [PLANTATION_POS[0] - 14, 5.8,  PLANTATION_POS[1] + 18, PLANTATION_POS[0] + 4,  4.0,  PLANTATION_POS[1] - 6],
  [SAVANNA_POS[0] - 18,    4.8,  SAVANNA_POS[1] + 22,    SAVANNA_POS[0] + 8,     3.2,  SAVANNA_POS[1] - 8],
  [BAMBOO_POS[0] - 16,     7.2,  BAMBOO_POS[1] + 18,     BAMBOO_POS[0] + 6,      5.0,  BAMBOO_POS[1] - 6],
  [HIGHLAND_POS[0] - 16,   9.8,  HIGHLAND_POS[1] + 18,   HIGHLAND_POS[0] + 6,    7.5,  HIGHLAND_POS[1] - 6],
  [BEACH_POS[0] - 15,      2.8,  BEACH_POS[1] - 16,      BEACH_POS[0] + 4,       0.8,  BEACH_POS[1] + 18],
  [REEF_POS[0] - 10,      -1.8,  REEF_POS[1] - 14,       REEF_POS[0] + 4,       -3.5,  REEF_POS[1] + 10],
  [ABYSS_POS[0] - 12,     -6.2,  ABYSS_POS[1] - 15,      ABYSS_POS[0] - 2,      -9.5,  ABYSS_POS[1] + 4],
  [ROOKERY_POS[0] + 14,    4.6,  ROOKERY_POS[1] - 16,    ROOKERY_POS[0] - 4,     2.5,  ROOKERY_POS[1] + 6],
  [POLAR_POS[0] - 16,      5.2,  POLAR_POS[1] - 18,      POLAR_POS[0] + 6,       3.0,  POLAR_POS[1] + 8],
  [FIRE_POS[0] - 16,       5.5,  FIRE_POS[1] + 18,       FIRE_POS[0] + 4,        3.5,  FIRE_POS[1] - 6],
  [VOLCANO_POS[0] - 20,    9.5,  VOLCANO_POS[1] + 20,    VOLCANO_POS[0] + 4,     6.5,  VOLCANO_POS[1] - 4],
  [FORGOTTEN_POS[0] - 14,  4.8,  FORGOTTEN_POS[1] + 16,  FORGOTTEN_POS[0] + 4,   2.2,  FORGOTTEN_POS[1] - 6],
  [DUNE_POS[0] + 16,       6.4,  DUNE_POS[1] + 18,       DUNE_POS[0] - 6,        4.2,  DUNE_POS[1] - 6]
];

// Fast CPU-side analytical terrain & bathymetry evaluator matching GPU W_TERRAIN
// Completely boundary-free: coordinates wrap geodesically around the spherical planet with zero outer walls.
export const terrainAt = (rawX, rawZ, out = {}) => {
  const x = wrapCoord(rawX);
  const z = wrapCoord(rawZ);

  // 1. Primary meandering river valley through the central sanctuary (passes through LAGOON_POS = [22, 16])
  const riverCenterZ = 16.0 + sin((x - 22.0) * 0.022) * 18.0;
  const distRiver = abs(z - riverCenterZ);
  const distLagoon = hypot(wrapDelta(x, LAGOON_POS[0]), wrapDelta(z, LAGOON_POS[1]));
  const distPond = hypot(wrapDelta(x, POND_POS[0]), wrapDelta(z, POND_POS[1]));

  // 2. Biome proximity distances (using wrapped geodesic deltas)
  const dSwamp      = hypot(wrapDelta(x, CYPRESS_POS[0]),    wrapDelta(z, CYPRESS_POS[1]));
  const dAmazon     = hypot(wrapDelta(x, AMAZON_POS[0]),     wrapDelta(z, AMAZON_POS[1]));
  const dMangrove   = hypot(wrapDelta(x, MANGROVE_POS[0]),   wrapDelta(z, MANGROVE_POS[1]));
  const dClearing   = hypot(wrapDelta(x, CLEARING_POS[0]),   wrapDelta(z, CLEARING_POS[1]));
  const dPlantation = hypot(wrapDelta(x, PLANTATION_POS[0]), wrapDelta(z, PLANTATION_POS[1]));
  const dSavanna    = hypot(wrapDelta(x, SAVANNA_POS[0]),    wrapDelta(z, SAVANNA_POS[1]));
  const dBamboo     = hypot(wrapDelta(x, BAMBOO_POS[0]),     wrapDelta(z, BAMBOO_POS[1]));
  const dHighland   = hypot(wrapDelta(x, HIGHLAND_POS[0]),   wrapDelta(z, HIGHLAND_POS[1]));
  const dBeach      = hypot(wrapDelta(x, BEACH_POS[0]),      wrapDelta(z, BEACH_POS[1]));
  const dReef       = hypot(wrapDelta(x, REEF_POS[0]),       wrapDelta(z, REEF_POS[1]));
  const dAbyss      = hypot(wrapDelta(x, ABYSS_POS[0]),      wrapDelta(z, ABYSS_POS[1]));
  const dRookery    = hypot(wrapDelta(x, ROOKERY_POS[0]),    wrapDelta(z, ROOKERY_POS[1]));
  const dPolar      = hypot(wrapDelta(x, POLAR_POS[0]),      wrapDelta(z, POLAR_POS[1]));
  const dFire       = hypot(wrapDelta(x, FIRE_POS[0]),       wrapDelta(z, FIRE_POS[1]));
  const dVolcano    = hypot(wrapDelta(x, VOLCANO_POS[0]),    wrapDelta(z, VOLCANO_POS[1]));
  const dCenote     = hypot(wrapDelta(x, FORGOTTEN_POS[0]),  wrapDelta(z, FORGOTTEN_POS[1]));
  const dDune       = hypot(wrapDelta(x, DUNE_POS[0]),       wrapDelta(z, DUNE_POS[1]));

  // North Antarctica / Arctic Polar Ice Continent (z < -220) & South Antarctica Continent
  const northPolarBand = smoothstep(-215.0, -275.0, z + sin(x * 0.025) * 14.0);
  const southPolarBand = smoothstep(285.0, 335.0, z + cos(x * 0.025) * 12.0) * (1.0 - smoothstep(85.0, 20.0, dAbyss));

  // Biome influence weights [0..1]
  const wRiver      = clamp(smoothstep(26.0, 4.0, distRiver) + smoothstep(34.0, 6.0, distLagoon) * 0.65, 0, 1);
  const wSwamp      = clamp(smoothstep(82.0, 18.0, dSwamp), 0, 1);
  const wAmazon     = clamp(smoothstep(92.0, 18.0, dAmazon), 0, 1);
  const wMangrove   = clamp(smoothstep(76.0, 16.0, dMangrove), 0, 1);
  const wClearing   = clamp(smoothstep(74.0, 16.0, dClearing), 0, 1);
  const wPlantation = clamp(smoothstep(78.0, 22.0, dPlantation), 0, 1);
  const wSavanna    = clamp(smoothstep(105.0, 26.0, dSavanna), 0, 1);
  const wBamboo     = clamp(smoothstep(86.0, 20.0, dBamboo), 0, 1);
  const wHighland   = clamp(smoothstep(88.0, 20.0, dHighland), 0, 1);
  const wBeach      = clamp(smoothstep(80.0, 16.0, dBeach), 0, 1);
  const wReef       = clamp(smoothstep(88.0, 20.0, dReef), 0, 1);
  const wAbyss      = clamp(smoothstep(96.0, 22.0, dAbyss), 0, 1);
  const wRookery    = clamp(smoothstep(84.0, 18.0, dRookery), 0, 1);
  const wPolar      = clamp(smoothstep(98.0, 24.0, dPolar) + wRookery * 0.75 + northPolarBand * 0.96 + southPolarBand * 0.92, 0, 1);
  const wFire       = clamp(smoothstep(82.0, 18.0, dFire), 0, 1);
  const wVolcano    = clamp(smoothstep(85.0, 22.0, dVolcano), 0, 1);
  const wCenote     = clamp(smoothstep(82.0, 18.0, dCenote), 0, 1);
  const wDune       = clamp(smoothstep(92.0, 24.0, dDune), 0, 1);

  // Multi-frequency organic hills, mountain ranges & river valleys across the entire globe
  const macro =
    sin(x * 0.015 + 0.3) * cos(z * 0.014 - 0.4) * 4.6 +
    sin((x * 0.6 + z * 0.8) * 0.022) * 2.9 +
    cos((x * 0.8 - z * 0.6) * 0.035) * 1.75;
  const meso =
    sin(x * 0.075 + cos(z * 0.062) * 1.5) *
    cos(z * 0.071 - sin(x * 0.058) * 1.5) *
    1.35;
  const micro =
    sin(x * 0.26 + z * 0.19) * 0.22 +
    cos(x * 0.43 - z * 0.37) * 0.14;

  // Base continental elevation with dramatic ridges in outer regions
  const outerRidge = max(0, sin(x * 0.028 + cos(z * 0.024) * 1.6) * cos(z * 0.031 - sin(x * 0.027) * 1.4)) * 5.2 *
    (1.0 - clamp(wRiver + wSwamp + wSavanna + wPlantation + wBeach + wReef + wAbyss, 0, 1));
  let landH = 1.65 + macro * 0.58 + meso * 0.68 + micro + outerRidge;

  // Carve submerged river lagoon channel, pond & outer tributary streams below water level
  const tribZ = -95.0 + sin(x * 0.024) * 32.0;
  const distTrib = abs(z - tribZ);
  const tribMask = smoothstep(14.0, 2.5, distTrib) * (1.0 - clamp(wPlantation + wDune + wCenote + wAmazon + wBamboo + northPolarBand, 0, 1)) * 0.65;
  const riverMask = clamp(smoothstep(22.0, 4.0, distRiver) * 0.85 + smoothstep(28.0, 4.0, distLagoon) * 0.95 + smoothstep(22.0, 4.0, distPond) * 0.9 + tribMask, 0, 1);
  const riverBedH = -1.35 - smoothstep(28.0, 2.0, distLagoon) * 0.85 - smoothstep(22.0, 2.0, distPond) * 0.65 + micro * 0.35;
  landH = lerp(landH - riverMask * 1.6, riverBedH, riverMask);

  // Low flooded Cypress Swamp & Mangrove Estuary
  const hummock = sin(x * 0.18) * cos(z * 0.19) * 0.65;
  landH = lerp(landH, -0.18 + hummock, wSwamp * 0.78);
  landH = lerp(landH, -0.12 + hummock * 0.8, wMangrove * 0.72);

  // Elevated Amazon Canopy, Bamboo Mountains & Virunga Ape Highlands
  landH += wAmazon * (3.2 + sin(x * 0.05) * 1.4);
  landH += wBamboo * (4.8 + cos(z * 0.05) * 1.8);
  landH += wHighland * (6.8 + sin(x * 0.06 + z * 0.04) * 2.2);

  // Stepped Heritage Plantation Terraces & Sunlit Clearing
  const terraceStep = floor((z + 200) * 0.14) * 0.65;
  landH = lerp(landH, 3.2 + terraceStep * 0.35, wPlantation * 0.55);
  landH = lerp(landH, 2.2 + micro, wClearing * 0.48);

  // Serengeti Savanna & Kopje granite outcrops
  const kopje = max(0, sin(x * 0.09) * cos(z * 0.09) - 0.55) * 8.5;
  landH = lerp(landH, 2.1 + kopje + micro, wSavanna * 0.65);

  // Obsidian Volcanic Caldera cone & lava channels at VOLCANO_POS (245, 38)
  const calderaCone = smoothstep(85.0, 22.0, dVolcano) * 14.5 - smoothstep(22.0, 6.0, dVolcano) * 10.5;
  const lavaAngle = atan2(wrapDelta(z, VOLCANO_POS[1]), wrapDelta(x, VOLCANO_POS[0]));
  const lavaChannel = smoothstep(85.0, 10.0, dVolcano) * max(0, sin(lavaAngle * 5.0 + dVolcano * 0.08));
  landH += calderaCone;

  // Bioluminescent Cenote karst sinkhole at FORGOTTEN_POS (-148, -125)
  const cenoteShape = smoothstep(68.0, 26.0, dCenote) * 5.2 - smoothstep(28.0, 8.0, dCenote) * 8.4;
  landH += cenoteShape;

  // Skeleton Coast Red Dunes at DUNE_POS (-235, -185)
  const duneWaves = wDune * (3.2 + abs(sin(x * 0.085 + sin(z * 0.04) * 2.0)) * 5.8);
  landH += duneWaves;

  // North Antarctica / Arctic Glacial Shelf & Ice Fjords (z < -220)
  if (northPolarBand > 0.01) {
    const fjordCarve = smoothstep(0.72, 0.95, sin(x * 0.045 + z * 0.02)) * 5.5;
    const iceShelfH = 4.8 + floor((sin(x * 0.05) * cos(z * 0.05) + 1.0) * 2.2) * 2.4 + abs(sin(x * 0.09)) * 3.5 - fjordCarve;
    landH = lerp(landH, iceShelfH, northPolarBand * 0.92);
  }

  // Southern Ocean Bathymetry (z > 158 opens into Beach -> Coral Reef Shelf -> Abyssal Garden Trench)
  const coastLineZ = 166.0 + sin(x * 0.025) * 10.0 + cos(x * 0.055) * 5.0;
  const seaSigned = z - coastLineZ; // < 0 on land, > 0 in ocean
  const oceanTransition = smoothstep(-18.0, 24.0, seaSigned);

  const reefShelfDepth = -3.8 - wReef * 1.6 + sin(x * 0.12) * cos(z * 0.12) * 0.85;
  const abyssTrenchDepth = -wAbyss * 9.5 + smoothstep(26.0, 4.0, dAbyss) * (abs(sin(x * 0.24) * cos(z * 0.24)) * 2.4);
  const archMask = smoothstep(42.0, 10.0, dAbyss) * smoothstep(0.35, 0.85, sin(x * 0.11) * cos(z * 0.11));
  const seaFloorH = -0.45 - oceanTransition * 2.4 + reefShelfDepth * oceanTransition + abyssTrenchDepth + micro * 1.2;

  let h = lerp(landH, seaFloorH, oceanTransition);

  // Sub-Antarctic Penguin Rookery Island (-215, 245), Polar Glacial Ice Shelf (215, 255) & Southern Antarctica Continent rise above the ocean
  const rookeryRise = smoothstep(72.0, 16.0, dRookery) * (6.4 + sin(x * 0.08) * 1.8);
  const polarIceRise = (smoothstep(86.0, 20.0, dPolar) + southPolarBand * 0.85) * (7.2 + floor((sin(x * 0.055) * cos(z * 0.055) + 1.0) * 1.8) * 2.6);
  h += rookeryRise + polarIceRise;

  const wetness = clamp(smoothstep(1.35, -0.45, h - WATER_LEVEL) + wSwamp * 0.45 + wRiver * 0.4, 0, 1);
  const moisture = clamp(wetness * 0.7 + wAmazon * 0.5 + wBamboo * 0.5, 0, 1);

  out.h = h;
  out.height = h;
  out.waterDepth = max(0, WATER_LEVEL - h);
  out.wetness = wetness;
  out.moisture = moisture;
  out.river = wRiver;
  out.swamp = wSwamp;
  out.amazon = wAmazon;
  out.canopy = wAmazon;
  out.mangrove = wMangrove;
  out.clearing = wClearing;
  out.plantation = wPlantation;
  out.savanna = wSavanna;
  out.bamboo = wBamboo;
  out.highland = wHighland;
  out.beach = wBeach;
  out.reef = wReef;
  out.coral = wReef;
  out.abyss = wAbyss;
  out.rookery = wRookery;
  out.polar = wPolar;
  out.fire = wFire;
  out.volcano = wVolcano;
  out.cenote = wCenote;
  out.dune = wDune;
  out.dunes = wDune;
  out.lava = clamp(lavaChannel * wVolcano, 0, 1);
  out.archMask = archMask;
  return out;
};

// Evaluate environmental hazard vector & severity at (x, z) for intelligent animal avoidance
// domain: 0 / 'land' = land/wading, 1 / 'water' = aquatic/marine, 2 / 'air' = aerial
export const evaluateHazardAt = (x, z, domain = 0, out = {}) => {
  const dom = domain === 'water' || domain === 1 ? 1 : domain === 'air' || domain === 2 ? 2 : 0;
  const t = terrainAt(x, z);
  const eps = 3.5;
  const tx = terrainAt(x + eps, z);
  const tz = terrainAt(x, z + eps);

  const dhdx = (tx.h - t.h) / eps;
  const dhdz = (tz.h - t.h) / eps;
  const slope = hypot(dhdx, dhdz);

  let hazardScore = 0;
  let pushX = 0;
  let pushZ = 0;
  let reason = 'safe';

  // 1. Wildfire hazard (Forbidden Zone I: Burning Forest)
  if (t.fire > 0.12) {
    const dfx = wrapDelta(x, FIRE_POS[0]);
    const dfz = wrapDelta(z, FIRE_POS[1]);
    const d = Math.max(1, hypot(dfx, dfz));
    const sev = t.fire * 2.4;
    hazardScore += sev;
    pushX += (dfx / d) * sev;
    pushZ += (dfz / d) * sev;
    reason = 'wildfire';
  }

  // 2. Molten lava & volcanic caldera hazard (Forbidden Zone II)
  if (t.volcano > 0.12 || t.lava > 0.05) {
    const dvx = wrapDelta(x, VOLCANO_POS[0]);
    const dvz = wrapDelta(z, VOLCANO_POS[1]);
    const d = Math.max(1, hypot(dvx, dvz));
    const sev = (t.volcano + (t.lava || 0) * 2.0) * 2.6;
    hazardScore += sev;
    pushX += (dvx / d) * sev;
    pushZ += (dvz / d) * sev;
    reason = 'lava';
  }

  // 3. Domain-specific water depth / stranding hazards
  if (dom === 0) {
    // Land animals avoid drowning in deep water
    if (t.h < WATER_LEVEL - 0.55) {
      const sev = clamp((WATER_LEVEL - 0.55 - t.h) * 1.8, 0, 3.5);
      hazardScore += sev;
      pushX += dhdx * 3.0;
      pushZ += dhdz * 3.0;
      if (reason === 'safe') reason = 'deep_water';
    }
    if (slope > 0.85) {
      const sev = (slope - 0.85) * 1.5;
      hazardScore += sev;
      pushX -= dhdx * 1.8;
      pushZ -= dhdz * 1.8;
      if (reason === 'safe') reason = 'cliff';
    }
  } else if (dom === 1) {
    // Strictly aquatic fauna avoid beaching on shallow land
    if (t.h > WATER_LEVEL - 0.45) {
      const sev = clamp((t.h - (WATER_LEVEL - 0.45)) * 2.5, 0, 4.0);
      hazardScore += sev;
      pushX -= dhdx * 3.5;
      pushZ -= dhdz * 3.5;
      reason = 'stranding';
    }
  }

  const pLen = hypot(pushX, pushZ);
  const normPushX = pLen > 1e-4 ? pushX / pLen : 0;
  const normPushZ = pLen > 1e-4 ? pushZ / pLen : 0;
  out.score = clamp(hazardScore, 0, 4.0);
  out.hazard = out.score;
  out.pushX = normPushX;
  out.pushZ = normPushZ;
  out.gradX = -normPushX;
  out.gradZ = -normPushZ;
  out.reason = reason;
  out.terrain = t;
  out.slope = slope;
  return out;
};

export const nearestBiomeAt = (x, z) => {
  const wx = wrapCoord(x);
  const wz = wrapCoord(z);
  let best = BIOME_CATALOG[0];
  let bestScore = Infinity;
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const d = hypot(wrapDelta(wx, b.center[0]), wrapDelta(wz, b.center[1])) / (b.radius || 75);
    if (d < bestScore) {
      bestScore = d;
      best = b;
    }
  }
  return best;
};

export const biomeLabelAt = (x, y, z) => {
  const layer = atmosphericLayerAt(y);
  if (y >= 2300) {
    const sec = spaceSectorAt(x, y, z);
    return `${layer.name} · ${sec.name}`;
  }
  const wx = wrapCoord(x);
  const wz = wrapCoord(z);
  let regionName = '';
  if (wz < -225) {
    regionName = 'Antarctica & Arctic North Ice Shelf';
  } else if (wz > 295 && abs(wx - ABYSS_POS[0]) > 65) {
    regionName = 'Antarctica Southern Glacial Continent';
  } else {
    const near = nearestBiomeAt(x, z);
    regionName = near ? near.name : 'The River Sanctuary';
  }
  if (y >= 160) {
    return `${layer.name} (${layer.equivKm.toFixed(0)} km) · Over ${regionName}`;
  }
  return regionName;
};
