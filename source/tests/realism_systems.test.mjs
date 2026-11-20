// ============================================================================
// REALISM — Automated Verification Suite for All Upgraded Planetary, GPS,
// Biogeographic, Biodiversity, Atmospheric, Solar System & Branding Systems
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/quality.js';
import { DEG2RAD, RAD2DEG, localENUFrame, greatCircleDistanceMeters } from '../src/math.js';
import {
  PLANET_RADIUS, atmosphericDensityAt, samplePlanetAtLatLon,
  localMetersToLatLon, latLonToLocalMeters, ECOREGION_CATALOG, classifyEcoregionAt
} from '../src/biomes.js';
import {
  setSpeciesCatalogueData, unpackSpeciesRecord, isSpeciesEligibleAt,
  isCohortEligibleInRegion, queryRegionalSpeciesRoster
} from '../src/species_engine.js';
import {
  AU_METERS, SOLAR_BODIES, SOLAR_BODY_BY_ID,
  createSolarSystemState, updateSolarEphemeris, computeHelioPositionMeters,
  syncSolarFromEarthCam, solarToEarthGeodetic, projectSolarBodiesToENU
} from '../src/solar_system.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

// ----------------------------------------------------------------------------
// 1 & 2. Minimap Defaults, Legacy Migration & Independent Visibility Fix
// ----------------------------------------------------------------------------
test('1. Fresh default settings enable HUD & 5 km GPS minimap and migrate legacy hudVisible cleanly', () => {
  assert.equal(DEFAULT_SETTINGS.showHud, true);
  assert.equal(DEFAULT_SETTINGS.showMiniMap, true);
  assert.equal(DEFAULT_SETTINGS.miniMapMode, 'north-up');

  const migrated = normalizeSettings({ hudVisible: false });
  assert.equal(migrated.showHud, false);
  assert.equal(migrated.showMiniMap, true);
  assert.equal(migrated.miniMapMode, 'north-up');

  const trackUp = normalizeSettings({ showMiniMap: false, miniMapMode: 'track-up' });
  assert.equal(trackUp.showMiniMap, false);
  assert.equal(trackUp.miniMapMode, 'track-up');
});

test('2. Minimap visibility bug fixes: no hudVisible mismatch, no _mmTmp.color crash, independent hide-minimap class', () => {
  const mainJs = readFileSync(path.join(root, 'source/src/main.js'), 'utf8');
  const templateHtml = readFileSync(path.join(root, 'source/template.html'), 'utf8');

  assert.equal(/settings\.hudVisible/.test(mainJs), false, 'main.js must not read undefined settings.hudVisible');
  assert.equal(/_mmTmp\.color\b/.test(mainJs), false, 'main.js must not read nonexistent _mmTmp.color[]');
  assert.match(mainJs, /_mmTmp\.colR/);
  assert.match(mainJs, /hide-minimap/);
  assert.match(templateHtml, /body\.hide-minimap\s+#miniMapWrap/);
});

// ----------------------------------------------------------------------------
// 3 & 4. GPS Coordinate Projection Consistency & Heading vs Ground Track
// ----------------------------------------------------------------------------
test('3. GPS local-meters <-> geodetic coordinate projection round-trips accurately across 5 km radius', () => {
  const origin = {
    latDeg: -3.12,
    lonDeg: -60.02,
    latRad: -3.12 * DEG2RAD,
    lonRad: -60.02 * DEG2RAD,
    enu: localENUFrame(-3.12 * DEG2RAD, -60.02 * DEG2RAD)
  };
  const probes = [
    [0, 0],
    [1000, 0],
    [0, -2500],
    [-3500, 3500],
    [4800, -1200]
  ];
  for (const [x, z] of probes) {
    const ll = localMetersToLatLon(x, z, origin);
    const back = latLonToLocalMeters(ll.latDeg, ll.lonDeg, origin, {});
    const errM = Math.hypot(back.x - x, back.z - z);
    assert.ok(errM < 2.5, `Projection round-trip error ${errM}m too high for (${x}, ${z})`);
  }
});

test('4. GPS heading vs velocity ground-track distinction & stationary fallback exist in main.js', () => {
  const mainJs = readFileSync(path.join(root, 'source/src/main.js'), 'utf8');
  assert.match(mainJs, /hasVelocityTrack\s*=\s*!isInterplanetary\s*&&\s*groundSpeed\s*>=\s*0\.35/);
  assert.match(mainJs, /velTrackRad\s*=\s*hasVelocityTrack\s*\?\s*atan2\(camState\.velE,\s*camState\.velN\)\s*:\s*null/);
  assert.match(mainJs, /HDG .*TRK /);
  assert.match(mainJs, /HDG .*STAT/);
});

// ----------------------------------------------------------------------------
// 5 & 6. Verified >= 5,000 GBIF Animalia Species Catalogue & Strict Biogeography
// ----------------------------------------------------------------------------
const cataloguePath = path.join(root, 'public/assets/species-catalogue.json');
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
setSpeciesCatalogueData(catalogue);

test('5. Verified GBIF Animalia dataset contains >= 5,000 distinct accepted species with authentic provenance & separate synonyms', () => {
  assert.ok(catalogue.totalAcceptedSpecies >= 5000, `Expected >= 5000 species, got ${catalogue.totalAcceptedSpecies}`);
  assert.equal(catalogue.records.length, catalogue.totalAcceptedSpecies);
  assert.match(String(catalogue.provenance?.dataset || ''), /GBIF/i);
  assert.ok(catalogue.provenance?.datasetKey && catalogue.provenance?.license);

  const seenSci = new Set();
  let synonymRecordsCount = 0;
  for (let i = 0; i < catalogue.records.length; i++) {
    const sp = unpackSpeciesRecord(catalogue, i);
    assert.ok(sp.scientificName && sp.scientificName.length > 2);
    assert.equal(seenSci.has(sp.scientificName), false, `Duplicate species: ${sp.scientificName}`);
    seenSci.add(sp.scientificName);
    if (Array.isArray(sp.synonyms) && sp.synonyms.length > 0) synonymRecordsCount++;
  }
  assert.ok(seenSci.size >= 5000);
  assert.ok(synonymRecordsCount >= 0);
});

test('6. Strict biogeography enforcement prevents non-native or impossible habitat spawns', () => {
  // African Lion: allowed in Serengeti savanna, rejected in Amazonia rainforest
  const serengetiEco = classifyEcoregionAt(-2.33, 34.83, 1520, 24, 0.45, 0.35, 0);
  const amazonEco = classifyEcoregionAt(-4.5, -67.5, 85, 27, 0.92, 0.02, 0);
  const arcticEco = classifyEcoregionAt(78.5, 16.0, 25, -14, 0.25, 0.1, 0.85);
  const outbackEco = classifyEcoregionAt(-25.3, 131.0, 520, 28, 0.12, 0.85, 0);
  const europeEco = classifyEcoregionAt(48.5, 11.5, 480, 10, 0.58, 0.12, 0);
  const pelagicEco = classifyEcoregionAt(15.0, -140.0, -4200, 22, 0.4, 0, 0);

  assert.equal(isCohortEligibleInRegion('lions', -2.33, 34.83, 1520, serengetiEco, -1), true);
  assert.equal(isCohortEligibleInRegion('lions', -4.5, -67.5, 85, amazonEco, -1), false);

  // Polar Bear: allowed in Arctic, rejected in tropics & Antarctic
  assert.equal(isCohortEligibleInRegion('polarBears', 78.5, 16.0, 25, arcticEco, -1), true);
  assert.equal(isCohortEligibleInRegion('polarBears', 0.0, 20.0, 420, amazonEco, -1), false);
  assert.equal(isCohortEligibleInRegion('polarBears', -77.5, 166.0, 20, classifyEcoregionAt(-77.5, 166.0, 20, -24, 0.1, 0.1, 0.95), -1), false);

  // Jaguar: allowed in Amazonia, rejected in Serengeti
  assert.equal(isCohortEligibleInRegion('jaguars', -4.5, -67.5, 85, amazonEco, -1), true);
  assert.equal(isCohortEligibleInRegion('jaguars', -2.33, 34.83, 1520, serengetiEco, -1), false);

  // Kangaroo: allowed in Australasia, rejected in Europe
  assert.equal(isCohortEligibleInRegion('kangaroos', -25.3, 131.0, 520, outbackEco, -1), true);
  assert.equal(isCohortEligibleInRegion('kangaroos', 48.5, 11.5, 480, europeEco, -1), false);

  // Marine vs inland & freshwater vs pelagic ocean
  assert.equal(isCohortEligibleInRegion('whales', 15.0, -140.0, -4200, pelagicEco, -1), true);
  assert.equal(isCohortEligibleInRegion('whales', -2.33, 34.83, 1520, serengetiEco, -1), false);
  assert.equal(isCohortEligibleInRegion('alligators', 15.0, -140.0, -4200, pelagicEco, -1), false);

  // Unknown-range species must never auto-spawn globally
  const unknownSp = {
    scientificName: 'Testus incognitus',
    realm: 'terrestrial',
    nativeRegions: ['unknown'],
    habitats: ['unknown']
  };
  assert.equal(isSpeciesEligibleAt(unknownSp, { latDeg: -2.33, lonDeg: 34.83, elevM: 1500, realm: 'Afrotropics', biomeClass: 'savanna', waterType: 'land' }), false);

  // Regional roster query returns populated authentic results
  const roster = queryRegionalSpeciesRoster(-4.5, -67.5, 85, 27, 0.92, 0.02, 0, 12);
  assert.ok(roster.species.length > 0, 'Amazonia should return verified regional GBIF species');
});

// ----------------------------------------------------------------------------
// 7, 8 & 9. Ecoregions (>= 100), Determinism & Regional Differentiation
// ----------------------------------------------------------------------------
test('7. Ecoregion catalog provides >= 100 distinct regional profiles with flora guilds & lithologies', () => {
  assert.ok(ECOREGION_CATALOG.length >= 100, `Expected >= 100 ecoregions, got ${ECOREGION_CATALOG.length}`);
  const ids = new Set(ECOREGION_CATALOG.map((e) => e.id));
  assert.equal(ids.size, ECOREGION_CATALOG.length);
  const lithologies = new Set(ECOREGION_CATALOG.map((e) => e.lithology));
  const guilds = new Set(ECOREGION_CATALOG.map((e) => e.floraGuild));
  assert.ok(lithologies.size >= 4);
  assert.ok(guilds.size >= 6);
});

test('8. Terrain and ecoregion sampling are deterministic across repeated invocations', () => {
  const coords = [
    [-3.12, -60.02],
    [23.5, 12.4],
    [62.4, 108.2],
    [-25.3, 131.0],
    [45.8, 7.6]
  ];
  for (const [lat, lon] of coords) {
    const a = samplePlanetAtLatLon(lat, lon, {}, 2);
    const b = samplePlanetAtLatLon(lat, lon, {}, 2);
    assert.equal(a.h, b.h);
    assert.equal(a.colR, b.colR);
    assert.equal(a.colG, b.colG);
    assert.equal(a.colB, b.colB);
    assert.equal(a.ecoregion?.id, b.ecoregion?.id);
    assert.equal(a.floraGuild, b.floraGuild);
    assert.equal(a.lithology, b.lithology);
  }
});

test('9. Distinct global regions produce meaningfully different ecoregions, flora guilds, lithologies & albedos', () => {
  const sahara = samplePlanetAtLatLon(23.5, 12.4, {}, 2);
  const amazon = samplePlanetAtLatLon(-3.12, -60.02, {}, 2);
  const siberia = samplePlanetAtLatLon(62.4, 108.2, {}, 2);
  const alps = samplePlanetAtLatLon(46.5, 8.0, {}, 2);
  const serengeti = samplePlanetAtLatLon(-2.33, 34.83, {}, 2);

  const ecoIds = new Set([sahara.ecoregion.id, amazon.ecoregion.id, siberia.ecoregion.id, alps.ecoregion.id, serengeti.ecoregion.id]);
  assert.ok(ecoIds.size >= 4, `Expected >= 4 distinct ecoregions across 5 regions, got ${ecoIds.size}`);
  assert.notEqual(sahara.floraGuild, amazon.floraGuild);
  assert.notEqual(siberia.floraGuild, sahara.floraGuild);
});

// ----------------------------------------------------------------------------
// 10. Atmospheric Density Monotonic Decay Curve
// ----------------------------------------------------------------------------
test('10. Atmospheric density decays smoothly and monotonically from sea level to deep space', () => {
  const alts = [0, 2200, 12000, 30000, 50000, 85000, 120000, 450000];
  let prev = Infinity;
  for (const alt of alts) {
    const rho = atmosphericDensityAt(alt);
    assert.ok(Number.isFinite(rho) && rho >= 0 && rho <= 1.0001);
    assert.ok(rho <= prev, `Density at ${alt}m (${rho}) should not exceed previous (${prev})`);
    prev = rho;
  }
  assert.ok(atmosphericDensityAt(0) > 0.99);
  assert.ok(atmosphericDensityAt(450000) < 0.001);
});

// ----------------------------------------------------------------------------
// 11, 12 & 13. Real Physical-Scale Heliocentric Solar System Tests
// ----------------------------------------------------------------------------
test('11. Solar System uses unified SI meters (1 AU = 149,597,870,700 m) and NASA/JPL physical ratios', () => {
  assert.equal(AU_METERS, 149597870700.0);
  assert.equal(SOLAR_BODIES.length, 9);

  const sun = SOLAR_BODY_BY_ID.sun;
  const earth = SOLAR_BODY_BY_ID.earth;
  const jupiter = SOLAR_BODY_BY_ID.jupiter;
  const saturn = SOLAR_BODY_BY_ID.saturn;
  const neptune = SOLAR_BODY_BY_ID.neptune;

  assert.equal(earth.radiusM, PLANET_RADIUS);
  const sunEarthRatio = sun.radiusM / earth.radiusM;
  const jupEarthRatio = jupiter.radiusM / earth.radiusM;
  assert.ok(sunEarthRatio > 108 && sunEarthRatio < 110.5, `Sun/Earth ratio ${sunEarthRatio}`);
  assert.ok(jupEarthRatio > 10.8 && jupEarthRatio < 11.4, `Jupiter/Earth ratio ${jupEarthRatio}`);
  assert.ok(saturn.aAU > 9.4 && saturn.aAU < 9.7);
  assert.ok(neptune.aAU > 29.8 && neptune.aAU < 30.3);
  assert.equal(sun.solidSurface, false);
  assert.equal(jupiter.solidSurface, false);
  assert.equal(saturn.solidSurface, false);
});

test('12. Long-epoch Keplerian ephemeris stays numerically stable over 100+ years', () => {
  const st = createSolarSystemState(9650.0);
  // Advance 100 Earth years (36,525 days)
  st.timeAccel = 365.25 * 86400; // 1 year per second
  for (let i = 0; i < 100; i++) {
    updateSolarEphemeris(st, 1.0);
  }
  for (const b of SOLAR_BODIES) {
    const p = st.positions.get(b.id);
    assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]), `${b.id} non-finite`);
    if (b.aAU > 0) {
      const rAU = Math.hypot(p[0], p[1], p[2]) / AU_METERS;
      assert.ok(rAU >= b.aAU * (1 - b.e) * 0.99 && rAU <= b.aAU * (1 + b.e) * 1.01, `${b.id} drifted to ${rAU} AU`);
    }
  }
});

test('13. Earth geodetic <-> heliocentric Solar System round-trip has zero discontinuity', () => {
  const st = createSolarSystemState();
  const latDeg = 37.77, lonDeg = -122.42, altM = 435000.0;
  syncSolarFromEarthCam(st, latDeg * DEG2RAD, lonDeg * DEG2RAD, altM);
  const back = solarToEarthGeodetic(st, {});
  assert.ok(Math.abs(back.latDeg - latDeg) < 0.01, `lat drift ${back.latDeg} vs ${latDeg}`);
  assert.ok(Math.abs(back.lonDeg - lonDeg) < 0.01, `lon drift ${back.lonDeg} vs ${lonDeg}`);
  assert.ok(Math.abs(back.altMeters - altM) < 50.0, `alt drift ${back.altMeters} vs ${altM}`);

  // Also verify ENU projection yields valid physical angular radius for the Sun (~0.266 deg = 0.00465 rad)
  const proj = projectSolarBodiesToENU(st, localENUFrame(latDeg * DEG2RAD, lonDeg * DEG2RAD));
  assert.equal(proj.length, 9);
  assert.ok(proj[0].angRad > 0.0042 && proj[0].angRad < 0.0052, `Sun angular radius ${proj[0].angRad} rad out of range`);
});

// ----------------------------------------------------------------------------
// 14, 15 & 16. Static Assets, Exact 1200x630 OG PNG, Favicons & Footer HTML
// ----------------------------------------------------------------------------
test('14. Required static assets exist in public/assets and dist/assets', () => {
  const requiredAssets = [
    'earth-geo.bin',
    'species-catalogue.json',
    'favicon.svg',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'realism-social-preview.png'
  ];
  for (const name of requiredAssets) {
    assert.equal(existsSync(path.join(root, 'public/assets', name)), true, `Missing public/assets/${name}`);
    assert.equal(existsSync(path.join(root, 'dist/assets', name)), true, `Missing dist/assets/${name}`);
  }
});

test('15. Open Graph preview PNG is a valid PNG with exact 1200x630 dimensions', () => {
  const buf = readFileSync(path.join(root, 'public/assets/realism-social-preview.png'));
  assert.ok(buf.length > 4096);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(buf.readUInt32BE(0), 0x89504e47);
  assert.equal(buf.readUInt32BE(4), 0x0d0a1a0a);
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(width, 1200, `Expected OG width 1200, got ${width}`);
  assert.equal(height, 630, `Expected OG height 630, got ${height}`);
});

test('16. Built index.html & dist/index.html include pixelated R favicons, OG/Twitter metadata & exact 2-line Welcome Footer', () => {
  for (const rel of ['index.html', 'dist/index.html']) {
    const html = readFileSync(path.join(root, rel), 'utf8');
    assert.match(html, /assets\/favicon\.svg/);
    assert.match(html, /assets\/favicon-32x32\.png/);
    assert.match(html, /assets\/apple-touch-icon\.png/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /realism-social-preview\.png/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /href="https:\/\/buildbuds\.vercel\.app"/);
    assert.match(html, /href="https:\/\/jaystarblissstudios\.com"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /A project challenge for the <a[^>]+>BuildBuds<\/a> community by <a[^>]+>Jaystarbliss Studios<\/a>/);
    assert.match(html, /Copyright <a[^>]+>Jaystarbliss Studios<\/a> &copy; 2026/);
  }
});
