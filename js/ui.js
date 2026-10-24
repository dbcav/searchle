/*
 * Shared UI plumbing: HiDPI canvas sizing, world <-> pixel transforms,
 * draggable circular handles (move by the body, resize by the rim square),
 * and small form helpers.
 */
(function (global) {
  "use strict";
  const VC = (global.VC = global.VC || {});

  /** Keeps a canvas sized to its box at device resolution; world is [0,1]^2. */
  class Stage {
    constructor(canvas, onResize) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onResize = onResize;
      this.size = 1;
      this.z = 1; this.ox = 0; this.oy = 0; // view: zoom, and the world point at the canvas's top-left
      this.resize();
      new ResizeObserver(() => { this.resize(); if (this.onResize) this.onResize(); }).observe(canvas.parentElement);
    }
    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      const s = Math.max(120, Math.floor(Math.min(box.width, box.height || box.width)));
      const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
      this.size = s; this.dpr = dpr;
      this.canvas.width = Math.round(s * dpr);
      this.canvas.height = Math.round(s * dpr);
      this.canvas.style.width = s + "px";
      this.canvas.style.height = s + "px";
      this.applyView(); // draw in world units
    }
    /** device-pixel transform for world units under the current zoom/pan */
    matrix() {
      const m = this.dpr * this.size * this.z;
      return [m, 0, 0, m, -m * this.ox, -m * this.oy];
    }
    applyView() { this.ctx.setTransform(...this.matrix()); }
    /** zoom z >= 1 with the visible window [ox, ox + 1/z] kept inside the board */
    setView(z, ox, oy) {
      z = Math.min(Stage.MAX_ZOOM, Math.max(1, z));
      const hi = 1 - 1 / z, cl = (v) => Math.min(hi, Math.max(0, v));
      this.z = z; this.ox = cl(ox); this.oy = cl(oy);
      if (z < 1.01) { this.z = 1; this.ox = 0; this.oy = 0; }
      this.applyView();
    }
    resetView() { this.setView(1, 0, 0); }
    get zoomed() { return this.z > 1; }
    viewKey() { return this.z.toFixed(4) + "," + this.ox.toFixed(5) + "," + this.oy.toFixed(5); }
    /** pixels per world unit (CSS px), including zoom */
    get k() { return this.size * this.z; }
    /** world -> CSS px inside the canvas */
    sx(x) { return (x - this.ox) * this.k; }
    sy(y) { return (y - this.oy) * this.k; }
    toWorld(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: this.ox + (e.clientX - r.left) / r.width / this.z, y: this.oy + (e.clientY - r.top) / r.height / this.z };
    }
    clear(color) {
      const c = this.ctx;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = color; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      c.restore();
    }
  }
  Stage.MAX_ZOOM = 6;
  VC.Stage = Stage;

  /**
   * Pinch-to-zoom and pan for a board, plus taps.
   * Two fingers zoom and pan; one finger pans while zoomed in; ctrl+wheel (and
   * trackpad pinch) zooms on desktop. A tap or click that didn't move and wasn't
   * part of a pinch calls onTap(e). onView() runs after the view changes.
   * A "Reset view" button appears over the board while zoomed in.
   */
  VC.attachZoom = function (stage, { onTap, onView }) {
    const cv = stage.canvas, ptrs = new Map(), SLOP = 10;
    let multi = false, moved = false, pinch = null, pan = null;
    const changed = () => { btn.hidden = !stage.zoomed; if (onView) onView(); };

    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "view-reset"; btn.textContent = "Reset view"; btn.hidden = true;
    btn.addEventListener("click", () => { stage.resetView(); changed(); cv.focus({ preventScroll: true }); });
    cv.parentElement.appendChild(btn);

    const mid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    const startPinch = () => {
      const m = mid(), r = cv.getBoundingClientRect();
      pinch = { m, r, z: stage.z, wx: stage.ox + (m.x - r.left) / r.width / stage.z, wy: stage.oy + (m.y - r.top) / r.height / stage.z };
      pan = null;
    };
    const startPan = (p) => { pan = { x: p.x, y: p.y, ox: stage.ox, oy: stage.oy, r: cv.getBoundingClientRect() }; };

    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (ptrs.size === 1) { multi = false; moved = false; startPan(ptrs.get(e.pointerId)); }
      else { multi = true; if (ptrs.size === 2) startPinch(); }
    });
    cv.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP) moved = true;
      if (pinch && ptrs.size >= 2) {
        const m = mid(), z = Math.min(VC.Stage.MAX_ZOOM, Math.max(1, pinch.z * m.d / pinch.m.d));
        stage.setView(z, pinch.wx - (m.x - pinch.r.left) / pinch.r.width / z, pinch.wy - (m.y - pinch.r.top) / pinch.r.height / z);
        changed();
      } else if (pan && moved && stage.zoomed) {
        stage.setView(stage.z, pan.ox - (p.x - pan.x) / pan.r.width / stage.z, pan.oy - (p.y - pan.y) / pan.r.height / stage.z);
        changed();
      }
    });
    const up = (e, tap) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (tap && !multi && !moved && ptrs.size === 0 && onTap) onTap(e);
      if (ptrs.size === 1) { pinch = null; startPan([...ptrs.values()][0]); } // keep panning with the finger left down
      else if (ptrs.size === 2) startPinch();
      else if (!ptrs.size) { pinch = null; pan = null; }
    };
    cv.addEventListener("pointerup", (e) => up(e, true));
    cv.addEventListener("pointercancel", (e) => up(e, false));

    // desktop: ctrl+wheel / trackpad pinch zooms around the cursor; plain wheel scrolls the page
    cv.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !stage.zoomed) return;
      if (!e.ctrlKey) { // zoomed in: the wheel pans
        e.preventDefault();
        stage.setView(stage.z, stage.ox + e.deltaX / stage.k, stage.oy + e.deltaY / stage.k);
        return changed();
      }
      e.preventDefault();
      const r = cv.getBoundingClientRect(), z = stage.z * Math.exp(-e.deltaY * 0.01);
      const wx = stage.ox + (e.clientX - r.left) / r.width / stage.z, wy = stage.oy + (e.clientY - r.top) / r.height / stage.z;
      stage.setView(z, wx - (e.clientX - r.left) / r.width / Math.min(VC.Stage.MAX_ZOOM, Math.max(1, z)),
        wy - (e.clientY - r.top) / r.height / Math.min(VC.Stage.MAX_ZOOM, Math.max(1, z)));
      changed();
    }, { passive: false });
    // keyboard: + / - zoom about the centre, 0 resets
    cv.addEventListener("keydown", (e) => {
      const f = e.key === "+" || e.key === "=" ? 1.5 : e.key === "-" ? 1 / 1.5 : e.key === "0" ? 0 : null;
      if (f == null) return;
      e.preventDefault();
      if (!f) stage.resetView();
      else { const c = 0.5 / stage.z, cx = stage.ox + c, cy = stage.oy + c, z = Math.min(VC.Stage.MAX_ZOOM, Math.max(1, stage.z * f)); stage.setView(z, cx - 0.5 / z, cy - 0.5 / z); }
      changed();
    });
    return { reset() { stage.resetView(); changed(); } };
  };

  /**
   * Draggable circles. handles: [{ id, get(): {x,y,R}, resizable, onMove(x,y,R,phase) }]
   * phase is "start" | "move" | "end".
   */
  VC.attachHandles = function (stage, handles, onHover) {
    const cv = stage.canvas;
    let drag = null;
    const knob = (h) => { const s = h.get(); const a = -Math.PI / 4; return { x: s.x + s.R * Math.cos(a), y: s.y + s.R * Math.sin(a) }; };
    function hit(p) {
      const tol = 12 / stage.k;
      for (const h of handles) {
        if (!h.resizable) continue;
        const kn = knob(h);
        if (Math.hypot(p.x - kn.x, p.y - kn.y) < tol) return { h, mode: "resize" };
      }
      for (const h of handles) {
        const s = h.get();
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < Math.max(s.R, 16 / stage.k)) return { h, mode: "move" };
      }
      return null;
    }
    cv.addEventListener("pointerdown", (e) => {
      const p = stage.toWorld(e), t = hit(p);
      if (!t) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const s = t.h.get();
      drag = { ...t, ox: p.x - s.x, oy: p.y - s.y };
      cv.style.cursor = t.mode === "resize" ? "nesw-resize" : "grabbing";
      t.h.onMove(s.x, s.y, s.R, "start");
    });
    cv.addEventListener("pointermove", (e) => {
      const p = stage.toWorld(e);
      if (!drag) {
        const t = hit(p);
        cv.style.cursor = !t ? "default" : t.mode === "resize" ? "nesw-resize" : "grab";
        if (onHover) onHover(t ? t.h.id : null);
        return;
      }
      const s = drag.h.get();
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      if (drag.mode === "move") {
        drag.h.onMove(clamp(p.x - drag.ox, 0.02, 0.98), clamp(p.y - drag.oy, 0.02, 0.98), s.R, "move");
      } else {
        const R = clamp(Math.hypot(p.x - s.x, p.y - s.y), 0.03, 0.45);
        drag.h.onMove(s.x, s.y, R, "move");
      }
    });
    const end = (e) => {
      if (!drag) return;
      const s = drag.h.get();
      drag.h.onMove(s.x, s.y, s.R, "end");
      drag = null;
      cv.style.cursor = "default";
      try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    return { knob, isDragging: () => !!drag };
  };

  /** Arrow keys on a focused canvas: target by default, start with shift. */
  VC.attachKeys = function (canvas, handles) {
    canvas.addEventListener("keydown", (e) => {
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!dirs[e.key]) return;
      e.preventDefault();
      const h = e.shiftKey ? handles.find((q) => q.id === "start") : handles.find((q) => q.id === "target");
      if (!h) return;
      const s = h.get(), d = 0.02;
      const x = Math.min(0.98, Math.max(0.02, s.x + dirs[e.key][0] * d));
      const y = Math.min(0.98, Math.max(0.02, s.y + dirs[e.key][1] * d));
      h.onMove(s.x, s.y, s.R, "start");
      h.onMove(x, y, s.R, "move");
      h.onMove(x, y, s.R, "end");
    });
  };

  /** Draw a handle: circle, centre mark, rim square. */
  VC.drawHandle = function (ctx, k, s, opts) {
    ctx.save();
    ctx.lineWidth = (opts.lineWidth || 1.5) / k;
    ctx.strokeStyle = opts.color;
    if (opts.dash) ctx.setLineDash(opts.dash.map((v) => v / k));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.R, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    // centre cross
    const c = 5 / k;
    ctx.beginPath(); ctx.moveTo(s.x - c, s.y); ctx.lineTo(s.x + c, s.y); ctx.moveTo(s.x, s.y - c); ctx.lineTo(s.x, s.y + c); ctx.stroke();
    if (opts.resizable) {
      const a = -Math.PI / 4, kx = s.x + s.R * Math.cos(a), ky = s.y + s.R * Math.sin(a), q = 4.5 / k;
      ctx.fillStyle = opts.knobFill || "#fff";
      ctx.fillRect(kx - q, ky - q, 2 * q, 2 * q);
      ctx.strokeRect(kx - q, ky - q, 2 * q, 2 * q);
    }
    if (opts.label) {
      ctx.font = `600 ${15 / k}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = "bottom";
      const lx = Math.min(0.97 - 0.06, Math.max(0.01, s.x - s.R * 0.7));
      const ly = Math.max(16 / k, s.y - s.R - 4 / k);
      ctx.fillText(opts.label, lx, ly);
    }
    ctx.restore();
  };

  /** Fill a <select> from [{id,label}] */
  VC.fillSelect = function (sel, items, value) {
    sel.innerHTML = "";
    for (const it of items) { const o = document.createElement("option"); o.value = it.id; o.textContent = it.label; sel.appendChild(o); }
    sel.value = value;
  };

  /** Bind a range input to an <output>. */
  VC.bindRange = function (input, out, fmt, onInput, onChange) {
    const show = () => { if (out) out.textContent = fmt(+input.value); };
    input.addEventListener("input", () => { show(); if (onInput) onInput(+input.value); });
    if (onChange) input.addEventListener("change", () => onChange(+input.value));
    show();
  };

  VC.reducedMotion = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
})(typeof window !== "undefined" ? window : globalThis);
