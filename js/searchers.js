/*
 * The five opponents. Each one plays by the same rules as you: every turn it
 * places B points, learns the height at each, and never sees anyone else's
 * points. They differ in how much the B searchers share with each other:
 *
 *   random     nothing, not even memory
 *   climbers   B independent hill climbers: memory, no communication
 *   swarm      particle swarm: every particle knows the best point found so far
 *   voronoi    a shared map of who has searched where (the Voronoi diagram)
 *   gp         a shared statistical model of the whole landscape
 *
 * Interface: propose(round) -> [{x, y}] (B points), observe(points, heights).
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});

  class Base {
    constructor(rnd, opts) {
      this.rnd = rnd; this.B = opts.batch; this.R = opts.rounds; this.X = []; this.V = [];
      this.disc = VC.SONAR ? VC.SONAR[opts.difficulty] || 0.03 : 0.03; // sonar radius (used only in sonar mode)
    }
    /**
     * pts: where it searched; vals: the score of each search (the height, or in
     * sonar mode the highest point in the disc); info (sonar only): per search
     * { at, samples } with the disc's highest point and its 19 sampled heights.
     * X / V collect every height learned.
     */
    observe(pts, vals, info) {
      if (info) this.sonar = true;
      for (let i = 0; i < pts.length; i++) {
        if (!info) { this.X.push(pts[i]); this.V.push(vals[i]); continue; }
        for (const q of info[i].samples) { this.X.push({ x: q.x, y: q.y }); this.V.push(q.v); }
        this.X.push(info[i].at); this.V.push(vals[i]);
      }
    }
    /** where search i ended up best: the point itself, or the top of its disc */
    static top(pts, info, i) { return info ? info[i].at : pts[i]; }
    uniform() { return { x: VC.clamp01(this.rnd()), y: VC.clamp01(this.rnd()) }; }
  }

  /* ---------- 1. random ---------- */
  class RandomSearch extends Base {
    propose() { return Array.from({ length: this.B }, () => this.uniform()); }
  }

  /* ---------- 2. independent hill climbers, (1+1)-ES with step-size adaptation ---------- */
  class Climbers extends Base {
    propose(round) {
      if (round === 0) {
        this.walkers = VC.spaceFilling(this.B, this.rnd, 0.1).map((p) => ({ x: p.x, y: p.y, v: -1, step: 0.14 }));
        this.trial = this.walkers.map((w) => ({ x: w.x, y: w.y }));
        return this.trial;
      }
      this.trial = this.walkers.map((w) => {
        if (w.step < 0.008) { const p = this.uniform(); w.x = p.x; w.y = p.y; w.v = -1; w.step = 0.14; return p; } // restart
        return { x: VC.reflect01(w.x + w.step * VC.gauss(this.rnd)), y: VC.reflect01(w.y + w.step * VC.gauss(this.rnd)) };
      });
      return this.trial;
    }
    observe(pts, vals, info) {
      super.observe(pts, vals, info);
      this.walkers.forEach((w, i) => {
        const t = Base.top(pts, info, i);
        if (vals[i] > w.v) { if (w.v >= 0) w.step *= 1.3; w.x = t.x; w.y = t.y; w.v = vals[i]; }
        else w.step *= 0.7;
      });
    }
  }

  /* ---------- 3. particle swarm (constriction coefficients, Clerc & Kennedy) ---------- */
  class Swarm extends Base {
    propose(round) {
      const r = this.rnd;
      if (round === 0) {
        this.parts = VC.spaceFilling(this.B, r, 0.08).map((p) => ({
          x: p.x, y: p.y, vx: 0.1 * (r() - 0.5), vy: 0.1 * (r() - 0.5), bx: p.x, by: p.y, bv: -1,
        }));
      } else {
        const w = 0.729, c = 1.494, vmax = 0.22, g = this.gbest;
        for (const p of this.parts) {
          p.vx = w * p.vx + c * r() * (p.bx - p.x) + c * r() * (g.x - p.x);
          p.vy = w * p.vy + c * r() * (p.by - p.y) + c * r() * (g.y - p.y);
          const s = Math.hypot(p.vx, p.vy); if (s > vmax) { p.vx *= vmax / s; p.vy *= vmax / s; }
          const nx = p.x + p.vx, ny = p.y + p.vy;
          if (nx < 0 || nx > 1) p.vx *= -0.5;
          if (ny < 0 || ny > 1) p.vy *= -0.5;
          p.x = VC.reflect01(nx); p.y = VC.reflect01(ny);
        }
      }
      return this.parts.map((p) => ({ x: p.x, y: p.y }));
    }
    observe(pts, vals, info) {
      super.observe(pts, vals, info);
      this.parts.forEach((p, i) => { const t = Base.top(pts, info, i); if (vals[i] > p.bv) { p.bv = vals[i]; p.bx = t.x; p.by = t.y; } });
      let b = this.parts[0];
      for (const p of this.parts) if (p.bv > b.bv) b = p;
      if (!this.gbest || b.bv > this.gbest.v) this.gbest = { x: b.bx, y: b.by, v: b.bv };
    }
  }

  /* ---------- 4. Voronoi explorer ---------- */
  /*
   * Candidates are the vertices of the Voronoi diagram of everything searched so
   * far. A vertex is the centre of an empty circle touching 2-3 searched points,
   * so its radius r says how unexplored the spot is and its neighbours' heights
   * say how promising it is. Score = promise + beta * r / r_max, with beta
   * shrinking each turn (explore early, exploit late). A batch is picked
   * greedily: each pick is added as a placeholder site so the next one goes
   * to a different empty circle.
   */
  class VoronoiExplorer extends Base {
    propose(round) {
      if (round === 0) return VC.spaceFilling(this.B, this.rnd);
      const xs = this.X.map((p) => p.x), ys = this.X.map((p) => p.y);
      let lo = Infinity, hi = -Infinity; for (const v of this.V) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const vals = this.V.map((v) => (v - lo) / (hi - lo || 1));
      const frac = (round - 1) / Math.max(1, this.R - 2); // 0 on turn 2 ... 1 on the last turn
      const beta = round === this.R - 1 ? 0.05 : 0.9 - 0.75 * frac;
      const out = [];
      for (let b = 0; b < this.B; b++) {
        const n = xs.length;
        const vor = VC.voronoi(Float64Array.from(xs), Float64Array.from(ys), n, { x0: 0, y0: 0, x1: 1, y1: 1 });
        const verts = new Map();
        for (let i = 0; i < n; i++) {
          const poly = vor.polys[i];
          for (let k = 0; k < poly.length; k += 2) {
            const x = poly[k], y = poly[k + 1], key = Math.round(x * 1e6) + "," + Math.round(y * 1e6);
            let q = verts.get(key);
            if (!q) { q = { x, y, r: Infinity, sum: 0, cnt: 0, max: 0 }; verts.set(key, q); }
            q.r = Math.min(q.r, Math.hypot(x - xs[i], y - ys[i]));
            q.sum += vals[i]; q.cnt++; q.max = Math.max(q.max, vals[i]);
          }
        }
        let rmax = 0; for (const q of verts.values()) rmax = Math.max(rmax, q.r);
        let best = null, bs = -Infinity;
        for (const q of verts.values()) {
          if (q.r < (this.sonar ? 0.6 * this.disc : 0.004)) continue; // sonar: skip spots a disc already shows
          const promise = 0.6 * q.max + 0.4 * (q.sum / q.cnt);
          const s = promise + beta * (q.r / rmax);
          if (s > bs) { bs = s; best = q; }
        }
        if (!best) best = { ...this.uniform(), sum: 0, cnt: 1, max: 0 };
        const pick = { x: VC.clamp01(best.x), y: VC.clamp01(best.y) };
        out.push(pick);
        xs.push(pick.x); ys.push(pick.y); vals.push(0.6 * best.max + 0.4 * (best.sum / best.cnt));
      }
      return out;
    }
  }

  /* ---------- 5. batch Bayesian optimisation: GP-UCB with a kriging believer ---------- */
  class BayesOpt extends Base {
    observe(pts, vals, info) {
      super.observe(pts, vals, info);
      this.GX = this.GX || []; this.GV = this.GV || [];
      // sonar: keep the centre, the disc's top and a few rim samples (about 260 points over a whole game)
      const per = info ? Math.max(2, Math.min(8, Math.floor(260 / (this.B * this.R)))) : 1;
      for (let i = 0; i < pts.length; i++) {
        if (!info) { this.GX.push(pts[i]); this.GV.push(vals[i]); continue; }
        const S = info[i].samples, pick = [S[0]], rim = S.slice(7);
        for (let k = 0; k < per - 2 && rim.length; k++) pick.push(rim[Math.floor((k * rim.length) / (per - 2))]);
        for (const q of pick) { this.GX.push({ x: q.x, y: q.y }); this.GV.push(q.v); }
        this.GX.push(info[i].at); this.GV.push(vals[i]);
      }
    }
    propose(round) {
      if (round === 0) return VC.spaceFilling(this.B, this.rnd);
      let gp = new VC.GP(this.GX, this.GV);
      this.lastLength = gp.l;
      const last = round === this.R - 1;
      const kappa = last ? 0.5 : 2.0; // only the best point counts, so the last turn mostly exploits
      const cand = this.candidates();
      const out = [];
      for (let b = 0; b < this.B; b++) {
        let best = null, bs = -Infinity;
        for (const c of cand) {
          const r = gp.predictZ(c.x, c.y), s = r.m + kappa * r.s;
          if (s > bs) { bs = s; best = c; }
        }
        out.push(best);
        if (b < this.B - 1) gp = gp.believe(best.x, best.y);
      }
      return out;
    }
    candidates() {
      const r = this.rnd, out = [], G = this.sonar ? 26 : 36, ox = r() / G, oy = r() / G;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) out.push({ x: VC.clamp01(i / G + ox), y: VC.clamp01(j / G + oy) });
      const X = this.GX, V = this.GV, order = V.map((v, i) => i).sort((a, b) => V[b] - V[a]).slice(0, 5);
      const scales = this.sonar ? [0.1, 0.05] : [0.06, 0.025, 0.01]; // a disc already covers the fine scales
      for (const i of order) for (const s of scales) for (let k = 0; k < 20; k++) {
        out.push({ x: VC.reflect01(X[i].x + s * VC.gauss(r)), y: VC.reflect01(X[i].y + s * VC.gauss(r)) });
      }
      return out;
    }
  }

  // fixed order = fixed colour slot for each opponent
  VC.SEARCHERS = [
    { id: "gp", name: "Bayesian optimization", short: "Bayes opt", cls: BayesOpt, shares: "a statistical model of the whole landscape" },
    { id: "voronoi", name: "Voronoi explorer", short: "Voronoi", cls: VoronoiExplorer, shares: "a map of where everyone has searched" },
    { id: "swarm", name: "Particle swarm", short: "Swarm", cls: Swarm, shares: "the best point found so far" },
    { id: "climbers", name: "Hill climbers", short: "Climbers", cls: Climbers, shares: "nothing (each climbs alone)" },
    { id: "random", name: "Random search", short: "Random", cls: RandomSearch, shares: "nothing, not even memory" },
  ];
})(typeof window !== "undefined" ? window : globalThis);
