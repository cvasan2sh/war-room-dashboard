# cpi_engine.py — Ceasefire Probability Index v2
# Confidence-weighted composite. If a signal has no data, it contributes nothing.
# Includes Bayesian link: CPI signals auto-shift scenario probabilities.

import json
from datetime import datetime, timezone

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import WEIGHTS, ZONES, MIN_CONFIDENCE, SCENARIO_SHIFTS


def compute_cpi(signals):
    """
    Compute confidence-weighted CPI from signal results.

    Each signal has: score (0-100), confidence (0-1).
    CPI = sum(score * weight * confidence) / sum(weight * confidence)

    If total confidence < MIN_CONFIDENCE, returns zone "INSUFFICIENT DATA".
    """
    weighted_sum = 0.0
    confidence_sum = 0.0
    signal_details = {}

    for name, weight in WEIGHTS.items():
        sig = signals.get(name, {})
        score = sig.get("score", 50)
        conf = sig.get("confidence", 0.0)

        weighted_sum += score * weight * conf
        confidence_sum += weight * conf
        signal_details[name] = {
            "score": score,
            "confidence": conf,
            "effective_weight": round(weight * conf, 3),
        }

    # Total confidence: what fraction of weight is backed by real data?
    total_confidence = confidence_sum  # max possible is 1.0 (all weights sum to 1.0)

    if total_confidence < MIN_CONFIDENCE:
        return {
            "cpi": None,
            "zone": {"name": "INSUFFICIENT DATA", "color": "gray", "emoji": "⚫"},
            "total_confidence": round(total_confidence, 2),
            "signal_details": signal_details,
            "alerts": ["CPI cannot be computed — less than 30% of signals have data"],
            "scenario_shifts": {},
            "override_alerts": _process_overrides(signals),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    cpi = round(weighted_sum / confidence_sum)
    cpi = max(0, min(100, cpi))

    zone = _classify_zone(cpi)
    scenario_shifts = _compute_scenario_shifts(signals, cpi)
    override_alerts = _process_overrides(signals)

    return {
        "cpi": cpi,
        "zone": zone,
        "total_confidence": round(total_confidence, 2),
        "signal_details": signal_details,
        "alerts": [],
        "scenario_shifts": scenario_shifts,
        "override_alerts": override_alerts,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _classify_zone(cpi):
    """Map CPI score to zone."""
    for name, (low, high) in ZONES.items():
        if low <= cpi <= high:
            colors = {
                "FULL_WAR": ("red", "🔴"),
                "STATUS_QUO": ("orange", "🟠"),
                "DIPLOMATIC": ("yellow", "🟡"),
                "CEASEFIRE_LIKELY": ("green", "🟢"),
                "IMMINENT_DEAL": ("emerald", "💚"),
            }
            color, emoji = colors.get(name, ("gray", "⚫"))
            return {"name": name, "color": color, "emoji": emoji}
    return {"name": "STATUS_QUO", "color": "orange", "emoji": "🟠"}


def _compute_scenario_shifts(signals, cpi):
    """
    Bayesian link: signal conditions → scenario probability shifts.
    Returns dict of {scenario_key: shift_amount}.
    Only fires shifts for signals with confidence > 0.5.
    """
    shifts = {}

    # Check each condition
    hormuz = signals.get("hormuz", {})
    if hormuz.get("confidence", 0) > 0.5:
        if hormuz.get("score", 50) < 25:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("hormuz_below_25", {}))
        elif hormuz.get("score", 50) > 70:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("hormuz_above_70", {}))

    bonbast = signals.get("bonbast", {})
    if bonbast.get("confidence", 0) > 0.5:
        trend = bonbast.get("trend_pct", 0)
        if trend > 0.03:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("bonbast_strengthen", {}))
        elif trend < -0.03:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("bonbast_weaken", {}))

    polymarket = signals.get("polymarket", {})
    if polymarket.get("confidence", 0) > 0.5:
        if polymarket.get("score", 50) > 60:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("polymarket_above_60", {}))
        elif polymarket.get("score", 50) < 20:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("polymarket_below_20", {}))

    # Override signals (FIRMS, Flightradar)
    # Cross-signal validation: if Hormuz vessels are flowing normally (score > 60),
    # FIRMS alert is likely industrial noise, not strikes. Downgrade.
    firms = signals.get("nasa_firms", {})
    if firms.get("confidence", 0) > 0.5 and firms.get("alert"):
        hormuz_score = hormuz.get("score", 50) if hormuz.get("confidence", 0) > 0.5 else None
        if hormuz_score is not None and hormuz_score > 60:
            # Vessels flowing = FIRMS is probably industrial. Skip scenario shift.
            print(f"[CPI] FIRMS alert downgraded — Hormuz score {hormuz_score} shows normal traffic")
        else:
            _merge_shifts(shifts, SCENARIO_SHIFTS.get("firms_critical_hit", {}))

    fr24 = signals.get("flightradar", {})
    if fr24.get("confidence", 0) > 0.5 and fr24.get("alert"):
        _merge_shifts(shifts, SCENARIO_SHIFTS.get("fr24_airspace_closed", {}))

    return shifts


def _merge_shifts(target, new_shifts):
    """Merge probability shifts, summing overlapping keys."""
    for k, v in new_shifts.items():
        target[k] = target.get(k, 0) + v


def _process_overrides(signals):
    """Collect alerts from binary override signals, with cross-signal context."""
    alerts = []
    hormuz = signals.get("hormuz", {})
    hormuz_normal = (hormuz.get("confidence", 0) > 0.5 and hormuz.get("score", 50) > 60)

    for name in ("flightradar", "nasa_firms"):
        sig = signals.get(name, {})
        if sig.get("alert") is True and sig.get("confidence", 0) > 0.5:
            # FIRMS + normal Hormuz traffic = downgrade to info
            if name == "nasa_firms" and hormuz_normal:
                # Check if there are above-baseline hits (real anomaly) vs just baseline
                above = sig.get("above_baseline", {})
                if not above:
                    alerts.append({
                        "signal": name,
                        "interpretation": sig.get("interpretation", "") + " [within industrial baseline]",
                        "severity": "info",
                    })
                else:
                    # Above baseline but vessels still flowing — mixed signal
                    alerts.append({
                        "signal": name,
                        "interpretation": sig.get("interpretation", "") + " [NOTE: Hormuz traffic normal]",
                        "severity": "warning",
                    })
            else:
                alerts.append({
                    "signal": name,
                    "interpretation": sig.get("interpretation", ""),
                    "severity": "critical",
                })
        elif sig.get("alert") is None and sig.get("confidence", 0) == 0:
            alerts.append({
                "signal": name,
                "interpretation": sig.get("interpretation", ""),
                "severity": "warning",
            })
    return alerts


def apply_scenario_shifts(scenarios, shifts):
    """
    Apply CPI-driven probability shifts to scenario list.
    Additive shifts, then renormalize to 100%.

    scenarios: list of dicts with 'key' and 'prob' fields
    shifts: dict of {scenario_key: shift_amount}

    Returns updated scenario list (new probs, same objects).
    """
    if not shifts:
        return scenarios

    # Apply shifts
    for s in scenarios:
        key = s.get("key", "")
        if key in shifts:
            s["prob"] = max(1, s["prob"] + shifts[key])  # min 1%

    # Renormalize to 100%
    total = sum(s["prob"] for s in scenarios)
    if total > 0:
        for s in scenarios:
            s["prob"] = round(s["prob"] * 100 / total, 1)

    return scenarios
