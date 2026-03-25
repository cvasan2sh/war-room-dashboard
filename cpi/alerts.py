# alerts.py — Interrupt-only Telegram alerts
# No morning brief. No trade recs. Just zone transitions + critical overrides.
# Retries 3x on failure, then logs to disk so nothing is silently lost.

import json
import time
import requests
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import (
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
    TELEGRAM_MAX_RETRIES, TELEGRAM_RETRY_DELAY,
    CPI_CHANGE_ALERT, ALERT_LOG_FILE, DATA_DIR
)

# Track previous zone for transition detection
_previous_zone = None
_previous_cpi = None


def send_telegram(message, parse_mode="HTML"):
    """
    Send message to Telegram. Retries on failure.
    Returns True if delivered, False if all retries failed.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        _log_to_disk(message, "NO_CREDENTIALS")
        print(f"[ALERT] No Telegram credentials — logged to disk")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": parse_mode,
    }

    for attempt in range(1, TELEGRAM_MAX_RETRIES + 1):
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                return True

            error = resp.text[:200]
            print(f"[ALERT] Telegram error {resp.status_code} (attempt {attempt}): {error}")

            # Non-retryable errors — don't waste attempts
            if resp.status_code == 400:
                _log_to_disk(message, f"HTTP_400: {error}")
                return False
            if resp.status_code == 401:
                _log_to_disk(message, f"HTTP_401_INVALID_TOKEN: {error}")
                print("[ALERT] Bot token is invalid — fix TELEGRAM_BOT_TOKEN in config.py")
                return False
            if resp.status_code == 403:
                _log_to_disk(message, f"HTTP_403_BLOCKED: {error}")
                print("[ALERT] Bot blocked or user hasn't sent /start — message the bot first")
                return False

            # Rate limited — respect the server's retry_after
            if resp.status_code == 429:
                try:
                    body = resp.json()
                    wait = body.get("parameters", {}).get("retry_after", TELEGRAM_RETRY_DELAY)
                    print(f"[ALERT] Rate limited — waiting {wait}s (server requested)")
                    time.sleep(wait)
                    continue  # Skip the default sleep below
                except Exception:
                    pass  # Fall through to default delay

        except Exception as e:
            print(f"[ALERT] Telegram send failed (attempt {attempt}): {e}")

        if attempt < TELEGRAM_MAX_RETRIES:
            time.sleep(TELEGRAM_RETRY_DELAY)

    # All retries exhausted — log to disk
    _log_to_disk(message, "ALL_RETRIES_FAILED")
    print(f"[ALERT] All {TELEGRAM_MAX_RETRIES} retries failed — logged to {ALERT_LOG_FILE}")
    return False


def _log_to_disk(message, reason):
    """Fallback: write alert to local file so it's never silently lost."""
    os.makedirs(DATA_DIR, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": message,
        "reason": reason,
    }
    try:
        try:
            with open(ALERT_LOG_FILE) as f:
                log = json.load(f)
        except Exception:
            log = []
        log.append(entry)
        log = log[-200:]  # keep last 200 entries
        with open(ALERT_LOG_FILE, "w") as f:
            json.dump(log, f, indent=2)
    except Exception as e:
        # Last resort: at least print it
        print(f"[ALERT] CRITICAL: Cannot log alert to disk: {e}")
        print(f"[ALERT] Message was: {message[:200]}")


def process_alerts(cpi_result, signals):
    """
    Process all alert conditions. Only fires on:
    1. Zone transitions
    2. Large CPI moves (>10 in 1 hour)
    3. Critical override alerts (FIRMS, Flightradar)
    4. INSUFFICIENT DATA warning
    """
    global _previous_zone, _previous_cpi

    cpi = cpi_result.get("cpi")
    zone = cpi_result.get("zone", {})
    zone_name = zone.get("name", "")
    confidence = cpi_result.get("total_confidence", 0)

    # 1. INSUFFICIENT DATA warning (once)
    if cpi is None:
        if _previous_zone != "INSUFFICIENT_DATA":
            conf_pct = round(confidence * 100)
            send_telegram(
                f"⚫ <b>WAR ROOM: INSUFFICIENT DATA</b>\n"
                f"Only {conf_pct}% of signal weight has real data.\n"
                f"CPI cannot be computed reliably."
            )
            _previous_zone = "INSUFFICIENT_DATA"
        return

    # 2. Zone transition
    if _previous_zone is not None and _previous_zone != zone_name:
        emoji = zone.get("emoji", "")
        send_telegram(
            f"{emoji} <b>ZONE SHIFT: {_previous_zone} → {zone_name}</b>\n"
            f"CPI: {cpi} | Confidence: {round(confidence * 100)}%\n"
            f"Open Sensibull and reassess positions."
        )

    # 3. Large CPI move
    if _previous_cpi is not None and cpi is not None:
        delta = abs(cpi - _previous_cpi)
        if delta >= CPI_CHANGE_ALERT:
            direction = "📈" if cpi > _previous_cpi else "📉"
            send_telegram(
                f"{direction} <b>CPI MOVE: {_previous_cpi} → {cpi} ({'+' if cpi > _previous_cpi else ''}{cpi - _previous_cpi})</b>\n"
                f"Zone: {zone_name} | Confidence: {round(confidence * 100)}%"
            )

    # 4. Override alerts — only Telegram for critical and warning, not info
    for alert in cpi_result.get("override_alerts", []):
        severity = alert.get("severity", "")
        if severity in ("critical", "warning"):
            signal = alert.get("signal", "").upper()
            interp = alert.get("interpretation", "")
            icon = "🚨" if severity == "critical" else "⚠️"
            send_telegram(
                f"{icon} <b>{signal} {'ALERT' if severity == 'critical' else 'WARNING'}</b>\n"
                f"{interp}"
            )

    # Update state
    _previous_zone = zone_name
    _previous_cpi = cpi
