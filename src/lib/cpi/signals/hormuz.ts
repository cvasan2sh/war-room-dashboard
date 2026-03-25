// signals/hormuz.ts — AIS vessel tracking in Strait of Hormuz
// The alpha signal. Counts physical ships transiting the strait.
// Uses AISStream WebSocket — shortened to 45s for serverless timeout budget.

import type { SignalResult } from "../types";
import {
  AISSTREAM_API_KEY,
  HORMUZ_BOX,
  HORMUZ_LISTEN_SECONDS,
  HORMUZ_NORMAL_VESSELS,
} from "../config";

function noData(reason: string): SignalResult {
  return {
    signal: "hormuz",
    score: 50,
    confidence: 0.0,
    interpretation: `NO DATA: ${reason}`,
    alert: false,
    count: 0,
    flag_count: 0,
    flags: [],
    messages_received: 0,
    timestamp: new Date().toISOString(),
  };
}

function score(count: number, flagCount: number): number {
  if (count === 0) return 5;
  const k = 2.5 / HORMUZ_NORMAL_VESSELS;
  const raw = 100 * (1 - Math.exp(-k * count));
  let s = Math.max(5, Math.min(95, Math.round(raw)));
  if (count >= 3) {
    if (flagCount >= 3) s = Math.min(95, s + 5);
    else if (flagCount === 1) s = Math.max(5, s - 8);
  }
  return s;
}

function interpret(
  count: number,
  flagCount: number,
  s: number
): string {
  const flags = flagCount ? `, ${flagCount} flag states` : "";
  if (count === 0)
    return "Zero vessels in strait \u2014 possible blockade or shipping halt";
  if (s >= 70)
    return `${count} vessels transiting${flags} \u2014 normal commercial flow`;
  if (s >= 40)
    return `${count} vessels transiting${flags} \u2014 reduced traffic`;
  return `${count} vessels transiting${flags} \u2014 severely disrupted`;
}

export async function collectHormuz(): Promise<SignalResult> {
  if (!AISSTREAM_API_KEY) {
    return noData("AISSTREAM_API_KEY not configured");
  }

  const vessels = new Map<
    string,
    { type: number; flag: string }
  >();
  let messagesReceived = 0;
  let connectionOk = false;

  try {
    // Dynamic import — ws may not be available in all environments
    // In Node.js serverless, native WebSocket is available in Node 21+
    // For older runtimes, we use the global WebSocket or ws package
    const WS =
      typeof WebSocket !== "undefined"
        ? WebSocket
        : (await import("ws")).default;

    const ws = new WS("wss://stream.aisstream.io/v0/stream");

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + HORMUZ_LISTEN_SECONDS * 1000;

      ws.onopen = () => {
        connectionOk = true;
        ws.send(
          JSON.stringify({
            APIKey: AISSTREAM_API_KEY,
            BoundingBoxes: [HORMUZ_BOX],
            FilterMessageTypes: ["PositionReport"],
          })
        );
      };

      ws.onmessage = (event: { data: unknown }) => {
        messagesReceived++;
        try {
          const raw =
            typeof event.data === "string"
              ? event.data
              : event.data?.toString?.() ?? "";
          const msg = JSON.parse(raw);
          const meta = msg?.MetaData ?? {};
          const mmsi = meta.MMSI ?? "";
          if (mmsi) {
            vessels.set(String(mmsi), {
              type: meta.ShipType ?? 0,
              flag: meta.country_iso ?? meta.Flag ?? "",
            });
          }
        } catch {
          // Skip malformed messages
        }

        if (Date.now() >= deadline) {
          ws.close();
          resolve();
        }
      };

      ws.onerror = (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? (err as { message: string }).message
            : String(err);
        reject(new Error(`WebSocket error: ${msg.slice(0, 100)}`));
      };

      ws.onclose = () => resolve();

      // Safety timeout — don't exceed serverless budget
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        resolve();
      }, HORMUZ_LISTEN_SECONDS * 1000 + 2000);
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("403") || err.includes("401")) {
      return noData(`API key rejected \u2014 ${err.slice(0, 80)}`);
    }
    return noData(`WebSocket error \u2014 ${err.slice(0, 80)}`);
  }

  const count = vessels.size;
  const flagSet = new Set<string>();
  for (const v of vessels.values()) {
    if (v.flag) flagSet.add(v.flag);
  }
  const flagCount = flagSet.size;
  const s = score(count, flagCount);
  let interp = interpret(count, flagCount, s);

  let confidence: number;
  if (connectionOk && messagesReceived > 0) {
    confidence = 1.0;
  } else if (connectionOk) {
    confidence = 0.5;
    interp += " (low AIS volume \u2014 coverage gap possible)";
  } else {
    confidence = 0.0;
  }

  return {
    signal: "hormuz",
    score: s,
    confidence,
    interpretation: interp,
    alert: count === 0 && confidence >= 0.5,
    count,
    flag_count: flagCount,
    flags: Array.from(flagSet),
    messages_received: messagesReceived,
    timestamp: new Date().toISOString(),
  };
}
