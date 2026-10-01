(function () {
  const D2R = Math.PI / 180;
  const el = document.getElementById("globeBox");
  const tip = document.getElementById("globeTip");

  let cv = null;
  let ctx = null;
  let tex = null;
  let raf = 0;
  let on = false;
  let running = false;

  const view = { lng: 78, lat: 22, zoom: 1 };
  const ZMIN = 0.75, ZMAX = 9;
  let R = 200;
  let W = 600;
  let H = 360;
  let dragging = false;
  let dirty = true;
  let moved = 0;
  let downPx = { x: 0, y: 0 };
  let downT = 0;
  let hitPoints = [];
  let hitArcs = [];

  const ACTIVE = "#0e6fd8";
  const DIM = "rgba(148,163,184,0.5)";

  function portsGeo() { return window.PORTS_GEO || {}; }

  const SRC = "img/ocean.jpg";

  function activeLane() {
    return LANES.find((l) => l.id === state.laneId) || LANES[0];
  }
  function endpoint(l, first) {
    return first ? l.way[0] : l.way[l.way.length - 1];
  }

  function ll(lat, lng) {
    const p = lat * D2R, L = lng * D2R;
    return [Math.cos(p) * Math.cos(L), Math.cos(p) * Math.sin(L), Math.sin(p)];
  }
  function toView(v) {
    const lat = Math.asin(Math.max(-1, Math.min(1, v[2])));
    const cp = Math.cos(lat), sp = v[2];
    const dl = Math.atan2(v[1], v[0]) - view.lng * D2R;
    const cd = Math.cos(dl), sd = Math.sin(dl);
    const la = view.lat * D2R, cl = Math.cos(la), sl = Math.sin(la);
    return [cp * sd, cl * sp - sl * cp * cd, sl * sp + cl * cp * cd];
  }
  function toWorld(v) {
    const la = view.lat * D2R, cl = Math.cos(la), sl = Math.sin(la);
    const y = v[1], z = v[2];
    const lat = Math.asin(Math.max(-1, Math.min(1, y * cl + z * sl)));
    const dl = Math.atan2(v[0], -y * sl + z * cl);
    return ll(lat / D2R, dl / D2R + view.lng);
  }

  const TEXW = 2048, TEXH = 1024;

  function loadTexture() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = TEXW;
          c.height = TEXH;
          const cx = c.getContext("2d");
          try { cx.filter = "brightness(1.3) saturate(1.45)"; } catch (e) { }
          const iw = img.naturalWidth || TEXW, ih = img.naturalHeight || TEXH;
          const k = Math.min(TEXW / iw, TEXH / ih);
          const dw = iw * k, dh = ih * k;
          cx.drawImage(img, (TEXW - dw) / 2, (TEXH - dh) / 2, dw, dh);
          drawGraticule(cx, TEXW, TEXH);
          resolve(cx.getImageData(0, 0, TEXW, TEXH));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = SRC;
    });
  }
  function drawGraticule(cx, W2, H2) {
    try {
      cx.strokeStyle = "rgba(255,255,255,0.16)";
      cx.lineWidth = 1;
      for (let lat = -75; lat <= 75; lat += 15) {
        if (lat === 0) continue;
        cx.beginPath(); cx.moveTo(0, ((90 - lat) / 180) * H2); cx.lineTo(W2, ((90 - lat) / 180) * H2); cx.stroke();
      }
      for (let lng = -180; lng < 180; lng += 15) {
        if (lng === 0 || lng === 180) continue;
        cx.beginPath(); cx.moveTo(((lng + 180) / 360) * W2, 0); cx.lineTo(((lng + 180) / 360) * W2, H2); cx.stroke();
      }
      cx.strokeStyle = "rgba(255,255,255,0.28)";
      cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(0, H2 / 2); cx.lineTo(W2, H2 / 2); cx.stroke();
      cx.beginPath(); cx.moveTo(W2 / 2, 0); cx.lineTo(W2 / 2, H2); cx.stroke();
    } catch (e) { }
  }

  function makeFallbackTexture(sz, h) {
    const c = document.createElement("canvas");
    c.width = sz; c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#1e6fb5";
    x.fillRect(0, 0, sz, h);
    x.fillStyle = "#3f9e4d";
    [[0.38, 0.30, 0.10, 0.16], [0.46, 0.44, 0.12, 0.07], [0.62, 0.28, 0.06, 0.12], [0.55, 0.34, 0.16, 0.10], [0.70, 0.36, 0.20, 0.10], [0.25, 0.36, 0.14, 0.12], [0.12, 0.50, 0.16, 0.14], [0.82, 0.30, 0.14, 0.10]].forEach((b) => {
      x.beginPath(); x.ellipse(b[0] * sz, b[1] * h, b[2] * sz, b[3] * h, 0, 0, Math.PI * 2); x.fill();
    });
    x.fillStyle = "#eef7ff";
    x.fillRect(0, 0, sz, h * 0.035);
    x.fillRect(0, h * 0.965, sz, h * 0.035);
    drawGraticule(x, sz, h);
    return x.getImageData(0, 0, sz, h);
  }

  function makeCloudTexture(sz, h) {
    const c = document.createElement("canvas");
    c.width = sz; c.height = h;
    const g = c.getContext("2d");
    const img = g.getImageData(0, 0, sz, h);
    const d = img.data;
    const NX = 96, NY = 48;
    const base = new Float32Array(NX * NY);
    let s = 12345;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < base.length; i++) base[i] = rnd();
    const at = (x, y, w, h2) => {
      x = ((x % w) + w) % w;
      y = ((y % h2) + h2) % h2;
      return base[(y | 0) * w + (x | 0)];
    };
    function noise(x, y, w, h2) {
      const X = Math.floor(x), Y = Math.floor(y);
      const fx = x - X, fy = y - Y;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = at(X, Y, w, h2), b = at(X + 1, Y, w, h2);
      const o = at(X, Y + 1, w, h2), p = at(X + 1, Y + 1, w, h2);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (o * (1 - sx) + p * sx) * sy;
    }
    for (let y = 0; y < h; y++) {
      const lat = y / h;
      for (let x = 0; x < sz; x++) {
        const lng = x / sz;
        let v = noise(lng * NX, lat * NY, NX, NY);
        v = v * 0.6 + noise(lng * NX * 2, lat * NY * 2, NX * 2, NY * 2) * 0.4;
        let a = (v - 0.42) * 3.2;
        if (a < 0) a = 0;
        if (a > 1) a = 1;
        a = Math.pow(a, 1.15);
        const i = (y * sz + x) * 4;
        d[i] = Math.round(255 * a);
        d[i + 1] = Math.round(255 * a);
        d[i + 2] = Math.round(255 * a);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return img;
  }

  function sizeCanvas() {
    const cw = el.clientWidth || 600;
    const ch = el.clientHeight || 360;
    W = Math.max(320, Math.min(820, cw));
    H = Math.max(200, Math.min(520, ch));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    R = Math.max(120, Math.round(Math.min(W, H) * 0.46 * view.zoom));
  }

  function sample(u, v) {
    const TW = tex.width, TH = tex.height;
    let ui = ((u * TW) | 0);
    let vi = ((v * TH) | 0);
    if (ui < 0) ui = 0; if (ui > TW - 1) ui = TW - 1;
    if (vi < 0) vi = 0; if (vi > TH - 1) vi = TH - 1;
    const i = (vi * TW + ui) * 4;
    const d = tex.data;
    return [(d[i]), (d[i + 1]), (d[i + 2])];
  }

  const LIGHT = [0.38, -0.16, 0.91];
  let clouds = null;
  let cd = null;
  let CW = 0;
  let CH = 0;
  let spaceBuf = null;
  let spaceW = 0;
  let spaceH = 0;
  function ensureSpace() {
    if (spaceBuf && spaceW === W && spaceH === H) return;
    spaceW = W; spaceH = H;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#0b132b");
    gr.addColorStop(1, "#0e2233");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 240; i++) {
      g.fillStyle = "rgba(210,238,255," + (0.25 + rnd() * 0.6).toFixed(2) + ")";
      g.fillRect(rnd() * W, rnd() * H, 1.4, 1.4);
    }
    spaceBuf = new Uint8ClampedArray(g.getImageData(0, 0, W, H).data);
  }

  function render() {
    if (!running || !ctx || !tex) return;
    ensureSpace();
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const TW = tex.width, TH = tex.height;
    const td = tex.data;
    const cx = W / 2, cy = H / 2;
    const one = 1 / R;
    const uvw = [0, 0, 0];
    const twopi = Math.PI * 2;
    const halfpi = Math.PI / 2;

    for (let y = 0; y < H; y++) {
      const dy = (y - cy) * one;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const pi = (row + x) * 4;
        const dx = (x - cx) * one;
        const rs = dx * dx + dy * dy;
        if (rs > 1) {
          const bpi = pi;
          d[bpi] = spaceBuf[bpi]; d[bpi + 1] = spaceBuf[bpi + 1]; d[bpi + 2] = spaceBuf[bpi + 2]; d[bpi + 3] = 255;
          continue;
        }
        const z = Math.sqrt(1 - rs);
        uvw[0] = dx; uvw[1] = -dy; uvw[2] = z;
        const wn = toWorld(uvw);
        const lat = Math.asin(wn[2]);
        let lng = Math.atan2(wn[1], wn[0]);
        if (lng < -Math.PI) lng += twopi;
        if (lng > Math.PI) lng -= twopi;
        const u = (lng / twopi + 0.5);
        const v = 0.5 - lat / Math.PI;
        const uf = u * TW - 0.5;
        const vf = v * TH - 0.5;
        let x0 = Math.floor(uf);
        let y0 = Math.floor(vf);
        const fx = uf - x0;
        const fy = vf - y0;
        const x1 = x0 + 1 >= TW ? TW - 1 : x0 + 1;
        const y1 = y0 + 1 >= TH ? TH - 1 : y0 + 1;
        if (x0 < 0) x0 = 0;
        if (y0 < 0) y0 = 0;
        const wx0 = (1 - fx), wx1 = fx, wy0 = (1 - fy), wy1 = fy;
        const i00 = (y0 * TW + x0) * 4, i01 = (y0 * TW + x1) * 4;
        const i10 = (y1 * TW + x0) * 4, i11 = (y1 * TW + x1) * 4;
        let cr = (td[i00] * wx0 + td[i01] * wx1) * wy0 + (td[i10] * wx0 + td[i11] * wx1) * wy1;
        let cg = (td[i00 + 1] * wx0 + td[i01 + 1] * wx1) * wy0 + (td[i10 + 1] * wx0 + td[i11 + 1] * wx1) * wy1;
        let cb = (td[i00 + 2] * wx0 + td[i01 + 2] * wx1) * wy0 + (td[i10 + 2] * wx0 + td[i11 + 2] * wx1) * wy1;

        let diff = wn[0] * LIGHT[0] + wn[1] * LIGHT[1] + wn[2] * LIGHT[2];
        if (diff < 0) diff = 0;
        const ocean = cb > cr + 18;
        const spec = ocean ? Math.pow(diff, 6) * 0.55 : 0;
        let b = 0.34 + 0.9 * Math.pow(diff, 1.25);
        const limb = 0.82 + 0.18 * Math.pow(z, 1.6);
        b *= limb;
        if (b > 1) {
          cr += (255 - cr) * (b - 1);
          cg += (255 - cg) * (b - 1);
          cb += (255 - cb) * (b - 1);
        } else {
          cr *= b; cg *= b; cb *= b;
        }
        cr += spec * 255; cg += spec * 255; cb += spec * 255;
        const warm = 0.06 * diff;
        cr += warm * 40; cg += warm * 18;

        if (clouds) {
          const cu = u;
          const cv = v;
          const cf = cu * CW - 0.5;
          const cvf = cv * CH - 0.5;
          let cx0 = Math.floor(cf);
          let cy0 = Math.floor(cvf);
          const cfx = cf - cx0;
          const cfy = cvf - cy0;
          const cx1 = cx0 + 1 >= CW ? CW - 1 : cx0 + 1;
          const cy1 = cy0 + 1 >= CH ? CH - 1 : cy0 + 1;
          if (cx0 < 0) cx0 = 0;
          if (cy0 < 0) cy0 = 0;
          const wcx0 = (1 - cfx), wcx1 = cfx, wcy0 = (1 - cfy), wcy1 = cfy;
          const j00 = (cy0 * CW + cx0) * 4, j01 = (cy0 * CW + cx1) * 4;
          const j10 = (cy1 * CW + cx0) * 4, j11 = (cy1 * CW + cx1) * 4;
          const ca = ((cd[j00] * wcx0 + cd[j01] * wcx1) * wcy0 + (cd[j10] * wcx0 + cd[j11] * wcx1) * wcy1) / 255;
          let a = (ca - 0.5) * 4.0;
          if (a < 0) a = 0;
          if (a > 1) a = 1;
          a *= 0.72;
          if (a > 0) {
            const ccR = 236, ccG = 244, ccB = 252;
            cr = cr * (1 - a) + ccR * a;
            cg = cg * (1 - a) + ccG * a;
            cb = cb * (1 - a) + ccB * a;
          }
        }

        if (cr > 255) cr = 255;
        if (cg > 255) cg = 255;
        if (cb > 255) cb = 255;
        d[pi] = cr; d[pi + 1] = cg; d[pi + 2] = cb; d[pi + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function project(v) {
    const wv = toView(v);
    return { x: W / 2 + R * wv[0], y: H / 2 - R * wv[1], z: wv[2] };
  }
  function slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    d = Math.max(-1, Math.min(1, d));
    const o = Math.acos(d);
    if (o < 0.001) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const sa = Math.sin((1 - t) * o) / Math.sin(o);
    const sb = Math.sin(t * o) / Math.sin(o);
    return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb];
  }

  function laneHops() {
    const hops = [];
    LANES.forEach((l) => {
      for (let i = 0; i < l.way.length - 1; i++) {
        hops.push({ lane: l, a: ll(l.way[i][1], l.way[i][0]), b: ll(l.way[i + 1][1], l.way[i + 1][0]) });
      }
    });
    return hops;
  }
  function arcPoints(a, b) {
    const pts = [];
    /* Sample count scales with how far the hop actually reaches, so a lane with
       many short surveyed waypoints costs no more to draw than a sparse one. */
    const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    const N = Math.max(4, Math.min(48, Math.ceil(ang * 26)));
    for (let i = 0; i <= N; i++) {
      const w = slerp(a, b, i / N);
      const p = project(w);
      const r = Math.sqrt(Math.pow((p.x - W / 2) / R, 2) + Math.pow((p.y - H / 2) / R, 2));
      p.vis = p.z > 0.01 && r <= 1.01;
      pts.push(p);
    }
    return pts;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawGlow();
    render();
    const hops = laneHops();
    const act = activeLane().id;
    const mk = Math.max(0.45, Math.min(1.7, 1 / Math.pow(view.zoom, 0.55)));
    hitArcs = [];
    hops.forEach((h) => {
      const isAct = h.lane.id === act;
      const pts = arcPoints(h.a, h.b);
      hitArcs.push({ laneId: h.lane.id, pts: pts.slice() });
      ctx.beginPath();
      let started = false;
      ctx.lineWidth = isAct ? 2.6 * mk : 1;
      ctx.strokeStyle = isAct ? ACTIVE : DIM;
      ctx.globalAlpha = isAct ? 0.95 : 0.5;
      if (isAct) { ctx.setLineDash([2.2 * mk, 3.4 * mk]); ctx.lineCap = "round"; }
      else ctx.setLineDash([]);
      let lastV = null;
      pts.forEach((p) => {
        if (p.vis) {
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
          lastV = p;
        } else {
          if (started && lastV) {
            ctx.stroke();
            ctx.beginPath();
            started = false;
          }
        }
      });
      if (started) ctx.stroke();
      ctx.globalAlpha = 1;
    });

    hitPoints = [];
    const layer = activeLane();
    const a = endpoint(layer, true);
    const b = endpoint(layer, false);
    const marks = [
      { lat: a[1], lng: a[0], color: "#dc2626", label: "Load · " + layer.load, r: 5 },
      { lat: b[1], lng: b[0], color: "#059669", label: "Discharge · " + layer.discharge, r: 5 }
    ];
    const PG = portsGeo();
    const near = (g, e) => Math.abs(g.lat - e[1]) < 0.01 && Math.abs(((g.lng - e[0] + 540) % 360) - 180) < 0.01;
    Object.keys(PG).forEach((name) => {
      const g = PG[name];
      if (near(g, a) || near(g, b)) return;
      marks.push({ lat: g.lat, lng: g.lng, color: "#ffffff", label: name, r: 3.5 });
    });
    marks.forEach((m) => {
      const w = ll(m.lat, m.lng);
      const p = project(w);
      if (!(p.z > 0.01)) return;
      const key = m.label.indexOf("·") >= 0;
      const big = key || view.zoom > 1.9;
      const rr2 = m.r * mk;
      hitPoints.push({ label: m.label, x: p.x, y: p.y, r: rr2 + 5 });
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr2, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(11,19,43,0.6)";
      ctx.stroke();
      if (big) {
        const nm = m.label.replace(/^(Load|Discharge) · /, "");
        const txt = m.label.indexOf("Load") === 0 ? "▲ " + nm : m.label.indexOf("Discharge") === 0 ? "● " + nm : nm;
        ctx.font = "700 " + (11 * mk).toFixed(1) + "px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(txt).width;
        const bx = p.x + rr2 + 5, by = p.y - 8 * mk;
        ctx.fillStyle = "rgba(9,16,38,0.78)";
        roundRect(bx, by, tw + 8, 16 * mk, 4);
        ctx.fill();
        ctx.fillStyle = key ? "#ffffff" : "rgba(226,240,255,0.92)";
        ctx.fillText(txt, bx + 4, by + 8 * mk);
      }
    });

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(210,235,255,0.55)";
    ctx.fillText("GLOBEv28 · " + view.zoom.toFixed(1) + "× · dotted = active route", W - 10, H - 8);
  }

  function drawGlow() {
    const cx = W / 2, cy = H / 2;
    const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.28);
    g.addColorStop(0, "rgba(124,192,255,0.0)");
    g.addColorStop(0.5, "rgba(124,192,255,0.3)");
    g.addColorStop(1, "rgba(124,192,255,0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 1.06);
    g2.addColorStop(0, "rgba(173,216,255,0.0)");
    g2.addColorStop(0.6, "rgba(173,216,255,0.18)");
    g2.addColorStop(1, "rgba(173,216,255,0.0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.99, 0, Math.PI * 2);
    ctx.stroke();
  }

  function tipAt(x, y, html) {
    if (!tip) return;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    tip.innerHTML = html;
    tip.classList.add("show");
  }

  function onMove(e) {
    if (!running) return;
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    let arc = null;
    for (const h of hitArcs) {
      for (const p of h.pts) {
        if (!p.vis) continue;
        if (Math.abs(p.x - mx) < 5 && Math.abs(p.y - my) < 5) { arc = h; break; }
      }
      if (arc) break;
    }
    if (arc) {
      const lane = LANES.find((l) => l.id === arc.laneId);
      tipAt(rect.left + mx / (W / rect.width) + 10, rect.top + my / (H / rect.height) + 14,
        "<b>" + lane.name + "</b> · " + lane.sea.toLocaleString() + " nm · weather risk " + lane.risk + "/100 <span style='color:#0e7490'>— click to focus</span>");
      el.style.cursor = "pointer";
    } else {
      let pt = null;
      for (const p of hitPoints) {
        if (Math.abs(p.x - mx) < p.r && Math.abs(p.y - my) < p.r) { pt = p; break; }
      }
      if (pt) {
        tipAt(rect.left + mx / (W / rect.width) + 10, rect.top + my / (H / rect.height) + 14,
          "<b>" + pt.label.replace(/^(Load|Discharge) · /, "") + "</b> <span style='color:#64748b'>— click for details</span>");
        el.style.cursor = "pointer";
      } else {
        if (tip) tip.classList.remove("show");
        el.style.cursor = dragging ? "grabbing" : "grab";
      }
    }
  }

  function onDown(e) {
    dragging = true;
    downPx = { x: e.clientX, y: e.clientY };
    downT = Date.now();
    moved = 0;
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    if (moved < 5 && Date.now() - downT < 400) {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top) * (H / rect.height);
      let hit = null;
      for (const p of hitPoints) {
        if (Math.abs(p.x - mx) < p.r && Math.abs(p.y - my) < p.r) { hit = p; break; }
      }
      if (hit) {
        const name = hit.label.replace(/^(Load|Discharge)\u00b7 /, "");
        if (PORTS && Object.values(PORTS).some((q) => q.name === name)) {
          if (renderPortModal) renderPortModal(name);
          else loadInfoModal(name);
        } else {
          loadInfoModal(name);
        }
        return;
      }
      let arc = null;
      for (const h of hitArcs) {
        for (const p of h.pts) {
          if (!p.vis) continue;
          if (Math.abs(p.x - mx) < 6 && Math.abs(p.y - my) < 6) { arc = h; break; }
        }
        if (arc) break;
      }
      if (arc) {
        setLane(arc.laneId);
        tipAt(rect.left + mx / (W / rect.width) + 10, rect.top + my / (H / rect.height) + 14,
          "<b>→ " + activeLane().name + "</b> selected · watch its card for the signal");
        setTimeout(() => { if (tip) tip.classList.remove("show"); }, 2600);
      }
    }
  }
  function onDrag(e) {
    if (!dragging || !running) return;
    const dx = e.clientX - downPx.x;
    const dy = e.clientY - downPx.y;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    const k = 57.2958 / Math.max(60, R);
    view.lng -= dx * k;
    view.lat = Math.max(-72, Math.min(72, view.lat - dy * k));
    downPx = { x: e.clientX, y: e.clientY };
    dirty = true;
  }
  function radiusFor(z) { return Math.max(120, Math.round(Math.min(W, H) * 0.46 * z)); }
  function unproject(sx, sy, rad) {
    const rr = rad || R;
    const nx = (sx - W / 2) / rr, ny = (H / 2 - sy) / rr;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return null;
    const nz = Math.sqrt(1 - r2);
    return toWorld([nx, ny, nz]);
  }
  function screenOf(w, rad) {
    const v = toView(w), rr = rad || R;
    return { x: W / 2 + rr * v[0], y: H / 2 - rr * v[1], z: v[2] };
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top) * (H / rect.height);
    const old = view.zoom;
    const next = Math.max(ZMIN, Math.min(ZMAX, old * Math.pow(0.9988, e.deltaY)));
    if (Math.abs(next - old) < 1e-9) return;
    const nx = (sx - W / 2) / R, ny = (H / 2 - sy) / R;
    const r2 = nx * nx + ny * ny;
    if (r2 < 1) {
      const anchor = toWorld([nx, ny, Math.sqrt(1 - r2)]);
      view.zoom = next;
      const Rnew = radiusFor(next);
      for (let it = 0; it < 6; it++) {
        const v = toView(anchor);
        const px2 = W / 2 + Rnew * v[0];
        const py2 = H / 2 - Rnew * v[1];
        const dx = px2 - sx, dy = py2 - sy;
        if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35) break;
        const la = view.lat * D2R, cl = Math.cos(la), sl = Math.sin(la);
        const dl = (Math.atan2(anchor[1], anchor[0]) - view.lng * D2R);
        const cp = Math.cos(Math.asin(Math.max(-1, Math.min(1, anchor[2]))));
        const j11 = -Rnew * cp * Math.cos(dl);
        const j21 = -Rnew * sl * cp * Math.sin(dl);
        const j22 = Rnew * v[2];
        if (Math.abs(j11) < 1e-6) break;
        let dLng = -dx / j11;
        let dLat = 0;
        if (Math.abs(j22) > 1e-6) dLat = (-dy - j21 * dLng) / j22;
        const nLng = view.lng + dLng / D2R;
        const nLat = view.lat + dLat / D2R;
        if (nLat > -72 && nLat < 72) { view.lat = nLat; view.lng = nLng; }
        else if (nLng !== view.lng) { view.lng = nLng; }
      }
    } else {
      view.zoom = next;
    }
    dirty = true;
    announceZoom();
  }
  let lastAnnounced = -1;
  function announceZoom() {
    if (view.zoom === lastAnnounced) return;
    lastAnnounced = view.zoom;
    const el = document.getElementById("zoomLvl");
    if (el) el.textContent = view.zoom.toFixed(1) + "×";
    if (window.onGlobeZoom) { try { window.onGlobeZoom(view.zoom); } catch (e) { } }
  }
  function setZoom(z, lat, lng) {
    view.zoom = Math.max(ZMIN, Math.min(ZMAX, z));
    if (lat !== undefined) view.lat = Math.max(-72, Math.min(72, lat));
    if (lng !== undefined) view.lng = lng;
    dirty = true;
    announceZoom();
  }
  function laneCenter() {
    const l = activeLane();
    const w = l.way;
    /* weight each waypoint by the length of the legs meeting it, so uneven vertex
       spacing (a surveyed strait has many) does not drag the focus off the voyage */
    let sx = 0, sy = 0, sz = 0, tw = 0;
    for (let i = 0; i < w.length; i++) {
      const p = w[i];
      const prev = w[i > 0 ? i - 1 : 0], next = w[i < w.length - 1 ? i + 1 : w.length - 1];
      const wt = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      const v = ll(p[1], p[0]);
      sx += v[0] * wt; sy += v[1] * wt; sz += v[2] * wt; tw += wt;
    }
    const v = tw > 0 ? [sx / tw, sy / tw, sz / tw] : [0, 0, 0];
    const m = Math.hypot(v[0], v[1], v[2]) || 1;
    v[0] /= m; v[1] /= m; v[2] /= m;
    return { lat: Math.asin(v[2]) / D2R, lng: Math.atan2(v[1], v[0]) / D2R };
  }
  window.zoomGlobe = setZoom;
  window.focusGlobeLane = function (z) {
    const c = laneCenter();
    setZoom(z === undefined ? 2.4 : z, c.lat, c.lng);
  };
  window.globeZoom = function () { return view.zoom; };
  function onResize() { dirty = true; }

  function frame() {
    if (!running) return;
    if (dirty) {
      dirty = false;
      sizeCanvas();
      draw();
    }
    raf = requestAnimationFrame(frame);
  }

  function refresh() {
    if (running) dirty = true;
  }

  function teardown() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    on = false;
    window.globeActive = false;
    if (tip) tip.classList.remove("show");
  }

  window.teardownGlobe = function () {
    teardown();
    if (el) el.innerHTML = "";
    cv = null; ctx = null;
  };

  window.refreshGlobe = refresh;

  function bind() {
    cv.addEventListener("mousedown", onDown);
    cv.addEventListener("mousemove", (e) => { onMove(e); if (dragging) onDrag(e); });
    window.addEventListener("mouseup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("touchstart", (e) => { const t = e.touches[0]; onDown({ clientX: t.clientX, clientY: t.clientY }); }, { passive: true });
    cv.addEventListener("touchmove", (e) => { const t = e.touches[0]; onDrag({ clientX: t.clientX, clientY: t.clientY }); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchend", (e) => onUp({ clientX: 0, clientY: 0 }), { passive: true });
    window.addEventListener("resize", onResize);
  }

  window.setupGlobe = function () {
    try {
      teardown();
      if (!el) { window.globeActive = false; return false; }
      if (!cv) {
        cv = document.createElement("canvas");
        cv.id = "globe2d";
        cv.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab;";
        el.appendChild(cv);
        ctx = cv.getContext("2d");
      }
      if (!ctx) { window.globeActive = false; return false; }
      winHint();
      bind();
      on = true;
      running = true;
      window.globeActive = true;
      dirty = true;
      loadTexture().then((td) => {
        tex = td || makeFallbackTexture(1024, 512);
        try {
          clouds = makeCloudTexture(1024, 512);
          cd = clouds.data;
          CW = clouds.width;
          CH = clouds.height;
        } catch (e) { clouds = null; }
        window.globe2dTex = tex.width + "x" + tex.height;
        if (running) { sizeCanvas(); dirty = true; announceZoom(); }
      });
      raf = requestAnimationFrame(frame);
      return true;
    } catch (e) {
      if (window.console && console.error) console.error("[globe2d] failed:", e && e.message ? e.message : e);
      teardown();
      return false;
    }
  };

  function winHint() {
    try {
      const h = document.createElement("div");
      h.id = "globe2dHint";
      h.style.cssText = "position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);font:600 13px/1 system-ui;color:#fff;background:rgba(2,6,23,.45);padding:6px 12px;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .5s;z-index:5;";
      h.textContent = "dotted line = your route · scroll to zoom in on a port · + / − / fit route";
      el.appendChild(h);
      setTimeout(() => { h.style.opacity = ".95"; }, 400);
      setTimeout(() => { h.style.opacity = "0"; }, 4200);
    } catch (e) { }
  }
})();
