// ============================================================================
// Development & Benchmark Harness (included only in dev.html via --dev)
//   B = run 60-second benchmark at locked resolution & report avg/p99/max frame + GPU times
//   (F fly-through across all 7 ecosystems is built into main.js)
// ============================================================================
{
  const LOGN = 1 << 16;
  const logFrame = new Float32Array(LOGN);
  const logGpu = new Float32Array(LOGN);
  let bench = false, last = 0, nFrame = 0, nGpu = 0;

  const stop = () => {
    bench = false;
    window.__flyOverride = undefined;
    dynT = 0;
  };

  const report = () => {
    const stats = (arr, n) => {
      const s = Array.from(arr.subarray(0, n)).sort((a, b) => a - b);
      let sum = 0;
      for (const v of s) sum += v;
      return {
        n,
        avg: sum / n,
        p99: s[min(n - 1, floor(n * 0.99))],
        max: s[n - 1]
      };
    };
    const fmt = (o) => `avg ${o.avg.toFixed(2)} ms · p99 ${o.p99.toFixed(2)} ms · max ${o.max.toFixed(2)} ms`;
    const f = stats(logFrame, nFrame);
    const fps = (1000 / max(0.01, f.avg)).toFixed(1);
    const msg = `Benchmark ${W}×${H} (${f.n} frames, ${fps} fps)\nFrame: ${fmt(f)}\nGPU:   ${nGpu ? fmt(stats(logGpu, nGpu)) : 'timestamp-query unavailable'}`;
    infoEl.textContent = msg;
    console.log('[BENCHMARK]\n' + msg);
  };

  const baseRender = render;
  render = (dtStep = 0.016) => {
    if (bench) {
      const now = performance.now();
      const dtr = now - last;
      last = now;
      F[FLT] += min(dtr / 1000, 0.1);
      flyAt(F[FLT]);
      if (nFrame < LOGN) logFrame[nFrame++] = dtr;
      if (gpuMs > 0 && nGpu < LOGN) logGpu[nGpu++] = gpuMs;
      if (F[FLT] >= FLY_DURATION) {
        report();
        stop();
      }
    }
    baseRender(dtStep);
  };

  addEventListener('keydown', (e) => {
    if (menu || e.repeat) return;
    if (e.code === 'KeyB') {
      if (bench) {
        stop();
      } else {
        bench = true;
        flyActive = false;
        window.__flyOverride = true;
        F[FLT] = 0;
        last = performance.now();
        nFrame = 0;
        nGpu = 0;
        showHud = false;
        infoEl.textContent = 'Running 60s benchmark…';
        dynT = -Infinity;
      }
    } else if (/Digit[1-7]/.test(e.code) || e.code === 'KeyF') {
      stop();
    }
  });
}
