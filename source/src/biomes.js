// ============================================================================
// Terra Primordia — Continuous 18-Biome Planetary Topography & Bathymetry
// ============================================================================
import { abs, hypot, min, max, sin, cos, exp, pow, clamp, saturate, lerp, smoothstep, noise2, fbm2, smin } from './math.js';

const WORLD_HALF = 360;

// 18 Seamless Biomes & Forbidden Zones Anchor Coordinates [x, z]
const LAGOON_POS     = [22, 16];      // 0: The River Sanctuary
const CYPRESS_POS    = [-115, 58];    // 1: The Cypress Swamp
const AMAZON_POS     = [108, -72];    // 2: The Amazon Emerald Canopy
const MANGROVE_POS   = [-18, 96];     // 3: The Mangrove Passage
const CLEARING_POS   = [-14, -92];    // 4: Sunlit Wildlife Clearing & Wildflower Fields
const PLANTATION_POS = [64, -148];    // 5: Overgrown Heritage Plantations (Zero Humans)
const SAVANNA_POS    = [-215, -35];   // 6: The Serengeti Savanna & Acacia Kopjes
const BAMBOO_POS     = [215, -95];    // 7: The Misty Bamboo & Monsoon Jungle
const HIGHLAND_POS   = [175, -210];   // 8: The Virunga Cloud Forest & Ape Highlands
const BEACH_POS      = [-12, 178];    // 9: The Golden Tropical Beach & Palm Atoll
const REEF_POS       = [-95, 240];    // 10: The Sunlit Coral Reef & Kelp Basin
const ABYSS_POS      = [58, 268];     // 11: The Abyssal Garden, Sunken Galleon & Vent Trench
const ROOKERY_POS    = [-215, 245];   // 12: The Sub-Antarctic Rookery & Southern Swell
const POLAR_POS      = [215, 255];    // 13: The Polar Ice Planet (Glacial Shelf & Aurora Skies)
const FIRE_POS       = [148, 108];    // 14: Forbidden Zone I: The Burning Forest
const VOLCANO_POS    = [245, 38];     // 15: Forbidden Zone II: Obsidian Volcanic Caldera & Lava
const FORGOTTEN_POS  = [-148, -125];  // 16: Forbidden Zone III: Bioluminescent Cenote Cavern
const DUNE_POS       = [-235, -185];  // 17: Forbidden Zone IV: Skeleton Coast & Singing Red Dunes
const POND_POS       = [-78, -56];    // Sunlit Flamingo & Water-Lily Pond

// Noniv/abyssal-garden vertical torus arches [cx, cz, R, r, angle] inside the Ocean Basin
const ABYSS_ARCHES = [
  [-92, 236, 11.5, 2.8, 0.35],
  [-68, 252, 13.0, 3.1, -0.52],
  [38, 256, 15.0, 3.4, 0.78],
  [78, 278, 16.5, 3.6, -0.30],
  [12, 285, 14.0, 3.2, 1.15]
];

function riverZ(x) {
  return 18 * sin(x * 0.018 + 0.4) + 9 * cos(x * 0.043 - 0.7) + 12;
}
function riverWidth(x) {
  const lagoon = exp(-((x - LAGOON_POS[0]) * (x - LAGOON_POS[0])) / 2200);
  return 12.5 + 4.5 * sin(x * 0.025 + 1.2) + 18 * lagoon;
}
function streamDist(x, z) {
  const sx = -45 + 22 * sin(z * 0.035);
  return abs(x - sx) * smoothstep(25, -95, z);
}

function terrainAt(x, z, out = {}) {
  const rz = riverZ(x);
  const rw = riverWidth(x);
  const dRiver = abs(z - rz);
  const dStream = streamDist(x, z);
  const dPond = hypot(x - POND_POS[0], z - POND_POS[1]);

  const riverMask = smoothstep(rw + 18, rw * 0.55, dRiver) * smoothstep(175, 135, z) * smoothstep(-185, -135, x);
  const streamMask = smoothstep(10, 2.5, dStream) * smoothstep(15, -20, z) * smoothstep(-135, -95, z);
  const pondMask = smoothstep(24, 11, dPond);
  const waterChannel = max(riverMask, max(streamMask * 0.78, pondMask * 0.88));

  // Core interior weights
  const wSwamp      = smoothstep(115, 25, hypot(x - CYPRESS_POS[0], z - CYPRESS_POS[1]));
  const wAmazon     = smoothstep(125, 30, hypot(x - AMAZON_POS[0], z - AMAZON_POS[1]));
  const wMangrove   = smoothstep(75, 18, hypot(x - MANGROVE_POS[0], z - MANGROVE_POS[1]));
  const wClearing   = smoothstep(82, 22, hypot(x - CLEARING_POS[0], z - CLEARING_POS[1]));
  const wPlantation = smoothstep(78, 20, hypot(x - PLANTATION_POS[0], z - PLANTATION_POS[1]));
  const wSavanna    = smoothstep(110, 32, hypot(x - SAVANNA_POS[0], z - SAVANNA_POS[1]));
  const wBamboo     = smoothstep(95, 26, hypot(x - BAMBOO_POS[0], z - BAMBOO_POS[1]));
  const wHighland   = smoothstep(95, 26, hypot(x - HIGHLAND_POS[0], z - HIGHLAND_POS[1]));
  const wBeach      = smoothstep(82, 20, hypot(x - BEACH_POS[0], z - BEACH_POS[1]));
  const wReef       = smoothstep(95, 28, hypot(x - REEF_POS[0], z - REEF_POS[1]));
  const wAbyss      = smoothstep(105, 32, hypot(x - ABYSS_POS[0], z - ABYSS_POS[1]));
  const wRookery    = smoothstep(90, 25, hypot(x - ROOKERY_POS[0], z - ROOKERY_POS[1]));
  const wPolar      = smoothstep(100, 28, hypot(x - POLAR_POS[0], z - POLAR_POS[1]));
  const wFire       = smoothstep(95, 24, hypot(x - FIRE_POS[0], z - FIRE_POS[1]));
  const wVolcano    = smoothstep(85, 22, hypot(x - VOLCANO_POS[0], z - VOLCANO_POS[1]));
  const wForgotten  = smoothstep(92, 24, hypot(x - FORGOTTEN_POS[0], z - FORGOTTEN_POS[1]));
  const wDune       = smoothstep(95, 26, hypot(x - DUNE_POS[0], z - DUNE_POS[1]));

  const nLow = fbm2(x * 0.0085, z * 0.0085, 4);
  const nMid = fbm2(x * 0.028 + 9.2, z * 0.028 - 4.7, 3);
  const nHi  = noise2(x * 0.11, z * 0.11);

  let h = (nLow - 0.36) * 14.5 + (nMid - 0.5) * 3.2 + (nHi - 0.5) * 0.55;

  // 1-4: Interior Everglades & Amazon Basin
  h = lerp(h, -0.35 + (nMid - 0.5) * 1.15 + (nHi - 0.5) * 0.25, wSwamp * 0.88);
  h = lerp(h, -0.22 + (nMid - 0.5) * 0.9, wMangrove * 0.85);
  h = lerp(h, 1.35 + (nMid - 0.5) * 0.65, wClearing * 0.84);
  h += wAmazon * (3.8 + nLow * 6.5);
  h += wFire * (2.5 + nMid * 4.2);
  h += wForgotten * (4.0 + (nLow - 0.3) * 8.0);

  // 5: Overgrown Heritage Plantations — stepped wild-reclaimed contour terraces
  if (wPlantation > 0.01) {
    const rawTerrace = 2.8 + (nLow * 8.5);
    const stepped = Math.floor(rawTerrace * 1.4) / 1.4 + smoothstep(0.0, 0.35, (rawTerrace * 1.4) % 1) * 0.55;
    h = lerp(h, stepped + (nHi - 0.5) * 0.25, wPlantation * 0.88);
  }

  // 6: Serengeti Savanna & Granite Kopjes
  if (wSavanna > 0.01) {
    const kopje = pow(max(0, nMid - 0.54) * 2.1, 2.2) * 16.0;
    const plains = 1.65 + (nLow - 0.45) * 2.2 + kopje;
    h = lerp(h, plains, wSavanna * 0.9);
  }

  // 7: Misty Bamboo & Monsoon Jungle — steep terraced ravines
  if (wBamboo > 0.01) {
    const bambooHills = 4.2 + nLow * 11.5 + sin(x * 0.09 + z * 0.07) * 1.8;
    h = lerp(h, bambooHills, wBamboo * 0.88);
  }

  // 8: Virunga Cloud Forest & Ape Highlands — dramatic volcanic mist peaks
  if (wHighland > 0.01) {
    const virungaElev = 8.5 + nLow * 16.0 + nMid * 5.2;
    h = lerp(h, virungaElev, wHighland * 0.92);
  }

  // 15: Forbidden Zone II: Obsidian Volcanic Caldera & Lava Rivers
  if (wVolcano > 0.01) {
    const dV = hypot(x - VOLCANO_POS[0], z - VOLCANO_POS[1]);
    const cone = smoothstep(75, 18, dV) * 18.5;
    const crater = smoothstep(22, 6, dV) * 14.5;
    const lavaChannel = smoothstep(5.5, 1.5, abs(sin((x - VOLCANO_POS[0]) * 0.06) * 14 - (z - VOLCANO_POS[1]) * 0.45)) * 3.2;
    h = lerp(h, 2.2 + cone - crater - lavaChannel + (nMid - 0.5) * 2.4, wVolcano * 0.92);
  }

  // 16: Forbidden Zone III: Bioluminescent Cenote Sinkhole pool at center
  if (wForgotten > 0.25) {
    const dCenote = hypot(x - FORGOTTEN_POS[0], z - FORGOTTEN_POS[1]);
    const sinkhole = smoothstep(18, 6, dCenote);
    h = lerp(h, -1.35 + (nHi - 0.5) * 0.3, sinkhole * 0.9);
  }

  // 17: Forbidden Zone IV: Skeleton Coast & Singing Red Dunes
  if (wDune > 0.01) {
    const duneWave = abs(sin(x * 0.055 + z * 0.025 + nLow * 2.4)) * 11.5;
    h = lerp(h, 1.8 + duneWave + sin(x * 0.65 + z * 0.3) * 0.18, wDune * 0.92);
  }

  // Carve main interior river & lagoon channel
  h = lerp(h, -2.55 - nMid * 0.9, waterChannel);
  if (dRiver > rw * 0.5 && dRiver < rw + 14 && z < 155 && x > -165) {
    const bank = smoothstep(rw * 0.5, rw + 10, dRiver);
    h = max(h, lerp(-0.6, 0.32, bank) * (1 - wSwamp * 0.65));
  }

  // Southern Planetary Ocean Hemisphere (z > 162):
  // Beach Swash Zone -> Sunlit Coral Reef & Kelp Basin -> Noniv/abyssal-garden Deep Trench
  // flanked by Sub-Antarctic Rookery (west) and Polar Ice Planet (east)
  let archMask = 0;
  if (z > 152) {
    const shoreDist = z - (182 + sin(x * 0.022) * 10);
    const oceanBlend = smoothstep(-18, 28, shoreDist);
    // Noniv/abyssal-garden sculpted mesas, crags, sand ripples & deep trench
    const rAbyss = hypot(x - ABYSS_POS[0], z - ABYSS_POS[1]);
    const mesaNoise = fbm2(x * 0.024 + 3.1, z * 0.024 - 1.7, 4);
    const mesa = smoothstep(0.42, 0.68, mesaNoise) * (3.8 + nHi * 2.2);
    const trenchDepth = smoothstep(95, 18, rAbyss) * 7.5;
    const ripple = cos((x * 0.8 + z * 0.35) * 1.2) * 0.08;
    let seaBed = -3.8 - smoothstep(0, 85, shoreDist) * 8.2 - trenchDepth + mesa + ripple;

    // Noniv/abyssal-garden vertical torus arches along the reef/abyss
    for (let i = 0; i < ABYSS_ARCHES.length; i++) {
      const A = ABYSS_ARCHES[i];
      const dx = x - A[0], dz = z - A[1];
      const ca = cos(A[4]), sa = sin(A[4]);
      const ux = dx * ca + dz * sa;
      const uz = -dx * sa + dz * ca;
      const radial = abs(ux) - A[2] * 0.62;
      const tubeD = hypot(radial, uz);
      if (tubeD < A[3] * 1.45) {
        const pillarH = smoothstep(A[3] * 1.45, A[3] * 0.3, tubeD) * (A[2] * 0.72);
        seaBed += pillarH;
        archMask = max(archMask, smoothstep(A[3] * 1.35, A[3] * 0.4, tubeD));
      }
    }

    // Golden Tropical Beach gentle slope into swash & shorebreak
    const beachSlope = clamp(-shoreDist * 0.14, -4.5, 2.4);
    seaBed = lerp(seaBed, beachSlope, wBeach * 0.78);

    // Sub-Antarctic Rookery basalt stacks & sea channels
    if (wRookery > 0.01) {
      const rookeryStack = (nLow > 0.47 ? (nLow - 0.47) * 28.0 : -3.4 + (nMid - 0.5) * 1.6);
      seaBed = lerp(seaBed, rookeryStack, wRookery * 0.92);
    }

    // Polar Ice Planet — flat-topped tabular glacial ice shelves & sea-ice pack over polar ocean
    if (wPolar > 0.01) {
      const iceShelfMask = smoothstep(0.44, 0.54, nLow + 0.08 * sin(x * 0.04));
      const floeMask = smoothstep(0.52, 0.58, nMid);
      const polarElev = lerp(-4.8, 7.5 + nHi * 2.2, iceShelfMask);
      const withFloes = iceShelfMask < 0.2 ? lerp(polarElev, 0.65, floeMask * 0.85) : polarElev;
      seaBed = lerp(seaBed, withFloes, wPolar * 0.94);
    }

    h = lerp(h, seaBed, oceanBlend);
  }

  // Outer planetary rim mountains / basin containment only near extreme edge
  const edge = smoothstep(WORLD_HALF - 42, WORLD_HALF - 6, max(abs(x), abs(z)));
  if (z < 165) {
    h = lerp(h, 22 + nLow * 16, edge);
  }

  const wetness = saturate(smoothstep(1.3, -0.45, h) + wSwamp * 0.45 + wMangrove * 0.4 + wBeach * 0.35);

  out.h = h;
  out.river = waterChannel;
  out.swamp = wSwamp;
  out.amazon = wAmazon;
  out.clearing = wClearing;
  out.mangrove = wMangrove;
  out.plantation = wPlantation;
  out.savanna = wSavanna;
  out.bamboo = wBamboo;
  out.highland = wHighland;
  out.beach = wBeach;
  out.reef = wReef;
  out.abyss = wAbyss;
  out.rookery = wRookery;
  out.polar = max(wPolar, wRookery * 0.75);
  out.fire = wFire;
  out.volcano = wVolcano;
  out.forgotten = wForgotten;
  out.cenote = wForgotten;
  out.dune = wDune;
  out.archMask = archMask;
  out.wetness = wetness;
  out.moisture = saturate(wetness * 0.65 + wAmazon * 0.5 + wBamboo * 0.55 + wSwamp * 0.6 - wFire * 0.85 - wSavanna * 0.45 - wDune * 0.85 - wVolcano * 0.8);
  return out;
}

// 18 Curated Planetary Poses: [camX, camY, camZ, lookX, lookY, lookZ]
const POSES = [
  [ -24,  2.8,   9,   24,  1.6,  17], // 0: The River Sanctuary
  [-102,  2.4,  46, -124,  1.8,  68], // 1: The Cypress Swamp
  [  88,  5.5, -55,  118,  7.0, -82], // 2: The Amazon Emerald Canopy
  [ -16,  2.1,  78,  -20,  1.5, 106], // 3: The Mangrove Passage
  [ -14,  2.7, -68,  -14,  2.2, -104],// 4: Sunlit Wildlife Clearing & Wildflowers
  [  48,  6.8,-132,   72,  5.6,-156], // 5: Overgrown Heritage Plantations
  [-192,  4.2, -24, -228,  3.6, -42], // 6: The Serengeti Savanna & Acacia Kopjes
  [ 195,  7.2, -82,  226,  6.5,-104], // 7: The Misty Bamboo & Monsoon Jungle
  [ 156, 13.5,-192,  184, 12.2,-220], // 8: The Virunga Cloud Forest & Ape Highlands
  [ -12,  2.6, 168,  -12,  1.2, 198], // 9: The Golden Tropical Beach & Palm Atoll
  [ -88, -2.4, 224, -102, -3.6, 250], // 10: The Sunlit Coral Reef & Kelp Basin
  [  46, -5.8, 252,   64, -7.2, 276], // 11: The Abyssal Garden & Sunken Galleon
  [-198,  3.8, 232, -224,  2.4, 254], // 12: The Sub-Antarctic Rookery & Southern Swell
  [ 198,  6.2, 240,  224,  4.8, 264], // 13: The Polar Ice Planet & Glacial Shelf
  [ 124,  6.2,  92,  156,  5.2, 116], // 14: Forbidden Zone I: The Burning Forest
  [ 224,  9.5,  26,  252,  6.8,  44], // 15: Forbidden Zone II: Obsidian Volcanic Caldera
  [-128,  4.8,-108, -156,  3.5,-132], // 16: Forbidden Zone III: Bioluminescent Cenote
  [-214,  6.4,-168, -244,  5.2,-194]  // 17: Forbidden Zone IV: Skeleton Coast & Red Dunes
];

// Rich Biome Metadata for the Interactive Planetary Map & HUD Telemetry
const BIOME_CATALOG = [
  { id: 0,  name: 'The River Sanctuary', category: 'Wetlands & Rivers', pos: LAGOON_POS, elev: '+0.4m', weather: 'Golden Sunlight', species: 'River Otters, Capybaras, Manatees, Kingfishers, Caimans' },
  { id: 1,  name: 'The Cypress Swamp', category: 'Wetlands & Rivers', pos: CYPRESS_POS, elev: '+0.2m', weather: 'Swamp Morning Mist', species: 'Alligators, Great Egrets, Tree Frogs, Florida Panthers' },
  { id: 2,  name: 'The Amazon Emerald Canopy', category: 'Tropical Rainforest', pos: AMAZON_POS, elev: '+8.5m', weather: 'Tropical Monsoon', species: 'Scarlet Macaws, Toucans, Spider Monkeys, Sloths, Tapirs' },
  { id: 3,  name: 'The Mangrove Passage', category: 'Wetlands & Rivers', pos: MANGROVE_POS, elev: '+0.1m', weather: 'Swamp Morning Mist', species: 'Green Iguanas, Raccoons, Roseate Spoonbills, Reef Fish' },
  { id: 4,  name: 'Wildlife Clearing & Wildflower Fields', category: 'Meadows & Terraces', pos: CLEARING_POS, elev: '+1.8m', weather: 'Golden Sunlight', species: 'White-Tailed Deer, Black Bears, Blue Morpho Butterflies' },
  { id: 5,  name: 'Overgrown Heritage Plantations', category: 'Meadows & Terraces', pos: PLANTATION_POS, elev: '+5.4m', weather: 'Golden Sunlight', species: 'Chimpanzees, Toucans, Capybaras, Wild Banana & Cacao Groves' },
  { id: 6,  name: 'Serengeti Savanna & Acacia Kopjes', category: 'Savanna & Jungle', pos: SAVANNA_POS, elev: '+3.2m', weather: 'Savanna Heat Haze', species: 'African Lions, Elephants, Reticulated Giraffes, Plains Zebras' },
  { id: 7,  name: 'Misty Bamboo & Monsoon Jungle', category: 'Savanna & Jungle', pos: BAMBOO_POS, elev: '+9.2m', weather: 'Tropical Monsoon', species: 'Bengal Tigers, Black Panthers, Giant Bamboo Groves' },
  { id: 8,  name: 'Virunga Cloud Forest & Ape Highlands', category: 'Savanna & Jungle', pos: HIGHLAND_POS, elev: '+16.4m', weather: 'Swamp Morning Mist', species: 'Silverback Mountain Gorillas, Chimpanzees, Harpy Eagles' },
  { id: 9,  name: 'Golden Tropical Beach & Palm Atoll', category: 'Coast & Ocean', pos: BEACH_POS, elev: '+0.8m', weather: 'Coastal Shorebreak Surf', species: 'Sea Turtles, Flamingos, Coconut Palms, Shorebreak Surf' },
  { id: 10, name: 'Sunlit Coral Reef & Kelp Basin', category: 'Coast & Ocean', pos: REEF_POS, elev: '-5.2m', weather: 'Coastal Shorebreak Surf', species: 'Manta Rays, Sea Turtles, Tropical Reef Fish, Giant Kelp' },
  { id: 11, name: 'Abyssal Garden & Sunken Galleon', category: 'Coast & Ocean', pos: ABYSS_POS, elev: '-14.8m', weather: 'Coastal Shorebreak Surf', species: 'Humpback Whales, Orcas, Great White Sharks, Sunken Galleon' },
  { id: 12, name: 'Sub-Antarctic Rookery & Southern Swell', category: 'Polar Realm', pos: ROOKERY_POS, elev: '+2.4m', weather: 'Polar Blizzard', species: 'Emperor Penguins, Leopard Seals, Orcas, Southern Swell' },
  { id: 13, name: 'The Polar Ice Planet & Glacial Shelf', category: 'Polar Realm', pos: POLAR_POS, elev: '+6.8m', weather: 'Polar Night Aurora', species: 'Polar Bears, Humpback Whales, Emperor Penguins, Aurora Australis' },
  { id: 14, name: 'Forbidden Zone I: The Burning Forest', category: 'Forbidden Zones', pos: FIRE_POS, elev: '+4.6m', weather: 'Volcanic Ash & Wildfire', species: 'Fleeing Deer, Jaguars, Crown Blaze & Rising Ember Plumes' },
  { id: 15, name: 'Forbidden Zone II: Obsidian Volcanic Caldera', category: 'Forbidden Zones', pos: VOLCANO_POS, elev: '+12.5m', weather: 'Volcanic Ash & Wildfire', species: 'Soaring Eagles, Molten Lava Channels, Basalt Spires' },
  { id: 16, name: 'Forbidden Zone III: Bioluminescent Cenote', category: 'Forbidden Zones', pos: FORGOTTEN_POS, elev: '+3.8m', weather: 'Polar Night Aurora', species: 'Jaguars, Spectacled Owls, Glowing Mycena Fungi & Karst Pool' },
  { id: 17, name: 'Forbidden Zone IV: Skeleton Coast & Red Dunes', category: 'Forbidden Zones', pos: DUNE_POS, elev: '+7.6m', weather: 'Savanna Heat Haze', species: 'African Lions, Elephants, Singing Namib Dunes & Whale Bones' }
];

const _tmpT = {};
function biomeLabelAt(x, y, z) {
  terrainAt(x, z, _tmpT);
  if (y < -0.15) {
    if (_tmpT.abyss > 0.22 || y < -8.0) return 'The Abyssal Garden & Sunken Galleon';
    if (_tmpT.reef > 0.20 || z > 185) return 'The Sunlit Coral Reef & Kelp Basin';
    if (_tmpT.polar > 0.25) return 'Under-Ice Polar Abyss';
    return 'Submerged Emerald Lagoon';
  }
  if (_tmpT.volcano > 0.28)    return 'Forbidden Zone II: Obsidian Volcanic Caldera';
  if (_tmpT.fire > 0.28)       return 'Forbidden Zone I: The Burning Forest';
  if (_tmpT.forgotten > 0.28)  return 'Forbidden Zone III: Bioluminescent Cenote';
  if (_tmpT.dune > 0.28)       return 'Forbidden Zone IV: Skeleton Coast & Red Dunes';
  if (_tmpT.polar > 0.32 && x > 0) return 'The Polar Ice Planet & Glacial Shelf';
  if (_tmpT.rookery > 0.28)    return 'The Sub-Antarctic Rookery & Southern Swell';
  if (_tmpT.abyss > 0.28)      return 'The Abyssal Garden & Trench Surface';
  if (_tmpT.reef > 0.28)       return 'The Sunlit Coral Reef & Kelp Basin';
  if (_tmpT.beach > 0.26 || (z > 162 && z < 210 && abs(x) < 95)) return 'The Golden Tropical Beach & Palm Atoll';
  if (_tmpT.highland > 0.28)   return 'The Virunga Cloud Forest & Ape Highlands';
  if (_tmpT.bamboo > 0.28)     return 'The Misty Bamboo & Monsoon Jungle';
  if (_tmpT.savanna > 0.28)    return 'The Serengeti Savanna & Acacia Kopjes';
  if (_tmpT.plantation > 0.28) return 'Overgrown Heritage Plantations';
  if (_tmpT.mangrove > 0.32)   return 'The Mangrove Passage';
  if (_tmpT.swamp > 0.32)      return 'The Cypress Swamp';
  if (_tmpT.amazon > 0.32)     return 'The Amazon Emerald Canopy';
  if (_tmpT.clearing > 0.32)   return 'Wildlife Clearing & Wildflower Fields';
  return 'The River Sanctuary';
}

export {
  WORLD_HALF,
  LAGOON_POS, POND_POS, CYPRESS_POS, AMAZON_POS, MANGROVE_POS,
  CLEARING_POS, PLANTATION_POS, SAVANNA_POS, BAMBOO_POS, HIGHLAND_POS,
  BEACH_POS, REEF_POS, ABYSS_POS, ROOKERY_POS, POLAR_POS,
  FIRE_POS, VOLCANO_POS, FORGOTTEN_POS, DUNE_POS,
  ABYSS_ARCHES, BIOME_CATALOG,
  riverZ, riverWidth, streamDist, terrainAt, POSES, biomeLabelAt
};
