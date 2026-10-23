/*
 * The page: your board, the five opponent boards, standings, chart, record.
 * Drawing is on demand (no animation loop): something changed -> redraw.
 */
(function (global) {
  "use strict";
  const VC = global.VC, C = VC.COLORS;
  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const HEAT_N = 160;
  const fmt = (v) => (v == null ? "–" : v.toFixed(1));
  const ordinal = (k) => k + (k % 10 === 1 && k % 100 !== 11 ? "st" : k % 10 === 2 && k % 100 !== 12 ? "nd" : k % 10 === 3 && k % 100 !== 13 ? "rd" : "th");

  // mean best height per family (VC.FAMILIES order, then mixes), medium, 5 searches x 6 turns (tests/benchmark.js)
  const BENCH = {
    point: { games: 80, gp: [72, 59.4, 67.3, 79.1, 73.2, 60.6, 95.3, 79.6], voronoi: [71.1, 59.4, 65.5, 81.6, 71.8, 61.8, 97, 76.4], swarm: [67.3, 65.4, 71.7, 72.9, 71.4, 59.2, 88.7, 74.7], climbers: [63.3, 64.6, 64.9, 73.2, 63.6, 60.3, 80.9, 71.7], random: [60.1, 58, 61.2, 68.1, 63.7, 60.7, 77.7, 69.4] },
    circle: { games: 40, gp: [89.6, 92.7, 87.5, 90.5, 80.4, 77, 98.7, 90.6], voronoi: [70.3, 80.9, 84.7, 91.3, 82.6, 70.3, 100, 87.7], swarm: [77.6, 84.9, 91.7, 85.3, 83.4, 66.1, 98.6, 88.7], climbers: [79.7, 82.3, 82.7, 82.9, 79.9, 76, 89.6, 81.7], random: [76.2, 75.8, 82.8, 72.2, 76.5, 75.5, 82.5, 81.4] },
  };

  /* ---------- colour ---------- */
  const RGB = VC.rampStops(256).map((s) => s.match(/\d+/g).map(Number));
  const PAPER_RGB = [0xee, 0xf1, 0xec];
  const heightColor = (v) => VC.ramp(v / 100);
  function playerColor(id) {
    const slot = { you: "--you", gp: "--s1", voronoi: "--s2", swarm: "--s3", climbers: "--s4", random: "--s5" }[id];
    return css(slot);
  }

  /* ---------- settings, seeds, URL ---------- */
  function todaySeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)), o = {};
    if (q.has("seed")) o.seed = Math.abs(parseInt(q.get("seed"), 10)) || todaySeed();
    // links from before landscape families had no f=: those were hills
    if (["random", "mix"].includes(q.get("f")) || VC.FAMILIES.some((f) => f.id === q.get("f"))) o.family = q.get("f");
    else if (q.has("seed")) o.family = "hills";
    if (q.get("m") === "circle") o.reveal = "circle";
    if (VC.DIFFICULTY[q.get("d")]) o.difficulty = q.get("d");
    if (["3", "5", "8"].includes(q.get("b"))) o.batch = +q.get("b");
    if (["4", "6", "10"].includes(q.get("r"))) o.rounds = +q.get("r");
    return o;
  }
  function writeHash(o) {
    try { history.replaceState(null, "", `#seed=${o.seed}&f=${o.family}&d=${o.difficulty}&b=${o.batch}&r=${o.rounds}${o.reveal === "circle" ? "&m=circle" : ""}`); } catch (_) { /* file:// in some browsers */ }
  }

  /* ---------- record (this browser only) ---------- */
  const REC_KEY = "find-the-peak-record-v1";
  function loadRecord() {
    try { const r = JSON.parse(localStorage.getItem(REC_KEY)); if (r && r.vs) return r; } catch (_) { /* storage blocked */ }
    return { games: 0, vs: {} };
  }
  function saveRecord(r) { try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch (_) { /* storage blocked */ } }

  /* ---------- drawing ---------- */
  function heatImage(land, N) {
    N = N || HEAT_N;
    const g = land.grid(N), W = N + 1, cv = document.createElement("canvas");
    cv.width = W; cv.height = W;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, W);
    for (let i = 0; i < g.length; i++) {
      const t = g[i] / 100, c = t > 0.012 ? RGB[Math.min(255, Math.floor(t * 255))] : PAPER_RGB;
      img.data[4 * i] = c[0]; img.data[4 * i + 1] = c[1]; img.data[4 * i + 2] = c[2]; img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function drawPolys(ctx, k, vor, vals, alpha) {
    ctx.save();
    for (let i = 0; i < vor.n; i++) {
      const p = vor.polys[i];
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let q = 2; q < p.length; q += 2) ctx.lineTo(p[q], p[q + 1]);
      ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = heightColor(vals[i]); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1 / k; ctx.strokeStyle = C.rule; ctx.stroke();
    }
    ctx.restore();
  }

  /** text in CSS pixels (fonts don't scale reliably under the world transform) */
  function label(stage, str, x, y, o) {
    const ctx = stage.ctx, k = stage.k;
    ctx.save();
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    ctx.font = `${o.weight || 600} ${o.size || 13}px ${FONT}`;
    ctx.textAlign = o.align || "left"; ctx.textBaseline = o.baseline || "middle";
    const px = x * k + (o.dx || 0), py = y * k + (o.dy || 0);
    if (o.halo !== false) { ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = o.haloColor || C.paper; ctx.strokeText(str, px, py); }
    ctx.fillStyle = o.color || C.ink; ctx.fillText(str, px, py);
    ctx.restore();
  }

  function fog(ctx, k) {
    ctx.save();
    ctx.fillStyle = css("--paper-2"); ctx.fillRect(0, 0, 1, 1);
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1 / k;
    ctx.beginPath();
    for (let s = -1; s < 2; s += 14 / k) { ctx.moveTo(s, 0); ctx.lineTo(s + 1, 1); }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * One board. o = { land, reveal, pts, upto, pending, shade, hidden, labels, best, latest, k }
   */
  function drawBoard(stage, o) {
    const ctx = stage.ctx, k = stage.k;
    stage.clear(C.paper);
    if (o.hidden) {
      fog(ctx, k);
      const hc = css("--paper-2");
      label(stage, "Hidden until the game ends", 0.5, 0.5, { size: 16, align: "center", dy: -10, haloColor: hc });
      label(stage, `${o.pts.length} ${o.radius ? "circles" : "points"} searched`, 0.5, 0.5, { size: 14, weight: 500, align: "center", dy: 12, color: C.ink2, haloColor: hc });
      return;
    }
    const pts = o.pts.filter((p) => p.round < o.upto);
    if (o.reveal) {
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(o.heat, 0, 0, 1, 1); ctx.restore();
      ctx.save(); ctx.lineWidth = 0.8 / k; ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.28;
      for (const c of o.contours) {
        ctx.beginPath();
        for (let q = 0; q < c.seg.length; q += 4) { ctx.moveTo(c.seg[q], c.seg[q + 1]); ctx.lineTo(c.seg[q + 2], c.seg[q + 3]); }
        ctx.stroke();
      }
      ctx.restore();
    } else if (o.shade && pts.length) {
      const vor = VC.voronoi(Float64Array.from(pts, (p) => p.x), Float64Array.from(pts, (p) => p.y), pts.length, { x0: 0, y0: 0, x1: 1, y1: 1 });
      drawPolys(ctx, k, vor, pts.map((p) => (o.radius ? p.center : p.v)), o.radius ? 0.3 : 0.9);
    }
    if (o.radius) { // sonar: each search shows the true landscape inside its circle
      for (const p of pts) {
        if (!o.reveal) {
          ctx.save();
          ctx.beginPath(); ctx.arc(p.x, p.y, o.radius, 0, 2 * Math.PI); ctx.clip();
          ctx.imageSmoothingEnabled = true; ctx.drawImage(o.heat, 0, 0, 1, 1);
          ctx.lineWidth = 0.8 / k; ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.3;
          for (const c of o.contours) {
            ctx.beginPath();
            for (let q = 0; q < c.seg.length; q += 4) { ctx.moveTo(c.seg[q], c.seg[q + 1]); ctx.lineTo(c.seg[q + 2], c.seg[q + 3]); }
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, o.radius, 0, 2 * Math.PI);
        ctx.lineWidth = 1.2 / k; ctx.strokeStyle = C.ink; ctx.stroke();
      }
    }
    // searched points
    const mark = (p) => (o.radius && p.at ? p.at : p); // where the score was found
    let best = null; for (const p of pts) if (!best || p.v > best.v) best = p;
    const lastRound = pts.length ? pts[pts.length - 1].round : -1;
    const r = (o.small ? 3.6 : o.radius ? 4 : 5) / k;
    for (const p of pts) {
      const m = mark(p);
      if (p.round === lastRound && o.latest && !o.radius) {
        ctx.beginPath(); ctx.arc(m.x, m.y, r + 3.5 / k, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5 / k; ctx.strokeStyle = C.ink; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = heightColor(p.v); ctx.fill();
      ctx.lineWidth = 1.3 / k; ctx.strokeStyle = C.ink; ctx.stroke();
      if (o.radius && p.round === lastRound && o.latest) { // newest circles: a heavier rim
        ctx.beginPath(); ctx.arc(p.x, p.y, o.radius, 0, 2 * Math.PI);
        ctx.lineWidth = 2.4 / k; ctx.strokeStyle = C.ink; ctx.stroke();
      }
    }
    if (o.labels) {
      for (const p of pts) {
        const m = mark(p), right = m.x < 0.93;
        label(stage, p.v.toFixed(0), m.x, m.y, { size: 13, align: right ? "left" : "right", dx: right ? r * k + 4 : -r * k - 4 });
      }
    }
    if (best) { // best so far: a square bracket around it
      best = { ...best, ...mark(best) };
      const s = r + 6 / k;
      ctx.lineWidth = 2 / k; ctx.strokeStyle = C.ink;
      ctx.strokeRect(best.x - s, best.y - s, 2 * s, 2 * s);
      if (!o.labels) {
        const above = best.y - s > 22 / k;
        label(stage, best.v.toFixed(1), best.x, above ? best.y - s : best.y + s, { size: 14, weight: 700, align: best.x > 0.85 ? "right" : best.x < 0.15 ? "left" : "center", baseline: above ? "bottom" : "top", dy: above ? -2 : 2 });
      }
    }
    // the true peak (after the game)
    if (o.reveal) {
      const a = 9 / k;
      o.peaks.forEach((P, i) => {
        ctx.save();
        ctx.strokeStyle = C.paper; ctx.lineWidth = 4.5 / k;
        ctx.beginPath(); ctx.moveTo(P.x - a, P.y); ctx.lineTo(P.x + a, P.y); ctx.moveTo(P.x, P.y - a); ctx.lineTo(P.x, P.y + a); ctx.stroke();
        ctx.strokeStyle = C.exit; ctx.lineWidth = 2.2 / k; ctx.stroke();
        ctx.beginPath(); ctx.arc(P.x, P.y, a * 0.62, 0, 2 * Math.PI); ctx.stroke();
        ctx.restore();
        const txt = i === 0 ? "peak 100" : P.v.toFixed(1);
        if (!o.small) label(stage, txt, P.x, P.y, { size: 15, weight: 700, color: C.exit, align: P.x > 0.8 ? "right" : "left", dx: P.x > 0.8 ? -a * k - 5 : a * k + 5 });
      });
    }
    // your pending points
    if (o.pending) {
      o.pending.forEach((p, i) => {
        if (o.radius) {
          ctx.beginPath(); ctx.arc(p.x, p.y, o.radius, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(238,241,236,0.55)"; ctx.fill();
          ctx.setLineDash([4 / k, 3 / k]); ctx.lineWidth = 1.5 / k; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, 10 / k, 0, 2 * Math.PI);
        ctx.fillStyle = C.paper; ctx.fill();
        ctx.setLineDash([3 / k, 2 / k]); ctx.lineWidth = 1.8 / k; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.setLineDash([]);
        label(stage, String(i + 1), p.x, p.y, { size: 14, weight: 700, align: "center", dy: 1, halo: false });
      });
    }
  }

  /* ---------- the controller ---------- */
  class View {
    constructor() {
      const h = readHash();
      this.o = {
        seed: h.seed || todaySeed(), family: h.family || "random", difficulty: h.difficulty || "medium",
        batch: h.batch || 5, rounds: h.rounds || 6, reveal: h.reveal || "point",
      };
      this.pending = [];
      this.record = loadRecord();
      this.board = new VC.Stage($("board"), () => this.draw());
      this.buildOpponents();
      // the chart, record, benchmark and gallery are optional: play.html leaves them out
      this.chart = $("chart") && new VC.LineChart($("chart"), { xLabel: "points used", yLabel: "best height", height: 220, yFmt: (v) => Math.round(v), xFmt: (v) => Math.round(v) });
      VC.fillSelect($("family"), [{ id: "random", label: "Surprise me" }, ...VC.FAMILIES, VC.MIX], this.o.family);
      this.bindControls();
      if ($("bench-table")) this.fillBench("point");
      if ($("family-grid")) setTimeout(() => this.fillFamilies(), 400);
      if ($("key-ramp")) $("key-ramp").style.background = `linear-gradient(to right, ${VC.rampStops(9).join(",")})`;
      this.newGame();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.draw());
    }

    buildOpponents() {
      const grid = $("opp-grid");
      this.opp = {};
      for (const S of VC.SEARCHERS) {
        const fig = document.createElement("figure");
        fig.className = "opp";
        fig.innerHTML = `<figcaption class="opp-head">
            <div class="opp-name"><i class="sw" style="--c:${playerColor(S.id)}"></i>${S.name}</div>
            <p class="opp-shares">Shares ${S.shares}</p>
            <div class="opp-best"><span>Best so far</span><b>–</b></div>
          </figcaption>
          <div class="canvas-wrap"><canvas aria-label="${S.name} board"></canvas></div>`;
        grid.appendChild(fig);
        const cv = fig.querySelector("canvas");
        this.opp[S.id] = { fig, best: fig.querySelector(".opp-best b"), stage: null, cv };
      }
      for (const S of VC.SEARCHERS) this.opp[S.id].stage = new VC.Stage(this.opp[S.id].cv, () => this.drawOpp(S.id));
    }

    bindControls() {
      const seg = (name, key, num) => {
        for (const inp of document.querySelectorAll(`input[name="${name}"]`)) {
          inp.addEventListener("change", () => { this.o[key] = num ? +inp.value : inp.value; this.newGame(); });
        }
      };
      seg("difficulty", "difficulty", false); seg("batch", "batch", true); seg("rounds", "rounds", true); seg("reveal", "reveal", false);
      $("family").addEventListener("change", () => { this.o.family = $("family").value; this.newGame(); });
      for (const inp of document.querySelectorAll('input[name="bench"]')) inp.addEventListener("change", () => this.fillBench(inp.value));
      $("shade").addEventListener("change", () => this.draw());
      $("peek").addEventListener("change", () => this.draw());
      $("new").addEventListener("click", () => { this.o.seed = 1 + Math.floor(Math.random() * 99999999); this.newGame(); });
      $("daily").addEventListener("click", () => { this.o.seed = todaySeed(); this.newGame(); });
      $("restart").addEventListener("click", () => this.newGame());
      $("share").addEventListener("click", () => this.share());
      $("go").addEventListener("click", () => {
        if (this.game.over) { this.o.seed = 1 + Math.floor(Math.random() * 99999999); this.newGame(); }
        else this.submit();
      });
      $("fill").addEventListener("click", () => {
        while (this.pending.length < this.o.batch) this.pending.push({ x: VC.clamp01(Math.random()), y: VC.clamp01(Math.random()) });
        this.update();
      });
      $("clear").addEventListener("click", () => { this.pending = []; this.update(); });
      $("replay").addEventListener("input", () => { $("replay-out").textContent = $("replay").value; this.draw(); });
      // a pasted link that only changes the #hash doesn't reload the page (replaceState never fires this)
      global.addEventListener("hashchange", () => {
        const h = readHash();
        Object.assign(this.o, h, { family: h.family || "random", reveal: h.reveal || "point" });
        this.newGame();
      });
      if ($("reset-record")) $("reset-record").addEventListener("click", () => { this.record = { games: 0, vs: {} }; saveRecord(this.record); this.renderRecord(); });

      const cv = $("board");
      cv.addEventListener("pointerdown", (e) => {
        if (!this.game || this.game.over || this.busy) return;
        const p = this.board.toWorld(e), tol = 12 / this.board.k;
        const hit = this.pending.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol);
        if (hit >= 0) this.pending.splice(hit, 1);
        else if (this.pending.length < this.o.batch) this.pending.push({ x: VC.clamp01(p.x), y: VC.clamp01(p.y) });
        this.update();
      });
      cv.addEventListener("pointermove", (e) => this.hover(e));
      cv.addEventListener("pointerleave", () => { $("board-tip").hidden = true; });
      cv.addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("go").disabled) { e.preventDefault(); this.submit(); } });
    }

    newGame() {
      this.game = new VC.Game(this.o);
      this.pending = [];
      this.busy = false;
      this.recorded = false;
      this.heat = heatImage(this.game.land);
      this.contours = this.game.land.contours(HEAT_N, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
      $("family").value = this.o.family;
      $("hint").textContent = this.game.sonar
        ? "Click to place a circle, click it again to take it back. Each circle shows the real landscape inside it, and your score is the highest point you have uncovered (the dot)."
        : "Click to place a point, click it again to take it back. Each cell is shaded by the height of the point inside it: this is your nearest-neighbour guess at the landscape, drawn as a Voronoi diagram.";
      for (const [name, key] of [["difficulty", "difficulty"], ["batch", "batch"], ["rounds", "rounds"], ["reveal", "reveal"]]) {
        const el = document.querySelector(`input[name="${name}"][value="${this.o[key]}"]`); if (el) el.checked = true;
      }
      const daily = this.o.seed === todaySeed();
      this.daily = daily;
      this.seedLabel();
      $("share-msg").textContent = "";
      $("replay").max = this.o.rounds; $("replay").value = this.o.rounds; $("replay").disabled = true;
      $("replay-out").textContent = this.o.rounds;
      writeHash(this.o);
      this.update();
    }

    /** footer + the note next to the landscape picker; a surprise family stays hidden until the end */
    seedLabel() {
      const g = this.game, hide = (this.o.family === "random" || this.o.family === "mix") && !g.over, fam = g.land.label;
      $("seed-label").textContent = `Seed ${this.o.seed}${this.daily ? " (today's)" : ""} · ${hide ? "surprise" : fam} · ${VC.DIFFICULTY[this.o.difficulty].label}${g.sonar ? " · sonar" : ""}`;
      $("family-note").textContent = !["random", "mix"].includes(this.o.family) ? "" : hide ? "revealed at the end" : `this was ${fam}`;
    }

    submit() {
      if (this.busy || this.game.over || this.pending.length !== this.o.batch) return;
      this.busy = true;
      $("go").textContent = "Opponents searching…"; $("go").disabled = true;
      setTimeout(() => {
        this.game.play(this.pending);
        this.pending = [];
        this.busy = false;
        if (this.game.over) this.finish();
        this.update();
      }, 30);
    }

    finish() {
      $("replay").disabled = false; $("replay").value = this.o.rounds; $("replay-out").textContent = this.o.rounds;
      if (this.recorded) return;
      this.recorded = true;
      const you = this.game.player("you").best;
      this.record.games++;
      for (const S of VC.SEARCHERS) {
        const them = this.game.player(S.id).best, r = (this.record.vs[S.id] = this.record.vs[S.id] || [0, 0, 0]);
        r[Math.abs(you - them) < 0.05 ? 1 : you > them ? 0 : 2]++;
      }
      saveRecord(this.record);
    }

    /* ---------- refresh everything ---------- */
    update() {
      const g = this.game, B = this.o.batch, R = this.o.rounds, over = g.over;
      $("ro-turn").textContent = over ? "done" : `${g.round + 1} / ${R}`;
      $("ro-placed").textContent = over ? "–" : `${this.pending.length} / ${B}`;
      $("ro-best").textContent = fmt(g.player("you").best);
      const go = $("go");
      if (!this.busy) {
        go.textContent = over ? "Play a new landscape" : `Search ${B} ${g.sonar ? "circle" : "point"}${B > 1 ? "s" : ""}`;
        go.disabled = !over && this.pending.length !== B;
      }
      $("fill").disabled = over || this.pending.length >= B;
      $("clear").disabled = over || !this.pending.length;
      this.status();
      this.seedLabel();
      this.renderStandings();
      this.renderChart();
      this.renderRecord();
      for (const S of VC.SEARCHERS) this.opp[S.id].best.textContent = fmt(g.player(S.id).best);
      const top = over ? Math.max(...g.players.map((p) => p.best)) : null;
      for (const S of VC.SEARCHERS) this.opp[S.id].fig.classList.toggle("winner", over && Math.abs(g.player(S.id).best - top) < 0.05);
      this.draw();
    }

    status() {
      const g = this.game, B = this.o.batch, R = this.o.rounds, el = $("status");
      if (!g.over) {
        const left = B - this.pending.length;
        const turn = g.round === R - 1 ? `<b>Last turn.</b>` : `<b>Turn ${g.round + 1} of ${R}.</b>`;
        el.innerHTML = left > 0
          ? `${turn} Place ${left} more ${g.sonar ? "circle" : "point"}${left > 1 ? "s" : ""}${g.round === 0 ? " anywhere in the square" : ""}.`
          : `${turn} Press search (or Enter) to see ${g.sonar ? "inside the circles" : "the heights"}.`;
        return;
      }
      const st = g.standings(), you = g.player("you").best;
      const rank = 1 + st.filter((p) => p.best > you + 0.05).length;
      const top = st[0], peakFound = st.filter((p) => p.best >= 99.5).map((p) => (p.id === "you" ? "you" : p.name));
      let s = rank === 1 ? `<b>You win${st.filter((p) => Math.abs(p.best - you) < 0.05).length > 1 ? " (tied)" : ""}</b> with ${fmt(you)}.`
        : `<b>You found ${fmt(you)}</b> and finished ${ordinal(rank)} of ${st.length}. ${top.name} found ${fmt(top.best)}.`;
      const others = peakFound.filter((n) => n !== top.name && n !== "you");
      if (!peakFound.length) s += ` Nobody reached the peak (green cross${g.land.peaks.length > 1 ? "es" : ""}).`;
      else if (others.length) s += ` Also at the peak: ${others.join(", ")}.`;
      s += ` <span class="fam-reveal">This was <b>${g.land.label}</b>: ${g.land.blurb}.</span>`;
      el.innerHTML = s;
    }

    renderStandings() {
      const g = this.game, body = $("standings").tBodies[0];
      const played = g.round > 0;
      const rows = played ? g.standings() : g.players;
      body.innerHTML = "";
      let rank = 0, prev = null;
      rows.forEach((p, i) => {
        if (prev == null || Math.abs(p.best - prev) >= 0.05) rank = i + 1;
        prev = p.best;
        const last = played ? Math.max(...p.pts.filter((q) => q.round === g.round - 1).map((q) => q.v)) : null;
        const tr = document.createElement("tr");
        if (p.id === "you") tr.className = "you";
        tr.innerHTML = `<td>${played ? rank : ""}</td><td><i class="sw" style="--c:${playerColor(p.id)}"></i>${p.name}</td><td>${fmt(p.best)}</td><td>${last == null ? "–" : last.toFixed(1)}</td>`;
        body.appendChild(tr);
      });
    }

    renderChart() {
      if (!this.chart) return;
      const g = this.game, B = this.o.batch;
      this.chart.setSeries(g.round === 0 ? [] : g.players.map((p) => ({
        name: p.name, short: p.short, color: playerColor(p.id), dash: p.id === "you" ? "none" : null,
        xs: p.hist.map((_, i) => (i + 1) * B), ys: p.hist,
      })));
    }

    renderRecord() {
      if (!$("record")) return;
      const body = $("record").tBodies[0];
      body.innerHTML = "";
      for (const S of VC.SEARCHERS) {
        const r = this.record.vs[S.id] || [0, 0, 0];
        const tr = document.createElement("tr");
        tr.innerHTML = `<th scope="row"><i class="sw" style="--c:${playerColor(S.id)}"></i>${S.name}</th><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td>`;
        body.appendChild(tr);
      }
      const n = this.record.games;
      $("record-games").textContent = `${n} game${n === 1 ? "" : "s"} played`;
    }

    fillBench(mode) {
      const data = BENCH[mode] || BENCH.point, head = $("bench-table").tHead, body = $("bench-body");
      $("bench-note").textContent = mode === "circle"
        ? `Sonar, ${data.games} landscapes per family. Everyone does better and the winners reshuffle: with a dense patch of heights around every search, Bayesian optimization can see a ridge's shape and wins it, and the hill climbers get a free uphill step from every circle.`
        : `Single points, ${data.games} landscapes per family. On mixes the generalist wins: blending smooths out each kind's extremes, which suits Bayesian optimization's smoothness assumption.`;
      const cols = [...VC.FAMILIES, { label: "Mixes" }];
      head.innerHTML = `<tr><th scope="col">Opponent</th>${cols.map((f) => `<th scope="col">${f.label}</th>`).join("")}</tr>`;
      body.innerHTML = "";
      const top = cols.map((_, j) => Math.max(...VC.SEARCHERS.map((S) => data[S.id][j])));
      for (const S of VC.SEARCHERS) {
        const tr = document.createElement("tr"), b = data[S.id];
        tr.innerHTML = `<th scope="row"><i class="sw" style="--c:${playerColor(S.id)}"></i>${S.name}</th>${b.map((v, j) => `<td class="${v === top[j] ? "top" : ""}">${v.toFixed(1)}</td>`).join("")}`;
        body.appendChild(tr);
      }
    }

    /** one small picture per family for the notes (built after the page has painted) */
    fillFamilies() {
      const grid = $("family-grid"), N = 120, S = 240, levels = [10, 20, 30, 40, 50, 60, 70, 80, 90];
      const queue = [...VC.FAMILIES.map((F) => ({ seed: 11, id: F.id })), ...[4, 23, 5, 12].map((seed) => ({ seed, id: "mix" }))];
      const next = () => {
        const job = queue.shift(); if (!job) return;
        const land = new VC.Landscape(job.seed, "medium", job.id), F = { label: land.label, blurb: land.blurb }, cv = document.createElement("canvas");
        if (job.id === "mix" && !grid.querySelector(".mix-head")) {
          const h = document.createElement("p"); h.className = "mix-head";
          h.innerHTML = "<b>Mixes.</b> <em>Random mix</em> (and half of all <em>Surprise me</em> games) blends two or three kinds with random weights, then rescales so the peak is 100 again.";
          grid.appendChild(h);
        }
        cv.width = S; cv.height = S;
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.drawImage(heatImage(land, N), 0, 0, S, S);
        ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.3; ctx.lineWidth = 0.8;
        for (const c of land.contours(N, levels)) {
          ctx.beginPath();
          for (let q = 0; q < c.seg.length; q += 4) { ctx.moveTo(c.seg[q] * S, c.seg[q + 1] * S); ctx.lineTo(c.seg[q + 2] * S, c.seg[q + 3] * S); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.strokeStyle = C.exit; ctx.lineWidth = 2.2;
        for (const P of land.peaks) {
          const px = P.x * S, py = P.y * S;
          ctx.beginPath(); ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py); ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7); ctx.stroke();
        }
        const fig = document.createElement("figure");
        fig.className = "family-card";
        cv.setAttribute("role", "img"); cv.setAttribute("aria-label", `${F.label} landscape example`);
        fig.appendChild(cv);
        const cap = document.createElement("figcaption");
        cap.innerHTML = `<b>${F.label}</b>${F.blurb.charAt(0).toUpperCase() + F.blurb.slice(1)}.`;
        fig.appendChild(cap);
        grid.appendChild(fig);
        setTimeout(next, 0);
      };
      next();
    }

    /* ---------- drawing ---------- */
    upto() { return this.game.over ? +$("replay").value : this.game.round; }

    draw() {
      if (!this.game) return;
      const g = this.game;
      drawBoard(this.board, {
        pts: g.player("you").pts, upto: this.upto(), pending: g.over ? null : this.pending,
        shade: $("shade").checked, reveal: g.over, heat: this.heat, contours: this.contours, peaks: g.land.peaks,
        labels: true, latest: !g.over, radius: g.sonar ? g.radius : 0,
      });
      for (const S of VC.SEARCHERS) this.drawOpp(S.id);
    }

    drawOpp(id) {
      const g = this.game; if (!g) return;
      const peek = $("peek").checked;
      drawBoard(this.opp[id].stage, {
        pts: g.player(id).pts, upto: this.upto(), hidden: !g.over && !peek,
        shade: $("shade").checked, reveal: g.over, heat: this.heat, contours: this.contours, peaks: g.land.peaks,
        labels: false, latest: !g.over, small: true, radius: g.sonar ? g.radius : 0,
      });
    }

    hover(e) {
      const tip = $("board-tip"), g = this.game, p = this.board.toWorld(e);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) { tip.hidden = true; return; }
      const tol = 10 / this.board.k, mine = g.player("you").pts.filter((q) => q.round < this.upto());
      const near = mine.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol);
      let html;
      const inDisc = g.sonar && mine.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= g.radius);
      if (g.sonar && (inDisc || g.over)) html = `height here <b>${g.land.value(p.x, p.y).toFixed(1)}</b>`;
      else if (near) html = `height <b>${near.v.toFixed(1)}</b> · turn ${near.round + 1}`;
      else if (g.over) html = `height here <b>${g.land.value(p.x, p.y).toFixed(1)}</b>`;
      else html = `(${p.x.toFixed(2)}, ${(1 - p.y).toFixed(2)})`;
      tip.innerHTML = html;
      tip.hidden = false;
      const wrap = $("board-wrap").getBoundingClientRect(), r = this.board.canvas.getBoundingClientRect();
      const px = e.clientX - wrap.left, py = e.clientY - wrap.top;
      tip.style.left = Math.min(px + 14, r.width - tip.offsetWidth - 6) + "px";
      tip.style.top = (py < 40 ? py + 18 : py - 34) + "px";
    }

    share() {
      const msg = $("share-msg"), url = location.href;
      const done = (ok) => { msg.textContent = ok ? "Link copied" : "Copy the address bar"; setTimeout(() => { msg.textContent = ""; }, 2500); };
      try { navigator.clipboard.writeText(url).then(() => done(true), () => done(false)); } catch (_) { done(false); }
    }
  }

  function start() { VC.view = new View(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
