// signals/flightradar.ts — Gulf airspace monitor (BINARY OVERRIDE)
// Fires as a scenario probability override when Gulf airspace is closed.
// Uses unofficial FR24 public feed — may break without notice.

import type { SignalResult } from "../types";
import {
  FR24_URL,
  FR24_GULF_BOUNDS,
  FR24_ALERT_THRESHOLD,
  FR24_TIMEOUT,
} from "../config";

function noData(reason: string): SignalResult {
  return {
    signal: "flightradar",
    type: "override",
    score: 50,
    alert: false,
    confidence: 0.0,
    flight_count: null,
    interpretation: `NO DATA: ${reason}`,
    timestamp: new Date().toISOString(),
  };
}

export async function collectFlightradar(): Promise<SignalResult> {
  try {
    const url = new URL(FR24_URL);
    const params: Record<string, string> = {
      bounds: FR24_GULF_BOUNDS,
      faa: "1",
      satellite: "1",
      mlat: "1",
      flarm: "1",
      adsb: "1",
      gnd: "0",
      air: "1",
      vehicles: "0",
      estimated: "1",
      gliders: "0",
      stats: "1",
    };
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FR24_TIMEOUT);

    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as Record<string, unknown>;

    // Count flights: real aircraft arrays have >= 13 elements
    const metadataKeys = new Set([
      "full_count",
      "version",
      "stats",
      "selected",
    ]);
    let flightCount = 0;
    for (const [k, v] of Object.entries(data)) {
      if (
        !metadataKeys.has(k) &&
        Array.isArray(v) &&
        v.length >= 13
      ) {
        flightCount++;
      }
    }

    const apiTotal = data.full_count;
    const count =
      typeof apiTotal === "number"
        ? Math.max(flightCount, apiTotal)
        : flightCount;

    const alert = count < FR24_ALERT_THRESHOLD;

    let interp: string;
    if (count === 0) {
      interp = "Gulf airspace CLOSED \u2014 zero flights detected";
    } else if (count < FR24_ALERT_THRESHOLD) {
      interp = `Only ${count} flights in Gulf \u2014 airspace likely restricted (NOTAM probable)`;
    } else if (count < 50) {
      interp = `${count} flights in Gulf \u2014 below normal (~80-150 typical)`;
    } else {
      interp = `${count} flights in Gulf \u2014 normal traffic`;
    }

    return {
      signal: "flightradar",
      type: "override",
      alert,
      confidence: 1.0,
      score: 50,
      flight_count: count,
      interpretation: interp,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return noData(
      `FR24 error \u2014 ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`
    );
  }
}
