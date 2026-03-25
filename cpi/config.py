# config.py — War Room CPI v2
# Rebuilt 2026-03-25: 3 weighted signals + 2 binary overrides
# Killed: NetBlocks, IranWarLive, GPSJam, Diplomatic, morning brief, trade recs

import os

# ── API KEYS ────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = "8718289654:AAEclo-CNfzxlM00TDATB9Rqtq20zN-1-IU"
TELEGRAM_CHAT_ID   = "7878981016"
AISSTREAM_API_KEY  = "a3de235766c58d957172e3398f436258938d30f8"

# ── CPI SIGNAL WEIGHTS (must sum to 1.0) ────────────────────
# Only signals with working, verified APIs get weight.
# Confidence-weighted at runtime: if a signal returns confidence=0,
# its weight redistributes to confident signals automatically.
WEIGHTS = {
    "hormuz":     0.35,   # AIS vessel tracking — physical atoms, highest alpha
    "polymarket": 0.35,   # Prediction market — best single binary indicator
    "bonbast":    0.30,   # Black market Rial — real price discovery
}

# ── CPI ZONES ───────────────────────────────────────────────
# These map CPI score to trading stance
ZONES = {
    "FULL_WAR":        (0,  30),   # bears run, check puts on Sensibull
    "STATUS_QUO":      (31, 50),   # range-bound, stay flat
    "DIPLOMATIC":      (51, 70),   # de-escalation, reduce bear positions
    "CEASEFIRE_LIKELY": (71, 85),  # exit bears
    "IMMINENT_DEAL":   (86, 100),  # full risk-on
}

# ── MINIMUM CONFIDENCE ──────────────────────────────────────
# Below this threshold, CPI reports "INSUFFICIENT DATA" instead of a number.
# 0.3 means at least 30% of total weight must come from confident signals.
MIN_CONFIDENCE = 0.30

# ── ALERT THRESHOLDS ────────────────────────────────────────
CPI_CHANGE_ALERT = 10          # alert if CPI moves this much in 1 hour
TELEGRAM_MAX_RETRIES = 3       # retry failed sends
TELEGRAM_RETRY_DELAY = 5       # seconds between retries

# ── HORMUZ CONFIG ───────────────────────────────────────────
HORMUZ_BOX = [[23.0, 54.0], [27.5, 60.5]]
HORMUZ_LISTEN_SECONDS = 60     # how long to listen on WebSocket
HORMUZ_NORMAL_VESSELS = 20     # baseline: ~20 tankers visible in 60s window

# ── POLYMARKET CONFIG ───────────────────────────────────────
# Using Gamma API (correct endpoint, not CLOB)
POLYMARKET_API = "https://gamma-api.polymarket.com"
POLYMARKET_SLUG = "will-there-be-a-us-iran-ceasefire"
POLYMARKET_TIMEOUT = 15

# ── BONBAST CONFIG ──────────────────────────────────────────
BONBAST_URL = "https://bonbast.com"
BONBAST_TIMEOUT = 15
RIAL_SIGNIFICANT_MOVE = 0.03   # 3% move = significant

# ── FLIGHTRADAR CONFIG (binary override) ────────────────────
FR24_URL = "https://data-live.flightradar24.com/zones/fcgi/feed.js"
FR24_GULF_BOUNDS = "28.0,22.0,50.0,62.0"
FR24_ALERT_THRESHOLD = 20     # below this = airspace likely restricted
FR24_TIMEOUT = 10

# ── NASA FIRMS CONFIG (binary override) ─────────────────────
# FIRMS data — global CSV is the reliable source (~5MB).
# Our geographic filter (22-40N, 44-64E) + nighttime-only + known flare filter
# reduces this to a handful of relevant detections.
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv"
FIRMS_URL_FALLBACK = FIRMS_URL  # Single source — no fallback needed
FIRMS_TIMEOUT = 30
FIRMS_MIN_FRP = 50            # minimum fire radiative power to count
FIRMS_PREFER_NIGHT = True     # nighttime detections only — eliminates sun glint false positives

# Critical infrastructure regions — TIGHTENED bounding boxes.
# Each region also has a "baseline" — normal daily thermal count from industrial activity.
# Only hits ABOVE baseline trigger an alert.
FIRMS_CRITICAL_REGIONS = {
    # (lat_min, lat_max, lon_min, lon_max, daily_baseline)
    "Kharg_Island":    (28.8, 29.3, 49.9, 50.3, 1),    # Oil terminal, small area
    "South_Pars":      (26.8, 27.5, 51.8, 52.8, 5),    # World's largest gas field — flares constantly
    "Strait_Hormuz":   (25.8, 26.8, 56.0, 57.5, 3),    # Tightened: actual strait, not all of UAE coast
    "Bushehr_Nuclear":  (28.7, 29.0, 50.7, 51.0, 0),    # Nuclear plant — any hit is significant
    "Ras_Tanura":      (26.6, 26.9, 49.9, 50.2, 1),    # Saudi oil terminal
}

# Known persistent flare / industrial thermal locations (lat, lon, radius_deg)
# These are ALWAYS hot — never count as anomalies.
FIRMS_KNOWN_FLARES = [
    # Iran oil/gas
    (30.5, 48.0, 0.3),   # Ahvaz oil fields
    (27.1, 52.3, 0.4),   # South Pars gas flares (Iran side)
    (27.8, 52.0, 0.3),   # Assaluyeh LNG complex
    (29.3, 50.8, 0.15),  # Bushehr refinery area (north of nuclear plant)
    # Qatar
    (25.9, 51.5, 0.3),   # Ras Laffan LNG (Qatar side of South Pars)
    (24.9, 51.6, 0.3),   # Mesaieed industrial city
    # UAE
    (25.1, 56.3, 0.3),   # Fujairah oil terminal + refinery
    (25.0, 55.1, 0.4),   # Jebel Ali industrial zone
    (24.5, 54.7, 0.3),   # Ruwais refinery (Abu Dhabi)
    # Kuwait
    (29.0, 48.5, 0.3),   # Kuwait oil fields
    # Oman
    (24.3, 56.7, 0.3),   # Sohar industrial port
    (25.5, 56.0, 0.3),   # Oman gas flaring
    (23.0, 57.0, 0.3),   # Duqm refinery
    # Saudi
    (26.3, 50.1, 0.3),   # Jubail industrial city
]

# ── SCENARIO BAYESIAN LINK ──────────────────────────────────
# How CPI signals shift scenario probabilities (additive, then renormalize)
# Format: signal_condition → {scenario_key: probability_shift}
SCENARIO_SHIFTS = {
    "hormuz_below_25":   {"hormuz_closure": +12, "infra_hit": +5, "attrition": +3},
    "hormuz_above_70":   {"ceasefire": +5, "attrition": -3},
    "bonbast_strengthen": {"ceasefire": +8, "trump_putin": +3},
    "bonbast_weaken":     {"hormuz_closure": +3, "mojtaba": +2},
    "polymarket_above_60": {"ceasefire": +12, "depletion": +4},
    "polymarket_below_20": {"ceasefire": -10, "attrition": +5},
    "firms_critical_hit":  {"infra_hit": +8, "hormuz_closure": +5},
    "fr24_airspace_closed": {"hormuz_closure": +5, "attrition": +3},
}

# ── SCHEDULE ────────────────────────────────────────────────
SIGNAL_POLL_MINUTES = 15

# ── DATA PATHS ──────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
NEXTJS_DATA_DIR = os.path.join(BASE_DIR, "..", "public", "data")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
NEXTJS_HISTORY_FILE = os.path.join(NEXTJS_DATA_DIR, "history.json")
STATE_FILE = os.path.join(DATA_DIR, "signal_state.json")  # persisted rolling history
ALERT_LOG_FILE = os.path.join(DATA_DIR, "alert_log.json")  # fallback if Telegram fails
