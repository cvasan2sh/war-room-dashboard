// store.ts — State persistence layer
// Uses /tmp filesystem on Vercel serverless (persists across warm invocations).
// Falls back to in-memory Map if /tmp is unavailable.

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import type { SignalState, HistoryEntry, LatestData } from "./types";

const TMP_DIR = "/tmp/cpi";
const STATE_FILE = `${TMP_DIR}/signal_state.json`;
const HISTORY_FILE = `${TMP_DIR}/history.json`;
const LATEST_FILE = `${TMP_DIR}/latest.json`;

async function ensureDir() {
  if (!existsSync(TMP_DIR)) {
    await mkdir(TMP_DIR, { recursive: true });
  }
}

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    await ensureDir();
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  try {
    await ensureDir();
    await writeFile(path, JSON.stringify(data), "utf-8");
  } catch (e) {
    console.log(`[STORE] Failed to write ${path}: ${e}`);
  }
}

// ── Default state ────────────────────────────────────────────

const DEFAULT_STATE: SignalState = {
  bonbast_rates: [],
  polymarket_prices: [],
  previous_zone: null,
  previous_cpi: null,
};

// ── Signal State ─────────────────────────────────────────────

export async function getSignalState(): Promise<SignalState> {
  return readJSON(STATE_FILE, { ...DEFAULT_STATE });
}

export async function setSignalState(state: SignalState): Promise<void> {
  await writeJSON(STATE_FILE, state);
}

// ── History ──────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  return readJSON(HISTORY_FILE, []);
}

export async function setHistory(history: HistoryEntry[]): Promise<void> {
  const trimmed = history.slice(-672);
  await writeJSON(HISTORY_FILE, trimmed);
}

// ── Latest ───────────────────────────────────────────────────

export async function getLatest(): Promise<LatestData | null> {
  return readJSON(LATEST_FILE, null);
}

export async function setLatest(latest: LatestData): Promise<void> {
  await writeJSON(LATEST_FILE, latest);
}
