# signals/nasa_firms.py — Satellite thermal anomaly detection (BINARY OVERRIDE)
# Not a CPI input. Fires as a scenario probability override when
# thermal anomalies are detected at critical infrastructure ABOVE baseline.
# Uses NASA FIRMS VIIRS data — free, no API key, updates every 3h.
#
# Key design: industrial regions (South Pars, refineries) have thermal
# signatures every day. We only alert when hits EXCEED the daily baseline.
# Bushehr Nuclear has baseline=0 — any hit there is significant.

import csv
import io
import math
import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import (
    FIRMS_URL, FIRMS_URL_FALLBACK, FIRMS_TIMEOUT, FIRMS_MIN_FRP,
    FIRMS_PREFER_NIGHT, FIRMS_CRITICAL_REGIONS, FIRMS_KNOWN_FLARES
)


def _no_data(reason):
    """
    Missing satellite data ≠ "no strikes."
    alert=None (unknown), not alert=False (safe).
    """
    return {
        "signal": "nasa_firms", "type": "override",
        "alert": None,
        "confidence": 0.0,
        "total_hits": 0, "critical_hits": {}, "above_baseline": {},
        "interpretation": f"NO DATA: {reason} — cannot confirm or deny strikes",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _is_known_flare(lat, lon):
    """Check if point is near a known persistent flare / industrial site."""
    for flare_lat, flare_lon, radius in FIRMS_KNOWN_FLARES:
        dist = math.sqrt((lat - flare_lat)**2 + (lon - flare_lon)**2)
        if dist < radius:
            return True
    return False


def _in_region(lat, lon, bounds):
    """bounds = (lat_min, lat_max, lon_min, lon_max, baseline)"""
    lat_min, lat_max, lon_min, lon_max = bounds[:4]
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def _fetch_firms_csv():
    """Fetch FIRMS global 24h CSV (~5MB). Nighttime + geo filters cut this to a handful."""
    print(f"[FIRMS] Downloading global CSV...")
    resp = requests.get(FIRMS_URL, timeout=FIRMS_TIMEOUT)
    resp.raise_for_status()
    print(f"[FIRMS] Downloaded: {len(resp.text):,} bytes")
    return resp.text


def collect_nasa_firms():
    try:
        csv_text = _fetch_firms_csv()
        reader = csv.DictReader(io.StringIO(csv_text))

        required_cols = {"latitude", "longitude", "frp", "confidence"}
        if reader.fieldnames and not required_cols.issubset(set(reader.fieldnames)):
            missing = required_cols - set(reader.fieldnames)
            return _no_data(f"CSV schema changed — missing columns: {missing}")

        total_hits = 0
        critical_hits = {}   # region_name → raw count
        flare_filtered = 0   # how many we skipped as known flares
        day_filtered = 0     # how many we skipped as daytime (sun glint risk)

        for row in reader:
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
                frp = float(row.get("frp", 0))
                conf = row.get("confidence", "l")
                daynight = row.get("daynight", "")
            except (ValueError, KeyError):
                continue

            # Skip daytime detections if configured — eliminates sun glint
            if FIRMS_PREFER_NIGHT and daynight == "D":
                day_filtered += 1
                continue

            # Skip low-confidence AND low-power detections
            if conf == "l" and frp < FIRMS_MIN_FRP:
                continue

            # Skip known persistent flare / industrial sites
            if _is_known_flare(lat, lon):
                flare_filtered += 1
                continue

            # Only count Iran/Gulf area (22-40N, 44-64E)
            # (redundant if using regional URL, but safe for global fallback)
            if not (22 <= lat <= 40 and 44 <= lon <= 64):
                continue

            total_hits += 1

            # Check critical infrastructure regions
            for region_name, bounds in FIRMS_CRITICAL_REGIONS.items():
                if _in_region(lat, lon, bounds):
                    critical_hits[region_name] = critical_hits.get(region_name, 0) + 1

        # ── Baseline-aware alerting ───────────────────────────────
        # Only alert if hits EXCEED the daily baseline for a region.
        # A gas field with baseline=5 needs 6+ hits to trigger.
        above_baseline = {}
        for region_name, count in critical_hits.items():
            bounds = FIRMS_CRITICAL_REGIONS[region_name]
            baseline = bounds[4] if len(bounds) > 4 else 0
            excess = count - baseline
            if excess > 0:
                above_baseline[region_name] = excess

        # Alert only on above-baseline critical hits or very high total
        alert = bool(above_baseline) or total_hits > 30

        # ── Interpretation ────────────────────────────────────────
        if above_baseline:
            parts = []
            for region, excess in above_baseline.items():
                raw = critical_hits[region]
                baseline = FIRMS_CRITICAL_REGIONS[region][4] if len(FIRMS_CRITICAL_REGIONS[region]) > 4 else 0
                parts.append(f"{region} ({raw} hits, baseline {baseline}, +{excess} above)")
            regions_str = ", ".join(parts)
            interp = f"ABOVE-BASELINE thermal at {regions_str} — possible strike"
        elif critical_hits:
            # Hits detected but within normal baseline
            parts = [f"{k} ({v})" for k, v in critical_hits.items()]
            regions_str = ", ".join(parts)
            interp = f"Thermal at {regions_str} — within industrial baseline (normal)"
        elif total_hits > 30:
            interp = f"{total_hits} thermal detections across Iran/Gulf — elevated"
        elif total_hits > 0:
            interp = f"{total_hits} thermal detections — within normal range"
        else:
            interp = "No significant thermal anomalies in Iran/Gulf region"

        # Log diagnostic info
        if day_filtered > 0:
            print(f"[FIRMS] Filtered {day_filtered} daytime detections (sun glint risk)")
        if flare_filtered > 0:
            print(f"[FIRMS] Filtered {flare_filtered} known flare detections")
        if critical_hits:
            for r, c in critical_hits.items():
                baseline = FIRMS_CRITICAL_REGIONS[r][4] if len(FIRMS_CRITICAL_REGIONS[r]) > 4 else 0
                status = "ABOVE" if c > baseline else "normal"
                print(f"[FIRMS] {r}: {c} hits (baseline={baseline}) → {status}")

        return {
            "signal": "nasa_firms", "type": "override",
            "alert": alert, "confidence": 1.0,
            "total_hits": total_hits,
            "critical_hits": critical_hits,
            "above_baseline": above_baseline,
            "flare_filtered": flare_filtered,
            "interpretation": interp,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    except requests.exceptions.Timeout:
        return _no_data(f"FIRMS CSV timeout after {FIRMS_TIMEOUT}s")
    except Exception as e:
        return _no_data(f"FIRMS error — {str(e)[:80]}")
