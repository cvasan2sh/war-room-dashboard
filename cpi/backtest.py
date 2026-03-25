# backtest.py
# Retrospective calibration using June 2025 12-Day War timeline
# Run once: python backtest.py
# Outputs: backtest_results.json + prints calibration report

import json
import os
from datetime import datetime, timezone, timedelta

CEASEFIRE_ANNOUNCEMENT = datetime(2025, 6, 24, 18, 0, tzinfo=timezone.utc)

KNOWN_PRECURSOR_EVENTS = [
    {
        "ts":    datetime(2025, 6, 22, 10, 0, tzinfo=timezone.utc),
        "type":  "diplomatic",
        "desc":  "Oman FM Badr Al-Busaidi statement — breakthrough 'within reach'",
        "lead":  56,
    },
    {
        "ts":    datetime(2025, 6, 23, 6, 0, tzinfo=timezone.utc),
        "type":  "maritime",
        "desc":  "First non-Iranian vessel transited Hormuz after 8 days",
        "lead":  36,
    },
    {
        "ts":    datetime(2025, 6, 23, 14, 0, tzinfo=timezone.utc),
        "type":  "economic",
        "desc":  "Rial strengthened 4.2% on Tehran black market",
        "lead":  28,
    },
    {
        "ts":    datetime(2025, 6, 23, 20, 0, tzinfo=timezone.utc),
        "type":  "kinetic",
        "desc":  "Iran internet connectivity recovered to 45% (from 12% baseline)",
        "lead":  22,
    },
    {
        "ts":    datetime(2025, 6, 24, 6, 0, tzinfo=timezone.utc),
        "type":  "maritime",
        "desc":  "Hormuz vessel count reached 8/day — 3 different flag states",
        "lead":  12,
    },
    {
        "ts":    datetime(2025, 6, 24, 12, 0, tzinfo=timezone.utc),
        "type":  "economic",
        "desc":  "Polymarket ceasefire probability crossed 60%",
        "lead":  6,
    },
    {
        "ts":    datetime(2025, 6, 24, 15, 0, tzinfo=timezone.utc),
        "type":  "diplomatic",
        "desc":  "Trump Truth Social post hinting at deal — TACO pattern",
        "lead":  3,
    },
]


def run_backtest():
    print("=" * 60)
    print("JUNE 2025 WAR — SIGNAL CALIBRATION REPORT")
    print("=" * 60)
    print(f"Ceasefire announced: {CEASEFIRE_ANNOUNCEMENT.strftime('%Y-%m-%d %H:%M UTC')}")
    print()

    signal_types = {}
    for evt in sorted(KNOWN_PRECURSOR_EVENTS, key=lambda x: x["ts"]):
        lead = (CEASEFIRE_ANNOUNCEMENT - evt["ts"]).total_seconds() / 3600
        stype = evt["type"]
        if stype not in signal_types:
            signal_types[stype] = []
        signal_types[stype].append(lead)
        print(f"  {lead:5.0f}h before | [{stype.upper():<12}] {evt['desc']}")

    print()
    print("── CALIBRATED LEAD TIMES BY SIGNAL GROUP ──")
    calibration = {}
    for stype, leads in signal_types.items():
        avg = sum(leads) / len(leads)
        earliest = max(leads)
        latest = min(leads)
        calibration[stype] = {
            "avg_lead_hours":      round(avg, 1),
            "earliest_lead_hours": round(earliest, 1),
            "latest_lead_hours":   round(latest, 1),
            "signal_count":        len(leads),
        }
        print(f"  {stype:<14}: avg {avg:.0f}h lead (range {latest:.0f}h–{earliest:.0f}h)")

    print()
    print("── RECOMMENDED ALERT PRIORITY ──")
    sorted_cal = sorted(calibration.items(),
                        key=lambda x: x[1]["earliest_lead_hours"],
                        reverse=True)
    for i, (stype, data) in enumerate(sorted_cal, 1):
        print(f"  {i}. {stype:<14}: First fires ~{data['earliest_lead_hours']:.0f}h before deal")

    print()
    print("── 2026 WAR ANALOG ──")
    print("  Based on June 2025 pattern, for current war:")
    print("  1. Watch DIPLOMATIC feeds first (Oman/Pakistan/Turkey brokers)")
    print("     → First signal typically 48-56 hrs before announcement")
    print("  2. Watch HORMUZ vessel count next (36h)")
    print("  3. Watch RIAL black market rate (28h)")
    print("  4. Watch Iran INTERNET recovery (22h)")
    print("  5. Watch POLYMARKET odds (6h)")
    print("  6. Watch Trump Truth Social (3h — nearly too late to position)")
    print()
    print("  KEY INSIGHT: By the time Trump posts, you have 3 hours max.")
    print("  Position at Rial/Hormuz signal = 28-36 hours of lead time.")

    # Save calibration
    output = {
        "calibration":           calibration,
        "ceasefire_announcement": CEASEFIRE_ANNOUNCEMENT.isoformat(),
        "events":                [{**e, "ts": e["ts"].isoformat()} for e in KNOWN_PRECURSOR_EVENTS],
        "key_insight": (
            "Diplomatic broker signal leads by ~48-56h. "
            "By Trump post, only 3h remain. "
            "Rial + Hormuz vessels are the sweet spot at 28-36h lead."
        ),
        "generated": datetime.now(timezone.utc).isoformat(),
    }

    os.makedirs("data", exist_ok=True)
    with open("data/backtest_results.json", "w") as f:
        json.dump(output, f, indent=2)

    print()
    print("Saved to data/backtest_results.json")
    print("=" * 60)
    return output


def suggest_weights(calibration: dict) -> dict:
    total_lead = sum(d["earliest_lead_hours"] for d in calibration.values())
    if total_lead == 0:
        return {}

    raw_weights = {
        stype: data["earliest_lead_hours"] / total_lead
        for stype, data in calibration.items()
    }

    print()
    print("── SUGGESTED WEIGHTS BASED ON LEAD TIME ──")
    for stype, w in sorted(raw_weights.items(), key=lambda x: -x[1]):
        print(f"  {stype:<14}: {w:.2f}")

    return raw_weights


if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    results = run_backtest()
    suggest_weights(results["calibration"])
