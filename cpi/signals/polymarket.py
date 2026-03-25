# signals/polymarket.py — Ceasefire probability from Polymarket
# Uses Gamma API (correct endpoint, verified).
# Price = probability. 0.30 = 30% ceasefire chance.
# State persisted for move detection across restarts.
# Early-abort on connectivity failure — don't burn 7×15s if API is unreachable.

import requests
import json
import socket
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import (
    POLYMARKET_API, POLYMARKET_SLUG, POLYMARKET_TIMEOUT, STATE_FILE
)

# Search strategies ordered: direct path lookups first, then filter-based, then keyword.
# Direct path = O(1), filter = O(n scan), keyword = full-text search.
# If connectivity fails on first attempt, we abort immediately.
_DIRECT_SLUGS = [
    POLYMARKET_SLUG,
    "iran-ceasefire",
    "us-iran-ceasefire",
    "iran-us-ceasefire",
]
_SEARCH_QUERIES = [
    # Keyword searches (broader — only tried after all direct slugs fail)
    {"text_query": "iran ceasefire", "closed": "false", "limit": 20},
    {"text_query": "iran war", "closed": "false", "limit": 20},
    {"tag": "iran", "closed": "false", "limit": 20},
    {"tag": "middle-east", "closed": "false", "limit": 30},
]


def _load_history():
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
        return state.get("polymarket_prices", [])
    except Exception:
        return []

def _save_history(prices):
    try:
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except Exception:
            state = {}
        state["polymarket_prices"] = prices[-192:]
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception as e:
        print(f"[POLYMARKET] State save error: {e}")


def _no_data(reason):
    return {
        "signal": "polymarket", "score": 50, "confidence": 0.0,
        "interpretation": f"NO DATA: {reason}",
        "alert": False, "price": None, "move_2h": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _check_connectivity():
    """Quick DNS + TCP check before wasting time on full HTTP requests."""
    try:
        host = "gamma-api.polymarket.com"
        ip = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
        if not ip:
            return False, "DNS resolution failed"
        # Quick TCP connect
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ip[0][4][0], 443))
        sock.close()
        return True, "ok"
    except socket.gaierror:
        return False, "DNS resolution failed for gamma-api.polymarket.com"
    except socket.timeout:
        return False, "TCP connect timeout (firewall or network issue?)"
    except Exception as e:
        return False, f"connectivity check failed: {str(e)[:60]}"


def _extract_price(market):
    """Extract YES token probability from a market object. Returns float 0-1 or None."""
    for field in ("outcomePrices", "bestBid", "lastTradePrice", "price"):
        val = market.get(field)
        if val is None:
            continue
        if isinstance(val, str):
            try:
                parsed = json.loads(val)
                if isinstance(parsed, list) and len(parsed) >= 1:
                    p = float(parsed[0])
                    if 0 <= p <= 1:
                        return p
            except (json.JSONDecodeError, ValueError):
                try:
                    p = float(val)
                    if 0 <= p <= 1:
                        return p
                except ValueError:
                    pass
        elif isinstance(val, (int, float)) and 0 <= float(val) <= 1:
            return float(val)
    return None


def _is_ceasefire_market(market):
    """Check if a market is about Iran ceasefire/peace."""
    q = (market.get("question", "") + " " + market.get("description", "")).lower()
    has_iran = any(k in q for k in ["iran", "iranian", "tehran", "persian gulf"])
    has_peace = any(k in q for k in ["ceasefire", "peace", "deal", "agreement",
                                      "diplomatic", "negotiat", "truce", "end of war"])
    return has_iran and has_peace


def _search_markets(session):
    """
    Try search strategies in order:
    1. Direct path: GET /markets/slug/<slug> — O(1) lookup, fastest
    2. Filter-based: GET /markets?text_query=... — full-text search
    3. Tag-based: GET /markets?tag=... — broadest

    Early abort on 2+ timeouts (network issue, don't waste 105s).
    """
    last_error = "no strategies succeeded"
    timeout_count = 0

    # ── Phase 1: Direct slug path (O(1) lookup per Gamma API docs) ──
    for slug in _DIRECT_SLUGS:
        if timeout_count >= 2:
            break
        try:
            print(f"[POLYMARKET] Direct: /markets/slug/{slug}")
            resp = session.get(
                f"{POLYMARKET_API}/markets/slug/{slug}",
                timeout=(5, POLYMARKET_TIMEOUT),
            )
            if resp.status_code == 200:
                market = resp.json()
                if market and _extract_price(market) is not None:
                    q = market.get("question", "?")
                    print(f"[POLYMARKET] ✓ Found via direct path: {q[:60]}")
                    return market, f"direct:slug={slug}"
            elif resp.status_code == 404:
                print(f"[POLYMARKET]   → 404 (slug not found)")
            else:
                print(f"[POLYMARKET]   → HTTP {resp.status_code}")
        except (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.Timeout):
            timeout_count += 1
            last_error = f"timeout on direct slug '{slug}'"
            print(f"[POLYMARKET]   → TIMEOUT")
        except requests.exceptions.ConnectionError as e:
            return None, f"connection failed: {str(e)[:80]}"
        except Exception as e:
            last_error = f"error on slug '{slug}': {str(e)[:60]}"
            print(f"[POLYMARKET]   → ERROR: {last_error}")

    # ── Phase 2: Filter/keyword search ──────────────────────────
    for i, params in enumerate(_SEARCH_QUERIES):
        if timeout_count >= 2:
            print(f"[POLYMARKET] Aborting after {timeout_count} timeouts — network issue")
            return None, f"network unreachable ({timeout_count} timeouts)"

        try:
            desc = params.get("text_query", params.get("tag", "?"))
            print(f"[POLYMARKET] Search {i}: {desc}")

            resp = session.get(
                f"{POLYMARKET_API}/markets",
                params=params,
                timeout=(5, POLYMARKET_TIMEOUT),
            )

            if resp.status_code != 200:
                last_error = f"HTTP {resp.status_code} for '{desc}'"
                print(f"[POLYMARKET]   → HTTP {resp.status_code}")
                continue

            data = resp.json()
            markets = data if isinstance(data, list) else [data] if data else []
            print(f"[POLYMARKET]   → {len(markets)} markets returned")

            for m in markets:
                if _is_ceasefire_market(m) and _extract_price(m) is not None:
                    q = m.get("question", "?")
                    print(f"[POLYMARKET] ✓ Found via search: {q[:60]}")
                    return m, f"search:{desc}"

            if markets:
                qs = [m.get("question", "?")[:40] for m in markets[:3]]
                print(f"[POLYMARKET]   No ceasefire match. Got: {qs}")

        except (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.Timeout):
            timeout_count += 1
            last_error = f"timeout on search '{desc}'"
            print(f"[POLYMARKET]   → TIMEOUT")
        except requests.exceptions.ConnectionError as e:
            return None, f"connection failed: {str(e)[:80]}"
        except Exception as e:
            last_error = f"error on search '{desc}': {str(e)[:60]}"
            print(f"[POLYMARKET]   → ERROR: {last_error}")

    return None, last_error


def collect_polymarket():
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    prices = _load_history()

    try:
        # Quick connectivity check — abort in 5s instead of 105s
        reachable, reason = _check_connectivity()
        if not reachable:
            print(f"[POLYMARKET] Connectivity check failed: {reason}")
            return _no_data(f"API unreachable — {reason}")

        print(f"[POLYMARKET] Connectivity OK, searching markets...")

        session = requests.Session()
        session.headers.update({
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 WarRoom/CPI",
        })

        market, method = _search_markets(session)

        if market is None:
            return _no_data(f"no ceasefire market found ({method})")

        price = _extract_price(market)
        if price is None:
            return _no_data(f"could not extract price from: {market.get('question', '?')[:60]}")

    except Exception as e:
        return _no_data(f"API error — {str(e)[:80]}")

    # Score = price * 100 (direct mapping: 30% ceasefire → score 30)
    score = max(0, min(100, round(price * 100)))

    # Store price
    prices.append({"price": price, "ts": now_iso})
    _save_history(prices)

    # Calculate 2-hour move for context
    move_2h = None
    two_hours_ago = now.timestamp() - 7200
    old = [p for p in prices if datetime.fromisoformat(p["ts"]).timestamp() < two_hours_ago]
    if old:
        anchor = old[-1]["price"]
        move_2h = round(price - anchor, 3)

    # Interpretation
    pct = round(price * 100, 1)
    if score >= 60:
        interp = f"Ceasefire at {pct}% — market sees deal forming"
    elif score >= 40:
        interp = f"Ceasefire at {pct}% — market uncertain"
    elif score >= 20:
        interp = f"Ceasefire at {pct}% — market skeptical"
    else:
        interp = f"Ceasefire at {pct}% — market sees no path to deal"

    if move_2h is not None:
        direction = "up" if move_2h > 0 else "down"
        interp += f" ({direction} {abs(move_2h)*100:.1f}pp in 2h)"

    return {
        "signal": "polymarket", "score": score, "confidence": 1.0,
        "interpretation": interp,
        "alert": move_2h is not None and abs(move_2h) >= 0.08,
        "price": round(price, 4),
        "move_2h": move_2h,
        "market_question": market.get("question", ""),
        "timestamp": now_iso,
    }
