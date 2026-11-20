// ============================================================================
// REALISM — Genuine Earth-Scale Planetary Geodesy (6,371 km Oblate Sphere),
// 6-Face Cube-Sphere Quadtree Terrain Streamer, Distinct Continents,
// 18 Distributed Global Biomes & Continuous Atmospheric Re-Entry State Machine
// ============================================================================
import {
  PI, TAU, DEG2RAD, RAD2DEG, EARTH_MEAN_R, EARTH_EQ_R, EARTH_POL_R,
  sin, cos, tan, abs, hypot, min, max, sqrt, floor, atan2, exp,
  clamp, saturate, lerp, smoothstep, normAngle,
  fbm3, ridged3, oblateRadiusAtSinLat, latLonToDir, dirToLatLon,
  geodeticToEcef, ecefToGeodetic, localENUFrame, moveAlongGeodesic,
  greatCircleDistanceMeters, cubeFaceUVToDir, dirToCubeFaceUV
} from './math.js';
import { sampleEarthGeoRef, upgradeEarthGeoAtlas, EARTH_GEO_ATTRIBUTION } from './earth_geo.js';
import { ECOREGION_CATALOG, classifyEcoregionAt, biogeographicRealmAt } from './ecoregions.js';

export { ECOREGION_CATALOG, classifyEcoregionAt, biogeographicRealmAt, upgradeEarthGeoAtlas, EARTH_GEO_ATTRIBUTION };
export const WATER_LEVEL = 0.0;

// Earth-Scale Planetary Constants (WGS-84 Oblate Spheroid & Geodesic Reference)
export const PLANET_RADIUS = EARTH_MEAN_R;               // 6,371,000 m (6,371 km)
export const PLANET_EQUATORIAL_RADIUS = EARTH_EQ_R;      // 6,378,137 m
export const PLANET_POLAR_RADIUS = EARTH_POL_R;          // 6,356,752 m
export const PLANET_CIRCUMFERENCE = 40075017;            // ~40,075.017 km equatorial
export const PLANET_SURFACE_KM2 = 510072000;             // ~510.072 million km^2
export const KARMAN_LINE_ALT = 100000;                   // 100 km Kármán line (meters)
export const OCEAN_COVERAGE = 0.71;                      // ~71% Ocean, ~29% Continental Land

// Real-Scale Vertical Atmospheric & Orbital Space Layers (ALL IN TRUE METERS)
export const ATMOSPHERE_LAYERS = [
  { id: 0, name: 'Abyssal & Pelagic Ocean', code: 'OCEAN',  minAlt: -12000,   maxAlt: -0.05,    realKm: '-11 – 0 km',        desc: 'Photic coral reefs, mesopelagic twilight & Abyssal Garden trenches' },
  { id: 1, name: 'Troposphere',             code: 'TROPO',  minAlt: -0.05,    maxAlt: 12000,    realKm: '0 – 12 km',         desc: 'Dense breathable air, cumulus clouds, active weather & terrestrial biosphere' },
  { id: 2, name: 'Stratosphere',            code: 'STRATO', minAlt: 12000,    maxAlt: 50000,    realKm: '12 – 50 km',        desc: 'Ozone layer, calm winds, deep cobalt sky & curved planetary horizon limb' },
  { id: 3, name: 'Mesosphere',              code: 'MESO',   minAlt: 50000,    maxAlt: 85000,    realKm: '50 – 85 km',        desc: 'Rarified upper air, meteor ablation zone & emerging celestial starfield' },
  { id: 4, name: 'Thermosphere',            code: 'THERMO', minAlt: 85000,    maxAlt: 600000,   realKm: '85 – 600 km',       desc: 'Kármán line (100 km), auroral oval & Low-Earth Orbit' },
  { id: 5, name: 'Exosphere',               code: 'EXO',    minAlt: 600000,   maxAlt: 10000000, realKm: '600 – 10,000 km',   desc: 'High orbital space, full 3D Earth globe & thin blue atmospheric limb' },
  { id: 6, name: 'Deep Universe',           code: 'COSMOS', minAlt: 10000000, maxAlt: 1e12,     realKm: '> 10,000 km',       desc: 'Interplanetary space, distant planets, star clusters & spiral galaxies' }
];

export const atmosphericDensityAt = (altMeters) => {
  if (altMeters <= 0) return 1.0;
  if (altMeters >= 600000) return 0.0;
  // Standard atmospheric scale height (~8,500 m) with upper thermosphere tail
  const lower = exp(-altMeters / 8500.0);
  const upper = exp(-altMeters / 28000.0) * 0.008;
  return clamp(lower + upper * smoothstep(20000, 120000, altMeters) * (1.0 - smoothstep(180000, 600000, altMeters)), 0, 1);
};

export const gravityAt = (altMeters) => {
  const r = PLANET_RADIUS + max(0, altMeters);
  const ratio = PLANET_RADIUS / r;
  return 9.80665 * ratio * ratio;
};

export const atmosphericLayerAt = (altMeters) => {
  const a = Number.isFinite(altMeters) ? altMeters : 0;
  for (let i = ATMOSPHERE_LAYERS.length - 1; i >= 0; i--) {
    if (a >= ATMOSPHERE_LAYERS[i].minAlt) {
      const layer = ATMOSPHERE_LAYERS[i];
      const span = max(1, layer.maxAlt - layer.minAlt);
      const t = clamp((a - layer.minAlt) / span, 0, 1);
      const equivKm = a / 1000.0;
      const spaceFactor = clamp((a - 18000) / (KARMAN_LINE_ALT - 18000), 0, 1);
      const density = atmosphericDensityAt(a);
      return { ...layer, progress: t, equivKm, altKm: equivKm, spaceFactor, density };
    }
  }
  return { ...ATMOSPHERE_LAYERS[0], progress: 0, equivKm: a / 1000.0, altKm: a / 1000.0, spaceFactor: 0, density: 1.0 };
};

export const reentryStageAt = (altMeters, groundH = 0, velU = 0) => {
  const agl = altMeters - max(WATER_LEVEL, groundH);
  if (altMeters >= 600000) return 'EXOSPHERE';
  if (altMeters >= 100000) return 'ORBITAL_THERMOSPHERE';
  if (altMeters >= 85000) return 'THERMOSPHERE';
  if (altMeters >= 50000) return 'MESOSPHERE';
  if (altMeters >= 12000) return 'STRATOSPHERE';
  if (altMeters >= 4500) return 'TROPOSPHERE';
  if (altMeters >= 1400) return 'CLOUD_APPROACH';
  if (agl >= 140) return 'REGIONAL_FLIGHT';
  if (agl >= 12) return 'NEAR_SURFACE';
  return velU < -0.5 ? 'LANDING_TOUCHDOWN' : 'GROUND_SURFACE';
};

// ============================================================================
// 7 Distinct Major Tectonic Continents & Polar Realms (~29% Land / ~71% Ocean)
// Each continent is defined by multiple elliptical/lobe plates on the 3D unit sphere
// so outlines are coherent, recognizable, and completely free of periodic grids.
// ============================================================================
const CONTINENT_PLATES = [
  // 0: Amazonia-Verdea (South-West Equatorial Continent — Amazon, Rivers, Andes, Mangroves, Cenote)
  { id: 0, name: 'Amazonia-Verdea', lat: -6.0,  lon: -62.0, rx: 0.42, ry: 0.46, peak: 1.05, ridge: 0.65, ridgeLon: -74.0 },
  { id: 0, name: 'Amazonia-Verdea', lat: -22.0, lon: -64.0, rx: 0.28, ry: 0.36, peak: 0.92, ridge: 0.72, ridgeLon: -70.0 },
  { id: 0, name: 'Amazonia-Verdea', lat: 14.0,  lon: -84.0, rx: 0.24, ry: 0.22, peak: 0.78, ridge: 0.35, ridgeLon: -88.0 },
  // 1: Borealia & Subtropica (Northern Western Continent — Cypress Swamp, Clearings, Wildfire Ridges)
  { id: 1, name: 'Borealia',        lat: 44.0,  lon: -102.0, rx: 0.48, ry: 0.42, peak: 1.02, ridge: 0.78, ridgeLon: -116.0 },
  { id: 1, name: 'Borealia',        lat: 30.0,  lon: -88.0,  rx: 0.28, ry: 0.24, peak: 0.72, ridge: 0.20, ridgeLon: -84.0 },
  { id: 1, name: 'Borealia',        lat: 62.0,  lon: -114.0, rx: 0.42, ry: 0.28, peak: 0.85, ridge: 0.45, ridgeLon: -128.0 },
  // 2: Afro-Serengeti (Central-Eastern Continent — Savanna, Virunga Highlands, Skeleton Coast Dunes)
  { id: 2, name: 'Afro-Serengeti',  lat: 8.0,   lon: 18.0,  rx: 0.52, ry: 0.44, peak: 1.04, ridge: 0.48, ridgeLon: 32.0 },
  { id: 2, name: 'Afro-Serengeti',  lat: -14.0, lon: 24.0,  rx: 0.36, ry: 0.42, peak: 0.98, ridge: 0.62, ridgeLon: 29.5 },
  // 3: Indus-Monsoonia (Eurasian-Eastern Monsoon Continent — Plantations, Bamboo Jungle, Himalayas, Ring-of-Fire)
  { id: 3, name: 'Indus-Monsoonia', lat: 46.0,  lon: 82.0,  rx: 0.62, ry: 0.42, peak: 1.12, ridge: 0.95, ridgeLon: 86.0 },
  { id: 3, name: 'Indus-Monsoonia', lat: 24.0,  lon: 106.0, rx: 0.42, ry: 0.34, peak: 0.96, ridge: 0.75, ridgeLon: 102.0 },
  { id: 3, name: 'Indus-Monsoonia', lat: 52.0,  lon: 24.0,  rx: 0.34, ry: 0.26, peak: 0.82, ridge: 0.40, ridgeLon: 12.0 },
  { id: 3, name: 'Indus-Monsoonia', lat: 35.2,  lon: 138.7, rx: 0.14, ry: 0.16, peak: 0.88, ridge: 0.85, ridgeLon: 138.7 }, // Volcanic Island Arc
  // 4: Australis & Indo-Pacific Archipelago (Outback, Tropical Atolls, Coral Barrier Shelf)
  { id: 4, name: 'Australis',       lat: -24.0, lon: 134.0, rx: 0.36, ry: 0.28, peak: 0.88, ridge: 0.35, ridgeLon: 146.0 },
  { id: 4, name: 'Australis',       lat: -16.8, lon: 146.2, rx: 0.10, ry: 0.10, peak: 0.68, ridge: 0.20, ridgeLon: 146.2 }, // Tropical Atoll Coast
  // 5: Antarctica (Southern Polar Continent)
  { id: 5, name: 'Antarctica',      lat: -82.0, lon: 40.0,  rx: 0.56, ry: 0.46, peak: 1.06, ridge: 0.62, ridgeLon: 165.0 },
  { id: 5, name: 'Antarctica',      lat: -74.0, lon: -65.0, rx: 0.28, ry: 0.24, peak: 0.86, ridge: 0.58, ridgeLon: -63.0 },
  // 6: Arctic Glacial Archipelago (High Northern Polar Shelf & Greenland-like Ice Cap)
  { id: 6, name: 'Arctic Shelf',    lat: 74.0,  lon: -42.0, rx: 0.28, ry: 0.24, peak: 0.92, ridge: 0.50, ridgeLon: -40.0 }
];

// Precompute 3D unit vectors for each tectonic plate
const PLATES = CONTINENT_PLATES.map((p) => {
  const dir = latLonToDir(p.lat * DEG2RAD, p.lon * DEG2RAD);
  return { ...p, nx: dir[0], ny: dir[1], nz: dir[2] };
});

// ============================================================================
// 18 Curated Planetary Biome Destinations — Distributed Across Genuine Continents
// & Oceans (Thousands of Kilometres Apart)
// ============================================================================
export const BIOME_CATALOG = [
  {
    id: 0, key: 'river', name: 'The River Sanctuary',
    subtitle: 'Emerald Floodplain, Otter Lagoon & Heron Shallows',
    category: 'Wetlands & Rivers', continent: 'Amazonia-Verdea', region: 'Amazonia Central Basin',
    forbidden: false, latDeg: -3.20, lonDeg: -60.00, basinRadiusKm: 42,
    elev: '-2.2m to +12m', weather: 'Golden Sunlight',
    species: 'Giant River Otter, Manatee, Alligator, Kingfisher'
  },
  {
    id: 1, key: 'swamp', name: 'The Cypress Swamp',
    subtitle: 'Buttressed Knees, Duckweed Bayous & Spanish Moss',
    category: 'Wetlands & Rivers', continent: 'Borealia', region: 'Subtropical Bayou Delta',
    forbidden: false, latDeg: 29.50, lonDeg: -89.50, basinRadiusKm: 48,
    elev: '-1.0m to +6m', weather: 'Swamp Morning Mist',
    species: 'American Alligator, Green Anaconda, Great White Egret, Florida Panther'
  },
  {
    id: 2, key: 'canopy', name: 'The Amazon Emerald Canopy',
    subtitle: 'Layered Kapok Crowns, Lianas & Macaw Thermals',
    category: 'Rainforests', continent: 'Amazonia-Verdea', region: 'Western Amazon Rainforest',
    forbidden: false, latDeg: -5.80, lonDeg: -64.50, basinRadiusKm: 65,
    elev: '+18m to +240m', weather: 'Golden Sunlight',
    species: 'Scarlet Macaw, Toco Toucan, Spider Monkey, Three-Toed Sloth, Tapir'
  },
  {
    id: 3, key: 'mangrove', name: 'The Mangrove Passage',
    subtitle: 'Intertidal Stilt Roots, Brackish Channels & Caimans',
    category: 'Wetlands & Rivers', continent: 'Amazonia-Verdea', region: 'Equatorial Atlantic Estuary',
    forbidden: false, latDeg: 0.80, lonDeg: -49.50, basinRadiusKm: 44,
    elev: '-1.2m to +5m', weather: 'Golden Sunlight',
    species: 'Black Caiman, Mangrove Raccoon, Green Iguana, Roseate Spoonbill'
  },
  {
    id: 4, key: 'clearing', name: 'The Sunlit Wildlife Clearing',
    subtitle: 'Wildflower Meadows, Clover & Grazing Deer Herds',
    category: 'Grasslands & Terraces', continent: 'Borealia', region: 'Temperate Highland Meadow',
    forbidden: false, latDeg: 41.20, lonDeg: -105.50, basinRadiusKm: 52,
    elev: '+120m to +480m', weather: 'Golden Sunlight',
    species: 'White-Tailed Deer, Black Bear, Blue Morpho Butterfly'
  },
  {
    id: 5, key: 'plantation', name: 'Overgrown Heritage Plantations',
    subtitle: 'Wild-Reclaimed Banana, Cacao & Bamboo Terraces',
    category: 'Grasslands & Terraces', continent: 'Indus-Monsoonia', region: 'Indochina River Terraces',
    forbidden: false, latDeg: 14.50, lonDeg: 101.20, basinRadiusKm: 50,
    elev: '+45m to +260m', weather: 'Golden Sunlight',
    species: 'Wild Chimpanzee, Toco Toucan, Hercules Beetle'
  },
  {
    id: 6, key: 'savanna', name: 'The Serengeti Savanna & Kopjes',
    subtitle: 'Golden Grasslands, Umbrella Acacias & Lion Prides',
    category: 'Grasslands & Terraces', continent: 'Afro-Serengeti', region: 'East African Rift Plains',
    forbidden: false, latDeg: -2.40, lonDeg: 34.80, basinRadiusKm: 75,
    elev: '+85m to +420m', weather: 'Savanna Heat Haze & Dust Devils',
    species: 'African Lion, African Bush Elephant, Reticulated Giraffe, Plains Zebra'
  },
  {
    id: 7, key: 'bamboo', name: 'The Misty Bamboo & Monsoon Jungle',
    subtitle: 'Giant Culm Grottos, Bengal Tigers & Monsoon Mist',
    category: 'Rainforests', continent: 'Indus-Monsoonia', region: 'Sichuan-Monsoon Highlands',
    forbidden: false, latDeg: 27.80, lonDeg: 104.50, basinRadiusKm: 62,
    elev: '+180m to +980m', weather: 'Tropical Monsoon Storm',
    species: 'Bengal Tiger, Crowned Harpy Eagle, Pileated Woodpecker'
  },
  {
    id: 8, key: 'ape_highlands', name: 'The Virunga Ape Highlands',
    subtitle: 'Cloud-Forest Ridges, Silverback Gorillas & Chimpanzees',
    category: 'Rainforests', continent: 'Afro-Serengeti', region: 'Virunga Volcanic Rift',
    forbidden: false, latDeg: -1.40, lonDeg: 29.50, basinRadiusKm: 58,
    elev: '+450m to +1850m', weather: 'Swamp Morning Mist',
    species: 'Silverback Mountain Gorilla, Wild Chimpanzee, Harpy Eagle'
  },
  {
    id: 9, key: 'beach', name: 'The Golden Tropical Beach & Atoll',
    subtitle: 'Coconut Palms, Wet Swash Zone & Shorebreak Surf',
    category: 'Coast & Ocean', continent: 'Australis', region: 'Coral Sea Barrier Atoll',
    forbidden: false, latDeg: -16.80, lonDeg: 146.20, basinRadiusKm: 34,
    elev: '-2m to +12m', weather: 'Coastal Shorebreak Surf',
    species: 'Caribbean Flamingo, Green Sea Turtle, Coconut Crab'
  },
  {
    id: 10, key: 'coral_reef', name: 'The Sunlit Coral Reef & Kelp Basin',
    subtitle: 'Caustic Shallows, Giant Kelp Forests & Reef Schools',
    category: 'Coast & Ocean', continent: 'Pacific Ocean', region: 'Outer Barrier Reef Shelf',
    forbidden: false, latDeg: -17.20, lonDeg: 146.85, basinRadiusKm: 36,
    elev: '-12m to -2.5m', weather: 'Coastal Shorebreak Surf',
    species: 'Oceanic Manta Ray, Great White Shark, Green Sea Turtle, Reef Fish Schools'
  },
  {
    id: 11, key: 'abyssal_garden', name: 'The Abyssal Garden & Hydrothermal Trench',
    subtitle: 'Sunken Galleon, Bioluminescent Plumes & Whale Pods',
    category: 'Coast & Ocean', continent: 'Pacific Ocean', region: 'Coral Sea Deep Trench',
    forbidden: false, latDeg: -18.50, lonDeg: 149.20, basinRadiusKm: 55,
    elev: '-45m to -12m (Trench to -6500m)', weather: 'Coastal Shorebreak Surf',
    species: 'Humpback Whale, Orca, Great White Shark, Oceanic Manta Ray'
  },
  {
    id: 12, key: 'sub_antarctic', name: 'The Sub-Antarctic Penguin Rookery',
    subtitle: 'Basalt Headlands, Tussock Grass & Diving Penguins',
    category: 'Polar Realm', continent: 'Antarctica', region: 'Antarctic Peninsula Coast',
    forbidden: false, latDeg: -64.80, lonDeg: -62.50, basinRadiusKm: 52,
    elev: '-4m to +180m', weather: 'Polar Blizzard',
    species: 'Emperor Penguin, Leopard Seal, Orca'
  },
  {
    id: 13, key: 'ice_planet', name: 'The Polar Ice Planet & Glacial Shelf',
    subtitle: 'Tabular Icebergs, Sea-Ice Leads, Polar Bears & Aurora',
    category: 'Polar Realm', continent: 'Antarctica', region: 'Ross Glacial Ice Shelf',
    forbidden: false, latDeg: -76.50, lonDeg: 165.00, basinRadiusKm: 75,
    elev: '-6m to +320m', weather: 'Polar Night & Aurora',
    species: 'Polar Bear, Emperor Penguin, Leopard Seal, Humpback Whale'
  },
  {
    id: 14, key: 'burning_forest', name: 'Forbidden Zone I: The Burning Forest',
    subtitle: 'Lightning Wildfire Front, Glowing Embers & Ash Plumes',
    category: 'Forbidden Zones', continent: 'Borealia', region: 'Sierra Wildfire Ridge',
    forbidden: true, latDeg: 38.80, lonDeg: -120.40, basinRadiusKm: 42,
    elev: '+180m to +720m', weather: 'Volcanic Ash & Wildfire',
    species: 'Fleeing Wildlife & Fire-Adapted Raptors'
  },
  {
    id: 15, key: 'volcanic_caldera', name: 'Forbidden Zone II: Obsidian Volcanic Caldera',
    subtitle: 'Molten Pahoehoe Lava Rivers, Basalt Columns & Steam Vents',
    category: 'Forbidden Zones', continent: 'Indus-Monsoonia', region: 'Pacific Ring-of-Fire Caldera',
    forbidden: true, latDeg: 35.20, lonDeg: 138.70, basinRadiusKm: 42,
    elev: '+240m to +1950m', weather: 'Volcanic Ash & Wildfire',
    species: 'Thermophilic Vents & Circling Eagles'
  },
  {
    id: 16, key: 'cenote_cavern', name: 'Forbidden Zone III: Bioluminescent Cenote',
    subtitle: 'Collapsed Karst Sinkhole, Turquoise Pool & Glow Spores',
    category: 'Forbidden Zones', continent: 'Amazonia-Verdea', region: 'Yucatán Karst Peninsula',
    forbidden: true, latDeg: 19.50, lonDeg: -88.20, basinRadiusKm: 36,
    elev: '-8m to +48m', weather: 'Swamp Morning Mist',
    species: 'Amazonian Jaguar, Spectacled Owl, Bioluminescent Mycena'
  },
  {
    id: 17, key: 'skeleton_coast', name: 'Forbidden Zone IV: The Skeleton Coast & Red Dunes',
    subtitle: 'Towering Iron-Oxide Dunes, Desert Lions & Surf Fog',
    category: 'Forbidden Zones', continent: 'Afro-Serengeti', region: 'Namib Red Dune Coast',
    forbidden: true, latDeg: -22.50, lonDeg: 14.40, basinRadiusKm: 56,
    elev: '+4m to +280m', weather: 'Savanna Heat Haze & Dust Devils',
    species: 'Desert-Adapted Lion, Desert Elephant'
  }
];

// Enrich each biome with precomputed 3D unit vector & local ENU basis
for (const b of BIOME_CATALOG) {
  b.latRad = b.latDeg * DEG2RAD;
  b.lonRad = b.lonDeg * DEG2RAD;
  b.dir = latLonToDir(b.latRad, b.lonRad);
  b.enu = localENUFrame(b.latRad, b.lonRad);
  b.basinRad = (b.basinRadiusKm * 1000) / PLANET_RADIUS;
  b.pos = [0, 0]; // Local origin within the biome's own regional tangent frame
  b.center = [0, 0];
}

export const BIOMES = BIOME_CATALOG;

// Local anchor coordinates within each biome's regional tangent frame (meters around biome center)
export const LAGOON_POS     = [0, 0];
export const POND_POS       = [-35, -30];
export const CYPRESS_POS    = [0, 0];
export const AMAZON_POS     = [0, 0];
export const MANGROVE_POS   = [0, 0];
export const CLEARING_POS   = [0, 0];
export const PLANTATION_POS = [0, 0];
export const SAVANNA_POS    = [0, 0];
export const BAMBOO_POS     = [0, 0];
export const HIGHLAND_POS   = [0, 0];
export const BEACH_POS      = [0, 0];
export const REEF_POS       = [0, 0];
export const ABYSS_POS      = [0, 0];
export const ROOKERY_POS    = [0, 0];
export const POLAR_POS      = [0, 0];
export const FIRE_POS       = [0, 0];
export const VOLCANO_POS    = [0, 0];
export const FORGOTTEN_POS  = [0, 0];
export const DUNE_POS       = [0, 0];

// Active Floating-Origin Regional Tangent Anchor (defaults to River Sanctuary)
let _activeOrigin = {
  latDeg: BIOME_CATALOG[0].latDeg,
  lonDeg: BIOME_CATALOG[0].lonDeg,
  latRad: BIOME_CATALOG[0].latRad,
  lonRad: BIOME_CATALOG[0].lonRad,
  enu: localENUFrame(BIOME_CATALOG[0].latRad, BIOME_CATALOG[0].lonRad),
  biomeId: 0
};

export const setActiveOrigin = (latDeg, lonDeg, biomeId = -1) => {
  const lat = clamp(latDeg, -89.999, 89.999);
  const lon = normAngle(lonDeg * DEG2RAD) * RAD2DEG;
  const latRad = lat * DEG2RAD;
  const lonRad = lon * DEG2RAD;
  _activeOrigin = {
    latDeg: lat,
    lonDeg: lon,
    latRad,
    lonRad,
    enu: localENUFrame(latRad, lonRad),
    biomeId: biomeId >= 0 ? biomeId : nearestBiomeAtGeo(lat, lon).biome.id
  };
  return _activeOrigin;
};

export const getActiveOrigin = () => _activeOrigin;

// Convert local tangent meters (dx = East, dz = South) around an origin onto the 3D unit sphere
export const localMetersToDir = (dxMeters, dzMeters, origin = _activeOrigin, out = [0, 0, 1]) => {
  const o = origin || _activeOrigin;
  const R = oblateRadiusAtSinLat(sin(o.latRad));
  const rx = dxMeters / R;
  const rz = dzMeters / R;
  const e = o.enu.east;
  const u = o.enu.up;
  const s = o.enu.south;
  // Exact exponential map on sphere for small/large tangent offsets
  const ang = hypot(rx, rz);
  if (ang < 1e-11) {
    out[0] = u[0]; out[1] = u[1]; out[2] = u[2];
    return out;
  }
  const ca = cos(ang), sa = sin(ang) / ang;
  const x = u[0] * ca + (e[0] * rx + s[0] * rz) * sa;
  const y = u[1] * ca + (e[1] * rx + s[1] * rz) * sa;
  const z = u[2] * ca + (e[2] * rx + s[2] * rz) * sa;
  const l = hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
};

export const localMetersToLatLon = (dxMeters, dzMeters, origin = _activeOrigin, out = {}) => {
  const dir = localMetersToDir(dxMeters, dzMeters, origin);
  return dirToLatLon(dir[0], dir[1], dir[2], out);
};

// Convert any planetary (latDeg, lonDeg) into local tangent meters relative to `origin`
export const latLonToLocalMeters = (latDeg, lonDeg, origin = _activeOrigin, out = {}) => {
  const o = origin || _activeOrigin;
  const dir = latLonToDir(latDeg * DEG2RAD, lonDeg * DEG2RAD);
  const R = oblateRadiusAtSinLat(sin(o.latRad));
  const dDot = clamp(dir[0] * o.enu.up[0] + dir[1] * o.enu.up[1] + dir[2] * o.enu.up[2], -1, 1);
  const ang = Math.acos(dDot);
  const de = dir[0] * o.enu.east[0] + dir[1] * o.enu.east[1] + dir[2] * o.enu.east[2];
  const ds = dir[0] * o.enu.south[0] + dir[1] * o.enu.south[1] + dir[2] * o.enu.south[2];
  const sinA = hypot(de, ds);
  const scale = sinA > 1e-10 ? (ang * R) / sinA : R;
  out.x = de * scale;
  out.z = ds * scale;
  out.distMeters = ang * R;
  return out;
};

// ============================================================================
// ONE UNIFIED PLANETARY ELEVATION, CLIMATE, CONTINENT & BIOME EVALUATOR
// Used identically by:
//   1. Distant 3D Globe & Orbital Cube-Sphere Tiles
//   2. High-Altitude Atmospheric View
//   3. Regional & Near-Surface Terrain Tiles
//   4. Physics, Wildlife & Collision Queries (terrainAt)
//   5. 3D Globe & 2D Topographic Navigator Map
// ============================================================================
const _geoTmp = { elevM: 0, landFrac: 0, lakeFrac: 0, riverFrac: 0, glacierFrac: 0, shelfFrac: 0, aridity: 0 };

export const samplePlanetAtDir = (nx, ny, nz, out = {}, detailLevel = 2) => {
  const l = hypot(nx, ny, nz) || 1;
  const ux = nx / l, uy = clamp(ny / l, -1, 1), uz = nz / l;
  const absLat = abs(uy); // sin(|lat|) in [0, 1]
  const latDeg = Math.asin(uy) * RAD2DEG;
  const lonDeg = atan2(ux, uz) * RAD2DEG;

  // 1. Real Earth Geography (Natural Earth 110m Physical Vectors + GEBCO/SRTM Reference)
  sampleEarthGeoRef(latDeg, lonDeg, _geoTmp);
  const geoLand = _geoTmp.landFrac;
  const geoElev = _geoTmp.elevM;
  const geoLake = _geoTmp.lakeFrac;
  const geoRiver = _geoTmp.riverFrac;
  const geoGlacier = _geoTmp.glacierFrac;
  const geoShelf = _geoTmp.shelfFrac;
  const geoAridity = _geoTmp.aridity;

  // Multi-scale 3D spherical fractal detail layered onto real Earth outlines (zero seams or grid tiling)
  const coastFractal = (fbm3(ux * 14.0 + 11.1, uy * 14.0 - 7.3, uz * 14.0 + 3.7, 3) - 0.5) * 0.22;
  const mtRidges = ridged3(ux * 12.5 + 2.3, uy * 12.5 - 5.1, uz * 12.5 + 8.9, 4);
  const macroHills = fbm3(ux * 22.0 - 4.2, uy * 22.0 + 9.1, uz * 22.0 - 2.6, 4);

  // Coastline mask combining real Natural Earth polygons with organic sub-degree shoreline indentation
  const landSigned = (geoLand - 0.48) + coastFractal * smoothstep(0.0, 0.45, 0.5 - abs(geoLand - 0.5));
  const isLand = smoothstep(-0.08, 0.08, landSigned);

  // Continental ID derived from real Earth continental bounds (for legacy queries)
  let continentId = -1;
  if (isLand > 0.35) {
    if (latDeg < -58) continentId = 5;
    else if (latDeg > 66 && lonDeg > -75 && lonDeg < -10) continentId = 6;
    else if (lonDeg < -30) continentId = latDeg > 13 ? 1 : 0;
    else if (lonDeg >= -20 && lonDeg <= 55 && latDeg < 36) continentId = 2;
    else if (lonDeg >= 108 && latDeg < -8) continentId = 4;
    else continentId = 3;
  }

  // Real continental elevation enhanced with alpine mountain ridges, foothills, lakes & major rivers
  const mountainWeight = smoothstep(450.0, 3200.0, geoElev);
  let landElev = max(2.0, geoElev) + (macroHills - 0.45) * lerp(95.0, 420.0, mountainWeight);
  landElev += mountainWeight * mtRidges * 1350.0;

  // Major rivers & inland lakes carved smoothly into terrain
  const riverField = abs(fbm3(ux * 16.0 + 19.4, uy * 16.0 - 12.1, uz * 16.0 + 7.8, 3) - 0.5);
  const majorRiver = clamp(geoRiver * 0.85 + smoothstep(0.018, 0.003, riverField) * smoothstep(0.12, 0.45, geoLand) * (1.0 - mountainWeight) * 0.45, 0, 1);
  if (majorRiver > 0.05) {
    landElev = lerp(landElev, max(1.2, landElev * 0.32 - 3.5), majorRiver * 0.65);
  }
  if (geoLake > 0.25) {
    landElev = lerp(landElev, -6.5 - geoLake * 14.0, smoothstep(0.25, 0.72, geoLake));
  }

  // Oceanic bathymetry (continental shelves -> abyssal plains -> ocean trenches)
  const shelf = clamp(geoShelf + smoothstep(-0.18, -0.01, landSigned) * 0.45, 0, 1);
  const seaFloor = min(-1.5, geoElev) + (macroHills - 0.5) * lerp(580.0, 18.0, shelf);
  let h = lerp(seaFloor, landElev, isLand);

  // Fine regional & meter-scale micro-relief (evaluated continuously on the unit sphere!)
  let microRelief = 0;
  if (detailLevel >= 1) {
    const kmNoise = fbm3(ux * 1050.0, uy * 1050.0, uz * 1050.0, 3) - 0.5;
    microRelief += kmNoise * (isLand > 0.5 ? lerp(18.0, 48.0, mountainWeight) : 10.0);
  }
  if (detailLevel >= 2) {
    const hectoNoise = fbm3(ux * 28000.0, uy * 28000.0, uz * 28000.0, 3) - 0.5;
    const decaNoise = fbm3(ux * 180000.0, uy * 180000.0, uz * 180000.0, 2) - 0.5;
    microRelief += hectoNoise * 3.4 + decaNoise * 0.55;
  }
  h += microRelief;

  // 3. Global Climate Model (Latitude, Elevation, Real Aridity Belt, Moisture & Glaciers)
  const moistureNoise = fbm3(ux * 3.8 - 7.1, uy * 3.8 + 13.4, uz * 3.8 + 5.2, 4);
  const equatWet = smoothstep(0.55, 0.04, absLat);
  const subTropDry = smoothstep(0.18, 0.36, absLat) * smoothstep(0.62, 0.36, absLat);
  const tempBaseC = lerp(29.5, -26.5, powAbs(absLat, 1.30)) - max(0, h) * 0.0065 - geoGlacier * 8.0;
  const rainfall = clamp(0.48 + equatWet * 0.40 - subTropDry * 0.30 - geoAridity * 0.48 + (moistureNoise - 0.5) * 0.44 + majorRiver * 0.22 + geoLake * 0.18, 0, 1);
  const aridity = clamp(max(geoAridity * 0.92, (1.0 - rainfall) * smoothstep(6.0, 24.0, tempBaseC)), 0, 1);

  // 4. Blend the 18 Curated Planetary Destinations seamlessly into their real continents/oceans
  let wRiver = 0, wSwamp = 0, wAmazon = 0, wMangrove = 0, wClearing = 0, wPlantation = 0;
  let wSavanna = 0, wBamboo = 0, wHighland = 0, wBeach = 0, wReef = 0, wAbyss = 0;
  let wRookery = 0, wPolar = 0, wFire = 0, wVolcano = 0, wCenote = 0, wDune = 0;
  let lava = 0, archMask = 0;
  let nearestId = -1;
  let nearestAng = Infinity;

  // Polar & glacial climate baseline (Antarctica, Greenland, Arctic & high alpine snowlines)
  const polarClimate = max(smoothstep(0.85, 0.95, absLat), geoGlacier * 0.95);
  if (polarClimate > 0.01) {
    wPolar = max(wPolar, polarClimate * (isLand > 0.3 ? 1.0 : 0.55));
  }

  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const dot = clamp(ux * b.dir[0] + uy * b.dir[1] + uz * b.dir[2], -1, 1);
    const ang = Math.acos(dot);
    if (ang < nearestAng) {
      nearestAng = ang;
      nearestId = b.id;
    }
    const maxInflu = b.basinRad * 2.2;
    if (ang > maxInflu) continue;

    // Smooth regional weight (broad 40–100 km ecological basin) and local landmark weight (1.0 within 140m, smooth out to 560m)
    const wReg = smoothstep(maxInflu, b.basinRad * 0.25, ang);
    const distM = ang * PLANET_RADIUS;
    const wLocal = smoothstep(560.0, 140.0, distM);

    // Local tangent coordinates (lx East, lz South in meters) relative to biome center
    let lx = 0, lz = 0;
    if (distM < 2500.0) {
      const de = ux * b.enu.east[0] + uy * b.enu.east[1] + uz * b.enu.east[2];
      const ds = ux * b.enu.south[0] + uy * b.enu.south[1] + uz * b.enu.south[2];
      lx = de * PLANET_RADIUS;
      lz = ds * PLANET_RADIUS;
    }

    switch (b.id) {
      case 0: { // The River Sanctuary (Amazonia floodplain & meandering river lagoon)
        wRiver = max(wRiver, wReg);
        h = lerp(h, clamp(h, -1.8, 36.0), wReg * 0.65);
        if (wLocal > 0.001) {
          const riverCenterZ = sin(lx * 0.022) * 18.0;
          const distRiver = abs(lz - riverCenterZ);
          const distLagoon = hypot(lx, lz);
          const distPond = hypot(lx + 35, lz + 30);
          const rMask = clamp(smoothstep(22, 4, distRiver) * 0.85 + smoothstep(28, 4, distLagoon) * 0.95 + smoothstep(20, 4, distPond) * 0.88, 0, 1);
          const bankH = 1.9 + sin(lx * 0.04) * cos(lz * 0.04) * 1.1 + microRelief * 0.15;
          const bedH = -1.45 - smoothstep(26, 2, distLagoon) * 0.95;
          h = lerp(h, lerp(bankH, bedH, rMask), wLocal);
        }
        break;
      }
      case 1: { // The Cypress Swamp
        wSwamp = max(wSwamp, wReg);
        h = lerp(h, clamp(h, -1.2, 8.0), wReg * 0.72);
        if (wLocal > 0.001) {
          const hummock = sin(lx * 0.14) * cos(lz * 0.15) * 0.72 + microRelief * 0.15;
          h = lerp(h, -0.15 + hummock, wLocal);
        }
        break;
      }
      case 2: { // Amazon Emerald Canopy
        wAmazon = max(wAmazon, wReg);
        if (wLocal > 0.001) {
          const canopyH = 5.2 + sin(lx * 0.045) * 2.2 + cos(lz * 0.04) * 1.8 + microRelief * 0.25;
          h = lerp(h, canopyH, wLocal);
        }
        break;
      }
      case 3: { // Mangrove Passage
        wMangrove = max(wMangrove, wReg);
        h = lerp(h, clamp(h, -1.8, 6.0), wReg * 0.72);
        if (wLocal > 0.001) {
          const channel = sin(lx * 0.055 + cos(lz * 0.04) * 1.4);
          const mH = -0.22 + channel * 0.95 + microRelief * 0.12;
          h = lerp(h, mH, wLocal);
        }
        break;
      }
      case 4: { // Sunlit Wildlife Clearing
        wClearing = max(wClearing, wReg);
        if (wLocal > 0.001) {
          const meadowH = 2.8 + sin(lx * 0.03) * cos(lz * 0.03) * 1.4 + microRelief * 0.18;
          h = lerp(h, meadowH, wLocal);
        }
        break;
      }
      case 5: { // Overgrown Heritage Plantations
        wPlantation = max(wPlantation, wReg);
        if (wLocal > 0.001) {
          const terrace = floor((lz + 180) * 0.12) * 0.65;
          h = lerp(h, 3.6 + terrace * 0.45 + microRelief * 0.12, wLocal);
        }
        break;
      }
      case 6: { // Serengeti Savanna & Kopjes
        wSavanna = max(wSavanna, wReg);
        if (wLocal > 0.001) {
          const kopje = max(0, sin(lx * 0.065) * cos(lz * 0.065) - 0.52) * 11.5;
          h = lerp(h, 2.4 + kopje + microRelief * 0.16, wLocal);
        }
        break;
      }
      case 7: { // Misty Bamboo & Monsoon Jungle
        wBamboo = max(wBamboo, wReg);
        if (wLocal > 0.001) {
          h = lerp(h, 6.2 + sin(lx * 0.045) * 2.8 + cos(lz * 0.05) * 2.4 + microRelief * 0.2, wLocal);
        }
        break;
      }
      case 8: { // Virunga Ape Highlands
        wHighland = max(wHighland, wReg);
        if (wLocal > 0.001) {
          h = lerp(h, 9.5 + sin(lx * 0.05 + lz * 0.04) * 4.2 + microRelief * 0.25, wLocal);
        }
        break;
      }
      case 9: { // Golden Tropical Beach & Atoll
        wBeach = max(wBeach, wReg);
        h = lerp(h, clamp(h, -8.0, 12.0), wReg * 0.72);
        if (wLocal > 0.001) {
          const coast = sin(lx * 0.028) * 9.0;
          const seaSig = lz - coast;
          const beachH = lerp(2.6 + sin(lx * 0.06) * 0.6, -2.8, smoothstep(-24, 28, seaSig));
          h = lerp(h, beachH + microRelief * 0.1, wLocal);
        }
        break;
      }
      case 10: { // Sunlit Coral Reef & Kelp Basin
        wReef = max(wReef, wReg);
        h = lerp(h, min(h, -8.5), wReg * 0.85);
        if (wLocal > 0.001) {
          const reefH = -5.4 + sin(lx * 0.09) * cos(lz * 0.09) * 1.15 + microRelief * 0.18;
          h = lerp(h, reefH, wLocal);
        }
        break;
      }
      case 11: { // Abyssal Garden & Hydrothermal Trench
        wAbyss = max(wAbyss, wReg);
        h = lerp(h, min(h, -120.0), wReg * 0.88);
        if (wLocal > 0.001) {
          const dA = hypot(lx, lz);
          const ventMound = smoothstep(32, 4, dA) * abs(sin(lx * 0.18) * cos(lz * 0.18)) * 2.4;
          archMask = max(archMask, smoothstep(48, 10, dA) * smoothstep(0.35, 0.85, sin(lx * 0.09) * cos(lz * 0.09)));
          h = lerp(h, -15.2 + ventMound + microRelief * 0.25, wLocal);
        }
        break;
      }
      case 12: { // Sub-Antarctic Penguin Rookery
        wRookery = max(wRookery, wReg);
        wPolar = max(wPolar, wReg * 0.75);
        h = lerp(h, clamp(h, -18.0, 48.0), wReg * 0.72);
        if (wLocal > 0.001) {
          const headland = smoothstep(95, 18, hypot(lx, lz)) * (5.8 + sin(lx * 0.07) * 1.8) - 2.2;
          h = lerp(h, headland + microRelief * 0.18, wLocal);
        }
        break;
      }
      case 13: { // Polar Ice Planet & Glacial Shelf
        wPolar = max(wPolar, wReg);
        h = lerp(h, clamp(h, -20.0, 90.0), wReg * 0.65);
        if (wLocal > 0.001) {
          const tabular = floor((sin(lx * 0.045) * cos(lz * 0.045) + 1.0) * 1.8) * 2.4;
          const lead = smoothstep(14, 3, abs(lz - sin(lx * 0.03) * 14.0)) * 5.2;
          h = lerp(h, 4.2 + tabular - lead + microRelief * 0.15, wLocal);
        }
        break;
      }
      case 14: { // Burning Forest
        wFire = max(wFire, wReg);
        if (wLocal > 0.001) {
          h = lerp(h, 4.4 + sin(lx * 0.04) * cos(lz * 0.05) * 2.4 + microRelief * 0.2, wLocal);
        }
        break;
      }
      case 15: { // Obsidian Volcanic Caldera
        wVolcano = max(wVolcano, wReg);
        if (wLocal > 0.001) {
          const dV = hypot(lx, lz);
          const cone = smoothstep(115, 28, dV) * 16.5 - smoothstep(28, 6, dV) * 12.0;
          const angV = atan2(lz, lx);
          const chan = smoothstep(110, 12, dV) * max(0, sin(angV * 5.0 + dV * 0.07));
          lava = max(lava, chan * wLocal);
          h = lerp(h, 4.5 + cone + microRelief * 0.2, wLocal);
        }
        break;
      }
      case 16: { // Bioluminescent Cenote
        wCenote = max(wCenote, wReg);
        h = lerp(h, clamp(h, -8.0, 28.0), wReg * 0.72);
        if (wLocal > 0.001) {
          const dC = hypot(lx, lz);
          const rim = smoothstep(72, 26, dC) * 5.6 - smoothstep(28, 7, dC) * 10.5;
          h = lerp(h, 2.2 + rim + microRelief * 0.15, wLocal);
        }
        break;
      }
      case 17: { // Skeleton Coast & Red Dunes
        wDune = max(wDune, wReg);
        if (wLocal > 0.001) {
          const duneH = 3.8 + abs(sin(lx * 0.072 + sin(lz * 0.035) * 2.1)) * 6.5;
          h = lerp(h, duneH + microRelief * 0.15, wLocal);
        }
        break;
      }
    }
  }

  // 5. Regional Ecoregion Classification (115 distinct global terrestrial & marine profiles)
  const eco = classifyEcoregionAt(latDeg, lonDeg, h, tempBaseC, rainfall, aridity, geoGlacier);

  // Natural global climate biome weights outside curated basins so ALL 510M km^2 feel rich & distinct
  if (h > 0.2) {
    const rainforest = clamp(smoothstep(0.60, 0.86, rainfall) * smoothstep(16.0, 25.0, tempBaseC), 0, 1);
    const savannaClim = clamp(smoothstep(0.30, 0.56, rainfall) * smoothstep(17.0, 28.0, tempBaseC) * (1.0 - rainforest), 0, 1);
    const alpine = smoothstep(1550.0, 3300.0, h);
    wDune = max(wDune, aridity * 0.85);
    wAmazon = max(wAmazon, rainforest * 0.78);
    wSavanna = max(wSavanna, savannaClim * 0.72);
    wPolar = max(wPolar, max(smoothstep(-2.0, -12.0, tempBaseC), max(alpine * 0.88, geoGlacier * 0.95)));
    wClearing = max(wClearing, (1.0 - aridity) * (1.0 - rainforest) * (1.0 - wPolar) * 0.45);
  } else {
    const shallow = smoothstep(-28.0, -0.5, h);
    wReef = max(wReef, shallow * smoothstep(16.0, 24.0, tempBaseC) * 0.55);
    wAbyss = max(wAbyss, smoothstep(-1200.0, -3600.0, h) * 0.7);
  }

  // Unified Surface Albedo RGB (used by Cube-Sphere Terrain Tiles AND 3D/2D Planetary Navigator!)
  let cr = 0.20, cg = 0.36, cb = 0.16;
  if (h < -0.05) {
    const dFac = saturate(-h / 3500.0);
    const reefCol = [0.68, 0.62, 0.46];
    const shelfCol = [0.10, 0.30, 0.34];
    const abyssCol = [0.03, 0.08, 0.16];
    const mid = [lerp(shelfCol[0], abyssCol[0], dFac), lerp(shelfCol[1], abyssCol[1], dFac), lerp(shelfCol[2], abyssCol[2], dFac)];
    const sh = smoothstep(-18.0, -0.3, h);
    cr = lerp(mid[0], reefCol[0], sh * (0.45 + wReef * 0.45));
    cg = lerp(mid[1], reefCol[1], sh * (0.45 + wReef * 0.45));
    cb = lerp(mid[2], reefCol[2], sh * (0.45 + wReef * 0.45));
    if (eco && eco.tint) {
      cr = lerp(cr, eco.tint[0], 0.28);
      cg = lerp(cg, eco.tint[1], 0.28);
      cb = lerp(cb, eco.tint[2], 0.28);
    }
    if (wPolar > 0.55 && h > -25.0) {
      cr = lerp(cr, 0.76, (wPolar - 0.55) * 1.4);
      cg = lerp(cg, 0.85, (wPolar - 0.55) * 1.4);
      cb = lerp(cb, 0.92, (wPolar - 0.55) * 1.4);
    }
  } else {
    const lush = [0.11, 0.30, 0.10];
    const tempForest = [0.18, 0.34, 0.14];
    const sav = [0.54, 0.47, 0.24];
    const des = [0.76, 0.54, 0.32];
    const redDune = [0.74, 0.36, 0.21];
    const rock = [0.36, 0.34, 0.32];
    const snow = [0.89, 0.93, 0.97];
    const basalt = [0.13, 0.12, 0.13];
    const sand = [0.76, 0.68, 0.48];

    cr = lerp(tempForest[0], lush[0], clamp(wAmazon + wBamboo * 0.8, 0, 1));
    cg = lerp(tempForest[1], lush[1], clamp(wAmazon + wBamboo * 0.8, 0, 1));
    cb = lerp(tempForest[2], lush[2], clamp(wAmazon + wBamboo * 0.8, 0, 1));

    cr = lerp(cr, sav[0], wSavanna * 0.82);
    cg = lerp(cg, sav[1], wSavanna * 0.82);
    cb = lerp(cb, sav[2], wSavanna * 0.82);

    const duneBlend = clamp(wDune * 0.92, 0, 1);
    const useRed = smoothstep(0.6, 0.95, wDune) * (nearestId === 17 ? 1.0 : 0.32);
    cr = lerp(cr, lerp(des[0], redDune[0], useRed), duneBlend);
    cg = lerp(cg, lerp(des[1], redDune[1], useRed), duneBlend);
    cb = lerp(cb, lerp(des[2], redDune[2], useRed), duneBlend);

    // Blend regional ecoregion palette tint so adjacent regions have genuine soil/vegetation diversity
    if (eco && eco.tint) {
      const ecoBlend = nearestAng < 0.012 ? 0.18 : 0.48;
      cr = lerp(cr, eco.tint[0], ecoBlend);
      cg = lerp(cg, eco.tint[1], ecoBlend);
      cb = lerp(cb, eco.tint[2], ecoBlend);
    }

    const coastSand = smoothstep(8.0, 0.0, h) * (0.35 + wBeach * 0.65);
    cr = lerp(cr, sand[0], coastSand * 0.72);
    cg = lerp(cg, sand[1], coastSand * 0.72);
    cb = lerp(cb, sand[2], coastSand * 0.72);

    const peat = clamp(wSwamp * 0.55 + wMangrove * 0.5, 0, 0.75);
    cr = lerp(cr, 0.16, peat); cg = lerp(cg, 0.22, peat); cb = lerp(cb, 0.12, peat);

    const rockW = smoothstep(750.0, 2300.0, h);
    cr = lerp(cr, rock[0], rockW * 0.82);
    cg = lerp(cg, rock[1], rockW * 0.82);
    cb = lerp(cb, rock[2], rockW * 0.82);

    if (wVolcano > 0.1 || wFire > 0.1) {
      const charW = clamp(wVolcano * 0.88 + wFire * 0.65, 0, 0.95);
      cr = lerp(cr, basalt[0], charW);
      cg = lerp(cg, basalt[1], charW);
      cb = lerp(cb, basalt[2], charW);
      if (lava > 0.05) {
        cr = lerp(cr, 1.0, lava); cg = lerp(cg, 0.32, lava); cb = lerp(cb, 0.04, lava);
      }
    }

    const snowW = clamp(wPolar * 0.92 + smoothstep(2600.0, 4100.0, h) * 0.90, 0, 1);
    cr = lerp(cr, snow[0], snowW);
    cg = lerp(cg, snow[1], snowW);
    cb = lerp(cb, snow[2], snowW);
  }

  const wetness = clamp(smoothstep(1.8, -0.4, h - WATER_LEVEL) + wSwamp * 0.45 + wRiver * 0.4 + majorRiver * 0.4 + geoLake * 0.5, 0, 1);
  const moisture = clamp(wetness * 0.55 + rainfall * 0.55, 0, 1);

  out.h = h;
  out.height = h;
  out.latDeg = latDeg;
  out.lonDeg = lonDeg;
  out.continentId = continentId;
  out.temperatureC = tempBaseC;
  out.rainfall = rainfall;
  out.aridity = aridity;
  out.glacier = geoGlacier;
  out.lakeFrac = geoLake;
  out.riverFrac = majorRiver;
  out.ecoregion = eco;
  out.lithology = eco ? eco.lithology : 'granite';
  out.floraGuild = eco ? eco.floraGuild : 'temperate_prairie';
  out.waterType = eco ? eco.waterType : (h < -0.5 ? 'marine' : 'fresh');
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
  out.lava = clamp(lava, 0, 1);
  out.archMask = archMask;
  out.biomeId = nearestAng < 0.08 ? nearestId : (wPolar > 0.65 ? 13 : h < -10 ? 11 : wDune > 0.55 ? 17 : wAmazon > 0.5 ? 2 : wSavanna > 0.45 ? 6 : 4);
  out.colR = cr;
  out.colG = cg;
  out.colB = cb;
  return out;
};

function powAbs(v, p) {
  return Math.pow(max(0, v), p);
}

const _tmpDir = [0, 0, 1];
export const samplePlanetAtLatLon = (latDeg, lonDeg, out = {}, detailLevel = 2) => {
  latLonToDir(latDeg * DEG2RAD, lonDeg * DEG2RAD, _tmpDir);
  return samplePlanetAtDir(_tmpDir[0], _tmpDir[1], _tmpDir[2], out, detailLevel);
};

// Local tangent meter query around the active floating-origin anchor (NO 720-unit wrap!)
export const terrainAt = (dxMeters, dzMeters, out = {}, origin = _activeOrigin) => {
  const dir = localMetersToDir(dxMeters, dzMeters, origin, _tmpDir);
  return samplePlanetAtDir(dir[0], dir[1], dir[2], out, 2);
};

// Backward-safe finite delta helper (no artificial 720-unit wrap!)
export const wrapCoord = (v) => (Number.isFinite(v) ? v : 0);
export const wrapDelta = (a, b = 0) => {
  const d = (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
  return Number.isFinite(d) ? d : 0;
};

// Geodesic coordinate helpers using real Earth dimensions
export const worldToLatLonAlt = (dxMeters, altMeters, dzMeters, origin = _activeOrigin) => {
  const ll = localMetersToLatLon(dxMeters, dzMeters, origin);
  const layer = atmosphericLayerAt(altMeters);
  return {
    lat: ll.latDeg,
    lon: ll.lonDeg,
    latDeg: ll.latDeg,
    lonDeg: ll.lonDeg,
    latRad: ll.latRad,
    lonRad: ll.lonRad,
    altMeters,
    altKm: altMeters / 1000.0,
    nx: ll.nx, ny: ll.ny, nz: ll.nz,
    layer
  };
};

export const latLonToWorld = (latDeg, lonDeg, origin = _activeOrigin) => {
  return latLonToLocalMeters(latDeg, lonDeg, origin);
};

export const worldToCubeSphere = (dxMeters, altMeters, dzMeters, origin = _activeOrigin) => {
  const ll = localMetersToLatLon(dxMeters, dzMeters, origin);
  const cs = dirToCubeFaceUV(ll.nx, ll.ny, ll.nz);
  return {
    face: cs.face,
    u: cs.u,
    v: cs.v,
    nx: ll.nx, ny: ll.ny, nz: ll.nz,
    radiusAtLat: oblateRadiusAtSinLat(ll.ny),
    latDeg: ll.latDeg,
    lonDeg: ll.lonDeg
  };
};

// Nearest curated biome destination using genuine great-circle geodesic distance
export const nearestBiomeAtGeo = (latDeg, lonDeg) => {
  let best = BIOME_CATALOG[0];
  let bestDist = Infinity;
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    const b = BIOME_CATALOG[i];
    const d = greatCircleDistanceMeters(latDeg, lonDeg, b.latDeg, b.lonDeg);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return { biome: best, distanceMeters: bestDist, distanceKm: bestDist / 1000.0 };
};

export const nearestBiomeAt = (dxMeters, dzMeters, origin = _activeOrigin) => {
  const ll = localMetersToLatLon(dxMeters, dzMeters, origin);
  return nearestBiomeAtGeo(ll.latDeg, ll.lonDeg).biome;
};

export const spaceSectorAt = (latDeg, lonDeg, altMeters) => {
  const sx = floor((lonDeg + 180) / 60);
  const sy = floor(max(0, altMeters - 100000) / 500000);
  const sz = floor((latDeg + 90) / 30);
  const h = abs(sin(sx * 127.1 + sy * 311.7 + sz * 74.7) * 43758.5453);
  const idx = floor((h % 1) * 6);
  const names = [
    'Orion-Cygnus Spiral Arm',
    'Carina Nebula Filament',
    'Magellanic Tidal Stream',
    'Perseus Molecular Cloud',
    'Vela Supernova Remnant',
    'Local Bubble Interstellar Void'
  ];
  return { sectorX: sx, sectorY: sy, sectorZ: sz, name: names[idx] || names[0] };
};

export const biomeLabelAtGeo = (latDeg, lonDeg, altMeters) => {
  const layer = atmosphericLayerAt(altMeters);
  if (altMeters >= 10000000) {
    const sec = spaceSectorAt(latDeg, lonDeg, altMeters);
    return `${layer.name} · ${sec.name}`;
  }
  const near = nearestBiomeAtGeo(latDeg, lonDeg);
  const s = samplePlanetAtLatLon(latDeg, lonDeg, {}, 0);
  const regionLabel = near.distanceKm < 95
    ? near.biome.name
    : (s.ecoregion ? s.ecoregion.name : (s.h < -5 ? 'Open Pelagic Ocean' : 'Continental Interior'));
  if (altMeters >= 12000) {
    return `${layer.name} (${(altMeters / 1000).toFixed(0)} km) · Over ${regionLabel}`;
  }
  return regionLabel;
};

export const biomeLabelAt = (dxMeters, altMeters, dzMeters, origin = _activeOrigin) => {
  const ll = localMetersToLatLon(dxMeters, dzMeters, origin);
  return biomeLabelAtGeo(ll.latDeg, ll.lonDeg, altMeters);
};

// Local cinematic camera poses (offset in meters around each biome's true planetary center)
export const POSES = BIOME_CATALOG.map((b) => {
  if (b.id === 10) return [-10, -1.8, -14, 4, -3.8, 10];   // Coral Reef underwater
  if (b.id === 11) return [-12, -6.5, -15, -2, -10.5, 4];  // Abyssal Garden underwater
  if (b.id === 9)  return [-15, 2.8, -16, 4, 0.8, 18];     // Tropical Beach
  if (b.id === 15) return [-20, 12.5, 22, 4, 7.5, -4];     // Volcanic Caldera
  if (b.id === 8)  return [-16, 13.5, 18, 6, 9.5, -6];     // Virunga Highlands
  return [-14, 4.8, 18, 5, 2.2, -6];
});

// ============================================================================
// GENUINE 6-FACE CUBE-SPHERE QUADTREE TERRAIN STREAMER
// - Hierarchical subdivision across all 6 cube faces (0..5)
// - Screen-space error (SSE) LOD selection
// - Deterministic LRU tile cache with bounded memory & unloading
// - Edge-consistent boundary elevations & spherical normals (zero cube-face seams)
// - Downward skirts to conceal LOD T-junctions
// ============================================================================
export const TILE_GRID = 16;                                // 16x16 quads -> 17x17 surface verts
export const TILE_SURF_VERTS = (TILE_GRID + 1) * (TILE_GRID + 1); // 289
export const TILE_SKIRT_VERTS = (TILE_GRID + 1) * 4;        // 68
export const TILE_TOTAL_VERTS = TILE_SURF_VERTS + TILE_SKIRT_VERTS; // 357
export const TILE_FLOATS_PER_VERT = 12; // posOffEcef(3), elev(1), normEcef(3), wetness(1), col(3), biomeId(1)

export const buildTileIndexBuffer = () => {
  const N = TILE_GRID;
  const stride = N + 1;
  const idx = [];
  // Main 16x16 surface grid
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i0 = y * stride + x;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  // 4 downward edge skirts (top, bottom, left, right)
  let skBase = TILE_SURF_VERTS;
  // Top edge (y = 0)
  for (let x = 0; x < N; x++) {
    const t0 = x, t1 = x + 1;
    const s0 = skBase + x, s1 = skBase + x + 1;
    idx.push(t0, t1, s0, t1, s1, s0);
  }
  skBase += stride;
  // Bottom edge (y = N)
  for (let x = 0; x < N; x++) {
    const t0 = N * stride + x, t1 = t0 + 1;
    const s0 = skBase + x, s1 = skBase + x + 1;
    idx.push(t0, s0, t1, t1, s0, s1);
  }
  skBase += stride;
  // Left edge (x = 0)
  for (let y = 0; y < N; y++) {
    const t0 = y * stride, t1 = (y + 1) * stride;
    const s0 = skBase + y, s1 = skBase + y + 1;
    idx.push(t0, s0, t1, t1, s0, s1);
  }
  skBase += stride;
  // Right edge (x = N)
  for (let y = 0; y < N; y++) {
    const t0 = y * stride + N, t1 = (y + 1) * stride + N;
    const s0 = skBase + y, s1 = skBase + y + 1;
    idx.push(t0, t1, s0, t1, s1, s0);
  }
  return new Uint32Array(idx);
};

// Deterministic hash seed per (face, lod, tx, ty)
export const tileSeed = (face, lod, tx, ty) => {
  let h = (face + 1) * 73856093 ^ (lod + 1) * 19349663 ^ (tx + 17) * 83492791 ^ (ty + 31) * 2971215073;
  return (h >>> 0);
};

export class CubeSphereQuadtree {
  constructor(opts = {}) {
    this.maxLod = opts.maxLod ?? 16;          // LOD 16 => ~150m tile width (~9.5m vertex spacing); LOD 17 => ~4.7m
    this.maxCachedTiles = opts.maxCachedTiles ?? 320;
    this.maxTilesPerFrame = opts.maxTilesPerFrame ?? 18;
    this.maxActiveTiles = opts.maxActiveTiles ?? 220;
    this.cache = new Map();                   // key -> tile record (insertion order = LRU)
    this.freeSlots = [];
    for (let i = this.maxCachedTiles - 1; i >= 0; i--) this.freeSlots.push(i);
    this.indices = buildTileIndexBuffer();
    this.frameCounter = 0;
    this.stats = { activeCount: 0, cachedCount: 0, generatedThisFrame: 0, evictedTotal: 0, maxLodActive: 0 };
  }

  tileKey(face, lod, tx, ty) {
    return `${face}_${lod}_${tx}_${ty}`;
  }

  // Generate deterministic vertex data for a cube-sphere tile (identical across runs & shared edges!)
  generateTile(face, lod, tx, ty, gpuSlot) {
    const invN = 1.0 / (1 << lod);
    const u0 = -1.0 + 2.0 * tx * invN;
    const u1 = -1.0 + 2.0 * (tx + 1) * invN;
    const v0 = -1.0 + 2.0 * ty * invN;
    const v1 = -1.0 + 2.0 * (ty + 1) * invN;
    const uc = 0.5 * (u0 + u1);
    const vc = 0.5 * (v0 + v1);

    const cDir = cubeFaceUVToDir(face, uc, vc);
    const cSample = samplePlanetAtDir(cDir[0], cDir[1], cDir[2], {}, lod >= 10 ? 2 : lod >= 5 ? 1 : 0);
    const cRad = oblateRadiusAtSinLat(cDir[1]) + cSample.h;
    const ecefCenter = [cDir[0] * cRad, cDir[1] * cRad, cDir[2] * cRad];

    const tileArcMeters = (PI * 0.5 * PLANET_RADIUS) * invN;
    const skirtDepth = clamp(tileArcMeters * 0.045, 3.5, 45000.0);
    const detailLevel = lod >= 11 ? 2 : lod >= 5 ? 1 : 0;

    // Finite-difference angular step for seamless analytical spherical normals across ALL tile & face boundaries
    const normEpsMeters = max(1.8, tileArcMeters / (TILE_GRID * 2.5));
    const normEpsAng = normEpsMeters / PLANET_RADIUS;

    const verts = new Float32Array(TILE_TOTAL_VERTS * TILE_FLOATS_PER_VERT);
    const stride = TILE_GRID + 1;
    const dir = [0, 0, 1];
    const samp = {};
    const sE = {}, sW = {}, sN = {}, sS = {};
    let minElev = Infinity, maxElev = -Infinity;
    let maxRadFromCenter = 0;

    for (let gy = 0; gy <= TILE_GRID; gy++) {
      const fy = gy / TILE_GRID;
      const v = lerp(v0, v1, fy);
      for (let gx = 0; gx <= TILE_GRID; gx++) {
        const fx = gx / TILE_GRID;
        const u = lerp(u0, u1, fx);
        cubeFaceUVToDir(face, u, v, dir);
        samplePlanetAtDir(dir[0], dir[1], dir[2], samp, detailLevel);

        const h = samp.h;
        if (h < minElev) minElev = h;
        if (h > maxElev) maxElev = h;

        const rBase = oblateRadiusAtSinLat(dir[1]);
        const r = rBase + h;
        const px = dir[0] * r;
        const py = dir[1] * r;
        const pz = dir[2] * r;

        const ox = px - ecefCenter[0];
        const oy = py - ecefCenter[1];
        const oz = pz - ecefCenter[2];
        const dCenter = hypot(ox, oy, oz);
        if (dCenter > maxRadFromCenter) maxRadFromCenter = dCenter;

        // Orthonormal spherical tangent axes at `dir` (independent of cube face!) for seamless normals
        let txA = dir[2], tyA = 0, tzA = -dir[0];
        let tLen = hypot(txA, tyA, tzA);
        if (tLen < 1e-5) { txA = 1; tyA = 0; tzA = 0; tLen = 1; }
        txA /= tLen; tyA /= tLen; tzA /= tLen;
        const bxA = dir[1] * tzA - dir[2] * tyA;
        const byA = dir[2] * txA - dir[0] * tzA;
        const bzA = dir[0] * tyA - dir[1] * txA;

        samplePlanetAtDir(dir[0] + txA * normEpsAng, dir[1] + tyA * normEpsAng, dir[2] + tzA * normEpsAng, sE, detailLevel);
        samplePlanetAtDir(dir[0] - txA * normEpsAng, dir[1] - tyA * normEpsAng, dir[2] - tzA * normEpsAng, sW, detailLevel);
        samplePlanetAtDir(dir[0] + bxA * normEpsAng, dir[1] + byA * normEpsAng, dir[2] + bzA * normEpsAng, sN, detailLevel);
        samplePlanetAtDir(dir[0] - bxA * normEpsAng, dir[1] - byA * normEpsAng, dir[2] - bzA * normEpsAng, sS, detailLevel);

        const dhdT = (sE.h - sW.h) / (2.0 * normEpsMeters);
        const dhdB = (sN.h - sS.h) / (2.0 * normEpsMeters);
        let enx = dir[0] - txA * dhdT - bxA * dhdB;
        let eny = dir[1] - tyA * dhdT - byA * dhdB;
        let enz = dir[2] - tzA * dhdT - bzA * dhdB;
        const nl = hypot(enx, eny, enz) || 1;
        enx /= nl; eny /= nl; enz /= nl;

        const base = (gy * stride + gx) * TILE_FLOATS_PER_VERT;
        verts[base]      = ox;
        verts[base + 1]  = oy;
        verts[base + 2]  = oz;
        verts[base + 3]  = h;
        verts[base + 4]  = enx;
        verts[base + 5]  = eny;
        verts[base + 6]  = enz;
        verts[base + 7]  = samp.wetness;
        verts[base + 8]  = samp.colR;
        verts[base + 9]  = samp.colG;
        verts[base + 10] = samp.colB;
        verts[base + 11] = samp.biomeId + (samp.lava > 0.05 ? round(clamp(samp.lava, 0, 0.99) * 99) * 100.0 : 0.0);
      }
    }

    // Build 4 downward skirt rings by copying boundary vertices dropped radially inward by skirtDepth
    const copySkirtVert = (srcIdx, dstIdx) => {
      const sb = srcIdx * TILE_FLOATS_PER_VERT;
      const db = dstIdx * TILE_FLOATS_PER_VERT;
      const ox = verts[sb], oy = verts[sb + 1], oz = verts[sb + 2];
      const vx = ecefCenter[0] + ox, vy = ecefCenter[1] + oy, vz = ecefCenter[2] + oz;
      const vl = hypot(vx, vy, vz) || 1;
      verts[db]      = ox - (vx / vl) * skirtDepth;
      verts[db + 1]  = oy - (vy / vl) * skirtDepth;
      verts[db + 2]  = oz - (vz / vl) * skirtDepth;
      verts[db + 3]  = verts[sb + 3] - skirtDepth;
      for (let k = 4; k < TILE_FLOATS_PER_VERT; k++) verts[db + k] = verts[sb + k];
    };

    let skCursor = TILE_SURF_VERTS;
    for (let x = 0; x <= TILE_GRID; x++) copySkirtVert(x, skCursor++);                          // top
    for (let x = 0; x <= TILE_GRID; x++) copySkirtVert(TILE_GRID * stride + x, skCursor++);     // bottom
    for (let y = 0; y <= TILE_GRID; y++) copySkirtVert(y * stride, skCursor++);                 // left
    for (let y = 0; y <= TILE_GRID; y++) copySkirtVert(y * stride + TILE_GRID, skCursor++);     // right

    return {
      key: this.tileKey(face, lod, tx, ty),
      face, lod, tx, ty,
      seed: tileSeed(face, lod, tx, ty),
      u0, u1, v0, v1,
      cDir,
      ecefCenter,
      tileArcMeters,
      boundRadius: maxRadFromCenter + skirtDepth,
      minElev,
      maxElev,
      hasOcean: minElev < 3.5,
      verts,
      gpuSlot,
      needsUpload: true,
      lastUsedFrame: this.frameCounter
    };
  }

  getOrGenerate(face, lod, tx, ty, allowGenerate = true) {
    const key = this.tileKey(face, lod, tx, ty);
    const existing = this.cache.get(key);
    if (existing) {
      // Refresh LRU position
      this.cache.delete(key);
      this.cache.set(key, existing);
      existing.lastUsedFrame = this.frameCounter;
      return existing;
    }
    if (!allowGenerate) return null;

    let slot;
    if (this.freeSlots.length > 0) {
      slot = this.freeSlots.pop();
    } else {
      // Evict oldest LRU tile not used in current frame
      let evictKey = null;
      for (const [k, tile] of this.cache) {
        if (tile.lastUsedFrame < this.frameCounter) {
          evictKey = k;
          break;
        }
      }
      if (!evictKey) return null;
      const old = this.cache.get(evictKey);
      this.cache.delete(evictKey);
      slot = old.gpuSlot;
      this.stats.evictedTotal++;
    }

    const tile = this.generateTile(face, lod, tx, ty, slot);
    this.cache.set(key, tile);
    this.stats.generatedThisFrame++;
    return tile;
  }

  // Select visible cube-sphere tiles via Best-First Highest-SSE Priority Refinement & Horizon Culling
  selectTiles(camEcef, camAltMeters, fovRad = 1.0, viewportH = 900, sseThreshold = 14.0, forceSync = false) {
    this.frameCounter++;
    this.stats.generatedThisFrame = 0;
    this.stats.maxLodActive = 0;

    const camR = hypot(camEcef[0], camEcef[1], camEcef[2]) || PLANET_RADIUS;
    const camDir = [camEcef[0] / camR, camEcef[1] / camR, camEcef[2] / camR];
    const horizonAng = Math.acos(clamp(PLANET_POLAR_RADIUS / max(PLANET_POLAR_RADIUS, camR), 0, 1));
    const projScale = viewportH / (2.0 * tan(max(0.2, fovRad) * 0.5));
    const maxBudget = forceSync ? 9999 : this.maxTilesPerFrame;

    const evalNode = (face, lod, tx, ty) => {
      const invN = 1.0 / (1 << lod);
      const uc = -1.0 + 2.0 * (tx + 0.5) * invN;
      const vc = -1.0 + 2.0 * (ty + 0.5) * invN;
      const cDir = cubeFaceUVToDir(face, uc, vc);
      const tileArc = (PI * 0.5 * PLANET_RADIUS) * invN;
      const tileAngRadius = (tileArc * 0.88) / PLANET_RADIUS;

      const dotCam = cDir[0] * camDir[0] + cDir[1] * camDir[1] + cDir[2] * camDir[2];
      const minVisCos = cos(min(PI, horizonAng + tileAngRadius + 0.16));
      if (lod >= 1 && dotCam < minVisCos) return null;

      const approxR = oblateRadiusAtSinLat(cDir[1]);
      const dist = hypot(
        cDir[0] * approxR - camEcef[0],
        cDir[1] * approxR - camEcef[1],
        cDir[2] * approxR - camEcef[2]
      );
      const effDist = max(8.0, dist - tileArc * 0.72);
      const geoError = tileArc * 0.085;
      const sse = (geoError * projScale) / effDist;
      return { face, lod, tx, ty, sse };
    };

    // Start with all 6 root cube faces so the entire visible globe is guaranteed covered
    const nodes = [];
    for (let face = 0; face < 6; face++) {
      const n = evalNode(face, 0, 0, 0);
      if (n) nodes.push(n);
    }

    // Best-first highest-SSE priority splitting: always refines closest/highest-error tiles first
    // down to LOD 14-16 (~150 m) near surface while distant horizon tiles remain coarse (LOD 1-4)
    while (nodes.length + 3 <= this.maxActiveTiles) {
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.lod >= this.maxLod) continue;
        if (n.lod > 0 && n.sse <= sseThreshold) continue;
        // Slightly prioritize root faces so visible faces open immediately, then pure SSE
        const score = n.lod === 0 ? n.sse + 1e6 : n.sse;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;

      const parent = nodes[bestIdx];
      nodes[bestIdx] = nodes[nodes.length - 1];
      nodes.pop();

      const cLod = parent.lod + 1;
      const cx = parent.tx * 2;
      const cy = parent.ty * 2;
      const c0 = evalNode(parent.face, cLod, cx,     cy);
      const c1 = evalNode(parent.face, cLod, cx + 1, cy);
      const c2 = evalNode(parent.face, cLod, cx,     cy + 1);
      const c3 = evalNode(parent.face, cLod, cx + 1, cy + 1);
      if (c0) nodes.push(c0);
      if (c1) nodes.push(c1);
      if (c2) nodes.push(c2);
      if (c3) nodes.push(c3);
    }

    // Materialize GPU tiles (with parent fallback if streaming frame budget is reached)
    const selected = [];
    const seenKeys = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const canGen = this.stats.generatedThisFrame < maxBudget;
      let tile = this.getOrGenerate(n.face, n.lod, n.tx, n.ty, canGen);
      if (!tile && n.lod > 0) {
        let pLod = n.lod - 1;
        let px = n.tx >> 1;
        let py = n.ty >> 1;
        while (!tile && pLod >= 0) {
          tile = this.getOrGenerate(n.face, pLod, px, py, pLod === 0);
          pLod--;
          px >>= 1;
          py >>= 1;
        }
      }
      if (tile && !seenKeys.has(tile.key)) {
        seenKeys.add(tile.key);
        selected.push(tile);
        if (tile.lod > this.stats.maxLodActive) this.stats.maxLodActive = tile.lod;
      }
    }

    this.stats.activeCount = selected.length;
    this.stats.cachedCount = this.cache.size;
    return selected;
  }
}

// ============================================================================
// EXPLICIT CONTINUOUS ATMOSPHERIC RE-ENTRY & DESCENT STATE MACHINE
// Handles orbital space -> exosphere -> thermosphere -> mesosphere -> stratosphere
// -> troposphere -> clouds -> regional flight -> near-surface -> ground arrival
// with continuous double-precision (lat, lon, alt) integration, gravity, drag,
// thermal heating & swept collision (ZERO teleportation or hard snap).
// ============================================================================
export const stepAtmosphericReentry = (state, input, dt) => {
  const stepDt = clamp(dt, 0.0001, 0.05);
  const subSteps = abs(state.velU) > 800 ? 8 : abs(state.velU) > 120 ? 4 : 2;
  const hDt = stepDt / subSteps;

  let groundH = 0;
  let reentryHeat = state.reentryHeat || 0;

  for (let s = 0; s < subSteps; s++) {
    const alt = state.altMeters;
    const rho = atmosphericDensityAt(alt);
    const g = gravityAt(alt);

    // Thruster / flight control acceleration (in m/s^2)
    const thrustE = input.thrustE || 0;
    const thrustN = input.thrustN || 0;
    const thrustU = input.thrustU || 0;
    const gravityScale = input.gravityScale ?? 0.0; // 0 in free-hover, >0 during ballistic re-entry

    // Progressive aerodynamic drag increases smoothly as atmosphere thickens
    const speed = hypot(state.velE, state.velN, state.velU);
    const dragCoeff = (0.045 + rho * 0.95) * (1.0 + clamp(speed / 6000, 0, 2.5));
    const dragFactor = exp(-dragCoeff * hDt);

    state.velE = (state.velE + thrustE * hDt) * dragFactor;
    state.velN = (state.velN + thrustN * hDt) * dragFactor;
    state.velU = (state.velU + (thrustU - g * gravityScale) * hDt) * dragFactor;

    // Aerodynamic re-entry heating peaks at high downward speed through Mesosphere/Thermosphere
    const descentSpeed = max(0, -state.velU);
    const heatBand = smoothstep(18000, 52000, alt) * (1.0 - smoothstep(82000, 145000, alt));
    const targetHeat = clamp((descentSpeed / 2200.0) * heatBand * (0.25 + rho * 22.0), 0, 1);
    reentryHeat = lerp(reentryHeat, targetHeat, clamp(hDt * 4.5, 0, 1));

    // Integrate horizontal displacement along true Earth geodesic (preserves lat/lon & crosses poles/±180°)
    const dE = state.velE * hDt;
    const dN = state.velN * hDt;
    if (hypot(dE, dN) > 1e-8) {
      const geoNext = moveAlongGeodesic(state.latRad, state.lonRad, dE, dN);
      state.latRad = geoNext.latRad;
      state.lonRad = geoNext.lonRad;
      state.latDeg = geoNext.latDeg;
      state.lonDeg = geoNext.lonDeg;
      if (Number.isFinite(state.yaw)) {
        state.yaw = normAngle(state.yaw + geoNext.headingShift);
      }
    }

    // Swept vertical integration & progressive surface approach braking
    const surf = samplePlanetAtLatLon(state.latDeg, state.lonDeg, {}, alt < 12000 ? 2 : 1);
    groundH = surf.h;
    const minSurfaceAlt = max(groundH + (input.clearance ?? 1.75), input.allowUnderwater ? groundH + 0.55 : WATER_LEVEL + 0.35);

    const nextAlt = state.altMeters + state.velU * hDt;
    const agl = nextAlt - minSurfaceAlt;

    // Smooth ground approach Cushion/Deceleration when nearing surface at high descent speed
    if (agl < 650 && agl > 0 && state.velU < -25) {
      const brake = smoothstep(650, 8, agl);
      state.velU = lerp(state.velU, max(state.velU, -max(6.0, agl * 0.45)), brake * clamp(hDt * 6.0, 0, 1));
    }

    if (nextAlt <= minSurfaceAlt) {
      state.altMeters = minSurfaceAlt;
      if (state.velU < 0) state.velU = 0;
      state.grounded = true;
    } else {
      state.altMeters = nextAlt;
      state.grounded = false;
    }
  }

  state.reentryHeat = reentryHeat;
  state.groundH = groundH;
  state.layer = atmosphericLayerAt(state.altMeters);
  state.stage = reentryStageAt(state.altMeters, groundH, state.velU);
  return state;
};

// ============================================================================
// HABITAT-AWARE ENVIRONMENTAL HAZARD EVALUATOR (Meters, Domain-Specific)
// ============================================================================
export const evaluateHazardAt = (x, z, domain = 0, out = {}, origin = _activeOrigin) => {
  const dom = domain === 'water' || domain === 1 ? 1 : domain === 'air' || domain === 2 ? 2 : 0;
  const t = terrainAt(x, z, {}, origin);
  const eps = 3.5;
  const tx = terrainAt(x + eps, z, {}, origin);
  const tz = terrainAt(x, z + eps, {}, origin);

  const dhdx = (tx.h - t.h) / eps;
  const dhdz = (tz.h - t.h) / eps;
  const slope = hypot(dhdx, dhdz);

  let hazardScore = 0;
  let pushX = 0;
  let pushZ = 0;
  let reason = 'safe';

  // 1. Wildfire hazard (ONLY terrestrial & low-flying aerial fauna flee wildfire — NOT whales/marine!)
  if (dom !== 1 && t.fire > 0.14) {
    const sev = t.fire * 2.4;
    hazardScore += sev;
    const d = max(1, hypot(x, z));
    pushX += (x / d) * sev;
    pushZ += (z / d) * sev;
    reason = 'wildfire';
  }

  // 2. Molten lava & volcanic caldera hazard (terrestrial & low aerial)
  if (dom !== 1 && (t.volcano > 0.25 || t.lava > 0.05)) {
    const sev = (t.volcano * 0.8 + (t.lava || 0) * 2.5) * 2.2;
    hazardScore += sev;
    const d = max(1, hypot(x, z));
    pushX += (x / d) * sev;
    pushZ += (z / d) * sev;
    reason = 'lava';
  }

  // 3. Domain-specific water depth / cliff / stranding hazards
  if (dom === 0) {
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
    // Strictly aquatic/marine fauna avoid shallow water stranding
    if (t.h > WATER_LEVEL - 0.85) {
      const sev = clamp((t.h - (WATER_LEVEL - 0.85)) * 2.5, 0, 4.0);
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
