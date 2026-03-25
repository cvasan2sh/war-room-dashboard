// signals/nasa-firms.ts — Satellite thermal anomaly detection (BINARY OVERRIDE)
// Uses NASA FIRMS VIIRS data. Nighttime-only + geo filter + known flare filter.
// Baseline-aware: only alerts when hits EXCEED daily baseline per region.

import type { SignalResult } from "../types";
import {
  FIRMS_URL,
  FIRMS_TIMEOUT,
  FIRMS_MIN_FRP,
  FIRMS_PREFER_NIGHT,
  FIRMS_CRITICAL_REGIONS,
  FIRMS_KNOWN_FLARES,
} from "../config";

function noData(reason: string): SignalResult {
  return {
    signal: "nasa_firms",
    type: "override",
    score: 50,
    alert: null,
    confidence: 0.0,
    total_hits: 0,
    critical_hits: {},
    above_baseline: {},
    interpretation: `NO DATA: ${reason} \u2014 cannot confirm or deny strikes`,
    timestamp: new Date().toISOString(),
  };
}

function isKnownFlare(lat: number, lon: number): boolean {
  for (const [fLat, fLon, radius] of FIRMS_KNOWN_FLARES) {
    const dist = Math.sqrt((lat - fLat) ** 2 + (lon - fLon) ** 2);
    if (dist < radius) return true;
  }
  return false;
}

function inRegion(
  lat: number,
  lon: number,
  bounds: [number, number, number, number, number]
): boolean {
  return (
    lat >= bounds[0] &&
    lat <= bounds[1] &&
    lon >= bounds[2] &&
    lon <= bounds[3]
  );
}

// Simple CSV parser for FIRMS data (no external dependency needed)
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

export async function collectNasaFirms(): Promise<SignalResult> {
  try {
    console.log("[FIRMS] Downloading global CSV...");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIRMS_TIMEOUT);

    const resp = await fetch(FIRMS_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csvText = await resp.text();
    console.log(`[FIRMS] Downloaded: ${csvText.length.toLocaleString()} bytes`);

    const rows = parseCSV(csvText);
    if (rows.length === 0) return noData("empty CSV");

    // Verify columns
    const firstRow = rows[0];
    for (const col of ["latitude", "longitude", "frp", "confidence"]) {
      if (!(col in firstRow)) {
        return noData(`CSV schema changed \u2014 missing column: ${col}`);
      }
    }

    let totalHits = 0;
    const criticalHits: Record<string, number> = {};
    let flareFiltered = 0;
    let dayFiltered = 0;

    for (const row of rows) {
      const lat = parseFloat(row.latitude);
      const lon = parseFloat(row.longitude);
      const frp = parseFloat(row.frp || "0");
      const conf = row.confidence || "l";
      const daynight = row.daynight || "";

      if (isNaN(lat) || isNaN(lon)) continue;

      // Skip daytime (sun glint risk)
      if (FIRMS_PREFER_NIGHT && daynight === "D") {
        dayFiltered++;
        continue;
      }

      // Skip low-confidence + low-power
      if (conf === "l" && frp < FIRMS_MIN_FRP) continue;

      // Skip known flares
      if (isKnownFlare(lat, lon)) {
        flareFiltered++;
        continue;
      }

      // Only Iran/Gulf area
      if (!(lat >= 22 && lat <= 40 && lon >= 44 && lon <= 64)) continue;

      totalHits++;

      // Check critical regions
      for (const [regionName, bounds] of Object.entries(
        FIRMS_CRITICAL_REGIONS
      )) {
        if (inRegion(lat, lon, bounds)) {
          criticalHits[regionName] =
            (criticalHits[regionName] ?? 0) + 1;
        }
      }
    }

    // Baseline-aware alerting
    const aboveBaseline: Record<string, number> = {};
    for (const [regionName, count] of Object.entries(criticalHits)) {
      const bounds = FIRMS_CRITICAL_REGIONS[regionName];
      const baseline = bounds[4];
      const excess = count - baseline;
      if (excess > 0) aboveBaseline[regionName] = excess;
    }

    const alert =
      Object.keys(aboveBaseline).length > 0 || totalHits > 30;

    // Interpretation
    let interp: string;
    if (Object.keys(aboveBaseline).length > 0) {
      const parts = Object.entries(aboveBaseline).map(
        ([region, excess]) => {
          const raw = criticalHits[region];
          const baseline = FIRMS_CRITICAL_REGIONS[region][4];
          return `${region} (${raw} hits, baseline ${baseline}, +${excess} above)`;
        }
      );
      interp = `ABOVE-BASELINE thermal at ${parts.join(", ")} \u2014 possible strike`;
    } else if (Object.keys(criticalHits).length > 0) {
      const parts = Object.entries(criticalHits).map(
        ([k, v]) => `${k} (${v})`
      );
      interp = `Thermal at ${parts.join(", ")} \u2014 within industrial baseline (normal)`;
    } else if (totalHits > 30) {
      interp = `${totalHits} thermal detections across Iran/Gulf \u2014 elevated`;
    } else if (totalHits > 0) {
      interp = `${totalHits} thermal detections \u2014 within normal range`;
    } else {
      interp = "No significant thermal anomalies in Iran/Gulf region";
    }

    // Log diagnostics
    if (dayFiltered > 0)
      console.log(
        `[FIRMS] Filtered ${dayFiltered} daytime detections`
      );
    if (flareFiltered > 0)
      console.log(
        `[FIRMS] Filtered ${flareFiltered} known flare detections`
      );
    for (const [r, c] of Object.entries(criticalHits)) {
      const baseline = FIRMS_CRITICAL_REGIONS[r][4];
      const status = c > baseline ? "ABOVE" : "normal";
      console.log(
        `[FIRMS] ${r}: ${c} hits (baseline=${baseline}) -> ${status}`
      );
    }

    return {
      signal: "nasa_firms",
      type: "override",
      score: 50,
      alert,
      confidence: 1.0,
      total_hits: totalHits,
      critical_hits: criticalHits,
      above_baseline: aboveBaseline,
      flare_filtered: flareFiltered,
      interpretation: interp,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      return noData(`FIRMS CSV timeout after ${FIRMS_TIMEOUT / 1000}s`);
    }
    return noData(`FIRMS error \u2014 ${msg.slice(0, 80)}`);
  }
}
