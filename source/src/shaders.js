// ============================================================================
// WGSL Shaders — REALISM (Earth-Scale Planet, Noniv/abyssal-garden Deep Ocean,
// Orbital Space Globe, Expressive Creature Skinning & Micro-Coat Shading)
// ============================================================================

const W_COMMON = /*wgsl*/`
// Exactly 96 floats (384 bytes): 3 * mat4x4f (48) + 12 * vec4f (48) = 96 floats
struct FrameU {
  vp: mat4x4f,
  invVp: mat4x4f,
  sunVp: mat4x4f,
  camPos: vec4f,      // 48..51: xyz = pos, w = time
  camFwd: vec4f,      // 52..55: xyz = forward, w = tanHalfFov
  camRight: vec4f,    // 56..59: xyz = right, w = aspect
  camUp: vec4f,       // 60..63: xyz = up, w = waterLevel
  sunDir: vec4f,      // 64..67: xyz = dir, w = sunIntensity
  sunCol: vec4f,      // 68..71: rgb = sunColor, w = fogDensity
  skyZenith: vec4f,   // 72..75: rgb = zenith, w = cloudCover
  skyHorizon: vec4f,  // 76..79: rgb = horizon, w = mistStrength
  fogCol: vec4f,      // 80..83: rgb = fogColor, w = fireStrength
  firePos: vec4f,     // 84..87: xyz = fireCenter, w = focusDistM
  wind: vec4f,        // 88..91: xy = windDir, z = windSpeed, w = exposureScale
  misc: vec4f,        // 92..95: x = weatherMode(0..7), y = rainIntensity, z = dofStrength, w = instinctPulse (+10 if lookdev)
};

@group(0) @binding(0) var<uniform> U: FrameU;

const PI: f32 = 3.14159265;

fn h21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn h22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn n2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3. - 2. * f);
  return mix(
    mix(h21(i), h21(i + vec2f(1., 0.)), u.x),
    mix(h21(i + vec2f(0., 1.)), h21(i + vec2f(1., 1.)), u.x),
    u.y
  );
}
fn fbm(p_in: vec2f) -> f32 {
  var p = p_in;
  var v = 0.;
  var a = 0.5;
  let m = mat2x2f(1.6, -1.2, 1.2, 1.6);
  for (var i = 0; i < 4; i++) {
    v += a * n2(p);
    p = m * p + vec2f(11.3, 7.7);
    a *= 0.5;
  }
  return v;
}
fn voronoi(x: vec2f) -> vec2f {
  let n = floor(x);
  let f = fract(x);
  var md = 8.0;
  var id = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = h22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < md) {
        md = d;
        id = h21(n + g);
      }
    }
  }
  return vec2f(sqrt(md), id);
}

// Exact Noniv/abyssal-garden 5-iteration trigonometric phase-warped caustic solver
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = (uv - floor(uv)) * 6.2831853 - 250.0;
  var i = p;
  var c = 1.0;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1.0 - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt);
    let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5.0, 1.4);
  let v = pow(abs(c), 8.0);
  return clamp(v * smoothstep(0.08, 0.72, v), 0.0, 1.85);
}

// Exact Noniv/abyssal-garden procedural rock detail, dual cracks, Worley pits & coralline fluorescence
fn abyssalRockDetail(wp: vec3f, n: vec3f) -> vec4f {
  let uv = wp.xz * 0.18 + vec2f(wp.y * 0.11);
  let w = vec2f(fbm(uv * 1.4), fbm(uv * 1.4 + vec2f(5.2, 1.3)));
  let duv = uv + (w - 0.5) * 0.45;
  let baseFbm = fbm(duv * 2.2);
  let ridged = 1.0 - abs(n2(duv * 4.5) * 2.0 - 1.0);
  let vor1 = voronoi(duv * 3.8);
  let vor2 = voronoi(duv * 7.5 + vec2f(3.7, 9.1));
  let cr = smoothstep(0.02, 0.14, vor1.x);
  let cr2 = smoothstep(0.03, 0.18, vor2.x);
  let pits = smoothstep(0.12, 0.36, vor2.x);
  let rockH = clamp((baseFbm * 0.55 + ridged * 0.45) * cr * cr2 * (0.7 + 0.3 * pits), 0.0, 1.0);
  let mottle = fbm(duv * 6.0 + vec2f(13.1, 4.7));
  let flu = smoothstep(0.25, 0.85, n.y) * smoothstep(0.54, 0.76, mottle) * smoothstep(-18.0, -0.8, wp.y);
  return vec4f(w.x - 0.5, w.y - 0.5, rockH, flu);
}

const WORLD_HALF: f32 = 360.0;
const WORLD_SPAN: f32 = 720.0;

fn wrapXZ(xz: vec2f) -> vec2f {
  return xz - floor((xz + vec2f(WORLD_HALF)) / WORLD_SPAN) * WORLD_SPAN;
}

// Soft, organic blended Aurora Borealis / Australis (emerald, teal & twilight violet glow)
// Strictly rendered ONLY under the atmosphere at night/twilight — never as lines in deep space
fn evalAurora(dir: vec3f, t: f32) -> vec3f {
  if (dir.y <= 0.01) { return vec3f(0.0); }
  let skyDomeUV = dir.xz / (dir.y + 0.22);
  var col = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let fi = f32(i);
    let scale = 0.55 + fi * 0.28;
    let drift = vec2f(t * (0.014 + fi * 0.005), -t * 0.009 + fi * 2.3);
    let p = skyDomeUV * scale + drift;
    let flow = vec2f(
      fbm(p * 1.15 + vec2f(0.0, t * 0.03)),
      fbm(p * 1.15 + vec2f(4.7, -t * 0.025))
    );
    let veilA = fbm(p * 1.45 + flow * 1.65);
    let veilB = fbm(p * 2.35 - flow * 1.15 + vec2f(t * 0.02));
    let blendGlow = smoothstep(0.42, 0.82, veilA * 0.65 + veilB * 0.35);
    let vertFade = smoothstep(0.02, 0.24, dir.y) * (1.0 - smoothstep(0.52, 0.96, dir.y));
    let emerald = vec3f(0.08, 0.88, 0.54);
    let teal    = vec3f(0.06, 0.68, 0.86);
    let violet  = vec3f(0.48, 0.16, 0.82);
    let hueMix1 = mix(emerald, teal, smoothstep(0.3, 0.75, flow.x));
    let hueMix2 = mix(hueMix1, violet, smoothstep(0.45, 0.88, veilB + fi * 0.22));
    col += hueMix2 * blendGlow * vertFade * (0.52 - fi * 0.11);
  }
  return col;
}

// High-velocity flying meteorites / shooting stars across outer space & upper mesosphere
fn evalMeteorites(dir: vec3f, t: f32) -> vec3f {
  var mCol = vec3f(0.0);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    let period = 4.2 + fk * 1.7;
    let cycle = floor(t / period);
    let phase = fract(t / period);
    let activeWin = smoothstep(0.02, 0.12, phase) * (1.0 - smoothstep(0.48, 0.68, phase));
    if (activeWin > 0.001) {
      let seed = h22(vec2f(cycle + fk * 19.3, fk * 37.1));
      let az = (seed.x * 2.0 - 1.0) * 3.14159;
      let el = 0.18 + seed.y * 0.62;
      let startDir = normalize(vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az)));
      let tangent = normalize(cross(startDir, vec3f(0.15, 1.0, -0.25)));
      let headDir = normalize(startDir + tangent * (phase * 0.95 - 0.25));
      let tailDir = normalize(startDir + tangent * (max(0.0, phase - 0.16) * 0.95 - 0.25));
      // Distance from ray dir to meteorite streak segment [tailDir -> headDir]
      let seg = headDir - tailDir;
      let segLen2 = max(1e-5, dot(seg, seg));
      let hProj = clamp(dot(dir - tailDir, seg) / segLen2, 0.0, 1.0);
      let closest = normalize(tailDir + seg * hProj);
      let angDist = length(dir - closest);
      let core = exp(-angDist * 380.0) * pow(hProj, 1.8);
      let headSpark = exp(-length(dir - headDir) * 220.0) * 1.65;
      let trailCol = mix(vec3f(0.28, 0.78, 1.0), vec3f(1.0, 0.92, 0.72), hProj);
      mCol += (trailCol * core * 2.4 + vec3f(1.0, 0.97, 0.90) * headSpark) * activeWin;
    }
  }
  return mCol;
}

// Distant 3D Planets (Ringed Saturn, Red Mars, Cratered Moon) & Inclined Spiral Galaxy
fn evalCosmicBodies(dir: vec3f, t: f32, spaceVis: f32) -> vec3f {
  if (spaceVis <= 0.01) { return vec3f(0.0); }
  var c = vec3f(0.0);
  let sunL = normalize(U.sunDir.xyz);

  // 1. Inclined Spiral Galaxy & Glowing Core
  let galCenter = normalize(vec3f(0.48, 0.58, 0.65));
  let gRight = normalize(cross(galCenter, vec3f(0.0, 1.0, 0.0)));
  let gUp = cross(gRight, galCenter);
  let gDot = dot(dir, galCenter);
  if (gDot > 0.88) {
    let gx = dot(dir, gRight) * 11.5;
    let gy = dot(dir, gUp) * 21.0; // inclined elliptical disc
    let gr = sqrt(gx * gx + gy * gy);
    let gTheta = atan2(gy, gx);
    let spiral = cos(2.0 * gTheta - log(max(0.04, gr)) * 4.2 + t * 0.02);
    let armMask = smoothstep(-0.2, 0.75, spiral) * exp(-gr * 1.85) * smoothstep(0.08, 0.35, gr);
    let coreGlow = exp(-gr * 5.2) * 1.45;
    let dustNoise = 0.65 + 0.35 * fbm(vec2f(gx * 2.5, gy * 2.5));
    let galCol = vec3f(1.0, 0.86, 0.62) * coreGlow +
                 mix(vec3f(0.32, 0.58, 1.0), vec3f(0.82, 0.34, 0.88), smoothstep(0.2, 1.2, gr)) * armMask * dustNoise;
    c += galCol * spaceVis * 0.95;
  }

  // 2. Ringed Gas Giant (Saturn-like 3D Sphere + Concentric Tilted Rings)
  let satDir = normalize(vec3f(-0.62, 0.34, -0.70));
  let satRight = normalize(cross(satDir, vec3f(0.18, 1.0, 0.08)));
  let satUp = normalize(cross(satRight, satDir));
  let satDot = dot(dir, satDir);
  if (satDot > 0.975) {
    let sx = dot(dir, satRight);
    let sy = dot(dir, satUp);
    let sRad = 0.032;
    let sr2 = sx * sx + sy * sy;
    // Ring plane intersection (tilted normal)
    let ringNorm = normalize(satUp * 0.82 - satDir * 0.57);
    let denom = dot(dir, ringNorm);
    var ringCol = vec3f(0.0);
    var ringAlpha = 0.0;
    var ringBehind = false;
    if (abs(denom) > 0.01) {
      let tRing = dot(satDir, ringNorm) / denom;
      let rHit = dir * tRing - satDir;
      let rDist = length(rHit);
      if (rDist > sRad * 1.38 && rDist < sRad * 2.55) {
        let rU = (rDist - sRad * 1.38) / (sRad * 1.17);
        let cassini = smoothstep(0.03, 0.08, abs(rU - 0.62));
        let bands = 0.65 + 0.35 * sin(rU * 48.0) * cos(rU * 19.0);
        ringAlpha = cassini * bands * smoothstep(0.0, 0.08, rU) * (1.0 - smoothstep(0.90, 1.0, rU)) * 0.85;
        ringCol = mix(vec3f(0.68, 0.56, 0.40), vec3f(0.92, 0.82, 0.64), bands) * max(0.25, dot(ringNorm, sunL) * 0.6 + 0.55);
        ringBehind = tRing > 1.0;
      }
    }
    if (sr2 < sRad * sRad) {
      let sz = sqrt(max(0.0, sRad * sRad - sr2));
      let sNorm = normalize(satRight * sx + satUp * sy - satDir * sz);
      let bandLat = dot(sNorm, satUp);
      let storm = fbm(vec2f(atan2(sx, sz) * 3.0 + t * 0.03, bandLat * 12.0));
      let bandWave = sin(bandLat * 26.0 + storm * 2.2) * 0.5 + 0.5;
      let satAlb = mix(vec3f(0.76, 0.60, 0.38), vec3f(0.94, 0.82, 0.58), bandWave);
      let sLit = max(0.06, dot(sNorm, sunL));
      var bodyCol = satAlb * sLit;
      if (!ringBehind && ringAlpha > 0.01) {
        bodyCol = mix(bodyCol, ringCol, ringAlpha);
      }
      c = mix(c, bodyCol, spaceVis);
    } else if (ringAlpha > 0.01) {
      c += ringCol * ringAlpha * spaceVis;
    }
  }

  // 3. Red Planet (Mars-like 3D Sphere with Polar Ice Cap & Basalt Syrtis Basins)
  let marsDir = normalize(vec3f(0.74, 0.42, -0.52));
  let mRight = normalize(cross(marsDir, vec3f(0.0, 1.0, 0.0)));
  let mUp = cross(mRight, marsDir);
  if (dot(dir, marsDir) > 0.996) {
    let mx = dot(dir, mRight);
    let my = dot(dir, mUp);
    let mRad = 0.018;
    let mr2 = mx * mx + my * my;
    if (mr2 < mRad * mRad) {
      let mz = sqrt(max(0.0, mRad * mRad - mr2));
      let mNorm = normalize(mRight * mx + mUp * my - marsDir * mz);
      let mNoise = fbm(vec2f(atan2(mx, mz) * 2.5 + t * 0.015, (my / mRad) * 4.0));
      var mAlb = mix(vec3f(0.78, 0.30, 0.14), vec3f(0.38, 0.16, 0.10), smoothstep(0.45, 0.72, mNoise));
      let mPole = smoothstep(0.78, 0.92, abs(my / mRad));
      mAlb = mix(mAlb, vec3f(0.95, 0.96, 0.98), mPole);
      let mLit = max(0.05, dot(mNorm, sunL));
      c = mix(c, mAlb * mLit, spaceVis);
    }
  }

  // 4. Cratered Lunar Sphere (Moon)
  let moonDir = normalize(vec3f(-0.36, 0.56, 0.74));
  let lRight = normalize(cross(moonDir, vec3f(0.0, 1.0, 0.0)));
  let lUp = cross(lRight, moonDir);
  if (dot(dir, moonDir) > 0.994) {
    let lx = dot(dir, lRight);
    let ly = dot(dir, lUp);
    let lRad = 0.026;
    let lr2 = lx * lx + ly * ly;
    if (lr2 < lRad * lRad) {
      let lz = sqrt(max(0.0, lRad * lRad - lr2));
      let lNorm = normalize(lRight * lx + lUp * ly - moonDir * lz);
      let lUv = vec2f(atan2(lx, lz) * 3.2, (ly / lRad) * 3.2);
      let maria = fbm(lUv * 1.8);
      let crater = voronoi(lUv * 7.5).x;
      let craterRim = smoothstep(0.12, 0.24, crater) - smoothstep(0.24, 0.36, crater) * 0.3;
      let lAlb = mix(vec3f(0.38, 0.40, 0.44), vec3f(0.74, 0.76, 0.78), smoothstep(0.38, 0.65, maria) + craterRim * 0.25);
      let lLit = max(0.04, dot(lNorm, sunL));
      c = mix(c, lAlb * lLit, spaceVis);
    }
  }

  return c;
}

fn distributionGGX(NdotH: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.) + 1.;
  return a2 / max(0.0001, PI * d * d);
}
fn geometrySmith(NdotV: f32, NdotL: f32, rough: f32) -> f32 {
  let r = rough + 1.;
  let k = (r * r) / 8.;
  let gv = NdotV / (NdotV * (1. - k) + k);
  let gl = NdotL / (NdotL * (1. - k) + k);
  return gv * gl;
}
fn fresnelSchlick(cosT: f32, F0: vec3f) -> vec3f {
  return F0 + (1. - F0) * pow(clamp(1. - cosT, 0., 1.), 5.);
}

fn evalSky(dir: vec3f) -> vec3f {
  let t = U.camPos.w;
  // Underwater Snell's Window when camera is submerged
  if (U.camPos.y < -0.08) {
    let deepWater = vec3f(0.015, 0.095, 0.145);
    let midWater = vec3f(0.035, 0.24, 0.32);
    var uwSky = mix(deepWater, midWater, clamp(dir.y * 0.5 + 0.5, 0.0, 1.0));
    if (dir.y > 0.05) {
      let ci = clamp(dir.y, 0.0, 1.0);
      let k = 1.0 - 1.769 * (1.0 - ci * ci);
      let snellMask = smoothstep(-0.08, 0.18, k);
      let refrDir = normalize(vec3f(dir.x * 1.33, sqrt(max(0.01, k)), dir.z * 1.33));
      let aboveSky = mix(U.skyHorizon.rgb, U.skyZenith.rgb, pow(clamp(refrDir.y, 0.0, 1.0), 0.55));
      let sunGlow = pow(max(dot(refrDir, U.sunDir.xyz), 0.0), 48.0) * U.sunCol.rgb * 2.5;
      let cRim = caus(dir.xz / max(0.15, dir.y) * 0.18 + vec2f(t * 0.02), t * 0.55) * 0.35;
      uwSky = mix(uwSky, aboveSky * 1.15 + sunGlow + vec3f(0.12, 0.42, 0.48) * cRim, snellMask * 0.88);
    }
    return uwSky;
  }

  let spaceFactor = smoothstep(160.0, 820.0, U.camPos.y);
  let atmoDensity = 1.0 - spaceFactor;

  // Ascending through lower & upper atmospheric layers gets progressively lighter before thinning into space
  let climbGlow = smoothstep(28.0, 135.0, U.camPos.y) * (1.0 - smoothstep(150.0, 380.0, U.camPos.y));
  let y = clamp(dir.y, 0., 1.);
  var baseHoriz = mix(U.skyHorizon.rgb, vec3f(0.68, 0.86, 0.98), climbGlow * 0.65);
  var baseZen   = mix(U.skyZenith.rgb,  vec3f(0.26, 0.58, 0.92), climbGlow * 0.55);
  var col = mix(baseHoriz, baseZen, pow(y, 0.52)) * atmoDensity;

  // Blazing Sun Disc, Solar Corona & Atmospheric Mie Scattering
  let sd = max(dot(dir, U.sunDir.xyz), 0.);
  let mie = pow(sd, 10.) * 0.38 * atmoDensity + pow(sd, 72.) * (1.25 + spaceFactor * 1.4) + smoothstep(0.9980, 0.9997, sd) * (9.5 + spaceFactor * 6.0);
  col += mix(U.sunCol.rgb, vec3f(1.0, 0.96, 0.86), spaceFactor * 0.7) * mie * max(U.sunDir.w, spaceFactor * 1.15);

  // Multi-Layer Cloud Decks (Lower Cumulus Deck at y=42..88m & Upper Cirrus Ice-Crystal Deck at y=115..165m)
  if (atmoDensity > 0.01) {
    // 1. Lower Billowing Cumulus Deck (y ~ 64m) — pass right through it as you ascend!
    let dCumulus = 64.0 - U.camPos.y;
    if ((dCumulus > 0.0 && dir.y > 0.01) || (dCumulus < 0.0 && dir.y < -0.01 && U.camPos.y < 290.0)) {
      let tCloud = clamp(abs(dCumulus) / max(0.06, abs(dir.y)), 0.0, 1800.0);
      let cPos = U.camPos.xz + dir.xz * tCloud * 0.14 + U.wind.xy * (t * 1.4);
      let c1 = fbm(cPos * 0.032);
      let c2 = fbm(cPos * 0.085 - vec2f(t * 0.04, 0.0));
      let cDensity = c1 * 0.68 + c2 * 0.32;
      let cMask = smoothstep(0.45 - U.skyZenith.w * 0.16, 0.76, cDensity) *
                  smoothstep(0.01, 0.16, abs(dir.y)) *
                  (1.0 - smoothstep(140.0, 290.0, U.camPos.y));
      let topSun = select(0.55, 0.95, dCumulus < 0.0);
      let cLit = mix(vec3f(0.24, 0.30, 0.36), U.sunCol.rgb * 1.18 + vec3f(0.35, 0.38, 0.42) * topSun, pow(sd, 3.0) * 0.55 + 0.45 * U.sunDir.w);
      col = mix(col, cLit, cMask * 0.78 * atmoDensity);
    }

    // 2. Upper Wispy Cirrus / Stratospheric Ice-Crystal Clouds (y ~ 138m)
    let dCirrus = 138.0 - U.camPos.y;
    if ((dCirrus > 0.0 && dir.y > 0.01) || (dCirrus < 0.0 && dir.y < -0.01 && U.camPos.y < 360.0)) {
      let tCir = clamp(abs(dCirrus) / max(0.06, abs(dir.y)), 0.0, 2200.0);
      let cirPos = U.camPos.xz + dir.xz * tCir * 0.09 - U.wind.xy * (t * 0.9);
      let warp = fbm(cirPos * 0.025);
      let streak = fbm(vec2f(cirPos.x * 0.06 + warp * 2.2, cirPos.y * 0.018));
      let cirMask = smoothstep(0.52, 0.80, streak) * smoothstep(0.01, 0.14, abs(dir.y)) * (1.0 - smoothstep(190.0, 360.0, U.camPos.y));
      let cirCol = mix(vec3f(0.62, 0.76, 0.92), U.sunCol.rgb * 1.25 + vec3f(0.45), 0.65 * U.sunDir.w);
      col = mix(col, cirCol, cirMask * 0.52 * atmoDensity);
    }

    // 3. Inside-Cloud Volumetric Whiteout Scattering when physically flying through cloud altitudes
    let inCumulus = (1.0 - smoothstep(0.0, 22.0, abs(U.camPos.y - 64.0))) *
                    smoothstep(0.38, 0.72, fbm(U.camPos.xz * 0.025 + vec2f(t * 0.05)));
    let inCirrus  = (1.0 - smoothstep(0.0, 18.0, abs(U.camPos.y - 138.0))) * 0.55;
    let inCloudMist = clamp(inCumulus * 0.78 + inCirrus * 0.42, 0.0, 0.85);
    if (inCloudMist > 0.01) {
      let cloudVapor = mix(vec3f(0.74, 0.84, 0.94), U.sunCol.rgb * 0.65 + vec3f(0.48, 0.54, 0.62), U.sunDir.w * 0.7);
      col = mix(col, cloudVapor, inCloudMist);
    }
  }

  // Stars, Deep-Space Nebulae, Galaxies, Distant Planets, Flying Meteorites & Under-Atmosphere Aurora
  let trueNightFactor = 1.0 - smoothstep(0.15, 0.55, U.sunDir.w);
  let cosmosVis = clamp(trueNightFactor + spaceFactor, 0.0, 1.0);
  let weatherIdx = round(U.misc.x);
  let wxzCam = wrapXZ(U.camPos.xz);
  let polarProximity = max(smoothstep(155.0, 245.0, wxzCam.y), 1.0 - smoothstep(-245.0, -175.0, wxzCam.y));
  // CRITICAL: Aurora ONLY shows under the atmosphere (combine of northern light + night), NEVER in the starry space sky!
  let underAtmoMask = 1.0 - smoothstep(130.0, 290.0, U.camPos.y);
  let auroraNightGate = clamp(trueNightFactor * 0.92 + select(0.0, 0.95, abs(weatherIdx - 6.0) < 0.4), 0.0, 1.0);
  let auroraWeight = underAtmoMask * auroraNightGate * clamp(0.45 + polarProximity * 0.65, 0.0, 1.0);

  if (cosmosVis > 0.02 && (dir.y > 0.01 || spaceFactor > 0.12)) {
    // 3D spherical starfield mapping so stars surround the entire universe in all directions
    let starAz = atan2(dir.x, dir.z);
    let starEl = asin(clamp(dir.y, -0.999, 0.999));
    let sProj = vec2f(starAz * 3.2, starEl * 6.4);
    let starCell = floor(sProj * 115.0);
    let starH = h21(starCell);
    if (starH > 0.989) {
      let twinkle = 0.58 + 0.42 * sin(t * 3.2 + starH * 64.0);
      let starVis = select(smoothstep(0.04, 0.32, dir.y), 1.0, spaceFactor > 0.25);
      let starTint = mix(vec3f(0.78, 0.88, 1.0), vec3f(1.0, 0.88, 0.72), fract(starH * 31.7));
      col += starTint * (starH - 0.989) * 135.0 * twinkle * cosmosVis * starVis;
    }
    if (spaceFactor > 0.10) {
      let neb = fbm(sProj * 1.15 + vec2f(2.4, -1.7));
      let nebMask = smoothstep(0.50, 0.82, neb) * spaceFactor;
      let nebCol = mix(vec3f(0.05, 0.20, 0.36), vec3f(0.34, 0.09, 0.32), sin(sProj.x * 1.4 + sProj.y) * 0.5 + 0.5);
      col += nebCol * nebMask * 0.52;
    }
    // Distant 3D Planets (Saturn, Mars, Moon), Spiral Galaxy & Flying Meteorites
    let spaceBodyVis = clamp(spaceFactor + trueNightFactor * smoothstep(0.05, 0.35, dir.y) * 0.75, 0.0, 1.0);
    col += evalCosmicBodies(dir, t, spaceBodyVis);
    col += evalMeteorites(dir, t) * clamp(spaceFactor + trueNightFactor * 0.85, 0.0, 1.0);

    // Soft blended atmospheric Aurora ONLY when inside the atmosphere at night
    if (dir.y > 0.01 && auroraWeight > 0.01) {
      col += evalAurora(dir, t) * auroraWeight;
    }
  }

  // 3D Navigable Spherical Earth Globe & Atmospheric Limb when ascending out of the planet
  if (U.camPos.y > 140.0) {
    let pRad = 1850.0;
    let pCenter = vec3f(U.camPos.x, -pRad - (U.camPos.y - 130.0) * 1.32, U.camPos.z);
    let oc = U.camPos.xyz - pCenter;
    let b = dot(oc, dir);
    let cSph = dot(oc, oc) - pRad * pRad;
    let disc = b * b - cSph;
    let atmoDisc = b * b - (dot(oc, oc) - (pRad + 115.0) * (pRad + 115.0));
    if (disc > 0.0 && -b - sqrt(disc) > 0.0) {
      let tHit = -b - sqrt(disc);
      let hitPos = U.camPos.xyz + dir * tHit;
      let sNorm = normalize(hitPos - pCenter);
      // Tie globe rotation to player's wrapped planetary coordinates so flying in orbit moves across Earth
      let camLonOff = (U.camPos.x / WORLD_HALF) * PI;
      let camLatOff = (U.camPos.z / WORLD_HALF) * (PI * 0.38);
      let spinLon = atan2(sNorm.x, sNorm.z) + camLonOff + t * 0.004;
      let latVal = clamp(sNorm.y - sin(camLatOff) * 0.35, -1.0, 1.0);
      let sphUv = vec2f(spinLon * 2.1, latVal * 3.6);
      let contNoise = fbm(sphUv * 1.45) * 0.68 + fbm(sphUv * 3.6) * 0.32;
      let isLand = smoothstep(0.49, 0.55, contNoise);
      let latAbs = abs(latVal);
      // Both North Antarctica / Arctic Cap (latVal > 0.66) AND South Antarctica Continent (latVal < -0.64)
      let northPolarIce = smoothstep(0.65, 0.78, latVal + (contNoise - 0.5) * 0.14);
      let southAntarctica = smoothstep(0.62, 0.76, -latVal + (contNoise - 0.45) * 0.16);
      let iceMask = clamp(northPolarIce + southAntarctica, 0.0, 1.0);
      let oceanCol = mix(vec3f(0.012, 0.08, 0.22), vec3f(0.04, 0.42, 0.54), smoothstep(0.36, 0.51, contNoise));
      let jungleCol = vec3f(0.07, 0.28, 0.11);
      let savannaDesert = mix(vec3f(0.54, 0.42, 0.20), vec3f(0.74, 0.38, 0.20), smoothstep(0.55, 0.78, contNoise));
      let mountainRock = vec3f(0.36, 0.34, 0.32);
      var landBiome = mix(jungleCol, savannaDesert, smoothstep(0.16, 0.48, abs(latAbs - 0.28) * 2.4));
      landBiome = mix(landBiome, mountainRock, smoothstep(0.68, 0.82, contNoise));
      var surfAlb = mix(oceanCol, landBiome, isLand);
      surfAlb = mix(surfAlb, vec3f(0.92, 0.96, 1.0), iceMask);
      let cloudP = fbm(sphUv * 2.5 + vec2f(t * 0.014, -t * 0.005));
      let cloudM = smoothstep(0.47, 0.72, cloudP);
      surfAlb = mix(surfAlb, vec3f(0.95, 0.97, 1.0), cloudM * 0.70);
      let sNdotL = max(dot(sNorm, U.sunDir.xyz), 0.0);
      let limb = pow(1.0 - max(dot(sNorm, -dir), 0.0), 2.8);
      let oceanSpec = pow(max(dot(reflect(-U.sunDir.xyz, sNorm), -dir), 0.0), 42.0) * (1.0 - isLand) * (1.0 - cloudM) * 0.58;
      // Night-side planetary aurora hugging the magnetic polar rings ON the 3D Earth sphere (not in space!)
      let polarRing = smoothstep(0.58, 0.72, latAbs) * (1.0 - smoothstep(0.76, 0.90, latAbs));
      let nightSide = 1.0 - smoothstep(0.0, 0.24, sNdotL);
      let globeAurora = polarRing * nightSide * smoothstep(0.38, 0.75, fbm(sphUv * 4.2 + vec2f(t * 0.08)));
      let planetCol = surfAlb * (sNdotL * 1.18 + 0.045) +
                      vec3f(0.18, 0.56, 0.98) * limb * (sNdotL * 0.82 + 0.22) +
                      U.sunCol.rgb * oceanSpec * sNdotL +
                      mix(vec3f(0.08, 0.92, 0.56), vec3f(0.45, 0.22, 0.88), sin(spinLon * 3.0) * 0.5 + 0.5) * globeAurora * 0.65;
      col = mix(col, planetCol, smoothstep(145.0, 290.0, U.camPos.y));
    } else if (atmoDisc > 0.0 && -b > 0.0) {
      let halo = clamp(atmoDisc / (pRad * 210.0), 0.0, 1.0);
      col += vec3f(0.16, 0.52, 0.96) * halo * smoothstep(145.0, 310.0, U.camPos.y) * 0.82;
    }
  }

  let fireDir = normalize(vec3f(U.firePos.x - U.camPos.x, 12., U.firePos.z - U.camPos.z));
  let fd = max(dot(dir, fireDir), 0.);
  let fDist = length(U.camPos.xz - U.firePos.xz);
  let fGlow = pow(fd, 5.) * (1. - smoothstep(25., 320., fDist)) * U.fogCol.w * (1. - y * 0.75) * atmoDensity;
  col += vec3f(1.05, 0.36, 0.07) * fGlow;
  return col;
}

fn applyAtmosphere(col_in: vec3f, worldPos: vec3f) -> vec3f {
  var col = col_in;
  let v = worldPos - U.camPos.xyz;
  let dist = length(v);
  let dir = v / max(dist, 0.001);

  if (U.camPos.y < -0.05 || worldPos.y < -0.25) {
    let uwDist = select(dist * (1.0 - smoothstep(-2.5, 0.0, worldPos.y)), dist, U.camPos.y < -0.05);
    let depthFactor = clamp((-min(U.camPos.y, worldPos.y)) / 18.0, 0.0, 1.0);
    let waterFogCol = mix(vec3f(0.035, 0.26, 0.34), vec3f(0.012, 0.085, 0.14), depthFactor);
    let uwFog = 1.0 - exp(-uwDist * (0.018 + depthFactor * 0.014));
    col = mix(col, waterFogCol * max(0.28, U.sunDir.w), clamp(uwFog, 0.0, 0.94));
    if (U.camPos.y < -0.05) {
      return col;
    }
  }

  let atmoFade = 1.0 - smoothstep(180.0, 780.0, U.camPos.y);
  let baseFog = 1. - exp(-dist * U.sunCol.w * atmoFade);
  let hFactor = exp(-max(worldPos.y, 0.) * 0.095);
  let mist = (1. - exp(-dist * 0.009 * U.skyHorizon.w)) * hFactor * 0.48 * atmoFade;

  // Ascending cloud-deck & atmospheric scattering veil: world below gets lighter and softer as you climb
  let altHaze = smoothstep(32.0, 175.0, U.camPos.y) * (1.0 - smoothstep(220.0, 440.0, U.camPos.y));
  let fogAmt = clamp(baseFog + mist + altHaze * 0.48, 0., 0.94);

  let sd = max(dot(dir, U.sunDir.xyz), 0.);
  var fCol = mix(U.fogCol.rgb, U.sunCol.rgb * 0.85 + U.skyHorizon.rgb * 0.35, pow(sd, 5.) * 0.5 * U.sunDir.w);
  fCol = mix(fCol, vec3f(0.68, 0.84, 0.98) * max(0.35, U.sunDir.w), altHaze * 0.65);

  let wxz = wrapXZ(worldPos.xz);
  let df = length(wxz - U.firePos.xz);
  let smoke = (1. - smoothstep(15., 95.0, df)) * U.fogCol.w;
  fCol = mix(fCol, vec3f(0.26, 0.14, 0.08) + vec3f(0.85, 0.28, 0.04) * (1. - smoothstep(8., 55., df)), smoke * 0.78);

  let dSavanna = length(wxz - vec2f(-215.0, -35.0));
  let dDune = length(wxz - vec2f(-235.0, -185.0));
  if (dSavanna < 120.0 || dDune < 120.0) {
    let devilPos = vec2f(-215.0 + sin(U.camPos.w * 0.35) * 32.0, -35.0 + cos(U.camPos.w * 0.28) * 28.0);
    let dDevil = length(wxz - devilPos);
    let swirl = (1.0 - smoothstep(1.5, 12.0, dDevil)) * smoothstep(0.0, 18.0, worldPos.y) * (1.0 - smoothstep(14.0, 32.0, worldPos.y));
    fCol = mix(fCol, vec3f(0.82, 0.58, 0.34), clamp(swirl * 0.65, 0.0, 0.7));
  }

  col = mix(col, fCol, fogAmt);

  let instinct = fract(U.misc.w);
  if (instinct > 0.02) {
    let ring = abs(dist - instinct * 95.0);
    let pulse = (1.0 - smoothstep(0.0, 4.5, ring)) * (1.0 - instinct);
    col += vec3f(0.15, 0.88, 0.95) * pulse * 0.55;
  }
  return col;
}
`;

// ----------------------------------------------------------------------------
// 1. Sky Shader
// ----------------------------------------------------------------------------
const W_SKY = W_COMMON + /*wgsl*/`
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.9999, 1.);
  o.uv = p[vi];
  return o;
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let dir = normalize(
    U.camFwd.xyz +
    U.camRight.xyz * (v.uv.x * U.camRight.w * U.camFwd.w) +
    U.camUp.xyz * (v.uv.y * U.camFwd.w)
  );
  return vec4f(evalSky(dir), 1.);
}
`;

// ----------------------------------------------------------------------------
// 2. Terrain Shader (18 Biomes, Noniv/abyssal-garden Seabed & Caustics, Lava, Ice)
// ----------------------------------------------------------------------------
const W_TERRAIN = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var heightTex: texture_2d<f32>;
@group(1) @binding(1) var shadowTex: texture_depth_2d;
@group(1) @binding(2) var shadowSmp: sampler_comparison;
@group(1) @binding(3) var matTex: texture_2d_array<f32>;
@group(1) @binding(4) var matSmp: sampler;

struct VSIn {
  @location(0) grid: vec2f,
  @location(1) morph: vec4f, // xy = offset, z = scale, w = skirtDrop
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) @interpolate(flat) biome: vec4f,
};

fn sampleH(xz: vec2f) -> vec4f {
  let dims = vec2i(textureDimensions(heightTex));
  let wxz = wrapXZ(xz);
  let uv = clamp((wxz + vec2f(WORLD_HALF)) / WORLD_SPAN, vec2f(0.), vec2f(1.));
  let tc = clamp(vec2i(uv * vec2f(dims - vec2i(1))), vec2i(0), dims - vec2i(1));
  return textureLoad(heightTex, tc, 0);
}

@vertex fn vs(inp: VSIn) -> VSOut {
  let rawXZ = inp.grid * inp.morph.z + inp.morph.xy;
  let h0 = sampleH(rawXZ);
  let eps = 1.6;
  let hx1 = sampleH(rawXZ + vec2f(eps, 0.)).x;
  let hx0 = sampleH(rawXZ - vec2f(eps, 0.)).x;
  let hz1 = sampleH(rawXZ + vec2f(0., eps)).x;
  let hz0 = sampleH(rawXZ - vec2f(0., eps)).x;
  let n = normalize(vec3f(hx0 - hx1, 2. * eps, hz0 - hz1));

  // Planetary curvature horizon drop scaled with distance from camera
  let dCam = rawXZ - U.camPos.xz;
  let curveDrop = dot(dCam, dCam) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let wy = h0.x - inp.morph.w - curveDrop;
  let wp = vec3f(rawXZ.x, wy, rawXZ.y);

  var o: VSOut;
  o.pos = U.vp * vec4f(wp, 1.);
  o.worldPos = wp;
  o.norm = n;
  o.biome = vec4f(h0.y, h0.z, h0.w, h0.x);
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let rawXZ = inp.grid * inp.morph.z + inp.morph.xy;
  let h0 = sampleH(rawXZ);
  let dCam = rawXZ - U.camPos.xz;
  let curveDrop = dot(dCam, dCam) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let wp = vec3f(rawXZ.x, h0.x - inp.morph.w - curveDrop, rawXZ.y);
  return U.sunVp * vec4f(wp, 1.);
}

fn sampleShadow(wp: vec3f) -> f32 {
  let sc = U.sunVp * vec4f(wp, 1.);
  let p = sc.xyz / sc.w;
  let uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  let inBounds = uv.x >= 0.01 && uv.x <= 0.99 && uv.y >= 0.01 && uv.y <= 0.99 && p.z >= 0. && p.z <= 1.;
  let cuv = clamp(uv, vec2f(0.01), vec2f(0.99));
  let cz = clamp(p.z - 0.0025, 0.0, 1.0);
  var s = 0.;
  let texelStep = 1. / 2048.;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(shadowTex, shadowSmp, cuv + vec2f(f32(x), f32(y)) * texelStep, cz);
    }
  }
  return select(1., s / 9., inBounds);
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let wp = v.worldPos;
  let wxz = wrapXZ(wp.xz);
  let rHoriz = length(wp.xz - U.camPos.xz);
  let maxHorizR = 320.0 + clamp(U.camPos.y, 0.0, 260.0) * 1.15;

  // Sample procedural material array layers unconditionally before any discard
  let uvA = wp.xz * 0.28;
  let uvB = wp.xz * 0.09 + vec2f(0.37, 0.71);
  let sSoil  = mix(textureSample(matTex, matSmp, uvA, 0), textureSample(matTex, matSmp, uvB, 0), 0.42);
  let sMud   = mix(textureSample(matTex, matSmp, uvA, 1), textureSample(matTex, matSmp, uvB, 1), 0.42);
  let sSand  = mix(textureSample(matTex, matSmp, uvA, 2), textureSample(matTex, matSmp, uvB, 2), 0.38);
  let sMoss  = mix(textureSample(matTex, matSmp, uvA, 3), textureSample(matTex, matSmp, uvB, 3), 0.45);
  let sGrass = mix(textureSample(matTex, matSmp, uvA, 4), textureSample(matTex, matSmp, uvB, 4), 0.45);
  let sLitter = mix(textureSample(matTex, matSmp, uvA, 5), textureSample(matTex, matSmp, uvB, 5), 0.45);
  let sLimestone = textureSample(matTex, matSmp, uvA * 0.65, 7);
  let sGranite   = textureSample(matTex, matSmp, uvA * 0.55, 8);
  let sChar      = textureSample(matTex, matSmp, uvA * 0.8, 12);

  // Circular globe horizon boundary — eliminates square map appearance when ascending
  if (rHoriz > maxHorizR || U.camPos.y > 390.0) {
    discard;
  }

  var n = normalize(v.norm);
  let slope = 1. - clamp(n.y, 0., 1.);
  let h = v.biome.w;
  let wetness = clamp(v.biome.x + smoothstep(-0.35, 0.65, -h) * 0.65, 0., 1.);
  let fireBio = v.biome.z;
  // Lightweight altitude blur factor: smooths fine details into soft planetary biome colors as you ascend
  let altBlur = smoothstep(38.0, 210.0, U.camPos.y);

  let rockMask = smoothstep(0.24, 0.56, slope);
  let litterMask = smoothstep(0.35, 0.65, fbm(wxz * 0.35)) * (1. - wetness * 0.8);
  let grassMask = smoothstep(0.45, 2.2, h) * (1. - rockMask);

  var base = mix(sSoil.rgb, sGrass.rgb, grassMask * 0.72);
  base = mix(base, sMoss.rgb, clamp(v.biome.y * 0.65 + (1. - rockMask) * 0.25, 0., 1.));
  base = mix(base, sLitter.rgb, litterMask * 0.55);
  let rockCol = mix(sLimestone.rgb, sGranite.rgb, smoothstep(2.0, 9.0, h));
  base = mix(base, rockCol, rockMask);

  let sandMask = smoothstep(-1.4, 0.42, h) * (1. - smoothstep(0.25, 1.35, h));
  base = mix(base, sSand.rgb, sandMask * 0.68);
  base = mix(base, sMud.rgb, smoothstep(-0.35, 0.85, -h) * 0.82);

  let wSavanna = 1.0 - smoothstep(28.0, 110.0, length(wxz - vec2f(-215.0, -35.0)));
  if (wSavanna > 0.01) {
    let savGrass = mix(vec3f(0.58, 0.48, 0.22), vec3f(0.46, 0.32, 0.16), fbm(wxz * 0.18));
    let kopjeRock = vec3f(0.52, 0.42, 0.34) * (0.75 + 0.45 * sGranite.rgb);
    base = mix(base, mix(savGrass, kopjeRock, smoothstep(0.18, 0.48, slope)), wSavanna * 0.92);
  }

  let wPlantation = 1.0 - smoothstep(22.0, 78.0, length(wxz - vec2f(64.0, -148.0)));
  if (wPlantation > 0.01) {
    let terraceRiser = smoothstep(0.22, 0.52, slope);
    let terraceCol = mix(vec3f(0.18, 0.34, 0.14), vec3f(0.32, 0.36, 0.28), terraceRiser);
    base = mix(base, terraceCol, wPlantation * 0.68);
  }

  let wDune = 1.0 - smoothstep(26.0, 95.0, length(wxz - vec2f(-235.0, -185.0)));
  if (wDune > 0.01) {
    let ripple = sin((wxz.x * 1.4 + wxz.y * 0.65) * 4.5 + fbm(wxz * 0.4) * 3.0) * 0.06 * (1.0 - altBlur);
    let namibSand = vec3f(0.78, 0.36, 0.18) + vec3f(ripple);
    base = mix(base, namibSand, wDune * 0.94);
  }

  if (wxz.y > 152.0) {
    let oceanWeight = smoothstep(152.0, 185.0, wxz.y);
    let sandRipple = cos((wxz.x * 0.8 + wxz.y * 0.35) * 5.0) * 0.045 * (1.0 - altBlur);
    let beachSand = vec3f(0.84, 0.76, 0.58) + vec3f(sandRipple);
    let swashWet = smoothstep(0.05, 0.85, h) * (1.0 - smoothstep(0.85, 2.2, h));
    var marineCol = mix(beachSand * 0.68, beachSand, swashWet);

    if (h < 0.25) {
      let abDet = abyssalRockDetail(vec3f(wxz.x, h, wxz.y), n);
      n = normalize(n + vec3f(abDet.x * 0.35, 0.0, abDet.y * 0.35) * (1.0 - altBlur));
      let reefRock = mix(vec3f(0.16, 0.22, 0.26), vec3f(0.34, 0.38, 0.42), abDet.z);
      let sandyBed = vec3f(0.68, 0.64, 0.52) + vec3f(sandRipple * 0.8);
      marineCol = mix(sandyBed, reefRock, smoothstep(0.14, 0.42, slope + (1.0 - smoothstep(-14.0, -4.0, h)) * 0.25));
      let coralline = mix(vec3f(0.75, 0.14, 0.52), vec3f(0.45, 0.16, 0.82), sin(wxz.x * 0.4 + wxz.y * 0.3) * 0.5 + 0.5);
      marineCol = mix(marineCol, coralline, abDet.w * 0.72);
    }
    base = mix(base, marineCol, oceanWeight);
  }

  // Both South Polar Ice Shelf & North Antarctica Glacial Continent (wxz.y < -215.0)
  let wSouthPolar = max(
    1.0 - smoothstep(28.0, 100.0, length(wxz - vec2f(215.0, 255.0))),
    max(
      (1.0 - smoothstep(25.0, 90.0, length(wxz - vec2f(-215.0, 245.0)))) * 0.85,
      smoothstep(275.0, 325.0, wxz.y)
    )
  );
  let wNorthAntarctica = 1.0 - smoothstep(-265.0, -215.0, wxz.y);
  let wPolar = max(wSouthPolar, wNorthAntarctica);
  if (wPolar > 0.01 && h > -0.8) {
    let snowSparkle = step(0.985, h21(floor(wxz * 28.0 + U.camPos.w * 0.2))) * 0.65 * (1.0 - altBlur);
    let glacialBlue = vec3f(0.24, 0.64, 0.92);
    let pureSnow = vec3f(0.92, 0.96, 1.0) + vec3f(snowSparkle);
    let basaltCliff = vec3f(0.14, 0.16, 0.20);
    let isGlacial = max(smoothstep(-20.0, 80.0, wxz.x), wNorthAntarctica * 0.8);
    let cliffCol = mix(basaltCliff, glacialBlue, isGlacial);
    let polarCol = mix(pureSnow, cliffCol, smoothstep(0.20, 0.55, slope));
    base = mix(base, polarCol, wPolar * 0.95);
  }

  var emissive = vec3f(0.0);
  if (fireBio > 0.01) {
    let emberNoise = fbm(wxz * 2.4 + vec2f(U.camPos.w * 0.35, 0.));
    base = mix(base, sChar.rgb * 0.45, fireBio * 0.88);
    let emberMask = smoothstep(0.60, 0.82, emberNoise) * fireBio * U.fogCol.w;
    emissive += vec3f(2.4, 0.52, 0.06) * emberMask;
  }

  let wVolcano = 1.0 - smoothstep(22.0, 85.0, length(wxz - vec2f(245.0, 38.0)));
  if (wVolcano > 0.01) {
    let obsidian = vec3f(0.07, 0.07, 0.09) * (0.7 + 0.6 * sGranite.r);
    base = mix(base, obsidian, wVolcano * 0.94);
    let lavaFlow = fbm(wxz * 0.45 - vec2f(U.camPos.w * 0.22, U.camPos.w * 0.12));
    let inChannel = (1.0 - smoothstep(1.2, 4.8, h)) * (1.0 - smoothstep(0.15, 0.45, slope));
    let lavaGlow = smoothstep(0.38, 0.68, lavaFlow + inChannel * 0.45) * wVolcano;
    emissive += mix(vec3f(2.8, 0.32, 0.02), vec3f(4.5, 1.85, 0.22), lavaGlow) * lavaGlow * 1.6;
  }

  let wCenote = 1.0 - smoothstep(24.0, 88.0, length(wxz - vec2f(-148.0, -125.0)));
  if (wCenote > 0.02) {
    let bioVein = smoothstep(0.66, 0.82, fbm(wxz * 0.85 + vec2f(sin(U.camPos.w * 0.4) * 0.2)));
    let bioHue = mix(vec3f(0.08, 0.95, 0.78), vec3f(0.68, 0.18, 0.96), sin(wxz.x * 0.2 + wxz.y * 0.2) * 0.5 + 0.5);
    emissive += bioHue * bioVein * wCenote * 0.85;
  }

  // Blur out micro-normal detail as altitude increases so ascending is lightweight and blurry
  let dHx = ((sSoil.a - 0.5) * 0.28 + (sGranite.a - 0.5) * rockMask * 0.35) * (1.0 - altBlur);
  let dHz = ((sMoss.a - 0.5) * 0.28 + (sLimestone.a - 0.5) * rockMask * 0.35) * (1.0 - altBlur);
  n = normalize(mix(n + vec3f(dHx, 0., dHz), vec3f(0.0, 1.0, 0.0), altBlur * 0.65));

  let rough = clamp(mix(0.86 - sSoil.a * 0.15, 0.12, wetness * 0.78) + altBlur * 0.35, 0.08, 0.98);
  base *= mix(1., 0.56, wetness * 0.7);

  let V = normalize(U.camPos.xyz - wp);
  let L = U.sunDir.xyz;
  let H = normalize(V + L);
  let NdotL = max(dot(n, L), 0.);
  let NdotV = max(dot(n, V), 0.001);
  let NdotH = max(dot(n, H), 0.);
  let VdotH = max(dot(V, H), 0.);

  let sh = mix(sampleShadow(wp + n * 0.18), 1.0, altBlur);
  let D = distributionGGX(NdotH, rough);
  let G = geometrySmith(NdotV, NdotL, rough);
  let F = fresnelSchlick(VdotH, vec3f(mix(0.03, 0.05, wetness)));
  let spec = (D * G * F) / max(4. * NdotV * NdotL, 0.001) * (1.0 - altBlur * 0.85);

  let hemi = mix(vec3f(0.05, 0.08, 0.05), U.skyZenith.rgb * 0.48 + U.skyHorizon.rgb * 0.28, n.y * 0.5 + 0.5);
  var col = base * (hemi + U.sunCol.rgb * U.sunDir.w * NdotL * sh * (1. - F)) + spec * U.sunCol.rgb * U.sunDir.w * NdotL * sh + emissive * (1.0 - altBlur * 0.7);

  if (wPolar > 0.1 && h > 0.0) {
    let iceSss = pow(clamp(dot(-V, L + n * 0.4), 0.0, 1.0), 3.0) * wPolar * 0.45;
    col += vec3f(0.16, 0.58, 0.88) * iceSss * U.sunDir.w;
  }

  if (h < 0.05 && altBlur < 0.85) {
    let t = U.camPos.w * 0.65;
    let cuv = wxz * 0.085 + n.xz * 0.08;
    let cR = caus(cuv + vec2f(0.006, 0.0), t);
    let cG = caus(cuv, t);
    let cB = caus(cuv - vec2f(0.006, 0.0), t);
    let depthAtten = smoothstep(-22.0, -0.1, h) * smoothstep(-0.15, 0.08, -h);
    col += vec3f(cR * 0.9, cG * 1.15, cB * 1.35) * depthAtten * max(0.25, U.sunDir.w) * 0.62 * (1.0 - altBlur);
  }

  let df = length(wxz - U.firePos.xz);
  if (df < 95.) {
    let fDir = normalize(vec3f(U.firePos.x - wxz.x, 7. - h, U.firePos.z - wxz.y));
    let fAtt = pow(clamp(1. - df / 95., 0., 1.), 2.2) * U.fogCol.w;
    let flicker = 0.85 + 0.15 * sin(U.camPos.w * 13. + wxz.x * 0.5);
    col += base * vec3f(2.1, 0.68, 0.14) * max(dot(n, fDir), 0.15) * fAtt * flicker;
  }

  var finalCol = applyAtmosphere(col, wp);
  // Circular horizon & altitude handoff into the 3D spherical Earth globe so no square border ever appears
  let circleEdge = smoothstep(maxHorizR * 0.58, maxHorizR * 0.96, rHoriz);
  let orbitHandoff = smoothstep(155.0, 365.0, U.camPos.y);
  let skyBlend = clamp(max(circleEdge, orbitHandoff), 0.0, 1.0);
  if (skyBlend > 0.01) {
    finalCol = mix(finalCol, evalSky(normalize(wp - U.camPos.xyz)), skyBlend);
  }
  return vec4f(finalCol, 1.);
}
`;

// ----------------------------------------------------------------------------
// 3. Instanced Vegetation & Set-Piece Shader (Trees, Kelp, Shipwreck, Corals)
// ----------------------------------------------------------------------------
const W_VEG = W_COMMON + /*wgsl*/`
@group(1) @binding(1) var shadowTex: texture_depth_2d;
@group(1) @binding(2) var shadowSmp: sampler_comparison;
@group(1) @binding(3) var matTex: texture_2d_array<f32>;
@group(1) @binding(4) var matSmp: sampler;

struct VSIn {
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) uv: vec2f,     // u = matType (0=bark/wood/rock, 1=foliage/kelp, 2=flower/coral/glow), v = swayWeight
  @location(4) iPosScale: vec4f, // xyz = worldPos, w = scale
  @location(5) iRotSeed: vec4f,  // x = rotY, y = seed, z = charAmt, w = wetness
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) vMeta: vec2f, // x = charAmt, y = seed
};

fn displaceVeg(inp: VSIn) -> vec3f {
  let c = cos(inp.iRotSeed.x);
  let s = sin(inp.iRotSeed.x);
  var lp = inp.pos * inp.iPosScale.w;
  var p = vec3f(lp.x * c - lp.z * s, lp.y, lp.x * s + lp.z * c);

  let t = U.camPos.w;
  let swayW = inp.uv.y;
  // Toroidally wrap vegetation around camera XZ so jungles, reefs & boulders populate the entire planet endlessly
  let relXZ = wrapXZ(inp.iPosScale.xz - U.camPos.xz);
  let curveDrop = dot(relXZ, relXZ) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let wBase = vec3f(U.camPos.x + relXZ.x, inp.iPosScale.y - curveDrop, U.camPos.z + relXZ.y);

  if (inp.iPosScale.y < -0.25) {
    // Abyssal Garden multi-harmonic traveling wave current along segmented kelp stipes & frond blades
    let wavePhase = t * 1.75 - inp.pos.y * 0.92 + inp.iPosScale.x * 0.14 + inp.iRotSeed.y * 6.28;
    let surgeX = sin(wavePhase) * 0.46 + cos(t * 0.95 + inp.iPosScale.z * 0.16) * 0.25;
    let surgeZ = cos(wavePhase * 0.85) * 0.36 + sin(t * 1.15 + inp.iPosScale.x * 0.15) * 0.22;
    let bladeFlutter = sin(t * 4.8 + inp.pos.y * 3.5 + inp.pos.x * 5.0) * 0.08 * swayW * swayW;
    p.x += (surgeX * swayW + bladeFlutter) * inp.iPosScale.w * 0.42;
    p.z += (surgeZ * swayW + bladeFlutter * 0.8) * inp.iPosScale.w * 0.42;
    p.y -= abs(surgeX) * swayW * swayW * 0.06 * inp.iPosScale.w;
    // Swimmer wake deflection when camera/creature passes through kelp forest
    let wakeVec = (wBase.xz + p.xz) - U.camPos.xz;
    let wakeD = length(wakeVec);
    if (wakeD < 4.5 && abs(U.camPos.y - (wBase.y + p.y)) < 4.5) {
      let push = (1.0 - wakeD / 4.5) * swayW * 0.65;
      let wakeDir = wakeVec / max(0.05, wakeD);
      p.x += wakeDir.x * push;
      p.z += wakeDir.y * push;
    }
  } else {
    let gust = sin(t * 1.6 + inp.iRotSeed.y * 6.28 + inp.iPosScale.x * 0.06) * 0.6 + cos(t * 2.9 + inp.iPosScale.z * 0.08) * 0.4;
    let windStr = U.wind.z * (0.5 + 0.5 * gust);
    p.x += U.wind.x * windStr * swayW * 0.45 * inp.iPosScale.w;
    p.z += U.wind.y * windStr * swayW * 0.45 * inp.iPosScale.w;
    if (inp.uv.x > 0.5) {
      let f = sin(t * 5.2 + inp.pos.x * 4.1 + inp.pos.z * 3.7 + inp.iRotSeed.y * 12.) * 0.06 * swayW;
      p.y += f * inp.iPosScale.w;
    }
  }
  return wBase + p;
}

@vertex fn vs(inp: VSIn) -> VSOut {
  let wp = displaceVeg(inp);
  let c = cos(inp.iRotSeed.x);
  let s = sin(inp.iRotSeed.x);
  let wn = normalize(vec3f(inp.norm.x * c - inp.norm.z * s, inp.norm.y, inp.norm.x * s + inp.norm.z * c));
  var o: VSOut;
  o.pos = U.vp * vec4f(wp, 1.);
  o.worldPos = wp;
  o.norm = wn;
  o.col = inp.col;
  o.uv = inp.uv;
  o.vMeta = vec2f(inp.iRotSeed.z, inp.iRotSeed.y);
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let wp = displaceVeg(inp);
  return U.sunVp * vec4f(wp, 1.);
}

@fragment fn fs(v: VSOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let wp = v.worldPos;
  let rHoriz = length(wp.xz - U.camPos.xz);
  if (rHoriz > 310.0 || U.camPos.y > 235.0) {
    discard;
  }
  var n = normalize(select(-v.norm, v.norm, ff));
  let isLeaf = v.uv.x > 0.5;
  let isGlow = v.uv.x > 1.5;

  let sc = U.sunVp * vec4f(wp + n * 0.15, 1.);
  let sp = sc.xyz / sc.w;
  let suv = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
  let inBounds = suv.x > 0.01 && suv.x < 0.99 && suv.y > 0.01 && suv.y < 0.99 && sp.z > 0. && sp.z < 1.;
  let rawSh = textureSampleCompareLevel(shadowTex, shadowSmp, clamp(suv, vec2f(0.01), vec2f(0.99)), clamp(sp.z - 0.003, 0.0, 1.0));
  let sh = select(1., rawSh, inBounds);

  let barkLayer = i32(floor(fract(v.vMeta.y * 7.13) * 3.0)) + 9;
  let leafLayer = i32(floor(fract(v.vMeta.y * 11.37) * 3.0)) + 13;
  // Use textureSampleLevel to avoid atan2 wrap derivative seams and non-uniform discard issues
  let barkSample = textureSampleLevel(matTex, matSmp, vec2f(atan2(n.x, n.z) * 0.8, wp.y * 0.45), barkLayer, 0.0);
  let leafSample = textureSampleLevel(matTex, matSmp, wp.xz * 0.75 + vec2f(v.uv.y), leafLayer, 0.0);

  var albedo = v.col;
  if (isLeaf && !isGlow) {
    albedo = mix(v.col, leafSample.rgb, 0.38);
    if (leafSample.a < 0.12 && v.uv.y > 0.72) {
      discard;
    }
  } else if (!isLeaf) {
    albedo = mix(v.col, barkSample.rgb, 0.42);
    n = normalize(n + vec3f((barkSample.a - 0.5) * 0.25, 0., (barkSample.r - 0.5) * 0.25));
  }

  albedo = mix(albedo, vec3f(0.06, 0.05, 0.05), v.vMeta.x * 0.85);
  let L = U.sunDir.xyz;
  let V = normalize(U.camPos.xyz - wp);
  let NdotL = max(dot(n, L), 0.);

  let hemi = mix(vec3f(0.05, 0.08, 0.05), U.skyZenith.rgb * 0.45 + U.skyHorizon.rgb * 0.25, n.y * 0.5 + 0.5);
  var col = albedo * (hemi + U.sunCol.rgb * U.sunDir.w * NdotL * sh);

  if (isLeaf) {
    let backLit = pow(clamp(dot(V, -L + n * 0.35), 0., 1.), 3.0) * (0.4 + 0.6 * sh);
    col += albedo * U.sunCol.rgb * backLit * 0.92 * U.sunDir.w;
    let H = normalize(V + L);
    let spec = pow(max(dot(n, H), 0.), 28.) * 0.14 * sh;
    col += U.sunCol.rgb * spec * U.sunDir.w;
  }

  if (isGlow) {
    let pulse = 0.82 + 0.18 * sin(U.camPos.w * 2.8 + v.vMeta.y * 12.0);
    col += v.col * 0.85 * pulse;
  }

  if (wp.y < -0.05) {
    let cVal = caus(wp.xz * 0.09 + n.xz * 0.06, U.camPos.w * 0.65);
    col += vec3f(0.22, 0.58, 0.72) * cVal * smoothstep(-18.0, -0.1, wp.y) * max(0.0, n.y + 0.35) * 0.55;
  }

  if (v.vMeta.x > 0.25) {
    let ember = smoothstep(0.62, 0.88, n2(wp.xy * 3.2 + vec2f(0., -U.camPos.w * 1.4))) * v.vMeta.x * U.fogCol.w;
    col += vec3f(2.4, 0.58, 0.08) * ember;
  }

  let df = length(wp.xz - U.firePos.xz);
  if (df < 90.) {
    let fAtt = pow(clamp(1. - df / 90., 0., 1.), 2.) * U.fogCol.w;
    col += albedo * vec3f(1.8, 0.55, 0.10) * fAtt;
  }

  return vec4f(applyAtmosphere(col, wp), 1.);
}
`;

// ----------------------------------------------------------------------------
// 4. Wildlife & Marine Creature Shader
//    Includes Facial Expressions (Jaw Roar/Pant, Ear Swivel, Eye Glint, Brow),
//    Emotional Postures (Grazing Dip, Curious Tilt, Stealth Crouch, Chest-Beat),
//    and Continuous Zero-Slide IK Muscle Skinning
// ----------------------------------------------------------------------------
const W_ANIMAL = W_COMMON + /*wgsl*/`
struct VSIn {
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) uv: vec2f,        // x = anatomical region (0.12=eye, 0.18=lowerJaw, 0.24=ear/pinna, 0.4=limb, 0.5=torso/head, 0.8=tail/wing), y = longitudinal param
  @location(4) iPosScale: vec4f, // xyz = worldPos, w = scale
  @location(5) iAnim: vec4f,     // x = yaw, y = stridePhase, z = packedEmotionAndSpeed (floor(z)=emotion 0..4, fract(z)*10=animSpeed), w = packedMode (speciesId * 16 + mode)
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) localPos: vec3f,
  @location(4) uv: vec2f,
  @location(5) @interpolate(flat) species: f32,
  @location(6) @interpolate(flat) emotion: f32,
};

fn isLimbFactor(b: bool) -> f32 {
  return select(0.0, 1.0, b);
}

@vertex fn vs(inp: VSIn) -> VSOut {
  var p = inp.pos;
  var n = inp.norm;
  let emotion = floor(inp.iAnim.z);
  let animSpd = max(0.25, fract(inp.iAnim.z) * 10.0);
  let realT = U.camPos.w * animSpd + inp.iAnim.y * 0.37;
  let strideT = inp.iAnim.y;
  let packed = inp.iAnim.w;
  let mode = packed - floor(packed / 16.0) * 16.0;
  let sp = floor(packed / 16.0);
  let anat = inp.uv.x;

  // --------------------------------------------------------------------------
  // A. Universal Vital Signs & Facial Expressions (Jaw, Ears, Head Gaze, Tail)
  // --------------------------------------------------------------------------
  // 1. Ribcage & Belly Breathing (accelerates when alert/panicked/chasing)
  let breathRate = select(2.2, 4.8, emotion >= 2.5);
  let breathAmp = select(0.015, 0.032, emotion >= 2.5);
  let ribMask = smoothstep(-0.35, 0.35, p.z) * (1.0 - smoothstep(0.35, 0.68, p.z)) * smoothstep(0.15, 0.75, p.y);
  let breath = sin(realT * breathRate + p.z * 2.5) * breathAmp * ribMask;
  p.x += sign(p.x) * breath;
  p.y += breath * 0.65;

  // 2. Articulated Lower Jaw / Beak / Gape (anat in 0.16..0.21)
  if (anat > 0.16 && anat < 0.21) {
    // Emotion 3 (Aggressive Roar/Bellow/Trumpet) opens jaw wide; Emotion 0/1 has subtle chew/pant
    let roarOpen = select(
      max(0.0, sin(realT * 3.4)) * 0.035,
      (0.55 + 0.45 * sin(realT * 6.5)) * 0.14,
      abs(emotion - 3.0) < 0.4
    );
    p.y -= roarOpen;
    p.z -= roarOpen * 0.25;
  }

  // 3. Expressive Ear Pinnae Swivel & Alert/Aggressive Pinning (anat in 0.22..0.28)
  if (anat > 0.22 && anat < 0.28) {
    let earSide = sign(p.x);
    if (abs(sp - 28.0) < 0.5) {
      // African Bush Elephant broad ear-fanning cooling cycle
      let fan = (0.5 + 0.5 * sin(realT * 2.8 + earSide * 0.4)) * select(0.18, 0.38, emotion >= 2.5);
      p.z -= fan * abs(p.x);
      p.x += earSide * fan * 0.25;
    } else {
      // Mammalian ear twitch & pin-back when stalking/fleeing
      let twitch = sin(realT * 4.5 + earSide * 1.7) * 0.025;
      let pinBack = select(0.0, -0.065, emotion >= 2.5);
      p.z += twitch + pinBack;
      p.y += pinBack * 0.35;
    }
  }

  // 4. Head Gaze Scan, Curious Head-Tilt & Herbivore Grazing Neck-Dip
  let headWeight = smoothstep(0.38, 0.85, p.z) * smoothstep(0.18, 0.95, p.y);
  if (headWeight > 0.01 && mode > 2.5) {
    if (abs(emotion - 0.0) < 0.4 && (abs(sp - 13.0) < 0.5 || abs(sp - 29.0) < 0.5 || abs(sp - 30.0) < 0.5)) {
      // Herbivores (Deer, Giraffe, Zebra) rhythmic grazing/drinking neck-dip when calm
      let grazeDip = smoothstep(0.35, 0.85, sin(realT * 0.55)) * 0.26 * headWeight;
      p.y -= grazeDip;
      p.z += grazeDip * 0.22;
    } else if (abs(emotion - 1.0) < 0.4) {
      // Curious / Social head-tilt (roll around Z axis) + inquisitive nod
      let tilt = sin(realT * 1.8) * 0.18 * headWeight;
      let ox = p.x;
      let oy = p.y - 0.72;
      p.x = ox * cos(tilt) - oy * sin(tilt);
      p.y = 0.72 + ox * sin(tilt) + oy * cos(tilt);
    } else if (abs(emotion - 2.0) < 0.4) {
      // Alert / Vigilant rapid left-right horizon scan + elevated head
      let lookYaw = sin(realT * 2.6) * 0.16 * headWeight;
      p.x += lookYaw;
      p.y += 0.05 * headWeight;
    }
  }

  // 5. Elephant Prehensile Trunk S-Curl & Trumpet Lift
  if (abs(sp - 28.0) < 0.5 && p.z > 1.05) {
    let trunkFactor = clamp((p.z - 1.05) / 0.55, 0.0, 1.0);
    let trumpetLift = select(sin(realT * 1.4) * 0.16, 0.65 + 0.25 * sin(realT * 4.2), abs(emotion - 3.0) < 0.4);
    p.y += trumpetLift * trunkFactor * trunkFactor;
    p.x += sin(realT * 1.9 + trunkFactor * 2.5) * 0.12 * trunkFactor;
  }

  // --------------------------------------------------------------------------
  // B. Locomotion & Species-Characteristic Biome Mechanics
  // --------------------------------------------------------------------------
  if (mode > 0.5 && mode < 1.5) {
    // Mode 1: Aquatic S-wave undulation / Whale fluke stroke / Manta Ray wing flap
    if (abs(sp - 34.0) < 0.5) {
      let span = abs(p.x);
      let amp = 0.36 * pow(span, 1.6);
      let wave = sin(realT * 3.6 - p.z * 1.4 - span * 0.85);
      p.y += wave * amp;
      p.z += cos(realT * 1.8) * 0.04 * span;
      n = normalize(vec3f(n.x - sign(p.x) * wave * 0.28 * span, n.y, n.z));
    } else if (abs(sp - 31.0) < 0.5 || abs(sp - 32.0) < 0.5) {
      let tailW = clamp(-p.z + 0.25, 0.0, 2.2);
      let stroke = sin(realT * 2.8 - tailW * 1.65) * 0.24 * tailW * tailW;
      p.y += stroke;
      // Pectoral flipper graceful banking oscillation
      let pecW = clamp(abs(p.x) - 0.35, 0.0, 1.5);
      p.y += sin(realT * 2.1 + sign(p.x) * 0.6) * 0.12 * pecW;
    } else {
      // Anatomical Reef & Pelagic Fish travelling body-wave propulsion + pectoral fin sculling
      let spine = clamp(0.45 - p.z, 0.0, 1.8);
      let wave = sin(realT * 6.2 - spine * 4.1);
      p.x += wave * 0.14 * spine * (0.35 + 0.65 * spine);
      if (abs(p.x) > 0.05 && p.z > -0.1) {
        p.y += sin(realT * 7.5 + sign(p.x) * 1.2) * 0.035 * abs(p.x);
      }
    }
  } else if (mode > 1.5 && mode < 2.5) {
    // Mode 2: Avian articulated 2-joint wingbeat, feather spread & head stabilization
    let span = abs(p.x);
    if (span > 0.08) {
      let inner = clamp(span, 0., 0.45);
      let outer = max(0., span - 0.45);
      let flap1 = sin(realT * 7.8) * inner * 0.72;
      let flap2 = sin(realT * 7.8 - 0.55) * outer * 1.08;
      p.y += flap1 + flap2;
      p.z -= cos(realT * 7.8) * outer * 0.15;
    }
    p.y += cos(realT * 7.8) * 0.035;
  } else if (mode > 2.5 && mode < 3.5) {
    // Mode 3: 2-Joint Articulated Hip/Shoulder + Knee/Elbow + Foot-Arc Quadruped / Biped Stride
    let side = select(-1., 1., p.x >= 0.);
    let front = select(-1., 1., p.z >= 0.);
    let isLimb = abs(anat - 0.4) < 0.07;
    // Normalized joint gradient limbT: 0.0 at hip/shoulder pivot -> 0.5 at knee/elbow -> 1.0 at paw/hoof
    let rawLimbT = select(
      clamp((0.35 - inp.uv.y) / 0.35, 0.0, 1.0),
      clamp((inp.uv.y - 0.60) / 0.40, 0.0, 1.0),
      front > 0.0
    );
    let limbT = select(clamp((0.52 - p.y) / 0.52, 0.0, 1.0), rawLimbT, isLimb);
    let legMask = select(clamp((0.26 - p.y) * 4.2, 0.0, 1.0), smoothstep(0.02, 0.16, limbT), isLimb);

    // 4-beat lateral walk/trot phase offset: Left/Right opposite (PI), Front/Hind quarter-cycle (PI/2)
    let phase = strideT + select(0.0, PI, side > 0.0) + select(0.0, 1.5708, front < 0.0);
    let swing = sin(phase);
    let liftPhase = cos(phase);

    // 1. Hip/Shoulder Pendulum Swing + 2. Knee/Elbow Flexion Bend + 3. Lower Shin Whip Extension
    let hipSwing = swing * 0.22 * limbT;
    let kneeBend = max(0.0, cos(phase - 0.45)) * sin(limbT * PI) * 0.14;
    let pawWhip  = sin(phase - 0.55) * max(0.0, limbT - 0.45) * 0.16;
    let footClearance = pow(max(0.0, liftPhase), 1.35) * (0.14 * limbT * limbT) + kneeBend * 0.45;

    p.z += (hipSwing - kneeBend * front + pawWhip) * legMask;
    p.y += footClearance * legMask;

    // Muscle belly expansion & shoulder scapula roll during stance push-off
    let stancePush = max(0.0, -swing);
    let muscleFlex = stancePush * smoothstep(0.12, 0.48, p.y) * (1.0 - smoothstep(0.48, 0.85, p.y));
    p.x += sign(p.x) * muscleFlex * 0.032;
    p.y += stancePush * (1.0 - limbT) * isLimbFactor(isLimb) * 0.025;

    // Predator Stealth Crouch (Lion, Tiger, Jaguar, Panther in emotion 3)
    let isBigCat = abs(sp - 24.0) < 0.5 || abs(sp - 25.0) < 0.5 || abs(sp - 1.0) < 0.5 || abs(sp - 11.0) < 0.5;
    if (isBigCat && abs(emotion - 3.0) < 0.4) {
      p.y *= 0.78;
      p.z += smoothstep(0.2, 0.9, p.y) * 0.08;
    }

    // Silverback Gorilla & Chimpanzee Bipedal Chest-Beat Display (sp 26/27 in emotion 3)
    if ((abs(sp - 26.0) < 0.5 || abs(sp - 27.0) < 0.5) && abs(emotion - 3.0) < 0.4) {
      let rise = smoothstep(-0.1, 0.7, p.z);
      p.y += rise * 0.28;
      if (front > 0.0 && abs(p.x) > 0.12) {
        let drum = sin(realT * 14.0 + side * 3.14) * 0.12;
        p.y += 0.25 + drum;
        p.x *= 0.65;
        p.z += drum * 0.5;
      }
    }

    // Emperor Penguin Authentic Waddle Roll (sp == 35)
    if (abs(sp - 35.0) < 0.5) {
      let waddle = sin(strideT) * 0.12 * smoothstep(0.05, 0.75, p.y);
      p.x += waddle;
    }

    // Spine counter-flexion, hip/shoulder weight transfer & expressive tail whip
    let bodyMask = 1.0 - legMask;
    p.y += cos(strideT * 2.0) * 0.026 * bodyMask;
    p.x += sin(strideT - p.z * 2.2) * 0.024 * bodyMask;
    if (p.z < -0.35) {
      let tailFreq = select(3.2, 7.5, emotion >= 2.5);
      let tailAmp = select(0.08, 0.16, emotion >= 2.5);
      p.x += sin(realT * tailFreq + p.z * 3.5) * tailAmp * (-p.z - 0.35);
      p.y += cos(realT * (tailFreq * 0.7) + p.z * 2.5) * (tailAmp * 0.45) * (-p.z - 0.35);
    }
  } else if (mode > 3.5) {
    // Mode 4: Arboreal Primates, Tree Frogs (Vocal Sac Inflation) & Climbing Sloths
    let cycle = sin(realT * 3.8);
    p.y += max(0., cycle) * 0.08 * clamp(p.y + 0.3, 0., 1.2);
    p.x += sin(realT * 2.4 + p.y * 2.1) * 0.045;
    if ((abs(sp - 16.0) < 0.5 || abs(sp - 17.0) < 0.5) && p.z > 0.05 && p.y < 0.12) {
      // Frog vocal sac inflation pulse
      let sac = max(0.0, sin(realT * 4.5)) * 0.045;
      p.y -= sac;
      p.z += sac * 0.8;
    }
  } else {
    // Mode 0: Expressive Idle — ribcage breathing, head look-around & ear/tail micro-motion
    let lookScan = sin(realT * 1.4 + inp.iAnim.x) * 0.055 * smoothstep(0.15, 0.65, p.z);
    p.x += lookScan;
  }

  let c = cos(inp.iAnim.x);
  let s = sin(inp.iAnim.x);
  let sp_scale = inp.iPosScale.w;
  // Toroidally wrap animal instance around U.camPos.xz with matching planetary curvature drop
  let relXZ = wrapXZ(inp.iPosScale.xz - U.camPos.xz);
  let curveDrop = dot(relXZ, relXZ) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let basePos = vec3f(U.camPos.x + relXZ.x, inp.iPosScale.y - curveDrop, U.camPos.z + relXZ.y);
  let wp = basePos + vec3f((p.x * c - p.z * s) * sp_scale, p.y * sp_scale, (p.x * s + p.z * c) * sp_scale);
  let wn = normalize(vec3f(n.x * c - n.z * s, n.y, n.x * s + n.z * c));

  var o: VSOut;
  o.pos = U.vp * vec4f(wp, 1.);
  o.worldPos = wp;
  o.norm = wn;
  o.col = inp.col;
  o.localPos = inp.pos;
  o.uv = inp.uv;
  o.species = sp;
  o.emotion = emotion;
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let c = cos(inp.iAnim.x);
  let s = sin(inp.iAnim.x);
  let p = inp.pos * inp.iPosScale.w;
  let relXZ = wrapXZ(inp.iPosScale.xz - U.camPos.xz);
  let curveDrop = dot(relXZ, relXZ) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let basePos = vec3f(U.camPos.x + relXZ.x, inp.iPosScale.y - curveDrop, U.camPos.z + relXZ.y);
  let wp = basePos + vec3f(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  return U.sunVp * vec4f(wp, 1.);
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let wp = v.worldPos;
  let sp = i32(round(v.species));
  if ((length(wp.xz - U.camPos.xz) > 310.0 || U.camPos.y > 235.0) && (sp < 21 || sp > 23)) {
    discard;
  }
  var n = normalize(v.norm);
  let lp = v.localPos;
  let L = U.sunDir.xyz;
  let V = normalize(U.camPos.xyz - wp);
  let H = normalize(V + L);

  // Lookdev calibration spheres & ColorChecker (sp 21..23)
  if (sp >= 21 && sp <= 23) {
    var ldAlbedo = v.col;
    var ldRough = 0.45;
    var ldMetal = 0.0;
    if (sp == 21) {
      ldAlbedo = vec3f(0.18, 0.18, 0.18);
      ldRough = 0.52;
    } else if (sp == 22) {
      ldAlbedo = vec3f(0.95, 0.95, 0.96);
      ldRough = 0.05;
      ldMetal = 1.0;
    }
    let NdotL = max(dot(n, L), 0.);
    let NdotV = max(dot(n, V), 0.001);
    let NdotH = max(dot(n, H), 0.);
    let D = distributionGGX(NdotH, ldRough);
    let G = geometrySmith(NdotV, NdotL, ldRough);
    let F0 = mix(vec3f(0.04), ldAlbedo, ldMetal);
    let F = fresnelSchlick(max(dot(V, H), 0.), F0);
    let R = reflect(-V, n);
    let envCol = evalSky(R);
    let diff = ldAlbedo * (1. - ldMetal) * (U.skyZenith.rgb * 0.35 + U.sunCol.rgb * U.sunDir.w * NdotL);
    let spec = (D * G * F) / max(4. * NdotV * NdotL, 0.001) * U.sunCol.rgb * U.sunDir.w * NdotL + envCol * F * (1. - ldRough * 0.7);
    return vec4f(diff + spec, 1.);
  }

  var albedo = v.col;
  var rough = 0.58;
  var furSheen = 0.0;

  // Expressive Cornea / Eye Glint (uv.x in 0.10..0.15)
  let isEye = v.uv.x > 0.10 && v.uv.x < 0.15;
  if (isEye) {
    rough = 0.04;
  } else if (sp == 1) {
    let vr = voronoi(lp.xz * 13.5 + vec2f(lp.y * 4.5));
    let ring = smoothstep(0.16, 0.25, vr.x) * (1. - smoothstep(0.28, 0.40, vr.x));
    let dotC = 1. - smoothstep(0.05, 0.11, vr.x);
    let rosette = clamp(ring + dotC * 0.65, 0., 1.) * smoothstep(-0.08, 0.18, lp.y);
    albedo = mix(albedo, vec3f(0.06, 0.04, 0.03), rosette * 0.88);
    furSheen = 0.42;
  } else if (sp == 2 || sp == 15) {
    let sc = voronoi(lp.xz * 26. + vec2f(0., lp.y * 12.));
    let groove = 1. - smoothstep(0.0, 0.12, sc.x);
    albedo = mix(albedo, albedo * 0.35, groove * 0.75);
    if (sp == 15) {
      let blotch = smoothstep(0.22, 0.36, voronoi(lp.xz * 6.5).x);
      albedo = mix(vec3f(0.08, 0.09, 0.04), albedo, blotch);
    }
    n = normalize(n + vec3f((sc.y - 0.5) * 0.22, 0., (sc.x - 0.5) * 0.22));
    rough = 0.20;
  } else if (sp == 3) {
    let sc = voronoi(lp.xz * 10.5);
    let border = 1. - smoothstep(0.02, 0.09, sc.x);
    albedo = mix(albedo * (0.8 + 0.35 * sc.y), vec3f(0.08, 0.06, 0.04), border * 0.85);
    rough = 0.24;
  } else if (sp >= 4 && sp <= 10) {
    let fRow = sin(lp.z * 62. + sin(lp.x * 38.) * 2.2) * 0.5 + 0.5;
    let barb = sin((lp.x + lp.z * 0.4) * 180.0) * 0.04;
    albedo *= 0.88 + 0.24 * fRow + barb;
    rough = 0.38;
    furSheen = 0.32;
  } else if (sp >= 11 && sp <= 13) {
    let fur = n2(lp.xz * 55. + vec2f(lp.y * 28.));
    albedo *= 0.88 + 0.24 * fur;
    if (sp == 13 && lp.y > 0.08) {
      let spV = voronoi(lp.xz * 14.);
      let fawnSpot = (1. - smoothstep(0.08, 0.16, spV.x)) * step(0.62, spV.y);
      albedo = mix(albedo, vec3f(0.95, 0.92, 0.84), fawnSpot * 0.75);
    }
    furSheen = 0.45;
  } else if (sp == 16 || sp == 17) {
    if (sp == 16) {
      let vr = voronoi(lp.xz * 16. + vec2f(lp.y * 10.));
      let spot = 1. - smoothstep(0.14, 0.22, vr.x);
      albedo = mix(albedo, vec3f(0.03, 0.04, 0.06), spot * 0.9);
    }
    rough = 0.12;
  } else if (sp == 18 || sp == 19) {
    let vein = abs(sin(lp.x * 42. + sin(lp.z * 28.) * 1.5));
    let vMask = 1. - smoothstep(0.0, 0.12, vein);
    let irid = pow(1. - max(dot(n, V), 0.), 2.0);
    albedo = mix(albedo, albedo * vec3f(0.6, 1.15, 1.45), irid * 0.65);
    albedo = mix(albedo, vec3f(0.04, 0.04, 0.05), vMask * 0.6);
    rough = 0.25;
  } else if (sp == 20) {
    let fur = n2(lp.xz * 48.);
    albedo *= 0.9 + 0.2 * fur;
    furSheen = 0.35;
  } else if (sp == 24) {
    let furStrand = n2(lp.xz * 95.0 + vec2f(lp.y * 65.0));
    let maneZone = smoothstep(0.08, 0.42, lp.z) * (1.0 - smoothstep(0.48, 0.72, lp.z)) * smoothstep(-0.05, 0.25, lp.y);
    let maneCol = mix(vec3f(0.22, 0.12, 0.05), vec3f(0.48, 0.28, 0.10), furStrand);
    albedo = mix(albedo * (0.88 + 0.24 * furStrand), maneCol, maneZone * 0.78);
    furSheen = 0.56;
  } else if (sp == 25) {
    let furStrand = n2(lp.xz * 95.0 + vec2f(lp.y * 55.0));
    let warp = fbm(lp.yz * 6.5) * 1.8;
    let stripeWave = sin(lp.z * 28.0 + warp + abs(lp.x) * 6.0);
    let stripeMask = smoothstep(0.58, 0.78, stripeWave) * smoothstep(-0.18, 0.12, lp.y);
    let bellyMask = 1.0 - smoothstep(-0.12, 0.08, lp.y);
    albedo = mix(albedo * (0.9 + 0.2 * furStrand), vec3f(0.95, 0.93, 0.88), bellyMask * 0.75);
    albedo = mix(albedo, vec3f(0.04, 0.03, 0.03), stripeMask * 0.92);
    furSheen = 0.52;
  } else if (sp == 26 || sp == 27) {
    let hair = n2(lp.xz * 85.0 + vec2f(lp.y * 60.0));
    albedo *= 0.84 + 0.32 * hair;
    if (sp == 26) {
      let saddle = smoothstep(-0.35, 0.15, lp.z) * (1.0 - smoothstep(0.15, 0.45, lp.z)) * smoothstep(0.05, 0.38, lp.y);
      albedo = mix(albedo, vec3f(0.72, 0.75, 0.78) * (0.85 + 0.25 * hair), saddle * 0.82);
    }
    furSheen = 0.48;
  } else if (sp == 28) {
    let w1 = sin(lp.z * 45.0 + fbm(lp.xy * 8.0) * 4.0);
    let w2 = sin(lp.y * 52.0 + fbm(lp.xz * 8.0) * 4.0);
    let crease = smoothstep(0.55, 0.88, w1 * w2);
    albedo = mix(albedo, vec3f(0.54, 0.44, 0.36), crease * 0.45);
    n = normalize(n + vec3f(w1 * 0.08, w2 * 0.08, 0.0));
    rough = 0.78;
  } else if (sp == 29) {
    let vr = voronoi(lp.yz * 7.8 + vec2f(lp.x * 5.2));
    let net = 1.0 - smoothstep(0.03, 0.13, vr.x);
    albedo = mix(vec3f(0.48, 0.22, 0.08), vec3f(0.94, 0.86, 0.66), net);
    furSheen = 0.38;
  } else if (sp == 30) {
    let warp = fbm(lp.yz * 5.2) * 1.4;
    let zStripe = smoothstep(-0.08, 0.08, sin(lp.z * 32.0 + lp.y * 8.0 + warp));
    albedo = mix(vec3f(0.06, 0.06, 0.07), vec3f(0.94, 0.93, 0.90), zStripe);
    furSheen = 0.40;
  } else if (sp == 31 || sp == 32 || sp == 33 || sp == 34) {
    rough = 0.16;
    if (sp == 31) {
      let pleats = sin(lp.x * 55.0) * 0.5 + 0.5;
      let isVentral = (1.0 - smoothstep(-0.18, 0.08, lp.y)) * smoothstep(-0.1, 0.75, lp.z);
      albedo = mix(albedo, mix(vec3f(0.78, 0.82, 0.86), vec3f(0.22, 0.28, 0.34), pleats * 0.65), isVentral * 0.82);
    } else if (sp == 32) {
      let whiteBelly = 1.0 - smoothstep(-0.12, 0.04, lp.y + sin(lp.z * 3.5) * 0.06);
      let eyePatch = smoothstep(0.32, 0.58, lp.z) * (1.0 - smoothstep(0.58, 0.78, lp.z)) * smoothstep(0.02, 0.18, lp.y);
      albedo = mix(vec3f(0.04, 0.05, 0.07), vec3f(0.95, 0.96, 0.98), clamp(whiteBelly + eyePatch * 0.85, 0.0, 1.0));
    } else if (sp == 33) {
      let counter = 1.0 - smoothstep(-0.08, 0.08, lp.y);
      albedo = mix(albedo, vec3f(0.92, 0.94, 0.95), counter * 0.88);
    } else if (sp == 34) {
      let chev = smoothstep(0.15, 0.35, cos(lp.z * 6.0 - abs(lp.x) * 4.5)) * smoothstep(0.0, 0.08, lp.y);
      albedo = mix(albedo, vec3f(0.75, 0.82, 0.88), chev * 0.38 + (1.0 - smoothstep(-0.04, 0.04, lp.y)) * 0.85);
    }
  } else if (sp == 35) {
    let belly = (1.0 - smoothstep(-0.06, 0.10, -lp.z)) * (1.0 - smoothstep(0.25, 0.52, lp.y));
    let goldNeck = smoothstep(0.22, 0.42, lp.y) * (1.0 - smoothstep(0.42, 0.58, lp.y)) * smoothstep(-0.05, 0.12, lp.z);
    albedo = mix(albedo, vec3f(0.95, 0.96, 0.98), belly * 0.88);
    albedo = mix(albedo, vec3f(0.98, 0.72, 0.16), goldNeck * 0.85);
    rough = 0.28;
    furSheen = 0.35;
  } else if (sp == 36 || sp == 37) {
    let fur = n2(lp.xz * 85.0 + vec2f(lp.y * 55.0));
    if (sp == 36) {
      albedo = mix(vec3f(0.88, 0.86, 0.80), vec3f(0.98, 0.98, 1.0), fur);
      furSheen = 0.62;
    } else {
      let spots = 1.0 - smoothstep(0.12, 0.24, voronoi(lp.xz * 12.0).x);
      albedo = mix(albedo, vec3f(0.12, 0.14, 0.18), spots * 0.65);
      rough = 0.22;
    }
  } else if (sp == 0) {
    // Abyssal Garden Reef & Pelagic Fish: countershading, tropical bars, iridescent scales & deep photophores
    let counter = 1.0 - smoothstep(-0.06, 0.04, lp.y);
    let band = smoothstep(0.25, 0.65, sin(lp.z * 26.0 + lp.y * 8.0));
    let irid = pow(1.0 - max(dot(n, V), 0.0), 2.2);
    albedo = mix(albedo, vec3f(0.12, 0.58, 0.88), band * 0.48);
    albedo = mix(albedo, vec3f(0.92, 0.95, 0.98), counter * 0.65);
    albedo += vec3f(0.18, 0.72, 0.85) * irid * 0.45;
    if (wp.y < -4.5) {
      let photophore = smoothstep(0.72, 0.92, sin(lp.z * 42.0)) * (1.0 - smoothstep(-0.05, 0.02, lp.y));
      albedo += vec3f(0.15, 0.95, 0.88) * photophore * 1.4;
    }
    rough = 0.14;
  }

  let NdotL = max(dot(n, L), 0.);
  let hemi = mix(vec3f(0.06, 0.09, 0.06), U.skyZenith.rgb * 0.5 + U.skyHorizon.rgb * 0.3, n.y * 0.5 + 0.5);

  let rim = pow(1. - max(dot(n, V), 0.), 3.2) * (0.28 + furSheen * 0.55);
  let specPow = select(mix(18., 72., 1. - rough), 240.0, isEye);
  let specStrength = select(mix(0.08, 0.55, 1. - rough), 2.4, isEye);
  let spec = pow(max(dot(n, H), 0.), specPow) * specStrength;

  var col = albedo * (hemi + U.sunCol.rgb * U.sunDir.w * (NdotL * 0.85 + 0.15)) +
            U.sunCol.rgb * (rim * albedo * 1.15 + spec) * U.sunDir.w;

  if (wp.y < -0.05) {
    let cMarine = caus(wp.xz * 0.11 + vec2f(wp.y * 0.05), U.camPos.w * 0.65);
    col += vec3f(0.25, 0.68, 0.85) * cMarine * max(0.0, n.y + 0.25) * smoothstep(-20.0, -0.1, wp.y) * 0.65;
  }

  let instinct = fract(U.misc.w);
  if (instinct > 0.02) {
    let aura = pow(1.0 - max(dot(n, V), 0.0), 2.0) * (1.0 - instinct);
    let emoCol = select(vec3f(0.22, 0.92, 0.58), vec3f(1.0, 0.28, 0.12), v.emotion >= 2.5);
    col += emoCol * aura * 1.6;
  }

  return vec4f(applyAtmosphere(col, wp), 1.);
}
`;

// ----------------------------------------------------------------------------
// 5. Water Surface Shader (10-Wave Ocean, Shorebreak Surf, Caustics & Snell's Window)
// ----------------------------------------------------------------------------
const W_WATER = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var heightTex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) bedH: f32,
  @location(2) wetness: f32,
};

fn sampleH(xz: vec2f) -> vec4f {
  let dims = vec2i(textureDimensions(heightTex));
  let wxz = wrapXZ(xz);
  let uv = clamp((wxz + vec2f(WORLD_HALF)) / WORLD_SPAN, vec2f(0.), vec2f(1.));
  let tc = clamp(vec2i(uv * vec2f(dims - vec2i(1))), vec2i(0), dims - vec2i(1));
  return textureLoad(heightTex, tc, 0);
}

fn waveH(p: vec2f, t: f32) -> f32 {
  let wp = wrapXZ(p);
  let isOcean = smoothstep(150.0, 210.0, wp.y);
  let ampScale = mix(1.0, 2.6, isOcean);
  let w1 = sin(dot(p, vec2f(0.38, 0.16)) + t * 1.55) * 0.042;
  let w2 = sin(dot(p, vec2f(-0.24, 0.44)) + t * 1.95) * 0.032;
  let w3 = sin(dot(p, vec2f(0.72, -0.58)) + t * 2.65) * 0.018;
  let w4 = (n2(p * 1.35 + vec2f(t * 0.7, -t * 0.55)) - 0.5) * 0.025;
  let shoreBand = smoothstep(168.0, 182.0, wp.y) * (1.0 - smoothstep(184.0, 204.0, wp.y));
  let surfWave = pow(max(0.0, sin(wp.y * 0.45 - t * 2.4 + sin(wp.x * 0.08) * 1.5)), 3.0) * 0.32 * shoreBand;
  return (w1 + w2 + w3 + w4) * ampScale + surfWave;
}

@vertex fn vs(@location(0) grid: vec2f) -> VSOut {
  let snapCamXZ = floor(U.camPos.xz / 24.0) * 24.0;
  let wxz = snapCamXZ + grid * WORLD_HALF;
  let h0 = sampleH(wxz);
  let t = U.camPos.w;
  let dCam = wxz - U.camPos.xz;
  let curveDrop = dot(dCam, dCam) * 0.000018 * (1.0 + clamp(U.camPos.y * 0.003, 0.0, 6.0));
  let wh = U.camUp.w + waveH(wxz, t) - curveDrop;
  let wp = vec3f(wxz.x, wh, wxz.y);
  var o: VSOut;
  o.pos = U.vp * vec4f(wp, 1.);
  o.worldPos = wp;
  o.bedH = h0.x - curveDrop;
  o.wetness = h0.y;
  return o;
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let depth = v.worldPos.y - v.bedH;
  let wp = v.worldPos;
  let rHoriz = length(wp.xz - U.camPos.xz);
  let maxHorizR = 320.0 + clamp(U.camPos.y, 0.0, 260.0) * 1.15;
  if (depth < -0.04 || rHoriz > maxHorizR || U.camPos.y > 390.0) {
    discard;
  }
  let wxz = wrapXZ(wp.xz);
  let altBlur = smoothstep(38.0, 210.0, U.camPos.y);
  let t = U.camPos.w;
  let e = 0.22;
  let hC = waveH(wp.xz, t);
  let hX = waveH(wp.xz + vec2f(e, 0.), t);
  let hZ = waveH(wp.xz + vec2f(0., e), t);
  var n = normalize(vec3f((hC - hX) * (1.0 - altBlur), e * (1.0 - U.misc.y * 0.35), (hC - hZ) * (1.0 - altBlur)));

  if (U.misc.y > 0.05 && altBlur < 0.7) {
    let rCell = floor(wp.xz * 3.5);
    let rLocal = fract(wp.xz * 3.5) - 0.5;
    let rSeed = h21(rCell);
    let rPhase = fract(t * 2.4 + rSeed);
    let rDist = length(rLocal) * 2.0;
    let ring = sin((rDist - rPhase) * 28.0) * smoothstep(0.0, 0.15, rDist) * (1. - smoothstep(0.15, 0.85, rDist)) * (1. - rPhase);
    n = normalize(n + vec3f(rLocal.x * ring, 0., rLocal.y * ring) * U.misc.y * 0.45 * (1.0 - altBlur));
  }

  let V = normalize(U.camPos.xyz - wp);
  let L = U.sunDir.xyz;

  if (U.camPos.y < wp.y - 0.02) {
    let nDown = -n;
    let ci = max(dot(nDown, V), 0.0);
    let k = 1.0 - 1.769 * (1.0 - ci * ci);
    let tir = 1.0 - smoothstep(-0.04, 0.12, k);
    let refrDir = normalize(vec3f(-V.x * 1.33 + n.x * 0.25, sqrt(max(0.01, k)), -V.z * 1.33 + n.z * 0.25));
    let skyAbove = evalSky(refrDir);
    let abyssMirror = mix(vec3f(0.015, 0.11, 0.17), vec3f(0.04, 0.28, 0.36), ci);
    let snellC = caus(wp.xz * 0.12, t * 0.65) * 0.35;
    let uwSurf = mix(skyAbove + vec3f(0.15, 0.45, 0.55) * snellC, abyssMirror, tir * 0.88);
    return vec4f(applyAtmosphere(uwSurf, wp), 0.92);
  }

  let R = reflect(-V, n);
  let NdotV = max(dot(n, V), 0.001);
  let fres = clamp(0.025 + 0.975 * pow(1. - NdotV, 5.), 0., 1.);

  var reflCol = evalSky(vec3f(R.x, max(R.y, 0.03), R.z));
  let canopyShadow = smoothstep(0.35, 0.72, fbm(wxz * 0.08 + R.xz * 1.8));
  let canopyGreen = vec3f(0.04, 0.12, 0.05) * max(0.25, U.sunDir.w);
  let isOcean = smoothstep(155.0, 195.0, wxz.y);
  reflCol = mix(reflCol, canopyGreen, canopyShadow * (1. - smoothstep(0.15, 0.55, R.y)) * 0.58 * (1.0 - isOcean));

  let shallowCol = mix(vec3f(0.09, 0.28, 0.20), vec3f(0.08, 0.58, 0.64), isOcean);
  let deepCol    = mix(vec3f(0.015, 0.065, 0.055), vec3f(0.012, 0.11, 0.22), isOcean);
  let absorb = 1. - exp(-max(depth, 0.) * mix(0.85, 0.22, isOcean));
  var waterBody = mix(shallowCol, deepCol, absorb) * max(0.22, U.sunDir.w);

  if (altBlur < 0.85) {
    let cUv = wxz * 0.12 + n.xz * 0.35;
    let cR = caus(cUv + vec2f(0.005, 0.0), t * 0.65);
    let cG = caus(cUv, t * 0.65);
    let cB = caus(cUv - vec2f(0.005, 0.0), t * 0.65);
    let causticVis = (1. - absorb) * smoothstep(0.02, 0.25, depth);
    waterBody += vec3f(cR * 0.85, cG * 1.05, cB * 1.25) * U.sunCol.rgb * causticVis * 0.42 * U.sunDir.w * (1.0 - altBlur);
  }

  let swampWeight = smoothstep(15., 55., -abs(wxz.x + 95.) + 70.) * (1.0 - isOcean);
  let duckweed = smoothstep(0.56, 0.72, fbm(wxz * 0.9 + vec2f(t * 0.02))) * swampWeight * smoothstep(0.05, 0.6, depth);
  waterBody = mix(waterBody, vec3f(0.16, 0.34, 0.10) * max(0.3, U.sunDir.w), duckweed * 0.72);

  let H = normalize(V + L);
  let spec = pow(max(dot(n, H), 0.), 320.) * 3.8 * U.sunDir.w * (1.0 - altBlur * 0.75);

  let shoreFoam = (1. - smoothstep(0.0, 0.28, depth)) * smoothstep(0.52, 0.72, n2(wxz * 3.2 - vec2f(t * 0.8, 0.)));
  let surfCrest = smoothstep(168.0, 184.0, wxz.y) * (1.0 - smoothstep(186.0, 206.0, wxz.y)) *
                  smoothstep(0.12, 0.28, hC) * (0.65 + 0.35 * fbm(wxz * 2.4 + vec2f(0.0, t * 1.5)));
  let totalFoam = clamp(shoreFoam + surfCrest, 0.0, 1.0) * (1.0 - altBlur * 0.8);

  var col = mix(waterBody, reflCol, fres * (1. - duckweed * 0.65)) + U.sunCol.rgb * spec;
  col = mix(col, vec3f(0.92, 0.95, 0.97) * max(0.35, U.sunDir.w), totalFoam * 0.78);

  let df = length(wxz - U.firePos.xz);
  if (df < 120.) {
    let fDir = normalize(vec3f(U.firePos.x - wxz.x, 9., U.firePos.z - wxz.y));
    let fSpec = pow(max(dot(R, fDir), 0.), 24.) * (1. - df / 120.) * U.fogCol.w;
    col += vec3f(2.2, 0.65, 0.12) * fSpec;
  }

  let circleEdge = smoothstep(maxHorizR * 0.58, maxHorizR * 0.96, rHoriz);
  let orbitHandoff = smoothstep(155.0, 365.0, U.camPos.y);
  let fadeOut = 1.0 - clamp(max(circleEdge, orbitHandoff), 0.0, 1.0);
  let alpha = clamp(smoothstep(0., 0.16, depth) * 0.92 + fres * 0.25 + duckweed * 0.5 + totalFoam * 0.6, 0., 0.98) * fadeOut;
  return vec4f(applyAtmosphere(col, wp), alpha);
}
`;

// ----------------------------------------------------------------------------
// 6. GPU Billboard Particles (Fire, Smoke, Fireflies, Rain, Marine Snow, Bubbles)
// ----------------------------------------------------------------------------
const W_PARTICLE = W_COMMON + /*wgsl*/`
struct VSIn {
  @location(0) quad: vec2f,
  @location(1) pPosSize: vec4f, // xyz = pos, w = size
  @location(2) pColKind: vec4f, // rgb = color, w = kind (0=flame, 1=smoke, 2=ember/firefly, 3=leaf, 4=rain, 5=pollen/marineSnow, 6=bubble)
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) kind: f32,
  @location(3) worldPos: vec3f,
};

@vertex fn vs(inp: VSIn) -> VSOut {
  let k = inp.pColKind.w;
  let sz = inp.pPosSize.w;
  var right = U.camRight.xyz * sz;
  var up = U.camUp.xyz * sz;
  if (abs(k - 4.) < 0.2) {
    right = U.camRight.xyz * (sz * 0.09);
    up = normalize(vec3f(U.wind.x * 0.18, 1.0, U.wind.y * 0.18)) * (sz * 4.8);
  }
  let wp = inp.pPosSize.xyz + right * inp.quad.x + up * inp.quad.y;
  var o: VSOut;
  o.pos = U.vp * vec4f(wp, 1.);
  o.uv = inp.quad;
  o.col = inp.pColKind.rgb;
  o.kind = k;
  o.worldPos = wp;
  return o;
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  if (r2 > 1.) {
    discard;
  }
  let soft = pow(1. - r2, 1.6);
  let k = v.kind;
  if (k < 0.5) {
    let c = mix(vec3f(1.2, 0.25, 0.03), vec3f(2.6, 1.45, 0.35), 1. - r2);
    return vec4f(c * soft, soft * 0.85);
  } else if (k < 1.5) {
    let col = applyAtmosphere(vec3f(0.14, 0.12, 0.11) + v.col * 0.22, v.worldPos);
    return vec4f(col, soft * 0.42);
  } else if (k < 2.5) {
    return vec4f(v.col * (2.6 * soft), soft);
  } else if (k > 3.5 && k < 4.5) {
    let core = exp(-abs(v.uv.x) * 4.5) * (1. - abs(v.uv.y));
    let alpha = clamp(core * 0.28 * U.misc.y, 0., 0.35);
    return vec4f(v.col * max(0.35, U.sunDir.w), alpha);
  } else if (k > 5.5) {
    let rad = sqrt(r2);
    let rim = smoothstep(0.45, 0.92, rad) * (1. - smoothstep(0.92, 1.0, rad));
    let specDot = 1. - smoothstep(0.0, 0.32, length(v.uv - vec2f(-0.32, 0.35)));
    let bCol = mix(vec3f(0.25, 0.72, 0.85), vec3f(0.95, 0.99, 1.0), specDot + rim * 0.55);
    return vec4f(bCol, clamp(rim * 0.65 + specDot * 0.8, 0., 0.85));
  } else {
    let col = applyAtmosphere(v.col * max(0.35, U.sunDir.w), v.worldPos);
    return vec4f(col, soft * 0.72);
  }
}
`;

// ----------------------------------------------------------------------------
// 7. Half-Resolution Crepuscular God-Ray & Underwater Volumetric Shaft Pass
// ----------------------------------------------------------------------------
const W_RAYS_BODY = /*wgsl*/`
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0., 1.);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let sunClip = U.vp * vec4f(U.camPos.xyz + U.sunDir.xyz * 500., 1.);
  if (sunClip.w <= 0.) {
    return vec4f(0.);
  }
  let sunUv = vec2f(sunClip.x / sunClip.w * 0.5 + 0.5, 0.5 - sunClip.y / sunClip.w * 0.5);
  let delta = (sunUv - v.uv) / 20. * 0.82;
  var tc = v.uv;
  var acc = 0.;
  var w = 1.;
  let dims = vec2f(textureDimensions(depthTex));
  for (var i = 0; i < 20; i++) {
    tc += delta;
    if (tc.x >= 0. && tc.x <= 1. && tc.y >= 0. && tc.y <= 1.) {
      let px = clamp(vec2i(tc * dims), vec2i(0), vec2i(dims) - vec2i(1));
      let d = textureLoad(depthTex, px, 0);
      if (d > 0.9992) {
        acc += w;
      }
    }
    w *= 0.92;
  }
  let sunFacing = pow(max(dot(U.camFwd.xyz, U.sunDir.xyz), 0.), 2.);
  let rayCol = select(U.sunCol.rgb, vec3f(0.12, 0.62, 0.78), U.camPos.y < -0.05);
  let rayAmt = (acc / 20.) * sunFacing * U.sunDir.w * 0.42;
  return vec4f(rayCol * rayAmt, 1.);
}
`;
const W_RAYS = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var depthTex: texture_depth_2d;
` + W_RAYS_BODY;
const W_RAYS_MS = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var depthTex: texture_depth_multisampled_2d;
` + W_RAYS_BODY;

// ----------------------------------------------------------------------------
// 8. Final Composite Pass (AgX/ACES Tone Map, Optical Vignette, Underwater & DoF)
// ----------------------------------------------------------------------------
const W_POST_BODY = /*wgsl*/`
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0., 1.);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

fn filmicTone(x: vec3f) -> vec3f {
  let a = x * (x + 0.0245786) - 0.000090537;
  let b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return clamp(a / b, vec3f(0.), vec3f(1.));
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let isLookdev = U.misc.w >= 10.0;
  let dofStrength = U.misc.z;
  let isPhoto = dofStrength > 0.001 && !isLookdev;
  let isUnderwater = U.camPos.y < -0.02 && !isLookdev;
  let hasDroplets = (U.misc.y > 0.25 || (U.camPos.y >= -0.02 && U.camPos.y < 0.65)) && !isLookdev;

  var uv = v.uv;
  let centered = uv - 0.5;
  let r2 = dot(centered, centered);

  if (!isLookdev) {
    uv = 0.5 + centered * (1. - 0.028 * r2);
  }

  if (isUnderwater) {
    uv.x += sin(uv.y * 18. + U.camPos.w * 2.4) * 0.003;
    uv.y += cos(uv.x * 16. + U.camPos.w * 2.1) * 0.0022;
  } else if (length(U.camPos.xz - U.firePos.xz) < 85.) {
    let shimmer = (n2(uv * 22. + vec2f(0., -U.camPos.w * 3.8)) - 0.5) * 0.0025 * (1. - smoothstep(15., 85., length(U.camPos.xz - U.firePos.xz)));
    uv.x += shimmer;
  }

  if (hasDroplets) {
    let cell = floor(uv * vec2f(9., 6.));
    let f = fract(uv * vec2f(9., 6.)) - 0.5;
    let rnd = h22(cell);
    let dropRad = 0.12 + 0.16 * rnd.x;
    let dOff = f - (rnd - 0.5) * 0.4;
    let dl = length(dOff);
    if (dl < dropRad && rnd.y > 0.45) {
      uv -= dOff * (1. - dl / dropRad) * 0.18;
    }
  }
  uv = clamp(uv, vec2f(0.001), vec2f(0.999));

  let ca = select(0.0032, 0.0, isLookdev) * r2;
  let uvR = clamp(uv - centered * ca, vec2f(0.001), vec2f(0.999));
  let uvB = clamp(uv + centered * ca, vec2f(0.001), vec2f(0.999));

  var hdr = vec3f(
    textureSampleLevel(hdrTex, postSmp, uvR, 0.).r,
    textureSampleLevel(hdrTex, postSmp, uv, 0.).g,
    textureSampleLevel(hdrTex, postSmp, uvB, 0.).b
  );

  let dSz = vec2i(textureDimensions(depthTex));
  let dPx = clamp(vec2i(uv * vec2f(dSz)), vec2i(0), dSz - vec2i(1));
  let dz = textureLoad(depthTex, dPx, 0);
  if (isPhoto) {
    let ndc = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
    let wp4 = U.invVp * vec4f(ndc, dz, 1.);
    let sceneD = length((wp4.xyz / wp4.w) - U.camPos.xyz);
    let focusDist = max(1.0, U.firePos.w);
    let coc = clamp(abs(sceneD - focusDist) / focusDist * dofStrength, 0., 1.) * 0.012;
    if (coc > 0.0008) {
      var acc = hdr;
      for (var k = 0; k < 6; k++) {
        let ang = f32(k) * 1.0472 + 0.3;
        let off = vec2f(cos(ang), sin(ang)) * coc;
        acc += textureSampleLevel(hdrTex, postSmp, clamp(uv + off, vec2f(0.001), vec2f(0.999)), 0.).rgb;
      }
      hdr = acc / 7.;
    }
  }

  let ts = 1.6 / vec2f(textureDimensions(rayTex));
  let rays = (
    textureSampleLevel(rayTex, postSmp, uv, 0.).rgb * 2. +
    textureSampleLevel(rayTex, postSmp, uv + vec2f(-ts.x, 0.), 0.).rgb +
    textureSampleLevel(rayTex, postSmp, uv + vec2f( ts.x, 0.), 0.).rgb +
    textureSampleLevel(rayTex, postSmp, uv + vec2f(0., -ts.y), 0.).rgb +
    textureSampleLevel(rayTex, postSmp, uv + vec2f(0.,  ts.y), 0.).rgb
  ) / 6.;

  let hts = 3.5 / vec2f(textureDimensions(hdrTex));
  let b0 = textureSampleLevel(hdrTex, postSmp, clamp(uv + vec2f(-hts.x, -hts.y), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let b1 = textureSampleLevel(hdrTex, postSmp, clamp(uv + vec2f( hts.x, -hts.y), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let b2 = textureSampleLevel(hdrTex, postSmp, clamp(uv + vec2f(-hts.x,  hts.y), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let b3 = textureSampleLevel(hdrTex, postSmp, clamp(uv + vec2f( hts.x,  hts.y), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let bloom = max(vec3f(0.), (b0 + b1 + b2 + b3) * 0.25 - vec3f(0.95)) * 0.22;

  let cUp = textureSampleLevel(hdrTex, postSmp, clamp(uv + vec2f(0., 1. / f32(dSz.y)), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let cDn = textureSampleLevel(hdrTex, postSmp, clamp(uv - vec2f(0., 1. / f32(dSz.y)), vec2f(0.001), vec2f(0.999)), 0.).rgb;
  let cas = hdr + (hdr - (cUp + cDn) * 0.5) * 0.16;

  let exposureScale = max(0.25, U.wind.w);
  var col = (cas + rays * 0.78 + bloom) * exposureScale;
  if (!isLookdev) {
    col *= 1. - r2 * 0.32;
  }
  col = filmicTone(col);

  let n = h21(v.pos.xy + fract(U.camPos.w * 13.7)) - 0.5;
  let grain = select(0.012, 0.0, isLookdev) * (1. - dot(col, vec3f(0.3, 0.5, 0.2)) * 0.5);
  col = pow(max(vec3f(0.), col), vec3f(1. / 2.2)) + n * grain + n / 255.;
  return vec4f(clamp(col, vec3f(0.), vec3f(1.)), 1.);
}
`;
const W_POST = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var hdrTex: texture_2d<f32>;
@group(1) @binding(1) var rayTex: texture_2d<f32>;
@group(1) @binding(2) var postSmp: sampler;
@group(1) @binding(3) var depthTex: texture_depth_2d;
` + W_POST_BODY;
const W_POST_MS = W_COMMON + /*wgsl*/`
@group(1) @binding(0) var hdrTex: texture_2d<f32>;
@group(1) @binding(1) var rayTex: texture_2d<f32>;
@group(1) @binding(2) var postSmp: sampler;
@group(1) @binding(3) var depthTex: texture_depth_multisampled_2d;
` + W_POST_BODY;

export { W_COMMON, W_SKY, W_TERRAIN, W_VEG, W_ANIMAL, W_WATER, W_PARTICLE, W_RAYS, W_RAYS_MS, W_POST, W_POST_MS };
