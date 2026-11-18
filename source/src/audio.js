// ============================================================================
// Procedural Web Audio Bio-Acoustic Engine (18 Biomes + Species Vocalizations)
// ============================================================================
import { hypot, min, max, clamp, rr, rnd } from './math.js';
import { FIRE_POS, VOLCANO_POS, SAVANNA_POS, HIGHLAND_POS, BEACH_POS, ABYSS_POS, POLAR_POS, terrainAt } from './biomes.js';

let actx = null;
let masterGain = null;
let windGain = null, waterGain = null, rainGain = null, fireGain = null, surfGain = null;
let windFilter = null, waterFilter = null;
let muted = false;
let userVol = 0.7;
const _audT = {};

function initAudio(state) {
  if (actx) {
    if (actx.state === 'suspended') actx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  masterGain = actx.createGain();
  masterGain.gain.value = muted ? 0 : userVol;
  masterGain.connect(actx.destination);

  const len = actx.sampleRate * 3;
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029;
    b1 = 0.985 * b1 + w * 0.032;
    b2 = 0.950 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2 + w * 0.015) * 0.35;
  }

  function makeNoiseLoop(type, freq, q) {
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const flt = actx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = actx.createGain();
    g.gain.value = 0.001;
    src.connect(flt);
    flt.connect(g);
    g.connect(masterGain);
    src.start();
    return { flt, g };
  }

  const wNode = makeNoiseLoop('bandpass', 320, 1.8);
  windFilter = wNode.flt; windGain = wNode.g;

  const rNode = makeNoiseLoop('bandpass', 580, 1.1);
  waterFilter = rNode.flt; waterGain = rNode.g;

  const rnNode = makeNoiseLoop('highpass', 1100, 0.7);
  rainGain = rnNode.g;

  const fNode = makeNoiseLoop('lowpass', 240, 0.9);
  fireGain = fNode.g;

  const sfNode = makeNoiseLoop('bandpass', 260, 1.2);
  surfGain = sfNode.g;

  function scheduleCalls() {
    if (!actx) return;
    if (actx.state === 'running' && !muted) {
      terrainAt(state.camX || 0, state.camZ || 0, _audT);
      const t = actx.currentTime;
      const roll = rnd();

      if ((state.camY || 0) < -0.15 || _audT.abyss > 0.2 || _audT.reef > 0.2) {
        // Haunting Humpback Whale Song harmonic sweep underwater
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        const f0 = rr(125, 260);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * rr(1.35, 1.85), t + 0.9);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.78, t + 2.1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.055, t + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + 2.25);
      } else if (_audT.savanna > 0.25 && roll < 0.45) {
        // Distant African Lion Roar or Elephant call
        triggerSpeciesCall(roll < 0.25 ? 24 : 28);
      } else if (_audT.highland > 0.25 && roll < 0.45) {
        // Silverback Gorilla Chest-Beat
        triggerSpeciesCall(26);
      } else if (roll < 0.55) {
        // Tropical songbird / macaw / toucan FM call
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        const f0 = rr(1300, 2600);
        const f1 = f0 * rr(0.72, 1.38);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.14);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.92, t + 0.28);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.038 * (1 - _audT.fire * 0.8), t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + 0.34);
      } else if (_audT.wetness > 0.35) {
        // Tree frog / bullfrog resonant croak
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'triangle';
        const f0 = rr(190, 420);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.32, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + 0.2);
      }
    }
    setTimeout(scheduleCalls, rr(1600, 3900));
  }
  setTimeout(scheduleCalls, 1200);
}

// Play authentic species vocalization or locomotion sound when embodying an animal
function triggerSpeciesCall(speciesId) {
  if (!actx || actx.state !== 'running' || muted) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();

  if (speciesId === 24 || speciesId === 25 || speciesId === 1 || speciesId === 11) {
    // Lion / Tiger / Jaguar / Panther deep guttural roar
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(135, t);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.65);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.75);
  } else if (speciesId === 26 || speciesId === 27) {
    // Silverback Gorilla rapid chest-beat percussive resonance
    o.type = 'triangle';
    o.frequency.setValueAtTime(145, t);
    o.frequency.exponentialRampToValueAtTime(92, t + 0.28);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.32);
  } else if (speciesId === 28) {
    // African Bush Elephant brassy trumpet
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(290, t);
    o.frequency.exponentialRampToValueAtTime(640, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(480, t + 0.65);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.70);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.72);
  } else if (speciesId === 31 || speciesId === 32) {
    // Humpback Whale / Orca resonant sonar song
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.55);
    o.frequency.exponentialRampToValueAtTime(240, t + 1.15);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 1.25);
  } else {
    // Eagle screech / Macaw call / Penguin bray
    o.type = 'sine';
    o.frequency.setValueAtTime(1650, t);
    o.frequency.exponentialRampToValueAtTime(1120, t + 0.32);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.38);
  }
}

function updateAudio(camX, camY, camZ, weather, fireStrength, windSpeed) {
  if (!actx || actx.state !== 'running') return;
  const now = actx.currentTime;
  terrainAt(camX, camZ, _audT);

  const underwater = camY < -0.05;
  const wFreq = underwater ? 140 : clamp(220 + windSpeed * 180 + max(0, camY) * 6, 160, 900);
  windFilter.frequency.setTargetAtTime(wFreq, now, 0.12);
  windGain.gain.setTargetAtTime(underwater ? 0.04 : clamp(0.04 + windSpeed * 0.08, 0.02, 0.22), now, 0.12);

  const waterProx = clamp(_audT.wetness * 0.9 + (camY < 3 ? 0.3 : 0), 0, 1);
  waterFilter.frequency.setTargetAtTime(underwater ? 210 : 620, now, 0.12);
  waterGain.gain.setTargetAtTime(waterProx * (underwater ? 0.22 : 0.11), now, 0.12);

  const rainAmt = (weather === 2 || weather === 5) ? 0.16 : weather === 1 ? 0.02 : 0.0001;
  rainGain.gain.setTargetAtTime(underwater ? rainAmt * 0.2 : rainAmt, now, 0.25);

  const df = min(hypot(camX - FIRE_POS[0], camZ - FIRE_POS[1]), hypot(camX - VOLCANO_POS[0], camZ - VOLCANO_POS[1]));
  const fProx = clamp(1 - df / 110, 0, 1) * fireStrength;
  fireGain.gain.setTargetAtTime(max(0.0001, fProx * 0.22), now, 0.15);

  // Coastal Shorebreak Surf rhythmic wave wash
  const dBeach = hypot(camX - BEACH_POS[0], camZ - BEACH_POS[1]);
  const surfProx = clamp(1 - dBeach / 130, 0, 1) * (0.5 + 0.5 * Math.sin(now * 0.85));
  if (surfGain) {
    surfGain.gain.setTargetAtTime(max(0.0001, surfProx * 0.16), now, 0.18);
  }
}

function setVolume(v) {
  userVol = clamp(v, 0, 1);
  if (masterGain && actx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : userVol, actx.currentTime, 0.05);
  }
}

function toggleMute() {
  muted = !muted;
  setVolume(userVol);
  return muted;
}

export { initAudio, updateAudio, setVolume, toggleMute, triggerSpeciesCall };
