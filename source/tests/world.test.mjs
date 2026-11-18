import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_SEED, seedRng, rnd, fbm2, m4Persp, m4Look, m4Mul, m4Inv,
  smin, smax, solveTwoBoneIK, normAngle, lerpAngle, yawToForward, velocityToYaw, MeshBuilder
} from '../src/math.js';
import {
  WORLD_HALF, WORLD_SIZE, PLANET_RADIUS, PLANET_EQUATORIAL_RADIUS, PLANET_POLAR_RADIUS,
  SAVANNA_POS, PLANTATION_POS, BEACH_POS, REEF_POS, ABYSS_POS, POLAR_POS, VOLCANO_POS, FIRE_POS,
  BIOME_CATALOG, terrainAt, POSES, biomeLabelAt,
  wrapCoord, wrapDelta, worldToLatLonAlt, latLonToWorld, worldToCubeSphere,
  updateQuadtreeChunks, atmosphericLayerAt, evaluateHazardAt
} from '../src/biomes.js';
import {
  DEFAULT_SETTINGS, QUALITY_TIERS, loadSettings, saveSettings, resetSettings, createQualityController
} from '../src/quality.js';
import { buildWorld } from '../src/world.js';
import { generateMaterialAtlas, PROCEDURAL_MATERIALS, TEX_SIZE, TEX_LAYERS } from '../src/assets.js';
import * as shaders from '../src/shaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('1. Deterministic PRNG, 2D FBM noise, Smooth-Min (smin), Canonical Yaw/Forward & Analytical 2-Bone IK', () => {
  seedRng(WORLD_SEED);
  const a1 = rnd(), a2 = rnd();
  seedRng(WORLD_SEED);
  const b1 = rnd(), b2 = rnd();
  assert.strictEqual(a1, b1);
  assert.strictEqual(a2, b2);

  const n = fbm2(12.34, -56.78, 4);
  assert.ok(Number.isFinite(n) && n >= 0 && n <= 1, 'fbm2 must return finite [0, 1]');

  // Polynomial smooth-minimum (smin) must blend smoothly below min(a, b)
  const sm = smin(1.0, 1.0, 0.2);
  assert.ok(sm < 1.0 && sm > 0.85, `smin(1, 1, 0.2) expected ~0.95, got ${sm}`);
  assert.ok(smax(1.0, 1.0, 0.2) > 1.0, 'smax must blend smoothly above max(a, b)');

  // Canonical Creature Heading & Forward Vector Roundtrip (Local +Z -> World (-sin(yaw), cos(yaw)))
  for (const deg of [-150, -90, -45, 0, 30, 90, 135, 180]) {
    const yaw = normAngle((deg * Math.PI) / 180);
    const [fx, fz] = yawToForward(yaw);
    assert.ok(Math.abs(Math.hypot(fx, fz) - 1.0) < 1e-6, 'yawToForward must return unit vector');
    const recoveredYaw = velocityToYaw(fx * 3.5, fz * 3.5, 0);
    assert.ok(Math.abs(normAngle(recoveredYaw - yaw)) < 1e-5, `Canonical yaw/forward roundtrip failed at ${deg}°`);
  }
  // Shortest-arc lerpAngle across +-PI seam
  const seamAngle = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(Math.abs(seamAngle) - Math.PI) < 0.05, 'lerpAngle must interpolate across +-PI shortest arc');

  // Analytical 2-Bone IK solver must return finite knee/elbow and clamped foot coordinates
  const ik = solveTwoBoneIK(0, 1.0, 0, 0.2, 0.0, 0.1, 0, 0, 1, 0.55, 0.55);
  assert.ok(Number.isFinite(ik.midX) && Number.isFinite(ik.midY) && Number.isFinite(ik.midZ), 'IK joint must be finite');
  assert.ok(Number.isFinite(ik.endX) && Number.isFinite(ik.endY) && Number.isFinite(ik.endZ), 'IK effector must be finite');
  assert.strictEqual(ik.grounded, true, 'Reachable target must report grounded=true');
});

test('2. 4x4 Matrix Math & Inverse Projection Roundtrip', () => {
  const p = m4Persp(1.0, 16 / 9, 0.2, 620);
  const v = m4Look([10, 5, 10], [0, 2, 0], [0, 1, 0]);
  const vp = m4Mul(p, v);
  const inv = m4Inv(vp);
  const ident = m4Mul(vp, inv);
  assert.ok(Math.abs(ident[0] - 1) < 1e-4);
  assert.ok(Math.abs(ident[5] - 1) < 1e-4);
  assert.ok(Math.abs(ident[10] - 1) < 1e-4);
  assert.ok(Math.abs(ident[15] - 1) < 1e-4);
});

test('3. Earth-Scale Geodesics (6,371 km), Cube-Sphere Projection, Quadtree Streaming & Continuous 18-Biome Topography', () => {
  assert.strictEqual(PLANET_RADIUS, 6371000, 'PLANET_RADIUS must equal true Earth mean radius 6,371,000 m');
  assert.ok(PLANET_EQUATORIAL_RADIUS > PLANET_POLAR_RADIUS, 'Oblate spheroid equatorial radius must exceed polar radius');

  // Geodesic wrapping across planetary boundary
  assert.ok(Math.abs(wrapCoord(WORLD_HALF + 25) - (-WORLD_HALF + 25)) < 1e-5, 'wrapCoord must wrap smoothly across +WORLD_HALF');
  assert.ok(Math.abs(wrapDelta(WORLD_HALF - 5, -WORLD_HALF + 5) - (-10)) < 1e-5, 'wrapDelta must compute shortest wrapped distance');

  // Lat/Lon roundtrip and 6-face Cube-Sphere coverage
  const geo = worldToLatLonAlt(108, 45, -72);
  assert.ok(Number.isFinite(geo.lat) && Number.isFinite(geo.lon) && Number.isFinite(geo.altKm));
  const back = latLonToWorld(geo.latDeg, geo.lonDeg);
  assert.ok(Math.abs(back.x - 108) < 1e-3 && Math.abs(back.z - (-72)) < 1e-3, 'latLonToWorld must invert worldToLatLonAlt');

  const seenFaces = new Set();
  for (let lat = -80; lat <= 80; lat += 40) {
    for (let lon = -180; lon <= 180; lon += 45) {
      const pt = latLonToWorld(lat, lon);
      const cs = worldToCubeSphere(pt.x, 0, pt.z);
      assert.ok(cs.face >= 0 && cs.face <= 5, `Cube-sphere face must be 0..5, got ${cs.face}`);
      assert.ok(cs.u >= -1.001 && cs.u <= 1.001 && cs.v >= -1.001 && cs.v <= 1.001, 'Cube-sphere u,v must lie in [-1, 1]');
      seenFaces.add(cs.face);
    }
  }
  assert.ok(seenFaces.size >= 5, 'worldToCubeSphere must project across cube-sphere faces');

  // Atmospheric & Deep-Space Vertical Layers
  assert.strictEqual(atmosphericLayerAt(-14).code, 'OCEAN');
  assert.strictEqual(atmosphericLayerAt(10).code, 'TROPO');
  assert.strictEqual(atmosphericLayerAt(200).code, 'STRATO');
  assert.strictEqual(atmosphericLayerAt(950).code, 'THERMO');
  assert.strictEqual(atmosphericLayerAt(1500).code, 'EXO');
  assert.strictEqual(atmosphericLayerAt(2600).code, 'COSMOS');

  // Hazard evaluation for terrestrial and aquatic fauna
  const fireHaz = evaluateHazardAt(FIRE_POS[0], FIRE_POS[1], 'land');
  assert.ok(fireHaz.hazard > 0.35, 'Terrestrial fauna must detect thermal hazard at FIRE_POS');
  const deepWaterLandHaz = evaluateHazardAt(ABYSS_POS[0], ABYSS_POS[1], 'land');
  assert.ok(deepWaterLandHaz.hazard > 0.5, 'Terrestrial fauna must avoid drowning in deep Abyssal Trench');
  const dryLandAquaticHaz = evaluateHazardAt(SAVANNA_POS[0], SAVANNA_POS[1], 'water');
  assert.ok(dryLandAquaticHaz.hazard > 0.5, 'Aquatic fauna must avoid stranding on dry Savanna');

  assert.strictEqual(POSES.length, 18, 'Must define all 18 planetary biome & forbidden zone poses');
  assert.strictEqual(BIOME_CATALOG.length, 18, 'Must define metadata for all 18 planetary zones');

  const t = {};
  terrainAt(22, 16, t);
  assert.ok(t.h < -0.3, `Expected submerged river lagoon height < -0.3, got ${t.h}`);
  assert.ok(t.wetness > 0.6, `Expected high wetness in river lagoon, got ${t.wetness}`);

  terrainAt(108, -72, t);
  assert.ok(t.h > 0.5, `Expected elevated Amazon terrain > 0.5, got ${t.h}`);

  terrainAt(SAVANNA_POS[0], SAVANNA_POS[1], t);
  assert.ok(t.savanna > 0.7, 'Expected high savanna weight at SAVANNA_POS');

  terrainAt(PLANTATION_POS[0], PLANTATION_POS[1], t);
  assert.ok(t.plantation > 0.7, 'Expected high plantation weight at PLANTATION_POS');

  terrainAt(REEF_POS[0], REEF_POS[1], t);
  assert.ok(t.h < -2.0 && t.reef > 0.7, `Expected submerged coral reef at REEF_POS, got h=${t.h}`);

  terrainAt(ABYSS_POS[0], ABYSS_POS[1], t);
  assert.ok(t.h < -6.0 && t.abyss > 0.7, `Expected deep Abyssal Garden trench at ABYSS_POS, got h=${t.h}`);

  terrainAt(VOLCANO_POS[0], VOLCANO_POS[1], t);
  assert.ok(t.volcano > 0.7, 'Expected high volcano weight at VOLCANO_POS');

  for (let i = 0; i < POSES.length; i++) {
    const p = POSES[i];
    assert.strictEqual(p.length, 6);
    const label = biomeLabelAt(p[0], p[1], p[2]);
    assert.ok(typeof label === 'string' && label.length > 3, `Pose ${i} must have valid biome label`);
  }
});

test('4. World Builder, Noniv/abyssal-garden Set-Pieces, 43 Fauna Cohorts, Canonical Heading & Survival FSM', () => {
  const world = buildWorld();
  assert.strictEqual(world.hSize, 512);
  assert.strictEqual(world.hData.length, 512 * 512 * 4);
  assert.strictEqual(world.vegBuffers.length, 10, 'Must build 10 flora & set-piece buffers including Sunken Galleon & Reef Kelp');
  assert.ok(world.vegBuffers[7].instCount >= 1, 'Must place the Noniv/abyssal-garden Sunken Wooden Galleon');
  assert.ok(world.vegBuffers[8].instCount >= 50, 'Must place swaying Kelp & Coral Reef instances');

  // Quadtree chunk streaming recentering test
  const chunkOut = new Float32Array(world.chunks.chunks.length * 4);
  updateQuadtreeChunks(1200, 450, -950, world.chunks.chunks, chunkOut, 1.2);
  let meanX = 0, meanZ = 0;
  for (let i = 0; i < world.chunks.chunks.length; i++) {
    meanX += chunkOut[i * 4];
    meanZ += chunkOut[i * 4 + 1];
  }
  meanX /= world.chunks.chunks.length;
  meanZ /= world.chunks.chunks.length;
  assert.ok(Math.abs(meanX - 1215) < 1e-3 && Math.abs(meanZ - (-945)) < 1e-3, 'updateQuadtreeChunks must center terrain grid around snapped camera anchor');
  assert.ok(chunkOut[2] > world.chunks.chunks[0].scale, 'updateQuadtreeChunks must expand chunk scale at high altitude');

  assert.ok(world.wildlifeGroups.length >= 40, `Expected >= 40 wildlife cohorts across all biomes, got ${world.wildlifeGroups.length}`);

  const requiredSpecies = [
    'lions', 'tigers', 'gorillas', 'chimpanzees', 'elephants', 'giraffes', 'zebras',
    'whales', 'orcas', 'sharks', 'mantas', 'penguins', 'polarBears', 'seals'
  ];
  for (const spName of requiredSpecies) {
    const grp = world.wildlifeGroups.find((g) => g.name === spName);
    assert.ok(grp, `Missing required planetary wildlife cohort: ${spName}`);
    assert.ok(grp.verts.length > 0 && grp.indices.length > 0 && grp.instCount > 0, `Invalid buffers on ${spName}`);
  }

  for (const vb of world.vegBuffers) {
    assert.ok(vb.verts.length > 0 && vb.indices.length > 0);
    for (let i = 0; i < Math.min(vb.verts.length, 220); i++) {
      assert.ok(Number.isFinite(vb.verts[i]), 'Non-finite float in vegetation vertex buffer');
    }
  }

  // Test solid world collision push-out & ground clamping
  assert.ok(world.colliders.length > 100, 'Expected solid tree/rock colliders');
  const c0 = world.colliders[0];
  const colRes = world.resolveWorldCollision(c0.x + 0.05, c0.maxY - 1.0, c0.z + 0.05, 0.65, -1, -1);
  assert.strictEqual(colRes.hit, true, 'Camera inside tree trunk collider must trigger hit=true');
  const distAfter = Math.hypot(colRes.x - c0.x, colRes.z - c0.z);
  assert.ok(distAfter >= c0.r + 0.64, `Expected push-out >= ${c0.r + 0.65}, got ${distAfter}`);

  // Test 120 Hz fixed-step simulation, zero-slide IK stride phase coupling, canonical heading & interpolation
  const lionGrp = world.wildlifeGroups.find((g) => g.name === 'lions');
  const lion0 = lionGrp.items[0];
  const phaseBefore = lion0.phase;
  for (let s = 0; s < 15; s++) {
    world.stepSim(world.SIM_DT, 0, 3, 0, 0.5, 0.6);
  }
  world.interpolateSim(0.5, 3, 0.5);
  assert.notStrictEqual(lion0.phase, phaseBefore, 'Zero-slide IK locomotion must advance stride phase with distance moved');

  // Verify moving animals align their canonical forward vector [-sin(yaw), cos(yaw)] with their velocity vector
  const vx = wrapDelta(lion0.x - lion0.prevX);
  const vz = wrapDelta(lion0.z - lion0.prevZ);
  if (Math.hypot(vx, vz) > 1e-4) {
    const [fx, fz] = yawToForward(lion0.yaw);
    const vLen = Math.hypot(vx, vz);
    const dot = (fx * vx + fz * vz) / vLen;
    assert.ok(dot > 0.7, `Moving animal canonical forward vector must align with velocity (dot=${dot})`);
  }

  assert.ok(Array.isArray(world.EMOTION_NAMES) && world.EMOTION_NAMES.length === 5, 'Must expose 5 creature emotional states');

  let hasEye = false, hasJaw = false, hasEar = false;
  for (let i = 9; i < lionGrp.verts.length; i += 11) {
    const ux = lionGrp.verts[i];
    if (Math.abs(ux - 0.12) < 0.01) hasEye = true;
    if (Math.abs(ux - 0.18) < 0.01) hasJaw = true;
    if (Math.abs(ux - 0.25) < 0.01) hasEar = true;
  }
  assert.ok(hasEye && hasJaw && hasEar, 'Creature mesh must include wet specular eyes (0.12), articulated jaw (0.18), and mobile ear pinnae (0.25)');

  const packedAnim = lionGrp.instData[6];
  const emoInt = Math.floor(packedAnim);
  const spdFrac = packedAnim - emoInt;
  assert.ok(emoInt >= 0 && emoInt <= 4, `Expected emotion 0..4 in instData[6], got ${emoInt}`);
  assert.ok(spdFrac >= 0.02 && spdFrac <= 0.98, `Expected fractional animSpeed in instData[6], got ${spdFrac}`);

  assert.ok(typeof world.getActiveSurvivalEvent() === 'string' && world.getActiveSurvivalEvent().length > 5);

  const near = world.findNearestAnimal(SAVANNA_POS[0], 2, SAVANNA_POS[1], 120);
  assert.ok(near && near.groupIdx >= 0, 'findNearestAnimal must locate nearby fauna for playable embodiment');

  for (const ag of world.wildlifeGroups) {
    for (let i = 0; i < ag.instData.length; i++) {
      assert.ok(Number.isFinite(ag.instData[i]), `Non-finite instance float in ${ag.name}`);
    }
  }
});

test('5. Procedural Material Atlas Generator & Persistent Quality/Settings Controller', () => {
  assert.strictEqual(PROCEDURAL_MATERIALS.length, 32, 'Must define all 32 procedural materials');
  assert.strictEqual(TEX_LAYERS, 16, 'Must generate 16 texture array layers');
  const data = generateMaterialAtlas();
  assert.strictEqual(data.length, TEX_SIZE * TEX_SIZE * TEX_LAYERS * 4);
  let nonZero = 0;
  for (let i = 0; i < 4096; i++) {
    if (data[i] > 0) nonZero++;
  }
  assert.ok(nonZero > 3000, 'Generated procedural texture atlas must contain rich non-zero texels');

  // Verify quality tiers & settings controller
  assert.strictEqual(QUALITY_TIERS.length, 4, 'Must define 4 quality tiers (Ultra, High, Balanced, Performance)');
  const s = loadSettings();
  assert.strictEqual(s.fov, DEFAULT_SETTINGS.fov);
  saveSettings({ ...s, fov: 68 });
  const r = resetSettings();
  assert.strictEqual(r.fov, DEFAULT_SETTINGS.fov);
  const qc = createQualityController(1);
  assert.strictEqual(qc.tierIndex, 1);
  qc.setTier(0);
  assert.strictEqual(qc.tier.name, 'Ultra');
});

test('6. WGSL Shader Structural Validation, Exact 96-Float FrameU Struct, REALISM Branding & Minimalist UI', () => {
  for (const [name, code] of Object.entries(shaders)) {
    assert.ok(typeof code === 'string' && code.length > 100, `Shader ${name} must be non-empty`);
    let depth = 0;
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      assert.ok(depth >= 0, `Unbalanced closing brace in ${name}`);
    }
    assert.strictEqual(depth, 0, `Unbalanced braces in ${name}`);

    const smRe = /smoothstep\(\s*(-?\d+(?:\.\d*)?)\s*,\s*(-?\d+(?:\.\d*)?)\s*,/g;
    let m;
    while ((m = smRe.exec(code)) !== null) {
      const e0 = parseFloat(m[1]);
      const e1 = parseFloat(m[2]);
      assert.ok(e0 < e1, `Invalid WGSL smoothstep(${e0}, ${e1}, ...) in ${name}: e0 must be < e1`);
    }

    const uncommented = code.replace(/\/\/.*$/gm, '');
    const wgslReserved = [
      'NULL', 'Self', 'abstract', 'active', 'alignas', 'alignof', 'as', 'asm', 'asm_fragment', 'async',
      'attribute', 'auto', 'await', 'become', 'binding_array', 'cast', 'catch', 'class', 'co_await',
      'co_return', 'co_yield', 'coherent', 'column_major', 'common', 'compile', 'compile_fragment',
      'concept', 'const_cast', 'consteval', 'constexpr', 'constinit', 'crate', 'debugger', 'decltype',
      'delete', 'demote', 'demote_to_helper', 'do', 'dynamic_cast', 'enum', 'explicit', 'export',
      'extends', 'extern', 'external', 'fallthrough', 'filter', 'final', 'finally', 'friend', 'from',
      'fxgroup', 'get', 'goto', 'groupshared', 'highp', 'impl', 'implements', 'import', 'inline',
      'instanceof', 'interface', 'layout', 'lowp', 'macro', 'macro_rules', 'match', 'mediump', 'meta',
      'mod', 'module', 'move', 'mut', 'mutable', 'namespace', 'new', 'nil', 'noexcept', 'noinline',
      'nointerpolation', 'non_coherent', 'noncoherent', 'noperspective', 'null', 'nullptr', 'of',
      'operator', 'package', 'packoffset', 'partition', 'pass', 'patch', 'pixelfragment', 'precise',
      'precision', 'premerge', 'priv', 'protected', 'pub', 'public', 'readonly', 'ref', 'regardless',
      'register', 'reinterpret_cast', 'require', 'resource', 'restrict', 'self', 'set', 'shader',
      'shared', 'sizeof', 'smooth', 'snorm', 'static', 'static_assert', 'static_cast', 'std',
      'subroutine', 'super', 'target', 'template', 'this', 'thread_local', 'throw', 'trait', 'try',
      'type', 'typedef', 'typeid', 'typename', 'typeof', 'union', 'unless', 'unorm', 'unsafe',
      'unsized', 'use', 'using', 'varying', 'virtual', 'volatile', 'wgsl', 'where', 'with',
      'writeonly', 'yield'
    ];
    for (const kw of wgslReserved) {
      const kwRe = new RegExp(`(?<!@)\\b${kw}\\b`, 'g');
      assert.ok(!kwRe.test(uncommented), `WGSL reserved keyword '${kw}' used in shader ${name}`);
    }
  }

  const frameUMatch = shaders.W_COMMON.match(/struct\s+FrameU\s*\{([\s\S]*?)\}/);
  assert.ok(frameUMatch, 'Must define struct FrameU in W_COMMON');
  const matCount = (frameUMatch[1].match(/mat4x4f/g) || []).length;
  const vecCount = (frameUMatch[1].match(/vec4f/g) || []).length;
  assert.strictEqual(matCount * 16 + vecCount * 4, 96, `FrameU must be exactly 96 floats (384 bytes), got ${matCount * 16 + vecCount * 4}`);

  assert.match(shaders.W_COMMON, /fn caus\(uv:\s*vec2f,\s*t:\s*f32\)\s*->\s*f32/, 'Must include exact Noniv/abyssal-garden caus() solver');
  assert.match(shaders.W_COMMON, /1\.769/, 'Must include exact Noniv/abyssal-garden Snell Window critical cone constant 1.769');
  assert.match(shaders.W_COMMON, /fn evalAurora/, 'Must include raymarched Aurora Borealis/Australis function');
  assert.ok(!/textureSampleCompare\s*\(/.test(shaders.W_TERRAIN), 'W_TERRAIN must use textureSampleCompareLevel for uniform control flow safety');
  assert.ok(!/textureSampleCompare\s*\(/.test(shaders.W_VEG), 'W_VEG must use textureSampleCompareLevel for uniform control flow safety');

  const srcDir = path.resolve(__dirname, '../src');
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert.ok(!/https?:\/\//.test(content), `External URL found in ${f} — all assets must be procedural`);
    assert.ok(!/new\s+Image\s*\(/.test(content), `External Image loader found in ${f}`);
  }

  const mainSrc = fs.readFileSync(path.join(srcDir, 'main.js'), 'utf8');
  assert.match(mainSrc, /UB_FLOATS\s*=\s*96/, 'FrameU uniform buffer must be 96 floats (384 bytes)');
  assert.ok(!/sp\.setBindGroup\(\s*1\s*,\s*bgEnv\s*\)/.test(mainSrc), 'Shadow pass must not bind bgEnv (which contains shadowView) while rendering to shadowView');

  const tplHtml = fs.readFileSync(path.resolve(__dirname, '../template.html'), 'utf8');
  assert.match(tplHtml, /border-radius:\s*0\s*!important/, 'Minimalist UI must enforce border-radius: 0 !important');
  assert.match(tplHtml, /REALISM/, 'Title screen and HUD must be branded REALISM');
  assert.ok(!/Terra Primordia/i.test(tplHtml), 'template.html must not contain legacy Terra Primordia branding');
  assert.match(tplHtml, /id="settingsModal"/, 'template.html must include full in-game #settingsModal');
  assert.match(tplHtml, /id="openSettingsBtn"/, 'template.html must include visible top-bar #openSettingsBtn');
});

