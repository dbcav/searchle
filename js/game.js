/*
 * One game: a landscape, you, and the five opponents, played turn by turn.
 * Everything is seeded, so (seed, difficulty, family, batch, rounds, reveal) replays exactly,
 * including every opponent's choices.
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});

  class Game {
    /** @param {{seed:number, difficulty:string, family?:string, batch:number, rounds:number}} o */
    constructor(o) {
      this.o = { ...o };
      this.land = new VC.Landscape(o.seed, o.difficulty, o.family);
      this.family = this.land.family; // resolved when o.family is "random"
      this.round = 0;
      this.players = [{ id: "you", name: "You", short: "You", pts: [], hist: [], best: null }];
      for (const S of VC.SEARCHERS) {
        this.players.push({
          id: S.id, name: S.name, short: S.short, shares: S.shares, pts: [], hist: [], best: null,
          searcher: new S.cls(VC.rng(VC.hashSeed("opp", o.seed, o.difficulty, o.batch, o.rounds, ...(this.family === "hills" ? [] : [this.family]), ...(o.reveal === "circle" ? ["circle"] : []), S.id)), this.o),
        });
      }
    }

    get over() { return this.round >= this.o.rounds; }
    player(id) { return this.players.find((p) => p.id === id); }

    get sonar() { return this.o.reveal === "circle"; }
    get radius() { return VC.SONAR[this.o.difficulty] || 0.03; }

    /**
     * Sonar: what one query at q reveals. Everyone's score counts the highest
     * point in the disc (found by a fine polar scan plus a pattern search kept
     * inside the disc). Opponents learn 19 heights on a fixed polar pattern
     * (centre, 6 at r/2, 12 at r) plus where that highest point is; you see the
     * whole disc drawn on your board.
     */
    probe(q) {
      const R = this.radius, L = this.land, samples = [{ x: q.x, y: q.y, v: L.value(q.x, q.y) }];
      for (const [n, rr] of [[6, 0.5], [12, 1]]) for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * (k + (n === 6 ? 0.5 : 0))) / n, x = q.x + rr * R * Math.cos(a), y = q.y + rr * R * Math.sin(a);
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) samples.push({ x, y, v: L.value(x, y) });
      }
      const inside = (x, y) => (x - q.x) ** 2 + (y - q.y) ** 2 <= R * R && x >= 0 && x <= 1 && y >= 0 && y <= 1;
      let best = samples[0];
      for (let ring = 1; ring <= 6; ring++) for (let k = 0; k < 8 * ring; k++) {
        const a = (2 * Math.PI * k) / (8 * ring), x = q.x + (ring / 6) * R * Math.cos(a), y = q.y + (ring / 6) * R * Math.sin(a);
        if (!inside(x, y)) continue;
        const v = L.value(x, y);
        if (v > best.v) best = { x, y, v };
      }
      for (let step = R / 12; step > 1e-5; ) {
        let moved = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]) {
          const x = best.x + dx * step, y = best.y + dy * step;
          if (!inside(x, y)) continue;
          const v = L.value(x, y);
          if (v > best.v) { best = { x, y, v }; moved = true; }
        }
        if (!moved) step *= 0.5;
      }
      return { v: best.v, at: { x: best.x, y: best.y }, center: samples[0].v, samples };
    }

    /** play one turn with your B points; every opponent moves at the same time */
    play(yourPts) {
      if (this.over) return;
      const r = this.round, B = this.o.batch;
      if (yourPts.length !== B) throw new Error(`need ${B} points`);
      for (const p of this.players) {
        const t0 = Date.now();
        const pts = (p.searcher ? p.searcher.propose(r) : yourPts).slice(0, B).map((q) => ({ x: VC.clamp01(q.x), y: VC.clamp01(q.y) }));
        let vals, info = null;
        if (this.sonar) { info = pts.map((q) => this.probe(q)); vals = info.map((d) => d.v); }
        else vals = pts.map((q) => this.land.value(q.x, q.y));
        if (p.searcher) p.searcher.observe(pts, vals, info);
        pts.forEach((q, i) => p.pts.push(info
          ? { x: q.x, y: q.y, v: vals[i], round: r, at: info[i].at, center: info[i].center }
          : { x: q.x, y: q.y, v: vals[i], round: r }));
        const turnBest = Math.max(...vals);
        p.best = p.best == null ? turnBest : Math.max(p.best, turnBest);
        p.hist.push(p.best);
        p.ms = Date.now() - t0;
      }
      this.round++;
    }

    /** best height found by player p in turns 0..upto-1 */
    bestUpTo(p, upto) { return upto <= 0 ? null : p.hist[Math.min(upto, p.hist.length) - 1]; }

    /** players sorted by best so far (ties keep the fixed order, you first) */
    standings() {
      return this.players.slice().sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
    }
  }

  /** sonar disc radius: smaller on harder landscapes */
  VC.SONAR = { easy: 0.04, medium: 0.03, hard: 0.022 };
  VC.Game = Game;
})(typeof window !== "undefined" ? window : globalThis);
