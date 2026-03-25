# signals/iranwarlive.py
# Conflict event feed from iranwarlive.com
# Counts escalation vs de-escalation keywords in recent events
# More de-escalation keywords = higher score (peace)

import requests
from datetime import datetime, timezone, timedelta

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import IRANWARLIVE_FEED

# Keyword categories
ESCALATION_KEYWORDS = [
    "strike", "missile", "attack", "bomb", "killed", "casualties",
    "launch", "intercept", "retaliation", "target", "destroy",
    "invasion", "assault", "offensive", "mobiliz", "blockade",
    "IRGC", "IDF", "airstrike", "drone", "explosion", "inferno",
    "nuclear", "enrichment", "underground", "bunker", "warhead",
]

DEESCALATION_KEYWORDS = [
    "ceasefire", "talks", "negotiate", "peace", "diplomacy",
    "mediator", "broker", "framework", "agreement", "deal",
    "withdrawal", "humanitarian", "corridor", "exchange",
    "prisoner", "de-escalat", "pause", "truce", "restrain",
    "channel", "backchannel", "envoy", "summit",
]


def collect_iranwarlive():
    """
    Fetch latest events from IranWarLive feed.
    Score based on keyword balance: more peace keywords = higher score.
    """
    try:
        r = requests.get(
            IRANWARLIVE_FEED,
            timeout=10,
            headers={"User-Agent": "WarRoom/1.0"}
        )
        if r.status_code != 200:
            return _no_data_result(f"HTTP {r.status_code}")

        data = r.json()

        # Handle different feed formats
        if isinstance(data, list):
            events = data
        elif isinstance(data, dict):
            events = data.get("items", data.get("events", data.get("entries", [])))
        else:
            return _no_data_result("Unexpected feed format")

    except Exception as e:
        return _no_data_result(str(e))

    # Analyze last 24 hours of events
    now = datetime.now(timezone.utc)
    recent_events = events[:50]  # Cap at 50 most recent

    esc_count = 0
    deesc_count = 0
    event_texts = []

    for event in recent_events:
        # Get text content
        text = ""
        if isinstance(event, str):
            text = event
        elif isinstance(event, dict):
            text = " ".join(str(v) for v in [
                event.get("title", ""),
                event.get("description", ""),
                event.get("content", ""),
                event.get("summary", ""),
                event.get("text", ""),
            ])

        text_lower = text.lower()
        event_texts.append(text[:120])

        # Count keywords
        for kw in ESCALATION_KEYWORDS:
            if kw.lower() in text_lower:
                esc_count += 1
                break  # max 1 count per event per category

        for kw in DEESCALATION_KEYWORDS:
            if kw.lower() in text_lower:
                deesc_count += 1
                break

    # Score: balance of de-escalation vs escalation
    total = esc_count + deesc_count
    if total == 0:
        score = 50  # neutral if no keyword matches
    else:
        # Ratio of de-escalation to total
        peace_ratio = deesc_count / total
        score = int(peace_ratio * 100)

    # Clamp to 10-90 (never fully confident from news alone)
    score = max(10, min(90, score))

    return {
        "signal": "iranwarlive",
        "score": score,
        "escalation_events": esc_count,
        "deescalation_events": deesc_count,
        "total_events": len(recent_events),
        "recent_headlines": event_texts[:5],
        "timestamp": now.isoformat(),
        "interpretation": _interpret(score, esc_count, deesc_count),
    }


def _interpret(score, esc, deesc):
    if score >= 70:
        return f"Feed skews diplomatic ({deesc} peace vs {esc} conflict events)"
    if score >= 40:
        return f"Mixed signals ({deesc} peace vs {esc} conflict events)"
    return f"Feed heavily escalatory ({esc} conflict vs {deesc} peace events)"


def _no_data_result(reason):
    return {
        "signal": "iranwarlive",
        "score": 50,
        "error": reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": f"IranWarLive unavailable: {reason}",
    }
