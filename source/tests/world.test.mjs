import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_SEED, seedRng, rnd, fbm2, m4Persp, m4Look, m4Mul, m4Inv,
  smin, smax, solveTwoBoneIK, MeshBuilder
} from '../src/math.js';
import {
  WORLD_HALF, SAVANNA_POS, PLANTATION_POS, BEACH_POS, REEF_POS, ABYSS_POS, POLAR_POS, VOLCANO_POS,
  BIOME_CATALOG, terrainAt, POSES, biomeLabelAt
} from '../src/biomes.js';
import { buildWorld } from '../src/world.js';
import { generateMaterialAtlas, PROCEDURAL_MATERIALS, TEX_SIZE, TEX_LAYERS } from '../src/assets.js';
import * as shaders from '../src/shaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('1. Deterministic PRNG, 2D FBM noise, Smooth-Min (smin) & Analytical 2-Bone IK', () => {
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

test('3. Continuous 18-Biome Planetary Topography, Bathymetry & Poses', () => {
  assert.strictEqual(POSES.length, 18, 'Must define all 18 planetary biome & forbidden zone poses');
  assert.strictEqual(BIOME_CATALOG.length, 18, 'Must define metadata for all 18 planetary zones');

  const t = {};
  // River Lagoon channel should be submerged (< 0)
  terrainAt(22, 16, t);
  assert.ok(t.h < -0.3, `Expected submerged river lagoon height < -0.3, got ${t.h}`);
  assert.ok(t.wetness > 0.6, `Expected high wetness in river lagoon, got ${t.wetness}`);

  // Amazon canopy hills should be elevated (> 0.5)
  terrainAt(108, -72, t);
  assert.ok(t.h > 0.5, `Expected elevated Amazon terrain > 0.5, got ${t.h}`);

  // Serengeti Savanna, Overgrown Plantations, Coral Reef, Abyssal Garden & Polar Ice Planet
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

  // All 18 camera poses must be valid and have non-empty biome labels
  for (let i = 0; i < POSES.length; i++) {
    const p = POSES[i];
    assert.strictEqual(p.length, 6);
    const label = biomeLabelAt(p[0], p[1], p[2]);
    assert.ok(typeof label === 'string' && label.length > 3, `Pose ${i} must have valid biome label`);
  }
});

test('4. World Builder, Noniv/abyssal-garden Set-Pieces, 43 Fauna Cohorts, IK & Survival FSM', () => {
  const world = buildWorld();
  assert.strictEqual(world.hSize, 512);
  assert.strictEqual(world.hData.length, 512 * 512 * 4);
  assert.strictEqual(world.vegBuffers.length, 10, 'Must build 10 flora & set-piece buffers including Sunken Galleon & Reef Kelp');
  assert.ok(world.vegBuffers[7].instCount >= 1, 'Must place the Noniv/abyssal-garden Sunken Wooden Galleon');
  assert.ok(world.vegBuffers[8].instCount >= 50, 'Must place swaying Kelp & Coral Reef instances');

  assert.ok(world.wildlifeGroups.length >= 40, `Expected >= 40 wildlife cohorts across all biomes, got ${world.wildlifeGroups.length}`);

  // Verify iconic new planetary species exist and have valid geometry
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

  // Test 120 Hz fixed-step simulation, zero-slide IK stride phase coupling, emotion packing & interpolation
  const lionGrp = world.wildlifeGroups.find((g) => g.name === 'lions');
  const lion0 = lionGrp.items[0];
  const phaseBefore = lion0.phase;
  world.stepSim(world.SIM_DT, 0, 3, 0, 0.5, 0.6);
  world.interpolateSim(0.5, 3, 0.5);
  assert.notStrictEqual(lion0.phase, phaseBefore, 'Zero-slide IK locomotion must advance stride phase with distance moved');
  assert.ok(Array.isArray(world.EMOTION_NAMES) && world.EMOTION_NAMES.length === 5, 'Must expose 5 creature emotional states');

  // Verify expressive facial tags (uv.x = 0.12 eye, 0.18 jaw, 0.25 ear) exist in lion mesh vertices (stride = 11 floats, uv.x at offset 9)
  let hasEye = false, hasJaw = false, hasEar = false;
  for (let i = 9; i < lionGrp.verts.length; i += 11) {
    const ux = lionGrp.verts[i];
    if (Math.abs(ux - 0.12) < 0.01) hasEye = true;
    if (Math.abs(ux - 0.18) < 0.01) hasJaw = true;
    if (Math.abs(ux - 0.25) < 0.01) hasEar = true;
  }
  assert.ok(hasEye && hasJaw && hasEar, 'Creature mesh must include wet specular eyes (0.12), articulated jaw (0.18), and mobile ear pinnae (0.25)');

  // Verify packed emotion + animSpeed in instData[6]
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

test('5. Procedural Material Atlas Generator (32 Materials / 16 Texture Array Layers)', () => {
  assert.strictEqual(PROCEDURAL_MATERIALS.length, 32, 'Must define all 32 procedural materials');
  assert.strictEqual(TEX_LAYERS, 16, 'Must generate 16 texture array layers');
  const data = generateMaterialAtlas();
  assert.strictEqual(data.length, TEX_SIZE * TEX_SIZE * TEX_LAYERS * 4);
  let nonZero = 0;
  for (let i = 0; i < 4096; i++) {
    if (data[i] > 0) nonZero++;
  }
  assert.ok(nonZero > 3000, 'Generated procedural texture atlas must contain rich non-zero texels');
});

test('6. WGSL Shader Structural Validation, Exact 96-Float FrameU Struct & Minimalist Zero-Radius UI', () => {
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

    // Strip line comments and check that no WGSL reserved words are used as identifiers
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

  // Verify FrameU struct in W_COMMON has 3 mat4x4f (48 floats) + 12 vec4f (48 floats) = 96 floats (384 bytes)
  const frameUMatch = shaders.W_COMMON.match(/struct\s+FrameU\s*\{([\s\S]*?)\}/);
  assert.ok(frameUMatch, 'Must define struct FrameU in W_COMMON');
  const matCount = (frameUMatch[1].match(/mat4x4f/g) || []).length;
  const vecCount = (frameUMatch[1].match(/vec4f/g) || []).length;
  assert.strictEqual(matCount * 16 + vecCount * 4, 96, `FrameU must be exactly 96 floats (384 bytes), got ${matCount * 16 + vecCount * 4}`);

  // Verify exact Noniv/abyssal-garden caustic solver, Snell's Window & rock detail exist in WGSL
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
});

