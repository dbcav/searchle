/*
 * A small Gaussian process for the Bayesian-optimisation opponent.
 *
 * Squared-exponential kernel  k(x, x') = s2 * exp(-|x - x'|^2 / (2 l^2)),
 * heights standardised to mean 0 / sd 1, a tiny nugget for stability.
 * The length scale l is picked by maximising the marginal likelihood over a
 * grid, with the signal variance s2 profiled out in closed form:
 *   s2_hat = z^T R^{-1} z / n,   log L = -n/2 log s2_hat - sum_i log L_ii + const.
 * With at most ~80 points everything is a dense Cholesky.
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});
  const LENGTHS = [0.03, 0.045, 0.065, 0.09, 0.13, 0.18, 0.25, 0.35];

  function cholesky(K, n) {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = K[i * n + j];
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (!(s > 0)) return null; L[i * n + i] = Math.sqrt(s); }
        else L[i * n + j] = s / L[j * n + j];
      }
    }
    return L;
  }
  function solveLower(L, n, b) { // L x = b
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; }
    return x;
  }
  function solveUpper(L, n, b) { // L^T x = b
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    return x;
  }

  class GP {
    /**
     * @param {{x:number,y:number}[]} pts
     * @param {number[]} vals
     * @param {{length?:number}} [opts] fix the length scale instead of fitting it
     */
    constructor(pts, vals, opts) {
      opts = opts || {};
      const n = pts.length;
      this.px = Float64Array.from(pts, (p) => p.x); this.py = Float64Array.from(pts, (p) => p.y);
      let mu = 0; for (const v of vals) mu += v; mu /= n;
      let sd = 0; for (const v of vals) sd += (v - mu) ** 2; sd = Math.sqrt(sd / n) || 1;
      this.mu = opts.mu != null ? opts.mu : mu; this.sd = opts.sd != null ? opts.sd : sd;
      this.z = Float64Array.from(vals, (v) => (v - this.mu) / this.sd);
      this.nugget = 1e-6;
      if (opts.length) { this.factor(opts.length); if (opts.s2) this.s2 = opts.s2; }
      else {
        let best = null;
        for (const l of LENGTHS) {
          if (!this.factor(l)) continue;
          let logdet = 0; for (let i = 0; i < n; i++) logdet += Math.log(this.L[i * n + i]);
          const lml = -0.5 * n * Math.log(Math.max(this.s2, 1e-12)) - logdet;
          if (!best || lml > best.lml) best = { l, lml };
        }
        this.factor(best ? best.l : 0.15);
      }
    }

    /** build the correlation matrix for length l and factor it (raising the nugget if needed) */
    factor(l) {
      const n = this.px.length, K = new Float64Array(n * n), c = 1 / (2 * l * l);
      for (let nug = this.nugget; nug < 1e-1; nug *= 10) {
        for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
          const d2 = (this.px[i] - this.px[j]) ** 2 + (this.py[i] - this.py[j]) ** 2;
          const k = Math.exp(-d2 * c) + (i === j ? nug : 0);
          K[i * n + j] = k; K[j * n + i] = k;
        }
        const L = cholesky(K, n);
        if (L) {
          this.L = L; this.l = l; this.c = c; this.nug = nug;
          this.alpha = solveUpper(L, n, solveLower(L, n, this.z));
          let q = 0; for (let i = 0; i < n; i++) q += this.z[i] * this.alpha[i];
          this.s2 = Math.max(q / n, 1e-6);
          return true;
        }
      }
      return false;
    }

    /** posterior mean and standard deviation in standardised units */
    predictZ(x, y) {
      const n = this.px.length, k = new Float64Array(n);
      let m = 0;
      for (let i = 0; i < n; i++) { k[i] = Math.exp(-((x - this.px[i]) ** 2 + (y - this.py[i]) ** 2) * this.c); m += k[i] * this.alpha[i]; }
      const v = solveLower(this.L, n, k);
      let q = 0; for (let i = 0; i < n; i++) q += v[i] * v[i];
      return { m, s: Math.sqrt(Math.max(this.s2 * (1 - q), 1e-12)) };
    }

    /** posterior mean and sd on the 0..100 height scale */
    predict(x, y) { const r = this.predictZ(x, y); return { mean: this.mu + this.sd * r.m, sd: this.sd * r.s }; }

    /**
     * Kriging believer: pretend we observed the posterior mean at (x, y) and
     * condition on it, keeping the length scale and variance. The new model's
     * uncertainty collapses around (x, y), so the next pick in a batch goes elsewhere.
     */
    believe(x, y) {
      const pts = [], vals = [];
      for (let i = 0; i < this.px.length; i++) { pts.push({ x: this.px[i], y: this.py[i] }); vals.push(this.mu + this.sd * this.z[i]); }
      pts.push({ x, y }); vals.push(this.predict(x, y).mean);
      return new GP(pts, vals, { length: this.l, s2: this.s2, mu: this.mu, sd: this.sd });
    }
  }

  VC.GP = GP;
})(typeof window !== "undefined" ? window : globalThis);
