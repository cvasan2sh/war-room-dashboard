# signals/bonbast.py — Iranian Rial black market rate
# Rial strengthening = peace signal. Rial weakening = war signal.
# Two approaches: (1) JSON API via token, (2) HTML scraping fallback.
# State (rate history) persisted to disk so restarts don't wipe context.

import re
import json
import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import BONBAST_URL, BONBAST_TIMEOUT, RIAL_SIGNIFICANT_MOVE, STATE_FILE

# ── Rate validation ───────────────────────────────────────
# Bonbast shows Toman (1 Toman = 10 Rial).
# Wartime depreciation: rate can spike well above peacetime ~84k.
# Ceiling raised to 300k Toman to handle severe depreciation scenarios.
TOMAN_MIN = 50_000
TOMAN_MAX = 300_000
RIAL_MIN  = 500_000
RIAL_MAX  = 3_000_000


# ── State persistence ───────────────────────────────────────

def _load_history():
    """Load rate history, auto-purging any invalid entries."""
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
        raw = state.get("bonbast_rates", [])
        # Purge bad entries — any rate outside valid range
        clean = [r for r in raw if isinstance(r.get("rate"), (int, float))
                 and _validate_rate(int(r["rate"])) is not None]
        if len(clean) < len(raw):
            print(f"[BONBAST] Purged {len(raw) - len(clean)} bad history entries")
            _save_history_raw(state, clean)
        return clean
    except Exception:
        return []

def _save_history_raw(state, rates):
    """Write rates to state file (internal, no reload)."""
    try:
        state["bonbast_rates"] = rates[-672:]
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception as e:
        print(f"[BONBAST] State save error: {e}")

def _save_history(rates):
    try:
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except Exception:
            state = {}
        _save_history_raw(state, rates)
    except Exception as e:
        print(f"[BONBAST] State save error: {e}")


def _no_data(reason):
    return {
        "signal": "bonbast", "score": 50, "confidence": 0.0,
        "interpretation": f"NO DATA: {reason}",
        "alert": False, "rate": None, "trend_pct": 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _validate_rate(val):
    """Return val if it's a plausible USD/Toman or USD/Rial rate, else None."""
    if val is None:
        return None
    if TOMAN_MIN <= val <= TOMAN_MAX:
        return val
    if RIAL_MIN <= val <= RIAL_MAX:
        return val
    return None


def _outlier_check(rate, history):
    """Reject rate if it differs from last known good reading by >30%."""
    if not history:
        return True  # No history, accept anything that passed range check
    last = history[-1]["rate"]
    if last == 0:
        return True
    pct_diff = abs(rate - last) / last
    if pct_diff > 0.30:
        print(f"[BONBAST] Outlier rejected: {rate:,} vs last {last:,} ({pct_diff*100:.1f}% diff)")
        return False
    return True


def _fetch_via_json_api(session):
    """
    Primary method: get token from page, then POST to /json for clean data.
    Bonbast loads rates via AJAX — the HTML is just a shell.
    Returns (rate, html) — rate may be None, html returned for fallback.
    """
    resp = session.get(BONBAST_URL, timeout=BONBAST_TIMEOUT)
    resp.raise_for_status()
    html = resp.text

    # Debug: show page size so we know something came back
    print(f"[BONBAST] Page fetched: {len(html)} bytes")

    # Token extraction — bonbast embeds a token in JS for AJAX calls
    token = None
    for pattern in [
        r'var\s+param\s*=\s*["\']([^"\']+)',
        r'param["\']?\s*:\s*["\']([^"\']+)',
        r"param['\"]?\s*:\s*['\"]([^'\"]+)",
        r'name=["\']param["\'][^>]*value=["\']([^"\']+)',
        r'value=["\']([^"\']+)["\'][^>]*name=["\']param',
        r'"token"\s*:\s*"([^"]+)"',
        r"'token'\s*:\s*'([^']+)'",
        # Sometimes it's in a data attribute
        r'data-token=["\']([^"\']+)',
        # Or passed as a function argument
        r'getPrice\s*\(\s*["\']([^"\']+)',
        r'loadData\s*\(\s*["\']([^"\']+)',
    ]:
        m = re.search(pattern, html)
        if m:
            candidate = m.group(1).strip()
            # Token should be alphanumeric, 10+ chars, not a URL or CSS class
            if len(candidate) >= 8 and not candidate.startswith("http") and " " not in candidate:
                token = candidate
                print(f"[BONBAST] Token found via pattern: {pattern[:40]}...")
                break

    if not token:
        print("[BONBAST] No API token found in page, falling back to HTML parsing")
        return None, html

    # POST to /json with token
    try:
        json_resp = session.post(
            f"{BONBAST_URL}/json",
            data={"param": token},
            headers={
                "X-Requested-With": "XMLHttpRequest",
                "Referer": BONBAST_URL,
            },
            timeout=BONBAST_TIMEOUT,
        )
        print(f"[BONBAST] /json response: HTTP {json_resp.status_code}")

        if json_resp.status_code != 200:
            return None, html

        data = json_resp.json()
        print(f"[BONBAST] /json keys: {list(data.keys())[:10]}")

        # Extract USD rate from JSON — try multiple key names
        usd_keys = ("usd1", "usd2", "usd_sell", "usd_buy", "dollar1", "dollar2")

        # Debug: show what USD values are actually in the JSON
        usd_debug = {k: data.get(k) for k in usd_keys if data.get(k) is not None}
        if usd_debug:
            print(f"[BONBAST] USD values in JSON: {usd_debug}")
        else:
            # Maybe different key names — show all keys containing 'usd' or 'dollar'
            matching = {k: v for k, v in data.items() if 'usd' in k.lower() or 'dollar' in k.lower()}
            print(f"[BONBAST] No standard USD keys. Matching keys: {matching}")

        for key in usd_keys:
            raw = data.get(key)
            if raw is not None:
                try:
                    val = int(str(raw).replace(",", "").replace(".", "").strip())
                    rate = _validate_rate(val)
                    if rate:
                        print(f"[BONBAST] ✓ API rate from '{key}': {rate:,}")
                        return rate, html
                    else:
                        print(f"[BONBAST] Key '{key}'={val} FAILED range check (need {TOMAN_MIN:,}-{TOMAN_MAX:,} or {RIAL_MIN:,}-{RIAL_MAX:,})")
                except (ValueError, TypeError) as e:
                    print(f"[BONBAST] Key '{key}' parse error: {raw!r} → {e}")
                    continue

        # If keys didn't match, dump what we got for debugging
        print(f"[BONBAST] No valid rate in JSON. Sample values: {dict(list(data.items())[:5])}")

    except Exception as e:
        print(f"[BONBAST] /json POST failed: {e}")

    return None, html


def _parse_rate_from_html(html):
    """Fallback: extract USD/IRR rate from HTML. Every match is range-validated."""
    candidates = []

    # Strategy 1: id="usd1" or id="usd2" cells — grab ALL nearby numbers
    for usd_id in ("usd1", "usd2"):
        # Look in a narrow window after the id attribute
        match = re.search(rf'id=["\']?{usd_id}["\']?[^>]*>([^<]*)', html, re.DOTALL)
        if match:
            inner = match.group(1).strip()
            nums = re.findall(r'[\d,]+', inner)
            for n in nums:
                try:
                    candidates.append(int(n.replace(",", "")))
                except ValueError:
                    pass

    # Strategy 2: data-sell or data-buy attribute
    for attr in ("data-sell", "data-buy", "data-usd"):
        match = re.search(rf'{attr}=["\'](\d[\d,]+)', html)
        if match:
            candidates.append(int(match.group(1).replace(",", "")))

    # Strategy 3: class="price" or class="sell" elements
    for cls in ("price", "sell", "usd-price"):
        prices = re.findall(rf'class=["\'][^"\']*{cls}[^"\']*["\'][^>]*>\s*(\d[\d,]+)', html)
        for p in prices:
            candidates.append(int(p.replace(",", "")))

    # Strategy 4: numbers in 5-6 digit range with comma formatting (84,250 pattern)
    numbers = re.findall(r'\b(\d{2,3},\d{3})\b', html)
    for n in numbers:
        candidates.append(int(n.replace(",", "")))

    # Strategy 5: plain 5-6 digit numbers
    numbers = re.findall(r'\b(\d{5,6})\b', html)
    for n in numbers:
        candidates.append(int(n))

    # Log what we found for debugging
    valid = [c for c in candidates if _validate_rate(c) is not None]
    if candidates:
        print(f"[BONBAST] HTML candidates: {candidates[:8]}... valid: {valid[:5]}")

    # Return the first candidate that passes range validation
    for val in candidates:
        rate = _validate_rate(val)
        if rate:
            return rate

    return None


def _score_from_trend(trend_pct):
    """
    Smooth scoring. No cliffs at threshold boundaries.
    trend_pct > 0 = Rial strengthening (peace)
    trend_pct < 0 = Rial weakening (war)
    """
    import math
    scaled = trend_pct * 667  # 0.03 * 667 ≈ 20
    score = 50 + max(-40, min(40, round(scaled)))
    return max(5, min(95, score))


def collect_bonbast():
    now = datetime.now(timezone.utc).isoformat()
    rates = _load_history()  # Auto-purges bad entries

    # Fetch rate — try JSON API first, then HTML fallback
    try:
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })

        # Method 1: JSON API (most reliable)
        rate, html = _fetch_via_json_api(session)
        method = "api"

        # Method 2: HTML scraping fallback
        if rate is None and html:
            rate = _parse_rate_from_html(html)
            method = "html"

        if rate is None:
            return _no_data("could not extract valid USD/IRR rate (all methods failed)")

        # Outlier check against history
        if not _outlier_check(rate, rates):
            return _no_data(f"rate {rate:,} rejected as outlier vs recent history")

        print(f"[BONBAST] ✓ Rate {rate:,} via {method}")

    except Exception as e:
        return _no_data(f"fetch failed — {str(e)[:80]}")

    # Store rate
    rates.append({"rate": rate, "ts": now})
    _save_history(rates)

    # Calculate trend
    if len(rates) < 2:
        return {
            "signal": "bonbast", "score": 50, "confidence": 0.8,
            "interpretation": f"Rial at {rate:,} — first reading, no trend yet",
            "alert": False, "rate": rate, "trend_pct": 0.0,
            "timestamp": now,
        }

    # Compare to 24h average (96 readings at 15-min)
    recent = rates[-96:] if len(rates) >= 96 else rates
    avg_rate = sum(r["rate"] for r in recent) / len(recent)
    trend_pct = (avg_rate - rate) / avg_rate  # positive = strengthening

    score = _score_from_trend(trend_pct)
    significant = abs(trend_pct) >= RIAL_SIGNIFICANT_MOVE

    # Interpretation
    direction = "strengthening" if trend_pct > 0.005 else "weakening" if trend_pct < -0.005 else "stable"
    if significant and trend_pct > 0:
        interp = f"Rial strengthening ({trend_pct*100:+.1f}%) at {rate:,} — peace signal"
    elif significant and trend_pct < 0:
        interp = f"Rial weakening ({trend_pct*100:+.1f}%) at {rate:,} — stress signal"
    else:
        interp = f"Rial {direction} ({trend_pct*100:+.1f}%) at {rate:,} — no significant move"

    return {
        "signal": "bonbast", "score": score, "confidence": 1.0,
        "interpretation": interp,
        "alert": significant,
        "rate": rate, "trend_pct": round(trend_pct, 4),
        "timestamp": now,
    }
