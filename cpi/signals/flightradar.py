# signals/flightradar.py — Gulf airspace monitor (BINARY OVERRIDE)
# Not a CPI input. Fires as a scenario probability override when
# Gulf airspace is effectively closed (military ops likely).
# Uses unofficial FR24 public feed — may break without notice.

import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import FR24_URL, FR24_GULF_BOUNDS, FR24_ALERT_THRESHOLD, FR24_TIMEOUT


def _no_data(reason):
    return {
        "signal": "flightradar", "type": "override",
        "alert": False, "confidence": 0.0,
        "flight_count": None,
        "interpretation": f"NO DATA: {reason}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def collect_flightradar():
    try:
        params = {
            "bounds": FR24_GULF_BOUNDS,
            "faa": "1", "satellite": "1", "mlat": "1", "flarm": "1",
            "adsb": "1", "gnd": "0", "air": "1", "vehicles": "0",
            "estimated": "1", "gliders": "0", "stats": "1",
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        resp = requests.get(FR24_URL, params=params, headers=headers, timeout=FR24_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        # Count flights: each aircraft is an array with 18+ elements keyed by hex ICAO
        # Real aircraft arrays have exactly 18 elements. Metadata keys are strings/ints/dicts.
        # Using >= 13 to be safe against minor format changes while rejecting short metadata arrays.
        metadata_keys = {"full_count", "version", "stats", "selected"}
        flight_count = sum(
            1 for k, v in data.items()
            if k not in metadata_keys and isinstance(v, list) and len(v) >= 13
        )

        # Full count from API if available
        api_total = data.get("full_count", flight_count)
        count = max(flight_count, api_total) if isinstance(api_total, int) else flight_count

        # Alert logic
        alert = count < FR24_ALERT_THRESHOLD

        if count == 0:
            interp = "Gulf airspace CLOSED — zero flights detected"
        elif count < FR24_ALERT_THRESHOLD:
            interp = f"Only {count} flights in Gulf — airspace likely restricted (NOTAM probable)"
        elif count < 50:
            interp = f"{count} flights in Gulf — below normal (~80-150 typical)"
        else:
            interp = f"{count} flights in Gulf — normal traffic"

        return {
            "signal": "flightradar", "type": "override",
            "alert": alert, "confidence": 1.0,
            "flight_count": count,
            "interpretation": interp,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        return _no_data(f"FR24 error — {str(e)[:80]}")
