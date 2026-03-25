# morning_brief.py — 8:45 AM IST daily summary
# Sent to Telegram. Siva reads this first every morning.
# Must be concise but complete — this is his primary decision input.

from datetime import datetime, timezone
from alerts import send_alert
from config import (
    NIFTY_SUPPORT, NIFTY_RESISTANCE,
    GOLDBEES_COST, GOLDBEES_UNITS, GOLDBEES_STOP,
    OPTIONS_BUDGET, CPI_THRESHOLDS
)


def send_morning_brief(cpi_result: dict, signals: dict):
    """
    Generate and send the morning brief to Telegram.
    Called at 8:45 AM IST by the scheduler.
    """
    cpi = cpi_result.get("cpi", 50)
    zone = cpi_result.get("zone", {})
    raw_scores = cpi_result.get("raw_scores", {})
    group_scores = cpi_result.get("group_scores", {})
    recs = cpi_result.get("recommendation", [])
    alerts = cpi_result.get("alerts", [])
    hourly_change = cpi_result.get("hourly_change", 0)

    try:
        import pytz
        ist = pytz.timezone("Asia/Kolkata")
        now_ist = datetime.now(ist)
        date_str = now_ist.strftime("%d %b %Y")
        time_str = now_ist.strftime("%H:%M IST")
    except ImportError:
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%d %b %Y")
        time_str = now.strftime("%H:%M UTC")

    # Build the brief
    lines = []

    # Header
    lines.append(f"📋 <b>WAR ROOM — MORNING BRIEF</b>")
    lines.append(f"📅 {date_str} | {time_str}")
    lines.append("")

    # CPI Score
    lines.append(f"{zone.get('emoji', '⚡')} <b>CPI: {cpi}</b> — {zone.get('name', '?')}")
    if hourly_change != 0:
        arrow = "↑" if hourly_change > 0 else "↓"
        lines.append(f"   {arrow} {abs(hourly_change):.0f} pts from last hour")
    lines.append("")

    # Signal Snapshot
    lines.append("<b>📡 SIGNALS:</b>")
    signal_labels = {
        "hormuz": "Hormuz",
        "polymarket": "Mkt",
        "netblocks": "Internet",
        "iranwarlive": "Events",
        "bonbast": "Rial",
        "gpsjam": "GPS",
        "diplomatic": "Diplo",
    }
    signal_line = " | ".join(
        f"{signal_labels.get(k, k)}:{v}"
        for k, v in sorted(raw_scores.items(), key=lambda x: -x[1])
    )
    lines.append(f"   {signal_line}")
    lines.append("")

    # Active Alerts
    if alerts:
        lines.append("<b>🚨 ALERTS:</b>")
        for alert in alerts[:3]:
            lines.append(f"   • {alert}")
        lines.append("")

    # Key Signal Details (only significant ones)
    notable = []
    for sig_name, sig_data in signals.items():
        if isinstance(sig_data, dict):
            interp = sig_data.get("interpretation", "")
            if any(marker in interp for marker in ["🚨", "⚠️", "⚡"]):
                notable.append(f"   • {interp[:80]}")

    if notable:
        lines.append("<b>📌 NOTABLE:</b>")
        for n in notable[:3]:
            lines.append(n)
        lines.append("")

    # Trade Recommendations
    lines.append("<b>🎯 TRADE SETUP:</b>")
    for rec in recs[:3]:
        lines.append(f"   {rec}")
    lines.append("")

    # Key Levels
    lines.append("<b>📊 LEVELS:</b>")
    lines.append(f"   Nifty: {NIFTY_SUPPORT:,}–{NIFTY_RESISTANCE:,}")
    lines.append(f"   GoldBEEs: {GOLDBEES_UNITS} @ ₹{GOLDBEES_COST} (stop ₹{GOLDBEES_STOP})")
    lines.append(f"   Budget: ₹{OPTIONS_BUDGET:,}/trade")

    # Group confluence
    if not cpi_result.get("confluence_satisfied", True):
        lines.append("")
        lines.append("⚠️ <i>Confluence NOT met — CPI capped. Wait for confirmation.</i>")

    brief = "\n".join(lines)

    # Send
    print(f"[MORNING BRIEF] Sending...")
    print(brief)
    send_alert(brief, priority="normal")
    print(f"[MORNING BRIEF] Done.")
