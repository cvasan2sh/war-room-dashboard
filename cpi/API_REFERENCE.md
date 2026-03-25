# War Room CPI — API Reference

**Last updated**: 2026-03-25 | **CPI Version**: v2 | **Signals**: 3 weighted + 2 binary overrides

This document covers every external API the Ceasefire Probability Index consumes, how we use it, what we expect back, and what breaks. If a signal starts returning garbage, start here.

---

## Table of Contents

1. [AISstream (Hormuz Vessel Tracking)](#1-aisstream--hormuz-vessel-tracking)
2. [Polymarket Gamma API (Ceasefire Probability)](#2-polymarket-gamma-api--ceasefire-probability)
3. [Bonbast (Iranian Rial Black Market Rate)](#3-bonbast--iranian-rial-black-market-rate)
4. [NASA FIRMS (Satellite Thermal Anomaly)](#4-nasa-firms--satellite-thermal-anomaly)
5. [Flightradar24 (Gulf Airspace Monitoring)](#5-flightradar24--gulf-airspace-monitoring)
6. [Telegram Bot API (Alert Delivery)](#6-telegram-bot-api--alert-delivery)

---

## 1. AISstream — Hormuz Vessel Tracking

**Signal type**: Weighted (35%) | **File**: `signals/hormuz.py`

### What It Does

Counts tankers and cargo vessels transiting the Strait of Hormuz via AIS (Automatic Identification System) transponder data received over WebSocket. More vessels = normal trade flow = higher ceasefire score. Drop in traffic = potential blockade or conflict escalation.

### Official Documentation

- Docs: https://aisstream.io/documentation
- GitHub examples: https://github.com/aisstream/example
- Message models (OpenAPI): https://github.com/aisstream/ais-message-models
- Issues tracker: https://github.com/aisstream/issues

### Connection Details

| Field | Value |
|-------|-------|
| Protocol | WebSocket Secure (WSS) |
| Endpoint | `wss://stream.aisstream.io/v0/stream` |
| Auth | API key in subscription message (NOT in headers) |
| Keepalive | `ping_interval=20`, `ping_timeout=10` |
| Sub deadline | Must send subscription within 3 seconds of connect |

### Authentication

The API key goes inside the subscription JSON, not in HTTP headers:

```json
{
  "APIKey": "a3de235766c58d957172e3398f436258938d30f8",
  "BoundingBoxes": [[[54.0, 23.0], [60.5, 27.5]]],
  "FilterMessageTypes": ["PositionReport"]
}
```

**Key format**: 40-character hex string. Free tier, no paid plans documented.

### Bounding Box Format

**CRITICAL**: Coordinate order is `[longitude, latitude]`, NOT `[lat, lon]`.

```
BoundingBoxes: [[[lon_min, lat_min], [lon_max, lat_max]]]
```

Our Hormuz box (from `config.py`):
- `HORMUZ_BOX = [[23.0, 54.0], [27.5, 60.5]]` — covers the Strait entrance and Gulf of Oman

Multiple boxes can overlap without data duplication.

### Message Structure

Each message from the WebSocket:

```json
{
  "MessageType": "PositionReport",
  "MetaData": {
    "MMSI": 123456789,
    "ShipName": "FRONT ALTAIR",
    "ShipType": 80,
    "country_iso": "LR",
    "Latitude": 26.234,
    "Longitude": 56.789,
    "time_utc": "2026-03-25T07:30:00Z"
  },
  "Message": {
    "PositionReport": {
      "Sog": 12.5,
      "Cog": 290.3,
      "TrueHeading": 288,
      "NavigationalStatus": 0,
      "RateOfTurn": 0,
      "PositionAccuracy": true,
      "Raim": false,
      "Timestamp": 45,
      "Valid": true
    }
  }
}
```

### Ship Type Codes We Care About

| Code Range | Type | Relevance |
|-----------|------|-----------|
| 80-89 | Tankers | Primary — oil/gas flow through Hormuz |
| 70-79 | Cargo | Secondary — general trade flow |
| 60-69 | Passenger | Low — but drop signals something |
| 30-39 | Fishing | Ignore — always present |

We filter for ShipType >= 60 (tankers, cargo, passenger) and count unique MMSIs.

### How We Score

Sigmoid curve, not step function:

```python
k = 2.5 / HORMUZ_NORMAL_VESSELS  # HORMUZ_NORMAL_VESSELS = 20
raw = 100 * (1 - exp(-k * count))
score = max(5, min(95, round(raw)))
```

- 0 vessels → score 5 (catastrophic)
- 10 vessels → score ~71
- 20 vessels (normal) → score ~92
- Flag bonus/penalty: 3+ flagged nations → +5, only 1 → -8

### Confidence Logic

| Condition | Confidence | Meaning |
|-----------|-----------|---------|
| WebSocket fails to connect | 0.0 | No data at all |
| Connected, zero messages in 60s | 0.5 | Connected but suspicious |
| Real vessel data received | 1.0 | Trustworthy reading |

### Known Issues

- **Queue overflow**: If client can't keep up with messages, AISstream closes the connection silently. Our 60-second listen window mitigates this.
- **Coverage gaps**: Zero messages during gap ≠ zero ships. That's why connected-but-empty gets confidence 0.5, not 0.0.
- **MetaData inconsistency**: `country_iso` field sometimes appears as `Flag` instead. We check both: `meta.get("country_iso", meta.get("Flag", ""))`.
- **ShipType may be missing**: Not all messages include ShipType in MetaData. We default to counting the vessel anyway.

### Rate Limits

- 1 subscription update per second max
- No documented per-user connection limits
- Full worldwide subscription requires ~300 msg/sec throughput

---

## 2. Polymarket Gamma API — Ceasefire Probability

**Signal type**: Weighted (35%) | **File**: `signals/polymarket.py`

### What It Does

Fetches the current implied probability of a US-Iran ceasefire from Polymarket's prediction market. Price = probability. 0.30 = market thinks 30% chance of ceasefire.

### Official Documentation

- Overview: https://docs.polymarket.com/developers/gamma-markets-api/overview
- API Reference: https://docs.polymarket.com/api-reference/
- Rate Limits: https://docs.polymarket.com/api-reference/rate-limits
- GitHub (agents): https://github.com/Polymarket/agents/blob/main/agents/polymarket/gamma.py
- GitHub (CLOB client): https://github.com/Polymarket/py-clob-client

### Connection Details

| Field | Value |
|-------|-------|
| Base URL | `https://gamma-api.polymarket.com` |
| Protocol | HTTPS REST |
| Auth | **None required** — fully public, read-only API |
| Rate limit | Cloudflare-throttled (no hard rejection, requests queued) |

### Gamma API vs CLOB API

| | Gamma API (we use this) | CLOB API |
|---|---|---|
| Purpose | Market discovery, metadata, prices | Trading operations, order books |
| Auth | None | API key + private key for trading |
| URL | `gamma-api.polymarket.com` | `clob.polymarket.com` |
| Best for | Reading market data | Placing trades |

We only need to read ceasefire probability — Gamma API is correct.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/markets` | GET | List/filter markets |
| `/markets/slug/<slug>` | GET | Direct slug lookup (O(1)) |
| `/events` | GET | Events with grouped markets |
| `/search` | GET | Free-text search |
| `/tags` | GET | List all tags |

### Query Parameters for `/markets`

| Param | Type | Example | Notes |
|-------|------|---------|-------|
| `slug` | string | `iran-ceasefire` | Exact match, server-side filter |
| `text_query` | string | `iran ceasefire` | Free-text keyword search |
| `tag` | string | `iran` | Filter by tag name |
| `tag_id` | int | `100381` | Filter by tag ID |
| `closed` | string | `"false"` | Active/closed filter |
| `active` | string | `"true"` | Active filter |
| `limit` | int | `20` | Results per page (max 100) |
| `offset` | int | `0` | Pagination offset |
| `order` | string | `"volume"` | Sort field |
| `ascending` | bool | `false` | Sort direction |

### Market Object — Key Fields

```json
{
  "id": "0x1234...",
  "slug": "iran-ceasefire",
  "question": "Will there be a US-Iran ceasefire by June 2026?",
  "description": "This market resolves YES if...",
  "outcomes": ["Yes", "No"],
  "outcomePrices": "[\"0.35\",\"0.65\"]",
  "volume": "1234567.89",
  "liquidity": "45678.90",
  "bestBid": 0.34,
  "bestAsk": 0.36,
  "lastTradePrice": 0.35,
  "active": true,
  "closed": false,
  "clobTokenIds": ["123456", "789012"],
  "startDate": "2026-01-15T00:00:00Z",
  "endDate": "2026-06-30T23:59:59Z"
}
```

### outcomePrices Parsing

**CRITICAL**: `outcomePrices` is a **stringified JSON array of strings**, not a native array.

```python
raw = market.get("outcomePrices")  # "[\"0.35\",\"0.65\"]"
parsed = json.loads(raw)           # ["0.35", "0.65"]
yes_price = float(parsed[0])      # 0.35
no_price = float(parsed[1])       # 0.65
# yes + no ≈ 1.0 always
```

For binary markets: index 0 = YES probability, index 1 = NO probability.

### Our Search Strategy

We try 7 approaches in order (fast-fail on connectivity):

1. Slug: `will-there-be-a-us-iran-ceasefire`
2. Slug: `iran-ceasefire`
3. Slug: `us-iran-ceasefire`
4. Slug: `iran-us-ceasefire`
5. Text query: `iran ceasefire`
6. Text query: `iran war`
7. Tag: `iran`, then `middle-east`

For keyword searches, we validate that the market mentions Iran AND ceasefire/peace/deal before accepting it.

**Early abort**: If 2+ queries time out, we stop — it's a network issue, not a search issue.

### How We Score

Direct mapping: price → score → CPI contribution.

```
price = 0.35 → score = 35 → "Ceasefire at 35% — market skeptical"
price = 0.70 → score = 70 → "Ceasefire at 70% — market sees deal forming"
```

2-hour move tracked for alerts (>8pp move = significant).

### Known Issues

- **Slug mismatch**: Market slugs change. Our multi-strategy search handles this.
- **Grouped markets**: Some markets are under `/events`, not discoverable via `/markets` alone.
- **Cloudflare throttling**: Not a hard reject — requests get queued, then slow down. Eventually 429.
- **outcomePrices format**: Changes occasionally. We try multiple price fields as fallback: `outcomePrices → bestBid → lastTradePrice → price`.
- **Network timeouts**: Gamma API can be slow from certain regions. Our pre-flight DNS+TCP check catches this in 5s instead of 105s.

---

## 3. Bonbast — Iranian Rial Black Market Rate

**Signal type**: Weighted (30%) | **File**: `signals/bonbast.py`

### What It Does

Tracks the Iranian Rial's black market exchange rate against USD. Rial strengthening = peace signal (sanctions relief priced in). Rial weakening = war signal (capital flight, economic stress).

### Data Source

- Website: https://bonbast.com
- Official paid API: https://bonbast.com/webmaster (requires hash key, accepts crypto payment)
- Community library: https://github.com/SamadiPour/bonbast (PyPI: `bonbast`)

### How Bonbast Serves Data

Bonbast is **not** a simple static HTML page. The page loads as a shell, then rates are fetched via JavaScript AJAX call.

**Two-step flow**:
1. GET `https://bonbast.com` → HTML shell containing a token embedded in JS
2. POST `https://bonbast.com/json` with `{param: <token>}` → JSON with all currency rates

### Token Extraction

The token is embedded in the page's JavaScript. We try 10+ regex patterns:

```python
# Patterns tried (in order):
r'var\s+param\s*=\s*["\']([^"\']+)'      # var param = "TOKEN"
r'param["\']?\s*:\s*["\']([^"\']+)'        # param: "TOKEN"
r'name=["\']param["\'][^>]*value=["\']...' # <input name="param" value="TOKEN">
r'"token"\s*:\s*"([^"]+)"'                 # "token": "TOKEN"
r'getPrice\s*\(\s*["\']([^"\']+)'          # getPrice("TOKEN")
# ... and more
```

Token must be 8+ chars, alphanumeric, not a URL.

### JSON API Response

POST to `/json` with headers `X-Requested-With: XMLHttpRequest` and `Referer: https://bonbast.com`:

```json
{
  "usd1": "84250",
  "usd2": "84150",
  "eur1": "91500",
  "eur2": "91300",
  "gbp1": "108000",
  "gbp2": "107500",
  "aed1": "22950",
  "aed2": "22850",
  "try1": "2350",
  "try2": "2310"
}
```

- `usd1` = USD sell (what you pay to buy dollars), `usd2` = USD buy (what you get selling dollars)
- All values in **Toman** (1 Toman = 10 Rial)
- Current rate ~84,000 Toman/USD = ~840,000 Rial/USD

### Rate Format

| Format | Range | Example |
|--------|-------|---------|
| Toman | 50,000 – 150,000 | 84,250 |
| Rial | 500,000 – 1,500,000 | 842,500 |

We accept both ranges. Anything outside (like "24" or "30,000") is rejected.

### Fallback: HTML Scraping

If the JSON API fails (no token found), we parse the HTML:

1. Look for `id="usd1"` or `id="usd2"` cells
2. Try `data-sell`, `data-buy` attributes
3. Try `class="price"` elements
4. Brute-force 5-6 digit numbers with comma formatting

**Every candidate is range-validated** — must be 50k-150k Toman or 500k-1.5M Rial.

### Outlier Detection

If a new rate differs from the last valid reading by >30%, it's rejected:

```python
if abs(new_rate - last_rate) / last_rate > 0.30:
    return _no_data("outlier rejected")
```

### History Auto-Purge

On load, any stored rates outside the valid range are automatically removed from `signal_state.json`. This cleans up after parser bugs.

### How We Score

Trend-based, centered at 50:

```python
trend_pct = (avg_24h - current) / avg_24h  # positive = strengthening
score = 50 + clamp(trend_pct * 667, -40, +40)
```

- Rial strengthening 3% → score ~70 (peace signal)
- Rial weakening 3% → score ~30 (war signal)
- Stable → score ~50 (neutral)

### Known Issues

- **Cloudflare protection**: Bonbast uses Cloudflare. Rate limiting likely but not documented.
- **Token rotation**: Token format/location in JS may change when they update the site.
- **First reading**: Returns confidence 0.8 (no trend data yet), score 50.
- **Anti-regime pressure**: Bonbast has been threatened by Iranian authorities. May go down.
- **No alternatives**: Bonbast is effectively the monopoly source for Iranian black market FX. Telegram channels mirror Bonbast data.

---

## 4. NASA FIRMS — Satellite Thermal Anomaly

**Signal type**: Binary override (not scored) | **File**: `signals/nasa_firms.py`

### What It Does

Downloads global thermal anomaly detections from NASA's VIIRS satellite, filters for critical infrastructure in the Iran/Gulf region, and alerts if detections **exceed daily industrial baseline**. This catches strikes on oil terminals, nuclear facilities, etc.

### Official Documentation

- Main site: https://firms.modaps.eosdis.nasa.gov/
- Earthdata hub: https://www.earthdata.nasa.gov/data/tools/firms
- API docs: https://firms.modaps.eosdis.nasa.gov/api/
- VIIRS User Guide: https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf
- Active fire attributes: https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs

### Connection Details

| Field | Value |
|-------|-------|
| URL | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv` |
| Protocol | HTTPS (direct CSV download) |
| Auth | **None** — free public data |
| Update frequency | Every ~3 hours |
| Satellite | NOAA-20 (JPSS-1) VIIRS instrument |
| Spatial resolution | 375 meters |

### CSV Column Reference

| Column | Type | Description |
|--------|------|-------------|
| `latitude` | float | Detection latitude |
| `longitude` | float | Detection longitude |
| `bright_ti4` | float | Brightness temp I4 channel (Kelvin) |
| `scan` | int | Scan position |
| `track` | int | Track position |
| `acq_date` | string | Acquisition date (YYYY-MM-DD) |
| `acq_time` | int | Acquisition time UTC (HHMM) |
| `satellite` | string | S=Suomi NPP, N20=NOAA-20, N21=NOAA-21 |
| `confidence` | string | "l" (low), "n" (nominal), "h" (high) |
| `version` | string | e.g., "2.0NRT" (Collection 2 Near Real-Time) |
| `bright_ti5` | float | Brightness temp I5 channel (Kelvin) |
| `frp` | float | Fire Radiative Power (Megawatts) |
| `daynight` | string | D=daytime, N=nighttime |

### Confidence Values

| Value | Range | Meaning | Our Action |
|-------|-------|---------|------------|
| `"l"` (low) | 0-29% | Sun glint, marginal detection | Skip if FRP < 50 MW |
| `"n"` (nominal) | 30-79% | Standard detection | Count it |
| `"h"` (high) | 80-100% | Strong detection | Count it |

### FRP (Fire Radiative Power)

- **Units**: Megawatts (MW)
- **Our threshold**: `FIRMS_MIN_FRP = 50` — only applied to low-confidence detections
- **Typical ranges**: gas flares routinely exceed 50 MW, large industrial sites 100+ MW
- **Actual fires/strikes**: Would show as clusters of high-FRP, high-confidence detections

### Our Monitoring Regions (Tightened Bounding Boxes)

| Region | Lat Range | Lon Range | Baseline | Why |
|--------|-----------|-----------|----------|-----|
| Kharg Island | 28.8-29.3 | 49.9-50.3 | 1/day | Iran's main oil export terminal |
| South Pars | 26.8-27.5 | 51.8-52.8 | 5/day | World's largest gas field — always flaring |
| Strait Hormuz | 25.8-26.8 | 56.0-57.5 | 3/day | Tightened to actual strait only |
| Bushehr Nuclear | 28.7-29.0 | 50.7-51.0 | 0/day | Nuclear plant — ANY hit is critical |
| Ras Tanura | 26.6-26.9 | 49.9-50.2 | 1/day | Saudi oil terminal |

### Known Flare Locations (14 sites)

We maintain a list of permanent thermal sources that VIIRS always detects. These are never counted as anomalies:

- Iran: Ahvaz oil fields, South Pars flares, Assaluyeh LNG, Bushehr refinery
- Qatar: Ras Laffan LNG, Mesaieed industrial
- UAE: Fujairah terminal, Jebel Ali, Ruwais refinery
- Kuwait: Kuwait oil fields
- Oman: Sohar port, gas flaring, Duqm refinery
- Saudi: Jubail industrial

### Baseline-Aware Alerting

**This is the key design decision.** Raw hit count means nothing — South Pars has 5 thermal detections on a normal day. We only alert when hits **exceed** the region's baseline:

```python
excess = count - baseline
if excess > 0:
    above_baseline[region] = excess  # This is a real anomaly
```

### Cross-Signal Validation

If FIRMS fires but Hormuz shows normal vessel traffic (score > 60), the alert is downgraded:

- **FIRMS alert + Hormuz normal** → severity "info" (industrial noise)
- **FIRMS above baseline + Hormuz normal** → severity "warning" (mixed signal)
- **FIRMS alert + Hormuz low** → severity "critical" (consistent picture)

### Alert Logic

```
alert = None    → NO DATA (can't confirm or deny)
alert = False   → No significant anomalies
alert = True    → Above-baseline hits OR total > 30 across region
```

### Known Issues

- **Sun glint false positives**: Bright water/surfaces during daytime. Our confidence filter handles this.
- **Gas flares (37% of false detections)**: Known flare list handles this. May need periodic updates.
- **Industrial sites (44% of false detections)**: Covered by our 14-site flare list.
- **3-hour latency**: Data isn't real-time. A strike at 3:00 might not show until 6:00.
- **MODIS vs VIIRS**: We use VIIRS only (375m resolution, better). Could add MODIS (1km, different orbit) for redundancy.
- **Static Thermal Anomaly mask**: Available on FIRMS web interface but not in the CSV download. We replicate this with our known flares list.

---

## 5. Flightradar24 — Gulf Airspace Monitoring

**Signal type**: Binary override (not scored) | **File**: `signals/flightradar.py`

### What It Does

Counts commercial flights in Gulf airspace. A sudden drop to near-zero indicates NOTAM closures — military operations likely in progress. This is an unofficial API with no SLA.

### Endpoint

| Field | Value |
|-------|-------|
| URL | `https://data-live.flightradar24.com/zones/fcgi/feed.js` |
| Protocol | HTTPS REST (unofficial) |
| Auth | None (public endpoint) |
| Rate limit | ~1 request per 5 seconds (practical safe limit) |

### Parameters

| Param | Value | Purpose |
|-------|-------|---------|
| `bounds` | `"28.0,22.0,50.0,62.0"` | Geographic box: north,south,west,east |
| `faa` | `1` | Include FAA data |
| `satellite` | `1` | Include satellite ADS-B |
| `mlat` | `1` | Include multilateration |
| `flarm` | `1` | Include Flarm |
| `adsb` | `1` | Include ADS-B |
| `gnd` | `0` | Exclude ground vehicles |
| `air` | `1` | Airborne only |
| `vehicles` | `0` | Exclude special vehicles |
| `estimated` | `1` | Include estimated positions |
| `gliders` | `0` | Exclude gliders |
| `stats` | `1` | Include statistics |

### Bounding Box Format

**Order**: `north,south,west,east` (decimal degrees)

Our Gulf bounds: `"28.0,22.0,50.0,62.0"` covering the Persian Gulf, Strait of Hormuz, and Gulf of Oman.

### Response Structure

```json
{
  "full_count": 156,
  "version": 4,
  "3c6589": [52.3456, 1.234, 280, 35000, 450, 0, "7000", "BAW123", "B789", "G-ABCD", 1234567890, "LHR", "DXB", 0, 0, 0, 0, 0],
  "a12b34": [26.789, 56.123, 90, 33000, 480, 100, "1234", "UAE456", "A388", "A6-ABC", 1234567891, "DXB", "LHR", 0, 0, 0, 0, 0]
}
```

Each aircraft is an array keyed by hex ICAO code:
- Index 0: Latitude
- Index 1: Longitude
- Index 2: Track (degrees)
- Index 3: Altitude (feet)
- Index 4: Speed (knots)
- Index 7: Callsign
- Index 8: Aircraft type
- Index 11: Origin airport
- Index 12: Destination airport

### How We Count Flights

```python
flights = [v for k, v in data.items() if isinstance(v, list) and len(v) > 5]
count = len(flights)
```

We skip metadata keys (`version`, `full_count`, `stats`) by checking for list type with 5+ elements.

### Alert Threshold

```
count < FR24_ALERT_THRESHOLD (20) → alert = True (airspace likely closed)
count >= 20 → alert = False (normal operations)
```

### Known Issues

- **Cloudflare protection**: FR24 uses Cloudflare. Must send realistic User-Agent header.
- **Rate limiting**: Polling faster than once per 5 seconds may trigger 429 errors or IP blocks.
- **ADS-B coverage gaps**: Military aircraft and some regions have no ADS-B receivers — flights appear to vanish.
- **GPS jamming**: Active in conflict zones. ADS-B data becomes unreliable. FR24 flags these.
- **No SLA**: This is an unofficial endpoint. May break without notice if FR24 changes their API.
- **`full_count` inconsistency**: Sometimes missing. Always fall back to counting arrays.

### Official API Alternative

FR24 has an official API at `https://fr24api.flightradar24.com/` with proper auth and SLA. Starts at ~$500/month for commercial use. We use the free unofficial endpoint.

---

## 6. Telegram Bot API — Alert Delivery

**Signal type**: Output (not a data source) | **File**: `alerts.py`

### What It Does

Sends interrupt-only alerts to Siva's Telegram when: CPI zone changes, CPI moves >10 points in an hour, or binary override signals fire. No morning briefs, no trade recs.

### Official Documentation

- Bot API: https://core.telegram.org/bots/api
- BotFather: https://t.me/BotFather

### Connection Details

| Field | Value |
|-------|-------|
| Base URL | `https://api.telegram.org/bot{TOKEN}` |
| Our token | `8718289654:AAEclo-CNfzxlM00TDATB9Rqtq20zN-1-IU` |
| Chat ID | `7878981016` |
| Parse mode | HTML |
| Method | POST to `/sendMessage` |

### sendMessage Payload

```python
payload = {
    "chat_id": "7878981016",
    "text": "<b>CPI ZONE CHANGE</b>\nSTATUS_QUO → DIPLOMATIC\nCPI: 55 (conf: 65%)",
    "parse_mode": "HTML"
}
```

### HTML Formatting Tags

```html
<b>bold</b>
<i>italic</i>
<u>underline</u>
<s>strikethrough</s>
<code>inline code</code>
<pre>code block</pre>
<a href="url">link</a>
```

Line breaks: use `\n` (not `<br>`). Max message length: 4096 characters.

### Rate Limits

| Scope | Limit |
|-------|-------|
| Per chat (1:1) | 1 message/second |
| Per group | 20 messages/minute |
| Global (all chats) | ~30 messages/second |

Exceeding limits returns HTTP 429 with `retry_after` field.

### Error Handling

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 200 | Success | Continue |
| 400 | Bad request (invalid chat_id, bad HTML) | **Don't retry** — log to disk |
| 401 | Invalid token | **Don't retry** — fix config |
| 403 | Bot blocked/kicked | **Don't retry** — user must /start |
| 429 | Rate limited | **Retry** after `retry_after` seconds |
| 5xx | Server error | **Retry** with backoff |

### Our Retry Strategy

```
Attempt 1 → fail → wait 5s
Attempt 2 → fail → wait 5s
Attempt 3 → fail → log to disk fallback
```

3 attempts, 5-second fixed delay. On all-retries-failed, message is saved to `cpi/data/alert_log.json` so nothing is lost.

**Improvement**: Could read `retry_after` from 429 responses instead of fixed 5s delay.

### Setup Requirement

**User must send `/start` to the bot before it can message them.** This is a Telegram security requirement — bots cannot initiate conversations. If alerts return 403 "chat not found", this is the fix.

---

## Cross-Reference: Signal Interaction Matrix

| If... | And... | Then... |
|-------|--------|---------|
| Hormuz score > 60 (normal traffic) | FIRMS fires alert | FIRMS downgraded to "info" — industrial noise |
| Hormuz score > 60 | FIRMS above baseline | FIRMS downgraded to "warning" — mixed signal, note normal traffic |
| Hormuz score < 25 | FIRMS fires alert | FIRMS stays "critical" — consistent picture of strike |
| Hormuz score > 70 | Any | Scenario shift: ceasefire +5, attrition -3 |
| Hormuz score < 25 | Any | Scenario shift: hormuz_closure +12, infra_hit +5, attrition +3 |
| Bonbast trend > +3% | Any | Scenario shift: ceasefire +8, trump_putin +3 |
| Bonbast trend < -3% | Any | Scenario shift: hormuz_closure +3, mojtaba +2 |
| Polymarket > 60% | Any | Scenario shift: ceasefire +12, depletion +4 |
| Polymarket < 20% | Any | Scenario shift: ceasefire -10, attrition +5 |
| FR24 < 20 flights | Any | Scenario shift: hormuz_closure +5, attrition +3 |

---

## Data Flow

```
[AISstream WSS] ──→ hormuz.py ──→ score + confidence
[Gamma API REST] ──→ polymarket.py ──→ score + confidence
[Bonbast HTTP] ──→ bonbast.py ──→ score + confidence
[FIRMS CSV] ──→ nasa_firms.py ──→ alert (True/False/None)
[FR24 REST] ──→ flightradar.py ──→ alert (True/False)
                                       │
                     ┌─────────────────┘
                     ▼
              cpi_engine.py
              ├─ confidence-weighted CPI
              ├─ zone classification
              ├─ Bayesian scenario shifts
              └─ cross-signal override validation
                     │
              ┌──────┴──────┐
              ▼              ▼
         alerts.py      scheduler.py
         (Telegram)     (JSON → public/data/)
                              │
                              ▼
                        Next.js dashboard
                        (page.tsx reads JSON)
```

---

## Environment & Config

All API keys and thresholds live in `cpi/config.py`. State persistence in `cpi/data/signal_state.json`. History in `cpi/data/history.json`.

**Run command** (Windows CMD):
```
cd war-room-dashboard\cpi
python -B scheduler.py
```

The `-B` flag skips bytecache generation (avoids stale `.pyc` issues).
