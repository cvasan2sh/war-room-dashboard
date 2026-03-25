// types.ts — CPI signal types (shared across all modules)

export interface SignalResult {
  signal: string;
  score: number;
  confidence: number;
  interpretation: string;
  alert: boolean | null;
  timestamp: string;
  type?: "weighted" | "override";
  // Extra fields per signal
  count?: number;
  flag_count?: number;
  flags?: string[];
  messages_received?: number;
  rate?: number | null;
  trend_pct?: number;
  price?: number | null;
  move_2h?: number | null;
  market_question?: string;
  flight_count?: number | null;
  total_hits?: number;
  critical_hits?: Record<string, number>;
  above_baseline?: Record<string, number>;
  flare_filtered?: number;
}

export interface ZoneInfo {
  name: string;
  color: string;
  emoji: string;
}

export interface OverrideAlert {
  signal: string;
  interpretation: string;
  severity: "critical" | "warning" | "info";
}

export interface CPIResult {
  cpi: number | null;
  zone: ZoneInfo;
  total_confidence: number;
  signal_details: Record<
    string,
    { score: number; confidence: number; effective_weight: number }
  >;
  alerts: string[];
  scenario_shifts: Record<string, number>;
  override_alerts: OverrideAlert[];
  timestamp: string;
}

export interface HistoryEntry {
  timestamp: string;
  cpi: number | null;
  zone: string;
  confidence: number;
  signals: Record<string, { score: number; confidence: number }>;
  scenario_shifts: Record<string, number>;
}

export interface LatestData {
  cpi_result: CPIResult;
  signals: Record<string, SignalResult>;
  timestamp: string;
}

// KV state shape
export interface SignalState {
  bonbast_rates: { rate: number; ts: string }[];
  polymarket_prices: { price: number; ts: string }[];
  previous_zone: string | null;
  previous_cpi: number | null;
}
