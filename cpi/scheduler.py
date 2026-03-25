# scheduler.py — War Room CPI v2 Orchestrator
# Run: python scheduler.py
# Collects signals every 15 min. Alerts on zone transitions only.
# State persists to disk — restarts don't lose signal history.

import asyncio
import json
import os
import time
import schedule
from datetime import datetime, timezone

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from signals.hormuz import collect_hormuz
from signals.bonbast import collect_bonbast
from signals.polymarket import collect_polymarket
from signals.flightradar import collect_flightradar
from signals.nasa_firms import collect_nasa_firms
from cpi_engine import compute_cpi
from alerts import process_alerts
from config import (
    SIGNAL_POLL_MINUTES, DATA_DIR, NEXTJS_DATA_DIR,
    HISTORY_FILE, NEXTJS_HISTORY_FILE
)

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(NEXTJS_DATA_DIR, exist_ok=True)


def _load_history():
    try:
        with open(HISTORY_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(history):
    trimmed = history[-672:]  # 7 days at 15-min
    for path in (HISTORY_FILE, NEXTJS_HISTORY_FILE):
        try:
            with open(path, "w") as f:
                json.dump(trimmed, f, indent=2)
        except Exception as e:
            print(f"[SCHEDULER] Cannot save history to {path}: {e}")


def _save_latest(cpi_result, signals):
    latest = {
        "cpi_result": cpi_result,
        "signals": {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    for name, sig in signals.items():
        latest["signals"][name] = {
            "score": sig.get("score", 50),
            "confidence": sig.get("confidence", 0),
            "interpretation": sig.get("interpretation", ""),
            "alert": sig.get("alert", False),
            # Include type for overrides
            "type": sig.get("type", "weighted"),
        }
        # Pass through extra fields for dashboard
        for extra in ("count", "rate", "price", "flight_count",
                       "total_hits", "critical_hits", "trend_pct", "move_2h"):
            if extra in sig:
                latest["signals"][name][extra] = sig[extra]

    for path_dir in (DATA_DIR, NEXTJS_DATA_DIR):
        try:
            with open(os.path.join(path_dir, "latest.json"), "w") as f:
                json.dump(latest, f, indent=2)
        except Exception as e:
            print(f"[SCHEDULER] Cannot save latest to {path_dir}: {e}")


async def collect_all_signals():
    """Collect all signals. Hormuz is async, rest are sync in executor."""
    now = datetime.now(timezone.utc).strftime('%H:%M UTC')
    print(f"\n[{now}] Collecting signals...")

    # Hormuz: async WebSocket (60 seconds)
    hormuz_task = asyncio.create_task(collect_hormuz())

    # Sync signals: run concurrently in thread pool
    loop = asyncio.get_event_loop()
    sync_results = await asyncio.gather(
        loop.run_in_executor(None, collect_bonbast),
        loop.run_in_executor(None, collect_polymarket),
        loop.run_in_executor(None, collect_flightradar),
        loop.run_in_executor(None, collect_nasa_firms),
        return_exceptions=True
    )

    hormuz_result = await hormuz_task

    # Unpack results, converting exceptions to no-data
    def _safe(result, name):
        if isinstance(result, Exception):
            print(f"[SCHEDULER] {name} threw exception: {result}")
            return {
                "signal": name, "score": 50, "confidence": 0.0,
                "interpretation": f"NO DATA: exception — {str(result)[:80]}",
                "alert": False,
            }
        return result

    signals = {
        "hormuz":      hormuz_result,
        "bonbast":      _safe(sync_results[0], "bonbast"),
        "polymarket":   _safe(sync_results[1], "polymarket"),
        "flightradar":  _safe(sync_results[2], "flightradar"),
        "nasa_firms":   _safe(sync_results[3], "nasa_firms"),
    }

    # Print signal status
    for name, sig in signals.items():
        conf = sig.get("confidence", 0)
        score = sig.get("score", "?")
        status = "✓" if conf > 0.5 else "✗" if conf == 0 else "~"
        interp = sig.get("interpretation", "")[:60]
        print(f"  {status} {name:12s} score={score:>3}  conf={conf:.1f}  {interp}")

    return signals


def run_cycle():
    """One full collection → compute → alert → save cycle."""
    try:
        signals = asyncio.run(collect_all_signals())
        cpi_result = compute_cpi(signals)
        process_alerts(cpi_result, signals)

        # Save
        history = _load_history()
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cpi": cpi_result.get("cpi"),
            "zone": cpi_result.get("zone", {}).get("name", ""),
            "confidence": cpi_result.get("total_confidence", 0),
            "signals": {
                name: {
                    "score": sig.get("score", 50),
                    "confidence": sig.get("confidence", 0),
                }
                for name, sig in signals.items()
            },
            "scenario_shifts": cpi_result.get("scenario_shifts", {}),
        }
        history.append(entry)
        _save_history(history)
        _save_latest(cpi_result, signals)

        # Summary line
        cpi = cpi_result.get("cpi")
        zone = cpi_result.get("zone", {}).get("name", "?")
        conf = cpi_result.get("total_confidence", 0)
        shifts = cpi_result.get("scenario_shifts", {})

        if cpi is not None:
            print(f"\n  CPI: {cpi} — {zone} (confidence: {round(conf*100)}%)")
        else:
            print(f"\n  CPI: INSUFFICIENT DATA (confidence: {round(conf*100)}%)")

        if shifts:
            print(f"  Scenario shifts: {shifts}")

        overrides = cpi_result.get("override_alerts", [])
        for oa in overrides:
            sev = oa.get("severity", "")
            if sev == "critical":
                icon = "🚨"
            elif sev == "warning":
                icon = "⚠️"
            else:
                icon = "ℹ️"  # info — within baseline, no action needed
            print(f"  {icon} {oa.get('signal')}: {oa.get('interpretation', '')[:80]}")

    except Exception as e:
        import traceback
        print(f"\n[SCHEDULER] CYCLE ERROR: {e}")
        traceback.print_exc()


def main():
    print("=" * 55)
    print("  WAR ROOM CPI v2")
    print(f"  Signals: hormuz (35%) + polymarket (35%) + bonbast (30%)")
    print(f"  Overrides: flightradar + nasa_firms")
    print(f"  Poll interval: {SIGNAL_POLL_MINUTES} min")
    print("=" * 55)

    # Run immediately on startup
    run_cycle()

    # Schedule recurring
    schedule.every(SIGNAL_POLL_MINUTES).minutes.do(run_cycle)

    print(f"\nRunning. Press Ctrl+C to stop.\n")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
