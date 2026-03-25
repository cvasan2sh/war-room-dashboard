# signals/hormuz.py — AIS vessel tracking in Strait of Hormuz
# The alpha signal. Counts physical ships transiting the strait.
# More ships = trade flowing = peace. Zero ships = blockade or data failure.
#
# CRITICAL: Distinguishes "no ships" from "can't see."
# confidence=0 if WebSocket fails, confidence=1 if we got real data.

import asyncio
import json
import math
import time
from datetime import datetime, timezone

try:
    import websockets
except ImportError:
    websockets = None

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import (
    AISSTREAM_API_KEY, HORMUZ_BOX, HORMUZ_LISTEN_SECONDS,
    HORMUZ_NORMAL_VESSELS
)


def _no_data(reason):
    """Return a result that clearly says 'I have no data.'"""
    return {
        "signal": "hormuz", "score": 50, "confidence": 0.0,
        "interpretation": f"NO DATA: {reason}",
        "alert": False, "count": 0, "flag_count": 0, "flags": [],
        "messages_received": 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _score(count, flag_count):
    """Smooth sigmoid scoring. No step functions, no cliffs."""
    if count == 0:
        return 5
    # Calibrate so HORMUZ_NORMAL_VESSELS → ~75
    k = 2.5 / HORMUZ_NORMAL_VESSELS
    raw = 100 * (1 - math.exp(-k * count))
    s = max(5, min(95, round(raw)))
    # Flag diversity: smooth adjustment, not a cliff
    if count >= 3:
        if flag_count >= 3:
            s = min(95, s + 5)
        elif flag_count == 1:
            s = max(5, s - 8)
    return s


def _interpret(count, flag_count, score):
    flags = f", {flag_count} flag states" if flag_count else ""
    if count == 0:
        return "Zero vessels in strait — possible blockade or shipping halt"
    if score >= 70:
        return f"{count} vessels transiting{flags} — normal commercial flow"
    if score >= 40:
        return f"{count} vessels transiting{flags} — reduced traffic"
    return f"{count} vessels transiting{flags} — severely disrupted"


async def collect_hormuz(duration_seconds=None):
    if duration_seconds is None:
        duration_seconds = HORMUZ_LISTEN_SECONDS

    if not AISSTREAM_API_KEY:
        return _no_data("AISSTREAM_API_KEY not configured")
    if websockets is None:
        return _no_data("websockets library not installed (pip install websockets)")

    vessels = {}
    messages_received = 0
    connection_ok = False

    try:
        subscribe = {
            "APIKey": AISSTREAM_API_KEY,
            "BoundingBoxes": [HORMUZ_BOX],
            "FilterMessageTypes": ["PositionReport"],  # Only position data, skip static reports
        }
        async with websockets.connect(
            "wss://stream.aisstream.io/v0/stream",
            ping_interval=20, ping_timeout=10
        ) as ws:
            await ws.send(json.dumps(subscribe))
            connection_ok = True
            deadline = time.time() + duration_seconds

            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    messages_received += 1
                    msg = json.loads(raw)
                    meta = msg.get("MetaData", {})
                    mmsi = meta.get("MMSI", "")
                    if not mmsi:
                        continue
                    vessels[mmsi] = {
                        "type": meta.get("ShipType", 0),
                        "flag": meta.get("country_iso", meta.get("Flag", "")),
                    }
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print(f"[HORMUZ] WebSocket closed after {messages_received} msgs")
                    break

    except Exception as e:
        err = str(e)[:100]
        if "403" in err or "401" in err:
            return _no_data(f"API key rejected — {err}")
        if "proxy" in err.lower():
            return _no_data(f"proxy blocked — {err}")
        return _no_data(f"WebSocket error — {err}")

    count = len(vessels)
    flags = list(set(v["flag"] for v in vessels.values() if v["flag"]))
    flag_count = len(flags)
    score = _score(count, flag_count)
    interp = _interpret(count, flag_count, score)

    # Confidence logic:
    # 1.0 = connected, received messages, have real vessel data
    # 0.5 = connected, zero messages (AIS coverage gap?)
    # 0.0 = couldn't connect (handled above)
    if connection_ok and messages_received > 0:
        confidence = 1.0
    elif connection_ok:
        confidence = 0.5
        interp += " (low AIS volume — coverage gap possible)"
    else:
        confidence = 0.0

    return {
        "signal": "hormuz", "score": score, "confidence": confidence,
        "interpretation": interp,
        "alert": count == 0 and confidence >= 0.5,
        "count": count, "flag_count": flag_count, "flags": flags,
        "messages_received": messages_received,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
