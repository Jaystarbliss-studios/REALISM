import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PI, DEG2RAD, RAD2DEG, WORLD_SEED, seedRng, rnd, fbm3, ridged3,
  m4Persp, m4Look, m4Mul, m4Inv, smin, smax, solveTwoBoneIK,
  normAngle, lerpAngle, yawToForward, velocityToYaw,
  oblateRadiusAtSinLat, latLonToDir, dirToLatLon, geodeticToEcef, ecefToGeodetic,
  localENUFrame, moveAlongGeodesic, greatCircleDistanceMeters, cubeFaceUVToDir, dirToCubeFaceUV
} from '../src/math.js';
import {
  PLANET_RADIUS, PLANET_EQUATORIAL_RADIUS, PLANET_POLAR_RADIUS, PLANET_CIRCUMFERENCE,
  KARMAN_LINE_ALT, ATMOSPHERE_LAYERS, atmosphericDensityAt, gravityAt,
  atmosphericLayerAt, reentryStageAt, stepAtmosphericReentry,
  BIOME_CATALOG, POSES, setActiveOrigin, getActiveOrigin,
  samplePlanetAtDir, samplePlanetAtLatLon, terrainAt, localMetersToLatLon, latLonToLocalMeters,
  nearestBiomeAtGeo, biomeLabelAtGeo, evaluateHazardAt,
  TILE_GRID, TILE_SURF_VERTS, TILE_TOTAL_VERTS, TILE_FLOATS_PER_VERT, CubeSphereQuadtree
} from '../src/biomes.js';
import {
  DEFAULT_SETTINGS, QUALITY_TIERS, loadSettings, saveSettings, resetSettings, createQualityController
} from '../src/quality.js';
import { buildWorld } from '../src/world.js';
import { generateMaterialAtlas, PROCEDURAL_MATERIALS, TEX_SIZE, TEX_LAYERS } from '../src/assets.js';
import * as shaders from '../src/shaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('1. True Earth-Scale WGS-84 Geodesy, Circumnavigation, Polar Crossing & Non-Repeating Continents', () => {
  assert.strictEqual(PLANET_RADIUS, 6371000, 'Mean Earth radius must be 6,371,000 m');
  assert.strictEqual(PLANET_EQUATORIAL_RADIUS, 6378137, 'WGS-84 equatorial radius must be 6,378,137 m');
  assert.strictEqual(PLANET_POLAR_RADIUS, 6356752, 'WGS-84 polar radius must be 6,356,752 m');
  assert.ok(Math.abs(PLANET_CIRCUMFERENCE - 40075017) < 500, 'Equatorial circumference must be ~40,075 km');

  // 1 degree of latitude ~= 111.2 km
  const degLatKm = greatCircleDistanceMeters(0, 0, 1, 0) / 1000;
  assert.ok(degLatKm > 110.5 && degLatKm < 111.8, `1° latitude expected ~111.2 km, got ${degLatKm.toFixed(3)} km`);

  // Longitude distance scales strictly with cos(lat)
  const degLonEqKm = greatCircleDistanceMeters(0, 0, 0, 1) / 1000;
  const degLon60Km = greatCircleDistanceMeters(60, 0, 60, 1) / 1000;
  assert.ok(Math.abs(degLon60Km / degLonEqKm - 0.5) < 0.01, `At 60°N, 1° lon should be half of equator (got ratio ${(degLon60Km / degLonEqKm).toFixed(4)})`);

  // Full equatorial circumnavigation round-trip (~40,075.017 km WGS-84 equatorial circumference returns to origin)
  let latR = 0, lonR = 0;
  const steps = 400;
  const stepMeters = (2 * PI * PLANET_EQUATORIAL_RADIUS) / steps;
  for (let i = 0; i < steps; i++) {
    const next = moveAlongGeodesic(latR, lonR, stepMeters, 0);
    latR = next.latRad;
    lonR = next.lonRad;
  }
  const residualKm = greatCircleDistanceMeters(0, 0, latR * RAD2DEG, lonR * RAD2DEG) / 1000;
  assert.ok(residualKm < 5.0, `Equatorial circumnavigation must return to origin within 5 km, got ${residualKm.toFixed(2)} km`);

  // Continuous North Pole crossing without singularity
  const poleCross = moveAlongGeodesic(89.0 * DEG2RAD, 20.0 * DEG2RAD, 0, 222400); // ~2° North past 89°N -> ~89°N opposite meridian
  assert.ok(Number.isFinite(poleCross.latDeg) && Number.isFinite(poleCross.lonDeg));
  assert.ok(poleCross.latDeg > 88.0 && poleCross.latDeg <= 90.0, `Expected ~89°N after crossing pole, got ${poleCross.latDeg}`);
  const lonDiff = Math.abs(normAngle((poleCross.lonDeg - 20.0) * DEG2RAD) * RAD2DEG);
  assert.ok(lonDiff > 165, `Crossing North Pole must flip longitude by ~180°, got Δlon=${lonDiff.toFixed(1)}°`);

  // Verify ECEF <-> Geodetic round-trip on oblate Earth
  const ecef = geodeticToEcef(37.5 * DEG2RAD, -122.4 * DEG2RAD, 12500);
  const back = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  assert.ok(Math.abs(back.latDeg - 37.5) < 1e-5 && Math.abs(back.lonDeg - (-122.4)) < 1e-5 && Math.abs(back.altMeters - 12500) < 0.05);

  // Verify non-repeating terrain across >1,000 km (NO 720-unit toroidal wrap!)
  setActiveOrigin(0, 0, -1);
  const h0 = terrainAt(0, 0, {}).h;
  const h720 = terrainAt(720, 0, {}).h;
  const h1440 = terrainAt(1440, 0, {}).h;
  const hFar = samplePlanetAtLatLon(12.0, 24.0, {}, 2).h;
  assert.ok(Math.abs(h0 - h720) > 1e-3 || Math.abs(h720 - h1440) > 1e-3, 'Terrain must NOT repeat every 720 meters');
  assert.ok(Number.isFinite(hFar));

  // Verify planetary ocean/land ratio is realistic Earth-like (not 100% land or 100% ocean)
  let landHits = 0, totalSamples = 0;
  for (let lat = -84; lat <= 84; lat += 12) {
    for (let lon = -180; lon < 180; lon += 15) {
      const s = samplePlanetAtLatLon(lat, lon, {}, 0);
      if (s.h >= 0) landHits++;
      totalSamples++;
    }
  }
  const landFrac = landHits / totalSamples;
  assert.ok(landFrac > 0.14 && landFrac < 0.55, `Expected realistic Earth-like land fraction (14%–55%), got ${(landFrac * 100).toFixed(1)}%`);

  // Verify all 18 curated biomes exist and span thousands of km across Earth
  assert.strictEqual(BIOME_CATALOG.length, 18);
  assert.strictEqual(POSES.length, 18);
  let maxDistKm = 0;
  for (let i = 0; i < BIOME_CATALOG.length; i++) {
    for (let j = i + 1; j < BIOME_CATALOG.length; j++) {
      const d = greatCircleDistanceMeters(
        BIOME_CATALOG[i].latDeg, BIOME_CATALOG[i].lonDeg,
        BIOME_CATALOG[j].latDeg, BIOME_CATALOG[j].lonDeg
      ) / 1000;
      if (d > maxDistKm) maxDistKm = d;
    }
  }
  assert.ok(maxDistKm > 12000, `Biomes must span genuine planetary distances (>12,000 km), max separation was ${maxDistKm.toFixed(0)} km`);
});

test('2. Genuine 6-Face Cube-Sphere Quadtree: Seam Continuity, SSE LOD, Bounded LRU Cache & Unified Globe Identity', () => {
  const qt = new CubeSphereQuadtree({ maxLod: 15, maxCachedTiles: 96, maxTilesPerFrame: 64, maxActiveTiles: 80 });

  // Determinism: regenerating the same tile produces bit-identical vertex arrays
  const tA = qt.generateTile(0, 4, 3, 5, 0);
  const tB = qt.generateTile(0, 4, 3, 5, 1);
  assert.strictEqual(tA.seed, tB.seed);
  assert.strictEqual(tA.verts.length, TILE_TOTAL_VERTS * TILE_FLOATS_PER_VERT);
  for (let i = 0; i < tA.verts.length; i++) {
    assert.strictEqual(tA.verts[i], tB.verts[i], `Tile determinism mismatch at float ${i}`);
  }

  // Same-face shared edge continuity (elevation & spherical normal match between neighbor tiles)
  const leftTile = qt.generateTile(4, 5, 10, 12, 0);
  const rightTile = qt.generateTile(4, 5, 11, 12, 1);
  const stride = TILE_GRID + 1;
  for (let gy = 0; gy <= TILE_GRID; gy++) {
    const lb = (gy * stride + TILE_GRID) * TILE_FLOATS_PER_VERT;
    const rb = (gy * stride + 0) * TILE_FLOATS_PER_VERT;
    assert.ok(Math.abs(leftTile.verts[lb + 3] - rightTile.verts[rb + 3]) < 1e-4, `Shared tile edge elevation mismatch at row ${gy}`);
    const dotN = leftTile.verts[lb + 4] * rightTile.verts[rb + 4]
               + leftTile.verts[lb + 5] * rightTile.verts[rb + 5]
               + leftTile.verts[lb + 6] * rightTile.verts[rb + 6];
    assert.ok(dotN > 0.999, `Shared tile edge spherical normal discontinuity at row ${gy} (dot=${dotN})`);
  }

  // Cross cube-face seam continuity (+Z face 4 right edge u=+1 vs +X face 0 left edge u=-1)
  const dirZ = cubeFaceUVToDir(4, 1.0, 0.25);
  const dirX = cubeFaceUVToDir(0, -1.0, 0.25);
  const seamDist = Math.hypot(dirZ[0] - dirX[0], dirZ[1] - dirX[1], dirZ[2] - dirX[2]);
  assert.ok(seamDist < 1e-6, `Cube-sphere +Z/+X seam directions must coincide (dist=${seamDist})`);
  const sZ = samplePlanetAtDir(dirZ[0], dirZ[1], dirZ[2], {}, 2);
  const sX = samplePlanetAtDir(dirX[0], dirX[1], dirX[2], {}, 2);
  assert.ok(Math.abs(sZ.h - sX.h) < 1e-5, 'Cross cube-face seam elevations must be identical');

  // All 6 cube faces are selected & covered from orbital view
  const ecefOrbit = geodeticToEcef(15 * DEG2RAD, 20 * DEG2RAD, 9000000);
  const tilesOrbit = qt.selectTiles(ecefOrbit, 9000000, 1.0, 900, 16.0, true);
  assert.ok(tilesOrbit.length >= 6, `Expected >=6 orbital tiles, got ${tilesOrbit.length}`);
  const orbitMaxLod = qt.stats.maxLodActive;

  // Descending to 80 m above surface increases SSE LOD refinement significantly
  const ecefLow = geodeticToEcef(-3.2 * DEG2RAD, -60.0 * DEG2RAD, 80);
  const tilesLow = qt.selectTiles(ecefLow, 80, 1.0, 900, 14.0, true);
  assert.ok(tilesLow.length > 0 && qt.stats.maxLodActive > orbitMaxLod + 4,
    `Near-surface LOD (${qt.stats.maxLodActive}) must refine dramatically deeper than orbital LOD (${orbitMaxLod})`);

  // Bounded LRU cache eviction: travel to multiple opposite locations & verify cache never exceeds limit
  for (const [lat, lon] of [[45, 90], [-45, -120], [72, 15], [-78, 160], [10, 140]]) {
    const cam = geodeticToEcef(lat * DEG2RAD, lon * DEG2RAD, 1500);
    qt.selectTiles(cam, 1500, 1.0, 900, 14.0, true);
    assert.ok(qt.cache.size <= qt.maxCachedTiles, `LRU cache exceeded maxCachedTiles (${qt.cache.size} > ${qt.maxCachedTiles})`);
  }
  assert.ok(qt.stats.evictedTotal > 0, 'LRU cache must evict stale tiles when exploring distant continents');

  // Unified Planet Identity: globe samplePlanetAtLatLon === local surface terrainAt at exact same geo coordinates
  for (const b of [BIOME_CATALOG[0], BIOME_CATALOG[6], BIOME_CATALOG[11], BIOME_CATALOG[13]]) {
    setActiveOrigin(b.latDeg, b.lonDeg, b.id);
    const globeSample = samplePlanetAtLatLon(b.latDeg, b.lonDeg, {}, 2);
    const localSample = terrainAt(0, 0, {});
    assert.ok(Math.abs(globeSample.h - localSample.h) < 1e-4,
      `Globe elevation (${globeSample.h}) and local terrain (${localSample.h}) must be identical at ${b.name}`);
  }
});

test('3. Continuous Atmospheric Re-Entry (450 km Orbit -> Touchdown) & Real Physical Atmospheric Layers', () => {
  assert.strictEqual(KARMAN_LINE_ALT, 100000);
  assert.strictEqual(atmosphericLayerAt(-50).code, 'OCEAN');
  assert.strictEqual(atmosphericLayerAt(2500).code, 'TROPO');
  assert.strictEqual(atmosphericLayerAt(28000).code, 'STRATO');
  assert.strictEqual(atmosphericLayerAt(68000).code, 'MESO');
  assert.strictEqual(atmosphericLayerAt(220000).code, 'THERMO');
  assert.strictEqual(atmosphericLayerAt(1500000).code, 'EXO');
  assert.strictEqual(atmosphericLayerAt(15000000).code, 'COSMOS');
  assert.ok(atmosphericDensityAt(0) > 0.99 && atmosphericDensityAt(120000) < 0.001, 'Density must decay exponentially with altitude');
  assert.ok(gravityAt(0) > 9.75 && gravityAt(400000) < gravityAt(0), 'Gravity must weaken with orbital altitude');

  // Simulate full continuous re-entry from 450 km over Serengeti Savanna (-2.33°S, 34.83°E)
  const target = BIOME_CATALOG[6]; // Serengeti Savanna
  const st = {
    latDeg: target.latDeg,
    lonDeg: target.lonDeg,
    latRad: target.latDeg * DEG2RAD,
    lonRad: target.lonDeg * DEG2RAD,
    altMeters: 450000,
    velE: 0,
    velN: 0,
    velU: -4500,
    yaw: 0,
    pitch: -0.7,
    reentryHeat: 0,
    groundH: 0,
    grounded: false
  };

  const visitedLayers = new Set();
  const visitedStages = new Set();
  let peakHeat = 0;
  let prevAlt = st.altMeters;
  let maxSingleStepDrop = 0;

  for (let step = 0; step < 3600 && !st.grounded; step++) {
    const dt = 0.05;
    const agl = st.altMeters - st.groundH;
    const wantDesc = -Math.max(12, Math.min(8500, agl * 0.35));
    stepAtmosphericReentry(st, {
      thrustE: 0,
      thrustN: 0,
      thrustU: (wantDesc - st.velU) * 1.5,
      gravityScale: 1.0,
      allowUnderwater: false,
      clearance: 1.75
    }, dt);

    const drop = prevAlt - st.altMeters;
    assert.ok(drop >= -1.0, `Altitude should descend continuously during re-entry (step ${step}, drop=${drop})`);
    if (drop > maxSingleStepDrop) maxSingleStepDrop = drop;
    // Never instantaneously teleport across hundreds of km in a single 50ms tick
    assert.ok(drop < 600, `Abrupt altitude jump detected during re-entry: ${drop.toFixed(1)} m in 50ms`);
    prevAlt = st.altMeters;

    visitedLayers.add(st.layer.code);
    visitedStages.add(st.stage);
    if (st.reentryHeat > peakHeat) peakHeat = st.reentryHeat;
  }

  assert.strictEqual(st.grounded, true, 'Continuous re-entry must smoothly reach surface touchdown');
  assert.ok(Math.abs(st.latDeg - target.latDeg) < 0.01 && Math.abs(st.lonDeg - target.lonDeg) < 0.01,
    `Re-entry must preserve (lat, lon) without snapping to biome 0 (ended at ${st.latDeg.toFixed(3)}, ${st.lonDeg.toFixed(3)})`);
  for (const code of ['THERMO', 'MESO', 'STRATO', 'TROPO']) {
    assert.ok(visitedLayers.has(code), `Continuous re-entry must traverse layer ${code}`);
  }
  assert.ok(visitedStages.size >= 7, `Expected >=7 distinct re-entry stages visited, got ${visitedStages.size}`);
  assert.ok(peakHeat > 0.05, `High-speed re-entry must produce measurable aerodynamic heating (peak=${peakHeat.toFixed(3)})`);
});

test('4. Species Orientation, Rebuilt Marine Anatomy, Event-Driven Whale Breaching, Slender Deer & Real CPU IK -> GPU', () => {
  setActiveOrigin(BIOME_CATALOG[11].latDeg, BIOME_CATALOG[11].lonDeg, 11); // Abyssal Garden ocean
  const world = buildWorld();
  assert.strictEqual(world.ANIMAL_INST_FLOATS, 12, 'Animal instance buffer must carry 12 floats including pitch, roll & IK');
  assert.ok(world.wildlifeGroups.length >= 40, `Expected >=40 wildlife cohorts, got ${world.wildlifeGroups.length}`);

  // Canonical heading roundtrip
  for (const deg of [-135, -90, 0, 45, 90, 180]) {
    const yaw = normAngle(deg * DEG2RAD);
    const [fx, fz] = yawToForward(yaw);
    const rec = velocityToYaw(fx * 4, fz * 4, 0);
    assert.ok(Math.abs(normAngle(rec - yaw)) < 1e-5);
  }

  // Every species mesh must be upright (maxY > minY) and finite
  for (const grp of world.wildlifeGroups) {
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < grp.verts.length; i += 11) {
      const vx = grp.verts[i], vy = grp.verts[i + 1], vz = grp.verts[i + 2];
      assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz), `Non-finite vertex in ${grp.name}`);
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
    }
    assert.ok(maxY > minY, `${grp.name} must have positive vertical extent`);
    assert.ok(maxZ > minZ, `${grp.name} must have positive longitudinal (+Z forward) extent`);
  }

  // Distinct marine species anatomy (Humpback vs Orca vs Great White Shark vs Manta Ray)
  const whaleGrp = world.wildlifeGroups.find((g) => g.name === 'whales');
  const orcaGrp = world.wildlifeGroups.find((g) => g.name === 'orcas');
  const sharkGrp = world.wildlifeGroups.find((g) => g.name === 'sharks');
  const mantaGrp = world.wildlifeGroups.find((g) => g.name === 'mantas');
  const deerGrp = world.wildlifeGroups.find((g) => g.name === 'deer');
  assert.ok(whaleGrp && orcaGrp && sharkGrp && mantaGrp && deerGrp, 'Must build whales, orcas, sharks, mantas & deer');

  // Verify Humpback & Orca are genuinely distinct meshes (not color-swapped clones)
  assert.notStrictEqual(whaleGrp.verts.length, orcaGrp.verts.length, 'Orca must use its own anatomical mesh, not the Humpback mesh');
  assert.notStrictEqual(sharkGrp.verts.length, whaleGrp.verts.length, 'Great White Shark must use its own anatomical mesh');

  // Verify Humpback adult body length ~12-16m (mesh length * scale)
  let wMinZ = Infinity, wMaxZ = -Infinity;
  for (let i = 2; i < whaleGrp.verts.length; i += 11) {
    if (whaleGrp.verts[i] < wMinZ) wMinZ = whaleGrp.verts[i];
    if (whaleGrp.verts[i] > wMaxZ) wMaxZ = whaleGrp.verts[i];
  }
  const whaleLenM = (wMaxZ - wMinZ) * whaleGrp.items[0].scale;
  assert.ok(whaleLenM >= 11.0 && whaleLenM <= 17.5, `Adult Humpback Whale length expected ~12-16 m, got ${whaleLenM.toFixed(1)} m`);

  // Verify Manta Ray wingspan > body length
  let mMinX = Infinity, mMaxX = -Infinity, mMinZ = Infinity, mMaxZ = -Infinity;
  for (let i = 0; i < mantaGrp.verts.length; i += 11) {
    if (mantaGrp.verts[i] < mMinX) mMinX = mantaGrp.verts[i];
    if (mantaGrp.verts[i] > mMaxX) mMaxX = mantaGrp.verts[i];
    if (mantaGrp.verts[i + 2] < mMinZ) mMinZ = mantaGrp.verts[i + 2];
    if (mantaGrp.verts[i + 2] > mMaxZ) mMaxZ = mantaGrp.verts[i + 2];
  }
  assert.ok((mMaxX - mMinX) > (mMaxZ - mMinZ) * 0.9, 'Manta ray must have wide diamond pectoral wings');

  // Event-driven Whale Breach FSM & Strictly Underwater Shark verification
  const marineEvents = [];
  world.setMarineEventCallback((ev) => marineEvents.push(ev));
  world.syncRegion(11, 0);

  // Trigger a single deliberate whale breach and simulate 24 seconds at 60 Hz steps
  const triggered = world.triggerWhaleBreach('whales', 0);
  assert.strictEqual(triggered, true, 'triggerWhaleBreach must start breach FSM on whale 0');
  const whale0 = whaleGrp.items[0];
  const seenStates = new Set([whale0.breachState]);
  let maxWhaleY = -999;
  let maxSharkY = -999;

  for (let s = 0; s < 1440; s++) {
    world.stepSim(1 / 60, 0, -2, 0, 0, 0.4);
    seenStates.add(whale0.breachState);
    if (whale0.y > maxWhaleY) maxWhaleY = whale0.y;
    for (const sh of sharkGrp.items) {
      if (!sh.inactiveInRegion && sh.y > maxSharkY) maxSharkY = sh.y;
    }
  }
  world.interpolateSim(0.5, -2, 0);

  assert.ok(maxSharkY <= -1.2, `Great White Sharks MUST remain strictly submerged (<= -1.25m), saw y=${maxSharkY.toFixed(2)}m`);
  assert.ok(maxWhaleY > 1.5, `Breaching Humpback Whale must clear water surface in ballistic arc (peak y=${maxWhaleY.toFixed(2)}m)`);
  for (const stName of ['approach', 'pitch_up', 'accelerate', 'launch', 'ballistic', 'impact', 'recovery', 'dive_return']) {
    assert.ok(seenStates.has(stName), `Whale breach FSM must progress through stage '${stName}'`);
  }
  assert.ok(whale0.breachCooldown > 15, `Completed breach must enforce long cooldown (>15s), got ${whale0.breachCooldown}`);
  assert.ok(marineEvents.some((e) => e.type === 'breach_impact'), 'Whale water impact must emit spatial breach_impact audio event');

  // Verify Redesigned Deer 2-Joint Limb UVs (0.36, 0.38, 0.42, 0.44) & Real CPU IK -> GPU instData[10..11]
  const deerUVs = new Set();
  for (let i = 9; i < deerGrp.verts.length; i += 11) {
    deerUVs.add(Math.round(deerGrp.verts[i] * 100) / 100);
  }
  assert.ok(deerUVs.has(0.36) && deerUVs.has(0.38) && deerUVs.has(0.42) && deerUVs.has(0.44),
    'Deer mesh must carry separate upper/lower front & hind articulated limb UVs (0.36, 0.38, 0.42, 0.44)');

  setActiveOrigin(BIOME_CATALOG[4].latDeg, BIOME_CATALOG[4].lonDeg, 4); // Sunlit Wildlife Clearing
  world.syncRegion(4, 0);
  let sawNonZeroIK = false;
  for (let s = 0; s < 120; s++) {
    world.stepSim(1 / 60, 0, 5, 0, 0, 0.35);
    world.interpolateSim(0.5, 5, 0);
    for (let i = 0; i < deerGrp.items.length; i++) {
      const ikF = deerGrp.instData[i * 12 + 10];
      const ikH = deerGrp.instData[i * 12 + 11];
      if (Math.abs(ikF) > 0.01 || Math.abs(ikH) > 0.01) sawNonZeroIK = true;
    }
  }
  assert.strictEqual(sawNonZeroIK, true, 'CPU solveTwoBoneIK() flexion must be written into deer instData[10..11] for W_ANIMAL');

  // Habitat-aware hazard avoidance: marine ignores lava/fire; land avoids deep water
  setActiveOrigin(BIOME_CATALOG[15].latDeg, BIOME_CATALOG[15].lonDeg, 15); // Volcanic Caldera
  const landVolcHaz = evaluateHazardAt(0, 0, 'land');
  const marineVolcHaz = evaluateHazardAt(0, 0, 'water');
  assert.ok(landVolcHaz.hazard > 0.25, 'Land fauna must detect volcanic thermal hazard');
  assert.notStrictEqual(marineVolcHaz.reason, 'thermal', 'Marine fauna must not react to wildfire/lava thermal hazards');
});

test('5. Procedural Material Atlas, Quality Settings, WGSL Structural Safety & REALISM Branding', () => {
  assert.strictEqual(PROCEDURAL_MATERIALS.length, 32);
  assert.strictEqual(TEX_LAYERS, 16);
  const data = generateMaterialAtlas();
  assert.strictEqual(data.length, TEX_SIZE * TEX_SIZE * TEX_LAYERS * 4);

  assert.strictEqual(QUALITY_TIERS.length, 4);
  const s = loadSettings();
  assert.strictEqual(s.fov, DEFAULT_SETTINGS.fov);
  saveSettings({ ...s, fov: 68 });
  assert.strictEqual(resetSettings().fov, DEFAULT_SETTINGS.fov);
  const qc = createQualityController(1);
  qc.setTier(0);
  assert.strictEqual(qc.tier.name, 'Ultra');

  for (const [name, code] of Object.entries(shaders)) {
    assert.ok(typeof code === 'string' && code.length > 100);
    let depth = 0;
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      assert.ok(depth >= 0, `Unbalanced '}' in ${name}`);
    }
    assert.strictEqual(depth, 0, `Unbalanced braces in ${name}`);

    const smRe = /smoothstep\(\s*(-?\d+(?:\.\d*)?)\s*,\s*(-?\d+(?:\.\d*)?)\s*,/g;
    let m;
    while ((m = smRe.exec(code)) !== null) {
      assert.ok(parseFloat(m[1]) < parseFloat(m[2]), `Invalid WGSL smoothstep(${m[1]}, ${m[2]}) in ${name}`);
    }

    // WGSL reserved keyword guard (prevents Tint compile errors like "'meta' is a reserved keyword")
    const wgslReserved = new Set([
      'NULL','Self','abstract','active','alignas','alignof','as','asm','asm_fragment','async','attribute','auto',
      'await','become','binding_array','cast','catch','class','co_await','co_return','co_yield','coherent',
      'column_major','common','compile','compile_fragment','concept','const_cast','consteval','constexpr',
      'constinit','crate','debugger','decltype','delete','demote','demote_to_helper','do','dynamic_cast','enum',
      'explicit','export','extends','extern','external','filter','final','finally','friend','from','fxgroup',
      'get','goto','groupshared','highp','impl','implements','import','inline','instanceof','interface','layout',
      'lowp','macro','match','mediump','meta','mod','module','move','mut','mutable','namespace','new','nil',
      'noexcept','noinline','nointerpolation','non_coherent','noncoherent','noperspective','null','nullptr','of',
      'operator','package','packoffset','partition','pass','patch','pixelfragment','precise','precision','premerge',
      'priv','protected','pub','public','readonly','ref','regardless','register','reinterpret_cast','require',
      'resource','restrict','self','set','shared','sizeof','smooth','snorm','static','static_assert','static_cast',
      'std','subroutine','super','target','template','this','thread_local','throw','trait','try','type','typedef',
      'typeid','typename','typeof','union','unless','unorm','unsafe','unsized','use','using','varying','virtual',
      'volatile','wgsl','where','with','writeonly','yield'
    ]);
    const stripped = code.replace(/\/\/.*$/gm, '');
    const ids = stripped.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
    for (const id of ids) {
      assert.ok(!wgslReserved.has(id), `WGSL reserved keyword '${id}' used in ${name}`);
    }
  }

  // Exact 96-float FrameU and 16-float PlanetU structs
  const frameUMatch = shaders.W_COMMON.match(/struct\s+FrameU\s*\{([\s\S]*?)\}/);
  assert.ok(frameUMatch, 'Must define FrameU in W_COMMON');
  const fMats = (frameUMatch[1].match(/mat4x4f/g) || []).length;
  const fVecs = (frameUMatch[1].match(/vec4f/g) || []).length;
  assert.strictEqual(fMats * 16 + fVecs * 4, 96, 'FrameU must be 96 floats (384 bytes)');

  const planetUMatch = shaders.W_COMMON.match(/struct\s+PlanetU\s*\{([\s\S]*?)\}/);
  assert.ok(planetUMatch, 'Must define PlanetU in W_COMMON');
  const pVecs = (planetUMatch[1].match(/vec4f/g) || []).length;
  assert.strictEqual(pVecs * 4, 16, 'PlanetU must be 16 floats (64 bytes)');

  // Verify removed architectural hacks stay gone
  assert.ok(!/WORLD_HALF/.test(shaders.W_COMMON), 'Removed legacy WORLD_HALF toroidal wrap from shaders');
  assert.ok(!/camPos\.y\s*>\s*390/.test(shaders.W_WATER), 'Removed legacy camPos.y > 390 ocean discard hack');
  assert.match(shaders.W_COMMON, /fn caus\(uv:\s*vec2f,\s*t:\s*f32\)\s*->\s*f32/, 'Preserved Noniv/abyssal-garden caus()');
  assert.match(shaders.W_COMMON, /1\.769/, 'Preserved Noniv/abyssal-garden Snell Window constant 1.769');
  assert.match(shaders.W_COMMON, /fn evalAurora/, 'Preserved under-atmosphere polar aurora');
  assert.ok(!/textureSampleCompare\s*\(/.test(shaders.W_TERRAIN), 'W_TERRAIN must use textureSampleCompareLevel');
  assert.ok(!/textureSampleCompare\s*\(/.test(shaders.W_VEG), 'W_VEG must use textureSampleCompareLevel');

  const srcDir = path.resolve(__dirname, '../src');
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert.ok(!/https?:\/\//.test(content), `External URL found in ${f}`);
    assert.ok(!/new\s+Image\s*\(/.test(content), `External Image loader found in ${f}`);
  }

  const mainSrc = fs.readFileSync(path.join(srcDir, 'main.js'), 'utf8');
  assert.match(mainSrc, /UB_FLOATS\s*=\s*96/);
  assert.match(mainSrc, /PB_FLOATS\s*=\s*16/);
  assert.ok(!/sp\.setBindGroup\(\s*1\s*,\s*bgEnv\s*\)/.test(mainSrc), 'Shadow pass must not bind bgEnv');

  const tplHtml = fs.readFileSync(path.resolve(__dirname, '../template.html'), 'utf8');
  assert.match(tplHtml, /border-radius:\s*0\s*!important/);
  assert.match(tplHtml, /REALISM/);
  assert.ok(!/Terra Primordia/i.test(tplHtml));
  assert.match(tplHtml, /id="settingsModal"/);
  assert.match(tplHtml, /id="openSettingsBtn"/);
});
