import { Actor, NiftyScenario, DashboardState } from './types';

export const WAR_START_DATE = '2026-02-28';

export const INITIAL_ACTORS: Actor[] = [
  {
    id: 'usa', name: 'UNITED STATES', flag: '🇺🇸',
    status: 'ACTIVE COMBATANT', statusColor: '#ef4444',
    objective: 'Destroy Iranian missile/nuclear capacity. Manage domestic war fatigue. Seek exit ramp.',
    constraint: 'Approval at 22%. Carrier group stretched. Election cycle pressure. No ground troops viable.',
    keySignal: 'Trump Truth Social + Hegseth press briefings + Vance/Rubio travel',
  },
  {
    id: 'israel', name: 'ISRAEL', flag: '🇮🇱',
    status: 'ACTIVE COMBATANT', statusColor: '#ef4444',
    objective: 'Destroy remaining nuclear sites. Kill Mojtaba. Push Abraham Accords expansion.',
    constraint: 'Interceptor stockpiles low after 26 days. US misalignment growing. Netanyahu needs war hot for elections.',
    keySignal: 'IDF operational tempo + Netanyahu vs Gallant divergence',
  },
  {
    id: 'iran', name: 'IRAN (Mojtaba)', flag: '🇮🇷',
    status: 'UNDER ATTACK — DEPLETING', statusColor: '#f97316',
    objective: 'Regime survival. Demonstrate resilience. Make ceasefire terms acceptable.',
    constraint: 'Missile stocks depleted ~60%. IRGC vs Pezeshkian split widening. Internet throttled.',
    keySignal: 'Hormuz tanker traffic + IRGC vs Pezeshkian statements + missile launch frequency',
  },
  {
    id: 'russia', name: 'RUSSIA', flag: '🇷🇺',
    status: 'ACTIVE BROKER', statusColor: '#8b5cf6',
    objective: 'Broker deal for leverage. Oil revenue at $100+. Bleed US attention from Ukraine.',
    constraint: 'Ukraine war limits capacity. Must balance Iran ally role with deal-maker role.',
    keySignal: 'Trump-Putin call frequency + Russian envoy travel + energy revenue data',
  },
  {
    id: 'china', name: 'CHINA', flag: '🇨🇳',
    status: 'COVERT SUPPLIER', statusColor: '#eab308',
    objective: 'Iran survives. Hormuz reopens. US credibility damaged. Post-war rebuilder.',
    constraint: 'Hormuz closure costs ~$25B/yr per $10 oil spike. Walking tightrope.',
    keySignal: 'CM-302 delivery intel + Wang Yi diplomatic calls + tanker rerouting via Malacca',
  },
  {
    id: 'saudi', name: 'SAUDI ARABIA', flag: '🇸🇦',
    status: 'MEDIATOR + BUFFER', statusColor: '#06b6d4',
    objective: 'Iran weakened not destroyed. Regional primacy. Oil revenue windfall managed.',
    constraint: 'Saudi-Iran backchannel active. Aramco infrastructure vulnerable. Cannot publicly align with Israel.',
    keySignal: 'Saudi FM statements + oil price response + Aramco production data',
  },
  {
    id: 'qatar', name: 'QATAR', flag: '🇶🇦',
    status: 'MEDIATOR + VICTIM', statusColor: '#06b6d4',
    objective: 'De-escalation. Reopen LNG exports. Host ceasefire talks for global credibility.',
    constraint: 'LNG shutdown = massive revenue loss. North Field facility vulnerable.',
    keySignal: 'Qatar LNG export resumption = clearest ceasefire signal',
  },
  {
    id: 'india', name: 'INDIA', flag: '🇮🇳',
    status: 'ACTIVE NEUTRAL — STRESSED', statusColor: '#10b981',
    objective: 'Energy security. Diaspora protection (9M in Gulf). Strategic autonomy.',
    constraint: '$51.4B Gulf remittances at risk. 40% oil via Hormuz. 74 days crude buffer. RBI intervening.',
    keySignal: 'INR/USD + RBI policy + SPR drawdown + Hormuz transit data',
  },
  {
    id: 'pakistan', name: 'PAKISTAN', flag: '🇵🇰',
    status: 'BROKER + NUCLEAR RISK', statusColor: '#ef4444',
    objective: 'Economic survival. Broker ceasefire for IMF leverage. Contain domestic Shia unrest.',
    constraint: '99% LNG from Qatar (shut). Petrol +55%. Saudi defence pact. Nuclear escalation risk.',
    keySignal: 'Shehbaz-Mojtaba calls + domestic fuel prices + Army deployment',
  },
  {
    id: 'gulf_others', name: 'UAE + OMAN + KUWAIT', flag: '🌍',
    status: 'COLLATERAL + MEDIATORS', statusColor: '#6b7280',
    objective: 'Survive without joining war. Oman as honest broker. UAE rebuild credibility.',
    constraint: 'Dubai airport damaged. Interceptor stocks low. Oman FM most trusted by all parties.',
    keySignal: 'Oman FM Badr al-Busaidi travel schedule + Dubai airport status',
  },
];

export const INITIAL_SCENARIOS: NiftyScenario[] = [
  {
    scenario: 'Grinding attrition continues',
    key: 'attrition',
    prob: 35,
    range: '22,400–23,200', rangeMid: 22800,
    driver: 'Status quo — daily strikes, no breakthrough, oil $95-110',
    ivEstimate: 'VIX 20–25',
    oilRange: '$95–110', oilMid: 102,
    inrRange: '86.5–87.5', inrMid: 87.0,
    timeHorizon: '2-4 weeks',
    status: 'active',
    analogues: [{
      event: 'US-Iran tensions Jun-Sep 2019 (tanker attacks, drone shootdown)',
      date: 'Jun–Sep 2019',
      oilMove: '+8% over 3 months',
      niftyMove: '-3.1% drawdown, recovered in 6 weeks',
      vixMove: 'India VIX avg 15.2, peaked 18.4',
      recoveryDays: 42,
      source: 'NSE historical data',
    }],
  },
  {
    scenario: 'Pakistan/Oman-brokered ceasefire',
    key: 'ceasefire',
    prob: 18,
    range: '24,200–25,000', rangeMid: 24600,
    driver: 'Back-channel succeeds. Shehbaz + Badr al-Busaidi framework. Trump claims credit.',
    ivEstimate: 'VIX 14–17 (crush)',
    oilRange: '$78–88', oilMid: 83,
    inrRange: '85.0–86.0', inrMid: 85.5,
    timeHorizon: '1-3 weeks',
    status: 'active',
    analogues: [{
      event: 'June 2025 12-Day War ceasefire (Oman-brokered)',
      date: 'Jun 24, 2025',
      oilMove: '-12% in 48 hours',
      niftyMove: '+4.2% gap-up on deal day, +6.8% in 5 sessions',
      vixMove: '-35% in 3 sessions',
      recoveryDays: 0,
      source: 'NSE, Reuters — June 2025 ceasefire data',
    }],
  },
  {
    scenario: 'Iran missile depletion → forced standdown',
    key: 'depletion',
    prob: 14,
    range: '23,500–24,400', rangeMid: 23950,
    driver: 'Iran runs out of medium-range missiles (~60% depleted). IRGC forced to negotiate from weakness.',
    ivEstimate: 'VIX 16–20',
    oilRange: '$85–95', oilMid: 90,
    inrRange: '85.5–86.5', inrMid: 86.0,
    timeHorizon: '2-5 weeks',
    status: 'active',
    analogues: [{
      event: 'Iraq missile exhaustion phase (Gulf War 1991)',
      date: 'Feb 1991',
      oilMove: '-30% on ground war start (from peak)',
      niftyMove: 'BSE rallied 8% in Feb 1991 on war-end expectations',
      vixMove: 'VIX dropped from 36 to 18 over 4 weeks',
      recoveryDays: 14,
      source: 'Historical data, Gulf War timelines',
    }],
  },
  {
    scenario: 'Iran retaliates — Hormuz full closure',
    key: 'hormuz_closure',
    prob: 12,
    range: '20,500–22,000', rangeMid: 21250,
    driver: 'IRGC mines strait or sinks a tanker. Oil spikes above $130. India macro shock.',
    ivEstimate: 'VIX 30–42',
    oilRange: '$125–150', oilMid: 137,
    inrRange: '89.0–92.0', inrMid: 90.5,
    timeHorizon: '1-2 weeks',
    status: 'active',
    analogues: [{
      event: 'Houthi/IRGC drone strike on Saudi Abqaiq facility',
      date: 'Sep 14, 2019',
      oilMove: '+14.6% intraday (largest since 1991)',
      niftyMove: '-1.7% next open, -2.8% cumulative over 3 sessions',
      vixMove: '+35% spike, took 11 sessions to mean-revert',
      recoveryDays: 11,
      source: 'NSE historical data, Bloomberg',
    }],
  },
  {
    scenario: 'Trump-Putin deal framework',
    key: 'trump_putin',
    prob: 8,
    range: '24,500–25,500', rangeMid: 25000,
    driver: 'Trump-Putin phone deal. Rapid de-escalation. Both claim victory.',
    ivEstimate: 'VIX 12–15 (hard crush)',
    oilRange: '$75–85', oilMid: 80,
    inrRange: '84.5–85.5', inrMid: 85.0,
    timeHorizon: '1-2 weeks',
    status: 'active',
    analogues: [{
      event: 'Trump-Kim Singapore summit (de-escalation surprise)',
      date: 'Jun 12, 2018',
      oilMove: '-0.8% (minimal direct impact)',
      niftyMove: '+1.2% on session, sentiment-driven',
      vixMove: '-15% in week following',
      recoveryDays: 0,
      source: 'NSE historical data',
    }],
  },
  {
    scenario: 'Israel eliminates Mojtaba',
    key: 'mojtaba',
    prob: 7,
    range: '20,000–21,500', rangeMid: 20750,
    driver: 'Decapitation strike. Iran power vacuum. IRGC hardliners vs Pezeshkian split.',
    ivEstimate: 'VIX 35–48',
    oilRange: '$115–140', oilMid: 127,
    inrRange: '88.0–91.0', inrMid: 89.5,
    timeHorizon: 'Immediate',
    status: 'active',
    analogues: [{
      event: 'US assassination of Qasem Soleimani',
      date: 'Jan 3, 2020',
      oilMove: '+3.5% on day',
      niftyMove: '-1.9% on next open, -2.4% in 2 sessions',
      vixMove: '+28% spike, reverted in 8 sessions',
      recoveryDays: 8,
      source: 'NSE historical data, Reuters',
    }],
  },
  {
    scenario: 'Major infra hit (Kharg/Ras Tanura)',
    key: 'infra_hit',
    prob: 6,
    range: '19,000–20,500', rangeMid: 19750,
    driver: 'Oil export infrastructure destroyed. Brent above $140. Global recession fears.',
    ivEstimate: 'VIX 40–55',
    oilRange: '$135–165', oilMid: 150,
    inrRange: '90.0–94.0', inrMid: 92.0,
    timeHorizon: 'Immediate',
    status: 'active',
    analogues: [{
      event: 'Abqaiq attack (2019) — scaled up',
      date: 'Sep 14, 2019',
      oilMove: '+14.6% intraday — but actual destruction would sustain spike for weeks',
      niftyMove: '-5% to -8% estimated (2019 was brief because damage was repairable)',
      vixMove: '+50% spike estimated',
      recoveryDays: 30,
      source: 'Abqaiq 2019 as baseline, scaled for severity',
    }],
  },
];

export function createInitialState(): DashboardState {
  return {
    actors: INITIAL_ACTORS,
    scenarios: INITIAL_SCENARIOS,
    feedCards: [],
    marketData: null,
    lastAiRefresh: null,
    lastVisit: null,
    userNotes: '',
    warStartDate: WAR_START_DATE,
  };
}

export function weightedNifty(scenarios: NiftyScenario[]): number {
  return Math.round(
    scenarios.reduce((sum, s) => sum + s.rangeMid * (s.prob / 100), 0)
  );
}

export function weightedOil(scenarios: NiftyScenario[]): number {
  return Math.round(
    scenarios.reduce((sum, s) => sum + (s.oilMid || 100) * (s.prob / 100), 0)
  );
}

export function weightedInr(scenarios: NiftyScenario[]): number {
  const val = scenarios.reduce((sum, s) => sum + (s.inrMid || 87) * (s.prob / 100), 0);
  return Math.round(val * 100) / 100;
}
