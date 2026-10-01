/* ============================================================
   SEA-INTEL · Green Freight Command Center
   DATA LAYER  (SIMULATED / DEMO)
   All figures in this file are realistic demo values used for
   the hackathon prototype. Structure is built so live APIs
   (weather, AIS, Baltic indices, port call data) can be wired
   in behind the same interface later.
   ============================================================ */
window.DEMO = true;

const ORIGINS = [
  { id: "AUS", name: "Australia (Hay Point / Newcastle)", lat: -21.25, lng: 149.3, rateAdj: 9.4 },
  { id: "BRA", name: "Brazil (Tubarao)", lat: -28.24, lng: -48.65, rateAdj: 11.2 },
  { id: "SA", name: "South Africa (Richards Bay)", lat: -28.78, lng: 32.03, rateAdj: 7.1 },
  { id: "IDN", name: "Indonesia (Balikpapan)", lat: -1.26, lng: 116.83, rateAdj: 3.2 },
  { id: "CHN", name: "China (Qinhuangdao)", lat: 39.93, lng: 119.67, rateAdj: 5.1 }
];

const DESTINATIONS = [
  { id: "VIZ", name: "Visakhapatnam", lat: 17.68, lng: 83.3, rateAdj: 0 },
  { id: "CHE", name: "Chennai", lat: 13.08, lng: 80.29, rateAdj: 1.9 },
  { id: "KRI", name: "Krishnapatnam", lat: 14.27, lng: 80.13, rateAdj: -0.5 },
  { id: "KDP", name: "Kandla", lat: 23.03, lng: 70.22, rateAdj: 1.1 },
  { id: "PRD", name: "Paradip", lat: 20.24, lng: 86.68, rateAdj: 0.4 }
];

const CARGO_TYPES = [
  { id: "iro", name: "Iron ore", density: 1.0, rateAdj: 0 },
  { id: "coal", name: "Thermal coal", density: 0.88, rateAdj: -1.1 },
  { id: "coke", name: "Metallurgical coke", density: 0.94, rateAdj: 0.5 },
  { id: "wheat", name: "Wheat / grains", density: 0.72, rateAdj: 2.7 },
  { id: "fert", name: "Fertilizer", density: 0.9, rateAdj: 1.8 }
];

const PORTS = {
  VIZ: { name: "Visakhapatnam", lat: 17.68, lng: 83.3, congestion: 26, wait: 12, berth: 82, draft: 17.0, risk: 32, shorePower: true, country: "India" },
  CHE: { name: "Chennai", lat: 13.08, lng: 80.29, congestion: 74, wait: 34, berth: 51, draft: 15.0, risk: 58, shorePower: false, country: "India" },
  KRI: { name: "Krishnapatnam", lat: 14.27, lng: 80.13, congestion: 47, wait: 19, berth: 64, draft: 16.5, risk: 44, shorePower: true, country: "India" },
  KDP: { name: "Kandla", lat: 23.03, lng: 70.22, congestion: 38, wait: 15, berth: 73, draft: 14.5, risk: 40, shorePower: false, country: "India" },
  PRD: { name: "Paradip", lat: 20.24, lng: 86.68, congestion: 33, wait: 14, berth: 78, draft: 18.2, risk: 36, shorePower: true, country: "India" },
  HPT: { name: "Hay Point", lat: -21.25, lng: 149.3, congestion: 42, wait: 18, berth: 68, draft: 18.5, risk: 48, shorePower: false, country: "Australia" },
  TUB: { name: "Tubarao", lat: -28.24, lng: -48.65, congestion: 39, wait: 16, berth: 70, draft: 19.0, risk: 45, shorePower: false, country: "Brazil" },
  RGB: { name: "Richards Bay", lat: -28.78, lng: 32.03, congestion: 31, wait: 12, berth: 81, draft: 17.5, risk: 38, shorePower: false, country: "South Africa" }
};

const PORT_ALT = { CHE: ["KRI", "VIZ"], VIZ: ["PRD", "KRI"], KRI: ["VIZ", "CHE"], KDP: ["PRD"], PRD: ["VIZ", "KRI"] };

const VESSELS = [
  { id: "HS", name: "Handysize", cap: 35, fuelDay: 21, speedDes: 13.0, rent: 10500, co2: 3.20, ports: ["VIZ", "KRI", "KDP", "PRD"], avail: 92, draft: 10.0 },
  { id: "SUP", name: "Supramax", cap: 55, fuelDay: 28, speedDes: 13.5, rent: 14500, co2: 3.06, ports: ["VIZ", "CHE", "KRI", "KDP", "PRD"], avail: 84, draft: 12.5 },
  { id: "PAN", name: "Panamax", cap: 72, fuelDay: 37, speedDes: 14.0, rent: 17500, co2: 3.02, ports: ["VIZ", "CHE", "KRI", "PRD"], avail: 76, draft: 12.2 },
  { id: "CAP", name: "Capesize", cap: 145, fuelDay: 74, speedDes: 14.5, rent: 26500, co2: 2.95, ports: ["VIZ", "PRD"], avail: 61, draft: 20.0 }
];

const FUELS = [
  { id: "VLSFO", name: "VLSFO (conventional)", price: 610, co2factor: 1.00, energy: 1.00, avail: 98 },
  { id: "LNG", name: "LNG", price: 580, co2factor: 0.78, energy: 1.00, avail: 62 },
  { id: "METH", name: "Methanol", price: 480, co2factor: 0.84, energy: 1.55, avail: 41 },
  { id: "AMN", name: "Ammonia", price: 690, co2factor: 0.10, energy: 2.30, avail: 22 },
  { id: "HYD", name: "Hydrogen (green)", price: 1050, co2factor: 0.05, energy: 2.65, avail: 12 }
];

const ROUTES = {
  A: { id: "A", label: "Route A · direct", dist: 4890, weatherRisk: 38, delay: 6, color: "#22d3ee", desc: "Shorter, moderate weather zone", way: [[149.3, -21.25], [137, -16], [122, -9], [106.5, -1], [95, 7], [88, 14], [83.3, 17.68]] },
  B: { id: "B", label: "Route B · great-circle offset", dist: 5090, weatherRisk: 21, delay: 0, color: "#34d399", desc: "+4% distance, avoids the storm corridor", way: [[149.3, -21.25], [135, -19], [118, -13], [102, -4], [92, 5], [86, 13], [83.3, 17.68]] },
  C: { id: "C", label: "Route C · monsoon-avoiding", dist: 5300, weatherRisk: 64, delay: 26, color: "#fbbf24", desc: "Longer northerly detour around persistent swell", way: [[149.3, -21.25], [136, -17.5], [119, -8], [105, 2], [93, 10], [84, 16], [83.3, 17.68]] }
};

const DEMAND_MONTHS = [
  { m: "May", k: 41 }, { m: "Jun", k: 45 }, { m: "Jul", k: 47 }, { m: "Aug", k: 50 },
  { m: "Sep", k: 52 }, { m: "Oct", k: 61 }, { m: "Nov", k: 74 }, { m: "Dec", k: 68 },
  { m: "Jan", k: 71 }, { m: "Feb", k: 63 }, { m: "Mar", k: 57 }, { m: "Apr", k: 53 }
];

const RATE_SERIES = { label: "Baltic-style index (simulated)", cur: 28.4 };
const WEATHER_EVENTS = [
  { id: "W1", name: "Bay of Bengal cyclone band", zone: "13-18N 88-93E", delay: 26, cost: 56, riskAdd: 34 },
  { id: "W2", name: "Strong SW-monsoon swell", zone: "Laccadive Sea", delay: 10, cost: 18, riskAdd: 16 },
  { id: "W3", name: "Rough seas, strait of Malacca", zone: "1-6N 98-104E", delay: 8, cost: 12, riskAdd: 12 }
];

const DEMO_NOTE = "Simulated demo data — no live telemetry connected. Field data layer is ready for real APIs.";