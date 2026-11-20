// ============================================================================
// REALISM — Verified Biogeographic Species Eligibility & Regional Ecology Engine
// Connects the versioned >= 5,000 accepted GBIF Backbone Taxonomy dataset
// (public/assets/species-catalogue.json) to regional wildlife spawning,
// habitat validation, anatomical family mapping & species encounter rosters.
// ============================================================================
import { abs } from './math.js';
import { biogeographicRealmAt, classifyEcoregionAt } from './ecoregions.js';

let loadedCatalogue = null;
let loadPromise = null;

// Unpack compact columnar record into a full structured species object
export function unpackSpeciesRecord(cat, idx) {
  const r = cat.records[idx];
  const t = cat.tables;
  return {
    id: r[0],
    scientificName: r[1],
    commonName: r[2] || null,
    kingdom: 'Animalia',
    phylum: t.phyla[r[3]] || 'unknown',
    class: t.classes[r[4]] || 'unknown',
    order: t.orders[r[5]] || 'unknown',
    family: t.families[r[6]] || 'unknown',
    realm: t.realms[r[7]] || 'unknown',
    anatomyFamily: t.anatomyFamilies[r[8]] || 'invertebrate',
    nativeRegions: r[9] || ['unknown'],
    habitats: r[10] || ['unknown'],
    elevRangeM: r[11] || null,
    diet: r[12] || 'unknown',
    sizeM: r[13] ?? null,
    social: r[14] || 'unknown',
    synonyms: r[15] || []
  };
}

export function setSpeciesCatalogueData(cat) {
  if (cat && Array.isArray(cat.records) && cat.tables) {
    loadedCatalogue = cat;
    return true;
  }
  return false;
}

export function getLoadedSpeciesCatalogue() {
  return loadedCatalogue;
}

// Lazy-load the verified >= 5,000 species dataset in the browser without blocking startup
export function ensureSpeciesCatalogueLoaded(assetPath = 'assets/species-catalogue.json') {
  if (loadedCatalogue) return Promise.resolve(loadedCatalogue);
  if (loadPromise) return loadPromise;
  if (typeof fetch !== 'function') return Promise.resolve(null);
  loadPromise = fetch(assetPath)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (json && Array.isArray(json.records)) {
        loadedCatalogue = json;
      }
      return loadedCatalogue;
    })
    .catch(() => null);
  return loadPromise;
}

// Strict biogeographic & habitat eligibility check:
// A species with 'unknown' nativeRegions is NEVER globally spawned!
// Freshwater species NEVER spawn in marine saltwater; marine species NEVER spawn on dry land;
// Polar bears NEVER appear in tropics; Lions NEVER appear in Amazonia; Jaguars NEVER in Africa!
export function isSpeciesEligibleAt(sp, env) {
  if (!sp || !env) return false;
  const regions = sp.nativeRegions || [];
  if (regions.length === 0 || (regions.length === 1 && regions[0] === 'unknown')) {
    return false; // Unknown range must never be auto-spawned globally
  }

  const isMarineWater = env.waterType === 'marine' || (env.elevM < -1.5 && env.waterType !== 'fresh');
  const isFreshWater = env.waterType === 'fresh' || env.hasFreshwater;

  // 1. Strict aquatic vs terrestrial habitat realm filtering
  if (sp.realm === 'marine') {
    if (!isMarineWater && !env.nearCoast) return false;
  } else if (sp.realm === 'freshwater') {
    if (isMarineWater && !isFreshWater) return false;
    if (!isFreshWater && env.elevM > 400 && env.aridity > 0.5) return false;
  } else if (sp.realm === 'terrestrial') {
    if (isMarineWater) return false;
  } else if (sp.realm === 'amphibious') {
    if (env.aridity > 0.65 && !isFreshWater && !env.nearCoast) return false;
  } else if (sp.realm === 'unknown') {
    return false;
  }

  // 2. Elevation / depth range validation where documented
  if (Array.isArray(sp.elevRangeM) && sp.elevRangeM.length === 2) {
    if (env.elevM < sp.elevRangeM[0] - 80 || env.elevM > sp.elevRangeM[1] + 150) return false;
  }

  // 3. Biogeographic realm match (supports sub-regional tags like 'Afrotropics_Virunga', 'Nearctic_SE')
  const envRealm = env.realm || biogeographicRealmAt(env.latDeg, env.lonDeg, isMarineWater);
  let realmMatch = false;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r === envRealm) { realmMatch = true; break; }
    if (r.startsWith(envRealm + '_')) {
      // Sub-regional constraints (e.g., Virunga highlands, SE Nearctic swamp, Gir forest)
      if (r === 'Afrotropics_Virunga' && env.latDeg > -4 && env.latDeg < 2 && env.lonDeg > 27 && env.lonDeg < 32) { realmMatch = true; break; }
      if (r === 'Nearctic_SE' && env.latDeg > 24 && env.latDeg < 36 && env.lonDeg > -96 && env.lonDeg < -76) { realmMatch = true; break; }
      if (r === 'Indomalaya_Gir' && env.latDeg > 19 && env.latDeg < 24 && env.lonDeg > 68 && env.lonDeg < 74) { realmMatch = true; break; }
      if (r === 'Palearctic_Amur' && env.latDeg > 42 && env.latDeg < 52 && env.lonDeg > 125 && env.lonDeg < 142) { realmMatch = true; break; }
    }
    // Antarctic penguins may enter adjacent Southern Ocean coastal zone
    if (r === 'Antarctic' && envRealm === 'Southern_Ocean' && env.latDeg < -55) { realmMatch = true; break; }
    if (r === 'Arctic' && envRealm === 'Arctic_Ocean' && env.latDeg > 66) { realmMatch = true; break; }
  }
  if (!realmMatch) return false;

  // 4. Habitat / Biome compatibility check
  const habs = sp.habitats || [];
  if (habs.length > 0 && habs[0] !== 'unknown' && env.biomeClass) {
    const bc = env.biomeClass;
    const ok = habs.includes(bc) ||
      (bc === 'prairie' && (habs.includes('grassland') || habs.includes('steppe'))) ||
      (bc === 'steppe' && habs.includes('grassland')) ||
      (bc === 'sub_antarctic' && habs.includes('polar_coast')) ||
      (bc === 'tropical_beach' && (habs.includes('coast') || habs.includes('coral_reef'))) ||
      (bc === 'swamp' && habs.includes('freshwater_wetland')) ||
      (bc === 'bamboo_forest' && (habs.includes('tropical_rainforest') || habs.includes('montane_forest'))) ||
      (bc === 'abyssal_trench' && (habs.includes('deep_ocean') || habs.includes('pelagic_ocean')));
    if (!ok) return false;
  }

  return true;
}

// Select an authentic, geographically filtered local biodiversity roster from the 5,000+ catalogue
export function queryRegionalSpeciesRoster(latDeg, lonDeg, elevM, tempC = 18, rainfall = 0.5, aridity = 0.1, glacierFrac = 0, limit = 24) {
  const eco = classifyEcoregionAt(latDeg, lonDeg, elevM, tempC, rainfall, aridity, glacierFrac);
  const env = {
    latDeg,
    lonDeg,
    elevM,
    tempC,
    rainfall,
    aridity,
    realm: eco.realm,
    biomeClass: eco.biomeClass,
    waterType: eco.waterType,
    hasFreshwater: eco.waterType === 'fresh' || eco.waterType === 'brackish',
    nearCoast: abs(elevM) < 40
  };
  if (!loadedCatalogue) return { ecoregion: eco, env, species: [] };

  const matched = [];
  const recs = loadedCatalogue.records;
  // Deterministic regional sampling stride so different locations surface distinct species rosters
  const seed = Math.abs(Math.floor(latDeg * 17 + lonDeg * 31)) % Math.max(1, recs.length);
  for (let k = 0; k < recs.length; k++) {
    const idx = (seed + k) % recs.length;
    const sp = unpackSpeciesRecord(loadedCatalogue, idx);
    if (isSpeciesEligibleAt(sp, env)) {
      matched.push(sp);
      if (matched.length >= limit) break;
    }
  }
  return { ecoregion: eco, env, species: matched };
}


// Biogeographic rules for the 3D animated regional wildlife cohorts in world.js
// Replaces simple nativeBiomes-only checks with real realm + habitat + elevation + water gating!
export const COHORT_BIOGEOGRAPHY = {
  lions:       { realms: ['Afrotropics'], biomes: ['savanna', 'tropical_dry_forest', 'hot_desert'], water: 'land', minElev: -1, maxElev: 2600 },
  elephants:   { realms: ['Afrotropics', 'Indomalaya'], biomes: ['savanna', 'tropical_dry_forest', 'tropical_rainforest', 'bamboo_forest', 'hot_desert'], water: 'land', minElev: -1, maxElev: 2500 },
  giraffes:    { realms: ['Afrotropics'], biomes: ['savanna', 'tropical_dry_forest'], water: 'land', minElev: -1, maxElev: 2200 },
  zebras:      { realms: ['Afrotropics'], biomes: ['savanna', 'grassland'], water: 'land', minElev: -1, maxElev: 2400 },
  gorillas:    { realms: ['Afrotropics'], biomes: ['montane_forest', 'tropical_rainforest'], water: 'land', minElev: 600, maxElev: 3800 },
  chimpanzees: { realms: ['Afrotropics'], biomes: ['tropical_rainforest', 'montane_forest', 'tropical_dry_forest'], water: 'land', minElev: 0, maxElev: 2600 },
  tigers:      { realms: ['Indomalaya', 'Palearctic'], biomes: ['bamboo_forest', 'tropical_rainforest', 'mangrove', 'temperate_forest'], water: 'land', minElev: -1, maxElev: 3200 },
  jaguars:     { realms: ['Neotropics'], biomes: ['tropical_rainforest', 'freshwater_wetland', 'mangrove', 'tropical_dry_forest'], water: 'land', minElev: -1, maxElev: 2200 },
  panthers:    { realms: ['Nearctic', 'Neotropics'], biomes: ['swamp', 'temperate_forest', 'montane_forest', 'tropical_rainforest'], water: 'land', minElev: -1, maxElev: 3000 },
  polarBears:  { realms: ['Arctic'], biomes: ['polar_ice', 'arctic_tundra'], water: 'land', minElev: -2, maxElev: 500 },
  penguins:    { realms: ['Antarctic', 'Southern_Ocean'], biomes: ['polar_ice', 'sub_antarctic', 'polar_coast'], water: 'amphibious', minElev: -15, maxElev: 250 },
  seals:       { realms: ['Antarctic', 'Southern_Ocean', 'Arctic', 'Arctic_Ocean'], biomes: ['polar_ice', 'sub_antarctic', 'kelp_forest'], water: 'amphibious', minElev: -40, maxElev: 120 },
  wolves:      { realms: ['Nearctic', 'Palearctic', 'Arctic'], biomes: ['boreal_forest', 'temperate_forest', 'arctic_tundra', 'alpine', 'steppe', 'prairie'], water: 'land', minElev: 0, maxElev: 4000 },
  bison:       { realms: ['Nearctic', 'Palearctic'], biomes: ['prairie', 'grassland', 'steppe', 'boreal_forest'], water: 'land', minElev: 0, maxElev: 2600 },
  rhinos:      { realms: ['Afrotropics', 'Indomalaya'], biomes: ['savanna', 'grassland', 'tropical_dry_forest'], water: 'land', minElev: 0, maxElev: 2000 },
  hippos:      { realms: ['Afrotropics'], biomes: ['freshwater_wetland', 'savanna', 'tropical_rainforest'], water: 'freshwater', minElev: -4, maxElev: 1800 },
  deer:        { realms: ['Nearctic', 'Palearctic', 'Neotropics', 'Indomalaya'], biomes: ['temperate_forest', 'boreal_forest', 'prairie', 'grassland', 'mediterranean', 'montane_forest'], water: 'land', minElev: 0, maxElev: 3200 },
  bears:       { realms: ['Nearctic', 'Palearctic'], biomes: ['temperate_forest', 'boreal_forest', 'temperate_rainforest', 'alpine', 'montane_forest'], water: 'land', minElev: 0, maxElev: 3600 },
  alligators:  { realms: ['Nearctic', 'Neotropics'], biomes: ['swamp', 'freshwater_wetland', 'mangrove'], water: 'freshwater', minElev: -4, maxElev: 300 },
  caimans:     { realms: ['Neotropics'], biomes: ['freshwater_wetland', 'mangrove', 'tropical_rainforest'], water: 'freshwater', minElev: -4, maxElev: 450 },
  anacondas:   { realms: ['Neotropics'], biomes: ['freshwater_wetland', 'swamp', 'tropical_rainforest'], water: 'freshwater', minElev: -4, maxElev: 500 },
  otters:      { realms: ['Neotropics', 'Nearctic', 'Palearctic'], biomes: ['freshwater_wetland', 'temperate_forest', 'boreal_forest', 'kelp_forest'], water: 'freshwater', minElev: -12, maxElev: 1500 },
  manatees:    { realms: ['Neotropics', 'Nearctic', 'Caribbean'], biomes: ['freshwater_wetland', 'mangrove', 'seagrass_meadow'], water: 'freshwater', minElev: -15, maxElev: 5 },
  whales:      { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Southern_Ocean', 'Arctic_Ocean', 'Indo_Pacific'], biomes: ['pelagic_ocean', 'deep_ocean', 'abyssal_trench', 'continental_shelf', 'coral_reef', 'polar_ice'], water: 'marine', minElev: -11000, maxElev: -4 },
  orcas:       { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Southern_Ocean', 'Arctic_Ocean', 'Indo_Pacific', 'Antarctic'], biomes: ['pelagic_ocean', 'deep_ocean', 'abyssal_trench', 'continental_shelf', 'kelp_forest', 'sub_antarctic', 'polar_ice'], water: 'marine', minElev: -11000, maxElev: -3 },
  sharks:      { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Indo_Pacific', 'Caribbean'], biomes: ['coral_reef', 'pelagic_ocean', 'continental_shelf', 'kelp_forest', 'abyssal_trench'], water: 'marine', minElev: -6000, maxElev: -3 },
  mantas:      { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Indo_Pacific', 'Caribbean'], biomes: ['coral_reef', 'pelagic_ocean', 'continental_shelf', 'abyssal_trench'], water: 'marine', minElev: -2000, maxElev: -2 },
  turtles:     { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Indo_Pacific', 'Caribbean', 'Australasia'], biomes: ['coral_reef', 'seagrass_meadow', 'tropical_beach', 'continental_shelf'], water: 'marine', minElev: -200, maxElev: 4 },
  fish:        { realms: ['Atlantic', 'Pacific', 'Indian_Ocean', 'Indo_Pacific', 'Caribbean', 'Neotropics', 'Nearctic', 'Afrotropics'], biomes: ['coral_reef', 'seagrass_meadow', 'kelp_forest', 'freshwater_wetland', 'swamp', 'mangrove', 'abyssal_trench'], water: 'aquatic', minElev: -4000, maxElev: 1800 },
  macaws:      { realms: ['Neotropics'], biomes: ['tropical_rainforest', 'freshwater_wetland', 'montane_forest'], water: 'air', minElev: 0, maxElev: 2000 },
  toucans:     { realms: ['Neotropics'], biomes: ['tropical_rainforest', 'montane_forest', 'tropical_dry_forest'], water: 'air', minElev: 0, maxElev: 2000 },
  eagles:      { realms: ['Nearctic', 'Palearctic', 'Neotropics', 'Afrotropics', 'Indomalaya', 'Australasia'], biomes: ['alpine', 'montane_forest', 'temperate_forest', 'boreal_forest', 'tropical_rainforest', 'savanna', 'volcanic_island'], water: 'air', minElev: 0, maxElev: 5500 },
  flamingos:   { realms: ['Caribbean', 'Neotropics', 'Afrotropics', 'Palearctic', 'Australasia'], biomes: ['tropical_beach', 'freshwater_wetland', 'mangrove'], water: 'land', minElev: -1, maxElev: 1200 },
  kangaroos:   { realms: ['Australasia'], biomes: ['savanna', 'hot_desert', 'temperate_forest', 'grassland'], water: 'land', minElev: 0, maxElev: 1400 }
};

export function isCohortEligibleInRegion(cohortName, latDeg, lonDeg, elevM, ecoregion, curatedBiomeId = -1, nativeBiomes = null) {
  // Always honor exact curated destination biome showcase where explicitly placed
  if (curatedBiomeId >= 0 && nativeBiomes && nativeBiomes.includes(curatedBiomeId)) {
    // Still enforce strict polar bear Arctic vs Antarctic / lion vs Amazon sanity if non-curated
    if (cohortName === 'polarBears' && latDeg < 0 && curatedBiomeId !== 13) return false;
    return true;
  }
  const rule = COHORT_BIOGEOGRAPHY[cohortName];
  if (!rule) return false;
  const isMarine = elevM < -1.5;
  const realm = ecoregion?.realm || biogeographicRealmAt(latDeg, lonDeg, isMarine);
  if (!rule.realms.includes(realm)) return false;
  if (elevM < rule.minElev || elevM > rule.maxElev) return false;
  if (rule.water === 'marine' && !isMarine) return false;
  if (rule.water === 'land' && isMarine) return false;
  if (rule.water === 'freshwater' && isMarine && ecoregion?.waterType === 'marine') return false;
  if (ecoregion && rule.biomes && !rule.biomes.includes(ecoregion.biomeClass)) return false;
  return true;
}
