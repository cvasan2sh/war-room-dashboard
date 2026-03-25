# validate.py
# Signal validation and false positive monitoring
# Run this to check signal health, noise levels, and calibration
# python validate.py [--live] [--days 7]

import json
import os
from datetime import datetime, timezone, timedelta
import argparse

DATA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")


def load_history(days=7):
    try:
        with open(HISTORY_FILE) as f:
            history = json.load(f)
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        return [
            h for h in history
            if datetime.fromisoformat(h["timestamp"].replace("+05:30", "+05:30")) > cutoff
        ]
    except FileNotFoundError:
        print("No history file yet. Run scheduler.py first for at least 1 hour.")
        return []
    except Exception as e:
        print(f"Error loading history: {e}")
        return []


def noise_analysis(history):
    if not history:
        return

    signals = list(history[0].get("signals", {}).keys())

    print("── SIGNAL NOISE ANALYSIS ──")
    print(f"{'Signal':<16} {'Mean':>6} {'StdDev':>8} {'>70 (%)':>8} {'<30 (%)':>8} {'Verdict'}")
    print("-" * 70)

    for sig in signals:
        scores = [h["signals"].get(sig, 50) for h in history]
        if not scores:
            continue
        mean   = sum(scores) / len(scores)
        sq_dev = sum((s - mean) ** 2 for s in scores) / len(scores)
        std    = sq_dev ** 0.5
        above  = sum(1 for s in scores if s > 70) / len(scores) * 100
        below  = sum(1 for s in scores if s < 30) / len(scores) * 100

        if std > 25:
            verdict = "⚠️  HIGH NOISE"
        elif std < 5:
            verdict = "😴 FLAT — check if working"
        elif mean > 60:
            verdict = "📈 BULLISH BIAS"
        elif mean < 40:
            verdict = "📉 BEARISH BIAS"
        else:
            verdict = "✅ CLEAN"

        print(f"{sig:<16} {mean:>6.1f} {std:>8.1f} {above:>7.1f}% {below:>7.1f}%  {verdict}")


def cpi_volatility(history):
    if len(history) < 2:
        return

    cpis = [h["cpi"] for h in history]
    diffs = [abs(cpis[i] - cpis[i-1]) for i in range(1, len(cpis))]
    avg_change = sum(diffs) / len(diffs) if diffs else 0

    print()
    print("── CPI VOLATILITY ──")
    print(f"  Readings: {len(cpis)}")
    print(f"  Range: {min(cpis)} – {max(cpis)}")
    print(f"  Avg change per poll: {avg_change:.1f} pts")

    if avg_change > 10:
        print("  ⚠️  HIGH VOLATILITY — check for noisy signals")
    elif avg_change < 1:
        print("  😴 VERY STABLE — signals may not be updating")
    else:
        print("  ✅ Normal volatility")


def false_positive_check(history):
    if len(history) < 4:
        return

    print()
    print("── FALSE POSITIVE CHECK ──")
    fp_count = 0

    for i in range(2, len(history) - 2):
        cpi_now  = history[i]["cpi"]
        cpi_prev = history[i-2]["cpi"]
        cpi_next = history[i+2]["cpi"]

        if cpi_now >= 70 and cpi_prev < 60 and cpi_next < 60:
            ts = history[i]["timestamp"]
            print(f"  ⚠️  POSSIBLE FALSE POSITIVE: CPI spiked to {cpi_now} at {ts}")
            print(f"       Before: {cpi_prev} | After: {cpi_next}")
            fp_count += 1

        if cpi_now <= 30 and cpi_prev > 40 and cpi_next > 40:
            ts = history[i]["timestamp"]
            print(f"  ⚠️  POSSIBLE FALSE NEGATIVE: CPI crashed to {cpi_now} at {ts}")
            fp_count += 1

    if fp_count == 0:
        print("  ✅ No obvious false positives detected in history")
    else:
        print(f"\n  Found {fp_count} suspicious movements.")
        print("  Check the signal breakdown for those timestamps.")


def live_check():
    """Run a single collection cycle to verify all signals are working."""
    print("── LIVE SIGNAL CHECK ──")
    print("Running one collection cycle...\n")

    from signals.netblocks  import collect_netblocks
    from signals.polymarket import collect_polymarket
    from signals.bonbast    import collect_bonbast
    from signals.gpsjam     import collect_gpsjam
    from signals.diplomatic import collect_diplomatic
    from signals.iranwarlive import collect_iranwarlive

    sync_tests = [
        ("netblocks",   collect_netblocks),
        ("polymarket",  collect_polymarket),
        ("bonbast",     collect_bonbast),
        ("gpsjam",      collect_gpsjam),
        ("diplomatic",  collect_diplomatic),
        ("iranwarlive", collect_iranwarlive),
    ]

    for name, fn in sync_tests:
        try:
            result = fn()
            score = result.get("score", "?")
            interp = result.get("interpretation", "")[:60]
            err = result.get("error", "")
            status = "✅" if not err else "❌"
            print(f"  {status} {name:<14}: score={score} | {interp}")
            if err:
                print(f"     ERROR: {err}")
        except Exception as e:
            print(f"  ❌ {name:<14}: EXCEPTION — {e}")


def main():
    parser = argparse.ArgumentParser(description="War Room signal validator")
    parser.add_argument("--live",  action="store_true", help="Run live signal check")
    parser.add_argument("--days",  type=int, default=7, help="Days of history to analyze")
    args = parser.parse_args()

    print("=" * 60)
    print("WAR ROOM — SIGNAL VALIDATION REPORT")
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    history = load_history(days=args.days)

    if history:
        print(f"Analyzing {len(history)} readings over last {args.days} days\n")
        noise_analysis(history)
        cpi_volatility(history)
        false_positive_check(history)
    else:
        print("No historical data yet.")

    if args.live:
        print()
        live_check()

    print()
    print("Done. Run 'python validate.py --live' to test all signals.")


if __name__ == "__main__":
    main()
