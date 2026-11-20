// ============================================================================
// WGSL Shaders — REALISM (WGS-84 Cube-Sphere Planet, Noniv/abyssal-garden
// Deep Ocean, Real-Meter Atmosphere & Re-Entry, Articulated IK Wildlife)
// ============================================================================

const W_COMMON = /*wgsl*/`
// Exactly 96 floats (384 bytes): 3 * mat4x4f (48) + 12 * vec4f (48) = 96 floats
struct FrameU {
  vp: mat4x4f,
  invVp: mat4x4f,
  sunVp: mat4x4f,
  camPos: vec4f,      // 48..51: xyz = camera regional offset [localX, altMeters, localZ], w = time
  camFwd: vec4f,      // 52..55: xyz = forward (ENU), w = tanHalfFov
  camRight: vec4f,    // 56..59: xyz = right (ENU), w = aspect
  camUp: vec4f,       // 60..63: xyz = up (ENU), w = waterLevel (0.0)
  sunDir: vec4f,      // 64..67: xyz = sunDir (ENU), w = sunIntensity
  sunCol: vec4f,      // 68..71: rgb = sunColor, w = fogDensity
  skyZenith: vec4f,   // 72..75: rgb = zenith, w = cloudCover
  skyHorizon: vec4f,  // 76..79: rgb = horizon, w = mistStrength
  fogCol: vec4f,      // 80..83: rgb = fogColor, w = fireStrength
  firePos: vec4f,     // 84..87: xyz = fireCenter (regional), w = focusDistM
  wind: vec4f,        // 88..91: xy = windDir, z = windSpeed, w = exposureScale
  misc: vec4f,        // 92..95: x = weatherMode(0..7), y = rainIntensity, z = dofStrength, w = instinctPulse (+10 if lookdev)
};

// 16 floats (64 bytes): Earth-scale geodetic ENU frame & atmospheric state
struct PlanetU {
  enuEast: vec4f,     // xyz = ECEF East unit vector, w = camAltMeters
  enuUp: vec4f,       // xyz = ECEF Up unit vector, w = planetRadiusMeters (~6,371,000)
  enuSouth: vec4f,    // xyz = ECEF South unit vector, w = reentryHeat (0..1)
  geo: vec4f,         // x = camLatRad, y = camLonRad, z = atmoDensity (0..1), w = activeBiomeId
};

// 112 floats (448 bytes): Real physical-scale heliocentric Solar System ephemeris projected to ENU
struct SolarU {
  bodyDirAng: array<vec4f, 9>, // xyz = unit dir in camera ENU, w = angular radius (rad)
  bodyInfo: array<vec4f, 9>,   // x = bodyIdx (0..8), y = visualMag, z = ringOuterScale, w = axialTiltRad
  bodyTint: array<vec4f, 9>,   // rgb = base albedo/emission, w = atmoWeight
  helios: vec4f,               // xyz = true sun dir ENU, w = interplanetaryBlend (0=Earth-locked, 1=interplanetary)
};

@group(0) @binding(0) var<uniform> U: FrameU;
@group(0) @binding(1) var<uniform> P: PlanetU;
@group(0) @binding(2) var<uniform> S: SolarU;

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

// Soft, organic blended Aurora Borealis / Australis (emerald, teal & twilight violet glow)
// Strictly rendered ONLY under the atmosphere at night/twilight — never in deep space
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

// Physically-Driven Real-Scale Solar System Bodies (Sun + 8 Planets via SolarU Ephemeris)
// Renders distant planets as crisp astronomical points and approached planets as full 3D phase-lit spheres + rings
fn evalSolarSystem(dir: vec3f, t: f32, bodyVis: f32) -> vec3f {
  if (bodyVis <= 0.005) { return vec3f(0.0); }
  var accum = vec3f(0.0);
  let sunLen = length(S.helios.xyz);
  let sunL = select(normalize(U.sunDir.xyz), S.helios.xyz / max(1e-5, sunLen), sunLen > 0.1);
  let interplanetary = S.helios.w;

  for (var idx: u32 = 0u; idx < 9u; idx = idx + 1u) {
    let bData = S.bodyDirAng[idx];
    let bDirLen = length(bData.xyz);
    if (bDirLen < 0.1) { continue; }
    let bDir = bData.xyz / bDirLen;
    let angRad = bData.w;
    let bInfo = S.bodyInfo[idx];
    let bTint = S.bodyTint[idx].rgb;
    let atmoW = S.bodyTint[idx].w;
    let ringScale = bInfo.z;
    let tiltRad = bInfo.w;

    // When Earth-bound (interplanetary < 0.05), the real Cube-Sphere Quadtree renders Earth directly
    if (idx == 3u && interplanetary < 0.05) { continue; }

    let bDot = dot(dir, bDir);
    if (bDot < 0.0) { continue; }

    // Perpendicular angular offset in tangent plane
    let perpVec = dir - bDir * bDot;
    let sep = length(perpVec);

    // 0: THE SUN (True angular photosphere disc + natural tapered corona in space/interplanetary flight)
    if (idx == 0u) {
      let sunSpaceGate = clamp(interplanetary + smoothstep(32000.0, 95000.0, P.enuEast.w), 0.0, 1.0);
      if (sunSpaceGate > 0.01 && sep < max(angRad * 9.0, 0.12)) {
        let rN = sep / max(angRad, 0.0042);
        let disc = 1.0 - smoothstep(0.92, 1.06, rN);
        let limbDark = mix(0.62, 1.0, sqrt(clamp(1.0 - rN * rN, 0.0, 1.0)));
        let corona = exp(-max(0.0, rN - 0.95) * 3.4) * 1.15 + exp(-max(0.0, rN - 0.95) * 0.9) * 0.18;
        let sunC = vec3f(1.0, 0.96, 0.86) * disc * limbDark * 12.0 + vec3f(1.0, 0.82, 0.56) * corona * 1.4;
        accum += sunC * sunSpaceGate;
      }
      continue;
    }

    // Distant planetary point beacon when angular radius is sub-pixel (< 0.0028 rad)
    let boundAng = max(angRad * max(1.35, ringScale + 0.25), 0.012);
    if (sep > boundAng) { continue; }

    if (angRad < 0.0028) {
      let ptVis = clamp(1.0 - smoothstep(0.0005, 0.0036, sep), 0.0, 1.0);
      let magBoost = clamp((3.2 - bInfo.y) * 0.24, 0.16, 1.35);
      let corePt = exp(-sep * sep / (0.0000018)) * magBoost;
      let haloPt = ptVis * 0.14 * magBoost;
      accum += bTint * (corePt * 1.85 + haloPt) * bodyVis;
      continue;
    }

    // Close / Approached 3D Phase-Lit Planet + Physical Ring System
    let refAxis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(bDir.y) > 0.94);
    let bRight0 = normalize(cross(bDir, refAxis));
    let bUp0 = normalize(cross(bRight0, bDir));
    let ct = cos(tiltRad);
    let st = sin(tiltRad);
    let bRight = bRight0 * ct + bUp0 * st;
    let bUp = -bRight0 * st + bUp0 * ct;

    let px = dot(perpVec, bRight);
    let py = dot(perpVec, bUp);
    let sRad = min(angRad, 0.72);
    let r2 = px * px + py * py;

    // Optional physical planetary ring intersection (Saturn & Uranus)
    var ringCol = vec3f(0.0);
    var ringAlpha = 0.0;
    var ringBehind = false;
    if (ringScale > 1.05) {
      let ringNorm = normalize(bUp * 0.86 - bDir * 0.50);
      let denom = dot(dir, ringNorm);
      if (abs(denom) > 0.008) {
        let tRing = dot(bDir, ringNorm) / denom;
        let rHit = dir * tRing - bDir;
        let rDist = length(rHit);
        let rInner = sRad * 1.24;
        let rOuter = sRad * ringScale;
        if (rDist > rInner && rDist < rOuter) {
          let rU = clamp((rDist - rInner) / max(1e-5, rOuter - rInner), 0.0, 1.0);
          let cassini = select(1.0, smoothstep(0.025, 0.075, abs(rU - 0.62)), idx == 6u);
          let bands = 0.62 + 0.38 * sin(rU * 52.0) * cos(rU * 19.0);
          let edgeFade = smoothstep(0.0, 0.06, rU) * (1.0 - smoothstep(0.92, 1.0, rU));
          let ringOpacity = select(0.28, 0.84, idx == 6u);
          ringAlpha = cassini * bands * edgeFade * ringOpacity;
          let ringSun = max(0.18, abs(dot(ringNorm, sunL)) * 0.55 + 0.45);
          ringCol = mix(bTint * 0.78, vec3f(0.92, 0.85, 0.72), bands * 0.5) * ringSun;
          ringBehind = tRing > 1.0;
        }
      }
    }

    if (r2 < sRad * sRad) {
      let pz = sqrt(max(0.0, sRad * sRad - r2));
      let pNorm = normalize(bRight * px + bUp * py - bDir * pz);
      let lonAng = atan2(px, pz) + t * 0.012;
      let latV = clamp(py / max(1e-5, sRad), -1.0, 1.0);
      var pAlb = bTint;

      if (idx == 1u) { // Mercury: silicate craters
        let cr = voronoi(vec2f(lonAng * 4.5, latV * 4.5)).x;
        let mr = fbm(vec2f(lonAng * 2.4, latV * 2.4));
        pAlb = mix(vec3f(0.36, 0.35, 0.34), vec3f(0.64, 0.61, 0.58), smoothstep(0.25, 0.75, mr) + smoothstep(0.12, 0.28, cr) * 0.22);
      } else if (idx == 2u) { // Venus: dense cream-gold sulfuric cloud bands
        let vCloud = fbm(vec2f(lonAng * 2.2 + t * 0.02, latV * 6.5));
        pAlb = mix(vec3f(0.76, 0.64, 0.40), vec3f(0.96, 0.88, 0.68), smoothstep(0.32, 0.74, vCloud));
      } else if (idx == 3u) { // Distant Earth marble (only in far interplanetary flight)
        let cont = fbm(vec2f(lonAng * 2.2, latV * 2.8));
        let clouds = fbm(vec2f(lonAng * 3.8 + t * 0.015, latV * 4.2));
        let landCol = mix(vec3f(0.14, 0.36, 0.16), vec3f(0.62, 0.50, 0.30), smoothstep(0.54, 0.76, cont));
        let seaCol = vec3f(0.05, 0.22, 0.48);
        pAlb = mix(seaCol, landCol, smoothstep(0.49, 0.56, cont));
        pAlb = mix(pAlb, vec3f(0.92, 0.94, 0.96), smoothstep(0.76, 0.92, abs(latV)));
        pAlb = mix(pAlb, vec3f(0.94, 0.96, 0.98), smoothstep(0.55, 0.78, clouds) * 0.65);
      } else if (idx == 4u) { // Mars: iron-oxide plains, dark basalt maria & polar ice caps
        let mN = fbm(vec2f(lonAng * 2.6, latV * 3.8));
        pAlb = mix(vec3f(0.78, 0.34, 0.18), vec3f(0.42, 0.18, 0.11), smoothstep(0.44, 0.72, mN));
        pAlb = mix(pAlb, vec3f(0.94, 0.95, 0.97), smoothstep(0.80, 0.93, abs(latV)));
      } else if (idx == 5u) { // Jupiter: turbulent equatorial belts & Great Red Spot
        let turb = fbm(vec2f(lonAng * 3.5, latV * 11.0));
        let band = sin(latV * 24.0 + turb * 2.4) * 0.5 + 0.5;
        pAlb = mix(vec3f(0.58, 0.38, 0.24), vec3f(0.90, 0.82, 0.68), band);
        let spotD = length(vec2f((lonAng - 0.6) * 0.8, (latV + 0.32) * 2.4));
        pAlb = mix(pAlb, vec3f(0.80, 0.30, 0.18), 1.0 - smoothstep(0.14, 0.28, spotD));
      } else if (idx == 6u) { // Saturn: pale golden banded atmosphere
        let sTurb = fbm(vec2f(lonAng * 2.4, latV * 10.0));
        let sBand = sin(latV * 22.0 + sTurb * 1.4) * 0.5 + 0.5;
        pAlb = mix(vec3f(0.72, 0.60, 0.40), vec3f(0.94, 0.86, 0.66), sBand);
      } else if (idx == 7u) { // Uranus: serene cyan-aquamarine ice giant
        let uBand = sin(latV * 12.0) * 0.5 + 0.5;
        pAlb = mix(vec3f(0.54, 0.78, 0.84), vec3f(0.68, 0.88, 0.92), uBand * 0.45);
      } else { // Neptune: deep cobalt with high-altitude methane streaks
        let nCloud = fbm(vec2f(lonAng * 4.0, latV * 9.0));
        pAlb = mix(vec3f(0.14, 0.30, 0.72), vec3f(0.32, 0.54, 0.92), smoothstep(0.45, 0.80, nCloud));
        pAlb = mix(pAlb, vec3f(0.82, 0.90, 0.98), smoothstep(0.72, 0.88, nCloud) * 0.45);
      }

      let pLit = smoothstep(-0.14, 0.22, dot(pNorm, sunL)) * max(0.03, dot(pNorm, sunL)) + 0.015;
      let rimF = pow(1.0 - clamp(dot(pNorm, -dir), 0.0, 1.0), 3.6) * atmoW * max(0.12, dot(pNorm, sunL) + 0.25);
      let rimTint = mix(bTint, vec3f(0.45, 0.76, 1.0), 0.55);
      var pCol = pAlb * pLit + rimTint * rimF * 0.75;
      if (!ringBehind && ringAlpha > 0.01) {
        pCol = mix(pCol, ringCol, ringAlpha);
      }
      accum = mix(accum, pCol, bodyVis);
    } else if (ringAlpha > 0.01) {
      accum += ringCol * ringAlpha * bodyVis;
    }
  }

  return accum;
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
  let camAlt = P.enuEast.w;

  // Underwater Snell's Window (1.769 exact refractive ratio) when camera is submerged
  if (camAlt < -0.08) {
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

  let atmoDensity = clamp(P.geo.z, 0.0, 1.0);
  let spaceFactor = clamp(1.0 - atmoDensity, 0.0, 1.0);
  let interplanetary = S.helios.w;

  // Smooth multi-layer atmospheric scattering transition:
  // Troposphere (0-12km) -> Stratosphere (12-50km) -> Mesosphere (50-85km) -> Thermosphere -> Space
  let stratoShift = smoothstep(8500.0, 48000.0, camAlt);
  let mesoShift = smoothstep(42000.0, 92000.0, camAlt);
  let y = clamp(dir.y, 0.0, 1.0);
  let horizTight = mix(0.48, 0.22, stratoShift);
  var baseHoriz = mix(U.skyHorizon.rgb, vec3f(0.24, 0.54, 0.90), stratoShift * 0.78);
  baseHoriz = mix(baseHoriz, vec3f(0.06, 0.18, 0.42), mesoShift * 0.82);
  var baseZen = mix(U.skyZenith.rgb, vec3f(0.015, 0.055, 0.17), stratoShift * 0.88);
  baseZen = mix(baseZen, vec3f(0.002, 0.004, 0.012), mesoShift * 0.95);
  let skyAtten = atmoDensity * (1.0 - interplanetary);
  var col = mix(baseHoriz, baseZen, pow(y, horizTight)) * skyAtten;

  // Atmospheric Sun Disc & Mie Scattering (handed smoothly over to real solar photosphere in space)
  let sd = max(dot(dir, U.sunDir.xyz), 0.0);
  let atmoSunGate = clamp(1.0 - interplanetary - smoothstep(48000.0, 105000.0, camAlt) * 0.85, 0.0, 1.0);
  let mie = pow(sd, 10.0) * 0.34 * skyAtten + pow(sd, 64.0) * 1.05 * atmoSunGate + smoothstep(0.9982, 0.9997, sd) * 8.5 * atmoSunGate;
  col += U.sunCol.rgb * mie * max(U.sunDir.w, 0.05);

  // Coherent Tropospheric Cumulus (2.2 km) & Cirrus (9.5 km) Cloud Decks with smooth high-altitude fade
  if (skyAtten > 0.025 && camAlt < 48000.0) {
    let lonDeg = P.geo.y * 57.29578;
    let latDeg = P.geo.x * 57.29578;
    let dCumulus = 2200.0 - camAlt;
    if ((dCumulus > 0.0 && dir.y > 0.015) || (dCumulus < 0.0 && dir.y < -0.015 && camAlt < 34000.0)) {
      let tCloud = clamp(abs(dCumulus) / max(0.05, abs(dir.y)), 0.0, 95000.0);
      let cPos = vec2f(lonDeg * 18.0, latDeg * 18.0) + dir.xz * (tCloud * 0.00055) + U.wind.xy * (t * 0.032);
      let c1 = fbm(cPos * 0.62);
      let c2 = fbm(cPos * 1.75 - vec2f(t * 0.015, 0.0));
      let cMask = smoothstep(0.46 - U.skyZenith.w * 0.14, 0.78, c1 * 0.68 + c2 * 0.32) *
                  smoothstep(0.015, 0.16, abs(dir.y)) *
                  (1.0 - smoothstep(16000.0, 34000.0, camAlt));
      let topSun = select(0.55, 0.95, dCumulus < 0.0);
      let cLit = mix(vec3f(0.24, 0.30, 0.38), U.sunCol.rgb * 1.12 + vec3f(0.34, 0.36, 0.40) * topSun, pow(sd, 3.0) * 0.45 + 0.45 * U.sunDir.w);
      col = mix(col, cLit, cMask * 0.74 * skyAtten);
    }

    let dCirrus = 9500.0 - camAlt;
    if ((dCirrus > 0.0 && dir.y > 0.015) || (dCirrus < 0.0 && dir.y < -0.015 && camAlt < 46000.0)) {
      let tCir = clamp(abs(dCirrus) / max(0.05, abs(dir.y)), 0.0, 140000.0);
      let cirPos = vec2f(lonDeg * 11.0, latDeg * 11.0) + dir.xz * (tCir * 0.00035) - U.wind.xy * (t * 0.025);
      let warp = fbm(cirPos * 0.5);
      let streak = fbm(vec2f(cirPos.x * 1.2 + warp * 2.0, cirPos.y * 0.38));
      let cirMask = smoothstep(0.54, 0.82, streak) * smoothstep(0.015, 0.14, abs(dir.y)) * (1.0 - smoothstep(22000.0, 46000.0, camAlt));
      let cirCol = mix(vec3f(0.64, 0.78, 0.94), U.sunCol.rgb * 1.18 + vec3f(0.42), 0.62 * U.sunDir.w);
      col = mix(col, cirCol, cirMask * 0.44 * skyAtten);
    }

    // Gentle cloud-deck mist when passing directly through 2.2 km or 9.5 km
    let inCumulus = 1.0 - smoothstep(0.0, 520.0, abs(camAlt - 2200.0));
    let inCirrus  = (1.0 - smoothstep(0.0, 720.0, abs(camAlt - 9500.0))) * 0.38;
    let inCloudMist = clamp(inCumulus * 0.52 + inCirrus * 0.28, 0.0, 0.68);
    if (inCloudMist > 0.01) {
      let cloudVapor = mix(vec3f(0.76, 0.84, 0.94), U.sunCol.rgb * 0.58 + vec3f(0.48, 0.54, 0.62), U.sunDir.w * 0.65);
      col = mix(col, cloudVapor, inCloudMist);
    }
  }

  // Restrained, Realistic Sparse Starfield + Daylight/Solar Glare Adaptation + Real Solar System
  let trueNightFactor = 1.0 - smoothstep(0.14, 0.52, U.sunDir.w);
  let sunGlare = smoothstep(0.84, 0.992, sd);
  // In sunlit low-Earth orbit, bright Earth/sun glare naturally reduces faint star visibility
  let orbitDayDim = mix(1.0, 0.28, smoothstep(0.25, 0.85, U.sunDir.w) * (1.0 - interplanetary) * (1.0 - smoothstep(350000.0, 4500000.0, camAlt)));
  let eyeDarkAdapt = clamp(max(trueNightFactor, spaceFactor * orbitDayDim) * (1.0 - sunGlare * 0.88), 0.0, 1.0);
  let cosmosVis = clamp(max(trueNightFactor, spaceFactor), 0.0, 1.0);

  let weatherIdx = round(U.misc.x);
  let polarProx = smoothstep(0.72, 1.18, abs(P.geo.x));
  let underAtmoMask = (1.0 - smoothstep(65000.0, 145000.0, camAlt)) * (1.0 - interplanetary);
  let auroraNightGate = clamp(trueNightFactor * 0.92 + select(0.0, 0.95, abs(weatherIdx - 6.0) < 0.4), 0.0, 1.0);
  let auroraWeight = underAtmoMask * auroraNightGate * clamp(0.32 + polarProx * 0.78, 0.0, 1.0);

  if (cosmosVis > 0.02 && (dir.y > -0.05 || spaceFactor > 0.12 || interplanetary > 0.01)) {
    let starAz = atan2(dir.x, dir.z);
    let starEl = asin(clamp(dir.y, -0.999, 0.999));
    let sProj = vec2f(starAz * 3.0, starEl * 6.0);
    let horizonMask = select(smoothstep(0.03, 0.28, dir.y), 1.0, spaceFactor > 0.22 || interplanetary > 0.05);

    // Primary bright stars (sparse, sub-pixel pinpoint core, realistic spectral temperature)
    let pGrid = sProj * 140.0;
    let pCell = floor(pGrid);
    let pFrac = fract(pGrid) - 0.5;
    let starH = h21(pCell);
    if (starH > 0.9964) {
      let jOff = (h22(pCell + vec2f(7.1, 3.3)) - 0.5) * 0.58;
      let dStar = length(pFrac - jOff);
      let pinCore = exp(-dStar * dStar * 42.0);
      // Atmospheric scintillation only when looking through real air; steady in vacuum
      let scint = 1.0 - atmoDensity * 0.24 * (0.5 + 0.5 * sin(t * 4.1 + starH * 90.0));
      let magPow = pow((starH - 0.9964) / 0.0036, 1.85);
      let tempT = fract(starH * 53.7);
      let starTint = mix(vec3f(0.76, 0.86, 1.0), vec3f(1.0, 0.87, 0.72), tempT);
      col += starTint * (0.28 + magPow * 1.45) * pinCore * scint * eyeDarkAdapt * horizonMask;
    }

    // Faint secondary background stars (only visible in dark night skies or deep space)
    if (eyeDarkAdapt > 0.35) {
      let fGrid = sProj * 240.0 + vec2f(17.3, 9.1);
      let fCell = floor(fGrid);
      let fFrac = fract(fGrid) - 0.5;
      let fH = h21(fCell);
      if (fH > 0.9942) {
        let dF = length(fFrac);
        let fCore = exp(-dF * dF * 34.0);
        col += vec3f(0.84, 0.88, 0.96) * ((fH - 0.9942) * 32.0) * fCore * (eyeDarkAdapt - 0.35) * horizonMask;
      }
    }

    // Subtle natural Milky Way pale dust band (strictly restrained, only in dark space)
    if (spaceFactor > 0.45 && eyeDarkAdapt > 0.40) {
      let galAxis = normalize(vec3f(0.42, 0.58, 0.70));
      let bandDist = abs(dot(dir, galAxis));
      let bandMask = exp(-bandDist * bandDist * 26.0);
      let dust = fbm(sProj * 1.6 + vec2f(2.1, -1.4));
      let milkyCol = vec3f(0.42, 0.48, 0.58) * smoothstep(0.36, 0.78, dust) * bandMask;
      col += milkyCol * (spaceFactor - 0.45) * eyeDarkAdapt * 0.11;
    }

    // Real Solar System bodies (Sun + 8 physical-scale planets from SolarU)
    let bodyVis = clamp(spaceFactor + interplanetary + trueNightFactor * smoothstep(0.05, 0.32, dir.y) * 0.80, 0.0, 1.0);
    col += evalSolarSystem(dir, t, bodyVis);

    // Occasional meteors in upper mesosphere / dark sky
    col += evalMeteorites(dir, t) * clamp(trueNightFactor * 0.75 + spaceFactor * 0.35, 0.0, 0.85) * (1.0 - interplanetary);

    if (dir.y > 0.01 && auroraWeight > 0.01) {
      col += evalAurora(dir, t) * auroraWeight;
    }
  }

  // Real Physical Atmospheric Limb Halo around the ACTUAL Cube-Sphere Earth (fades cleanly when leaving Earth for interplanetary space)
  if (camAlt > 6000.0 && interplanetary < 0.95) {
    let pRad = P.enuUp.w;
    let atmoTop = pRad + 115000.0;
    let camR = pRad + camAlt;
    let b = camR * dir.y;
    if (b < 0.0) {
      let perp2 = camR * camR - b * b;
      let perp = sqrt(max(0.0, perp2));
      if (perp > pRad * 0.996 && perp < atmoTop) {
        let hNorm = clamp((perp - pRad) / 115000.0, 0.0, 1.0);
        let limb = exp(-hNorm * 4.2) * (1.0 - hNorm);
        let sunSide = max(0.14, dot(normalize(dir * (-b) + vec3f(0.0, camR, 0.0)), U.sunDir.xyz) * 0.85 + 0.25);
        let limbCol = mix(vec3f(0.16, 0.52, 0.98), vec3f(0.65, 0.86, 1.0), 1.0 - hNorm);
        col += limbCol * limb * sunSide * smoothstep(6000.0, 55000.0, camAlt) * (1.0 - interplanetary) * 1.45;
      }
    }
  }

  // Aerodynamic Re-Entry Plasma Glow (Mesosphere / Lower Thermosphere high-speed heating)
  let rHeat = P.enuSouth.w;
  if (rHeat > 0.01) {
    let plasmaWave = 0.65 + 0.35 * fbm(dir.xz * 6.0 + vec2f(t * 2.8, -t * 1.9));
    let plasmaCol = mix(vec3f(1.0, 0.28, 0.04), vec3f(1.0, 0.82, 0.38), rHeat * plasmaWave);
    let edgeMask = smoothstep(-0.35, 0.55, -dir.y) * 0.65 + 0.35;
    col += plasmaCol * rHeat * plasmaWave * edgeMask * 0.85;
  }

  return col;
}

// Camera-relative ENU atmospheric scattering, underwater absorption & orbital limb haze
fn applyAtmosphere(col_in: vec3f, relPos: vec3f, elevMeters: f32) -> vec3f {
  var col = col_in;
  let camAlt = P.enuEast.w;
  let dist = length(relPos);
  let dir = relPos / max(dist, 0.001);

  if (camAlt < -0.05 || (elevMeters < -0.25 && camAlt < 120.0)) {
    let uwDist = select(dist * (1.0 - smoothstep(-2.5, 0.0, elevMeters)), dist, camAlt < -0.05);
    let depthFactor = clamp((-min(camAlt, elevMeters)) / 24.0, 0.0, 1.0);
    let waterFogCol = mix(vec3f(0.035, 0.26, 0.34), vec3f(0.012, 0.085, 0.14), depthFactor);
    let uwFog = 1.0 - exp(-uwDist * (0.018 + depthFactor * 0.014));
    col = mix(col, waterFogCol * max(0.28, U.sunDir.w), clamp(uwFog, 0.0, 0.94));
    if (camAlt < -0.05) {
      return col;
    }
  }

  let atmoDensity = clamp(P.geo.z, 0.0, 1.0);
  // Real-meter distance aerial perspective (gentle near ground, crisp planetary Rayleigh veil from orbit)
  let baseFog = (1.0 - exp(-dist * U.sunCol.w * 0.38 * atmoDensity)) * (1.0 - smoothstep(500.0, 28000.0, camAlt));
  let hFactor = exp(-max(elevMeters, 0.0) * 0.00055);
  let mist = (1.0 - exp(-dist * 0.0016 * U.skyHorizon.w)) * hFactor * 0.36 * atmoDensity * (1.0 - smoothstep(2500.0, 14000.0, camAlt));
  let fogAmt = clamp(baseFog + mist, 0.0, 0.88);

  let sd = max(dot(dir, U.sunDir.xyz), 0.0);
  let fCol = mix(U.fogCol.rgb, U.sunCol.rgb * 0.82 + U.skyHorizon.rgb * 0.38, pow(sd, 5.0) * 0.5 * U.sunDir.w);
  col = mix(col, fCol, fogAmt);

  // Orbital atmospheric veil & Fresnel Rayleigh scattering over the curved Earth surface
  if (camAlt > 1500.0) {
    let pCenter = vec3f(0.0, -(P.enuUp.w + camAlt), 0.0);
    let radNorm = normalize(relPos - pCenter);
    let viewDot = clamp(dot(radNorm, -dir), 0.0, 1.0);
    let sunLit = max(0.06, dot(radNorm, U.sunDir.xyz));
    let rayleighRim = pow(1.0 - viewDot, 2.6) * smoothstep(1500.0, 35000.0, camAlt);
    let atmoBlue = mix(vec3f(0.14, 0.44, 0.88), vec3f(0.55, 0.80, 1.0), rayleighRim);
    col = mix(col, atmoBlue * (sunLit * 1.15 + 0.08), clamp(rayleighRim * 0.72, 0.0, 0.82));
  }

  let instinct = fract(U.misc.w);
  if (instinct > 0.02 && camAlt < 600.0) {
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
  o.pos = vec4f(p[vi], 0.99999, 1.);
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
// 2. Unified Cube-Sphere Quadtree Terrain Shader (0 m Surface -> 20,000 km Orbit)
// ----------------------------------------------------------------------------
const W_TERRAIN = W_COMMON + /*wgsl*/`
@group(1) @binding(1) var shadowTex: texture_depth_2d;
@group(1) @binding(2) var shadowSmp: sampler_comparison;
@group(1) @binding(3) var matTex: texture_2d_array<f32>;
@group(1) @binding(4) var matSmp: sampler;

struct VSIn {
  @location(0) posOffEcef: vec3f,
  @location(1) elev: f32,
  @location(2) normEcef: vec3f,
  @location(3) wetness: f32,
  @location(4) tileCol: vec3f,
  @location(5) biomePacked: f32,
  @location(6) tileRelENU: vec4f, // xyz = (tileCenter - camEcef) in ENU, w = tileArcMeters
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) relPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) tileCol: vec3f,
  @location(3) tInfo: vec4f, // x = elev, y = wetness, z = biomeId, w = lavaGlow
};

@vertex fn vs(inp: VSIn) -> VSOut {
  let offENU = vec3f(
    dot(inp.posOffEcef, P.enuEast.xyz),
    dot(inp.posOffEcef, P.enuUp.xyz),
    dot(inp.posOffEcef, P.enuSouth.xyz)
  );
  let relPos = inp.tileRelENU.xyz + offENU;
  let nENU = normalize(vec3f(
    dot(inp.normEcef, P.enuEast.xyz),
    dot(inp.normEcef, P.enuUp.xyz),
    dot(inp.normEcef, P.enuSouth.xyz)
  ));

  let lavaGlow = floor(inp.biomePacked / 100.0) * 0.01;
  let biomeId = inp.biomePacked - floor(inp.biomePacked / 100.0) * 100.0;

  var o: VSOut;
  o.pos = U.vp * vec4f(relPos, 1.0);
  o.relPos = relPos;
  o.norm = nENU;
  o.tileCol = inp.tileCol;
  o.tInfo = vec4f(inp.elev, inp.wetness, biomeId, clamp(lavaGlow, 0.0, 1.0));
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let offENU = vec3f(
    dot(inp.posOffEcef, P.enuEast.xyz),
    dot(inp.posOffEcef, P.enuUp.xyz),
    dot(inp.posOffEcef, P.enuSouth.xyz)
  );
  let relPos = inp.tileRelENU.xyz + offENU;
  return U.sunVp * vec4f(relPos, 1.0);
}

fn sampleShadow(relP: vec3f) -> f32 {
  if (P.enuEast.w > 1600.0) { return 1.0; }
  let sc = U.sunVp * vec4f(relP, 1.0);
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
  let relPos = v.relPos;
  let dist = length(relPos);
  let camAlt = P.enuEast.w;
  let h = v.tInfo.x;
  let wetness = clamp(v.tInfo.y + smoothstep(-0.35, 0.65, -h) * 0.6, 0.0, 1.0);
  let lavaGlow = v.tInfo.w;

  // Regional meter coordinates for crisp close-up triplanar / material atlas detail
  let localXZ = U.camPos.xz + relPos.xz;
  let uvA = localXZ * 0.24;
  let uvB = localXZ * 0.065 + vec2f(0.37, 0.71);
  let sSoil  = mix(textureSample(matTex, matSmp, uvA, 0), textureSample(matTex, matSmp, uvB, 0), 0.42);
  let sGrass = mix(textureSample(matTex, matSmp, uvA, 4), textureSample(matTex, matSmp, uvB, 4), 0.45);
  let sSand  = mix(textureSample(matTex, matSmp, uvA, 2), textureSample(matTex, matSmp, uvB, 2), 0.38);
  let sRock  = mix(textureSample(matTex, matSmp, uvA * 0.6, 7), textureSample(matTex, matSmp, uvB * 0.55, 8), 0.5);

  var n = normalize(v.norm);
  // Radial local up on the curved Earth sphere
  let pCenter = vec3f(0.0, -(P.enuUp.w + camAlt), 0.0);
  let radUp = normalize(relPos - pCenter);
  let slope = 1.0 - clamp(dot(n, radUp), 0.0, 1.0);

  // Smooth transition from close-up procedural micro-detail (<2 km) to unified planetary biome albedo (orbital)
  let detailFade = 1.0 - smoothstep(260.0, 4800.0, max(dist, camAlt * 1.4));
  let rockMask = smoothstep(0.22, 0.54, slope);

  var base = v.tileCol;
  if (detailFade > 0.01) {
    let microTex = mix(mix(sSoil.rgb, sGrass.rgb, smoothstep(0.5, 4.0, h) * (1.0 - rockMask)), sRock.rgb, rockMask);
    let sandBand = smoothstep(-2.5, 0.6, h) * (1.0 - smoothstep(0.6, 3.2, h));
    let texMod = mix(microTex, sSand.rgb, sandBand * 0.65);
    // Modulate unified planetary albedo with local material grain so close-up and orbital colors are 100% consistent
    base = mix(base, base * (0.58 + texMod * 0.92), detailFade * 0.85);

    // Noniv/abyssal-garden seabed rock detail, cracks & coralline fluorescence
    if (h < 0.25) {
      let abDet = abyssalRockDetail(vec3f(localXZ.x, h, localXZ.y), n);
      n = normalize(n + vec3f(abDet.x * 0.32, 0.0, abDet.y * 0.32) * detailFade);
      let coralline = mix(vec3f(0.75, 0.14, 0.52), vec3f(0.45, 0.16, 0.82), sin(localXZ.x * 0.4 + localXZ.y * 0.3) * 0.5 + 0.5);
      base = mix(base, coralline, abDet.w * 0.62 * detailFade);
    }

    let dHx = ((sSoil.a - 0.5) * 0.24 + (sRock.a - 0.5) * rockMask * 0.32) * detailFade;
    let dHz = ((sGrass.a - 0.5) * 0.24 + (sRock.r - 0.5) * rockMask * 0.32) * detailFade;
    n = normalize(n + vec3f(dHx, 0.0, dHz));
  }

  // Far-to-Mid Forest Canopy Rough-Outline LOD on Terrain (160m -> 14km)
  // Gives distant wooded landscapes organic tree-crown silhouettes & dappled depth BEFORE 3D trees resolve!
  let vegCover = smoothstep(0.35, 3.5, h) * (1.0 - rockMask) * smoothstep(0.08, 0.22, base.g - base.b * 0.55) * (1.0 - smoothstep(0.55, 0.78, base.r));
  let canopyLodVis = smoothstep(140.0, 380.0, dist) * (1.0 - smoothstep(4500.0, 16000.0, max(dist, camAlt * 1.5))) * vegCover;
  if (canopyLodVis > 0.01) {
    let crownFine = n2(localXZ * 0.085);
    let crownCluster = fbm(localXZ * 0.024 + vec2f(3.1, -5.4));
    let crownHeight = crownFine * 0.58 + crownCluster * 0.42;
    let crownShadow = mix(0.66, 1.18, smoothstep(0.28, 0.78, crownHeight));
    let crownShade = mix(base * 0.62, base * vec3f(0.88, 1.06, 0.78), smoothstep(0.35, 0.80, crownHeight));
    base = mix(base, crownShade * crownShadow, canopyLodVis * 0.78);
    let cGradX = (n2((localXZ + vec2f(4.0, 0.0)) * 0.085) - crownFine) * 0.55 * canopyLodVis;
    let cGradZ = (n2((localXZ + vec2f(0.0, 4.0)) * 0.085) - crownFine) * 0.55 * canopyLodVis;
    n = normalize(n + vec3f(cGradX, 0.0, cGradZ));
  }

  // Orbital planetary cloud shadows & swirling cloud cover painted coherently onto the real 3D globe from >18 km
  let orbitalCloudVis = smoothstep(18000.0, 95000.0, camAlt);
  if (orbitalCloudVis > 0.01) {
    let ecefDir = normalize(
      P.enuEast.xyz * radUp.x +
      P.enuUp.xyz * radUp.y +
      P.enuSouth.xyz * radUp.z
    );
    let cUv = vec2f(atan2(ecefDir.z, ecefDir.x) * 2.2 + U.camPos.w * 0.003, ecefDir.y * 3.8);
    let cFbm = fbm(cUv * 2.2) * 0.65 + fbm(cUv * 5.2 + vec2f(4.1, -2.3)) * 0.35;
    let cMask = smoothstep(0.49, 0.74, cFbm) * orbitalCloudVis * 0.72;
    base = mix(base, vec3f(0.94, 0.96, 1.0), cMask);
  }

  let rough = clamp(mix(0.86, 0.16, wetness * 0.75 * detailFade), 0.10, 0.96);
  base *= mix(1.0, 0.62, wetness * 0.55 * detailFade);

  let V = normalize(-relPos);
  let L = U.sunDir.xyz;
  let H = normalize(V + L);
  let NdotL = max(dot(n, L), 0.0);
  let NdotV = max(dot(n, V), 0.001);
  let NdotH = max(dot(n, H), 0.0);
  let VdotH = max(dot(V, H), 0.0);

  let sh = mix(1.0, sampleShadow(relPos + n * 0.18), detailFade);
  let D = distributionGGX(NdotH, rough);
  let G = geometrySmith(NdotV, NdotL, rough);
  let F = fresnelSchlick(VdotH, vec3f(mix(0.03, 0.05, wetness)));
  let spec = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001) * (0.25 + 0.75 * detailFade);

  let atmoAmbient = mix(0.045, 0.45, P.geo.z);
  let hemi = mix(vec3f(0.04, 0.05, 0.06), U.skyZenith.rgb * atmoAmbient + U.skyHorizon.rgb * (atmoAmbient * 0.55), clamp(dot(n, radUp) * 0.5 + 0.5, 0.0, 1.0));
  let sunPower = max(U.sunDir.w, (1.0 - P.geo.z) * 1.15);
  var col = base * (hemi + U.sunCol.rgb * sunPower * NdotL * sh * (1.0 - F)) + spec * U.sunCol.rgb * sunPower * NdotL * sh;

  // Volcanic lava veins & active magma glow
  if (lavaGlow > 0.02) {
    let lf = fbm(localXZ * 0.25 - vec2f(U.camPos.w * 0.18, U.camPos.w * 0.10));
    let lAmt = smoothstep(0.35, 0.72, lf + lavaGlow * 0.45) * lavaGlow;
    col += mix(vec3f(2.6, 0.30, 0.02), vec3f(4.4, 1.75, 0.22), lAmt) * lAmt * 1.4;
  }

  // Noniv/abyssal-garden chromatic underwater caustics on submerged seabeds
  if (h < 0.05 && detailFade > 0.05) {
    let t = U.camPos.w * 0.65;
    let cuv = localXZ * 0.085 + n.xz * 0.08;
    let cR = caus(cuv + vec2f(0.006, 0.0), t);
    let cG = caus(cuv, t);
    let cB = caus(cuv - vec2f(0.006, 0.0), t);
    let depthAtten = smoothstep(-28.0, -0.1, h) * smoothstep(-0.15, 0.08, -h);
    col += vec3f(cR * 0.9, cG * 1.15, cB * 1.35) * depthAtten * max(0.25, U.sunDir.w) * 0.62 * detailFade;
  }

  // Night-side planetary polar aurora subtly illuminating polar ice from orbital altitude
  if (orbitalCloudVis > 0.05) {
    let ecefDir = normalize(P.enuEast.xyz * radUp.x + P.enuUp.xyz * radUp.y + P.enuSouth.xyz * radUp.z);
    let polarRing = smoothstep(0.76, 0.86, abs(ecefDir.y)) * (1.0 - smoothstep(0.88, 0.96, abs(ecefDir.y)));
    let nightSide = 1.0 - smoothstep(0.0, 0.22, dot(radUp, L));
    let aurBand = polarRing * nightSide * smoothstep(0.42, 0.76, fbm(vec2f(atan2(ecefDir.z, ecefDir.x) * 4.0 + U.camPos.w * 0.06, ecefDir.y * 12.0)));
    col += mix(vec3f(0.08, 0.92, 0.56), vec3f(0.42, 0.22, 0.88), sin(ecefDir.x * 6.0) * 0.5 + 0.5) * aurBand * orbitalCloudVis * 0.55;
  }

  return vec4f(applyAtmosphere(col, relPos, h), 1.0);
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
  @location(4) iPosScale: vec4f, // xyz = regionalPos, w = scale
  @location(5) iRotSeed: vec4f,  // x = rotY, y = seed, z = charAmt, w = wetness
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) relPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) vMeta: vec3f, // x = charAmt, y = seed, z = elevMeters
};

fn bayer4x4(p: vec2f) -> f32 {
  let xi = u32(i32(floor(p.x)) & 3);
  let yi = u32(i32(floor(p.y)) & 3);
  let idx = yi * 4u + xi;
  var m = array<f32, 16>(
    0.03125, 0.53125, 0.15625, 0.65625,
    0.78125, 0.28125, 0.90625, 0.40625,
    0.21875, 0.71875, 0.09375, 0.59375,
    0.96875, 0.46875, 0.84375, 0.34375
  );
  return m[idx];
}

fn displaceVegRel(inp: VSIn) -> vec3f {
  let c = cos(inp.iRotSeed.x);
  let s = sin(inp.iRotSeed.x);
  let relBase = inp.iPosScale.xyz - U.camPos.xyz;
  let rHoriz = length(relBase.xz);

  // Progressive distance LOD: gently soften vertical scale in outer silhouette band (370m -> 500m)
  // so distant trees emerge organically out of the terrain canopy cover rather than popping in abruptly
  let distNear = 1.0 - smoothstep(110.0, 280.0, rHoriz);
  let horizonSettle = 1.0 - smoothstep(370.0, 505.0, rHoriz) * 0.22;
  let effScale = inp.iPosScale.w * horizonSettle;
  var lp = inp.pos * effScale;
  var p = vec3f(lp.x * c - lp.z * s, lp.y, lp.x * s + lp.z * c);

  let t = U.camPos.w;
  let swayW = inp.uv.y;
  let curveDrop = dot(relBase.xz, relBase.xz) / max(100000.0, 2.0 * P.enuUp.w);
  let wBase = vec3f(relBase.x, relBase.y - curveDrop, relBase.z);

  if (inp.iPosScale.y < -0.25) {
    // Noniv/abyssal-garden multi-harmonic traveling wave current along segmented kelp stipes & fronds
    let wavePhase = t * 1.75 - inp.pos.y * 0.92 + inp.iPosScale.x * 0.14 + inp.iRotSeed.y * 6.28;
    let surgeX = sin(wavePhase) * 0.46 + cos(t * 0.95 + inp.iPosScale.z * 0.16) * 0.25;
    let surgeZ = cos(wavePhase * 0.85) * 0.36 + sin(t * 1.15 + inp.iPosScale.x * 0.15) * 0.22;
    let bladeFlutter = sin(t * 4.8 + inp.pos.y * 3.5 + inp.pos.x * 5.0) * 0.08 * swayW * swayW * distNear;
    p.x += (surgeX * swayW + bladeFlutter) * effScale * 0.42;
    p.z += (surgeZ * swayW + bladeFlutter * 0.8) * effScale * 0.42;
    p.y -= abs(surgeX) * swayW * swayW * 0.06 * effScale;
    let wakeVec = wBase.xz + p.xz;
    let wakeD = length(wakeVec);
    if (wakeD < 4.5 && abs(wBase.y + p.y) < 4.5) {
      let push = (1.0 - wakeD / 4.5) * swayW * 0.65;
      let wakeDir = wakeVec / max(0.05, wakeD);
      p.x += wakeDir.x * push;
      p.z += wakeDir.y * push;
    }
  } else {
    let gust = sin(t * 1.6 + inp.iRotSeed.y * 6.28 + inp.iPosScale.x * 0.06) * 0.6 + cos(t * 2.9 + inp.iPosScale.z * 0.08) * 0.4;
    let windStr = U.wind.z * (0.5 + 0.5 * gust) * (0.35 + 0.65 * distNear);
    p.x += U.wind.x * windStr * swayW * 0.45 * effScale;
    p.z += U.wind.y * windStr * swayW * 0.45 * effScale;
    if (inp.uv.x > 0.5 && distNear > 0.02) {
      let f = sin(t * 5.2 + inp.pos.x * 4.1 + inp.pos.z * 3.7 + inp.iRotSeed.y * 12.) * 0.06 * swayW * distNear;
      p.y += f * effScale;
    }
  }
  return wBase + p;
}

@vertex fn vs(inp: VSIn) -> VSOut {
  let relPos = displaceVegRel(inp);
  let c = cos(inp.iRotSeed.x);
  let s = sin(inp.iRotSeed.x);
  let wn = normalize(vec3f(inp.norm.x * c - inp.norm.z * s, inp.norm.y, inp.norm.x * s + inp.norm.z * c));
  var o: VSOut;
  o.pos = U.vp * vec4f(relPos, 1.);
  o.relPos = relPos;
  o.norm = wn;
  o.col = inp.col;
  o.uv = inp.uv;
  o.vMeta = vec3f(inp.iRotSeed.z, inp.iRotSeed.y, inp.iPosScale.y + inp.pos.y * inp.iPosScale.w);
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let relPos = displaceVegRel(inp);
  return U.sunVp * vec4f(relPos, 1.);
}

@fragment fn fs(v: VSOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let relPos = v.relPos;
  let rHoriz = length(relPos.xz);

  // Smooth Progressive Distance & Altitude Silhouette Crossfade (Bayer 4x4 Ordered Dither — ZERO hard pop!)
  let distFade = 1.0 - smoothstep(320.0, 490.0, rHoriz);
  let altFade = 1.0 - smoothstep(820.0, 1900.0, P.enuEast.w);
  let lodAlpha = distFade * altFade;
  if (lodAlpha <= 0.008 || lodAlpha < bayer4x4(v.pos.xy)) {
    discard;
  }

  // Progressive Material Detail LOD:
  // 0..120m = full crisp leaf cutouts, bark bump & specular; 120..320m = progressively smooths into cohesive canopy silhouette
  let nearDetail = 1.0 - smoothstep(105.0, 315.0, rHoriz);
  var n = normalize(select(-v.norm, v.norm, ff));
  let isLeaf = v.uv.x > 0.5;
  let isGlow = v.uv.x > 1.5;
  let elev = v.vMeta.z;
  let regPos = relPos + U.camPos.xyz;

  let sc = U.sunVp * vec4f(relPos + n * 0.15, 1.);
  let sp = sc.xyz / sc.w;
  let suv = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
  let inBounds = suv.x > 0.01 && suv.x < 0.99 && suv.y > 0.01 && suv.y < 0.99 && sp.z > 0. && sp.z < 1.;
  let rawSh = textureSampleCompareLevel(shadowTex, shadowSmp, clamp(suv, vec2f(0.01), vec2f(0.99)), clamp(sp.z - 0.003, 0.0, 1.0));
  let sh = select(1., mix(1.0, rawSh, nearDetail), inBounds);

  let barkLayer = i32(floor(fract(v.vMeta.y * 7.13) * 3.0)) + 9;
  let leafLayer = i32(floor(fract(v.vMeta.y * 11.37) * 3.0)) + 13;
  let barkSample = textureSampleLevel(matTex, matSmp, vec2f(atan2(n.x, n.z) * 0.8, elev * 0.45), barkLayer, 0.0);
  let leafSample = textureSampleLevel(matTex, matSmp, regPos.xz * 0.75 + vec2f(v.uv.y), leafLayer, 0.0);

  var albedo = v.col;
  if (isLeaf && !isGlow) {
    albedo = mix(v.col, leafSample.rgb, 0.38 * nearDetail);
    // Close-up alpha-cutout leaf silhouette softens into solid cohesive crown outline at mid/far distance
    if (nearDetail > 0.25 && leafSample.a < 0.12 * nearDetail && v.uv.y > 0.72) {
      discard;
    }
  } else if (!isLeaf) {
    albedo = mix(v.col, barkSample.rgb, 0.42 * nearDetail);
    n = normalize(n + vec3f((barkSample.a - 0.5) * 0.25, 0., (barkSample.r - 0.5) * 0.25) * nearDetail);
  }

  albedo = mix(albedo, vec3f(0.06, 0.05, 0.05), v.vMeta.x * 0.85);
  let L = U.sunDir.xyz;
  let V = normalize(-relPos);
  let NdotL = max(dot(n, L), 0.);

  let hemi = mix(vec3f(0.05, 0.08, 0.05), U.skyZenith.rgb * 0.45 + U.skyHorizon.rgb * 0.25, n.y * 0.5 + 0.5);
  var col = albedo * (hemi + U.sunCol.rgb * U.sunDir.w * NdotL * sh);

  if (isLeaf) {
    let backLit = pow(clamp(dot(V, -L + n * 0.35), 0., 1.), 3.0) * (0.4 + 0.6 * sh);
    col += albedo * U.sunCol.rgb * backLit * (0.35 + 0.57 * nearDetail) * U.sunDir.w;
    let H = normalize(V + L);
    let spec = pow(max(dot(n, H), 0.), 28.) * 0.14 * sh * nearDetail;
    col += U.sunCol.rgb * spec * U.sunDir.w;
  }

  if (isGlow) {
    let pulse = 0.82 + 0.18 * sin(U.camPos.w * 2.8 + v.vMeta.y * 12.0);
    col += v.col * 0.85 * pulse;
  }

  if (elev < -0.05) {
    let cVal = caus(regPos.xz * 0.09 + n.xz * 0.06, U.camPos.w * 0.65);
    col += vec3f(0.22, 0.58, 0.72) * cVal * smoothstep(-18.0, -0.1, elev) * max(0.0, n.y + 0.35) * 0.55 * nearDetail;
  }

  if (v.vMeta.x > 0.25) {
    let ember = smoothstep(0.62, 0.88, n2(regPos.xy * 3.2 + vec2f(0., -U.camPos.w * 1.4))) * v.vMeta.x * U.fogCol.w;
    col += vec3f(2.4, 0.58, 0.08) * ember;
  }

  // Gently blend distant silhouette color into aerial haze tint before dither exit
  let silMist = smoothstep(260.0, 470.0, rHoriz);
  col = mix(col, mix(col, U.skyHorizon.rgb * 0.72, 0.38), silMist);

  return vec4f(applyAtmosphere(col, relPos, elev), 1.);
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
  @location(3) uv: vec2f,        // x = anatomical region (0.12=eye, 0.18=lowerJaw, 0.24=ear, 0.36/0.38/0.42/0.44=2-joint limbs, 0.5=torso/head, 0.8=tail/wing)
  @location(4) iPosScale: vec4f, // xyz = regionalPos, w = scale
  @location(5) iAnim: vec4f,     // x = yaw, y = stridePhase, z = emotion + speed*0.1, w = speciesId*16 + mode
  @location(6) iBody: vec4f,     // x = pitch, y = roll, z = ikFrontFlex, w = ikHindFlex
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) relPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) col: vec3f,
  @location(3) localPos: vec3f,
  @location(4) uv: vec2f,
  @location(5) @interpolate(flat) species: f32,
  @location(6) @interpolate(flat) emotion: f32,
  @location(7) elev: f32,
};

fn isLimbFactor(b: bool) -> f32 {
  return select(0.0, 1.0, b);
}

fn rotatePitchRollYaw(v: vec3f, pitch: f32, roll: f32, yaw: f32) -> vec3f {
  let cp = cos(pitch);
  let sp = sin(pitch);
  let p1 = vec3f(v.x, v.y * cp + v.z * sp, -v.y * sp + v.z * cp);
  let cr = cos(roll);
  let sr = sin(roll);
  let p2 = vec3f(p1.x * cr - p1.y * sr, p1.x * sr + p1.y * cr, p1.z);
  let cy = cos(yaw);
  let sy = sin(yaw);
  return vec3f(p2.x * cy - p2.z * sy, p2.y, p2.x * sy + p2.z * cy);
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
  let speedAmp = smoothstep(0.08, 0.45, animSpd);
  if (mode > 0.5 && mode < 1.5) {
    // Mode 1: Species-Accurate Marine Kinematics
    if (abs(sp - 34.0) < 0.5) {
      // Oceanic Manta Ray: slow graceful diamond pectoral wing wave
      let span = abs(p.x);
      let amp = 0.28 * pow(span, 1.4);
      let wave = sin(realT * 2.4 - p.z * 1.1 - span * 0.72);
      p.y += wave * amp;
      p.z += cos(realT * 1.2) * 0.03 * span;
      n = normalize(vec3f(n.x - sign(p.x) * wave * 0.22 * span, n.y, n.z));
    } else if (abs(sp - 31.0) < 0.5 || abs(sp - 32.0) < 0.5) {
      // Humpback Whale & Orca: dorsoventral vertical fluke propulsion (head stays steady)
      let tailW = smoothstep(0.0, 3.8, max(0.0, -p.z - 0.15));
      let stroke = sin(realT * 2.4 - tailW * 2.1) * 0.42 * tailW * tailW;
      p.y += stroke;
      let pecW = clamp(abs(p.x) - 0.55, 0.0, 3.5);
      p.y += sin(realT * 1.6 + sign(p.x) * 0.5) * 0.08 * pecW;
    } else if (abs(sp - 33.0) < 0.5) {
      // Great White Shark: strictly rear-concentrated lateral caudal tail propulsion (snout/gills steady!)
      let tailW = smoothstep(0.0, 2.35, max(0.0, -p.z - 0.28));
      let wave = sin(realT * 4.4 - tailW * 3.1);
      p.x += wave * 0.38 * tailW * tailW;
    } else {
      // Reef & Pelagic Fish travelling body-wave propulsion + pectoral sculling
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
    // Mode 3: CPU-Solved 2-Bone IK + 2-Joint Articulated Quadruped/Biped Stride
    let side = select(-1., 1., p.x >= 0.);
    let front = select(-1., 1., p.z >= 0.);
    let isUpperLimb = abs(anat - 0.36) < 0.015 || abs(anat - 0.42) < 0.015;
    let isLowerLimb = abs(anat - 0.38) < 0.015 || abs(anat - 0.44) < 0.015;
    let isLimb = isUpperLimb || isLowerLimb || abs(anat - 0.40) < 0.045;
    let limbT = select(clamp((0.52 - p.y) / 0.52, 0.0, 1.0), clamp(inp.uv.y, 0.0, 1.0), isUpperLimb || isLowerLimb);
    let legMask = select(clamp((0.26 - p.y) * 4.2, 0.0, 1.0), smoothstep(0.02, 0.16, limbT), isLimb);

    // 4-beat lateral walk/trot phase offset: Left/Right opposite (PI), Front/Hind quarter-cycle (PI/2)
    let phase = strideT + select(0.0, PI, side > 0.0) + select(0.0, 1.5708, front < 0.0);
    let swing = sin(phase) * speedAmp;
    let liftPhase = cos(phase) * speedAmp;
    let ikFlex = select(inp.iBody.w, inp.iBody.z, front > 0.0);

    // Upper thigh/shoulder swing + lower cannon/shin bend driven by CPU solveTwoBoneIK() flexion!
    let hipSwing = swing * 0.19 * limbT;
    let kneeBend = (max(0.0, cos(phase - 0.45)) * speedAmp * 0.09 + ikFlex * 0.075) * sin(limbT * PI);
    let lowerBend = select(0.0, (sin(phase - 0.58) * speedAmp * 0.13 + ikFlex * 0.055 * front) * max(0.0, limbT - 0.38), isLowerLimb || !isUpperLimb);
    let footClearance = (pow(max(0.0, liftPhase), 1.35) * 0.12 * limbT * limbT + ikFlex * 0.055 * max(0.0, liftPhase)) * limbT;

    p.z += (hipSwing - kneeBend * front + lowerBend) * legMask;
    p.y += footClearance * legMask;

    // Subtle muscle belly expansion during stance push-off (zero rump/pelvis distortion on Deer!)
    if (abs(sp - 13.0) > 0.5) {
      let stancePush = max(0.0, -swing);
      let muscleFlex = stancePush * smoothstep(0.12, 0.48, p.y) * (1.0 - smoothstep(0.48, 0.85, p.y));
      p.x += sign(p.x) * muscleFlex * 0.022;
    }

    // Predator Stealth Crouch (Lion, Tiger, Jaguar, Panther in emotion 3)
    let isBigCat = abs(sp - 24.0) < 0.5 || abs(sp - 25.0) < 0.5 || abs(sp - 1.0) < 0.5 || abs(sp - 11.0) < 0.5;
    if (isBigCat && abs(emotion - 3.0) < 0.4) {
      p.y *= 0.80;
      p.z += smoothstep(0.2, 0.9, p.y) * 0.07;
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
      let waddle = sin(strideT) * 0.11 * speedAmp * smoothstep(0.05, 0.75, p.y);
      p.x += waddle;
    }

    // Calm body weight transfer & tail motion (scaled by speedAmp so standing deer stay poised)
    let bodyMask = 1.0 - legMask;
    let bodyBobScale = select(0.022, 0.012, abs(sp - 13.0) < 0.5);
    p.y += cos(strideT * 2.0) * bodyBobScale * bodyMask * speedAmp;
    p.x += sin(strideT - p.z * 2.2) * (bodyBobScale * 0.65) * bodyMask * speedAmp;
    if (p.z < -0.35 && anat > 0.72) {
      let tailFreq = select(3.0, 7.2, emotion >= 2.5);
      let tailAmp = select(0.06, 0.14, emotion >= 2.5);
      p.x += sin(realT * tailFreq + p.z * 3.5) * tailAmp * clamp(-p.z - 0.35, 0.0, 1.2);
      p.y += cos(realT * (tailFreq * 0.7) + p.z * 2.5) * (tailAmp * 0.42) * clamp(-p.z - 0.35, 0.0, 1.2);
    }
  } else if (mode > 3.5) {
    // Mode 4: Arboreal Primates, Tree Frogs (Vocal Sac Inflation) & Climbing Sloths
    let cycle = sin(realT * 3.8);
    p.y += max(0., cycle) * 0.08 * clamp(p.y + 0.3, 0., 1.2);
    p.x += sin(realT * 2.4 + p.y * 2.1) * 0.045;
    if ((abs(sp - 16.0) < 0.5 || abs(sp - 17.0) < 0.5) && p.z > 0.05 && p.y < 0.12) {
      let sac = max(0.0, sin(realT * 4.5)) * 0.045;
      p.y -= sac;
      p.z += sac * 0.8;
    }
  } else {
    // Mode 0: Expressive Idle — ribcage breathing & gentle head gaze
    let lookScan = sin(realT * 1.4 + inp.iAnim.x) * 0.045 * smoothstep(0.15, 0.65, p.z);
    p.x += lookScan;
  }

  let sp_scale = inp.iPosScale.w;
  let relBase = inp.iPosScale.xyz - U.camPos.xyz;
  let curveDrop = dot(relBase.xz, relBase.xz) / max(100000.0, 2.0 * P.enuUp.w);
  let basePos = vec3f(relBase.x, relBase.y - curveDrop, relBase.z);
  let rotP = rotatePitchRollYaw(p * sp_scale, inp.iBody.x, inp.iBody.y, inp.iAnim.x);
  let rotN = normalize(rotatePitchRollYaw(n, inp.iBody.x, inp.iBody.y, inp.iAnim.x));
  let relPos = basePos + rotP;

  var o: VSOut;
  o.pos = U.vp * vec4f(relPos, 1.);
  o.relPos = relPos;
  o.norm = rotN;
  o.col = inp.col;
  o.localPos = inp.pos;
  o.uv = inp.uv;
  o.species = sp;
  o.emotion = emotion;
  o.elev = inp.iPosScale.y + rotP.y;
  return o;
}

@vertex fn vsShadow(inp: VSIn) -> @builtin(position) vec4f {
  let relBase = inp.iPosScale.xyz - U.camPos.xyz;
  let curveDrop = dot(relBase.xz, relBase.xz) / max(100000.0, 2.0 * P.enuUp.w);
  let basePos = vec3f(relBase.x, relBase.y - curveDrop, relBase.z);
  // Shadow transform matches visible pitch + roll + yaw identically!
  let rotP = rotatePitchRollYaw(inp.pos * inp.iPosScale.w, inp.iBody.x, inp.iBody.y, inp.iAnim.x);
  return U.sunVp * vec4f(basePos + rotP, 1.);
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let relPos = v.relPos;
  let elev = v.elev;
  let sp = i32(round(v.species));
  if ((length(relPos.xz) > 320.0 || P.enuEast.w > 2200.0) && (sp < 21 || sp > 23)) {
    discard;
  }
  var n = normalize(v.norm);
  let lp = v.localPos;
  let L = U.sunDir.xyz;
  let V = normalize(-relPos);
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
    if (elev < -4.5) {
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

  if (elev < -0.05) {
    let regPos = relPos + U.camPos.xyz;
    let cMarine = caus(regPos.xz * 0.11 + vec2f(elev * 0.05), U.camPos.w * 0.65);
    col += vec3f(0.25, 0.68, 0.85) * cMarine * max(0.0, n.y + 0.25) * smoothstep(-20.0, -0.1, elev) * 0.65;
  }

  let instinct = fract(U.misc.w);
  if (instinct > 0.02) {
    let aura = pow(1.0 - max(dot(n, V), 0.0), 2.0) * (1.0 - instinct);
    let emoCol = select(vec3f(0.22, 0.92, 0.58), vec3f(1.0, 0.28, 0.12), v.emotion >= 2.5);
    col += emoCol * aura * 1.6;
  }

  return vec4f(applyAtmosphere(col, relPos, elev), 1.);
}
`;

// ----------------------------------------------------------------------------
// 5. Unified Cube-Sphere Ocean & Water Surface Shader (0 m -> 20,000 km Orbit)
//    Noniv/abyssal-garden Caustics, 1.769 Snell's Window, Shorebreak & Orbital Glint
// ----------------------------------------------------------------------------
const W_WATER = W_COMMON + /*wgsl*/`
struct VSIn {
  @location(0) posOffEcef: vec3f,
  @location(1) elev: f32,
  @location(2) normEcef: vec3f,
  @location(3) wetness: f32,
  @location(4) tileCol: vec3f,
  @location(5) biomePacked: f32,
  @location(6) tileRelENU: vec4f,
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) relPos: vec3f,
  @location(1) radUp: vec3f,
  @location(2) depth: f32,
  @location(3) waveH: f32,
};

fn waveH(p: vec2f, t: f32) -> f32 {
  let w1 = sin(dot(p, vec2f(0.32, 0.15)) + t * 1.55) * 0.065;
  let w2 = sin(dot(p, vec2f(-0.22, 0.40)) + t * 1.95) * 0.048;
  let w3 = sin(dot(p, vec2f(0.68, -0.54)) + t * 2.65) * 0.025;
  let w4 = (n2(p * 1.15 + vec2f(t * 0.65, -t * 0.5)) - 0.5) * 0.032;
  return w1 + w2 + w3 + w4;
}

@vertex fn vs(inp: VSIn) -> VSOut {
  let offENU = vec3f(
    dot(inp.posOffEcef, P.enuEast.xyz),
    dot(inp.posOffEcef, P.enuUp.xyz),
    dot(inp.posOffEcef, P.enuSouth.xyz)
  );
  let terRel = inp.tileRelENU.xyz + offENU;
  let camAlt = P.enuEast.w;
  let pCenter = vec3f(0.0, -(P.enuUp.w + camAlt), 0.0);
  let radUp = normalize(terRel - pCenter);

  let dist = length(terRel);
  let waveFade = (1.0 - smoothstep(180.0, 2200.0, dist)) * (1.0 - smoothstep(250.0, 1800.0, camAlt));
  let regXZ = U.camPos.xz + terRel.xz;
  let wh = waveH(regXZ, U.camPos.w) * waveFade;

  // Project radially from terrain elevation to exact WGS-84 sea level (alt = 0)
  let seaRel = terRel - radUp * inp.elev + radUp * wh;

  var o: VSOut;
  o.pos = U.vp * vec4f(seaRel, 1.0);
  o.relPos = seaRel;
  o.radUp = radUp;
  o.depth = -inp.elev;
  o.waveH = wh;
  return o;
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let depth = v.depth;
  if (depth < -0.18) {
    discard;
  }

  let relPos = v.relPos;
  let dist = length(relPos);
  let camAlt = P.enuEast.w;
  let t = U.camPos.w;
  let regXZ = U.camPos.xz + relPos.xz;
  let detailFade = (1.0 - smoothstep(260.0, 4200.0, dist)) * (1.0 - smoothstep(380.0, 3200.0, camAlt));

  var n = normalize(v.radUp);
  if (detailFade > 0.01) {
    let e = 0.24;
    let hC = waveH(regXZ, t);
    let hX = waveH(regXZ + vec2f(e, 0.), t);
    let hZ = waveH(regXZ + vec2f(0., e), t);
    let wN = normalize(vec3f((hC - hX) * detailFade, e * (1.0 - U.misc.y * 0.32), (hC - hZ) * detailFade));
    n = normalize(mix(n, wN, detailFade));

    if (U.misc.y > 0.05) {
      let rCell = floor(regXZ * 3.5);
      let rLocal = fract(regXZ * 3.5) - 0.5;
      let rSeed = h21(rCell);
      let rPhase = fract(t * 2.4 + rSeed);
      let rDist = length(rLocal) * 2.0;
      let ring = sin((rDist - rPhase) * 28.0) * smoothstep(0.0, 0.15, rDist) * (1. - smoothstep(0.15, 0.85, rDist)) * (1. - rPhase);
      n = normalize(n + vec3f(rLocal.x * ring, 0., rLocal.y * ring) * U.misc.y * 0.42 * detailFade);
    }
  }

  let V = normalize(-relPos);
  let L = U.sunDir.xyz;

  // Underwater upward refraction through Snell's Window (1.769 exact refractive ratio)
  if (camAlt < -0.02) {
    let nDown = -n;
    let ci = max(dot(nDown, V), 0.0);
    let k = 1.0 - 1.769 * (1.0 - ci * ci);
    let tir = 1.0 - smoothstep(-0.04, 0.12, k);
    let refrDir = normalize(vec3f(-V.x * 1.33 + n.x * 0.25, sqrt(max(0.01, k)), -V.z * 1.33 + n.z * 0.25));
    let skyAbove = evalSky(refrDir);
    let abyssMirror = mix(vec3f(0.015, 0.11, 0.17), vec3f(0.04, 0.28, 0.36), ci);
    let snellC = caus(regXZ * 0.12, t * 0.65) * 0.35;
    let uwSurf = mix(skyAbove + vec3f(0.15, 0.45, 0.55) * snellC, abyssMirror, tir * 0.88);
    return vec4f(applyAtmosphere(uwSurf, relPos, 0.0), 0.94);
  }

  let R = reflect(-V, n);
  let NdotV = max(dot(n, V), 0.001);
  let NdotL = max(dot(n, L), 0.0);
  let fres = clamp(0.025 + 0.975 * pow(1.0 - NdotV, 5.0), 0.0, 1.0);
  let sunPower = max(U.sunDir.w, (1.0 - P.geo.z) * 1.15);

  let shallowCol = vec3f(0.05, 0.46, 0.56);
  let midOcean = vec3f(0.02, 0.18, 0.36);
  let deepCol = vec3f(0.008, 0.055, 0.16);
  let shelfMix = 1.0 - exp(-max(depth, 0.0) * 0.085);
  let abyssMix = smoothstep(80.0, 1800.0, depth);
  var waterBody = mix(mix(shallowCol, midOcean, shelfMix), deepCol, abyssMix) * (NdotL * 0.95 * sunPower + 0.12);

  // Close-up chromatic underwater caustics shining through shallow turquoise water
  if (detailFade > 0.02) {
    let cUv = regXZ * 0.12 + n.xz * 0.35;
    let cR = caus(cUv + vec2f(0.005, 0.0), t * 0.65);
    let cG = caus(cUv, t * 0.65);
    let cB = caus(cUv - vec2f(0.005, 0.0), t * 0.65);
    let causticVis = (1.0 - shelfMix) * smoothstep(0.02, 0.25, depth);
    waterBody += vec3f(cR * 0.85, cG * 1.05, cB * 1.25) * U.sunCol.rgb * causticVis * 0.42 * sunPower * detailFade;
  }

  let reflCol = evalSky(R) * mix(0.28, 1.0, detailFade);
  let H = normalize(V + L);
  let specPow = mix(48.0, 300.0, detailFade);
  let specGain = mix(0.85, 3.6, detailFade);
  let spec = pow(max(dot(n, H), 0.0), specPow) * specGain * sunPower * NdotL;

  let shoreFoam = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.48, 0.72, n2(regXZ * 2.8 - vec2f(t * 0.75, 0.0))) * detailFade;
  var col = mix(waterBody, reflCol, fres * mix(0.35, 0.95, detailFade)) + U.sunCol.rgb * spec;
  col = mix(col, vec3f(0.92, 0.96, 0.98) * max(0.35, sunPower), shoreFoam * 0.78);

  // Coherent orbital planetary cloud layer over oceans above 18 km (matches W_TERRAIN!)
  let orbitalCloudVis = smoothstep(18000.0, 95000.0, camAlt);
  if (orbitalCloudVis > 0.01) {
    let radUp = normalize(v.radUp);
    let ecefDir = normalize(P.enuEast.xyz * radUp.x + P.enuUp.xyz * radUp.y + P.enuSouth.xyz * radUp.z);
    let cUv = vec2f(atan2(ecefDir.z, ecefDir.x) * 2.2 + t * 0.003, ecefDir.y * 3.8);
    let cFbm = fbm(cUv * 2.2) * 0.65 + fbm(cUv * 5.2 + vec2f(4.1, -2.3)) * 0.35;
    let cMask = smoothstep(0.49, 0.74, cFbm) * orbitalCloudVis * 0.76;
    col = mix(col, vec3f(0.94, 0.96, 1.0) * (NdotL * 1.15 * sunPower + 0.06), cMask);
  }

  let alpha = clamp(smoothstep(-0.15, 0.25, depth) * 0.94 + fres * 0.2 + shoreFoam * 0.5 + orbitalCloudVis * 0.4, 0.0, 0.99);
  return vec4f(applyAtmosphere(col, relPos, 0.0), alpha);
}
`;

// ----------------------------------------------------------------------------
// 6. GPU Billboard Particles (Fire, Smoke, Fireflies, Rain, Marine Snow, Bubbles, Breach Splash)
// ----------------------------------------------------------------------------
const W_PARTICLE = W_COMMON + /*wgsl*/`
struct VSIn {
  @location(0) quad: vec2f,
  @location(1) pPosSize: vec4f, // xyz = regionalPos, w = size
  @location(2) pColKind: vec4f, // rgb = color, w = kind (0=flame, 1=smoke, 2=ember/firefly, 3=leaf, 4=rain, 5=pollen/marineSnow, 6=bubble, 7=breachSplash)
};
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) kind: f32,
  @location(3) relPos: vec3f,
  @location(4) elev: f32,
};

@vertex fn vs(inp: VSIn) -> VSOut {
  let k = inp.pColKind.w;
  let sz = select(inp.pPosSize.w, 0.0, P.enuEast.w > 2200.0);
  var right = U.camRight.xyz * sz;
  var up = U.camUp.xyz * sz;
  if (abs(k - 4.) < 0.2) {
    right = U.camRight.xyz * (sz * 0.09);
    up = normalize(vec3f(U.wind.x * 0.18, 1.0, U.wind.y * 0.18)) * (sz * 4.8);
  }
  let relBase = inp.pPosSize.xyz - U.camPos.xyz;
  let curveDrop = dot(relBase.xz, relBase.xz) / max(100000.0, 2.0 * P.enuUp.w);
  let relPos = vec3f(relBase.x, relBase.y - curveDrop, relBase.z) + right * inp.quad.x + up * inp.quad.y;
  var o: VSOut;
  o.pos = U.vp * vec4f(relPos, 1.);
  o.uv = inp.quad;
  o.col = inp.pColKind.rgb;
  o.kind = k;
  o.relPos = relPos;
  o.elev = inp.pPosSize.y;
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
    let col = applyAtmosphere(vec3f(0.14, 0.12, 0.11) + v.col * 0.22, v.relPos, v.elev);
    return vec4f(col, soft * 0.42);
  } else if (k < 2.5) {
    return vec4f(v.col * (2.6 * soft), soft);
  } else if (k > 3.5 && k < 4.5) {
    let core = exp(-abs(v.uv.x) * 4.5) * (1. - abs(v.uv.y));
    let alpha = clamp(core * 0.28 * U.misc.y, 0., 0.35);
    return vec4f(v.col * max(0.35, U.sunDir.w), alpha);
  } else if (k > 6.5) {
    // Dynamic foaming whale breach splash & whitewater spray
    let spray = pow(1.0 - r2, 1.25);
    let col = applyAtmosphere(v.col * max(0.45, U.sunDir.w * 1.15), v.relPos, v.elev);
    return vec4f(col, spray * 0.82);
  } else if (k > 5.5) {
    let rad = sqrt(r2);
    let rim = smoothstep(0.45, 0.92, rad) * (1. - smoothstep(0.92, 1.0, rad));
    let specDot = 1. - smoothstep(0.0, 0.32, length(v.uv - vec2f(-0.32, 0.35)));
    let bCol = mix(vec3f(0.25, 0.72, 0.85), vec3f(0.95, 0.99, 1.0), specDot + rim * 0.55);
    return vec4f(bCol, clamp(rim * 0.65 + specDot * 0.8, 0., 0.85));
  } else {
    let col = applyAtmosphere(v.col * max(0.35, U.sunDir.w), v.relPos, v.elev);
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
  let sunClip = U.vp * vec4f(U.sunDir.xyz * 500., 1.);
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
  let rayCol = select(U.sunCol.rgb, vec3f(0.12, 0.62, 0.78), P.enuEast.w < -0.05);
  let rayAmt = (acc / 20.) * sunFacing * U.sunDir.w * 0.42 * max(P.geo.z, select(0.0, 1.0, P.enuEast.w < -0.05));
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
// 8. Final Composite Pass (AgX/ACES Tone Map, Optical Vignette, Underwater, Re-Entry & DoF)
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
  let camAlt = P.enuEast.w;
  let isUnderwater = camAlt < -0.02 && !isLookdev;
  let hasDroplets = (U.misc.y > 0.25 || (camAlt >= -0.02 && camAlt < 0.65)) && !isLookdev;

  var uv = v.uv;
  let centered = uv - 0.5;
  let r2 = dot(centered, centered);

  if (!isLookdev) {
    uv = 0.5 + centered * (1. - 0.028 * r2);
  }

  if (isUnderwater) {
    uv.x += sin(uv.y * 18. + U.camPos.w * 2.4) * 0.003;
    uv.y += cos(uv.x * 16. + U.camPos.w * 2.1) * 0.0022;
  } else if (P.enuSouth.w > 0.05) {
    let shimmer = (n2(uv * 24. + vec2f(0., -U.camPos.w * 5.2)) - 0.5) * 0.004 * P.enuSouth.w;
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
    let sceneD = length(wp4.xyz / max(0.0001, wp4.w));
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
    if (P.enuSouth.w > 0.02) {
      let edgeHeat = smoothstep(0.06, 0.42, r2) * P.enuSouth.w;
      col += vec3f(1.45, 0.42, 0.06) * edgeHeat * 0.55;
    }
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
