/* ============================================================
   SEA-INTEL · APP
   Router (one module per screen), shared state, all renders.
   ============================================================ */
(function () {
  window.addEventListener("error", function (e) {
    const p = document.getElementById("probe");
    if (p) p.setAttribute("data-err", (e.message || (e && e.type) || "js-error") + " @ " + ((e.filename || "").split("/").pop() || "") + ":" + (e.lineno || ""));
  });
  const p = document.getElementById("probe");
  if (p) p.setAttribute("data-boot", "started");
})();
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let viewNow = "home";

  /* ---------------- state + engine wiring ---------------- */
  window.state = buildState();
  state.laneId = "B";
  window.PORTS_GEO = buildPortsGeo();
  window.LANES = buildLanes();
  window.R = null;

  function buildPortsGeo() {
    const o = {};
    Object.keys(PORTS).forEach((k) => { o[PORTS[k].name] = { lat: PORTS[k].lat, lng: PORTS[k].lng, load: false }; });
    o[state.origin.name] = { lat: state.origin.lat, lng: state.origin.lng, load: true };
    return o;
  }
  function buildLanes() {
    return Object.keys(ROUTES).map((k) => {
      const r = ROUTES[k];
      return { id: k, name: r.label, way: r.way, sea: r.dist, risk: r.weatherRisk, load: state.origin.name, discharge: state.dest.name, color: r.color };
    });
  }
  function derivedState() {
    const s = buildState();
    s.origin = state.origin; s.dest = state.dest; s.cargoType = state.cargoType;
    s.cargo = state.cargo; s.deadline = state.deadline; s.weights = { ...state.weights };
    s.shoreOn = state.shoreOn; s.altPort = state.altPort; s.whatIf = { ...state.whatIf };
    const w = state.whatIf;
    s.demandDelta = w.demand / 100;
    s.rateK = 1 + w.freightRate / 100;
    s.fuelK = 1 + w.fuelPrice / 100;
    if (w.emiPriority) s.weights.emi = 95;
    if (w.deadlineShort) s.deadline -= 2;
    if (w.delay) s.deadline += 2;
    return s;
  }
  function baseState() {
    const s = buildState();
    s.origin = state.origin; s.dest = state.dest; s.cargoType = state.cargoType;
    s.cargo = state.cargo; s.deadline = state.deadline; s.weights = { ...state.weights };
    s.shoreOn = state.shoreOn; s.altPort = state.altPort;
    return s;
  }

  let laneGeom = null;
  function syncLaneGeom() {
    const use = (window.R && !window.R.error && window.R.portSel) ? PORTS[window.R.portSel] : state.dest;
    laneGeom = syncRoutes(state.origin, use || state.dest);
    window.PORTS_GEO = buildPortsGeo();
    window.LANES = buildLanes();
  }

  function recompute() {
    syncRoutes(state.origin, state.dest);
    window.R = computeAll(derivedState());
    syncLaneGeom();
    const r = window.R;
    const eb = $("#errBoard");
    if (eb) eb.innerHTML = r.error
      ? "<div class='err-board'><b>No feasible single-vessel plan</b><p>" + r.error + "</p><p class='sim-note'>Try a smaller cargo, a deeper-draft port (Visakhapatnam / Paradip), or a different destination.</p></div>"
      : "";
    if (r.error) return r;
    renderTape();
    renderHead();
    renderHome();
    if (viewNow === "map" && window.refreshGlobe) refreshGlobe();
    return window.R;
  }

  function refreshTicker() {
    if (!window.R || window.R.error) return;
    const r = window.R;
    if (!r.market || !r.cargo || !r.pm || !r.risk) return;
    const base = [];
    base.push({ k: "Baltic-index (sim)", v: "₹" + r.market.ser[0].toFixed(1) });
    base.push({ k: "7d", v: "₹" + r.market.ser[7].toFixed(1) });
    base.push({ k: "15d", v: "₹" + r.market.ser[15].toFixed(1) });
    base.push({ k: "30d", v: "₹" + r.market.ser[30].toFixed(1) });
    base.push({ k: "Demand Nov", v: r.cargo.f[2].k + "K t" });
    base.push({ k: "Port " + r.pm.name, v: r.pm.congestion.toFixed(0) + "/100" });
    base.push({ k: "Voyage risk", v: r.risk.risk + "/100 " + r.risk.band.label });
    const html = base.map((b) => "<span><b>" + b.k + "</b> " + b.v + "</span>").join("");
    const ti = $("#tapeInner");
    if (ti) { ti.innerHTML = html + html; }
  }

  /* ---------------- SEARCH ---------------- */
  const SEARCH_REC = [];
  function sx(t, label, sub, icon, color, act, keys) { SEARCH_REC.push({ t, label, sub, icon, color, act, keys: keys || [] }); }
  function buildSearchIndex() {
    SEARCH_REC.length = 0;
    SECTIONS.forEach((s) => sx("Module", s[2], s[3], s[1], s[4], () => go(s[0]), [s[0]]));
    Object.keys(PORTS).forEach((id) => {
      const p = PORTS[id];
      sx("Port", p.name, "risk " + p.risk + "/100 · congestion " + p.congestion + "/100 · " + p.country, p.risk > 58 ? "⚠" : "⚓", p.risk > 58 ? "#dc2626" : "#0e7490",
        () => { state.dest = DESTINATIONS.find((d) => d.id === id) || state.dest; state.altPort = null; recompute(); go("ports"); },
        [id, p.country, p.name]);
    });
    ORIGINS.forEach((o) => sx("Origin", o.name, "load port", "▲", "#1d4ed8",
      () => { state.origin = o; recompute(); go("freight"); }, [o.id, "load"]));
    DESTINATIONS.forEach((d) => sx("Destination", d.name + " · India", "discharge port", "▼", "#0891b2",
      () => { state.dest = d; state.altPort = null; recompute(); go("freight"); }, [d.id, "discharge"]));
    VESSELS.forEach((v) => sx("Vessel", v.name, v.cap + "K t · draft " + v.draft + " m · serves " + v.ports.join("/"), "⬢", "#16a34a",
      () => { if (state.cargo > v.cap * 1000) state.cargo = v.cap * 1000; recompute(); go("vessels"); }, [v.id, v.name]));
    FUELS.forEach((f) => sx("Fuel", f.name, "avail " + f.avail + "% · " + f.co2 + " kg CO₂/t", "⛽", "#6d28d9",
      () => go("fuel"), [f.id, f.name]));
    Object.keys(ROUTES).forEach((k) => {
      const rr = ROUTES[k];
      sx("Route", rr.label, rr.dist.toLocaleString("en-IN") + " nm · weather risk " + rr.weatherRisk + "/100", "🗺", "#4338ca",
        () => { state.laneId = k; window.LANES = buildLanes(); recompute(); go("map"); }, [k, rr.label]);
    });
    CARGO_TYPES.forEach((ct) => sx("Cargo", ct.name, "density " + ct.density, "📦", "#b91c1c",
      () => { state.cargoType = ct; recompute(); go("freight"); }, [ct.id, ct.name]));
    sx("Action", "Shore power — toggle", "cut port emissions (fuel)", "🔌", "#059669",
      () => { state.shoreOn = !state.shoreOn; recompute(); go("fuel"); }, ["shore", "shore power"]);
    sx("Action", "Reset what-if scenarios", "restore baseline plan", "♻", "#d97706",
      () => { const b = document.getElementById("wiReset"); if (b) b.click(); }, ["reset", "what if reset", "baseline"]);
    sx("Action", "Run the 14-step demo", "auto walkthrough", "▶", "#16324f",
      () => { const b = document.getElementById("btnDemo"); if (b) b.click(); }, ["demo", "walkthrough", "tour", "autoplay"]);
    sx("Action", "Open AI Decision", "one explained plan", "🎯", "#a16207", () => go("decision"), ["decision", "ai plan", "recommend"]);
    sx("Action", "Go home", "command center dashboard", "⌂", "#16324f", () => go("home"), ["home", "dashboard", "command center"]);
  }

  function renderSearch(q) {
    const box = $("#searchRes");
    if (!box) return;
    q = (q || "").trim().toLowerCase();
    if (!q) { box.innerHTML = ""; return; }
    const scored = [];
    for (let i = 0; i < SEARCH_REC.length; i++) {
      const rc = SEARCH_REC[i];
      const hay = (rc.label + " " + rc.keys.join(" ") + " " + rc.t).toLowerCase();
      let sc = 0;
      if (hay.indexOf(q) === 0) sc = 4;
      else if (hay.indexOf(q) >= 0) sc = hay.match(new RegExp("(^|\\s)" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) ? 3 : 2;
      if (sc) scored.push([sc, i]);
    }
    scored.sort((a, b) => (b[0] - a[0]));
    const top = scored.slice(0, 9);
    if (!top.length) { box.innerHTML = "<div class='sr-none'>No matches for “" + (q.replace(/[<>&"]/g, "")) + "” — try “ports”, “methanol”, “route b”, “decision”</div>"; return; }
    box.innerHTML = top.map((pair) => {
      const rc = SEARCH_REC[pair[1]];
      return "<div class='sr' data-qx='" + pair[1] + "'><span class='sr-ico' style='color:" + rc.color + ";background:" + rc.color + "1a'>" + rc.icon + "</span><span class='sr-tx'><b>" + rc.label + "</b><small>" + rc.sub + "</small></span><em style='color:" + rc.color + "'>" + rc.t + "</em></div>";
    }).join("");
  }

  function bindSearch() {
    const inp = $("#searchInput");
    if (!inp) return;
    let deb = null, hi = -1;
    const rows = () => [...$$("#searchRes .sr")];
    const hide = () => { const b = $("#searchRes"); if (b) b.innerHTML = ""; inp.blur(); };
    const pick = (el) => { const rc = SEARCH_REC[+el.dataset.qx]; if (rc && rc.act) rc.act(); hide(); };
    const mark = (list) => list.forEach((el, i) => el.classList.toggle("sel", i === hi));
    inp.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { renderSearch(inp.value); hi = -1; }, 120); });
    inp.addEventListener("focus", () => { if (inp.value.trim()) renderSearch(inp.value); });
    inp.addEventListener("keydown", (ev) => {
      const list = rows();
      if (ev.key === "Escape") { hide(); return; }
      if (ev.key === "ArrowDown") { ev.preventDefault(); hi = Math.min(list.length - 1, hi + 1); mark(list); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); hi = Math.max(0, hi - 1); mark(list); return; }
      if (ev.key === "Enter") { ev.preventDefault(); const el = list[Math.max(0, hi)]; if (el) pick(el); }
    });
    document.addEventListener("click", (e) => {
      const row = e.target.closest("#searchRes .sr");
      if (row) { pick(row); return; }
      if (!e.target.closest(".search")) { const b = $("#searchRes"); if (b) b.innerHTML = ""; }
    });
    window.addEventListener("keydown", (ev) => {
      const tag = ev.target && ev.target.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (ev.target && ev.target.isContentEditable);
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); inp.focus(); inp.select(); return; }
      if (ev.key === "/" && !editable) { ev.preventDefault(); inp.focus(); inp.select(); }
    });
  }

  /* ---------------- ROUTER + BOOT ---------------- */
  function go(v) {
    viewNow = v || "home";
    $$(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === viewNow));
    $$(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === viewNow));
    try { history.replaceState(null, "", "#" + viewNow); } catch (e) { }
    const rend = RENDERERS[viewNow];
    if (rend && !(window.R && window.R.error)) rend();
    document.querySelector(".main").scrollTop = 0;
  }

  /* ---------------- tape + head ---------------- */
  function renderTape() { refreshTicker(); }
  function renderHead() {
    const h = $("#headCtx");
    if (!h) return;
    let t = "Cargo " + (+state.cargo).toLocaleString("en-IN") + " t · " + state.origin.name.replace(/ \(.*\)/, "") + " → " + state.dest.name + " · Deadline " + state.deadline + " d";
    const r = window.R;
    if (r && !r.error && r.altUsed) t += " · discharging at " + PORTS[r.altUsed].name;
    h.textContent = t;
  }

  /* ---------------- HOME ---------------- */
  // Grouped to match the sidebar taxonomy, so the dashboard and the nav agree
  // on where a module lives instead of listing ten tiles in one flat row.
  // [view, icon, label, blurb, accent, tint]
  const MODULE_GROUPS = [
    { title: "Overview", blurb: "the voyage and the plan", items: [
      ["map", "🗺️", "Route Map", "3D voyage globe", "#4338ca", "#e0e7ff"],
      ["decision", "🎯", "AI Decision Center", "one explained plan", "#a16207", "#fef9c3"]
    ]},
    { title: "Market", blurb: "rates and cargo demand", items: [
      ["freight", "📈", "Freight Intelligence", "forecast · charter · savings", "#1d4ed8", "#dbeafe"],
      ["cargo", "📦", "Cargo Demand", "seasonality · growth", "#b91c1c", "#fee2e2"]
    ]},
    { title: "Operations", blurb: "port and weather reality", items: [
      ["ports", "⚓", "Port Intelligence", "congestion · berths · alternatives", "#0e7490", "#cffafe"],
      ["weather", "⛅", "Weather & Disruption", "ETA · cost impact", "#c2410c", "#ffedd5"]
    ]},
    { title: "Fleet & Green", blurb: "vessel, speed and fuel", items: [
      ["vessels", "⬢", "Vessel Selector", "capacity · cost · ETA", "#15803d", "#dcfce7"],
      ["fuel", "⛽", "Fuel & Emissions", "fuel · speed · CO₂", "#6d28d9", "#ede9fe"]
    ]},
    { title: "Optimize", blurb: "search harder, stress-test", items: [
      ["quantum", "⚛️", "Quantum Optimizer", "annealing vs grid search", "#be185d", "#fce7f3"],
      ["whatif", "◈", "What-If Simulator", "scenario stress-test", "#b45309", "#fef3c7"]
    ]}
  ];
  const SECTIONS = MODULE_GROUPS.reduce((all, g) => all.concat(g.items), []);

  function tile(s, n) {
    return "<button class='sec' style='--ac:" + s[4] + ";--bg:" + s[5] + ";background:" + s[5] + ";animation-delay:" + (n * 0.02).toFixed(2) + "s' data-go='" + s[0] + "'" +
      "><i class='bar' style='background:" + s[4] + "'></i>" +
      "<span class='ico' style='color:" + s[4] + ";background:rgba(255,255,255,.65)'>" + s[1] + "</span>" +
      "<span class='tx'><b>" + s[2] + "</b><small>" + s[3] + "</small></span>" +
      "<em style='background:" + s[4] + "'>open →</em></button>";
  }

  function renderHome() {
    if (!window.R) return;
    const r = window.R;
    $("#secMosaic").innerHTML = MODULE_GROUPS.map((g) =>
      "<section class='mod-group'>" +
        "<div class='mod-group-h'><b>" + g.title + "</b><span>" + g.blurb + "</span></div>" +
        "<div class='tiles'>" + g.items.map(tile).join("") + "</div>" +
      "</section>").join("");
    const kpis = [
      { l: "Current freight", v: fmtRate(r.market.ser[0]), s: "trend " + r.market.trend.label, d: r.market.trend.dir === "down" ? "down" : "", bg: "#dbeafe", ac: "#1d4ed8" },
      { l: "Predicted · 15d", v: fmtRate(r.market.ser[15]), s: r.market.trend.emo + " " + r.market.trend.label, d: "", bg: "#e0e7ff", ac: "#4338ca" },
      { l: "Potential saving", v: IN_K(r.savings), s: "freight only", d: "green", bg: "#dcfce7", ac: "#15803d" },
      { l: "Cargo demand", v: r.cargo.f[2].k + "K t", s: "Nov forecast", d: "", bg: "#ede9fe", ac: "#6d28d9" },
      { l: "Port risk", v: r.pm.risk.toFixed(0) + "/100", s: r.pm.name, d: r.pm.risk > 58 ? "red" : r.pm.risk > 40 ? "amber" : "green", bg: "#fef3c7", ac: "#b45309" },
      { l: "Weather risk", v: r.wm.risk + "/100", s: r.wm.route.label, d: r.wm.risk > 58 ? "red" : r.wm.risk > 38 ? "amber" : "green", bg: "#ffedd5", ac: "#c2410c" },
      { l: "Fleet fuel", v: Math.round(r.rec.cons).toLocaleString("en-IN") + " t", s: "recommended plan", d: "", bg: "#cffafe", ac: "#0e7490" },
      { l: "Est. CO₂", v: Math.round(r.rec.co2).toLocaleString("en-IN") + " t", s: "plan", d: "", bg: "#fee2e2", ac: "#b91c1c" }
    ];
    $("#hcSub").textContent = "recomputed live from the shared engine · demo/simulated data";
    $("#kpiStrip").innerHTML = kpis.map((k) =>
      "<div class='card kpi min' style='--ac:" + k.ac + ";background:" + k.bg + "'><div class='v'>" + k.v + "</div><div class='lbl'>" + k.l + "</div><div class='sub'>" + k.s + "</div></div>").join("");
    const NODE_COLORS = ["#dbeafe", "#e0e7ff", "#dcfce7", "#ede9fe", "#cffafe", "#ffedd5", "#fef3c7", "#fce7f3", "#fef9c3"];
    $("#pipeLine").innerHTML = [
      "Cargo demand", "Freight", "Charter window", "Port", "Weather", "Vessel", "Fuel", "Optimizer", "Plan"
    ].map((n, i, a) => (i ? "<span class='arr'>→</span>" : "") + "<div class='node' style='--acbg:" + NODE_COLORS[i] + "'><span class='s'>" + String(i + 1).padStart(2, "0") + "</span><b>" + n + "</b></div>").join("");
    $("#homePlan").innerHTML = [
      ["Charter", "days " + r.window.start + "–" + r.window.end],
      ["Vessel", r.rec.vessel.name],
      ["Route", r.rec.route.label],
      ["Speed", r.rec.speed.toFixed(1) + " kn"],
      ["Fuel", r.bestFuel.name],
      ["Total", IN_K(r.rec.total)],
      ["Risk", r.risk.band.label]
    ].map((x) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("");
  }

  async function runDemo() {
    const log = $("#demoLog");
    log.innerHTML = "";
    const btnD = $("#btnDemo"); if (btnD) btnD.innerHTML = "running…";
    for (const st of DEMO_STEPS) {
      log.insertAdjacentHTML("beforeend", "<div class='step'>STEP " + st[0] + "</div><div class='ok'>" + st[1] + "</div>");
      log.scrollTop = log.scrollHeight;
      recompute();
      await new Promise((r) => setTimeout(r, 520));
    }
    if (btnD) { btnD.innerHTML = "▶ Run the 14-step demo"; }
    go("decision");
  }

  /* ---------------- FREIGHT ---------------- */
  const RENDERERS = {};
  RENDERERS.home = renderHome;
  RENDERERS.freight = function () {
    if (!$("#fOrigin").options.length) {
      $("#fOrigin").innerHTML = ORIGINS.map((o) => "<option value='" + o.id + "'>" + o.name + "</option>").join("");
      $("#fDest").innerHTML = DESTINATIONS.map((o) => "<option value='" + o.id + "'>" + o.name + "</option>").join("");
      $("#fCargoType").innerHTML = CARGO_TYPES.map((o) => "<option value='" + o.id + "'>" + o.name + "</option>").join("");
      $("#fOrigin").value = state.origin.id; $("#fDest").value = state.dest.id;
      $("#fCargoType").value = state.cargoType.id;
      $("#fQty").value = state.cargo; $("#fDeadline").value = state.deadline;
    }
    drawFreight();
  };
  function drawFreight() {
    const r = window.R; if (!r) return;
    const m = r.market;
    $("#frTag").textContent = m.trend.emo + " " + m.trend.label;
    $("#frTag").className = "tag " + (m.trend.dir === "down" ? "g" : m.trend.dir === "rising" ? "r" : "a");
    $("#frCur").textContent = fmtRate(m.cur);
    $("#frF15").textContent = fmtRate(m.ser[15]);
    $("#frTrend").innerHTML = "today " + fmtRate(m.ser[0]) + " → 15d " + fmtRate(m.ser[15]) + " <span class='" + m.trend.cls + "'>" + m.trend.emo + "</span>";
    $("#frConf").textContent = r.window.conf + "%";
    const lb = m.laneBreak;
    const row = (k, v, strong) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + k + "</span><b" + (strong ? " style='font:800 13px/1 var(--mono)'" : " style='font:700 12.5px/1 var(--mono)'" ) + ">" + v + "</b></div>";
    $("#frLane").innerHTML =
      row("Base index (simulated Baltic-style)", fmtRate(RATE_SERIES.cur)) +
      lb.parts.map((p) => row(p.k, (p.v >= 0 ? "+" : "-") + "₹" + Math.abs(p.v).toFixed(2))).join("") +
      row("Lane rate today", fmtRate(m.cur), true) +
      "<p class='sim-note' style='margin-top:10px'><b>" + shortPort(state.origin.name) + " → " + state.dest.name + "</b> · " + lb.nm.toLocaleString("en-IN") +
      " nm great-circle. Change load port, destination or cargo type above and this lane re-prices instantly — the whole forecast, window and saving move with it.</p>";
    CK.line($("#frChart"), {
      labels: ["0", "7", "15", "30", "60"], dots: true,
      series: [{ pts: [0, 7, 15, 30, 60].map((d) => m.ser[d]), color: "#22d3ee" }]
    });
    $("#frPreds").innerHTML = [[0, "Today"], [7, "7 days"], [15, "15 days"], [30, "30 days"], [60, "60 days"]].map((p) => {
      const up = m.ser[p[0]] > m.ser[0]; const dn = m.ser[p[0]] < m.ser[0];
      return "<div style='display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e7edf5;padding:8px 2px'><span style='color:#5b6b85'>" + p[1] + "</span><b>" + fmtRate(m.ser[p[0]]) + "</b><span class='" + (dn ? "down" : up ? "up" : "warn") + "' style='font-weight:700'>" + (dn ? "▼" : up ? "▲" : "—") + "</span></div>";
    }).join("");
    $("#frRead").textContent = m.trend.dir === "down"
      ? "Freight rate expected to fall — wait before chartering. Best paid ~" + fmtRate(r.window.lo) + "/t in the window."
      : m.trend.dir === "rising"
        ? "Freight rate expected to rise — fixing early may be better than waiting."
        : "Freight rate expected to stay stable.";
    $("#frWindow").innerHTML = [
      ["Best charter window", "<b class='big'>" + r.window.start + "–" + r.window.end + "</b> <span style='color:#5b6b85'>(days from today)</span>"],
      ["Expected freight", fmtRate(r.window.lo) + " – " + fmtRate(r.window.hi)],
      ["Estimated saving", IN_K(r.savings) + " <span style='color:#059669'>on " + (+state.cargo).toLocaleString("en-IN") + " t</span>"],
      ["Confidence", r.window.conf + "%"]
    ].map((x) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><span>" + x[1] + "</span></div>").join("") +
      "<ul class='why' style='margin-top:10px'>" + r.window.why.map((w) => "<li><span class='ok'>✓</span>" + w + "</li>").join("") + "</ul>";
    const saveTotal = (m.ser[0] - r.window.lo) * state.cargo;
    $("#frSave").innerHTML =
      "<div style='display:flex;align-items:end;gap:8px;flex-wrap:wrap'><div><div style='color:#5b6b85;font-size:11px'>Charter now</div><div style='font:800 20px/1 system-ui'>" + fmtRate(m.ser[0]) + "</div></div><span style='color:#5b6b85;padding:0 6px'>vs</span><div><div style='color:#5b6b85;font-size:11px'>Charter in window</div><div style='font:800 20px/1 system-ui;color:#059669'>" + fmtRate(r.window.lo) + "</div></div><div style='background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);border-radius:10px;padding:8px 12px;margin-left:auto;text-align:right'><div style='color:#5b6b85;font-size:10px'>FREIGHT SAVING " + (+state.cargo).toLocaleString("en-IN") + " t</div><div style='font:800 22px/1 system-ui;color:#059669'>" + IN_K(saveTotal) + "</div></div></div>" +
      "<p class='sim-note' style='margin-top:12px'>Voyage cost for the recommended plan (charter + fuel + port + delay): <b>" + IN_K(r.rec.total) + "</b> · total incl. freight " + IN_K(r.rec.total + r.rec.freightCost) + ".</p>";
  }

  /* ---------------- CARGO ---------------- */
  RENDERERS.cargo = function () {
    const r = window.R; if (!r) return;
    $("#cgForecast").innerHTML = r.cargo.f.map((f) =>
      "<div style='display:flex;justify-content:space-between;align-items:center;padding:10px 2px;border-bottom:1px solid #e7edf5'><b>" + f.m + "</b><b>" + f.k + "K t</b></div>").join("") +
      "<div style='margin-top:10px;font-size:12px;color:#5b6b85'>Growth Sep→Dec: <b style='color:" + (r.cargo.growth >= 0 ? "#34d399" : "#f87171") + "'>" + (r.cargo.growth >= 0 ? "+" : "") + r.cargo.growth.toFixed(1) + "%</b></div>";
    $("#cgChain").innerHTML = ["Higher cargo demand", "⚑ → more vessels needed", "⚑ → possible freight-rate increase"].map((n, i, a) => (i ? "<span class='arr'>→</span>" : "") + "<div class='node'><b style='font-size:11.5px'>" + n + "</b></div>").join("");
    $("#cgNote").textContent = r.cargo.note;
    CK.bar($("#cgChart"), { labels: DEMAND_MONTHS.map((m) => m.m), values: DEMAND_MONTHS.map((m) => m.k), colors: DEMAND_MONTHS.map((m) => (m.k >= 66 ? "#34d399" : m.k >= 55 ? "#22d3ee" : "#3b82f6")) });
    $("#cgGrowth").innerHTML = "<div style='display:flex;gap:24px;align-items:center;flex-wrap:wrap'><div><div style='color:#5b6b85;font-size:11px'>Baseline Nov cargo</div><div class='v' style='font:800 24px/1 system-ui' id='cgNov'>" + r.cargo.f[2].k + "K t</div></div><div><div style='color:#5b6b85;font-size:11px'>Demand-tightness factor</div><div class='v' style='font:800 24px/1 system-ui;color:#0e7490'>" + (1 + r.S.demandDelta * 0.8).toFixed(2) + "×</div></div><div><div style='color:#5b6b85;font-size:11px'>Freight-rate lift this drives</div><div class='v' style='font:800 24px/1 system-ui;color:#b45309'>+" + Math.round(r.S.demandDelta * 5.5) + "%</div></div></div><p class='sim-note' style='margin-top:12px'>Rising cargo demand → tighter vessel supply → possible rate rise. The engine carries demand into the freight forecast and ship-availability scoring.</p>";
  };

  /* ---------------- PORTS ---------------- */
  RENDERERS.ports = function () {
    const r = window.R; if (!r) return;
    const ids = Object.keys(PORTS);
    $("#portCards").innerHTML = ids.map((id) => {
      const p = PORTS[id]; const pm = portModel(r.S, id);
      const cong = pm.congestion <= 33 ? "g" : pm.congestion <= 60 ? "a" : "r";
      return "<div class='card'><div class='ttl'>" + p.name + " <span style='color:#5d7397'>· " + p.country + "</span></div>" +
        "<div style='display:flex;flex-direction:column;gap:7px;font-size:12.5px'>" +
        "<span>Congestion <b class='tag " + cong + "'>" + pm.congestion.toFixed(0) + "/100</b></span>" +
        "<span>Waiting <b>" + Math.round(pm.wait) + " h</b> · Berth <b>" + pm.berth.toFixed(0) + "%</b></span>" +
        "<span>Draft <b>" + pm.draft + " m</b> · Shore power <b>" + (pm.shorePower ? "yes" : "no") + "</b></span>" +
        "<span>Port risk <b class='" + (pm.risk > 58 ? "bad" : pm.risk > 40 ? "warn" : "good") + "'>" + pm.risk.toFixed(0) + "/100</b></span>" +
        "</div><button class='btn small ghost' style='margin-top:10px;width:100%' data-port='" + id + "'>Detail + alternative</button></div>";
    }).join("");
    let altHtml = "<div class='ttl'>Alternative-port recommendation</div>";
    if (r.altRec) {
      altHtml += "<div style='display:flex;align-items:center;gap:14px;flex-wrap:wrap'><div><span style='color:#5b6b85;font-size:11px'>" + r.pm.name + " congested</span><div style='font:800 18px/1 system-ui'>→ " + r.altRec.name + " <span class='tag g'>RECOMMENDED</span></div></div><div style='display:flex;gap:20px;flex-wrap:wrap'><span>extra distance <b>+" + r.altRec.distPct + "%</b></span><span>wait saved <b>" + r.altRec.saveH + " h</b></span><span>cost impact <b style='color:#059669'>" + IN_K(r.altRec.costDelta) + "</b></span></div><button class='btn small' data-alt='" + r.altRec.id + "'>Use " + r.altRec.name + "</button></div>";
    } else {
      altHtml += "<span class='sim-note'>Destination congestion is " + r.pm.congestion.toFixed(0) + "/100 — no switch needed. Raise congestion in What-If to trigger auto-recommendation.</span>";
    }
    $("#altPortCard").innerHTML = altHtml;
  };

  /* ---------------- WEATHER ---------------- */
  RENDERERS.weather = function () {
    const r = window.R; if (!r) return;
    const w = r.wm;
    const band = w.risk <= 33 ? { c: "#059669", l: "LOW", e: "🟢" } : w.risk <= 60 ? { c: "#b45309", l: "MODERATE", e: "🟠" } : w.risk <= 78 ? { c: "#ea580c", l: "HIGH", e: "🟠" } : { c: "#dc2626", l: "CRITICAL", e: "🔴" };
    $("#wxRing").innerHTML =
      "<div style='text-align:center'><div class='ring' style='--p:" + w.risk + ";--c:" + band.c + ";margin:0 auto'><div class='rc'><div><b>" + w.risk + "</b><span>/ 100</span></div></div></div><div style='margin-top:10px;font:800 13px/1 system-ui;color:" + band.c + "'>" + band.e + " " + band.l + "</div></div>";
    $("#wxImp").innerHTML = "<div class='ttl'>Expected impact</div>" +
      "<div style='display:flex;flex-direction:column;gap:10px'>" +
      "<div><span style='color:#5b6b85;font-size:11px'>Route</span><div style='font:700 14px/1 system-ui'>" + w.route.label + "</div></div>" +
      "<div><span style='color:#5b6b85;font-size:11px'>ETA impact</span><div style='font:800 18px/1 system-ui;color:" + (w.delayH > 0 ? "#fbbf24" : "#34d399") + "'>" + (w.delayH > 0 ? "+" : "") + w.delayH + " h</div></div>" +
      "<div><span style='color:#5b6b85;font-size:11px'>Potential additional cost</span><div style='font:800 18px/1 system-ui'>" + (w.cost >= 0 ? "+" : "") + IN_K(w.cost) + "</div></div>" +
      (w.ev ? "<span class='tag r'>active: " + w.ev + "</span>" : "<span class='tag g'>no active disruption on-lane</span>") + "</div>";
    const alt = ROUTES[w.alt];
    $("#wxAlt").innerHTML = "<div class='ttl'>Alternative route option</div>" +
      "<div style='font:700 16px/1.2 system-ui;color:#059669'>" + w.altLabel + "</div>" +
      "<p style='font-size:12.5px;color:#5b6b85;margin:8px 0'>" + alt.desc + "</p>" +
      "<div style='display:flex;gap:18px;flex-wrap:wrap'><span>distance <b>+" + w.altDistPct + "%</b></span><span>delay saved <b>" + Math.max(0, w.altDelaySave) + " h</b></span></div>" +
      "<p class='sim-note' style='margin-top:10px'>" + w.why + "</p>";
    $("#wxEvents").innerHTML = WEATHER_EVENTS.map((e) =>
      "<div style='display:flex;gap:14px;align-items:center;padding:10px 2px;border-bottom:1px solid #e7edf5;flex-wrap:wrap'><b style='min-width:180px'>" + e.name + "</b><span style='color:#5b6b85'>" + e.zone + "</span><span class='tag a'>+" + e.delay + " h</span><span>+" + IN_K(e.cost) + "</span><span class='tag " + (e.riskAdd > 25 ? "r" : "a") + "'>risk +" + e.riskAdd + "</span></div>").join("") +
      "<p class='sim-note' style='margin-top:8px'>Simulated events. In production these come from a weather feed and feed ETA/cost inside the engine.</p>";
  };

  /* ---------------- VESSELS ---------------- */
  RENDERERS.vessels = function () {
    const r = window.R; if (!r) return;
    const rows = VESSELS.map((v) => {
      const f = optimalSpeed(r.S, v.id, r.rec.route.id, r.rec.fuel.id, r.portSel);
      if (!f) return null;
      const best = v.id === r.rec.vessel.id;
      return "<tr class='" + (best ? "best" : "") + "'><td><b>" + v.name + "</b>" + (best ? " <span class='tag t'>REC</span>" : "") + "</td><td>" + v.cap + "K t</td><td>" + IN_K(f.sf.total) + "</td><td>" + f.sf.eta.toFixed(1) + "d</td><td>" + Math.round(f.sf.cons).toLocaleString("en-IN") + " t</td><td>" + Math.round(f.sf.co2).toLocaleString("en-IN") + " t</td><td class='" + (f.sf.eta <= state.deadline ? "good" : "warn") + "'>" + (f.sf.eta <= state.deadline ? "on time" : "late") + "</td><td>" + v.avail + "%</td></tr>";
    }).filter(Boolean).join("");
    $("#vesselTbl").innerHTML = "<thead><tr><th>Vessel</th><th>Capacity</th><th>Voyage cost</th><th>ETA</th><th>Fuel</th><th>CO₂</th><th>Deadline</th><th>Avail</th></tr></thead><tbody>" + rows + "</tbody>";
    $("#vsNote").textContent = "Panamax may have a lower ₹/t freight curve, but for " + (+state.cargo).toLocaleString("en-IN") + " t the engine weighs capacity fill, congestion wait (" + Math.round(r.pm.wait) + " h), draft (" + (r.rec.vessel.draft) + " m vs " + r.pm.draft + " m max) and ETA together.";
    $("#vsWhy").innerHTML = r.why.slice(0, 5).map((w) => "<li><span class='ok'>✓</span>" + w + "</li>").join("");
  };

  /* ---------------- FUEL ---------------- */
  RENDERERS.fuel = function () {
    const r = window.R; if (!r) return;
    const sp = $("#spRange");
    if (!$("#spRange").data) { $("#spRange").data = true; sp.value = r.rec.speed.toFixed(1); }
    drawFuel();
    $("#shoreBtn").textContent = "Shore power: " + (state.shoreOn ? "on" : "off");
    $("#spOpt").innerHTML = "<div style='font:800 34px/1 system-ui;color:#0e7490'>" + r.rec.speed.toFixed(1) + " kn</div>" +
      "<p style='margin:8px 0;color:#5b6b85;font-size:12.5px'>Optimum for <b>" + r.rec.vessel.name + "</b> on <b>" + r.rec.route.label + "</b> (" + r.rec.route.dist.toLocaleString("en-IN") + " nm, " + r.pm.name + " discharge). Meets the " + state.deadline + "-day window at " + r.rec.eta.toFixed(1) + " d ETA while cutting fuel vs high-speed steaming.</p>" +
      "<div class='meter' style='max-width:280px'><i style='width:" + (100 - ((r.rec.speed - 10) / 7.5) * 100) + "%'></i></div>" +
      "<p class='sim-note'>Higher speed → higher fuel → higher cost → higher CO₂ (cubic powering law). Recommended " + r.rec.speed.toFixed(1) + " kn is the weighted optimum for your priorities.</p>";
  };
  function drawFuel() {
    const r = window.R; if (!r || r.error || !r.rec) return;
    const v = r.rec.vessel;
    const util = (state.cargo / 1000 / v.cap) * 100;
    $("#fuShip").innerHTML =
      "<div class='ttl'>Voyage being optimised <span class='tag g'>" + v.name + "</span></div>" +
      "<div style='display:flex;flex-wrap:wrap;gap:22px;align-items:flex-end'>" +
      [["Vessel", v.name + " · " + v.cap + "K dwt"],
       ["Cargo on board", Math.round(state.cargo).toLocaleString("en-IN") + " t (" + util.toFixed(0) + "% of capacity)"],
       ["Route", r.rec.route.label + " · " + r.rec.route.dist.toLocaleString("en-IN") + " nm"],
       ["Load port", shortPort(state.origin.name)],
       ["Discharge port", r.pm.name],
       ["Fuel", r.rec.fuel.name],
       ["Recommended speed", r.rec.speed.toFixed(1) + " kn"]
      ].map((x) => "<div><div style='color:#5b6b85;font-size:10px;letter-spacing:.1em;text-transform:uppercase'>" + x[0] + "</div><div style='font:800 16px/1.3 system-ui'>" + x[1] + "</div></div>").join("") +
      "</div>" +
      "<p class='sim-note' style='margin-top:10px'>Every number on this page — the speed curve, fuel options, CO₂ and voyage cost — is computed for <b>" + v.name + "</b> on this exact lane. Change the vessel in Vessel Selection and this module re-computes for that ship.</p>";
    const s = parseFloat($("#spRange").value);
    const sf = vesselForward(derivedState(), v.id, r.rec.route.id, r.rec.fuel.id, s, r.portSel);
    $("#spVal").textContent = s.toFixed(1) + " kn";
    $("#spOut").innerHTML = [
      ["Fuel consumption", Math.round(sf.cons).toLocaleString("en-IN") + " t"],
      ["Fuel cost", IN_K(sf.fuelCost)],
      ["CO₂ emissions", Math.round(sf.co2).toLocaleString("en-IN") + " t"],
      ["ETA", sf.eta.toFixed(1) + " d"],
      ["Voyage cost", IN_K(sf.total)]
    ].map((x) => "<div style='display:flex;justify-content:space-between;padding:7px 2px;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("");
    const curve = [];
    const labels = [];
    for (let spd = 10; spd <= 17; spd += 0.5) { curve.push(vesselForward(derivedState(), v.id, r.rec.route.id, "METH", spd, r.portSel).cons); labels.push(spd.toFixed(0)); }
    CK.line($("#fuChart"), { labels, series: [{ pts: curve, color: "#34d399" }] });
    const fq = fuelQualities(derivedState(), r.rec);
    $("#fuelTbl").innerHTML = "<thead><tr><th>Fuel</th><th>Consumption</th><th>Cost</th><th>CO₂</th><th>Avail</th></tr></thead><tbody>" + fq.map((f, i) =>
      "<tr class='" + (i === 0 ? "best" : "") + "'><td><b>" + f.name + "</b>" + (i === 0 ? " <span class='tag g'>BEST FOR THIS VOYAGE</span>" : "") + "</td><td>" + Math.round(f.cons).toLocaleString("en-IN") + " t</td><td>" + IN_K(f.cost) + "</td><td>" + Math.round(f.co2).toLocaleString("en-IN") + " t</td><td>" + f.avail + "%</td></tr>").join("") + "</tbody>" +
      "<p class='sim-note' style='margin-top:10px'>Ranking reflects THIS voyage and its port infrastructure. No fuel is 'universally best' — Methanol wins here on cost while cutting CO₂ vs VLSFO; Ammonia scores lowest emissions but @ " + FUELS.find((x) => x.id === "AMN").avail + "% availability.</p>";
  }

  /* ---------------- MAP ---------------- */
  let globeBooted = false, laneUserSet = false;
  RENDERERS.map = function () {
    const r = window.R; if (!r) return;
    if (!globeBooted) {
      globeBooted = true;
      try { if (window.setupGlobe) window.setupGlobe(); } catch (e) { console.error(e); }
      setTimeout(() => { if (window.setupGlobe && !window.globeActive) window.setupGlobe(); }, 300);
    }
    if (!laneUserSet && r.rec) { state.laneId = r.rec.route.id; window.LANES = buildLanes(); if (window.refreshGlobe) refreshGlobe(); }
    if (!laneUserSet && window.focusGlobeLane) window.focusGlobeLane(2.4);
    renderMapLegend();
    renderMapPath();
  };
  function zoomBy(f) {
    if (window.globeZoom) {
      const z = window.globeZoom();
      window.zoomGlobe(z * f);
    }
  }
  function fitRoute() { if (window.focusGlobeLane) window.focusGlobeLane(2.4); }
  function syncZoomLbl() {
    const el = document.getElementById("zoomLvl");
    if (el && window.globeZoom) el.textContent = window.globeZoom().toFixed(1) + "×";
  }
  function renderMapPath() {
    const r = window.R; if (!r || r.error || !r.rec) return;
    const from = state.origin, to = r.pm;
    const rr = ROUTES[state.laneId], wps = rr.way;
    const mid = wps[Math.floor(wps.length / 2)];
    const fmtLL = (p) => Math.abs(p[1]).toFixed(1) + (p[1] >= 0 ? "°N" : "°S") + " " + Math.abs(p[0]).toFixed(1) + (p[0] >= 0 ? "°E" : "°W");
    $("#mapPath").innerHTML =
      "<div style='display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end'>" +
      [["Load port", shortPort(from.name), fmtLL([from.lng, from.lat])],
       ["Discharge port", to.name, fmtLL([to.lng, to.lat])],
       ["Route drawn", rr.label, wps.length + " surveyed waypoints"],
       ["Sea distance sailed", rr.dist.toLocaleString("en-IN") + " nm", "great circle " + (laneGeom ? laneGeom.base : rr.dist).toLocaleString("en-IN") + " nm · mid-leg " + fmtLL(mid)],
       ["Recommended plan", r.rec.route.label, r.rec.vessel.name + " · " + r.rec.speed.toFixed(1) + " kn"]
      ].map((x) => "<div><div style='color:#5b6b85;font-size:10px;letter-spacing:.1em;text-transform:uppercase'>" + x[0] + "</div>" +
        "<div style='font:800 15px/1.4 system-ui'>" + x[1] + "</div>" +
        "<div style='color:#7a8aa0;font:600 11px/1.3 var(--mono)'>" + x[2] + "</div></div>").join("") + "</div>" +
      "<p class='sim-note' style='margin-top:10px'>Each route is rebuilt from your actual load port to the port the plan really discharges at, and every waypoint is inside navigable water or a real strait, so the line never crosses land. The highlighted lane is the one in your current plan; use the Route A/B/C buttons to inspect the alternatives.</p>";
  }
  function renderMapLegend() {
    const r = window.R; if (!r) return;
    $("#mapLegend").innerHTML = Object.keys(ROUTES).map((k) => {
      const rr = ROUTES[k];
      const on = state.laneId === k;
      const rec = r.rec && r.rec.route.id === k;
      return "<span style='display:inline-flex;align-items:center;gap:8px;margin-right:22px'><span style='width:24px;height:3px;background:" + rr.color + ";border-radius:3px'></span><b style='" + (on ? "color:#16324f" : "color:#5b6b85") + "'>" + rr.label + "</b>" + (rec ? " <span class='tag g'>IN PLAN</span>" : "") + "<span style='color:#5d7397;font-size:11px'>" + rr.weatherRisk + "/100 risk · " + rr.dist.toLocaleString("en-IN") + " nm</span></span>";
    }).join("") +
      "<p class='sim-note' style='margin-top:8px'>" + ROUTES[state.laneId].desc + " · recommended: <b>" + r.rec.route.label + "</b> (" + r.rec.route.dist.toLocaleString("en-IN") + " nm). Click a lane button to focus it on the map.</p>";
  }

  function setLane(id, ev) {
    state.laneId = id;
    laneUserSet = true;
    window.LANES = buildLanes();
    if (window.refreshGlobe) refreshGlobe();
    if (window.focusGlobeLane) window.focusGlobeLane(2.4);
    renderMapLegend();
    renderMapPath();
    $$("[data-lane]").forEach((b) => { b.className = "btn small" + (b.dataset.lane === id ? " green" : ""); });
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-zin],[data-zout],[data-zfit]");
    if (!t) return;
    if (t.hasAttribute("data-zin")) zoomBy(1.5);
    else if (t.hasAttribute("data-zout")) zoomBy(1 / 1.5);
    else fitRoute();
    setTimeout(syncZoomLbl, 30);
  });

  /* ---------------- QUANTUM ---------------- */
  RENDERERS.quantum = function () {
    const r = window.R; if (!r) return;
    $$(".wsl").forEach((sl) => { sl.value = state.weights[sl.dataset.k]; });
    ["cost", "fuel", "emi", "eta"].forEach((k) => { $("#w" + k[0].toUpperCase() + k.slice(1)).textContent = state.weights[k] + "%"; });
    drawOpt();
  };
  let lastRec = null;
  function drawOpt() {
    const r = window.R; if (!r || r.error || !r.rec) return;
    const rec = r.rec;
    $("#optOut").innerHTML = [
      ["Vessel", rec.vessel.name],
      ["Route", rec.route.label],
      ["Speed", rec.speed.toFixed(1) + " kn"],
      ["Fuel", rec.fuel.name],
      ["Charter window", "days " + r.window.start + "–" + r.window.end],
      ["Total cost", IN_K(rec.total)],
      ["Objective score", rec.score.toFixed(3)]
    ].map((x) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("") +
      "<p class='sim-note' style='margin-top:10px'>Objective = weighted sum of cost, fuel, CO₂ and ETA. Move any priority slider and these bars re-weight instantly.</p>";
    const p = rec.objParts;
    if (p) {
      const mx = Math.max(p.cost, p.fuel, p.emi, p.eta, p.lat, 0.0001);
      const bar = (k, lbl, v, w) => "<div style='display:flex;align-items:center;gap:8px;padding:4px 0'>" +
        "<span style='flex:0 0 92px;color:#5b6b85;font-size:11px'>" + lbl + " " + w + "%</span>" +
        "<span style='flex:1;height:7px;border-radius:99px;background:#e8eef6;overflow:hidden'><i style='display:block;height:100%;width:" + ((v / mx) * 100).toFixed(1) + "%;background:linear-gradient(90deg,#0e7490,#22d3ee)'></i></span>" +
        "<b style='flex:0 0 46px;text-align:right;font:700 11px/1 var(--mono)'>" + v.toFixed(3) + "</b></div>";
      const sig = rec.vessel.id + "|" + rec.route.id + "|" + rec.fuel.id + "|" + rec.speed.toFixed(1);
      const changed = lastRec && lastRec !== sig;
      const which = [];
      if (lastRec && lastRec.split("|")[0] !== rec.vessel.id) which.push("vessel");
      if (lastRec && lastRec.split("|")[1] !== rec.route.id) which.push("route");
      if (lastRec && lastRec.split("|")[2] !== rec.fuel.id) which.push("fuel");
      if (lastRec && lastRec.split("|")[3] !== rec.speed.toFixed(1)) which.push("speed");
      $("#qWhy").innerHTML =
        "<div class='ttl'>How your priorities scored this plan</div>" +
        bar("cost", "Cost", p.cost, p.w.cost) + bar("fuel", "Fuel", p.fuel, p.w.fuel) +
        bar("emi", "CO₂", p.emi, p.w.emi) + bar("eta", "ETA", p.eta, p.w.eta) +
        (p.lat > 0.001 ? bar("lat", "Lateness", p.lat, "—") : "") +
        "<div class='ttl' style='margin-top:12px'>Fleet eligibility for this voyage</div>" +
        r.fleetFit.map((f) => "<div style='display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:11.5px;border-bottom:1px solid #eef2f8'>" +
          "<span><b>" + f.name + "</b> <span style='color:#7a8aa0'>" + f.cap + "K dwt</span></span>" +
          "<span style='color:" + (f.chosen ? "#059669" : f.feasible ? "#0e7490" : "#b45309") + ";font-weight:700'>" + (f.chosen ? "✓ selected" : f.feasible ? "eligible" : f.why) + "</span></div>").join("") +
        "<p class='sim-note' style='margin-top:10px'>" + (changed ? "Priority change → switched <b>" + (which.join(", ") || "plan") + "</b>." : lastRec ? "Same plan still wins under these weights — the bars above show why it is hard to beat." : "Adjust a priority slider to see the optimizer re-choose vessel, route, speed or fuel.") + "</p>";
      lastRec = sig;
    }
    $("#qBox").innerHTML = "<div class='ttl'>Quantum-inspired optimizer <span class='tag t'>annealing</span></div>" +
      kv("Solution quality", (r.q.quality * 100).toFixed(1) + "%") +
      kv("Evaluated combinations", r.q.iters.toLocaleString("en-IN")) +
      kv("Accepted moves", r.q.accept.toLocaleString("en-IN")) +
      kv("Runtime (measured)", r.q.ms.toFixed(1) + " ms") +
      kv("Best combo", rec.vessel.name + " · " + rec.route.label + " · " + rec.fuel.name + " · " + rec.speed.toFixed(1) + " kn");
    $("#cBox").innerHTML = "<div class='ttl'>Conventional optimizer <span class='tag'>greedy grid</span></div>" +
      kv("Solution quality", (r.c.quality * 100).toFixed(1) + "%") +
      kv("Evaluated combinations", r.c.iters.toLocaleString("en-IN")) +
      kv("Runtime (measured)", r.c.ms.toFixed(1) + " ms") +
      kv("Same-space search", "decoupled per-dimension");
  }
  function kv(k, v) { return "<div style='display:flex;justify-content:space-between;gap:10px;padding:8px 2px;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85;font-size:12px'>" + k + "</span><b style='font:700 13px/1 ui-monospace,monospace'>" + v + "</b></div>"; }

  /* ---------------- WHAT-IF ---------------- */
  RENDERERS.whatif = function () {
    const cfg = [
      ["freightRate", "Freight rate +15%", 15], ["fuelPrice", "Fuel price +20%", 20], ["congestion", "Port congestion severe", ""],
      ["demand", "Cargo demand +20%", 20], ["weather", "Weather disruption occurs", ""], ["delay", "Vessel delayed 2 days", ""],
      ["deadlineShort", "Deadline shortened 2 d", ""], ["emiPriority", "Emissions top priority", ""]
    ];
    if (!$("#wiChips").dataset.built) {
      $("#wiChips").dataset.built = "1";
      $("#wiChips").innerHTML = cfg.map((c) => "<button class='chip' data-wi='" + c[0] + "' id='chip-" + c[0] + "'>" + c[1] + "</button>").join("");
      $$(".chip").forEach((ch) => ch.addEventListener("click", () => {
        const k = ch.dataset.wi;
        if (k === "freightRate") state.whatIf.freightRate = state.whatIf.freightRate ? 0 : 15;
        else if (k === "fuelPrice") state.whatIf.fuelPrice = state.whatIf.fuelPrice ? 0 : 20;
        else if (k === "demand") state.whatIf.demand = state.whatIf.demand ? 0 : 20;
        else state.whatIf[k] = !state.whatIf[k];
        recompute(); renderWhatIfPanels(); syncChips(cfg);
      }));
    }
    syncChips(cfg);
    renderWhatIfPanels();
  };
  function syncChips(cfg) {
    cfg.forEach((c) => {
      const ch = $("#chip-" + c[0]); if (!ch) return;
      ch.classList.toggle("on", !!state.whatIf[c[0]]);
    });
  }
  function renderWhatIfPanels() {
    const after = window.R; const before = computeAll(baseState()); if (!after) return;
    const pln = (r) => [
      ["Vessel", r.rec.vessel.name], ["Route", r.rec.route.label], ["Speed", r.rec.speed.toFixed(1) + " kn"], ["Fuel", r.rec.fuel.name],
      ["Total cost", IN_K(r.rec.total)], ["ETA", r.rec.eta.toFixed(1) + " d"], ["Fuel", Math.round(r.rec.cons).toLocaleString("en-IN") + " t"],
      ["CO₂", Math.round(r.rec.co2).toLocaleString("en-IN") + " t"], ["Risk", r.risk.risk + "/100 " + r.risk.band.label]
    ];
    $("#wiBefore").innerHTML = "<table class='tbl'>" + pln(before).map((x) => "<tr><td style='color:#5b6b85'>" + x[0] + "</td><td><b>" + x[1] + "</b></td></tr>").join("") + "</table>";
    $("#wiAfter").innerHTML = "<table class='tbl'>" + pln(after).map((x) => "<tr><td style='color:#5b6b85'>" + x[0] + "</td><td><b>" + x[1] + "</b></td></tr>").join("") + "</table>";
    const r1 = before.rec, r2 = after.rec;
    $("#wiWhy").innerHTML = "<p style='font-size:13px;color:#22324b'>" + (r1.vessel.id !== r2.vessel.id || r1.route.id !== r2.route.id ? "Recommendation changed because engine re-balanced the weighted objective." : "Recommendation is stable, but cost / risk numbers moved.") + "</p>" + whyDiff("Total cost", r1.total, r2.total, true) + whyDiff("Fuel", r1.cons, r2.cons, false) + whyDiff("CO₂", r1.co2, r2.co2, false) + whyDiff("ETA", r1.eta, r2.eta, false);
    $("#wiDeltas").innerHTML = stat("Cost saving", IN_K(r1.total - r2.total), (r1.total - r2.total) > 0) + stat("Fuel reduction", Math.round(r1.cons - r2.cons) + " t", (r1.cons - r2.cons) > 0) + stat("Emission reduction", Math.round(r1.co2 - r2.co2) + " t", (r1.co2 - r2.co2) > 0) + stat("ETA", (r1.eta - r2.eta).toFixed(1) + " d faster", (r1.eta - r2.eta) > 0);
  }
  function whyDiff(name, a, b, money) {
    const d = a - b; const up = d > 0;
    return "<div style='display:flex;justify-content:space-between;padding:7px 2px;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + name + "</span><b class='" + (up ? "good" : "bad") + "'>" + (up ? "−" : "+") + (money ? IN_K(Math.abs(d)) : Math.abs(d).toFixed(1)) + "</b></div>";
  }
  function stat(k, v, good) {
    return "<div class='card kpi min' style='text-align:center'><div class='v' style='color:" + (good ? "#059669" : "#dc2626") + "'>" + v + "</div><div class='lbl'>" + k + "</div></div>";
  }

  /* ---------------- DECISION ---------------- */
  RENDERERS.decision = function () {
    const r = window.R; if (!r) return;
    const rec = r.rec;
    $("#decPlan").innerHTML = [
      ["Charter window", "days " + r.window.start + " – " + r.window.end],
      ["Vessel", rec.vessel.name],
      ["Route", rec.route.label],
      ["Speed", rec.speed.toFixed(1) + " knots"],
      ["Fuel", rec.fuel.name],
      ["Shore power", rec.shore ? "recommended at " + r.pm.name : "n/a at " + r.pm.name]
    ].map((x) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><b style='font-size:13.5px'>" + x[1] + "</b></div>").join("");
    const b = r.risk.band;
    $("#decRing").innerHTML = "<div class='ring' style='--p:" + r.risk.risk + ";--c:" + b.c + "'><div class='rc'><div><b>" + r.risk.risk + "</b><span>/ 100</span></div></div></div>";
    $("#decRingTxt").innerHTML = "<div style='font:800 22px/1 system-ui;color:" + b.c + "'>" + b.label + "</div><div style='color:#5b6b85;font-size:12px;margin-top:6px'>VOYAGE RISK<br>combined: freight, demand, port, weather, vessel, fuel</div>";
    $("#decResults").innerHTML = [
      ["Total cost (incl. freight)", IN_K(rec.total + rec.freightCost)],
      ["Voyage cost", IN_K(rec.total)],
      ["Fuel consumption", Math.round(rec.cons).toLocaleString("en-IN") + " tonnes"],
      ["ETA", rec.eta.toFixed(1) + " days"],
      ["GHG emissions", Math.round(rec.co2).toLocaleString("en-IN") + " t CO₂e"],
      ["Potential saving", IN_K(r.savings) + " <span style='color:#059669'>freight</span>"]
    ].map((x) => "<div style='display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #e7edf5'><span style='color:#5b6b85'>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("");
    $("#decWhy").innerHTML = r.why.map((w) => "<li><span class='ok'>✓</span>" + w + "</li>").join("");
    $("#decSummary").innerHTML = "<thead><tr><th>Item</th><th>Value</th></tr></thead><tbody>" + [
      ["Cargo", Math.round(state.cargo).toLocaleString("en-IN") + " t · " + state.cargoType.name],
      ["Origin", state.origin.name], ["Destination", r.pm.name],
      ["Charter window", "days " + r.window.start + "–" + r.window.end], ["Vessel", rec.vessel.name],
      ["Route", rec.route.label], ["Speed", rec.speed.toFixed(1) + " kn"], ["Fuel", rec.fuel.name],
      ["Shore power", rec.shore ? "on" : "off"], ["ETA", rec.eta.toFixed(1) + " d"],
      ["Total cost", IN_K(rec.total)], ["Fuel consumption", Math.round(rec.cons).toLocaleString("en-IN") + " t"],
      ["GHG emissions", Math.round(rec.co2).toLocaleString("en-IN") + " t CO₂e"], ["Potential saving", IN_K(r.savings)],
      ["Risk", r.risk.risk + "/100 · " + r.risk.band.label]
    ].map((x) => "<tr><td style='color:#5b6b85'>" + x[0] + "</td><td><b>" + x[1] + "</b></td></tr>").join("") + "</tbody>";
    drawBeforeAfter();
  };
  function drawBeforeAfter() {
    const r = window.R; if (!r) return;
    const naive = vesselForward(derivedState(), "PAN", "A", "VLSFO", 16, r.portSel);
    const bases = naive.total, bf = naive.cons, bc = naive.co2, be = naive.eta;
    const opt = r.rec;
    CK.bar($("#decChart"), {
      labels: ["Total cost", "Fuel", "CO₂", "ETA"],
      values: [(opt.total / bases) * 100, (opt.cons / bf) * 100, (opt.co2 / bc) * 100, (opt.eta / be) * 100],
      colors: ["#22d3ee", "#34d399", "#34d399", "#fbbf24"]
    });
  }

  /* ---------------- PORT MODAL ---------------- */
  function renderPortModal(nameOrId, ev) {
    // Callers pass either a port id (cards) or a port name (globe markers).
    const id = PORTS[nameOrId] ? nameOrId : (Object.keys(PORTS).find((k) => PORTS[k].name === nameOrId) || "");
    const p = PORTS[id];
    const modal = $("#portModal");
    if (!p) { loadInfoModal(nameOrId); return; }
    const pm = portModel(derivedState(), id);
    const alt = PORT_ALT[id];
    $("#portModalBody").innerHTML = "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'><b style='font-size:17px'>" + p.name + "</b><button class='btn small ghost' id='pmClose'>✕</button></div>" +
      "<table class='tbl'><tbody>" + [
        ["Congestion", pm.congestion.toFixed(0) + "/100"], ["Expected waiting", Math.round(pm.wait) + " hrs"],
        ["Berth availability", pm.berth.toFixed(0) + "%"], ["Draft restriction", p.draft + " m"],
        ["Shore power", p.shorePower ? "available" : "not available"], ["Port risk", pm.risk.toFixed(0) + "/100"]
      ].map((x) => "<tr><td style='color:#5b6b85'>" + x[0] + "</td><td><b>" + x[1] + "</b></td></tr>").join("") + "</tbody></table>" +
      (alt ? "<p class='sim-note' style='margin-top:10px'>Alternatives: " + alt.map((a) => PORTS[a].name).join(" · ") + "</p>" : "") +
      (state.dest.id === name && rAlt() ? "<button class='btn small green' style='margin-top:10px' data-use-alt='1'>Engine recommends switching →</button>" : "");
    modal.classList.add("show");
    $("#pmClose").onclick = () => modal.classList.remove("show");
    const useAlt = modal.querySelector("[data-use-alt]");
    if (useAlt) useAlt.onclick = (e) => { const ra = rAlt(); if (ra) { state.altPort = ra.id; window.R = recompute(); modal.classList.remove("show"); go("ports"); } };
  }
  function rAlt() { return window.R ? window.R.altRec : null; }
  function loadInfoModal(name) {
    const modal = $("#portModal");
    $("#portModalBody").innerHTML = "<div style='display:flex;justify-content:space-between'><b>" + name + "</b><button class='btn small ghost' id='pmClose'>✕</button></div><p class='sim-note' style='margin-top:8px'>Port marker on the route map.</p>";
    modal.classList.add("show");
    $("#pmClose").onclick = () => modal.classList.remove("show");
  }

  /* ---------------- boot ---------------- */
  function bind() {
    $$(".navbtn").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (h && h !== viewNow) go(h); });
    document.addEventListener("click", (e) => {
      const g = e.target.closest("[data-go]");
      if (g) { go(g.dataset.go); return; }
      const al = e.target.closest("[data-alt]");
      if (al) { state.altPort = al.dataset.alt; recompute(); go("ports"); return; }
      const ln = e.target.closest("[data-lane]");
      if (ln) { setLane(ln.dataset.lane); return; }
      const pr = e.target.closest("[data-port]");
      if (pr) { renderPortModal(pr.dataset.port); return; }
    });
    $("#fGo").addEventListener("click", applyForm);
    $$("#fOrigin,#fDest,#fCargoType,#fQty,#fDeadline").forEach((el) => el.addEventListener("change", applyForm));
    $("#spRange").addEventListener("input", () => { renderTape(); drawFuel(); });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#shoreBtn")) { toggleShore(); return; }
      if (e.target.closest("#fGo")) { applyForm(); return; }
    });
    $$(".wsl").forEach((sl) => sl.addEventListener("input", () => {
      state.weights[sl.dataset.k] = +sl.value;
      window.R = recompute();
      const cap = sl.dataset.k; $("#w" + cap[0].toUpperCase() + cap.slice(1)).textContent = state.weights[cap] + "%";
      go("quantum");
    }));
    $("#optBtn").addEventListener("click", () => { window.R = recompute(); drawOpt(); });
    $("#wiReset").addEventListener("click", () => {
      state.whatIf = { freightRate: 0, fuelPrice: 0, congestion: false, demand: 0, weather: false, delay: 0, emiPriority: false };
      state.altPort = null; state.shoreOn = true;
      recompute(); renderWhatIfPanels();
      $$(".chip").forEach((c) => c.classList.remove("on"));
    });
    $("#btnDemo").addEventListener("click", runDemo);
  }

  function toggleShore() {
    state.shoreOn = !state.shoreOn;
    window.R = recompute();
    const sb = $("#shoreBtn");
    if (sb) sb.textContent = "Shore power: " + (state.shoreOn ? "on" : "off");
    if (window.R && !window.R.error) { const fr = RENDERERS.fuel; if (fr) fr(); } else { drawFuel(); }
  }

  function applyForm() {
    try {
      const o = $("#fOrigin"), de = $("#fDest"), ct = $("#fCargoType"), q = $("#fQty"), dl = $("#fDeadline");
      if (!o || !de || !ct) return;
      state.origin = ORIGINS.find((x) => x.id === o.value) || state.origin;
      state.dest = DESTINATIONS.find((x) => x.id === de.value) || state.dest;
      state.cargoType = CARGO_TYPES.find((x) => x.id === ct.value) || state.cargoType;
      state.cargo = Math.max(1000, Math.min(150000, +(q ? q.value : 0) || 60000));
      state.deadline = Math.max(5, Math.min(60, +(dl ? dl.value : 0) || 18));
      state.laneId = "B";
      window.LANES = buildLanes(); window.PORTS_GEO = buildPortsGeo();
      recompute();
      go("freight");
    } catch (err) {
      const eb = $("#errBoard"); if (eb) eb.innerHTML = "<div class='err-board'><b>Voyage inputs</b><p>" + (err && err.message ? err.message : err) + "</p></div>";
    }
  }

  window.setState = (key, val) => { state[key] = val; recompute(); };

  bind();
  buildSearchIndex();
  bindSearch();
  recompute();
  const h = location.hash.replace("#", "");
  let qv = null;
  try { qv = new URLSearchParams(location.search).get("view"); } catch (e) { }
  go(qv || h || "home");
  const pr = document.getElementById("probe");
  if (pr) pr.setAttribute("data-probe", (location.search || "") + "|" + (location.hash || "") + "|qv=" + (qv || "") + "|now=" + viewNow);
  if (pr && window.__probeExtra) pr.setAttribute("data-go", viewNow);
})();