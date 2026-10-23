/*
 * The hidden landscapes. Each family is a generator that returns raw(x, y);
 * every landscape is then rescaled so its lowest point is 0 and its peak is
 * exactly 100. Families are built to trap different searchers:
 *
 *   hills     one narrow peak, decoy hills and a broad lure       (the original)
 *   ridge     a winding crest that climbs slowly to the peak      (curved, anisotropic)
 *   craters   the high ground is a ring; the peak is a notch      (exploiting the middle is wrong)
 *   terraces  hills cut into flat steps                           (no slope to follow)
 *   crystal   Worley cellular noise: a faceted pyramid per cell   (sharp, non-smooth)
 *   mesa      a big flat plateau and a tiny needle elsewhere      (exploration vs exploitation)
 *   ackley    the classic test function, rotated and shifted      (egg-crate on a funnel)
 *   mix       a random linear combination of two or three of the above
 *
 * Components are merged with a smooth maximum, (1/k) log sum exp(k f_i), not a
 * sum, so decoys can't pile up into something taller than the intended peak.
 * Difficulty is a dial s = 0 (easy), 0.5 (medium), 1 (hard) that each family
 * reads in its own way (narrower peaks, more decoys, taller traps).
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});

  VC.DIFFICULTY = {
    easy:   { label: "Easy",   s: 0,   decoys: 4,  decoyH: [0.2, 0.5],  decoyW: [0.07, 0.15], peakW: [0.08, 0.11],  lure: 0, lureH: [0, 0],       lureW: [0, 0] },
    medium: { label: "Medium", s: 0.5, decoys: 7,  decoyH: [0.15, 0.45], decoyW: [0.05, 0.12], peakW: [0.055, 0.075], lure: 1, lureH: [0.55, 0.65], lureW: [0.12, 0.16] },
    hard:   { label: "Hard",   s: 1,   decoys: 10, decoyH: [0.15, 0.45], decoyW: [0.04, 0.1],  peakW: [0.04, 0.05],   lure: 1, lureH: [0.62, 0.7],  lureW: [0.14, 0.18] },
  };

  VC.FAMILIES = [
    { id: "hills", label: "Hills", blurb: "one narrow peak among decoy hills, with a broad lure on medium and hard" },
    { id: "ridge", label: "Ridge", blurb: "a winding crest that climbs slowly to the peak at one end, next to a shorter, lower ridge" },
    { id: "craters", label: "Craters", blurb: "the high ground is a ring; the peak is one notch on the biggest rim, and the crater floor has a small central bump" },
    { id: "terraces", label: "Terraces", blurb: "hills cut into flat steps, so there is no slope to follow except at the edge of a step" },
    { id: "crystal", label: "Crystal", blurb: "Worley (cellular) noise: every cell of a hidden Voronoi diagram is a faceted pyramid with a sharp tip at its seed" },
    { id: "mesa", label: "Mesa", blurb: "a big flat plateau that is easy to find, and a tiny needle somewhere else" },
    { id: "ackley", label: "Ackley", blurb: "the classic optimization test function, rotated and shifted: an egg-crate of bumps on a funnel" },
  ];
  /** a weighted blend of two or three of the families above, renormalised to 0..100 */
  VC.MIX = { id: "mix", label: "Random mix", blurb: "a weighted blend of two or three of the other kinds, renormalised so the peak is 100" };
  VC.family = (id) => (id === "mix" ? VC.MIX : VC.FAMILIES.find((f) => f.id === id) || VC.FAMILIES[0]);
  /** the family a "surprise" game uses: a mix half the time, fixed by the seed so a shared link replays it */
  VC.pickFamily = (seed) => {
    const h = VC.hashSeed("family", seed);
    return h % 2 ? "mix" : VC.FAMILIES[(h >>> 1) % VC.FAMILIES.length].id;
  };

  const U = (rnd, a, b) => a + (b - a) * rnd();
  const lerp = (a, b, t) => a + (b - a) * t;
  const SMOOTH = 16;

  /* ---------- shared pieces ---------- */
  function hill(rnd, cx, cy, h, w) {
    // anisotropic: two widths w, w * aspect, rotated by theta
    const aspect = U(rnd, 1, 1.8), th = U(rnd, 0, Math.PI);
    const c = Math.cos(th), s = Math.sin(th), a = 1 / (2 * w * w), b = 1 / (2 * (w * aspect) ** 2);
    return { cx, cy, h, A: a * c * c + b * s * s, B: (a - b) * c * s, C: a * s * s + b * c * c };
  }
  const hillAt = (H, x, y) => { const dx = x - H.cx, dy = y - H.cy; return H.h * Math.exp(-(H.A * dx * dx + 2 * H.B * dx * dy + H.C * dy * dy)); };
  /** small background bumps, kept a distance away from points to avoid */
  function bumps(rnd, n, hr, wr, avoid) {
    const out = [];
    for (let k = 0; k < n; k++) {
      let x, y, tries = 0;
      do { x = U(rnd, 0.04, 0.96); y = U(rnd, 0.04, 0.96); tries++; } while (tries < 50 && avoid.some((a) => Math.hypot(x - a.x, y - a.y) < a.r));
      out.push(hill(rnd, x, y, U(rnd, ...hr), U(rnd, ...wr)));
    }
    return out;
  }
  function waves(rnd, a) {
    const out = [];
    for (let k = 0; k < 3; k++) out.push({ kx: Math.floor(U(rnd, 1, 3)), ky: Math.floor(U(rnd, 1, 3)) * (rnd() < 0.5 ? -1 : 1), ph: U(rnd, 0, 2 * Math.PI), a });
    return out;
  }
  const waveAt = (W, x, y) => { let f = 0; for (const w of W) f += w.a * Math.sin(2 * Math.PI * (w.kx * x + w.ky * y) + w.ph); return f; };
  /** smooth max of the values pushed so far */
  class SoftMax { constructor() { this.s = 0; } add(v) { this.s += Math.exp(SMOOTH * v); } get value() { return Math.log(this.s) / SMOOTH; } }

  /* ---------- families: (rnd, cfg) -> raw(x, y) ---------- */
  const GEN = {};

  GEN.hills = function (rnd, cfg) {
    const hills = [], peak = { x: U(rnd, 0.1, 0.9), y: U(rnd, 0.1, 0.9) };
    hills.push(hill(rnd, peak.x, peak.y, 1, U(rnd, ...cfg.peakW)));
    const far = (x, y, d) => Math.hypot(x - peak.x, y - peak.y) > d;
    for (let k = 0; k < cfg.lure; k++) {
      let x, y; do { x = U(rnd, 0.15, 0.85); y = U(rnd, 0.15, 0.85); } while (!far(x, y, 0.35));
      hills.push(hill(rnd, x, y, U(rnd, ...cfg.lureH), U(rnd, ...cfg.lureW)));
    }
    for (let k = 0; k < cfg.decoys; k++) {
      let x, y; do { x = U(rnd, 0.04, 0.96); y = U(rnd, 0.04, 0.96); } while (!far(x, y, 0.18));
      hills.push(hill(rnd, x, y, U(rnd, ...cfg.decoyH), U(rnd, ...cfg.decoyW)));
    }
    const W = waves(rnd, 0.025);
    return (x, y) => { const m = new SoftMax(); for (const H of hills) m.add(hillAt(H, x, y)); return m.value + waveAt(W, x, y); };
  };

  /** a smooth curve from S to E that wiggles sideways, sampled at n points */
  function curve(rnd, minLen, n) {
    for (let tries = 0; tries < 200; tries++) {
      const S = { x: U(rnd, 0.12, 0.88), y: U(rnd, 0.12, 0.88) }, E = { x: U(rnd, 0.12, 0.88), y: U(rnd, 0.12, 0.88) };
      const L = Math.hypot(E.x - S.x, E.y - S.y);
      if (L < minLen) continue;
      const nx = -(E.y - S.y) / L, ny = (E.x - S.x) / L;
      const A = U(rnd, 0.08, 0.2) * (tries > 100 ? 0.5 : 1), k = 1 + Math.floor(U(rnd, 1, 3)), ph = U(rnd, -0.3, 0.3);
      const pts = [];
      let ok = true;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), off = A * Math.sin(Math.PI * k * t + ph * Math.sin(Math.PI * t)) + 0.03 * Math.sin(7 * t);
        const x = S.x + t * (E.x - S.x) + off * nx, y = S.y + t * (E.y - S.y) + off * ny;
        if (x < 0.05 || x > 0.95 || y < 0.05 || y > 0.95) { ok = false; break; }
        pts.push(x, y);
      }
      if (ok) return { pts: Float64Array.from(pts), end: E };
    }
    return null;
  }

  GEN.ridge = function (rnd, cfg) {
    const s = cfg.s, w = lerp(0.045, 0.024, s), inv = 1 / (2 * w * w), N = 180;
    const main = curve(rnd, 0.6, N);
    const ridges = [{ c: main, top: 1, base: 0.38 }];
    const second = curve(rnd, 0.3, N);
    if (second && Math.hypot(second.end.x - main.end.x, second.end.y - main.end.y) > 0.25) ridges.push({ c: second, top: lerp(0.55, 0.78, s), base: 0.25 });
    const B = bumps(rnd, 3 + Math.round(4 * s), [0.12, 0.4], [0.04, 0.09], [{ ...main.end, r: 0.15 }]);
    const W = waves(rnd, 0.02);
    return (x, y) => {
      const m = new SoftMax();
      for (const R of ridges) {
        // max over the samples of h(t) * exp(-d^2 / 2w^2): continuous, climbs along the crest
        const p = R.c.pts;
        let best = 0;
        for (let i = 0; i < N; i++) {
          const dx = x - p[2 * i], dy = y - p[2 * i + 1], d2 = dx * dx + dy * dy;
          if (d2 > 9 * w * w) continue;
          const t = i / (N - 1), v = (R.base + (R.top - R.base) * t ** 2.5) * Math.exp(-d2 * inv);
          if (v > best) best = v;
        }
        m.add(best);
      }
      for (const H of B) m.add(hillAt(H, x, y));
      return m.value + waveAt(W, x, y);
    };
  };

  GEN.craters = function (rnd, cfg) {
    const s = cfg.s, w = lerp(0.03, 0.018, s), p = lerp(4, 14, s), inv = 1 / (2 * w * w);
    const rings = [];
    const place = (R) => {
      for (let t = 0; t < 400; t++) {
        const x = U(rnd, R + 0.05, 0.95 - R), y = U(rnd, R + 0.05, 0.95 - R);
        if (rings.every((q) => Math.hypot(x - q.x, y - q.y) > R + q.R + 0.05)) return { x, y };
      }
      return null;
    };
    const R0 = U(rnd, 0.13, 0.2);
    rings.push({ ...place(R0), R: R0, h: 1, base: 0.7, th: U(rnd, 0, 2 * Math.PI) });
    const extra = 2 + Math.round(2 * s);
    for (let k = 0; k < extra; k++) {
      const R = U(rnd, 0.06, 0.13), c = place(R);
      if (c) rings.push({ ...c, R, h: U(rnd, 0.55, lerp(0.75, 0.88, s)), base: 0.7, th: U(rnd, 0, 2 * Math.PI) });
    }
    const B = bumps(rnd, 3, [0.1, 0.3], [0.03, 0.07], rings.map((q) => ({ x: q.x, y: q.y, r: q.R + 0.05 })));
    const W = waves(rnd, 0.02);
    return (x, y) => {
      const m = new SoftMax();
      for (const q of rings) {
        const dx = x - q.x, dy = y - q.y, rho = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        const notch = q.base + (1 - q.base) * ((1 + Math.cos(th - q.th)) / 2) ** p;
        m.add(q.h * notch * Math.exp(-((rho - q.R) ** 2) * inv));
        m.add(0.32 * q.h * Math.exp(-(rho * rho) / (2 * (0.22 * q.R) ** 2))); // central bump on the crater floor
      }
      for (const H of B) m.add(hillAt(H, x, y));
      return m.value + waveAt(W, x, y);
    };
  };

  GEN.terraces = function (rnd, cfg) {
    // broader hills than the hills family (terracing already makes them hard), then quantised
    const soft = { ...cfg, peakW: [0.08, 0.12], decoyW: [0.06, 0.15], lureW: [0.12, 0.17] };
    const g = GEN.hills(rnd, soft);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j <= 60; j++) for (let i = 0; i <= 60; i++) { const v = g(i / 60, j / 60); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const K = Math.round(lerp(6, 10, cfg.s)), P = 10;
    return (x, y) => {
      const t = (K * (g(x, y) - lo)) / (hi - lo), f = Math.floor(t);
      return (f + (t - f) ** P) / K; // flat treads, steep risers, monotone in g
    };
  };

  GEN.crystal = function (rnd, cfg) {
    const s = cfg.s, n = Math.round(lerp(14, 30, s)), r = 0.55 / Math.sqrt(n), sx = [], sy = [], h = [];
    for (let t = 0; sx.length < n && t < n * 200; t++) {
      const x = U(rnd, 0.03, 0.97), y = U(rnd, 0.03, 0.97);
      if (sx.every((_, i) => Math.hypot(x - sx[i], y - sy[i]) > r)) { sx.push(x); sy.push(y); h.push(U(rnd, 0.3, lerp(0.62, 0.85, s))); }
    }
    // the peak seed: an interior one
    let pk = 0, tries = 0;
    do { pk = Math.floor(rnd() * sx.length); tries++; } while (tries < 50 && (sx[pk] < 0.12 || sx[pk] > 0.88 || sy[pk] < 0.12 || sy[pk] > 0.88));
    h[pk] = 1;
    // height at a seed = h_i: divide F2 - F1 by its value at the seed (the nearest other seed)
    const m = sx.map((_, i) => { let d = Infinity; for (let j = 0; j < sx.length; j++) if (j !== i) d = Math.min(d, Math.hypot(sx[i] - sx[j], sy[i] - sy[j])); return d; });
    return (x, y) => {
      let d1 = Infinity, d2 = Infinity, i1 = 0;
      for (let i = 0; i < sx.length; i++) {
        const d = Math.hypot(x - sx[i], y - sy[i]);
        if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d;
      }
      return (h[i1] * (d2 - d1)) / m[i1]; // 0 on every Voronoi edge, h_i at seed i
    };
  };

  GEN.mesa = function (rnd, cfg) {
    const s = cfg.s, mesas = [];
    const R = U(rnd, 0.14, 0.2);
    mesas.push({ x: U(rnd, R + 0.06, 0.94 - R), y: U(rnd, R + 0.06, 0.94 - R), R, h: lerp(0.5, 0.66, s) });
    if (s > 0) {
      const R2 = U(rnd, 0.08, 0.12);
      for (let t = 0; t < 200; t++) {
        const x = U(rnd, R2 + 0.05, 0.95 - R2), y = U(rnd, R2 + 0.05, 0.95 - R2);
        if (Math.hypot(x - mesas[0].x, y - mesas[0].y) > R + R2 + 0.08) { mesas.push({ x, y, R: R2, h: 0.45 }); break; }
      }
    }
    let nx, ny, t = 0;
    do { nx = U(rnd, 0.08, 0.92); ny = U(rnd, 0.08, 0.92); t++; } while (t < 500 && mesas.some((q) => Math.hypot(nx - q.x, ny - q.y) < q.R + 0.15));
    const needle = hill(rnd, nx, ny, 1, lerp(0.06, 0.036, s));
    const B = bumps(rnd, 4 + Math.round(3 * s), [0.1, 0.35], [0.035, 0.08], [{ x: nx, y: ny, r: 0.12 }]);
    const W = waves(rnd, 0.015);
    return (x, y) => {
      const m = new SoftMax();
      for (const q of mesas) {
        const rho = Math.hypot(x - q.x, y - q.y);
        m.add((q.h * (1 + 0.03 * (1 - rho / q.R))) / (1 + Math.exp((rho - q.R) / 0.012))); // near-flat top, cliff edge
      }
      m.add(hillAt(needle, x, y));
      for (const H of B) m.add(hillAt(H, x, y));
      return m.value + waveAt(W, x, y);
    };
  };

  /*
   * mix: a linear combination sum_i w_i * f_i, where each f_i is one of the
   * families above rescaled to [0, 1] (on a coarse grid; the blend is then
   * rescaled exactly like any other landscape). Weights are random; Ackley's is
   * halved because its egg-crate otherwise swamps everything else.
   */
  GEN.mix = function (rnd, cfg, ctx) {
    const pool = VC.FAMILIES.map((f) => f.id), n = rnd() < lerp(0.15, 0.4, cfg.s) ? 3 : 2, ids = [];
    while (ids.length < n) { const id = pool[Math.floor(rnd() * pool.length)]; if (!ids.includes(id)) ids.push(id); }
    const w = ids.map((id) => U(rnd, 0.35, 1) * (id === "ackley" ? 0.5 : 1)), W = w.reduce((a, b) => a + b, 0);
    const parts = ids.map((id, k) => {
      const f = GEN[id](VC.rng(VC.hashSeed("mix", ctx.seed, ctx.difficulty, k, id)), cfg, ctx);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j <= 80; j++) for (let i = 0; i <= 80; i++) { const v = f(i / 80, j / 80); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return { id, w: w[k] / W, f, lo, s: 1 / (hi - lo || 1) };
    }).sort((a, b) => b.w - a.w);
    ctx.parts = parts.map((q) => ({ id: q.id, w: q.w }));
    return (x, y) => { let v = 0; for (const q of parts) v += q.w * (q.f(x, y) - q.lo) * q.s; return v; };
  };

  GEN.ackley = function (rnd, cfg) {
    const s = cfg.s, cx = U(rnd, 0.2, 0.8), cy = U(rnd, 0.2, 0.8), th = U(rnd, 0, Math.PI);
    const S = lerp(5, 9, s), asp = U(rnd, 1, 1.35), c = Math.cos(th), sn = Math.sin(th);
    return (x, y) => {
      const u = S * ((x - cx) * c - (y - cy) * sn), v = S * asp * ((x - cx) * sn + (y - cy) * c);
      return 20 * Math.exp(-0.2 * Math.sqrt(0.5 * (u * u + v * v))) + Math.exp(0.5 * (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v)));
    };
  };

  class Landscape {
    /** @param {number} seed @param {string} difficulty @param {string} [family] a family id, "random", or omitted for hills */
    constructor(seed, difficulty, family) {
      const cfg = VC.DIFFICULTY[difficulty] || VC.DIFFICULTY.medium;
      // no family = the original hills (old links); "random" = picked by the seed
      family = !family ? "hills" : family === "random" ? VC.pickFamily(seed) : family;
      if (!GEN[family]) family = "hills";
      // hills keeps its original seeding, so old links replay the same landscape
      const rnd = VC.rng(family === "hills" ? VC.hashSeed("land", seed, difficulty) : VC.hashSeed("land", seed, difficulty, family));
      this.seed = seed; this.difficulty = difficulty; this.family = family;
      const ctx = { seed, difficulty };
      this.raw = GEN[family](rnd, cfg, ctx);
      const F = VC.family(family);
      this.label = F.label; this.blurb = F.blurb;
      if (ctx.parts) { // a mix names its ingredients
        this.parts = ctx.parts;
        const name = (id) => VC.family(id).label;
        this.label = ctx.parts.map((q) => name(q.id)).join(" + ");
        this.blurb = "a blend of " + ctx.parts.map((q) => `${Math.round(100 * q.w)}% ${name(q.id).toLowerCase()}`).join(", ").replace(/, ([^,]*)$/, " and $1");
      }
      this.normalize();
    }

    /** shrinking pattern search from (x, y) on the raw function */
    polish(x, y) {
      let f = this.raw(x, y);
      for (let step = 1 / 200; step > 1e-7; ) {
        let moved = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = Math.min(1, Math.max(0, x + dx * step)), ny = Math.min(1, Math.max(0, y + dy * step));
          const g = this.raw(nx, ny);
          if (g > f) { f = g; x = nx; y = ny; moved = true; }
        }
        if (!moved) step *= 0.5;
      }
      return { x, y, f };
    }

    /**
     * Rescale so the grid minimum is 0 and the true maximum is 100. Also find
     * every other spot within half a point of the top (mixes can have several),
     * so the reveal can mark them all: this.peaks[0] is the maximum.
     */
    normalize() {
      const N = 200, W = N + 1, G = new Float64Array(W * W);
      let lo = Infinity, hiG = -Infinity, bi = 0;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const f = (G[j * W + i] = this.raw(i / N, j / N));
        if (f < lo) lo = f;
        if (f > hiG) { hiG = f; bi = j * W + i; }
      }
      const top = this.polish((bi % W) / N, Math.floor(bi / W) / N);
      const hi = top.f, peaks = [top], near = lo + 0.985 * (hi - lo);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const f = G[j * W + i];
        if (f < near) continue;
        let isMax = true;
        for (let dj = -1; dj <= 1 && isMax; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if ((di || dj) && a >= 0 && a <= N && b >= 0 && b <= N && G[b * W + a] > f) { isMax = false; break; }
        }
        if (!isMax) continue;
        const q = this.polish(i / N, j / N);
        if ((q.f - lo) / (hi - lo) >= 0.995 && peaks.every((p) => Math.hypot(p.x - q.x, p.y - q.y) > 0.03)) peaks.push(q);
      }
      this.lo = lo; this.hi = hi; this.peak = { x: top.x, y: top.y };
      this.peaks = peaks.map((q) => ({ x: q.x, y: q.y, v: (100 * (q.f - lo)) / (hi - lo) }));
    }

    /** height on the 0..100 scale (the grid minimum maps to 0) */
    value(x, y) {
      const v = (100 * (this.raw(x, y) - this.lo)) / (this.hi - this.lo);
      return Math.min(100, Math.max(0, v));
    }

    /** heights on an (N+1)^2 grid, row-major, for drawing; cached */
    grid(N) {
      if (this._grid && this._gridN === N) return this._grid;
      const g = new Float32Array((N + 1) * (N + 1));
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) g[j * (N + 1) + i] = this.value(i / N, j / N);
      this._grid = g; this._gridN = N;
      return g;
    }

    /** contour segments [x0,y0,x1,y1,...] at the given levels (marching squares) */
    contours(N, levels) {
      const g = this.grid(N), W = N + 1, out = [];
      const lerp2 = (a, b, va, vb, L) => a + ((L - va) / (vb - va)) * (b - a);
      for (const L of levels) {
        const seg = [];
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const a = g[j * W + i], b = g[j * W + i + 1], c = g[(j + 1) * W + i + 1], d = g[(j + 1) * W + i];
          const code = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0);
          if (code === 0 || code === 15) continue;
          const x = i / N, y = j / N, h = 1 / N;
          const top = [lerp2(x, x + h, a, b, L), y], right = [x + h, lerp2(y, y + h, b, c, L)];
          const bot = [lerp2(x, x + h, d, c, L), y + h], left = [x, lerp2(y, y + h, a, d, L)];
          const add = (p, q) => seg.push(p[0], p[1], q[0], q[1]);
          switch (code) {
            case 1: case 14: add(left, top); break;
            case 2: case 13: add(top, right); break;
            case 3: case 12: add(left, right); break;
            case 4: case 11: add(right, bot); break;
            case 6: case 9: add(top, bot); break;
            case 7: case 8: add(left, bot); break;
            case 5: add(left, top); add(right, bot); break;
            case 10: add(top, right); add(left, bot); break;
          }
        }
        out.push({ level: L, seg: Float32Array.from(seg) });
      }
      return out;
    }
  }

  VC.Landscape = Landscape;
})(typeof window !== "undefined" ? window : globalThis);
