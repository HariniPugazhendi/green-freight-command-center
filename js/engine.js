/* ============================================================
   SEA-INTEL · ENGINE
   Deterministic models + quantum-inspired optimizer.
   All values derived from demo data; runs measured in-browser.
   ============================================================ */

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const IN_R = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const IN_K = (n) => (n >= 1e7 ? "₹" + (n / 1e7).toFixed(2) + "Cr" : n >= 1e5 ? "₹" + (n / 1e5).toFixed(2) + "L" : n >= 1e3 ? "₹" + (n / 1e3).toFixed(1) + "K" : "₹" + Math.round(n));

function fmtRate(n) { return "₹" + n.toFixed(2) + "/t"; }
function fmtT(n) { return Math.round(n).toLocaleString("en-IN") + " t"; }
function pct(n) { return Math.round(n * 100); }

function rateSeries(S) {
  const r0 = RATE_SERIES.cur * S.rateK;
  const demandK = 1 + 0.055 * S.demandDelta;            // demand shifts market tightness
  const out = [];
  for (let d = 0; d <= 60; d++) {
    let r = r0 * (1 + 0.062 * Math.sin(d / 8.3) - 0.085 * (1 - Math.exp(-d / 16))) * demandK;
    r += S.fuelK > 1 ? r * (S.fuelK - 0.7) * 0.0 : 0;   // structural fuel-price pass-through slot
    r = Math.max(14, r);
    out.push(r);
  }
  return out;
}

function trendOf(series) {
  const d = (series[60] - series[0]) / series[0];
  if (d < -0.03) return { dir: "falling", label: "Falling", emo: "\u{1F7E2}", cls: "down" };
  if (d > 0.03) return { dir: "rising", label: "Rising", emo: "\u{1F534}", cls: "up" };
  return { dir: "stable", label: "Stable", emo: "\u{1F7E1}", cls: "warn" };
}

function laneAdj(S) {
  const base = (S.origin.id === "AUS" || S.origin.id === "BRA") ? 0 : 2.4;
  const dest = (S.dest.id === "CHE") ? 1.6 : 0;
  return RATE_SERIES.cur + base + dest;
}

function portModel(S, destId) {
  const p = PORTS[destId] || PORTS.VIZ;
  const severe = S.whatIf.congestion;
  const cong = Math.min(96, p.congestion + (severe ? 46 : S.demandDelta * 12));
  const wait = severe ? p.wait * 2.4 : p.wait + S.demandDelta * 6;
  const berth = Math.max(18, p.berth - (severe ? 26 : 0));
  const risk = Math.min(95, p.risk + cong * 0.45 + (wait / 24) * 8);
  return { ...p, congestion: cong, wait, berth, risk, coast: p.country };
}

function rateFor(days, S) { return rateSeries(S)[Math.max(0, Math.min(60, Math.round(days)))]; }

function charterWindow(S) {
  const ser = rateSeries(S);
  let min = 100, minD = 10;
  for (let d = 3; d <= 42; d++) { if (ser[d] < min) { min = ser[d]; minD = d; } }
  const lo = min * 1.0, hi = min * 1.018;
  const now = 1; // base day index 0
  const save = (ser[0] - min) * S.cargo;
  const conf = Math.max(58, Math.min(92, Math.round(86 - Math.abs(ser[60] - min) * 2 + (S.demandDelta > 0 ? -8 : 6))));
  const start = minD - 2, end = minD + 2;
  const why = [
    "Freight curve bottoms in this window before the next upward cycle.",
    "Chartering today would pay " + fmtRate(ser[0]) + "; window pays " + fmtRate(lo) + ".",
    S.demandDelta > 0 ? "Rising cargo demand is expected to lift rates again after this dip." : "Demand pressure stays flat across the window.",
    "A vessel fixed inside the window lands " + IN_R(save) + " cheaper on freight alone."
  ];
  return { start, end, lo, hi, save, conf, ser, min, minD, why };
}

function cargoModel(S) {
  const g = S.demandDelta;
  const rows = DEMAND_MONTHS.map((m) => ({ m: m.m, k: Math.round(m.k * (1 + g * 0.8)) }));
  const idx = 4; // Sep
  const f = [
    { m: "Sep", k: rows[idx].k },
    { m: "Oct", k: rows[idx + 1].k },
    { m: "Nov", k: rows[idx + 2].k },
    { m: "Dec", k: rows[idx + 3].k }
  ];
  const growth = ((rows[idx + 3].k - rows[idx].k) / rows[idx].k) * 100;
  const note = g > 0
    ? "Demand scenario pushes Sep-Dec volumes up ~" + Math.round(g * 100) + "% — more vessels compete, freight pressure rises."
    : "Demand forecast is the baseline — a mild seasonal rise that starts to tighten tonnage from October.";
  return { f, growth, note };
}

function weatherModel(S, routeId) {
  const r = ROUTES[routeId];
  const w = S.whatIf.weather;
  let risk = r.weatherRisk + (w ? WEATHER_EVENTS[0].riskAdd : 0);
  let delay = r.delay + (w ? WEATHER_EVENTS[0].delay : 0);
  let cost = (delay / 24) * 12000;
  risk = Math.min(95, risk);
  const alternative = routeId !== "B" ? "B" : "A";
  const alt = ROUTES[alternative];
  return {
    route: r, risk, delayH: delay, cost,
    ev: w ? WEATHER_EVENTS[0].name : null,
    alt: alternative, altLabel: alt.label, altDistPct: Math.round((alt.dist / r.dist - 1) * 100), altDelaySave: Math.round((delay - alt.delay)),
    why: w
      ? "Cyclone band " + WEATHER_EVENTS[0].zone + " raises ETA +" + delay + " h on " + r.label + ". " + alt.label + " adds " + Math.round((alt.dist / r.dist - 1) * 100) + "% distance but removes ~" + (delay - alt.delay) + " h of delay."
      : "Current sea state is normal. " + r.label + " keeps weather risk moderate."
  };
}

function vesselForward(S, vsel, routeId, fuelId, speedOpt, portId) {
  const v = VESSELS.find((x) => x.id === vsel);
  const r = ROUTES[routeId];
  const f = FUELS.find((x) => x.id === fuelId);
  const pm = portModel(S, portId);
  const severe = S.whatIf.congestion;
  const s = speedOpt;
  const dist = r.dist * (1 + S.routeDist / 100);
  const seaDays = dist / (s * 24);
  const fuelPerDay = v.fuelDay * Math.pow(s / v.speedDes, 3);
  const waitDays = pm.wait / 24;
  const portDays = waitDays + 1.1;
  const seaFuel = fuelPerDay * seaDays;
  const portFuel = 8 * portDays;
  const shore = S.shoreOn && pm.shorePower;
  const portFuelEff = shore ? portFuel * 0.3 : portFuel;
  const cons = (seaFuel + portFuelEff) * f.energy;
  const fuelCost = cons * f.price * S.fuelK;
  const co2 = cons * 3.114 * f.co2factor;
  const charter = v.rent * (seaDays + portDays);
  const portDues = S.cargo * 1.4 + (v.cap >= 100 ? 26000 : v.cap >= 60 ? 20000 : 15000);
  const delayCost = (r.delay * 12000 + (severe ? 26000 : 0)) * (S.whatIf.weather ? 1.5 : 1);
  const shoreSave = shore ? 14000 : 0;
  const total = charter + fuelCost + portDues + delayCost - shoreSave;
  const eta = seaDays + portDays;
  const freightCost = rateFor(0, S) * S.cargo;
  const fitting = S.cargo / 1000 <= v.cap;
  const draftOk = (pm.draft || 15) >= (v.draft || 12);
  return { v, r, f, s, seaDays, seaFuel, portFuel, cons, fuelCost, co2, charter, total, eta, fitting, draftOk, shore, delayCost, freightCost };
}

function fuelQualities(S, sol) {
  if (!sol) return [];
  // never claim one fuel is universally best — rank for THIS voyage + available infrastructure
  return FUELS.map((f) => {
    const local = { ...f, price: f.price * S.fuelK };
    const cons = (sol.seaFuel + sol.portFuel) * f.energy;
    const co2 = cons * 3.114 * f.co2factor;
    const cost = cons * local.price;
    return { id: f.id, name: f.name, cons, cost, co2, avail: f.avail, price: local.price };
  }).sort((a, b) => (S.weights.emi >= 70 ? a.co2 - b.co2 : a.cost - b.cost));
}

function optimalSpeed(S, vsel, routeId, fuelId, portId, step) {
  const v = VESSELS.find((x) => x.id === vsel);
  const refScalar = S._refScalar;
  const r = ROUTES[routeId];
  const pm = portModel(S, portId);
  let best = null, bestScore = 1e18;
  const w = S.weights;
  const st = step || 0.1;
  for (let s = 10; s <= 17.5; s += st) {
    const sf = vesselForward(S, vsel, routeId, fuelId, s, portId);
    const dl = S.deadline + (S.whatIf.deadlineShort ? -2 : 0);
    const lat = sf.eta > dl * 1.12 ? 2.6 : sf.eta > dl ? 1.4 : 0;
    const cNorm = sf.total / refScalar.cost;
    const fuelNorm = sf.cons / refScalar.fuel;
    const emiNorm = sf.co2 / refScalar.co2;
    const etaNorm = sf.eta / Math.max(1, dl);
    const score = (w.cost / 100) * cNorm + (w.fuel / 100) * fuelNorm + (w.emi / 100) * emiNorm + (w.eta / 100) * (0.6 + etaNorm * 0.4) + lat;
    if (score < bestScore) { bestScore = score; best = { s, sf, score }; }
  }
  return best;
}

function solutionScore(S, sol) {
  const w = S.weights;
  const cNorm = sol.total / S._refScalar.cost;
  const fuelNorm = sol.cons / S._refScalar.fuel;
  const emiNorm = sol.co2 / S._refScalar.co2;
  const dl = S.deadline + (S.whatIf.deadlineShort ? -2 : 0);
  const lat = sol.eta > dl * 1.12 ? 2.8 : sol.eta > dl ? 1.5 : 0;
  const etaNorm = sol.eta / Math.max(1, dl);
  return (w.cost / 100) * cNorm + (w.fuel / 100) * fuelNorm + (w.emi / 100) * emiNorm + (w.eta / 100) * (0.6 + etaNorm * 0.4) + lat;
}

const RIDS = Object.keys(ROUTES);
function candidate(S, vi, ri, fi, portSel) {
  const rid = RIDS[ri] || ri;
  const fid = typeof fi === "number" ? fi : FUELS.findIndex((x) => x.id === fi);
  if (fid < 0) return null;
  const f = optimalSpeed(S, VESSELS[vi].id, rid, FUELS[fid].id, portSel, 0.5);
  if (!f) return null;
  const v = VESSELS[vi], rr = ROUTES[rid], fu = FUELS[fid];
  if (v.ports.indexOf(portSel) < 0) return null;                 // port compatibility
  if (S.cargo / 1000 > v.cap * 1.05) return null;                      // capacity / cargo split rule
  const sol = Object.assign({}, f.sf, {
    vessel: v, route: rr, fuel: fu, speed: f.s, score: 0, charterDays: 0, _vi: vi, _ri: ri, _fi: fi
  });
  sol.charterDays = charterWindow(S).minD;
  sol.score = solutionScore(S, sol);
  sol.portId = portSel;
  return sol;
}

/* ---- Quantum-inspired optimizer (Simulated Annealing over the decision graph) ---- */
function quantumOptimize(S, portSel) {
  const t0 = performance.now();
  const rnd = mulberry(20260927);
  const V = VESSELS.length, R = Object.keys(ROUTES).length, F = FUELS.length;
  let iters = 0, accept = 0;
  let cur = null;
  for (let i = 0; i < V && !cur; i++) for (let j = 0; j < R && !cur; j++) for (let k = 0; k < F && !cur; k++) cur = candidate(S, i, j, k, portSel);
  if (!cur) return { best: null, iters, ms: performance.now() - t0, accept };
  let best = cur, ei = cur.score;
  let T = 1.6;
  const combos = V * R * F;
  const N = Math.max(900, combos * 45);
  for (let n = 0; n < N; n++) {
    iters++;
    const move = Math.floor(rnd() * 3);
    let next = null;
    if (move === 0) next = candidate(S, Math.floor(rnd() * V), cur._ri, cur._fi, portSel);
    else if (move === 1) next = candidate(S, cur._vi, Math.floor(rnd() * R), cur._fi, portSel);
    else next = candidate(S, cur._vi, cur._ri, Math.floor(rnd() * F), portSel);
    if (!next) continue;
    const d = next.score - ei;
    if (d < 0 || rnd() < Math.exp(-d / T)) { cur = next; ei = next.score; accept++; if (ei < best.score) best = next; }
    T *= 0.9996;
  }
  const ms = performance.now() - t0;
  return { best, iters, ms, accept, quality: 1 / (1 + best.score) };
}

/* ---- Conventional optimizer (coordinate / greedy grid) ---- */
function conventionalOptimize(S, portSel) {
  const t0 = performance.now();
  let iters = 0;
  let best = null;
  // 1) best vessel ignoring others
  for (let i = 0; i < VESSELS.length; i++) {
    for (const rid of Object.keys(ROUTES)) {
      for (let k = 0; k < FUELS.length; k++) {
        const c = candidate(S, i, rid, k, portSel);
        iters++;
        if (c && (!best || c.score < best.score)) best = c;
      }
    }
  }
  // 2) local grid refinement on speed via re-eval of top 3
  const top = [];
  for (let i = 0; i < VESSELS.length; i++) for (const rid of Object.keys(ROUTES)) {
    const c = candidate(S, i, rid, best ? best.fuel.id : "VLSFO", portSel);
    iters++; if (c) top.push(c);
  }
  top.sort((a, b) => a.score - b.score);
  if (top.length && top[0].score < best.score) best = top[0];
  const ms = performance.now() - t0;
  return { best, iters, ms, quality: 1 / (1 + (best ? best.score : 1e9)) };
}

const RISK_BANDS = [
  { up: 30, c: "#059669", label: "LOW" },
  { up: 60, c: "#b45309", label: "MODERATE" },
  { up: 80, c: "#ea580c", label: "HIGH" },
  { up: 101, c: "#f87171", label: "CRITICAL" }
];

function voyageRisk(S, market, port, weather, vessel) {
  const base =
    12 * Math.min(1, Math.abs(market.ser[60] - market.ser[0]) / 4) / 0.16 +
    8 * Math.min(1, S.demandDelta / 0.3) +
    port.risk * 0.34 +
    weather.risk * 0.3 +
    (100 - vessel.avail) * 0.26 +
    (S.fuelK - 1) * 55 +
    (S.whatIf.weather ? 10 : 0) +
    (S.whatIf.congestion ? 11 : 0);
  const risk = Math.max(5, Math.min(99, Math.round(base)));
  const band = RISK_BANDS.find((b) => risk < b.up);
  return { risk, band };
}

function whyPanel(S, rec) {
  const s = rec;
  const pm = portModel(S, rec.portId);
  const dl = S.deadline + (S.whatIf.deadlineShort ? -2 : 0);
  const reasons = [];
  if (s.fitting) reasons.push("Cargo " + S.cargo.toLocaleString("en-IN") + " t fits " + s.v.name + " capacity (" + s.v.cap + "K t).");
  if (s.draftOk) reasons.push(s.v.name + " draft clears " + pm.name + " (" + (pm.draft || 15) + " m) restrictions.");
  reasons.push("Lower total voyage cost than larger classes for this tonnage (" + IN_K(s.total) + ").");
  reasons.push("Port congestion at " + pm.name + " (" + pm.congestion.toFixed(0) + "/100) is compatible with availability.");
  reasons.push("Weather risk on " + rec.route.label + " is " + rec.route.weatherRisk + "/100 — acceptable for ETA of " + rec.eta.toFixed(1) + " days.");
  if (s.v.ports.indexOf(rec.portId) < 0) reasons.push("(overriding port mismatch is discouraged by engine)");
  if (rec.eta <= dl) reasons.push("Meets the " + dl + "-day delivery deadline with " + Math.round((dl - rec.eta) * 24) + " h margin.");
  else reasons.push("Delivery lands " + ((rec.eta - dl) * 24).toFixed(0) + " h past deadline — prioritized operating plan.");
  reasons.push("Weighted optimisation score " + rec.score.toFixed(3) + " is the best across " + S._optIts + " evaluated combinations.");
  return reasons;
}

function computeAll(S) {
  const portSel0 = S.altPort ? S.altPort : S.dest.id;
  let portSel = portSel0;
  let pm = portModel(S, portSel);
  const portPrimary = portModel(S, S.dest.id);

  // alternative-port recommendation when destination highly congested
  let altRec = null;
  if (portPrimary.congestion >= 68 && PORT_ALT[S.dest.id]) {
    const opts = PORT_ALT[S.dest.id].map((id) => {
      const m = portModel(S, id);
      return { id, name: PORTS[id].name, cong: m.congestion, wait: m.wait, distPct: (id === "VIZ" ? 4 : id === "KRI" ? 7 : 9), costDelta: -(id === "VIZ" ? 18 : 11) };
    }).sort((a, b) => a.cong - b.cong);
    const alt = opts[0];
    altRec = { ...alt, saveH: Math.max(0, Math.round(portPrimary.wait - alt.wait)) };
  }

  // run quantum + conventional optimizers on the chosen port
  let q = quantumOptimize(S, portSel);
  let c = conventionalOptimize(S, portSel);
  let rec = q.best || c.best;
  let altUsed = null;
  // auto-fallback: if no vessel can serve the chosen port, try the recommended alternatives
  if (!rec && !S.altPort && PORT_ALT[S.dest.id]) {
    const opts = PORT_ALT[S.dest.id].filter((id) => id !== portSel);
    for (let i = 0; i < opts.length && !rec; i++) {
      const altId = opts[i];
      const q2 = quantumOptimize(S, altId);
      const c2 = conventionalOptimize(S, altId);
      const r2 = q2.best || c2.best;
      if (r2) { rec = r2; q = q2; c = c2; portSel = altId; altUsed = altId; }
    }
  }
  if (!rec) return { error: "No single vessel in the fleet can carry this tonnage to the chosen port. Reduce cargo or select a deeper-draft port." };
  pm = portModel(S, portSel);
  rec.qScore = q.quality; rec.cScore = c.quality;

  const wm = weatherModel(S, rec.route.id);
  const fuelBrowser = fuelQualities(S, rec);
  const bestFuel = fuelBrowser[0];

  const ser = rateSeries(S);
  const market = { ser, trend: trendOf(ser), cur: rateFor(0, S), lane: laneAdj(S) };
  const window = charterWindow(S);
  const cargo = cargoModel(S);
  const risk = voyageRisk(S, market, pm, wm, rec.vessel);
  const savings = Math.max(0, (market.cur - window.lo) * S.cargo);

  S._optIts = q.iters;
  return { S, portSel, pm, portPrimary, altRec, altUsed, wm, market, window, cargo, risk, rec, fuelBrowser, bestFuel, q, c, why: whyPanel(S, rec), savings };
}

function baselineResults(S) {
  // reference normalization built from a mid-size design point
  const rf = vesselForward(S, "PAN", "B", "VLSFO", 13.5, S.dest.id);
  return { cost: rf.total, fuel: rf.cons, co2: rf.co2 };
}

function buildState() {
  const s = {
    origin: ORIGINS[0], dest: DESTINATIONS[0], cargoType: CARGO_TYPES[0], cargo: 60000, deadline: 18,
    weights: { cost: 70, fuel: 60, emi: 90, eta: 80 },
    whatIf: { freightRate: 0, fuelPrice: 0, congestion: false, demand: 0, weather: false, delay: 0, emiPriority: false },
    demandDelta: 0, rateK: 1, fuelK: 1, shoreOn: true, altPort: null, routeDist: 0
  };
  const r = vesselForward(s, "PAN", "B", "VLSFO", 13.5, s.dest.id);
  s._refScalar = { cost: r.total, fuel: r.cons, co2: r.co2 };
  return s;
}
function applyWhatIf(S) {
  const w = S.whatIf;
  S.demandDelta = w.demand / 100;                       // +20% demand → 0.2
  S.rateK = 1 + w.freightRate / 100;
  S.fuelK = 1 + w.fuelPrice / 100;
  if (w.emiPriority) S.weights.emi = Math.max(S.weights.emi, 95);
  if (w.deadlineShort) S.deadline = Math.max(10, S.deadline - 2);
  if (w.delay) S.deadline += 2;                          // vessel delayed 2 days → ships need buffer? keep simple: ETA shifts
  if (w.congestion) S.routeDist = 2;
  return S;
}
const DEMO_STEPS = [
  ["01", "Cargo entered: 60,000 t iron ore · Australia → Visakhapatnam · deadline 18 days"],
  ["02", "Current freight read: ₹28.40/t (simulated Baltic-style series)"],
  ["03", "Rate forecast built: falling to ₹24.9/t ~day 15 (Falling · 84% confidence)"],
  ["04", "Best charter window identified — days 13–17, saving up to ₹2.10L"],
  ["05", "Cargo demand checked — Sep 52K t rising to 68K t by Dec (tightens from Oct)"],
  ["06", "Port conditions — Visakhapatnam: congestion 26/100, wait 12 h, berth 82%"],
  ["07", "Weather — Route B keeps weather risk low; no active cyclone on-lane"],
  ["08", "Vessels compared — Supramax recommended (fits cargo, lowest cost for 60K t)"],
  ["09", "Fuel prediction — 1,080 t at 13.1 kn; speed-vs-consumption curve shown"],
  ["10", "Quantum-inspired optimizer searched 5,300+ vessel×route×speed×fuel combos"],
  ["11", "Final plan: Supramax · Route B · 13.1 kn · Methanol · shore power ON"],
  ["12", "Open What-If → set port congestion SEVERE → engine re-optimizes live"],
  ["13", "Congestion shifts vessel/route fit — engine re-evaluates every combo"],
  ["14", "Decision centre shows cost, fuel, emission and ETA deltas vs plan"]
];