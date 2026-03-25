// store.ts — State persistence layer
// Uses Vercel KV in production, in-memory Map for local dev.
// All CPI state (histories, previous zone, etc.) goes through here.

import type { SignalState, HistoryEntry, LatestData } from "./types";

// ── Vercel KV (optional) ──────────────────────────────────────
// If @vercel/kv is available and KV_REST_API_URL is set, use it.
// Otherwise fall back to in-memory (fine for single-instance serverless).

let kvClient: {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
} | null = null;

// In-memory fallback
const memStore = new Map<string, unknown>();

async function initKV() {
  if (kvClient !== null) return;
  if (process.env.KV_REST_API_URL) {
    try {
      const kv = await import("@vercel/kv");
      kvClient = kv;
      console.log("[STORE] Using Vercel KV");
      return;
    } catch {
      // @vercel/kv not installed — use memory
    }
  }
  // Fallback: memory store with same interface
  kvClient = {
    get: async (key: string) => memStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      memStore.set(key, value);
    },
  };
  console.log("[STORE] Using in-memory store (no KV_REST_API_URL)");
}

// ── Public API ────────────────────────────────────────────────

const DEFAULT_STATE: SignalState = {
  bonbast_rates: [],
  polymarket_prices: [],
  previous_zone: null,
  previous_cpi: null,
};

export async function getSignalState(): Promise<SignalState> {
  await initKV();
  const raw = await kvClient!.get("cpi:signal_state");
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  return raw as SignalState;
}

export async function setSignalState(state: SignalState): Promise<void> {
  await initKV();
  await kvClient!.set("cpi:signal_state", state);
}

export async function getHistory(): Promise<HistoryEntry[]> {
  await initKV();
  const raw = await kvClient!.get("cpi:history");
  if (!Array.isArray(raw)) return [];
  return raw as HistoryEntry[];
}

export async function setHistory(history: HistoryEntry[]): Promise<void> {
  await initKV();
  // Keep 7 days at 15-min intervals
  const trimmed = history.slice(-672);
  await kvClient!.set("cpi:history", trimmed);
}

export async function getLatest(): Promise<LatestData | null> {
  await initKV();
  const raw = await kvClient!.get("cpi:latest");
  if (!raw || typeof raw !== "object") return null;
  return raw as LatestData;
}

export async function setLatest(latest: LatestData): Promise<void> {
  await initKV();
  await kvClient!.set("cpi:latest", latest);
}
