// config.ts — War Room CPI v2 (Serverless)
// Ported from Python config.py. All constants + env vars.

// ── API KEYS ──────────────────────────────────────────────────
// Hardcoded defaults from config.py. Env vars override if set.
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "8718289654:AAEclo-CNfzxlM00TDATB9Rqtq20zN-1-IU";
export const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "7878981016";
export const AISSTREAM_API_KEY =
  process.env.AISSTREAM_API_KEY || "a3de235766c58d957172e3398f436258938d30f8";

// ── CPI SIGNAL WEIGHTS (must sum to 1.0) ─────────────────────
export const WEIGHTS: Record<string, number> = {
  hormuz: 0.35,
  polymarket: 0.35,
  bonbast: 0.30,
};

// ── CPI ZONES ────────────────────────────────────────────────
export const ZONES: Record<string, [number, number]> = {
  FULL_WAR: [0, 30],
  STATUS_QUO: [31, 50],
  DIPLOMATIC: [51, 70],
  CEASEFIRE_LIKELY: [71, 85],
  IMMINENT_DEAL: [86, 100],
};

export const ZONE_COLORS: Record<string, { color: string; emoji: string }> = {
  FULL_WAR: { color: "red", emoji: "\u{1F534}" },
  STATUS_QUO: { color: "orange", emoji: "\u{1F7E0}" },
  DIPLOMATIC: { color: "yellow", emoji: "\u{1F7E1}" },
  CEASEFIRE_LIKELY: { color: "green", emoji: "\u{1F7E2}" },
  IMMINENT_DEAL: { color: "emerald", emoji: "\u{1F49A}" },
};

// ── MINIMUM CONFIDENCE ───────────────────────────────────────
export const MIN_CONFIDENCE = 0.30;

// ── ALERT THRESHOLDS ─────────────────────────────────────────
export const CPI_CHANGE_ALERT = 10;
export const TELEGRAM_MAX_RETRIES = 3;
export const TELEGRAM_RETRY_DELAY = 5;

// ── HORMUZ CONFIG ────────────────────────────────────────────
export const HORMUZ_BOX: [[number, number], [number, number]] = [
  [23.0, 54.0],
  [27.5, 60.5],
];
export const HORMUZ_LISTEN_SECONDS = 45; // shorter for serverless (was 60)
export const HORMUZ_NORMAL_VESSELS = 20;

// ── POLYMARKET CONFIG ────────────────────────────────────────
export const POLYMARKET_API = "https://gamma-api.polymarket.com";
export const POLYMARKET_SLUG = "will-there-be-a-us-iran-ceasefire";
export const POLYMARKET_TIMEOUT = 15_000; // ms

// ── BONBAST CONFIG ───────────────────────────────────────────
export const BONBAST_URL = "https://bonbast.com";
export const BONBAST_TIMEOUT = 15_000; // ms
export const RIAL_SIGNIFICANT_MOVE = 0.03;

// Rate validation — Toman (1 Toman = 10 Rial)
export const TOMAN_MIN = 50_000;
export const TOMAN_MAX = 300_000;
export const RIAL_MIN = 500_000;
export const RIAL_MAX = 3_000_000;

// ── FLIGHTRADAR CONFIG ───────────────────────────────────────
export const FR24_URL =
  "https://data-live.flightradar24.com/zones/fcgi/feed.js";
export const FR24_GULF_BOUNDS = "28.0,22.0,50.0,62.0";
export const FR24_ALERT_THRESHOLD = 20;
export const FR24_TIMEOUT = 10_000;

// ── NASA FIRMS CONFIG ────────────────────────────────────────
export const FIRMS_URL =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv";
export const FIRMS_TIMEOUT = 30_000;
export const FIRMS_MIN_FRP = 50;
export const FIRMS_PREFER_NIGHT = true;

// Critical regions: [lat_min, lat_max, lon_min, lon_max, daily_baseline]
export const FIRMS_CRITICAL_REGIONS: Record<
  string,
  [number, number, number, number, number]
> = {
  Kharg_Island: [28.8, 29.3, 49.9, 50.3, 1],
  South_Pars: [26.8, 27.5, 51.8, 52.8, 5],
  Strait_Hormuz: [25.8, 26.8, 56.0, 57.5, 3],
  Bushehr_Nuclear: [28.7, 29.0, 50.7, 51.0, 0],
  Ras_Tanura: [26.6, 26.9, 49.9, 50.2, 1],
};

// Known persistent flare / industrial thermal locations [lat, lon, radius_deg]
export const FIRMS_KNOWN_FLARES: [number, number, number][] = [
  // Iran oil/gas
  [30.5, 48.0, 0.3],
  [27.1, 52.3, 0.4],
  [27.8, 52.0, 0.3],
  [29.3, 50.8, 0.15],
  // Qatar
  [25.9, 51.5, 0.3],
  [24.9, 51.6, 0.3],
  // UAE
  [25.1, 56.3, 0.3],
  [25.0, 55.1, 0.4],
  [24.5, 54.7, 0.3],
  // Kuwait
  [29.0, 48.5, 0.3],
  // Oman
  [24.3, 56.7, 0.3],
  [25.5, 56.0, 0.3],
  [23.0, 57.0, 0.3],
  // Saudi
  [26.3, 50.1, 0.3],
];

// ── SCENARIO BAYESIAN LINK ───────────────────────────────────
export const SCENARIO_SHIFTS: Record<string, Record<string, number>> = {
  hormuz_below_25: { hormuz_closure: 12, infra_hit: 5, attrition: 3 },
  hormuz_above_70: { ceasefire: 5, attrition: -3 },
  bonbast_strengthen: { ceasefire: 8, trump_putin: 3 },
  bonbast_weaken: { hormuz_closure: 3, mojtaba: 2 },
  polymarket_above_60: { ceasefire: 12, depletion: 4 },
  polymarket_below_20: { ceasefire: -10, attrition: 5 },
  firms_critical_hit: { infra_hit: 8, hormuz_closure: 5 },
  fr24_airspace_closed: { hormuz_closure: 5, attrition: 3 },
};

// ── SCHEDULE ─────────────────────────────────────────────────
export const SIGNAL_POLL_MINUTES = 15;
