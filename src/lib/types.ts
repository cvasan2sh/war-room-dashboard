// War Room — Core Types

export interface Actor {
  id: string;
  name: string;
  flag: string;
  status: string;
  statusColor: string;
  objective: string;
  constraint: string;
  keySignal: string;
  latestDevelopment?: string;
  latestDevTimestamp?: string;
  latestDevSource?: string;
}

export interface NiftyScenario {
  scenario: string;
  key: string; // short key for AI mapping (e.g. 'attrition', 'ceasefire')
  prob: number;
  range: string; // Nifty range
  rangeMid: number; // midpoint for P-weighted calc
  driver: string;
  ivEstimate: string;
  // Multi-market impact
  oilRange?: string; // Brent crude range e.g. "$95-105"
  oilMid?: number; // midpoint
  inrRange?: string; // USD/INR range e.g. "86.5-87.5"
  inrMid?: number; // midpoint
  timeHorizon?: string; // e.g. "1-2 weeks", "3-5 days"
  status?: 'active' | 'emerging' | 'fading'; // scenario lifecycle
  lastUpdated?: string; // ISO timestamp of last AI update
  analogues: HistoricalAnalogue[];
}

export interface HistoricalAnalogue {
  event: string;
  date: string;
  oilMove: string;
  niftyMove: string;
  vixMove: string;
  recoveryDays: number;
  source: string;
}

export interface EvidenceItem {
  id: string;
  timestamp: string;
  headline: string;
  source: string;
  sourceUrl?: string;
  classification: 'FACT' | 'REPORTED' | 'DERIVED';
  scenarioId?: string;
  direction: '+' | '-' | 'neutral';
  likelihoodRatio: number;
  reasoning: string;
  actorId?: string;
}

export interface BayesianUpdate {
  scenarioId: string;
  scenario: string;
  prior: number;
  posterior: number;
  evidenceCount: number;
  trail: BayesianTrailItem[];
}

export interface BayesianTrailItem {
  evidence: string;
  source: string;
  classification: string;
  direction: string;
  likelihoodRatio: number;
  reasoning: string;
  priorOdds: string;
  posteriorOdds: string;
}

export type FeedCardType = 'EVIDENCE' | 'MARKET' | 'ANALYSIS' | 'ACTOR_UPDATE' | 'SYSTEM';

export interface FeedCard {
  id: string;
  type: FeedCardType;
  timestamp: string;
  title: string;
  body: string;
  source?: string;
  sourceUrl?: string;
  classification?: 'FACT' | 'REPORTED' | 'DERIVED';
  scenarioImpact?: {
    scenarioId: string;
    scenario: string;
    prior: number;
    posterior: number;
    likelihoodRatio: number;
  };
  bayesianTrail?: BayesianTrailItem[];
  actorId?: string;
}

export interface MarketData {
  nifty: number;
  niftyChange: number;
  niftyChangePct: number;
  oil: number;
  oilChange: number;
  oilChangePct: number;
  inr: number;
  inrChange: number;
  inrChangePct: number;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  timestamp: string;
}

export interface DashboardState {
  actors: Actor[];
  scenarios: NiftyScenario[];
  feedCards: FeedCard[];
  marketData: MarketData | null;
  lastAiRefresh: string | null;
  lastVisit: string | null;
  userNotes: string;
  warStartDate: string; // ISO date
}
