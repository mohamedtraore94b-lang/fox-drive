/* =========================================================
   GLASS FOLDER — vanilla port of the 21st.dev "glass-folder-cards"
   ========================================================= */
const GF = (() => {
  const W = 340, H = 272, HEADROOM = 54, FRONT_TOP = 74, FRONT_H = H - FRONT_TOP;
  const MAX_VISIBLE = 4;
  const BACK_PATH = "M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z";
  const FRONT_PATH = "M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 " + (FRONT_H - 22) +
    "A22 22 0 0 1 318 " + FRONT_H + "L22 " + FRONT_H + "A22 22 0 0 1 0 " + (FRONT_H - 22) + "Z";

  const PRESETS = {
    aurora:  { style: "streak", colors: ["#f4efe9", "#e9c2b8", "#c2433f", "#2a1e2a", "#22395e", "#6f97c2", "#e5edf4"], scale: .7, warp: 1.4, angle: -.62, gloss: .18, veins: 0 },
    ember:   { style: "marble", colors: ["#07090c", "#16252c", "#3d5f68", "#1a1416", "#a3201a", "#ef4a2b", "#ff8a5c"], scale: .62, warp: 3.2, angle: -.5, gloss: .55, veins: .6 },
    dusk:    { style: "marble", colors: ["#120c18", "#3e2850", "#8f6c9c", "#2b1a24", "#b3502f", "#eab08a", "#fbe7d2"], scale: .75, warp: 3.6, angle: .8, gloss: .5, veins: .5 },
    glacier: { style: "streak", colors: ["#f7f8fa", "#d9e2ea", "#9fb4c7", "#e8edf2", "#bccbd8", "#ffffff"], scale: .7, warp: 1.6, angle: .35, gloss: .25, veins: 0 },
    verdant: { style: "marble", colors: ["#070b08", "#173024", "#4f7a5a", "#141812", "#a7843a", "#e9cf87", "#fbf3d6"], scale: .7, warp: 3.4, angle: 2.1, gloss: .5, veins: .5 },
    // extra recipes for this app
    steel:   { style: "marble", colors: ["#06080d", "#0f1c33", "#2a4a7c", "#10131a", "#4c6fa8", "#a9c1e6", "#e8f0fb"], scale: .7, warp: 3.1, angle: 1.2, gloss: .5, veins: .45 },
    slate:   { style: "marble", colors: ["#0b0b0d", "#242428", "#55555d", "#17171a", "#7a6a55", "#cdb68f", "#f3e8d3"], scale: .72, warp: 3.3, angle: -1.1, gloss: .45, veins: .5 },
  };

  function hexToRgb(hex) {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0x808080;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function makeFbm(seed) {
    const r = rng(seed);
    const perm = new Uint8Array(512);
    const grad = new Float32Array(512);
    const p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; grad[i * 2] = Math.cos(a); grad[i * 2 + 1] = Math.sin(a); }
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const h00 = perm[X + perm[Y]] * 2, h10 = perm[X + 1 + perm[Y]] * 2, h01 = perm[X + perm[Y + 1]] * 2, h11 = perm[X + 1 + perm[Y + 1]] * 2;
      const d00 = grad[h00] * xf + grad[h00 + 1] * yf;
      const d10 = grad[h10] * (xf - 1) + grad[h10 + 1] * yf;
      const d01 = grad[h01] * xf + grad[h01 + 1] * (yf - 1);
      const d11 = grad[h11] * (xf - 1) + grad[h11 + 1] * (yf - 1);
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
      const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      return d00 + u * (d10 - d00) + v * (d01 - d00 + u * (d11 - d01 - d10 + d00));
    };
    return (x, y, octaves) => {
      let sum = 0, amp = .5;
      for (let i = 0; i < octaves; i++) {
        sum += amp * noise(x, y);
        const nx = 1.6 * x + 1.2 * y + 7.1;
        y = -1.2 * x + 1.6 * y + 3.3;
        x = nx; amp *= .5;
      }
      return sum;
    };
  }

  function createArtJob(width, height, recipe, seed) {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const colors = recipe.colors.length >= 2 ? recipe.colors : ["#111111", "#eeeeee"];
    const stops = colors.map((c, i) => ({ t: i / (colors.length - 1), c: hexToRgb(c) }));
    const scale = recipe.scale ?? .7, warp = recipe.warp ?? 3, gloss = recipe.gloss ?? .4, veins = recipe.veins ?? 0;
    const streak = recipe.style === "streak";
    const fbm = makeFbm(seed * 977 + 13);
    const r = rng(seed + 1);
    const ox = r() * 50, oy = r() * 50;
    const angle = (recipe.angle ?? 0) + (r() - .5) * .5;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const m = Math.min(w, h);
    const gw = Math.ceil(w / 2) + 3, gh = Math.ceil(h / 2) + 3;
    const G = new Float32Array(gw * gh), GQ = new Float32Array(gw * gh);
    const F = new Float32Array(w * h), Q = new Float32Array(w * h);
    const pixels = new Uint8ClampedArray(w * h * 4);
    let row = 0;

    const field = (gy) => {
      for (let gx = 0; gx < gw; gx++) {
        const u = ((gx - 1) * 2 - w / 2) / m, v = ((gy - 1) * 2 - h / 2) / m;
        let px = (u * ca - v * sa) * scale, py = (u * sa + v * ca) * scale;
        if (streak) { px *= .14; py *= 2.2; }
        px += ox; py += oy;
        const qx = fbm(px, py, 3), qy = fbm(px + 5.2, py + 1.3, 3);
        const rx = fbm(px + warp * qx + 1.7, py + warp * qy + 9.2, 3);
        const ry = fbm(px + warp * qx + 8.3, py + warp * qy + 2.8, 3);
        G[gy * gw + gx] = fbm(px + warp * rx, py + warp * ry, 4);
        GQ[gy * gw + gx] = Math.sqrt(qx * qx + qy * qy);
      }
    };
    const upsample = () => {
      const cr = (a, b, c, d) => (-a + 9 * b + 9 * c - d) / 16;
      const T = new Float32Array(w * gh);
      for (let gy = 0; gy < gh; gy++) {
        const rr = gy * gw;
        for (let x = 0; x < w; x++) {
          const c = (x >> 1) + 1;
          T[gy * w + x] = x & 1 ? cr(G[rr + c - 1], G[rr + c], G[rr + c + 1], G[rr + c + 2]) : G[rr + c];
        }
      }
      for (let y = 0; y < h; y++) {
        const c = (y >> 1) + 1;
        for (let x = 0; x < w; x++) {
          F[y * w + x] = y & 1 ? cr(T[(c - 1) * w + x], T[c * w + x], T[(c + 1) * w + x], T[(c + 2) * w + x]) : T[c * w + x];
          const gx = (x >> 1) + 1;
          const q0 = GQ[c * gw + gx];
          const qx = x & 1 ? (q0 + GQ[c * gw + gx + 1]) / 2 : q0;
          const q1 = y & 1 ? (x & 1 ? (GQ[(c + 1) * gw + gx] + GQ[(c + 1) * gw + gx + 1]) / 2 : GQ[(c + 1) * gw + gx]) : qx;
          Q[y * w + x] = (qx + q1) / 2;
        }
      }
    };
    const colorize = () => {
      const sample = [];
      const stride = Math.max(1, Math.floor(F.length / 4096));
      for (let i = 0; i < F.length; i += stride) sample.push(F[i]);
      sample.sort((a, b) => a - b);
      const lo = sample[Math.floor(sample.length * .02)], hi = sample[Math.floor(sample.length * .98)];
      const k = 1 / (hi - lo || 1);
      const lx = -.55, ly = -.65, lz = .52;
      const slope = k * m * .012;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let t = (F[i] - lo) * k;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          let j = 1;
          while (j < stops.length - 1 && stops[j].t < t) j++;
          const a = stops[j - 1], b = stops[j];
          let f = (t - a.t) / (b.t - a.t || 1);
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          f = f * f * (3 - 2 * f);
          const gx = (F[x < w - 1 ? i + 1 : i] - F[x > 0 ? i - 1 : i]) * slope;
          const gy = (F[y < h - 1 ? i + w : i] - F[y > 0 ? i - w : i]) * slope;
          const nd = (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1);
          const spec = Math.pow(nd > 0 ? nd : 0, 24) * gloss * 255;
          const silk = 1 + .035 * Math.sin(t * 150 + Q[i] * 24);
          const vein = veins * Math.max(0, 1 - Math.abs(Q[i] - .42) * 14) * .6;
          const lit = (.82 + .28 * nd) * silk * (1 - vein);
          pixels[i * 4] = (a.c[0] + (b.c[0] - a.c[0]) * f) * lit + spec;
          pixels[i * 4 + 1] = (a.c[1] + (b.c[1] - a.c[1]) * f) * lit + spec;
          pixels[i * 4 + 2] = (a.c[2] + (b.c[2] - a.c[2]) * f) * lit + spec;
          pixels[i * 4 + 3] = 255;
        }
      }
    };
    const step = (rows) => {
      if (row >= gh) return true;
      const end = Math.min(gh, row + Math.max(1, rows));
      while (row < end) field(row++);
      if (row < gh) return false;
      upsample(); colorize();
      return true;
    };
    return { width: w, height: h, pixels, step };
  }

  function fanSlot(index, count) { return count <= 1 ? 0 : (index / (count - 1)) * 2 - 1; }

  // ---- shared painter queue -------------------------------------------------
  const artCache = new Map();
  const queue = [];
  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    const tick = () => {
      const until = performance.now() + 7;
      while (queue.length && performance.now() < until) {
        const head = queue[0];
        if (head.job.step(4)) {
          queue.shift();
          const c = document.createElement("canvas");
          c.width = head.job.width; c.height = head.job.height;
          c.getContext("2d").putImageData(new ImageData(head.job.pixels, c.width, c.height), 0, 0);
          head.done(c);
        }
      }
      if (queue.length) requestAnimationFrame(tick); else pumping = false;
    };
    requestAnimationFrame(tick);
  }
  function paint(recipe, seed, w, h, priority) {
    const key = JSON.stringify([recipe, seed, w, h]);
    let p = artCache.get(key);
    if (!p) {
      p = new Promise((done) => {
        let at = queue.length;
        while (at > 1 && queue[at - 1].priority > priority) at--;
        queue.splice(at, 0, { job: createArtJob(w, h, recipe, seed), priority, done });
        pump();
      });
      artCache.set(key, p);
    }
    return p;
  }
  function artCanvas(recipe, seed, w, h, density, priority, className) {
    const c = document.createElement("canvas");
    c.className = className;
    c.setAttribute("aria-hidden", "true");
    c.style.width = w + "px"; c.style.height = h + "px"; c.style.maxWidth = "none";
    paint(recipe, seed, Math.round(w * density), Math.round(h * density), priority).then((src) => {
      c.width = src.width; c.height = src.height;
      c.getContext("2d").drawImage(src, 0, 0);
      c.dataset.ready = "1";
    });
    return c;
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  let uidCounter = 0;

  /**
   * opts: { label, meta, tone, art (preset name|recipe|'none'), seed, files:[{name, meta, sub, chip, chipTone, onSelect}],
   *         menu:[{label, onSelect, danger, disabled}], labelPlacement, width, appear, appearDelay, onToggle }
   */
  function create(opts) {
    const uid = "gf" + (++uidCounter);
    const width = opts.width || W;
    const k = width / W;
    const tone = opts.tone || "light";
    const files = opts.files || [];
    const menu = opts.menu || [];
    const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)) * k;
    let open = false, menuOpen = false;

    const root = el("div", "gf-root");
    root.dataset.tone = tone;
    root.dataset.place = opts.labelPlacement || "bottom-left";
    root.style.width = width + "px";
    root.style.height = (H + HEADROOM) * k + "px";
    if (opts.appear === false) root.dataset.entered = "1";

    const stage = el("div", "gf-stage");
    stage.style.transform = "translateY(" + HEADROOM * k + "px) scale(" + k + ")";
    const tilt = el("div", "gf-tilt");
    stage.appendChild(tilt);
    root.appendChild(stage);

    tilt.appendChild(el("div", "gf-shadow", { "aria-hidden": "true" }));

    // back panel + art
    const back = el("div", "gf-back", { "aria-hidden": "true" });
    back.style.clipPath = "path('" + BACK_PATH + "')";
    const artSpec = opts.art === undefined ? "aurora" : opts.art;
    if (artSpec !== "none") {
      const recipe = typeof artSpec === "string" ? PRESETS[artSpec] : artSpec;
      back.appendChild(artCanvas(recipe, opts.seed ?? 3, W + 24, H + 24, dpr, 0, "gf-art"));
    }
    back.appendChild(el("div", "gf-back-sheen"));
    tilt.appendChild(back);
    const backRim = svgEl("svg", { class: "gf-rim gf-back-rim", viewBox: "0 0 " + W + " " + H, "aria-hidden": "true" });
    backRim.appendChild(svgEl("path", { d: BACK_PATH }));
    tilt.appendChild(backRim);

    // front glass
    const front = el("div", "gf-front");
    front.style.clipPath = "path('" + FRONT_PATH + "')";
    front.appendChild(el("div", "gf-tint", { "aria-hidden": "true" }));
    front.appendChild(el("div", "gf-spec", { "aria-hidden": "true" }));
    const frontRim = svgEl("svg", { class: "gf-rim gf-front-rim", viewBox: "0 0 " + W + " " + FRONT_H, "aria-hidden": "true" });
    const defs = svgEl("defs");
    const lg = svgEl("linearGradient", { id: "gf-rim-" + uid, x1: "0", y1: "0", x2: "0", y2: "1" });
    [["0", ".95"], [".35", ".35"], ["1", ".12"]].forEach(([o, a]) => lg.appendChild(svgEl("stop", { offset: o, "stop-color": "#fff", "stop-opacity": a })));
    defs.appendChild(lg); frontRim.appendChild(defs);
    frontRim.appendChild(svgEl("path", { d: FRONT_PATH, stroke: "url(#gf-rim-" + uid + ")" }));
    front.appendChild(frontRim);
    const hit = el("button", "gf-hit", { type: "button", "aria-expanded": "false" });
    const count = opts.count != null ? opts.count : files.length;
    hit.setAttribute("aria-label", "Ouvrir " + opts.label + ", " + count);
    front.appendChild(hit);
    const label = el("div", "gf-label");
    const title = el("span", "gf-title"); title.textContent = opts.label || "";
    const meta = el("span", "gf-meta"); meta.textContent = opts.meta || "";
    label.appendChild(title); label.appendChild(meta);
    front.appendChild(label);
    tilt.appendChild(front);

    // files
    const filesWrap = el("div", "gf-files", { role: "list", "aria-label": (opts.label || "") + " contenu" });
    filesWrap.setAttribute("inert", "");
    const start = Math.max(0, files.length - MAX_VISIBLE);
    const visible = files.slice(start);
    visible.forEach((file, v) => {
      const slot = fanSlot(v, visible.length);
      const jitter = rng(hashString(file.name || "x") + v);
      const holder = el("div", "gf-sheet-slot", { role: "listitem" });
      const sheet = el("button", "gf-sheet", { type: "button" });
      sheet.style.setProperty("--gf-slot", slot);
      sheet.style.setProperty("--gf-depth", visible.length - 1 - v);
      sheet.style.setProperty("--gf-jx", ((jitter() - .5) * 10).toFixed(2) + "px");
      sheet.style.setProperty("--gf-jr", ((jitter() - .5) * 3.2).toFixed(2) + "deg");
      sheet.style.zIndex = v + 1;
      const head = el("span", "gf-sheet-head");
      const nm = el("span", "gf-sheet-name"); nm.textContent = file.name;
      head.appendChild(nm);
      if (file.meta) { const mt = el("span", "gf-sheet-meta"); mt.textContent = file.meta; head.appendChild(mt); }
      sheet.appendChild(head);
      const info = el("span", "gf-info");
      if (file.sub) { const s = el("span"); s.textContent = file.sub; info.appendChild(s); }
      if (file.chip) { const c = el("span", "gf-chip"); c.textContent = file.chip; if (file.chipTone) c.dataset.t = file.chipTone; info.appendChild(c); }
      sheet.appendChild(info);
      const lines = el("span", "gf-lines", { "aria-hidden": "true" });
      ["86%", "92%", "64%"].forEach((wd) => { const i = el("i"); i.style.width = wd; lines.appendChild(i); });
      sheet.appendChild(lines);
      sheet.addEventListener("click", () => { if (file.onSelect) file.onSelect(file); });
      holder.appendChild(sheet);
      filesWrap.appendChild(holder);
    });
    tilt.appendChild(filesWrap);

    // key + menu
    let key = null, menuEl = null;
    if (menu.length) {
      key = el("button", "gf-key gf-key--more", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Options pour " + opts.label });
      const g = svgEl("svg", { class: "gf-glyph gf-glyph--more", viewBox: "0 0 30 12", "aria-hidden": "true" });
      [1, 11, 21].forEach((x) => g.appendChild(svgEl("rect", { x, y: "1.5", width: "8", height: "9", rx: "3.4" })));
      key.appendChild(g);
      tilt.appendChild(key);
      menuEl = el("div", "gf-menu", { role: "menu", id: "gf-menu-" + uid });
      const items = [{ label: "Ouvrir / fermer le dossier", onSelect: () => setOpen(!open) }].concat(menu);
      items.forEach((it) => {
        const b = el("button", "gf-menu-item" + (it.danger ? " gf-menu-item--danger" : ""), { type: "button", role: "menuitem" });
        b.textContent = it.label;
        if (it.disabled) b.disabled = true;
        b.addEventListener("click", () => { setMenu(false); key.focus(); if (it.onSelect) it.onSelect(); });
        menuEl.appendChild(b);
      });
      tilt.appendChild(menuEl);
      key.addEventListener("click", () => setMenu(!menuOpen));
    }

    function setOpen(v) {
      open = v;
      if (v) root.dataset.open = "1"; else delete root.dataset.open;
      hit.setAttribute("aria-expanded", String(v));
      if (v) filesWrap.removeAttribute("inert"); else filesWrap.setAttribute("inert", "");
      if (opts.onToggle) opts.onToggle(v, api);
    }
    function setMenu(v) {
      menuOpen = v;
      if (!menuEl) return;
      if (v) menuEl.dataset.open = "1"; else delete menuEl.dataset.open;
      key.setAttribute("aria-expanded", String(v));
      if (v) { const f = menuEl.querySelector("[role=menuitem]"); if (f) f.focus(); }
    }
    hit.addEventListener("click", () => { setMenu(false); setOpen(!open); });

    // pointer parallax
    let raf = 0, px = 0, py = 0;
    const write = () => { raf = 0; root.style.setProperty("--gf-px", px.toFixed(3)); root.style.setProperty("--gf-py", py.toFixed(3)); };
    root.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = root.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width) * 2 - 1;
      py = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(write);
    });
    root.addEventListener("pointerleave", () => { px = 0; py = 0; if (!raf) raf = requestAnimationFrame(write); });

    // Escape / outside press
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (menuOpen) { setMenu(false); key && key.focus(); }
      else if (open) { setOpen(false); hit.focus(); }
    };
    const onDown = (e) => {
      const t = e.target;
      if (menuOpen && !menuEl.contains(t) && !key.contains(t)) setMenu(false);
      if (open && !menuOpen && !root.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);

    // entrance
    if (opts.appear !== false) {
      const enter = () => { root.dataset.entered = "1"; };
      if (typeof IntersectionObserver === "undefined") enter();
      else {
        const io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          setTimeout(enter, opts.appearDelay || 0);
        }, { threshold: .15 });
        io.observe(root);
      }
    }

    const api = {
      el: root,
      setOpen,
      destroy() {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("pointerdown", onDown);
        root.remove();
      },
    };
    return api;
  }

  return { create, PRESETS };
})();

