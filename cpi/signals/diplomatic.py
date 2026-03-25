# signals/diplomatic.py
# Diplomatic news keyword scanner via RSS feeds
# Watches Pakistan (Dawn/Geo), Oman FM, Turkey for ceasefire broker signals
# High-value hits (specific broker names) trigger immediate alerts

import requests
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DIPLOMATIC_RSS_FEEDS, DIPLOMATIC_KEYWORDS

# High-value keywords that trigger immediate alerts
HIGH_VALUE_KEYWORDS = [
    "badr al-busaidi",
    "ceasefire framework",
    "deal reached",
    "agreement signed",
    "oman mediator",
    "pakistan host iran",
    "trump iran deal",
]


def collect_diplomatic():
    """
    Scan RSS feeds for diplomatic/broker keywords.
    Score based on how many peace-related keywords appear.
    """
    all_items = []

    for feed_url in DIPLOMATIC_RSS_FEEDS:
        try:
            r = requests.get(
                feed_url,
                timeout=10,
                headers={"User-Agent": "WarRoom/1.0"}
            )
            if r.status_code == 200:
                items = _parse_rss(r.text)
                all_items.extend(items)
        except Exception:
            continue

    if not all_items:
        return _no_data_result("Could not fetch any RSS feeds")

    # Scan for keywords
    keyword_hits = 0
    high_value_hits = 0
    matched_headlines = []

    for item in all_items[:30]:  # Last 30 items
        title = item.get("title", "").lower()
        desc = item.get("description", "").lower()
        text = f"{title} {desc}"

        for kw in DIPLOMATIC_KEYWORDS:
            if kw.lower() in text:
                keyword_hits += 1
                matched_headlines.append(item.get("title", "")[:100])
                break

        for kw in HIGH_VALUE_KEYWORDS:
            if kw.lower() in text:
                high_value_hits += 1
                break

    # Score: more diplomatic keywords = higher score
    # 0 hits = neutral (40), 1-2 = moderate (55-65), 3+ = strong (70-85)
    if keyword_hits == 0:
        score = 40
    elif keyword_hits <= 2:
        score = 55 + keyword_hits * 5
    elif keyword_hits <= 5:
        score = 70 + (keyword_hits - 2) * 5
    else:
        score = min(90, 80 + keyword_hits)

    # High-value hits boost score significantly
    if high_value_hits > 0:
        score = min(95, score + high_value_hits * 10)

    return {
        "signal": "diplomatic",
        "score": score,
        "keyword_hits": keyword_hits,
        "high_value_hits": high_value_hits,
        "total_items_scanned": len(all_items),
        "matched_headlines": matched_headlines[:5],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": _interpret(score, keyword_hits, high_value_hits),
    }


def _parse_rss(xml_text):
    """Parse RSS/Atom feed into list of {title, description, pubDate}."""
    items = []
    try:
        root = ET.fromstring(xml_text)

        # RSS 2.0
        for item in root.iter("item"):
            items.append({
                "title": _get_text(item, "title"),
                "description": _get_text(item, "description"),
                "pubDate": _get_text(item, "pubDate"),
            })

        # Atom
        if not items:
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall(".//atom:entry", ns):
                items.append({
                    "title": _get_text(entry, "atom:title", ns),
                    "description": _get_text(entry, "atom:summary", ns),
                    "pubDate": _get_text(entry, "atom:updated", ns),
                })
    except ET.ParseError:
        pass

    return items


def _get_text(element, tag, ns=None):
    if ns:
        el = element.find(tag, ns)
    else:
        el = element.find(tag)
    return el.text.strip() if el is not None and el.text else ""


def _interpret(score, hits, hv_hits):
    if hv_hits > 0:
        return f"🚨 {hv_hits} HIGH-VALUE diplomatic signal(s) — broker activity detected"
    if hits >= 3:
        return f"Strong diplomatic activity ({hits} keyword hits in feeds)"
    if hits >= 1:
        return f"Some diplomatic chatter ({hits} hits) — monitoring"
    return "No significant diplomatic signals in feeds"


def _no_data_result(reason):
    return {
        "signal": "diplomatic",
        "score": 40,
        "keyword_hits": 0,
        "high_value_hits": 0,
        "error": reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": f"Diplomatic feeds unavailable: {reason}",
    }
