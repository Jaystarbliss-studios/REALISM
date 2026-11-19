// ============================================================================
// Deterministic PRNG, Procedural Noise, Vector/Matrix Math & Smooth SDF/IK
// ============================================================================
const PI = Math.PI, TAU = PI * 2;
const { sin, cos, tan, abs, hypot, min, max, sqrt, floor, round, atan2, exp, pow } = Math;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Polynomial Smooth-Minimum & Smooth-Maximum for seamless point-to-point SDF anatomy
function smin(a, b, k = 0.12) {
  const h = clamp(0.5 + 0.5 * (b - a) / max(1e-5, k), 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
function smax(a, b, k = 0.12) {
  return -smin(-a, -b, k);
}

// Canonical Animal & Camera Forward Convention:
// In local mesh space, +Z is forward (head/nose), -Z is tail, +Y is up, +X is right.
// In W_ANIMAL vertex shader: wp = pos + vec3(p.x * cos(yaw) - p.z * sin(yaw), p.y, p.x * sin(yaw) + p.z * cos(yaw))
// Therefore, rotating local forward (0, 0, 1) by yaw yields world forward (-sin(yaw), 0, cos(yaw)).
function normAngle(a) {
  let r = (a + PI) % TAU;
  if (r < 0) r += TAU;
  return r - PI;
}
function lerpAngle(a, b, t) {
  return a + normAngle(b - a) * clamp(t, 0, 1);
}
function yawToForward(yaw, out = [0, 0]) {
  out[0] = -sin(yaw);
  out[1] = cos(yaw);
  return out;
}
function velocityToYaw(vx, vz, fallbackYaw = 0) {
  if (hypot(vx, vz) < 1e-5) return fallbackYaw;
  return atan2(-vx, vz);
}

// Analytical 2-Bone Inverse Kinematics Solver for zero-slide foot pinning
function solveTwoBoneIK(
  rootX, rootY, rootZ,
  targetX, targetY, targetZ,
  poleX, poleY, poleZ,
  len1, len2,
  out = {}
) {
  let dx = targetX - rootX;
  let dy = targetY - rootY;
  let dz = targetZ - rootZ;
  const maxReach = (len1 + len2) * 0.992;
  const minReach = abs(len1 - len2) + 0.01;
  let dist = hypot(dx, dy, dz);
  if (dist < 1e-5) {
    dx = 0; dy = -1; dz = 0; dist = 1;
  }
  const clampedDist = clamp(dist, minReach, maxReach);
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;

  // Law of cosines for upper bone angle
  const cosA = clamp(
    (len1 * len1 + clampedDist * clampedDist - len2 * len2) / (2 * len1 * clampedDist),
    -1, 1
  );
  const sinA = sqrt(max(0, 1 - cosA * cosA));

  // Orthonormal bend direction in plane of pole vector
  const dotP = poleX * ux + poleY * uy + poleZ * uz;
  let bx = poleX - ux * dotP;
  let by = poleY - uy * dotP;
  let bz = poleZ - uz * dotP;
  const bLen = hypot(bx, by, bz);
  if (bLen > 1e-5) {
    bx /= bLen; by /= bLen; bz /= bLen;
  } else {
    bx = 0; by = 0; bz = 1;
  }

  out.midX = rootX + (ux * cosA + bx * sinA) * len1;
  out.midY = rootY + (uy * cosA + by * sinA) * len1;
  out.midZ = rootZ + (uz * cosA + bz * sinA) * len1;
  out.endX = rootX + ux * clampedDist;
  out.endY = rootY + uy * clampedDist;
  out.endZ = rootZ + uz * clampedDist;
  out.grounded = dist <= maxReach * 1.04;
  return out;
}

const WORLD_SEED = 0x56455244; // "VERD"
let _seed = WORLD_SEED;
const seedRng = (s) => { _seed = s >>> 0; };
const rnd = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + rnd() * (b - a);

function hash2(ix, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + 0x56455244;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, z) {
  const ix = floor(x), iz = floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
function fbm2(x, z, oct = 4) {
  let v = 0, a = 0.5, sx = x, sz = z;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(sx, sz);
    const nx = sx * 1.61 - sz * 1.21 + 17.3;
    const nz = sx * 1.21 + sz * 1.61 + 31.7;
    sx = nx; sz = nz; a *= 0.5;
  }
  return v;
}

// Seamless 3D value noise & FBM for pole-free, non-repeating spherical planets
function hash3(ix, iy, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + 0x56455244;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const ix = floor(x), iy = floor(y), iz = floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix,     iy,     iz);
  const c100 = hash3(ix + 1, iy,     iz);
  const c010 = hash3(ix,     iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix,     iy,     iz + 1);
  const c101 = hash3(ix + 1, iy,     iz + 1);
  const c011 = hash3(ix,     iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = lerp(c000, c100, ux);
  const x10 = lerp(c010, c110, ux);
  const x01 = lerp(c001, c101, ux);
  const x11 = lerp(c011, c111, ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}
function fbm3(x, y, z, oct = 5) {
  let v = 0, a = 0.5, norm = 0;
  let sx = x, sy = y, sz = z;
  for (let i = 0; i < oct; i++) {
    v += a * noise3(sx, sy, sz);
    norm += a;
    const nx = sx * 1.62 - sz * 1.18 + 13.7;
    const ny = sy * 1.98 + 7.3;
    const nz = sx * 1.18 + sz * 1.62 + 29.1;
    sx = nx; sy = ny; sz = nz;
    a *= 0.5;
  }
  return norm > 0 ? v / norm : 0.5;
}
function ridged3(x, y, z, oct = 4) {
  let v = 0, a = 0.5, norm = 0, weight = 1.0;
  let sx = x, sy = y, sz = z;
  for (let i = 0; i < oct; i++) {
    let n = 1.0 - abs(noise3(sx, sy, sz) * 2.0 - 1.0);
    n = n * n * weight;
    weight = clamp(n * 1.85, 0.2, 1.0);
    v += n * a;
    norm += a;
    const nx = sx * 1.72 - sy * 0.94 + 19.1;
    const ny = sx * 0.94 + sy * 1.72 - 11.4;
    const nz = sz * 1.96 + 23.7;
    sx = nx; sy = ny; sz = nz;
    a *= 0.5;
  }
  return norm > 0 ? v / norm : 0;
}

// ============================================================================
// WGS-84 Oblate Earth Geodesy, Double-Precision ECEF, Local ENU & Cube-Sphere
// Right-handed ECEF: +Y = North Pole, +Z = Prime Meridian (0° lon), +X = 90°E
// Local GPU Frame:   +X = East, +Y = Up (geodetic normal), +Z = South (-North)
// ============================================================================
const DEG2RAD = PI / 180;
const RAD2DEG = 180 / PI;
const EARTH_MEAN_R = 6371000.0;
const EARTH_EQ_R = 6378137.0;
const EARTH_POL_R = 6356752.0;

function oblateRadiusAtSinLat(sinLat) {
  const s2 = sinLat * sinLat;
  const c2 = 1.0 - s2;
  const a2 = EARTH_EQ_R * EARTH_EQ_R;
  const b2 = EARTH_POL_R * EARTH_POL_R;
  const num = a2 * a2 * c2 + b2 * b2 * s2;
  const den = a2 * c2 + b2 * s2;
  return sqrt(num / max(1, den));
}

function latLonToDir(latRad, lonRad, out = [0, 0, 1]) {
  const cl = cos(latRad);
  out[0] = cl * sin(lonRad);
  out[1] = sin(latRad);
  out[2] = cl * cos(lonRad);
  return out;
}

function dirToLatLon(nx, ny, nz, out = {}) {
  const l = hypot(nx, ny, nz) || 1;
  const x = nx / l, y = clamp(ny / l, -1, 1), z = nz / l;
  const latRad = Math.asin(y);
  const lonRad = atan2(x, z);
  out.latRad = latRad;
  out.lonRad = lonRad;
  out.latDeg = latRad * RAD2DEG;
  out.lonDeg = lonRad * RAD2DEG;
  out.nx = x; out.ny = y; out.nz = z;
  return out;
}

function geodeticToEcef(latRad, lonRad, altMeters = 0, out = [0, 0, 0]) {
  const cl = cos(latRad);
  const sl = sin(latRad);
  const r = oblateRadiusAtSinLat(sl) + altMeters;
  out[0] = r * cl * sin(lonRad);
  out[1] = r * sl;
  out[2] = r * cl * cos(lonRad);
  return out;
}

function ecefToGeodetic(x, y, z, out = {}) {
  const r = hypot(x, y, z) || EARTH_MEAN_R;
  const nx = x / r, ny = clamp(y / r, -1, 1), nz = z / r;
  const latRad = Math.asin(ny);
  const lonRad = atan2(nx, nz);
  const surfaceRadius = oblateRadiusAtSinLat(ny);
  out.latRad = latRad;
  out.lonRad = lonRad;
  out.latDeg = latRad * RAD2DEG;
  out.lonDeg = lonRad * RAD2DEG;
  out.altMeters = r - surfaceRadius;
  out.surfaceRadius = surfaceRadius;
  out.nx = nx; out.ny = ny; out.nz = nz;
  return out;
}

// Local orthonormal tangent basis at (latRad, lonRad):
// east (+X), up (+Y), south (+Z = -north), north (-Z)
function localENUFrame(latRad, lonRad, out = {}) {
  const sl = sin(latRad), cl = cos(latRad);
  const sLon = sin(lonRad), cLon = cos(lonRad);
  const ux = cl * sLon, uy = sl, uz = cl * cLon;
  const ex = cLon, ey = 0, ez = -sLon;
  // North = Up x East
  const nx = -sl * sLon, ny = cl, nz = -sl * cLon;
  out.east  = [ex, ey, ez];
  out.up    = [ux, uy, uz];
  out.north = [nx, ny, nz];
  out.south = [-nx, -ny, -nz];
  return out;
}

// Exact spherical great-circle displacement along tangent (dEastMeters, dNorthMeters)
// Handles ±180° longitude and both North/South poles continuously without singularities!
function moveAlongGeodesic(latRad, lonRad, dEastMeters, dNorthMeters, out = {}) {
  const dist = hypot(dEastMeters, dNorthMeters);
  if (dist < 1e-9) {
    out.latRad = latRad;
    out.lonRad = normAngle(lonRad);
    out.latDeg = out.latRad * RAD2DEG;
    out.lonDeg = out.lonRad * RAD2DEG;
    out.headingShift = 0;
    return out;
  }
  const sl = sin(latRad);
  const R = oblateRadiusAtSinLat(sl);
  const ang = dist / R;
  const basis = localENUFrame(latRad, lonRad);
  const tFracE = dEastMeters / dist;
  const tFracN = dNorthMeters / dist;
  // Tangent unit direction in ECEF
  const tx = basis.east[0] * tFracE + basis.north[0] * tFracN;
  const ty = basis.east[1] * tFracE + basis.north[1] * tFracN;
  const tz = basis.east[2] * tFracE + basis.north[2] * tFracN;
  // New unit normal on sphere: n' = n * cos(ang) + t * sin(ang)
  const ca = cos(ang), sa = sin(ang);
  const nx = basis.up[0] * ca + tx * sa;
  const ny = clamp(basis.up[1] * ca + ty * sa, -1, 1);
  const nz = basis.up[2] * ca + tz * sa;
  const nl = hypot(nx, ny, nz) || 1;
  const ux = nx / nl, uy = clamp(ny / nl, -1, 1), uz = nz / nl;

  const newLatRad = Math.asin(uy);
  let newLonRad = atan2(ux, uz);
  // If crossing directly over a pole, preserve continuous meridian direction
  if (hypot(ux, uz) < 1e-9) newLonRad = normAngle(lonRad + PI);

  // Parallel-transported travel tangent at new point: t' = -n * sin(ang) + t * cos(ang)
  const tpx = -basis.up[0] * sa + tx * ca;
  const tpy = -basis.up[1] * sa + ty * ca;
  const tpz = -basis.up[2] * sa + tz * ca;
  const newBasis = localENUFrame(newLatRad, newLonRad);
  const newE = tpx * newBasis.east[0] + tpy * newBasis.east[1] + tpz * newBasis.east[2];
  const newN = tpx * newBasis.north[0] + tpy * newBasis.north[1] + tpz * newBasis.north[2];
  const oldBearing = atan2(tFracE, tFracN);
  const newBearing = atan2(newE, newN);

  out.latRad = newLatRad;
  out.lonRad = normAngle(newLonRad);
  out.latDeg = out.latRad * RAD2DEG;
  out.lonDeg = out.lonRad * RAD2DEG;
  out.nx = ux; out.ny = uy; out.nz = uz;
  out.headingShift = normAngle(newBearing - oldBearing);
  return out;
}

// Haversine / great-circle distance in meters on mean oblate Earth
function greatCircleDistanceMeters(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const p1 = lat1Deg * DEG2RAD;
  const p2 = lat2Deg * DEG2RAD;
  const dp = (lat2Deg - lat1Deg) * DEG2RAD;
  const dl = (lon2Deg - lon1Deg) * DEG2RAD;
  const sp = sin(dp * 0.5);
  const sl = sin(dl * 0.5);
  const a = sp * sp + cos(p1) * cos(p2) * sl * sl;
  const c = 2 * atan2(sqrt(max(0, a)), sqrt(max(0, 1 - a)));
  const midSinLat = sin((p1 + p2) * 0.5);
  return oblateRadiusAtSinLat(midSinLat) * c;
}

// Exact invertible 6-face Cube-Sphere projection (+X=0, -X=1, +Y=2, -Y=3, +Z=4, -Z=5)
function cubeFaceUVToDir(face, u, v, out = [0, 0, 1]) {
  let x = 0, y = 0, z = 0;
  switch (face) {
    case 0: x =  1; y =  v; z = -u; break; // +X
    case 1: x = -1; y =  v; z =  u; break; // -X
    case 2: x =  u; y =  1; z = -v; break; // +Y (North Pole)
    case 3: x =  u; y = -1; z =  v; break; // -Y (South Pole)
    case 4: x =  u; y =  v; z =  1; break; // +Z
    default: x = -u; y = v; z = -1; break; // -Z
  }
  const l = hypot(x, y, z) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

function dirToCubeFaceUV(nx, ny, nz, out = {}) {
  const ax = abs(nx), ay = abs(ny), az = abs(nz);
  let face = 0, u = 0, v = 0, ma = 1;
  if (ax >= ay && ax >= az) {
    ma = ax || 1;
    face = nx >= 0 ? 0 : 1;
    u = (nx >= 0 ? -nz : nz) / ma;
    v = ny / ma;
  } else if (ay >= ax && ay >= az) {
    ma = ay || 1;
    face = ny >= 0 ? 2 : 3;
    u = nx / ma;
    v = (ny >= 0 ? -nz : nz) / ma;
  } else {
    ma = az || 1;
    face = nz >= 0 ? 4 : 5;
    u = (nz >= 0 ? nx : -nx) / ma;
    v = ny / ma;
  }
  out.face = face;
  out.u = u;
  out.v = v;
  return out;
}

const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const vNorm = (a) => {
  const l = hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function m4Mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
function m4Persp(fov, asp, n, f, out = new Float32Array(16)) {
  const t = 1 / tan(fov * 0.5), nf = 1 / (n - f);
  out.fill(0);
  out[0] = t / asp;
  out[5] = t;
  out[10] = f * nf;
  out[11] = -1;
  out[14] = f * n * nf;
  return out;
}
function m4Ortho(l, r, b, t, n, f, out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = 1 / (n - f);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = n / (n - f);
  out[15] = 1;
  return out;
}
function m4Look(eye, target, up, out = new Float32Array(16)) {
  const z = vNorm(vSub(eye, target));
  const x = vNorm(vCross(up, z));
  const y = vCross(z, x);
  out[0] = x[0]; out[4] = x[1]; out[8]  = x[2]; out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[1] = y[0]; out[5] = y[1]; out[9]  = y[2]; out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]; out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[3] = 0;    out[7] = 0;    out[11] = 0;    out[15] = 1;
  return out;
}
function m4Inv(m, out = new Float32Array(16)) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
        a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
        a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
        a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out;
  det = 1 / det;
  out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// ============================================================================
// Procedural 3D Mesh Builder (11 floats/vertex: pos3, norm3, col3, uv2)
// With Continuous Point-to-Point Spline & Polynomial Smooth-Min Hulls
// ============================================================================
class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
  }
  vert(x, y, z, nx, ny, nz, r, g, b, u = 0, v = 0) {
    const idx = (this.v.length / 11) | 0;
    this.v.push(x, y, z, nx, ny, nz, r, g, b, u, v);
    return idx;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }

  tube(path, radii, cols, uvs, segs = 7, cap = true) {
    const rings = path.length;
    const base = (this.v.length / 11) | 0;
    for (let r = 0; r < rings; r++) {
      const p = path[r];
      const prev = path[max(0, r - 1)];
      const next = path[min(rings - 1, r + 1)];
      const t = vNorm(vSub(next, prev));
      const ref = abs(t[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
      const bx = vNorm(vCross(t, ref));
      const bz = vCross(bx, t);
      const rad = radii[r];
      const rx = Array.isArray(rad) ? rad[0] : rad;
      const rz = Array.isArray(rad) ? rad[1] : rad;
      const c = cols[min(cols.length - 1, r)];
      const uv = uvs ? uvs[min(uvs.length - 1, r)] : [0, r / max(1, rings - 1)];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const ca = cos(a), sa = sin(a);
        const dx = bx[0] * ca * rx + bz[0] * sa * rz;
        const dy = bx[1] * ca * rx + bz[1] * sa * rz;
        const dz = bx[2] * ca * rx + bz[2] * sa * rz;
        const nx = bx[0] * ca / max(0.001, rx) + bz[0] * sa / max(0.001, rz);
        const ny = bx[1] * ca / max(0.001, rx) + bz[1] * sa / max(0.001, rz);
        const nz = bx[2] * ca / max(0.001, rx) + bz[2] * sa / max(0.001, rz);
        const nl = hypot(nx, ny, nz) || 1;
        this.vert(p[0] + dx, p[1] + dy, p[2] + dz, nx / nl, ny / nl, nz / nl, c[0], c[1], c[2], uv[0], uv[1]);
      }
    }
    for (let r = 0; r < rings - 1; r++) {
      const r0 = base + r * segs, r1 = r0 + segs;
      for (let s = 0; s < segs; s++) {
        const sn = (s + 1) % segs;
        this.quad(r0 + s, r0 + sn, r1 + sn, r1 + s);
      }
    }
    if (cap && rings > 1) {
      const pEnd = path[rings - 1];
      const tEnd = vNorm(vSub(pEnd, path[rings - 2]));
      const cEnd = cols[cols.length - 1];
      const uvEnd = uvs ? uvs[uvs.length - 1] : [0, 1];
      const tip = this.vert(pEnd[0], pEnd[1], pEnd[2], tEnd[0], tEnd[1], tEnd[2], cEnd[0], cEnd[1], cEnd[2], uvEnd[0], uvEnd[1]);
      const rLast = base + (rings - 1) * segs;
      for (let s = 0; s < segs; s++) {
        this.tri(rLast + s, rLast + ((s + 1) % segs), tip);
      }
      const pStart = path[0];
      const tStart = vNorm(vSub(path[0], path[1]));
      const cStart = cols[0];
      const uvStart = uvs ? uvs[0] : [0, 0];
      const root = this.vert(pStart[0], pStart[1], pStart[2], tStart[0], tStart[1], tStart[2], cStart[0], cStart[1], cStart[2], uvStart[0], uvStart[1]);
      for (let s = 0; s < segs; s++) {
        this.tri(base + ((s + 1) % segs), base + s, root);
      }
    }
  }

  // Smooth point-to-point anatomical limb/spine tube with smin joint fillets & muscle bulge
  smoothLimb(path, radii, cols, uvs, segs = 8, bulge = 0.08) {
    if (path.length < 2) return;
    const subPath = [];
    const subRadii = [];
    const subCols = [];
    const subUvs = [];
    const n = path.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = path[max(0, i - 1)];
      const p1 = path[i];
      const p2 = path[i + 1];
      const p3 = path[min(n - 1, i + 2)];
      const r1 = radii[i], r2 = radii[i + 1];
      const rx1 = Array.isArray(r1) ? r1[0] : r1;
      const rz1 = Array.isArray(r1) ? r1[1] : r1;
      const rx2 = Array.isArray(r2) ? r2[0] : r2;
      const rz2 = Array.isArray(r2) ? r2[1] : r2;
      const c1 = cols[min(cols.length - 1, i)];
      const c2 = cols[min(cols.length - 1, i + 1)];
      const uv1 = uvs ? uvs[min(uvs.length - 1, i)] : [0.5, 0.3];
      const uv2 = uvs ? uvs[min(uvs.length - 1, i + 1)] : [0.5, 0.3];
      const steps = i === n - 2 ? 3 : 2;
      for (let s = 0; s < steps; s++) {
        const t = s / (i === n - 2 ? 2 : 2);
        const t2 = t * t, t3 = t2 * t;
        // Catmull-Rom spline evaluation for seamless C1/C2 curvature
        const qx = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const qy = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        const qz = 0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
        // Muscle belly harmonic + polynomial smooth-min joint preservation
        const mBell = 1 + bulge * sin(t * PI);
        subPath.push([qx, qy, qz]);
        subRadii.push([lerp(rx1, rx2, t) * mBell, lerp(rz1, rz2, t) * mBell]);
        subCols.push([lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]);
        subUvs.push([lerp(uv1[0], uv2[0], t), lerp(uv1[1], uv2[1], t)]);
      }
    }
    this.tube(subPath, subRadii, subCols, subUvs, segs, true);
  }

  ellipsoid(cx, cy, cz, rx, ry, rz, col, u = 0, v = 0, lat = 6, lon = 8) {
    const base = (this.v.length / 11) | 0;
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * PI;
      const st = sin(th), ct = cos(th);
      for (let j = 0; j < lon; j++) {
        const ph = (j / lon) * TAU;
        const sp = sin(ph), cp = cos(ph);
        const x = st * cp, y = ct, z = st * sp;
        const nx = x / max(0.001, rx), ny = y / max(0.001, ry), nz = z / max(0.001, rz);
        const nl = hypot(nx, ny, nz) || 1;
        this.vert(cx + x * rx, cy + y * ry, cz + z * rz, nx / nl, ny / nl, nz / nl, col[0], col[1], col[2], u, v);
      }
    }
    for (let i = 0; i < lat; i++) {
      const r0 = base + i * lon, r1 = r0 + lon;
      for (let j = 0; j < lon; j++) {
        const jn = (j + 1) % lon;
        this.quad(r0 + j, r1 + j, r1 + jn, r0 + jn);
      }
    }
  }

  ribbon(p0, p1, w0, w1, arch, col0, col1, u = 1, v0 = 0, v1 = 1, segs = 4) {
    const base = (this.v.length / 11) | 0;
    const dir = vNorm(vSub(p1, p0));
    const refAxis = abs(dir[1]) > 0.90 ? [1, 0, 0] : [0, 1, 0];
    const side = vNorm(vCross(dir, refAxis));
    const up = vNorm(vCross(side, dir));
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const w = lerp(w0, w1, sin(f * PI * 0.85 + 0.15));
      const lift = sin(f * PI) * arch;
      const cx = lerp(p0[0], p1[0], f) + up[0] * lift;
      const cy = lerp(p0[1], p1[1], f) + up[1] * lift;
      const cz = lerp(p0[2], p1[2], f) + up[2] * lift;
      const c = [lerp(col0[0], col1[0], f), lerp(col0[1], col1[1], f), lerp(col0[2], col1[2], f)];
      const vf = lerp(v0, v1, f);
      this.vert(cx - side[0] * w, cy - side[1] * w, cz - side[2] * w, up[0], up[1], up[2], c[0], c[1], c[2], u, vf);
      this.vert(cx + side[0] * w, cy + side[1] * w, cz + side[2] * w, up[0], up[1], up[2], c[0], c[1], c[2], u, vf);
    }
    for (let s = 0; s < segs; s++) {
      const r = base + s * 2;
      this.quad(r, r + 1, r + 3, r + 2);
      this.quad(r + 1, r, r + 2, r + 3);
    }
  }

  build() {
    return {
      verts: new Float32Array(this.v),
      indices: new Uint32Array(this.i),
      count: this.i.length
    };
  }
}

export {
  PI, TAU, DEG2RAD, RAD2DEG, EARTH_MEAN_R, EARTH_EQ_R, EARTH_POL_R,
  sin, cos, tan, abs, hypot, min, max, sqrt, floor, round, atan2, exp, pow,
  clamp, saturate, lerp, smoothstep, smin, smax,
  normAngle, lerpAngle, yawToForward, velocityToYaw, solveTwoBoneIK,
  WORLD_SEED, seedRng, rnd, rr, hash2, noise2, fbm2, hash3, noise3, fbm3, ridged3,
  oblateRadiusAtSinLat, latLonToDir, dirToLatLon, geodeticToEcef, ecefToGeodetic,
  localENUFrame, moveAlongGeodesic, greatCircleDistanceMeters,
  cubeFaceUVToDir, dirToCubeFaceUV,
  vSub, vCross, vNorm, m4Mul, m4Persp, m4Ortho, m4Look, m4Inv,
  MeshBuilder
};
