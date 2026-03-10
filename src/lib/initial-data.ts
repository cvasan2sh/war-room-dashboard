import { Actor, NiftyScenario, DashboardState } from './types';

export const WAR_START_DATE = '2026-02-28';

export const INITIAL_ACTORS: Actor[] = [
  {
    id: 'usa', name: 'UNITED STATES', flag: '🇺🇸',
    status: 'ACTIVE COMBATANT', statusColor: '#ef4444',
    objective: 'Destroy Iranian missile/nuclear capacity. Regime change ambiguous.',
    constraint: '25% public support. No ground troops politically viable. Trump-Israel misalignment.',
    keySignal: 'Trump Truth Social + Hegseth press briefings',
  },
  {
    id: 'israel', name: 'ISRAEL', flag: '🇮🇱',
    status: 'ACTIVE COMBATANT', statusColor: '#ef4444',
    objective: 'Destroy nuclear program + missile production. Kill Mojtaba. Abraham Accords expansion.',
    constraint: 'Netanyahu needs war hot through June for snap election. US misalignment on endgame.',
    keySignal: 'IDF operational announcements + Netanyahu press conferences',
  },
  {
    id: 'iran', name: 'IRAN (Mojtaba)', flag: '🇮🇷',
    status: 'UNDER ATTACK', statusColor: '#f97316',
    objective: 'Regime survival. Legitimacy establishment. Make economic cost prohibitive for US/Gulf.',
    constraint: 'Grief + IRGC dependency + legitimacy deficit = cannot concede publicly.',
    keySignal: 'Hormuz tanker traffic + IRGC vs Pezeshkian statements (split)',
  },
  {
    id: 'russia', name: 'RUSSIA', flag: '🇷🇺',
    status: 'SHADOW SUPPORTER', statusColor: '#8b5cf6',
    objective: 'Bleed the West. Protect INSTC corridor. Oil revenue at $100+. Broker eventual deal.',
    constraint: 'Ukraine war hollowed out projection capacity. Cannot intervene directly.',
    keySignal: 'Trump-Putin call frequency + Russian energy revenue data',
  },
  {
    id: 'china', name: 'CHINA', flag: '🇨🇳',
    status: 'COVERT ARMING', statusColor: '#eab308',
    objective: 'Iran survives. Hormuz reopens. US credibility damaged. Post-war rebuilder.',
    constraint: 'Hormuz closure costs ~$25B/yr per $10 oil spike. Between ally and economy.',
    keySignal: 'CM-302 delivery confirmation + Wang Yi diplomatic calls',
  },
  {
    id: 'saudi', name: 'SAUDI ARABIA', flag: '🇸🇦',
    status: 'UNWILLING TARGET', statusColor: '#f97316',
    objective: 'Iran weakened not destroyed. Regional primacy. Vision 2030 stability.',
    constraint: 'Saudi-Iran backchannel active. Cannot publicly align with Israel.',
    keySignal: 'Saudi FM statements + oil price response to attacks',
  },
  {
    id: 'qatar', name: 'QATAR', flag: '🇶🇦',
    status: 'MEDIATOR + TARGET', statusColor: '#06b6d4',
    objective: 'De-escalation. Reopen LNG exports (20% global LNG shut). Mediation role.',
    constraint: 'LNG shutdown = massive revenue loss. Attacked despite neutrality.',
    keySignal: 'Qatar LNG export resumption = clearest ceasefire signal',
  },
  {
    id: 'india', name: 'INDIA', flag: '🇮🇳',
    status: 'ACTIVE NEUTRAL', statusColor: '#10b981',
    objective: 'Energy security. Diaspora protection (9M in Gulf). Strategic autonomy.',
    constraint: '$51.4B Gulf remittances at risk. 40% oil via Hormuz. 74 days crude buffer.',
    keySignal: 'INR/USD + RBI policy statements + Hormuz tanker data',
  },
  {
    id: 'pakistan', name: 'PAKISTAN', flag: '🇵🇰',
    status: 'NUCLEAR BYSTANDER', statusColor: '#ef4444',
    objective: 'Economic survival. Avoid Saudi defence pact activation. Contain Shia pressure.',
    constraint: '99% LNG from Qatar (shut). Petrol +55%. Saudi pact. Nuclear weapons.',
    keySignal: 'Domestic fuel prices + Army deployment + IMF emergency calls',
  },
  {
    id: 'gulf_others', name: 'UAE + OMAN + KUWAIT', flag: '🌍',
    status: 'COLLATERAL TARGETS', statusColor: '#6b7280',
    objective: 'Survive without joining war. Protect economic model.',
    constraint: 'Dubai airport hit. Interceptor stockpiles questioned. US bases = targets.',
    keySignal: 'Dubai airport status + Oman FM travel schedule',
  },
];

export const INITIAL_SCENARIOS: NiftyScenario[] = [
  {
    scenario: 'Controlled stalemate',
    prob: 38, range: '23,200–24,400', rangeMid: 23800,
    driver: 'Oil $88-100, no actor escalates',
    ivEstimate: 'VIX 18–22',
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
    scenario: 'Iran fires on US-escorted tanker',
    prob: 22, range: '21,500–22,800', rangeMid: 22150,
    driver: 'IRGC red line crossed, Hormuz escalation',
    ivEstimate: 'VIX 26–32',
    analogues: [{
      event: 'IRGC attacks on Kokuka Courageous & Front Altair',
      date: 'Jun 13, 2019',
      oilMove: '+4.5% on day, +2.1% day+1',
      niftyMove: '-1.1% on day, recovered 60% in 3 sessions',
      vixMove: '+18% spike, mean-reverted in 5 sessions',
      recoveryDays: 5,
      source: 'NSE historical data, Reuters',
    }],
  },
  {
    scenario: 'Qatar/Saudi ceasefire framework',
    prob: 12, range: '24,500–25,200', rangeMid: 24850,
    driver: 'Back-channel success + Trump needs win',
    ivEstimate: 'VIX 14–17 (crush)',
    analogues: [{
      event: 'US-Iran JCPOA framework agreement',
      date: 'Apr 2, 2015',
      oilMove: '-2.3% on day (relief)',
      niftyMove: '+1.8% on next open',
      vixMove: '-22% in 3 sessions',
      recoveryDays: 0,
      source: 'NSE historical data',
    }],
  },
  {
    scenario: 'Abqaiq / major infra hit',
    prob: 10, range: '20,000–21,500', rangeMid: 20750,
    driver: 'Oil above $130, India macro shock',
    ivEstimate: 'VIX 32–45',
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
    scenario: 'Israel assassinates Mojtaba',
    prob: 10, range: '21,000–22,500', rangeMid: 21750,
    driver: 'Iranian escalation spiral + power vacuum',
    ivEstimate: 'VIX 28–38',
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
    scenario: 'Pakistan nuclear-adjacent crisis',
    prob: 4, range: 'Sub-20,000', rangeMid: 19500,
    driver: 'Black swan — economic collapse + nuclear signaling',
    ivEstimate: 'VIX 45+',
    analogues: [{
      event: 'India-Pakistan Balakot crisis (nuclear-armed standoff)',
      date: 'Feb 26, 2019',
      oilMove: '+1.2% (secondary effect)',
      niftyMove: '-3.4% intraday on Feb 26, recovered 70% by Mar 1',
      vixMove: '+40% spike intraday',
      recoveryDays: 6,
      source: 'NSE historical data',
    }],
  },
  {
    scenario: 'US-Russia brokered deal',
    prob: 4, range: '24,800–25,500', rangeMid: 25150,
    driver: 'Trump-Putin framework, rapid de-escalation',
    ivEstimate: 'VIX 12–15 (hard crush)',
    analogues: [{
      event: 'Trump-Kim Singapore summit (de-escalation signal)',
      date: 'Jun 12, 2018',
      oilMove: '-0.8% (minimal direct impact)',
      niftyMove: '+1.2% on session, sentiment-driven',
      vixMove: '-15% in week following',
      recoveryDays: 0,
      source: 'NSE historical data',
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
