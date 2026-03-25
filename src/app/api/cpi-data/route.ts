// API route: /api/cpi-data
// Serves CPI data from KV store (serverless) or filesystem (legacy fallback)

import { NextResponse } from "next/server";
import { getLatest, getHistory } from "@/lib/cpi/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let latest = null;
  let history: unknown[] = [];

  try {
    latest = await getLatest();
  } catch (e) {
    console.log(`[CPI-DATA] Could not load latest from KV: ${e}`);
    // Fallback to filesystem for backward compatibility
    try {
      const { readFile } = await import("fs/promises");
      const { join } = await import("path");
      const publicDir = join(process.cwd(), "public", "data");
      const raw = await readFile(join(publicDir, "latest.json"), "utf-8");
      latest = JSON.parse(raw);
    } catch {
      // No data available at all
    }
  }

  try {
    history = await getHistory();
  } catch (e) {
    console.log(`[CPI-DATA] Could not load history from KV: ${e}`);
    try {
      const { readFile } = await import("fs/promises");
      const { join } = await import("path");
      const publicDir = join(process.cwd(), "public", "data");
      const raw = await readFile(join(publicDir, "history.json"), "utf-8");
      history = JSON.parse(raw);
    } catch {
      // No history available
    }
  }

  return NextResponse.json({
    latest,
    history: (history as unknown[]).slice(-96), // last 24h at 15-min intervals
    hasData: latest !== null,
  });
}
