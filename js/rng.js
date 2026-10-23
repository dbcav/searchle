/*
 * Seeded randomness, so a landscape and every opponent's choices can be
 * replayed exactly from one seed (the daily landscape, shared links, tests).
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});

  /** mulberry32: small, fast, good enough for games and Monte Carlo */
  VC.rng = function (seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  VC.gauss = function (rnd) {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };

  /** FNV-1a over the string form of the parts: hashSeed(123, "gp") */
  VC.hashSeed = function (...parts) {
    const s = parts.join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };

  function halton(i, base) {
    let f = 1, r = 0;
    while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
    return r;
  }

  /** n well-spread points: a randomly shifted Halton set, kept off the very edge */
  VC.spaceFilling = function (n, rnd, margin) {
    const m = margin == null ? 0.07 : margin, sx = rnd(), sy = rnd(), out = [];
    for (let i = 1; i <= n; i++) {
      const u = (halton(i, 2) + sx) % 1, v = (halton(i, 3) + sy) % 1;
      out.push({ x: m + (1 - 2 * m) * u, y: m + (1 - 2 * m) * v });
    }
    return out;
  };

  VC.clamp01 = (v) => Math.min(0.995, Math.max(0.005, v));
  /** reflect into [0, 1] (for moving searchers that would leave the square) */
  VC.reflect01 = function (v) {
    for (let k = 0; k < 4 && (v < 0 || v > 1); k++) v = v < 0 ? -v : 2 - v;
    return VC.clamp01(v);
  };
})(typeof window !== "undefined" ? window : globalThis);
