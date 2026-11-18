// ============================================================================
// REALISM — Procedural WebAudio Bio-Acoustic & Orbital Soundscape Synthesizer
// ============================================================================

export const createBioAudio = () => {
  let ctx = null;
  let master = null;
  let running = false;
  let muted = false;
  let windGain = null;
  let waterGain = null;
  let rainGain = null;
  let surfGain = null;
  let fireGain = null;
  let spaceDroneGain = null;
  let windFilter = null;
  let birdTimer = 0;
  let frogTimer = 0;
  let cicadaGain = null;
  let whaleTimer = 5.0;
  let roarTimer = 9.0;

  // Channel volume multipliers controlled by in-game Settings modal
  const vols = {
    master: 0.75,
    ambient: 0.85,
    wildlife: 0.90,
    water: 0.85,
    weather: 0.80
  };

  const makeNoiseBuffer = (context, seconds = 3) => {
    const len = context.sampleRate * seconds;
    const buf = context.createBuffer(1, len, context.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.035;
      b6 = white * 0.115926;
    }
    return buf;
  };

  const triggerBirdCall = (biomeId = 0, isUnderwater = 0) => {
    if (!ctx || !running || muted || isUnderwater > 0.5 || vols.wildlife <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    const isCoast = biomeId === 9 || biomeId === 12 || biomeId === 17;
    const baseFreq = isCoast
      ? 680 + Math.random() * 420
      : biomeId === 2
        ? 1100 + Math.random() * 650
        : 1450 + Math.random() * 900;

    osc.type = isCoast ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (isCoast ? 0.78 : 1.32), now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (isCoast ? 0.65 : 0.88), now + 0.24);

    const peak = 0.025 * vols.wildlife;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.28);
  };

  const triggerFrogCroak = () => {
    if (!ctx || !running || muted || vols.wildlife <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const g = ctx.createGain();

    osc.type = 'sawtooth';
    const f = 140 + Math.random() * 55;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.linearRampToValueAtTime(f * 1.18, now + 0.14);

    mod.frequency.setValueAtTime(36, now);
    modGain.gain.setValueAtTime(45, now);
    mod.connect(modGain);
    modGain.connect(osc.frequency);

    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 340;
    flt.Q.value = 3.2;

    const peak = 0.028 * vols.wildlife;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

    osc.connect(flt);
    flt.connect(g);
    g.connect(master);

    osc.start(now);
    mod.start(now);
    osc.stop(now + 0.21);
    mod.stop(now + 0.21);
  };

  const triggerWhaleSong = () => {
    if (!ctx || !running || muted || vols.wildlife <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();

    osc.type = 'sine';
    const f0 = 115 + Math.random() * 95;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.55, now + 0.75);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.72, now + 2.1);

    flt.type = 'lowpass';
    flt.frequency.value = 420;

    const peak = 0.045 * vols.wildlife;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);

    osc.connect(flt);
    flt.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 2.4);
  };

  const triggerApexCall = (biomeId = 6) => {
    if (!ctx || !running || muted || vols.wildlife <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    const base = biomeId === 8 ? 72 : 88 + Math.random() * 25;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, now + 0.85);

    flt.type = 'lowpass';
    flt.frequency.value = 210;

    const peak = 0.032 * vols.wildlife;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);

    osc.connect(flt);
    flt.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 1.0);
  };

  const ensureInitialized = () => {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return false;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.24 * vols.master;
    master.connect(ctx.destination);

    const noiseBuf = makeNoiseBuffer(ctx, 4);

    // Wind & canopy rustle
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 380;
    windFilter.Q.value = 0.9;
    windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSrc.start();

    // River & stream murmur
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = noiseBuf;
    waterSrc.loop = true;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 640;
    waterFilter.Q.value = 1.4;
    waterGain = ctx.createGain();
    waterGain.gain.value = 0.14;
    waterSrc.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(master);
    waterSrc.start();

    // Ocean surf & deep underwater hydrophone rumble
    const surfSrc = ctx.createBufferSource();
    surfSrc.buffer = noiseBuf;
    surfSrc.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 240;
    surfGain = ctx.createGain();
    surfGain.gain.value = 0.01;
    surfSrc.connect(surfFilter);
    surfFilter.connect(surfGain);
    surfGain.connect(master);
    surfSrc.start();

    // Fire crackle / volcanic rumble
    const fireSrc = ctx.createBufferSource();
    fireSrc.buffer = noiseBuf;
    fireSrc.loop = true;
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'bandpass';
    fireFilter.frequency.value = 1200;
    fireFilter.Q.value = 0.8;
    fireGain = ctx.createGain();
    fireGain.gain.value = 0.001;
    fireSrc.connect(fireFilter);
    fireFilter.connect(fireGain);
    fireGain.connect(master);
    fireSrc.start();

    // Rain pattering
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuf;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1600;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0.001;
    rainSrc.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();

    // Cicada / insect drone
    const cicadaSrc = ctx.createBufferSource();
    cicadaSrc.buffer = noiseBuf;
    cicadaSrc.loop = true;
    const cicadaFilter = ctx.createBiquadFilter();
    cicadaFilter.type = 'bandpass';
    cicadaFilter.frequency.value = 4200;
    cicadaFilter.Q.value = 5.5;
    cicadaGain = ctx.createGain();
    cicadaGain.gain.value = 0.04;
    cicadaSrc.connect(cicadaFilter);
    cicadaFilter.connect(cicadaGain);
    cicadaGain.connect(master);
    cicadaSrc.start();

    // High-altitude / deep-space cosmic harmonic drone
    const spaceOsc = ctx.createOscillator();
    spaceOsc.type = 'sine';
    spaceOsc.frequency.value = 64;
    spaceDroneGain = ctx.createGain();
    spaceDroneGain.gain.value = 0.0001;
    spaceOsc.connect(spaceDroneGain);
    spaceDroneGain.connect(master);
    spaceOsc.start();

    running = true;
    muted = false;
    return true;
  };

  return {
    get running() {
      return running && !muted;
    },
    get muted() {
      return muted;
    },
    init() {
      return ensureInitialized();
    },
    setVolumes(newVols = {}) {
      if (typeof newVols.master === 'number') vols.master = newVols.master;
      if (typeof newVols.ambient === 'number') vols.ambient = newVols.ambient;
      if (typeof newVols.wildlife === 'number') vols.wildlife = newVols.wildlife;
      if (typeof newVols.water === 'number') vols.water = newVols.water;
      if (typeof newVols.weather === 'number') vols.weather = newVols.weather;
      if (ctx && master && !muted) {
        master.gain.setTargetAtTime(0.24 * vols.master, ctx.currentTime, 0.1);
      }
    },
    toggle() {
      if (!ctx) {
        ensureInitialized();
        return false; // not muted
      }
      if (ctx.state === 'suspended') ctx.resume();
      muted = !muted;
      master.gain.setTargetAtTime(muted ? 0.0 : 0.24 * vols.master, ctx.currentTime, 0.15);
      return muted;
    },
    callSpecies(speciesId = 24) {
      if (!ctx) ensureInitialized();
      if (!ctx || muted) return;
      if (speciesId === 31 || speciesId === 32) {
        triggerWhaleSong();
      } else if (speciesId >= 4 && speciesId <= 10 || speciesId === 35) {
        triggerBirdCall(speciesId === 35 ? 12 : 2, 0);
      } else if (speciesId === 16 || speciesId === 17) {
        triggerFrogCroak();
      } else {
        triggerApexCall(speciesId === 26 ? 8 : 6);
      }
    },
    update(dt, env) {
      if (!ctx || !running || muted) return;
      const now = ctx.currentTime;
      const wind = env.windStrength ?? 0.5;
      const rain = env.rainIntensity ?? 0.0;
      const sunEl = env.sunEl ?? 0.35;
      const camY = env.camY ?? 2.0;
      const biomeId = env.biomeId ?? 0;
      const isUnderwater = env.isUnderwater ?? (camY < -0.05 ? 1 : 0);

      // Atmospheric thinning with altitude (above 140m air thins into stratospheric/exospheric silence)
      const atmoDensity = Math.max(0.0, Math.min(1.0, 1.0 - Math.max(0, camY - 140) / 620));
      const spaceFactor = 1.0 - atmoDensity;

      if (windFilter && windGain) {
        windFilter.frequency.setTargetAtTime(isUnderwater > 0.5 ? 160 : 280 + wind * 360, now, 0.2);
        windGain.gain.setTargetAtTime((isUnderwater > 0.5 ? 0.03 : 0.08 + wind * 0.22) * vols.ambient * atmoDensity, now, 0.2);
      }
      if (waterGain) {
        const nearWater = Math.max(0.04, Math.min(0.32, 0.28 / (1 + Math.max(0, camY) * 0.22)));
        waterGain.gain.setTargetAtTime(nearWater * vols.water * atmoDensity, now, 0.2);
      }
      if (surfGain) {
        const isMarine = biomeId >= 9 && biomeId <= 13;
        const surfWave = 0.5 + 0.5 * Math.sin(now * 0.65);
        const targetSurf = isUnderwater > 0.5 ? 0.28 : isMarine ? 0.12 + surfWave * 0.16 : 0.01;
        surfGain.gain.setTargetAtTime(targetSurf * vols.water * atmoDensity, now, 0.25);
      }
      if (fireGain) {
        const isFireZone = biomeId === 14 || biomeId === 15;
        fireGain.gain.setTargetAtTime((isFireZone ? 0.22 : 0.001) * vols.ambient * atmoDensity, now, 0.25);
      }
      if (rainGain) {
        rainGain.gain.setTargetAtTime((0.002 + rain * 0.26) * vols.weather * atmoDensity, now, 0.2);
      }
      if (cicadaGain) {
        const isWarmJungle = biomeId <= 8 || biomeId === 16;
        const nightBoost = sunEl < 0.18 ? 0.085 : 0.035;
        cicadaGain.gain.setTargetAtTime((isWarmJungle && isUnderwater < 0.5 ? nightBoost : 0.002) * vols.wildlife * atmoDensity, now, 0.4);
      }
      if (spaceDroneGain) {
        spaceDroneGain.gain.setTargetAtTime(spaceFactor * 0.075 * vols.ambient, now, 0.3);
      }

      if (atmoDensity > 0.25) {
        birdTimer -= dt;
        if (birdTimer <= 0) {
          if (sunEl > -0.05 && isUnderwater < 0.5 && biomeId !== 14 && biomeId !== 15) {
            triggerBirdCall(biomeId, isUnderwater);
          }
          birdTimer = 1.8 + Math.random() * 4.2;
        }

        frogTimer -= dt;
        if (frogTimer <= 0) {
          if ((biomeId === 0 || biomeId === 1 || biomeId === 3 || sunEl < 0.25) && isUnderwater < 0.5) {
            triggerFrogCroak();
          }
          frogTimer = 1.6 + Math.random() * 3.8;
        }

        whaleTimer -= dt;
        if (whaleTimer <= 0) {
          if (isUnderwater > 0.5 || (biomeId >= 10 && biomeId <= 13)) {
            triggerWhaleSong();
          }
          whaleTimer = 4.5 + Math.random() * 6.5;
        }

        roarTimer -= dt;
        if (roarTimer <= 0) {
          if ((biomeId === 6 || biomeId === 7 || biomeId === 8) && isUnderwater < 0.5) {
            triggerApexCall(biomeId);
          }
          roarTimer = 7.0 + Math.random() * 9.0;
        }
      }
    }
  };
};

const sharedBioAudio = createBioAudio();

export const initAudio = () => sharedBioAudio.init();
export const toggleMute = () => sharedBioAudio.toggle();
export const setVolume = (v) => sharedBioAudio.setVolumes({ master: v });
export const setAudioSettings = (settings) => sharedBioAudio.setVolumes({
  master: settings.masterVolume,
  ambient: settings.ambientVolume,
  wildlife: settings.wildlifeVolume,
  water: settings.waterVolume,
  weather: settings.weatherVolume
});
export const triggerSpeciesCall = (speciesId) => sharedBioAudio.callSpecies(speciesId);
export const updateAudio = (camX, camY, camZ, weatherIdx = 0, fireStr = 0, windStr = 0.45, biomeId = 0) => {
  const rain = weatherIdx === 2 || weatherIdx === 5 ? 0.95 : weatherIdx === 1 ? 0.1 : 0.0;
  sharedBioAudio.update(0.016, {
    windStrength: windStr,
    rainIntensity: rain,
    sunEl: weatherIdx === 6 ? 0.05 : 0.4,
    camY,
    biomeId: fireStr > 0.8 ? 14 : biomeId,
    isUnderwater: camY < -0.05 ? 1 : 0
  });
};
