// engine.ts — Ceasefire Probability Index v2 (Serverless)
// Confidence-weighted composite with Bayesian scenario shifts.

import type { SignalResult, CPIResult, OverrideAlert, ZoneInfo } from "./types";
import { WEIGHTS, ZONES, ZONE_COLORS, MIN_CONFIDENCE, SCENARIO_SHIFTS } from "./config";

export function computeCPI(
  signals: Record<string, SignalResult>
): CPIResult {
  let weightedSum = 0;
  let confidenceSum = 0;
  const signalDetails: CPIResult["signal_details"] = {};

  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const sig = signals[name] ?? { score: 50, confidence: 0 };
    const score = sig.score ?? 50;
    const conf = sig.confidence ?? 0;

    weightedSum += score * weight * conf;
    confidenceSum += weight * conf;
    signalDetails[name] = {
      score,
      confidence: conf,
      effective_weight: Math.round(weight * conf * 1000) / 1000,
    };
  }

  const totalConfidence = confidenceSum;

  if (totalConfidence < MIN_CONFIDENCE) {
    return {
      cpi: null,
      zone: { name: "INSUFFICIENT DATA", color: "gray", emoji: "\u26AB" },
      total_confidence: Math.round(totalConfidence * 100) / 100,
      signal_details: signalDetails,
      alerts: [
        "CPI cannot be computed \u2014 less than 30% of signals have data",
      ],
      scenario_shifts: {},
      override_alerts: processOverrides(signals),
      timestamp: new Date().toISOString(),
    };
  }

  let cpi = Math.round(weightedSum / confidenceSum);
  cpi = Math.max(0, Math.min(100, cpi));

  const zone = classifyZone(cpi);
  const scenarioShifts = computeScenarioShifts(signals, cpi);
  const overrideAlerts = processOverrides(signals);

  return {
    cpi,
    zone,
    total_confidence: Math.round(totalConfidence * 100) / 100,
    signal_details: signalDetails,
    alerts: [],
    scenario_shifts: scenarioShifts,
    override_alerts: overrideAlerts,
    timestamp: new Date().toISOString(),
  };
}

function classifyZone(cpi: number): ZoneInfo {
  for (const [name, [low, high]] of Object.entries(ZONES)) {
    if (cpi >= low && cpi <= high) {
      const { color, emoji } = ZONE_COLORS[name] ?? {
        color: "gray",
        emoji: "\u26AB",
      };
      return { name, color, emoji };
    }
  }
  return { name: "STATUS_QUO", color: "orange", emoji: "\u{1F7E0}" };
}

function mergeShifts(
  target: Record<string, number>,
  newShifts: Record<string, number>
) {
  for (const [k, v] of Object.entries(newShifts)) {
    target[k] = (target[k] ?? 0) + v;
  }
}

function computeScenarioShifts(
  signals: Record<string, SignalResult>,
  _cpi: number
): Record<string, number> {
  const shifts: Record<string, number> = {};

  const hormuz = signals.hormuz ?? {};
  if ((hormuz.confidence ?? 0) > 0.5) {
    if ((hormuz.score ?? 50) < 25) {
      mergeShifts(shifts, SCENARIO_SHIFTS.hormuz_below_25 ?? {});
    } else if ((hormuz.score ?? 50) > 70) {
      mergeShifts(shifts, SCENARIO_SHIFTS.hormuz_above_70 ?? {});
    }
  }

  const bonbast = signals.bonbast ?? {};
  if ((bonbast.confidence ?? 0) > 0.5) {
    const trend = bonbast.trend_pct ?? 0;
    if (trend > 0.03) {
      mergeShifts(shifts, SCENARIO_SHIFTS.bonbast_strengthen ?? {});
    } else if (trend < -0.03) {
      mergeShifts(shifts, SCENARIO_SHIFTS.bonbast_weaken ?? {});
    }
  }

  const polymarket = signals.polymarket ?? {};
  if ((polymarket.confidence ?? 0) > 0.5) {
    if ((polymarket.score ?? 50) > 60) {
      mergeShifts(shifts, SCENARIO_SHIFTS.polymarket_above_60 ?? {});
    } else if ((polymarket.score ?? 50) < 20) {
      mergeShifts(shifts, SCENARIO_SHIFTS.polymarket_below_20 ?? {});
    }
  }

  // Cross-signal validation: FIRMS + normal Hormuz = downgrade
  const firms = signals.nasa_firms ?? {};
  if ((firms.confidence ?? 0) > 0.5 && firms.alert) {
    const hormuzScore =
      (hormuz.confidence ?? 0) > 0.5 ? hormuz.score ?? 50 : null;
    if (hormuzScore !== null && hormuzScore > 60) {
      console.log(
        `[CPI] FIRMS alert downgraded \u2014 Hormuz score ${hormuzScore} shows normal traffic`
      );
    } else {
      mergeShifts(shifts, SCENARIO_SHIFTS.firms_critical_hit ?? {});
    }
  }

  const fr24 = signals.flightradar ?? {};
  if ((fr24.confidence ?? 0) > 0.5 && fr24.alert) {
    mergeShifts(shifts, SCENARIO_SHIFTS.fr24_airspace_closed ?? {});
  }

  return shifts;
}

function processOverrides(
  signals: Record<string, SignalResult>
): OverrideAlert[] {
  const alerts: OverrideAlert[] = [];
  const hormuz = signals.hormuz ?? {};
  const hormuzNormal =
    (hormuz.confidence ?? 0) > 0.5 && (hormuz.score ?? 50) > 60;

  for (const name of ["flightradar", "nasa_firms"] as const) {
    const sig = signals[name] ?? {};
    if (sig.alert === true && (sig.confidence ?? 0) > 0.5) {
      if (name === "nasa_firms" && hormuzNormal) {
        const above = sig.above_baseline ?? {};
        if (Object.keys(above).length === 0) {
          alerts.push({
            signal: name,
            interpretation:
              (sig.interpretation ?? "") +
              " [within industrial baseline]",
            severity: "info",
          });
        } else {
          alerts.push({
            signal: name,
            interpretation:
              (sig.interpretation ?? "") +
              " [NOTE: Hormuz traffic normal]",
            severity: "warning",
          });
        }
      } else {
        alerts.push({
          signal: name,
          interpretation: sig.interpretation ?? "",
          severity: "critical",
        });
      }
    } else if (sig.alert === null && (sig.confidence ?? 0) === 0) {
      alerts.push({
        signal: name,
        interpretation: sig.interpretation ?? "",
        severity: "warning",
      });
    }
  }
  return alerts;
}
