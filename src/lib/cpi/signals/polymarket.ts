// signals/polymarket.ts — Ceasefire probability from Polymarket Gamma API
// Price = probability. 0.30 = 30% ceasefire chance.
// Now runs from Vercel's data centers — no more ISP blocking!

import type { SignalResult } from "../types";
import { getSignalState, setSignalState } from "../store";
import {
  POLYMARKET_API,
  POLYMARKET_SLUG,
  POLYMARKET_TIMEOUT,
} from "../config";

const DIRECT_SLUGS = [
  POLYMARKET_SLUG,
  "iran-ceasefire",
  "us-iran-ceasefire",
  "iran-us-ceasefire",
];

const SEARCH_QUERIES = [
  { text_query: "iran ceasefire", closed: "false", limit: "20" },
  { text_query: "iran war", closed: "false", limit: "20" },
  { tag: "iran", closed: "false", limit: "20" },
  { tag: "middle-east", closed: "false", limit: "30" },
];

function noData(reason: string): SignalResult {
  return {
    signal: "polymarket",
    score: 50,
    confidence: 0.0,
    interpretation: `NO DATA: ${reason}`,
    alert: false,
    price: null,
    move_2h: null,
    timestamp: new Date().toISOString(),
  };
}

function extractPrice(market: Record<string, unknown>): number | null {
  for (const field of [
    "outcomePrices",
    "bestBid",
    "lastTradePrice",
    "price",
  ]) {
    const val = market[field];
    if (val == null) continue;

    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          const p = parseFloat(parsed[0]);
          if (p >= 0 && p <= 1) return p;
        }
      } catch {
        try {
          const p = parseFloat(val);
          if (p >= 0 && p <= 1) return p;
        } catch {
          /* skip */
        }
      }
    } else if (typeof val === "number" && val >= 0 && val <= 1) {
      return val;
    }
  }
  return null;
}

function isCeasefireMarket(market: Record<string, unknown>): boolean {
  const q = (
    ((market.question as string) ?? "") +
    " " +
    ((market.description as string) ?? "")
  ).toLowerCase();
  const hasIran = ["iran", "iranian", "tehran", "persian gulf"].some((k) =>
    q.includes(k)
  );
  const hasPeace = [
    "ceasefire",
    "peace",
    "deal",
    "agreement",
    "diplomatic",
    "negotiat",
    "truce",
    "end of war",
  ].some((k) => q.includes(k));
  return hasIran && hasPeace;
}

async function searchMarkets(): Promise<{
  market: Record<string, unknown> | null;
  method: string;
}> {
  let lastError = "no strategies succeeded";
  let timeoutCount = 0;

  // Phase 1: Direct slug path (O(1) lookup)
  for (const slug of DIRECT_SLUGS) {
    if (timeoutCount >= 2) break;
    try {
      console.log(`[POLYMARKET] Direct: /markets/slug/${slug}`);
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        POLYMARKET_TIMEOUT
      );

      const resp = await fetch(
        `${POLYMARKET_API}/markets/slug/${slug}`,
        {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        }
      );
      clearTimeout(timer);

      if (resp.ok) {
        const market = (await resp.json()) as Record<string, unknown>;
        if (market && extractPrice(market) !== null) {
          const q = ((market.question as string) ?? "?").slice(0, 60);
          console.log(`[POLYMARKET] Found via direct path: ${q}`);
          return { market, method: `direct:slug=${slug}` };
        }
      } else if (resp.status === 404) {
        console.log(`[POLYMARKET]   -> 404 (slug not found)`);
      } else {
        console.log(`[POLYMARKET]   -> HTTP ${resp.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort")) {
        timeoutCount++;
        lastError = `timeout on direct slug '${slug}'`;
        console.log(`[POLYMARKET]   -> TIMEOUT`);
      } else {
        lastError = `error on slug '${slug}': ${msg.slice(0, 60)}`;
        console.log(`[POLYMARKET]   -> ERROR: ${lastError}`);
      }
    }
  }

  // Phase 2: Filter/keyword search
  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    if (timeoutCount >= 2) {
      console.log(
        `[POLYMARKET] Aborting after ${timeoutCount} timeouts`
      );
      return {
        market: null,
        method: `network unreachable (${timeoutCount} timeouts)`,
      };
    }

    const params = SEARCH_QUERIES[i];
    const desc = params.text_query ?? params.tag ?? "?";

    try {
      console.log(`[POLYMARKET] Search ${i}: ${desc}`);
      const url = new URL(`${POLYMARKET_API}/markets`);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        POLYMARKET_TIMEOUT
      );
      const resp = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (!resp.ok) {
        lastError = `HTTP ${resp.status} for '${desc}'`;
        console.log(`[POLYMARKET]   -> HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const markets: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : data
          ? [data]
          : [];
      console.log(`[POLYMARKET]   -> ${markets.length} markets returned`);

      for (const m of markets) {
        if (isCeasefireMarket(m) && extractPrice(m) !== null) {
          const q = ((m.question as string) ?? "?").slice(0, 60);
          console.log(`[POLYMARKET] Found via search: ${q}`);
          return { market: m, method: `search:${desc}` };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort")) {
        timeoutCount++;
        lastError = `timeout on search '${desc}'`;
        console.log(`[POLYMARKET]   -> TIMEOUT`);
      } else {
        lastError = `error on search '${desc}': ${msg.slice(0, 60)}`;
        console.log(`[POLYMARKET]   -> ERROR: ${lastError}`);
      }
    }
  }

  return { market: null, method: lastError };
}

export async function collectPolymarket(): Promise<SignalResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const { market, method } = await searchMarkets();

    if (!market) {
      return noData(`no ceasefire market found (${method})`);
    }

    const price = extractPrice(market);
    if (price === null) {
      return noData(
        `could not extract price from: ${((market.question as string) ?? "?").slice(0, 60)}`
      );
    }

    // Score = price * 100
    const s = Math.max(0, Math.min(100, Math.round(price * 100)));

    // Persist price history
    const state = await getSignalState();
    const prices = [...(state.polymarket_prices ?? [])];
    prices.push({ price, ts: nowIso });

    // Trim to last 192 entries
    const trimmedPrices = prices.slice(-192);
    state.polymarket_prices = trimmedPrices;
    await setSignalState(state);

    // Calculate 2-hour move
    let move2h: number | null = null;
    const twoHoursAgo = now.getTime() - 7200_000;
    const old = trimmedPrices.filter(
      (p) => new Date(p.ts).getTime() < twoHoursAgo
    );
    if (old.length > 0) {
      const anchor = old[old.length - 1].price;
      move2h = Math.round((price - anchor) * 1000) / 1000;
    }

    // Interpretation
    const pct = Math.round(price * 1000) / 10;
    let interp: string;
    if (s >= 60) interp = `Ceasefire at ${pct}% \u2014 market sees deal forming`;
    else if (s >= 40) interp = `Ceasefire at ${pct}% \u2014 market uncertain`;
    else if (s >= 20) interp = `Ceasefire at ${pct}% \u2014 market skeptical`;
    else interp = `Ceasefire at ${pct}% \u2014 market sees no path to deal`;

    if (move2h !== null) {
      const direction = move2h > 0 ? "up" : "down";
      interp += ` (${direction} ${(Math.abs(move2h) * 100).toFixed(1)}pp in 2h)`;
    }

    return {
      signal: "polymarket",
      score: s,
      confidence: 1.0,
      interpretation: interp,
      alert: move2h !== null && Math.abs(move2h) >= 0.08,
      price: Math.round(price * 10000) / 10000,
      move_2h: move2h,
      market_question: (market.question as string) ?? "",
      timestamp: nowIso,
    };
  } catch (e) {
    return noData(`API error \u2014 ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
  }
}
