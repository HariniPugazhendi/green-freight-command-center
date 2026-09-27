/* SEA-INTEL · minimal canvas chart helpers: line, bar, donut */
(function () {
  window.CK = window.CK || {};
  const DPR = () => Math.min(2, (window.devicePixelRatio || 1));

  function setup(cv, h) {
    const dpr = DPR();
    const w = cv.parentElement.clientWidth || 320;
    const hh = h || cv.getAttribute("data-h") || 280;
    cv.width = w * dpr; cv.height = hh * dpr;
    cv.style.width = w + "px"; cv.style.height = hh + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hh, pad: { l: 44, r: 14, t: 14, b: 26 } };
  }

  window.CK.line = function (cv, opts) {
    const { ctx, w, h, pad } = setup(cv);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const labels = opts.labels || [];
    const series = opts.series || [];
    const xs = series.flatMap((s) => s.pts).flat();
    let lo = Math.min(...xs), hi = Math.max(...xs);
    const span = hi - lo || 1; lo -= span * 0.12; hi += span * 0.12;
    const n = series[0] ? series[0].pts.length : 0;
    const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, n - 1);
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    // grid
    ctx.strokeStyle = "#c4d0e2"; ctx.fillStyle = "#6b7d97";
    ctx.font = "600 10px ui-monospace, monospace"; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gv = lo + (hi - lo) * g / 4;
      const y = Y(gv);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(gv.toFixed(1), 4, y + 4);
    }
    labels.forEach((lb, i) => { ctx.textAlign = "center"; ctx.fillText(lb, X(i), h - 10); });
    series.forEach((s, si) => {
      const col = s.color || ["#22d3ee", "#34d399", "#fbbf24", "#f87171"][si % 4];
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      s.pts.forEach((v, i) => { i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); });
      ctx.stroke();
      // fills
      if (s.fill !== false) {
        ctx.lineTo(X(n - 1), Y(lo)); ctx.lineTo(X(0), Y(lo)); ctx.closePath();
        const grad = ctx.createLinearGradient(0, pad.t, 0, h);
        grad.addColorStop(0, col + "55"); grad.addColorStop(1, col + "00");
        ctx.fillStyle = grad; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
        s.pts.forEach((v, i) => { i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); });
        ctx.stroke();
      }
      s.pts.forEach((v, i) => { if (s.dots) { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.4, 0, 7); ctx.fillStyle = col; ctx.fill(); } });
    });
    // hover
    cv.onmousemove = function () { };
    mkTip(cv, ctx, w, h, pad, X, Y, series, labels);
  };

  window.CK.bar = function (cv, opts) {
    const { ctx, w, h, pad } = setup(cv);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const labels = opts.labels || [];
    const vals = opts.values || [];
    const cols = opts.colors || [];
    const hi = Math.max(...vals, 1) * 1.12;
    const bw = (w - pad.l - pad.r) / Math.max(1, vals.length);
    ctx.fillStyle = "#6b7d97"; ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = "center";
    vals.forEach((v, i) => {
      const x = pad.l + i * bw + bw / 2;
      const bh = (v / hi) * (h - pad.t - pad.b);
      const y0 = h - pad.b;
      const col = (cols[i] || "#22d3ee");
      const grad = ctx.createLinearGradient(0, y0 - bh, 0, y0);
      grad.addColorStop(0, col); grad.addColorStop(1, col + "66");
      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = 4;
      ctx.roundRect(x - bw / 2 + 6, y0 - bh, bw - 12, bh, [r, r, 0, 0]);
      ctx.fill();
      ctx.fillStyle = "#22324b"; ctx.font = "700 10px ui-monospace, monospace";
      ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)), x, y0 - bh - 5);
      ctx.fillStyle = "#6b7d97"; ctx.font = "600 10px system-ui";
      ctx.fillText(labels[i] || "", x, y0 + 15);
    });
  };

  window.CK.donut = function (cv, opts) {
    const { ctx, w, h, pad } = setup(cv);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const segs = opts.segments || [];
    const total = segs.reduce((a, s) => a + s.v, 0) || 1;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 18;
    let a0 = -Math.PI / 2;
    segs.forEach((s) => {
      const a1 = a0 + (s.v / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
      ctx.fillStyle = s.c || "#22d3ee"; ctx.fill();
      a0 = a1;
    });
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, 7); ctx.fillStyle = "#0a1223"; ctx.fill();
    ctx.fillStyle = "#22324b"; ctx.font = "800 20px system-ui"; ctx.textAlign = "center";
    ctx.fillText(opts.center || "", cx, cy + 3);
    ctx.fillStyle = "#6b7d97"; ctx.font = "600 9px system-ui";
    ctx.fillText(opts.sub || "", cx, cy + 18);
  };

  function mkTip(cv, ctx, w, h, pad, X, Y, series, labels) {
    if (!window.ckTip) {
      const t = document.createElement("div");
      t.id = "ckTip";
      t.style.cssText = "position:fixed;z-index:70;pointer-events:none;opacity:0;transition:opacity .15s;background:rgba(6,16,32,.96);border:1px solid rgba(34,211,238,.5);color:#e6f1ff;font:600 11.5px/1.4 system-ui;padding:7px 10px;border-radius:8px;";
      document.body.appendChild(t);
      window.ckTip = t;
    }
    cv.onmousemove = (e) => {
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const mxi = Math.round(((mx - pad.l) / Math.max(1, w - pad.l - pad.r)) * 7);
      if (mxi < 0 || mxi >= 7) { window.ckTip.style.opacity = 0; return; }
      const html = (labels[mxi] ? labels[mxi] + " · " : "") + series.map((s) => "<b style='color:" + s.color + "'>" + s.pts[mxi].toFixed(2) + "</b>").join(" / ");
      window.ckTip.innerHTML = html;
      window.ckTip.style.left = e.clientX + 12 + "px";
      window.ckTip.style.top = e.clientY + 12 + "px";
      window.ckTip.style.opacity = 1;
    };
    cv.onmouseleave = () => { window.ckTip.style.opacity = 0; };
  }

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (typeof r === "number") r = [r, r, r, r];
      this.moveTo(x + r[0], y);
      this.arcTo(x + w, y, x + w, y + h, r[1]);
      this.arcTo(x + w, y + h, x, y + h, r[2]);
      this.arcTo(x, y + h, x, y, r[3]);
      this.arcTo(x, y, x + w, y, r[0]);
      this.closePath();
    };
  }
})();