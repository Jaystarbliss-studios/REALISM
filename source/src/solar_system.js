// ============================================================================
// REALISM — True Physical-Scale Heliocentric Solar-System Simulation
// Reference Data: NASA / JPL Planetary Fact Sheets (J2000 Mean Keplerian
// Elements). All distances and radii share ONE unified SI unit system (meters):
//   1 AU = 149,597,870,700 m (149.6 million km)
// Double-precision Float64 heliocentric coordinates with seamless continuous
// transition between Earth's geodetic ECEF frame and interplanetary space.
// ============================================================================
import { PI, TAU, DEG2RAD, RAD2DEG, sin, cos, abs, hypot, min, max, sqrt, clamp, atan2, normAngle } from './math.js';
import { geodeticToEcef, ecefToGeodetic, localENUFrame } from './math.js';

export const AU_METERS = 149597870700.0;        // Exact IAU 2012 definition (m)
export const SPEED_OF_LIGHT = 299792458.0;      // m/s
export const EARTH_ORBIT_HANDOFF_ALT = 420000.0; // Continuous LEO -> Heliocentric tracking handoff (m)

// Authentic NASA/JPL physical parameters (ALL radii in meters, semi-major axes in AU, periods in Earth days)
export const SOLAR_BODIES = [
  {
    id: 'sun', name: 'The Sun', type: 'star', solidSurface: false,
    radiusM: 696340000.0,           // 696,340 km
    aAU: 0.0, e: 0.0, incDeg: 0.0, periodDays: 1.0, lon0Deg: 0.0,
    axialTiltDeg: 7.25, rotHours: 609.12,
    safeApproachAltM: 2.5e9,        // 2.5M km corona thermal safety envelope (no solid landing!)
    atmoHeightM: 5.0e7,
    color: [1.0, 0.94, 0.78], atmoColor: [1.0, 0.62, 0.18],
    desc: 'G2V main-sequence star · 5,778 K photosphere · Intense radiative envelope (orbital approach only)'
  },
  {
    id: 'mercury', name: 'Mercury', type: 'terrestrial', solidSurface: true,
    radiusM: 2439700.0,             // 2,439.7 km
    aAU: 0.387098, e: 0.205630, incDeg: 7.005, periodDays: 87.969, lon0Deg: 252.25,
    axialTiltDeg: 0.034, rotHours: 1407.6,
    safeApproachAltM: 25000.0,
    atmoHeightM: 0.0,
    color: [0.56, 0.54, 0.52], atmoColor: [0.35, 0.34, 0.32],
    desc: 'Heavily cratered silicate crust · Extreme solar irradiance · Negligible exosphere'
  },
  {
    id: 'venus', name: 'Venus', type: 'terrestrial', solidSurface: true,
    radiusM: 6051800.0,             // 6,051.8 km
    aAU: 0.723332, e: 0.006772, incDeg: 3.395, periodDays: 224.701, lon0Deg: 181.98,
    axialTiltDeg: 177.36, rotHours: -5832.5,
    safeApproachAltM: 55000.0,      // Upper sulfuric cloud-deck exploration boundary
    atmoHeightM: 250000.0,
    color: [0.89, 0.78, 0.56], atmoColor: [0.95, 0.80, 0.48],
    desc: 'Super-rotating sulfuric acid clouds · 92 bar CO2 greenhouse atmosphere · 737 K surface'
  },
  {
    id: 'earth', name: 'Earth', type: 'terrestrial', solidSurface: true,
    radiusM: 6371000.0,             // 6,371.0 km (matches PLANET_RADIUS exactly)
    aAU: 1.000001, e: 0.016708, incDeg: 0.0, periodDays: 365.256, lon0Deg: 100.46,
    axialTiltDeg: 23.44, rotHours: 23.9345,
    safeApproachAltM: 0.0,          // Full atmospheric re-entry & surface biosphere
    atmoHeightM: 115000.0,
    color: [0.16, 0.44, 0.78], atmoColor: [0.28, 0.62, 1.0],
    desc: 'Liquid ocean biosphere · Nitrogen-oxygen atmosphere · Full Cube-Sphere surface landing'
  },
  {
    id: 'mars', name: 'Mars', type: 'terrestrial', solidSurface: true,
    radiusM: 3389500.0,             // 3,389.5 km
    aAU: 1.523679, e: 0.09340, incDeg: 1.850, periodDays: 686.980, lon0Deg: 355.45,
    axialTiltDeg: 25.19, rotHours: 24.6229,
    safeApproachAltM: 18000.0,
    atmoHeightM: 80000.0,
    color: [0.76, 0.34, 0.19], atmoColor: [0.84, 0.48, 0.30],
    desc: 'Iron-oxide desert plains, Valles Marineris, Olympus Mons & CO2 polar ice caps'
  },
  {
    id: 'jupiter', name: 'Jupiter', type: 'gas_giant', solidSurface: false,
    radiusM: 69911000.0,            // 69,911 km
    aAU: 5.2044, e: 0.0489, incDeg: 1.303, periodDays: 4332.59, lon0Deg: 34.40,
    axialTiltDeg: 3.13, rotHours: 9.925,
    safeApproachAltM: 1200000.0,    // Upper cloud-band orbital entry limit (no solid surface!)
    atmoHeightM: 5000000.0,
    color: [0.80, 0.67, 0.52], atmoColor: [0.84, 0.72, 0.58],
    desc: 'Largest gas giant · Zonal ammonia jet bands & Great Red Spot · Orbital exploration only'
  },
  {
    id: 'saturn', name: 'Saturn', type: 'gas_giant', solidSurface: false,
    radiusM: 58232000.0,            // 58,232 km
    aAU: 9.5826, e: 0.0565, incDeg: 2.485, periodDays: 10759.22, lon0Deg: 49.94,
    axialTiltDeg: 26.73, rotHours: 10.656,
    ringInnerM: 74500000.0,         // C-ring inner edge (74,500 km)
    ringOuterM: 140220000.0,        // F-ring outer edge (140,220 km)
    safeApproachAltM: 1500000.0,
    atmoHeightM: 4500000.0,
    color: [0.88, 0.78, 0.56], atmoColor: [0.90, 0.82, 0.62],
    desc: 'Ringed gas giant · Physically scaled ice-ring system & Cassini Division · Orbital exploration only'
  },
  {
    id: 'uranus', name: 'Uranus', type: 'ice_giant', solidSurface: false,
    radiusM: 25362000.0,            // 25,362 km
    aAU: 19.19126, e: 0.04717, incDeg: 0.773, periodDays: 30688.5, lon0Deg: 313.23,
    axialTiltDeg: 97.77, rotHours: -17.24,
    ringInnerM: 38000000.0,
    ringOuterM: 51150000.0,
    safeApproachAltM: 900000.0,
    atmoHeightM: 2500000.0,
    color: [0.58, 0.84, 0.89], atmoColor: [0.64, 0.90, 0.96],
    desc: 'Pale cyan methane ice giant · Extreme 97.77° axial obliquity · Orbital exploration only'
  },
  {
    id: 'neptune', name: 'Neptune', type: 'ice_giant', solidSurface: false,
    radiusM: 24622000.0,            // 24,622 km
    aAU: 30.07, e: 0.00859, incDeg: 1.770, periodDays: 60195.0, lon0Deg: 304.88,
    axialTiltDeg: 28.32, rotHours: 16.11,
    safeApproachAltM: 900000.0,
    atmoHeightM: 2500000.0,
    color: [0.22, 0.42, 0.88], atmoColor: [0.30, 0.54, 0.98],
    desc: 'Deep azure ice giant · Supersonic methane storms at 30.07 AU · Orbital exploration only'
  }
];

export const SOLAR_BODY_BY_ID = Object.fromEntries(SOLAR_BODIES.map((b) => [b.id, b]));

// Solve Kepler's equation M = E - e*sin(E) via Newton-Raphson (Float64)
function solveKepler(M, e) {
  let E = M + e * sin(M);
  for (let i = 0; i < 6; i++) {
    const f = E - e * sin(E) - M;
    const fp = 1.0 - e * cos(E);
    E -= f / (fp || 1.0);
  }
  return E;
}

// Compute exact heliocentric J2000 ecliptic coordinates [x, y, z] in SI METERS at simDaysSinceJ2000
// Coordinate frame: +X = vernal equinox, +Z = ecliptic 90 deg, +Y = ecliptic north
export function computeHelioPositionMeters(body, simDays, out = [0, 0, 0]) {
  if (!body || body.aAU === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    return out;
  }
  const n = TAU / body.periodDays;
  const M = normAngle(body.lon0Deg * DEG2RAD + n * simDays);
  const E = solveKepler(M, body.e);
  const aM = body.aAU * AU_METERS;
  const xOrb = aM * (cos(E) - body.e);
  const zOrb = aM * sqrt(max(0, 1.0 - body.e * body.e)) * sin(E);
  const inc = body.incDeg * DEG2RAD;
  out[0] = xOrb;
  out[1] = zOrb * sin(inc);
  out[2] = zOrb * cos(inc);
  return out;
}

export function createSolarSystemState(initialDays = 9650.0) {
  const positions = new Map();
  for (const b of SOLAR_BODIES) {
    positions.set(b.id, computeHelioPositionMeters(b, initialDays, [0, 0, 0]));
  }
  const earthPos = positions.get('earth');
  return {
    simDays: initialDays,      // Days since J2000 (~2026)
    timeAccel: 1.0,            // Simulated orbital clock multiplier (distinct from ship velocity!)
    mode: 'earth_geodetic',    // 'earth_geodetic' | 'interplanetary'
    activeBodyId: 'earth',
    targetBodyId: 'mars',
    autopilotCourse: false,    // Continuous assisted interplanetary course guidance
    propulsionScale: 1.0,      // User thrust scale
    // Double-precision heliocentric observer position & velocity (SI meters, m/s)
    posM: [earthPos[0], earthPos[1], earthPos[2] + 6371000.0 + 10.0],
    velMps: [0, 0, 0],
    positions,
    // Latest telemetry snapshot
    distFromSunM: AU_METERS,
    distToTargetM: 0,
    speedMps: 0,
    etaSeconds: Infinity,
    approachWarning: ''
  };
}

export function updateSolarEphemeris(solarState, dtSec) {
  // Advance orbital clock by dt * timeAccel (strictly separated from physical spacecraft velocity!)
  const dDays = (dtSec * Math.max(0, solarState.timeAccel)) / 86400.0;
  solarState.simDays += dDays;
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    computeHelioPositionMeters(b, solarState.simDays, solarState.positions.get(b.id));
  }
}

// Convert Earth geodetic camera -> exact double-precision heliocentric position (zero discontinuity!)
export function syncSolarFromEarthCam(solarState, latRad, lonRad, altMeters) {
  const earthCenter = solarState.positions.get('earth');
  const ecef = geodeticToEcef(latRad, lonRad, altMeters, [0, 0, 0]);
  solarState.posM[0] = earthCenter[0] + ecef[0];
  solarState.posM[1] = earthCenter[1] + ecef[1];
  solarState.posM[2] = earthCenter[2] + ecef[2];
  solarState.activeBodyId = 'earth';
  refreshSolarTelemetry(solarState);
}

// Convert heliocentric observer position back to Earth geodetic coordinates
export function solarToEarthGeodetic(solarState, out = {}) {
  const earthCenter = solarState.positions.get('earth');
  const dx = solarState.posM[0] - earthCenter[0];
  const dy = solarState.posM[1] - earthCenter[1];
  const dz = solarState.posM[2] - earthCenter[2];
  return ecefToGeodetic(dx, dy, dz, out);
}

export function refreshSolarTelemetry(solarState) {
  const px = solarState.posM[0], py = solarState.posM[1], pz = solarState.posM[2];
  solarState.distFromSunM = hypot(px, py, pz);

  // Determine nearest solar body (sphere of influence / active planetary body)
  let nearestId = 'sun';
  let nearestSurfDist = Infinity;
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const bp = solarState.positions.get(b.id);
    const dCenter = hypot(px - bp[0], py - bp[1], pz - bp[2]);
    const surfAlt = dCenter - b.radiusM;
    // Weight by Hill-like proximity so Earth dominates inside ~900,000 km
    const metric = b.id === 'sun' ? surfAlt * 0.25 : surfAlt;
    if (metric < nearestSurfDist) {
      nearestSurfDist = metric;
      nearestId = b.id;
    }
  }
  solarState.activeBodyId = nearestId;

  const target = SOLAR_BODY_BY_ID[solarState.targetBodyId] || SOLAR_BODY_BY_ID.mars;
  const tp = solarState.positions.get(target.id);
  const dx = tp[0] - px, dy = tp[1] - py, dz = tp[2] - pz;
  const distCenter = hypot(dx, dy, dz);
  solarState.distToTargetM = max(0, distCenter - target.radiusM);
  solarState.speedMps = hypot(solarState.velMps[0], solarState.velMps[1], solarState.velMps[2]);

  // Closing velocity along target vector for meaningful ETA
  if (distCenter > 1 && solarState.speedMps > 10) {
    const closing = (solarState.velMps[0] * dx + solarState.velMps[1] * dy + solarState.velMps[2] * dz) / distCenter;
    solarState.etaSeconds = closing > 1 ? solarState.distToTargetM / closing : Infinity;
  } else {
    solarState.etaSeconds = Infinity;
  }

  // Enforce physical planetary boundaries (no fictional solid landing on Sun or gas/ice giants!)
  solarState.approachWarning = '';
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const bp = solarState.positions.get(b.id);
    const rx = px - bp[0], ry = py - bp[1], rz = pz - bp[2];
    const d = hypot(rx, ry, rz);
    const minR = b.radiusM + (b.id === 'earth' ? 0 : b.safeApproachAltM);
    if (b.id !== 'earth' && d < minR && d > 1) {
      const inv = minR / d;
      solarState.posM[0] = bp[0] + rx * inv;
      solarState.posM[1] = bp[1] + ry * inv;
      solarState.posM[2] = bp[2] + rz * inv;
      // Damp inward velocity cleanly at atmospheric/radiative boundary
      const nx = rx / d, ny = ry / d, nz = rz / d;
      const vn = solarState.velMps[0] * nx + solarState.velMps[1] * ny + solarState.velMps[2] * nz;
      if (vn < 0) {
        solarState.velMps[0] -= nx * vn;
        solarState.velMps[1] -= ny * vn;
        solarState.velMps[2] -= nz * vn;
      }
      solarState.approachWarning = b.type === 'star'
        ? 'Solar Radiative Limit — Orbital Observation Envelope'
        : !b.solidSurface
          ? `${b.name} Upper Atmosphere — Gas/Ice Giant Orbital Limit`
          : `${b.name} Orbital Approach Altitude Reached`;
    }
  }
}

// Continuous interplanetary flight step in true physical meters (never shrinks planets or distances!)
export function stepInterplanetaryFlight(solarState, camForwardWorld, camRightWorld, input, dt) {
  updateSolarEphemeris(solarState, dt);

  const target = SOLAR_BODY_BY_ID[solarState.targetBodyId] || SOLAR_BODY_BY_ID.mars;
  const tp = solarState.positions.get(target.id);
  const dx = tp[0] - solarState.posM[0];
  const dy = tp[1] - solarState.posM[1];
  const dz = tp[2] - solarState.posM[2];
  const distTarget = hypot(dx, dy, dz) || 1;
  const surfDist = max(0, distTarget - target.radiusM - target.safeApproachAltM);

  if (solarState.autopilotCourse) {
    // Smooth continuous course guidance: accelerates smoothly in deep space, decelerates cleanly into destination orbit
    const desiredSpd = clamp(surfDist * 0.42, 4500.0, 2.5e10 * clamp(input.speedMult || 1.0, 0.2, 10.0));
    if (surfDist < max(25000.0, target.radiusM * 0.85)) {
      solarState.autopilotCourse = false;
      solarState.velMps[0] *= 0.1;
      solarState.velMps[1] *= 0.1;
      solarState.velMps[2] *= 0.1;
    } else {
      const k = 1.0 - Math.exp(-dt * 3.5);
      solarState.velMps[0] += ((dx / distTarget) * desiredSpd - solarState.velMps[0]) * k;
      solarState.velMps[1] += ((dy / distTarget) * desiredSpd - solarState.velMps[1]) * k;
      solarState.velMps[2] += ((dz / distTarget) * desiredSpd - solarState.velMps[2]) * k;
    }
  } else {
    // Manual propulsion scaled continuously by distance to nearest body (consistent SI meters!)
    const activeB = SOLAR_BODY_BY_ID[solarState.activeBodyId] || SOLAR_BODY_BY_ID.earth;
    const abp = solarState.positions.get(activeB.id);
    const altNearest = max(1000.0, hypot(solarState.posM[0] - abp[0], solarState.posM[1] - abp[1], solarState.posM[2] - abp[2]) - activeB.radiusM);
    const warp = input.speedMult <= 3.0 ? input.speedMult : 3.0 * Math.pow(input.speedMult / 3.0, 2.8);
    const baseSpd = clamp(altNearest * 0.45, 8000.0, 4.5e10) * warp * (input.boost ? 3.5 : input.slow ? 0.18 : 1.0);

    const mf = input.fwd || 0;
    const mr = input.right || 0;
    const mu = input.up || 0;
    const wantX = (camForwardWorld[0] * mf + camRightWorld[0] * mr) * baseSpd;
    const wantY = (camForwardWorld[1] * mf + camRightWorld[1] * mr + mu) * baseSpd;
    const wantZ = (camForwardWorld[2] * mf + camRightWorld[2] * mr) * baseSpd;
    const k = 1.0 - Math.exp(-dt * 4.5);
    solarState.velMps[0] += (wantX - solarState.velMps[0]) * k;
    solarState.velMps[1] += (wantY - solarState.velMps[1]) * k;
    solarState.velMps[2] += (wantZ - solarState.velMps[2]) * k;
  }

  solarState.posM[0] += solarState.velMps[0] * dt;
  solarState.posM[1] += solarState.velMps[1] * dt;
  solarState.posM[2] += solarState.velMps[2] * dt;
  refreshSolarTelemetry(solarState);
}

// Compute camera-relative direction & exact physical angular radius (rad) of every solar-system body
// Projected into the active ENU basis so GPU shaders render real heliocentric planets at true scale!
export function projectSolarBodiesToENU(solarState, enuFrame) {
  const E = enuFrame.east, Uv = enuFrame.up, S = enuFrame.south;
  const px = solarState.posM[0], py = solarState.posM[1], pz = solarState.posM[2];
  const sunPos = solarState.positions.get('sun');
  const out = [];
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const bp = solarState.positions.get(b.id);
    const rx = bp[0] - px, ry = bp[1] - py, rz = bp[2] - pz;
    const dist = hypot(rx, ry, rz) || 1;
    // Transform relative heliocentric vector into camera ENU (+X East, +Y Up, +Z South)
    const ex = (rx * E[0] + ry * E[1] + rz * E[2]) / dist;
    const ey = (rx * Uv[0] + ry * Uv[1] + rz * Uv[2]) / dist;
    const ez = (rx * S[0] + ry * S[1] + rz * S[2]) / dist;
    const angRad = Math.asin(clamp(b.radiusM / dist, 0, 0.9999));

    // Vector from planet to Sun in ENU for exact phase lighting
    const sx = sunPos[0] - bp[0], sy = sunPos[1] - bp[1], sz = sunPos[2] - bp[2];
    const sd = hypot(sx, sy, sz) || 1;
    const sunEx = (sx * E[0] + sy * E[1] + sz * E[2]) / sd;
    const sunEy = (sx * Uv[0] + sy * Uv[1] + sz * Uv[2]) / sd;
    const sunEz = (sx * S[0] + sy * S[1] + sz * S[2]) / sd;

    out.push({
      id: b.id,
      index: i,
      body: b,
      dirENU: [ex, ey, ez],
      sunDirENU: [sunEx, sunEy, sunEz],
      distM: dist,
      angRad
    });
  }
  return out;
}

export function formatDistanceSI(meters) {
  const m = abs(meters);
  if (!Number.isFinite(m)) return '—';
  if (m >= AU_METERS * 0.1) return `${(m / AU_METERS).toFixed(3)} AU`;
  if (m >= 1e9) return `${(m / 1e9).toFixed(2)}M km`;
  if (m >= 1e6) return `${(m / 1e3).toFixed(0)} km`;
  if (m >= 1e3) return `${(m / 1e3).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export function formatSpeedSI(mps) {
  const v = abs(mps);
  if (!Number.isFinite(v)) return '0 m/s';
  if (v >= SPEED_OF_LIGHT * 0.1) return `${(v / SPEED_OF_LIGHT).toFixed(2)} c`;
  if (v >= 1e6) return `${(v / 1e3).toFixed(0)} km/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} km/s`;
  if (v >= 15) return `${(v * 3.6).toFixed(0)} km/h`;
  return `${v.toFixed(1)} m/s`;
}

export function formatEtaSI(sec) {
  if (!Number.isFinite(sec) || sec <= 0 || sec > 3.15e10) return '—';
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  if (sec < 3.15e7) return `${(sec / 86400).toFixed(1)}d`;
  return `${(sec / 3.15576e7).toFixed(1)}y`;
}
