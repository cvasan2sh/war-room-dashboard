# signals/gpsjam.py
# GPS spoofing/jamming density in the Persian Gulf from GPSJam.org
# High spoofing = active electronic warfare = war signal
# Uses 3-day moving average to smooth daily variance

import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import GPSJAM_URL, GPSJAM_GULF_LAT, GPSJAM_GULF_LON

# 3-day rolling average tracker
_intensity_history = []


def collect_gpsjam():
    """
    Fetch GPS jamming heatmap data and extract Gulf region intensity.
    Score: Low spoofing = high score (peace), high spoofing = low score (war).
    """
    intensity = None

    try:
        r = requests.get(
            GPSJAM_URL,
            timeout=15,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
                "Referer": "https://gpsjam.org/",
            }
        )
        if r.status_code == 200:
            data = r.json()
            intensity = _fetch_gulf_intensity(data)
    except Exception as e:
        # Try alternative: scrape the page for summary stats
        try:
            intensity = _fallback_scrape()
        except Exception:
            return _no_data_result(str(e))

    if intensity is None:
        intensity = 0.5  # fallback neutral

    # Track 3-day moving average
    _intensity_history.append(intensity)
    if len(_intensity_history) > 3 * 24 * 4:  # 3 days at 15-min
        _intensity_history.pop(0)

    avg_intensity = sum(_intensity_history) / len(_intensity_history)

    # Score: invert intensity (high spoofing = low score)
    # Intensity 0.0 = no spoofing = 90 score
    # Intensity 1.0 = max spoofing = 10 score
    score = max(10, min(90, int(90 - avg_intensity * 80)))

    return {
        "signal": "gpsjam",
        "score": score,
        "intensity_raw": round(intensity, 3),
        "intensity_3d_avg": round(avg_intensity, 3),
        "readings": len(_intensity_history),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": _interpret(score, avg_intensity),
    }


def _fetch_gulf_intensity(data):
    """
    Extract spoofing intensity for the Gulf region from heatmap JSON.
    Data format varies — handle multiple formats.
    """
    lat_min, lat_max = GPSJAM_GULF_LAT
    lon_min, lon_max = GPSJAM_GULF_LON

    if isinstance(data, list):
        # Format: list of {lat, lon, intensity} objects
        gulf_points = [
            p.get("intensity", p.get("value", 0))
            for p in data
            if isinstance(p, dict)
            and lat_min <= p.get("lat", p.get("latitude", 0)) <= lat_max
            and lon_min <= p.get("lon", p.get("longitude", 0)) <= lon_max
        ]
        if gulf_points:
            return sum(gulf_points) / len(gulf_points)

    elif isinstance(data, dict):
        # Format: nested dict or grid
        points = data.get("points", data.get("data", data.get("features", [])))
        if isinstance(points, list):
            gulf_points = []
            for p in points:
                coords = p.get("geometry", {}).get("coordinates", [])
                props = p.get("properties", p)
                if len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                elif isinstance(p, dict):
                    lat = p.get("lat", p.get("latitude", 0))
                    lon = p.get("lon", p.get("longitude", 0))
                else:
                    continue

                if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
                    val = props.get("intensity", props.get("value", 0))
                    gulf_points.append(float(val))

            if gulf_points:
                return sum(gulf_points) / len(gulf_points)

    return None


def _fallback_scrape():
    """If JSON endpoint fails, try scraping summary from main page."""
    r = requests.get(
        "https://gpsjam.org",
        timeout=10,
        headers={"User-Agent": "WarRoom/1.0"}
    )
    # Look for any numerical data about Gulf region
    # This is fragile and may need updating
    import re
    matches = re.findall(r'gulf.*?(\d+\.?\d*)%', r.text, re.IGNORECASE)
    if matches:
        return float(matches[0]) / 100
    return None


def _interpret(score, avg_intensity):
    pct = avg_intensity * 100
    if score >= 70:
        return f"Low GPS spoofing in Gulf ({pct:.0f}%) — electronic calm"
    if score >= 40:
        return f"Moderate GPS spoofing ({pct:.0f}%) — some electronic warfare"
    return f"Heavy GPS spoofing ({pct:.0f}%) — active electronic warfare zone"


def _no_data_result(reason):
    return {
        "signal": "gpsjam",
        "score": 50,
        "error": reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interpretation": f"GPSJam unavailable: {reason}",
    }
