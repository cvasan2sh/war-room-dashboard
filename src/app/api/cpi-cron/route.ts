// API route: /api/cpi-cron
// Vercel Cron hits this every 15 minutes.
// Collects all signals, computes CPI, sends alerts, persists state.
// Replaces the Python scheduler.py entirely.

import { NextResponse } from "next/server";
import type { SignalResult, HistoryEntry, LatestData } from "@/lib/cpi/types";
import { computeCPI } from "@/lib/cpi/engine";
import { processAlerts } from "@/lib/cpi/alerts";
import { getHistory, setHistory, setLatest } from "@/lib/cpi/store";
import { collectHormuz } from "@/lib/cpi/signals/hormuz";
import { collectPolymarket } from "@/lib/cpi/signals/polymarket";
import { collectBonbast } from "@/lib/cpi/signals/bonbast";
import { collectNasaFirms } from "@/lib/cpi/signals/nasa-firms";
import { collectFlightradar } from "@/lib/cpi/signals/flightradar";

// Vercel Cron needs GET, but we also support POST for manual triggers
export const maxDuration = 60; // seconds — Vercel Pro allows up to 300
export const dynamic = "force-dynamic";

async function runCycle(): Promise<{
  cpi: number | null;
  zone: string;
  confidence: number;
  signals: Record<string, SignalResult>;
  scenario_shifts: Record<string, number>;
  override_alerts: { signal: string; severity: string; interpretation: string }[];
}> {
  const now = new Date();
  console.log(
    `\n[${now.toISOString()}] CPI Cron: Collecting signals...`
  );

  // Collect all signals concurrently
  // Hormuz WebSocket runs for ~45s, others are fast HTTP calls
  const [hormuzResult, bonbastResult, polymarketResult, flightradarResult, firmsResult] =
    await Promise.allSettled([
      collectHormuz(),
      collectBonbast(),
      collectPolymarket(),
      collectFlightradar(),
      collectNasaFirms(),
    ]);

  function safe(
    result: PromiseSettledResult<SignalResult>,
    name: string
  ): SignalResult {
    if (result.status === "fulfilled") return result.value;
    console.log(`[CRON] ${name} threw: ${result.reason}`);
    return {
      signal: name,
      score: 50,
      confidence: 0.0,
      interpretation: `NO DATA: exception \u2014 ${String(result.reason).slice(0, 80)}`,
      alert: false,
      timestamp: now.toISOString(),
    };
  }

  const signals: Record<string, SignalResult> = {
    hormuz: safe(hormuzResult, "hormuz"),
    bonbast: safe(bonbastResult, "bonbast"),
    polymarket: safe(polymarketResult, "polymarket"),
    flightradar: safe(flightradarResult, "flightradar"),
    nasa_firms: safe(firmsResult, "nasa_firms"),
  };

  // Log signal status
  for (const [name, sig] of Object.entries(signals)) {
    const conf = sig.confidence ?? 0;
    const score = sig.score ?? "?";
    const status = conf > 0.5 ? "\u2713" : conf === 0 ? "\u2717" : "~";
    const interp = (sig.interpretation ?? "").slice(0, 60);
    console.log(
      `  ${status} ${name.padEnd(12)} score=${String(score).padStart(3)}  conf=${conf.toFixed(1)}  ${interp}`
    );
  }

  // Compute CPI
  const cpiResult = computeCPI(signals);

  // Process alerts (Telegram)
  await processAlerts(cpiResult, signals);

  // Save history
  const history = await getHistory();
  const entry: HistoryEntry = {
    timestamp: now.toISOString(),
    cpi: cpiResult.cpi,
    zone: cpiResult.zone.name,
    confidence: cpiResult.total_confidence,
    signals: Object.fromEntries(
      Object.entries(signals).map(([name, sig]) => [
        name,
        { score: sig.score ?? 50, confidence: sig.confidence ?? 0 },
      ])
    ),
    scenario_shifts: cpiResult.scenario_shifts,
  };
  history.push(entry);
  await setHistory(history);

  // Save latest
  const latest: LatestData = {
    cpi_result: cpiResult,
    signals: Object.fromEntries(
      Object.entries(signals).map(([name, sig]) => {
        const base: SignalResult = {
          signal: sig.signal,
          score: sig.score ?? 50,
          confidence: sig.confidence ?? 0,
          interpretation: sig.interpretation ?? "",
          alert: sig.alert ?? false,
          type: sig.type ?? "weighted",
          timestamp: sig.timestamp,
        };
        // Pass through extra fields
        for (const extra of [
          "count",
          "rate",
          "price",
          "flight_count",
          "total_hits",
          "critical_hits",
          "trend_pct",
          "move_2h",
        ] as const) {
          if (extra in sig) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (base as any)[extra] = (sig as any)[extra];
          }
        }
        return [name, base];
      })
    ),
    timestamp: now.toISOString(),
  };
  await setLatest(latest);

  // Summary
  const cpi = cpiResult.cpi;
  const zone = cpiResult.zone.name;
  const conf = cpiResult.total_confidence;

  if (cpi !== null) {
    console.log(
      `\n  CPI: ${cpi} \u2014 ${zone} (confidence: ${Math.round(conf * 100)}%)`
    );
  } else {
    console.log(
      `\n  CPI: INSUFFICIENT DATA (confidence: ${Math.round(conf * 100)}%)`
    );
  }

  if (Object.keys(cpiResult.scenario_shifts).length > 0) {
    console.log(
      `  Scenario shifts: ${JSON.stringify(cpiResult.scenario_shifts)}`
    );
  }

  return {
    cpi,
    zone,
    confidence: conf,
    signals,
    scenario_shifts: cpiResult.scenario_shifts,
    override_alerts: cpiResult.override_alerts,
  };
}

export async function GET(request: Request) {
  // Verify cron secret if set (Vercel Cron sends this header)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runCycle();
    return NextResponse.json({
      ok: true,
      cpi: result.cpi,
      zone: result.zone,
      confidence: result.confidence,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[CRON] Cycle error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

// POST for manual trigger (from dashboard "refresh" button)
export async function POST(request: Request) {
  return GET(request);
}
