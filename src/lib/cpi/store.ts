// store.ts — State persistence layer
// In-memory store for serverless. State persists within a single
// invocation and across warm starts, but resets on cold start.
// For Hobby plan this is fine — KV can be added later on Pro.

import type { SignalState, HistoryEntry, LatestData } from "./types";

// Global in-memory store — survives across warm invocations
const memStore = new Map<string, unknown>();

const DEFAULT_STATE: SignalState = {
  bonbast_rates: [],
  polymarket_prices: [],
  previous_zone: null,
  previous_cpi: null,
};

// ── Signal State ─────────────────────────────────────────────

export async function getSignalState(): Promise<SignalState> {
  const raw = memStore.get("cpi:signal_state");
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  return raw as SignalState;
}

export async function setSignalState(state: SignalState): Promise<void> {
  memStore.set("cpi:signal_state", state);
}

// ── History ──────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = memStore.get("cpi:history");
  if (!Array.isArray(raw)) return [];
  return raw as HistoryEntry[];
}

export async function setHistory(history: HistoryEntry[]): Promise<void> {
  const trimmed = history.slice(-672);
  memStore.set("cpi:history", trimmed);
}

// ── Latest ───────────────────────────────────────────────────

export async function getLatest(): Promise<LatestData | null> {
  const raw = memStore.get("cpi:latest");
  if (!raw || typeof raw !== "object") return null;
  return raw as LatestData;
}

export async function setLatest(latest: LatestData): Promise<void> {
  memStore.set("cpi:latest", latest);
}
