# signals/netblocks.py
# Iran internet connectivity via NetBlocks / Cloudflare Radar
# Internet shutdowns correlate with active strike waves
# Drop >25% from rolling avg = KINETIC alert

import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import NETBLOCKS_URL, NETBLOCKS_COUNTRY, NETBLOCKS_DROP_PCT

# Rolling average tracker (in-memory)
_history = []


def collect_netblocks():
    """
    Check Iran internet connectivity.
    Primary: NetBlocks API
    Fallback: Cloudflare Radar
    Returns score 0-100 (100 = full connectivity = peace)
    """
    connectivity = None
    source = None

    # Try NetBlocks first
    try:
        r = requests.get(
            f"{NETBLOCKS_URL}score/{NETBLOCKS_COUNTRY}",
            timeout=10,
            headers={"User-Agent": "WarRoom/1.0"}
        )
        if r.status_code == 200:
            data = r.json()
            connectivity = data.get("score", data.get("connectivity"))
            if connectivity is not None:
                connectivity = float(connectivity)
                source = "netblocks"
    except Exception:
        pass

    # Fallback: Cloudflare Radar
    if connectivity is None:
        try:
            r = requests.get(
                "https://api.cloudflare.com/client/v4/radar/netflows/timeseries",
                params={"location": "IR", "dateRange": "1d"},
                timeout=10,
                headers={"User-Agent": "WarRoom/1.0"}
            )
            if r.status_code == 200:
                data = r.json()
                # Extract latest traffic level relative to baseline
                series = data.get("result", {}).get("series", [])
                if series and len(series) > 0:
                    latest = series[-1] if isinstance(series, list) else None
                    if latest:
                        connectivity = float(latest.get("value", 50))
                        source = "cloudflare"
        except Exception:
            pass

    # If both fail, return neutral
    if connectivity is None:
        return _no_data_result("Both NetBlocks and Cloudflare failed")

    # Normalize to 0-100 (NetBlocks scores are typically 0-100 already)
    score = max(0, min(100, int(connectivity)))

    # Track rolling average for drop detection
    _history.append(score)
    if len(_history) > 7 * 24 * 4:  # 7 days at 15-min intervals
        _history.pop(0)

    # Calculate rolling average
    rolling_avg = sum(_history) / len(_history) if _history else score
    drop_pct = (rolling_avg - score) / rolling_avg if rolling_avg > 0 else 0

    # Alert if significant drop
    alert = drop_pct >= NETBLOCKS_DROP_PCT

    return {
        "signal": "netblocks",
        "score": score,
        "connectivity_raw": connectivity,
        "rolling_avg": round(rolling_avg, 1),
        "drop_pct": round(drop_pct * 100, 1),
        "alert": alert,
        "source": source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": _interpret(score, drop_pct, alert),
    }


def _interpret(score, drop_pct, alert):
    if alert:
        return f"⚠️ Iran internet dropped {drop_pct*100:.0f}% — possible strike wave"
    if score < 30:
        return f"Iran internet severely degraded ({score}%) — active disruption"
    if score < 60:
        return f"Iran internet reduced ({score}%) — partial connectivity"
    if score < 85:
        return f"Iran internet moderate ({score}%) — some throttling"
    return f"Iran internet normal ({score}%) — no disruption detected"


def _no_data_result(reason):
    return {
        "signal": "netblocks",
        "score": 50,
        "alert": False,
        "error": reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": f"Internet data unavailable: {reason}",
    }
