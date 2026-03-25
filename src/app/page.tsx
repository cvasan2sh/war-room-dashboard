'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardState, FeedCard, MarketData, NiftyScenario, BayesianTrailItem } from '@/lib/types';
import { createInitialState, weightedNifty, weightedOil, weightedInr, WAR_START_DATE } from '@/lib/initial-data';
import { manualProbUpdate } from '@/lib/bayesian';

const STORAGE_KEY = 'war-room-v2';
const REFRESH_INTERVAL = 4 * 60 * 60 * 1000;
const MARKET_POLL_INTERVAL = 60 * 1000;

function warDay(): number {
  return Math.floor((Date.now() - new Date(WAR_START_DATE).getTime()) / 86400000);
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function countdown(lastRefresh: string | null): string {
  if (!lastRefresh) return 'Ready';
  const diff = new Date(lastRefresh).getTime() + REFRESH_INTERVAL - Date.now();
  if (diff <= 0) return 'Due now';
  return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
}

function pct(v: number): string { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }

// Scenario probability → color
function probColor(p: number): string {
  if (p > 30) return '#22c55e';
  if (p > 15) return '#eab308';
  if (p > 7) return '#f97316';
  return '#ef4444';
}

// Simple position P&L estimator (delta-based, not Black-Scholes for MVP)
function estimatePnl(strike: number, type: 'CE' | 'PE', lots: number, premium: number, niftyTarget: number): number {
  const lotSize = 25; // Nifty lot size
  let intrinsic = 0;
  if (type === 'CE') intrinsic = Math.max(0, niftyTarget - strike);
  else intrinsic = Math.max(0, strike - niftyTarget);
  const pnlPerLot = (intrinsic - premium) * lotSize;
  return pnlPerLot * lots;
}

export default function WarRoomDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedMath, setExpandedMath] = useState<Set<string>>(new Set());
  const [editingScenario, setEditingScenario] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');
  const [expandedScenario, setExpandedScenario] = useState<number | null>(null);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [activeTab, setActiveTab] = useState<'updates' | 'scenarios' | 'simulator' | 'cpi'>('scenarios');

  // CPI state
  const [cpiData, setCpiData] = useState<{ latest: any; history: any[]; hasData: boolean } | null>(null);

  // Position simulator state
  const [positions, setPositions] = useState<Array<{ strike: number; type: 'CE' | 'PE'; lots: number; premium: number }>>([]);
  const [newPos, setNewPos] = useState({ strike: '', type: 'PE' as 'CE' | 'PE', lots: '1', premium: '' });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setState(stored ? JSON.parse(stored) : createInitialState());
    } catch { setState(createInitialState()); }
    setLoading(false);
  }, []);

  const save = useCallback((s: DashboardState) => {
    setState(s);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }, []);

  useEffect(() => {
    const handleUnload = () => {
      if (state) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, lastVisit: new Date().toISOString() })); } catch {}
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [state]);

  useEffect(() => {
    const f = async () => {
      try {
        const res = await fetch('/api/market-data');
        if (res.ok) { const d = await res.json(); if (d.nifty || d.oil) setMarketData(d); }
      } catch {}
    };
    f();
    const iv = setInterval(f, MARKET_POLL_INTERVAL);
    return () => clearInterval(iv);
  }, []);

  // Poll CPI data from Python backend
  useEffect(() => {
    const fetchCpi = async () => {
      try {
        const res = await fetch('/api/cpi-data');
        if (res.ok) { const d = await res.json(); setCpiData(d); }
      } catch {}
    };
    fetchCpi();
    const iv = setInterval(fetchCpi, 30000); // every 30s
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!state) return;
    const last = state.lastAiRefresh ? new Date(state.lastAiRefresh).getTime() : 0;
    const delay = Math.max(0, last + REFRESH_INTERVAL - Date.now());
    const t = setTimeout(() => { triggerAiRefresh(); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.lastAiRefresh]);

  const triggerAiRefresh = async () => {
    if (!state || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarios: state.scenarios, actors: state.actors, userNotes: state.userNotes,
          marketData: { nifty: marketData?.nifty || 0, oil: marketData?.oil || 0, inr: marketData?.inr || 0, vix: marketData?.vix || 0 },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        save({
          ...state,
          feedCards: [...(data.feedCards || []), ...state.feedCards].slice(0, 200),
          scenarios: data.updatedScenarios || state.scenarios,
          actors: data.updatedActors || state.actors,
          lastAiRefresh: new Date().toISOString(),
        });
      }
    } catch (e) { console.error('AI refresh failed:', e); }
    setAiLoading(false);
  };

  const handleProbEdit = (idx: number) => {
    const v = Math.max(0, Math.min(95, parseInt(editInput) || 0));
    save({ ...state!, scenarios: manualProbUpdate(state!.scenarios, idx, v) });
    setEditingScenario(null);
  };

  const toggleMath = (id: string) => {
    const next = new Set(expandedMath);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedMath(next);
  };

  const addPosition = () => {
    const strike = parseInt(newPos.strike);
    const premium = parseFloat(newPos.premium);
    const lots = parseInt(newPos.lots) || 1;
    if (!strike || !premium) return;
    setPositions([...positions, { strike, type: newPos.type, lots, premium }]);
    setNewPos({ strike: '', type: 'PE', lots: '1', premium: '' });
  };

  if (loading || !state) {
    return (
      <div className="wr-loading">
        <div className="wr-loading-text">LOADING WAR ROOM...</div>
      </div>
    );
  }

  const pw = weightedNifty(state.scenarios);
  const spot = marketData?.nifty || 0;
  const gap = spot ? pw - spot : 0;
  const gapPct = spot ? ((gap / spot) * 100) : 0;
  const lastVisitTime = state.lastVisit ? new Date(state.lastVisit) : null;
  const newCards = lastVisitTime ? state.feedCards.filter(c => new Date(c.timestamp) > lastVisitTime) : [];

  return (
    <div className="wr-app">

      {/* ═══ HERO / MARKET BAR ═══ */}
      <header className="wr-header">
        <div className="wr-header-top">
          <div className="wr-brand">
            <h1>WAR ROOM</h1>
            <span className="wr-brand-sub">Iran-US-Israel Conflict · Day {warDay()}</span>
          </div>
          <div className="wr-header-actions">
            <span className="wr-refresh-info">
              {state.lastAiRefresh ? `Updated ${timeAgo(state.lastAiRefresh)} · Next: ${countdown(state.lastAiRefresh)}` : 'Not yet refreshed'}
            </span>
            <button className="wr-btn-refresh" onClick={triggerAiRefresh} disabled={aiLoading}>
              {aiLoading ? 'Analyzing...' : 'Refresh Intel'}
            </button>
          </div>
        </div>

        {/* Market strip */}
        <div className="wr-market-strip">
          {[
            { label: 'Nifty 50', val: marketData?.nifty, chg: marketData?.niftyChangePct, fmt: (n: number) => n.toLocaleString() },
            { label: 'Brent Crude', val: marketData?.oil, chg: marketData?.oilChangePct, fmt: (n: number) => `$${n.toFixed(1)}` },
            { label: 'USD/INR', val: marketData?.inr, chg: marketData?.inrChangePct, fmt: (n: number) => n.toFixed(2) },
            { label: 'India VIX', val: marketData?.vix, chg: marketData?.vixChangePct, fmt: (n: number) => n.toFixed(1) },
          ].map(t => (
            <div key={t.label} className="wr-market-item">
              <span className="wr-market-label">{t.label}</span>
              <span className="wr-market-val">{t.val ? t.fmt(t.val) : '—'}</span>
              {t.chg != null && t.chg !== 0 && (
                <span className={`wr-market-chg ${t.chg > 0 ? 'up' : 'down'}`}>{pct(t.chg)}</span>
              )}
            </div>
          ))}
          <div className="wr-market-item highlight">
            <span className="wr-market-label" title="Probability-weighted Nifty target across all scenarios">AI Nifty</span>
            <span className="wr-market-val accent">{pw.toLocaleString()}</span>
            {spot > 0 && <span className={`wr-market-chg ${gap >= 0 ? 'up' : 'down'}`}>Gap: {gap > 0 ? '+' : ''}{gap.toFixed(0)} ({gapPct.toFixed(1)}%)</span>}
          </div>
          <div className="wr-market-item highlight">
            <span className="wr-market-label" title="Probability-weighted Oil target">AI Oil</span>
            <span className="wr-market-val accent">${weightedOil(state.scenarios)}</span>
          </div>
          <div className="wr-market-item highlight">
            <span className="wr-market-label" title="Probability-weighted INR target">AI INR</span>
            <span className="wr-market-val accent">{weightedInr(state.scenarios)}</span>
          </div>
        </div>
      </header>

      {/* ═══ DELTA CARD ═══ */}
      {newCards.length > 0 && lastVisitTime && (
        <div className="wr-delta-card">
          <strong>Since your last visit</strong> ({timeAgo(lastVisitTime.toISOString())}): {newCards.length} new update{newCards.length !== 1 ? 's' : ''}.
          AI Target Nifty: {pw.toLocaleString()}.
          {marketData && ` Oil $${marketData.oil?.toFixed(1)}. VIX ${marketData.vix?.toFixed(1)}.`}
        </div>
      )}

      {/* ═══ TAB NAVIGATION ═══ */}
      <nav className="wr-tabs">
        {[
          { id: 'cpi' as const, label: `CPI ${cpiData?.latest?.cpi_result?.zone?.emoji || '⚡'}`, count: cpiData?.latest?.cpi_result?.cpi || undefined },
          { id: 'scenarios' as const, label: 'Scenarios & Impact', count: state.scenarios.length },
          { id: 'updates' as const, label: 'Live Updates', count: state.feedCards.length },
          { id: 'simulator' as const, label: 'Position Simulator', count: positions.length || undefined },
        ].map(tab => (
          <button
            key={tab.id}
            className={`wr-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="wr-tab-badge">{tab.count}</span>}
          </button>
        ))}
        <button className={`wr-tab ${showPlayers ? 'active' : ''}`} onClick={() => setShowPlayers(!showPlayers)}>
          Key Players
        </button>
      </nav>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="wr-main">

        {/* ─── CPI TAB ─── */}
        {activeTab === 'cpi' && (
          <div className="wr-cpi-panel">
            {!cpiData?.hasData ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#8b949e' }}>
                <p style={{ fontSize: '16px', marginBottom: '12px' }}>CPI backend not running yet.</p>
                <p style={{ fontSize: '13px' }}>Run <code style={{ background: '#1c2333', padding: '2px 8px', borderRadius: '4px' }}>cd cpi &amp;&amp; python scheduler.py</code> to start collecting signals.</p>
                <p style={{ fontSize: '13px', marginTop: '8px' }}>Once running, CPI data will appear here automatically.</p>
              </div>
            ) : (() => {
              const cpi = cpiData.latest?.cpi_result || {};
              const signals = cpiData.latest?.signals || {};
              const history = cpiData.history || [];
              const score = cpi.cpi;
              const isInsufficient = score === null || score === undefined;
              const displayScore = isInsufficient ? '—' : score;
              const zone = cpi.zone || { name: 'LOADING', emoji: '⚡', color: '#8b949e' };
              const totalConf = cpi.total_confidence ?? 0;
              const overrideAlerts = cpi.override_alerts || [];
              const scenarioShifts = cpi.scenario_shifts || {};

              const cpiColor = isInsufficient ? '#5a6a8a' : score >= 86 ? '#00ff88' : score >= 71 ? '#44ff88' : score >= 51 ? '#ffdd44' : score >= 31 ? '#ff9944' : '#ff4444';
              const zoneBg = isInsufficient ? '#111827' : score >= 86 ? '#00331a' : score >= 71 ? '#0d2e1a' : score >= 51 ? '#2e2800' : score >= 31 ? '#2e1400' : '#2e0a0a';

              const signalLabels: Record<string, string> = {
                hormuz: '⚓ Hormuz Vessels', polymarket: '📈 Ceasefire Market', bonbast: '💱 Rial Rate',
              };
              const overrideLabels: Record<string, string> = {
                flightradar: '✈️ Gulf Airspace', nasa_firms: '🔥 Satellite Thermal',
              };
              const signalOrder = ['hormuz', 'polymarket', 'bonbast'];
              const getBarColor = (s: number) => s >= 70 ? '#44ff88' : s >= 50 ? '#ffdd44' : s >= 30 ? '#ff9944' : '#ff4444';
              const confColor = (c: number) => c >= 0.8 ? '#44ff88' : c >= 0.5 ? '#ffdd44' : c > 0 ? '#ff9944' : '#ff4444';

              return (
                <>
                  {/* CPI Score Hero */}
                  <div style={{ textAlign: 'center', padding: '24px 0 16px', borderBottom: '1px solid #1c2333' }}>
                    <div style={{ fontSize: '11px', color: '#8b949e', letterSpacing: '2px', marginBottom: '8px' }}>CEASEFIRE PROBABILITY INDEX</div>
                    <div style={{ fontSize: '72px', fontWeight: 900, color: cpiColor, lineHeight: 1 }}>{displayScore}</div>
                    <div style={{
                      display: 'inline-block', padding: '4px 16px', borderRadius: '20px',
                      fontSize: '12px', letterSpacing: '1px', marginTop: '10px',
                      background: zoneBg, color: cpiColor, fontWeight: 600,
                    }}>
                      {zone.emoji} {zone.name}
                    </div>
                    {/* Confidence indicator */}
                    <div style={{ fontSize: '12px', marginTop: '8px', color: confColor(totalConf) }}>
                      Signal confidence: {Math.round(totalConf * 100)}%
                      {totalConf < 0.5 && <span style={{ color: '#ff9944', marginLeft: '8px' }}>⚠️ Low — some signals have no data</span>}
                    </div>
                    {/* Gauge bar */}
                    {!isInsufficient && (
                      <div style={{ width: '80%', maxWidth: '400px', height: '8px', background: '#1c2333', borderRadius: '4px', margin: '14px auto 0', overflow: 'hidden' }}>
                        <div style={{ width: `${score}%`, height: '100%', background: cpiColor, borderRadius: '4px', transition: 'width 0.8s ease' }} />
                      </div>
                    )}
                    {/* Mini sparkline */}
                    {history.length > 1 && (
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '32px', margin: '12px auto 0', maxWidth: '400px' }}>
                        {history.slice(-28).map((h: any, i: number) => {
                          const hCpi = h.cpi ?? 0;
                          if (hCpi === 0) return <div key={i} style={{ flex: 1, height: '4px', background: '#333', borderRadius: '1px' }} title="No data" />;
                          const maxCpi = Math.max(...history.slice(-28).map((x: any) => x.cpi ?? 0).filter(Boolean), 1);
                          const pctH = Math.max(4, (hCpi / maxCpi) * 100);
                          const hColor = hCpi >= 86 ? '#00ff88' : hCpi >= 71 ? '#44ff88' : hCpi >= 51 ? '#ffdd44' : hCpi >= 31 ? '#ff9944' : '#ff4444';
                          return <div key={i} style={{ flex: 1, height: `${pctH}%`, background: hColor, opacity: 0.7, borderRadius: '1px' }} title={`CPI: ${hCpi}`} />;
                        })}
                      </div>
                    )}
                  </div>

                  {/* Weighted Signals */}
                  <div style={{ padding: '16px 0', borderBottom: '1px solid #1c2333' }}>
                    <div style={{ fontSize: '11px', color: '#8b949e', letterSpacing: '1px', marginBottom: '10px' }}>WEIGHTED SIGNALS</div>
                    {signalOrder.map(key => {
                      const sig = signals[key] || {};
                      const s = sig.score ?? 50;
                      const conf = sig.confidence ?? 0;
                      const interp = sig.interpretation || '';
                      const noData = interp.startsWith('NO DATA');
                      const barColor = noData ? '#333' : getBarColor(s);
                      const weight = key === 'hormuz' ? '35%' : key === 'polymarket' ? '35%' : '30%';
                      return (
                        <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #111827' }}>
                          <div style={{ display: 'flex', alignItems: 'center', fontSize: '13px' }}>
                            <span style={{ color: noData ? '#5a6a8a' : '#e6edf3', width: '150px', flexShrink: 0 }}>{signalLabels[key] || key}</span>
                            <div style={{ width: '100px', height: '4px', background: '#1c2333', borderRadius: '2px', overflow: 'hidden', margin: '0 10px' }}>
                              <div style={{ width: noData ? '0%' : `${s}%`, height: '100%', background: barColor, borderRadius: '2px', transition: 'width 0.6s' }} />
                            </div>
                            <span style={{ fontWeight: 700, width: '36px', textAlign: 'right', color: noData ? '#5a6a8a' : barColor }}>{noData ? '—' : s}</span>
                            <span style={{ fontSize: '10px', color: confColor(conf), marginLeft: '8px', width: '40px' }}>{noData ? 'NO DATA' : `${Math.round(conf * 100)}%`}</span>
                            <span style={{ fontSize: '10px', color: '#5a6a8a', marginLeft: '4px', width: '30px' }}>({weight})</span>
                          </div>
                          <div style={{ fontSize: '11px', color: noData ? '#ff6666' : '#5a6a8a', marginTop: '3px', paddingLeft: '150px' }}>{interp}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Binary Override Signals */}
                  <div style={{ padding: '16px 0', borderBottom: '1px solid #1c2333' }}>
                    <div style={{ fontSize: '11px', color: '#8b949e', letterSpacing: '1px', marginBottom: '10px' }}>OVERRIDE SIGNALS (SMOKE DETECTORS)</div>
                    {['flightradar', 'nasa_firms'].map(key => {
                      const sig = signals[key] || {};
                      const hasAlert = sig.alert === true;
                      const noData = sig.confidence === 0;
                      const interp = sig.interpretation || '';
                      const bgColor = hasAlert ? 'rgba(239, 68, 68, 0.1)' : noData ? 'rgba(90, 106, 138, 0.1)' : 'rgba(68, 255, 136, 0.05)';
                      const borderColor = hasAlert ? 'rgba(239, 68, 68, 0.3)' : noData ? 'rgba(90, 106, 138, 0.2)' : 'rgba(68, 255, 136, 0.15)';
                      return (
                        <div key={key} style={{ padding: '10px 14px', marginBottom: '8px', borderRadius: '8px', background: bgColor, border: `1px solid ${borderColor}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: hasAlert ? '#ff6666' : noData ? '#5a6a8a' : '#88cc88' }}>
                              {overrideLabels[key] || key}
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '10px',
                              background: hasAlert ? 'rgba(239,68,68,0.2)' : noData ? 'rgba(90,106,138,0.15)' : 'rgba(68,255,136,0.1)',
                              color: hasAlert ? '#ff6666' : noData ? '#5a6a8a' : '#88cc88',
                            }}>
                              {hasAlert ? '🚨 ALERT' : noData ? '— NO DATA' : '✓ CLEAR'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: hasAlert ? '#ff9999' : '#5a6a8a', marginTop: '4px' }}>{interp}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Scenario Probability Shifts */}
                  {Object.keys(scenarioShifts).length > 0 && (
                    <div style={{ padding: '16px 0', borderBottom: '1px solid #1c2333' }}>
                      <div style={{ fontSize: '11px', color: '#8b949e', letterSpacing: '1px', marginBottom: '10px' }}>CPI → SCENARIO SHIFTS (AUTO-BAYESIAN)</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {Object.entries(scenarioShifts).map(([key, shift]) => {
                          const s = shift as number;
                          return (
                            <div key={key} style={{
                              padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                              background: s > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(68,255,136,0.1)',
                              border: `1px solid ${s > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(68,255,136,0.2)'}`,
                              color: s > 0 ? '#ff9999' : '#88cc88',
                            }}>
                              {key.replace(/_/g, ' ')}: {s > 0 ? '+' : ''}{s}%
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Override Alerts */}
                  {overrideAlerts.filter((a: any) => a.severity === 'critical').length > 0 && (
                    <div style={{ padding: '16px 0', borderBottom: '1px solid #ff4444' }}>
                      <div style={{ fontSize: '11px', color: '#ff6666', letterSpacing: '1px', marginBottom: '8px' }}>🚨 CRITICAL ALERTS</div>
                      {overrideAlerts.filter((a: any) => a.severity === 'critical').map((a: any, i: number) => (
                        <div key={i} style={{ color: '#ff6666', fontSize: '13px', padding: '6px 0', borderBottom: '1px solid rgba(255,68,68,0.15)' }}>
                          <strong>{a.signal?.toUpperCase()}</strong>: {a.interpretation}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Last Update */}
                  <div style={{ textAlign: 'center', fontSize: '11px', color: '#5a6a8a', padding: '8px 0' }}>
                    Last update: {cpiData.latest?.timestamp ? new Date(cpiData.latest.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ─── SCENARIOS TAB ─── */}
        {activeTab === 'scenarios' && (
          <div className="wr-scenarios">
            {/* Visual probability bar */}
            <div className="wr-prob-overview">
              <div className="wr-prob-bar-container">
                {state.scenarios.map((s, i) => (
                  <div
                    key={i}
                    className="wr-prob-segment"
                    style={{ width: `${s.prob}%`, background: probColor(s.prob) }}
                    title={`${s.scenario}: ${s.prob}%`}
                    onClick={() => setExpandedScenario(expandedScenario === i ? null : i)}
                  />
                ))}
              </div>
              <div className="wr-prob-legend">
                {state.scenarios.map((s, i) => (
                  <span key={i} className="wr-legend-item" onClick={() => setExpandedScenario(expandedScenario === i ? null : i)}>
                    <span className="wr-legend-dot" style={{ background: probColor(s.prob) }} />
                    {s.scenario} <strong>{s.prob}%</strong>
                  </span>
                ))}
              </div>
            </div>

            {/* Scenario cards */}
            <div className="wr-scenario-grid">
              {state.scenarios.map((s, i) => {
                const isExpanded = expandedScenario === i;
                return (
                  <div key={i} className={`wr-scenario-card ${isExpanded ? 'expanded' : ''}`}>
                    <div className="wr-scenario-header" onClick={() => setExpandedScenario(isExpanded ? null : i)}>
                      <div className="wr-scenario-info">
                        <div className="wr-scenario-name">{s.scenario}</div>
                        <div className="wr-scenario-range">
                          Nifty {s.range}
                          {s.oilRange && <> · Oil {s.oilRange}</>}
                          {s.inrRange && <> · INR {s.inrRange}</>}
                        </div>
                      </div>
                      <div className="wr-scenario-prob-area">
                        {editingScenario === i ? (
                          <div className="wr-prob-edit" onClick={e => e.stopPropagation()}>
                            <input
                              value={editInput}
                              onChange={e => setEditInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleProbEdit(i); if (e.key === 'Escape') setEditingScenario(null); }}
                              autoFocus
                              className="wr-prob-input"
                            />
                            <button onClick={() => handleProbEdit(i)} className="wr-prob-confirm">Set</button>
                          </div>
                        ) : (
                          <span
                            className="wr-scenario-prob"
                            style={{ color: probColor(s.prob) }}
                            onClick={e => { e.stopPropagation(); setEditingScenario(i); setEditInput(String(s.prob)); }}
                            title="Click to edit probability"
                          >
                            {s.prob}%
                          </span>
                        )}
                        <div className="wr-mini-bar">
                          <div style={{ width: `${s.prob}%`, background: probColor(s.prob) }} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="wr-scenario-detail">
                        <div className="wr-scenario-driver"><strong>Driver:</strong> {s.driver}</div>

                        {/* Multi-market impact grid */}
                        <div className="wr-market-impact-grid">
                          <div className="wr-impact-item">
                            <span className="wr-impact-label">Nifty 50</span>
                            <span className="wr-impact-value">{s.range}</span>
                            <span className="wr-impact-mid">mid {s.rangeMid.toLocaleString()}</span>
                          </div>
                          {s.oilRange && (
                            <div className="wr-impact-item">
                              <span className="wr-impact-label">Brent Crude</span>
                              <span className="wr-impact-value">{s.oilRange}</span>
                              {s.oilMid && <span className="wr-impact-mid">mid ${s.oilMid}</span>}
                            </div>
                          )}
                          {s.inrRange && (
                            <div className="wr-impact-item">
                              <span className="wr-impact-label">USD/INR</span>
                              <span className="wr-impact-value">{s.inrRange}</span>
                              {s.inrMid && <span className="wr-impact-mid">mid {s.inrMid}</span>}
                            </div>
                          )}
                          <div className="wr-impact-item">
                            <span className="wr-impact-label">India VIX</span>
                            <span className="wr-impact-value">{s.ivEstimate}</span>
                          </div>
                          {s.timeHorizon && (
                            <div className="wr-impact-item">
                              <span className="wr-impact-label">Time Horizon</span>
                              <span className="wr-impact-value">{s.timeHorizon}</span>
                            </div>
                          )}
                        </div>
                        {s.status && s.status !== 'active' && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: s.status === 'emerging' ? '#44ff88' : '#ff9944', fontStyle: 'italic' }}>
                            {s.status === 'emerging' ? '🆕 EMERGING SCENARIO — recently identified by AI refresh' : '📉 FADING — scenario becoming less relevant'}
                          </div>
                        )}

                        {/* Historical precedent — always visible when expanded */}
                        {s.analogues.map((a, ai) => (
                          <div key={ai} className="wr-precedent">
                            <div className="wr-precedent-title">Historical Precedent: {a.event} ({a.date})</div>
                            <div className="wr-precedent-grid">
                              <div><span className="wr-precedent-label">Oil</span> {a.oilMove}</div>
                              <div><span className="wr-precedent-label">Nifty</span> {a.niftyMove}</div>
                              <div><span className="wr-precedent-label">VIX</span> {a.vixMove}</div>
                              <div><span className="wr-precedent-label">Recovery</span> {a.recoveryDays} sessions</div>
                            </div>
                            <div className="wr-precedent-source">Source: {a.source}</div>
                          </div>
                        ))}

                        {/* P&L preview if positions exist */}
                        {positions.length > 0 && (
                          <div className="wr-scenario-pnl">
                            <div className="wr-pnl-title">Your position P&L at Nifty {s.rangeMid.toLocaleString()}:</div>
                            {positions.map((p, pi) => {
                              const pnl = estimatePnl(p.strike, p.type, p.lots, p.premium, s.rangeMid);
                              return (
                                <span key={pi} className={`wr-pnl-value ${pnl >= 0 ? 'profit' : 'loss'}`}>
                                  {p.lots}x {p.strike}{p.type}: {pnl >= 0 ? '+' : ''}{(pnl / 1000).toFixed(1)}K
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="wr-hint">Click any scenario to see details. Click the % to edit probabilities — they auto-redistribute to 100%.</p>
          </div>
        )}

        {/* ─── LIVE UPDATES TAB ─── */}
        {activeTab === 'updates' && (
          <div className="wr-updates">
            {state.feedCards.length === 0 ? (
              <div className="wr-empty">
                <div className="wr-empty-icon">📡</div>
                <h3>No intelligence yet</h3>
                <p>Click <strong>Refresh Intel</strong> above to run the first AI analysis. The system will scan recent news, classify evidence, and update scenario probabilities.</p>
              </div>
            ) : (
              state.feedCards.map(card => (
                <div key={card.id} className="wr-update-card" style={{ borderLeftColor: card.type === 'EVIDENCE' ? '#22c55e' : card.type === 'ANALYSIS' ? '#a78bfa' : card.type === 'ACTOR_UPDATE' ? '#eab308' : '#8b949e' }}>
                  <div className="wr-update-meta">
                    <span className="wr-update-type">{card.type === 'EVIDENCE' ? 'Intel' : card.type === 'ACTOR_UPDATE' ? 'Player Update' : card.type === 'ANALYSIS' ? 'Analysis' : 'System'}</span>
                    {card.classification && (
                      <span className={`wr-update-badge ${card.classification.toLowerCase()}`}>{card.classification}</span>
                    )}
                    <span className="wr-update-time">{timeAgo(card.timestamp)}</span>
                  </div>
                  <h4 className="wr-update-title">{card.title}</h4>
                  <p className="wr-update-body">{card.body}</p>

                  {card.source && (
                    <div className="wr-update-source">
                      Source: {card.source}
                      {card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer"> ↗</a>}
                    </div>
                  )}

                  {card.scenarioImpact && card.scenarioImpact.posterior > 0 && (
                    <div className="wr-update-impact">
                      <span>{card.scenarioImpact.scenario}:</span>
                      <span className="wr-impact-shift">
                        {card.scenarioImpact.prior}% → <strong style={{ color: card.scenarioImpact.posterior > card.scenarioImpact.prior ? '#ef4444' : '#22c55e' }}>{card.scenarioImpact.posterior}%</strong>
                      </span>
                      <span className="wr-impact-lr">(LR: {card.scenarioImpact.likelihoodRatio}x)</span>

                      {card.bayesianTrail && card.bayesianTrail.length > 0 && (
                        <>
                          <button className="wr-math-toggle" onClick={() => toggleMath(card.id)}>
                            {expandedMath.has(card.id) ? 'Hide math' : 'Show probability math'}
                          </button>
                          {expandedMath.has(card.id) && <BayesianMathView trail={card.bayesianTrail} prior={card.scenarioImpact.prior} posterior={card.scenarioImpact.posterior} />}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ─── POSITION SIMULATOR TAB ─── */}
        {activeTab === 'simulator' && (
          <div className="wr-simulator">
            <div className="wr-sim-intro">
              <h3>Position Simulator</h3>
              <p>Enter your Nifty options positions to see estimated P&L under each war scenario. Uses intrinsic value calculation against scenario midpoints.</p>
            </div>

            <div className="wr-sim-form">
              <input
                type="number"
                placeholder="Strike (e.g. 23000)"
                value={newPos.strike}
                onChange={e => setNewPos({ ...newPos, strike: e.target.value })}
                className="wr-sim-input"
              />
              <select value={newPos.type} onChange={e => setNewPos({ ...newPos, type: e.target.value as 'CE' | 'PE' })} className="wr-sim-select">
                <option value="PE">PUT (PE)</option>
                <option value="CE">CALL (CE)</option>
              </select>
              <input
                type="number"
                placeholder="Lots"
                value={newPos.lots}
                onChange={e => setNewPos({ ...newPos, lots: e.target.value })}
                className="wr-sim-input small"
              />
              <input
                type="number"
                placeholder="Premium paid"
                value={newPos.premium}
                onChange={e => setNewPos({ ...newPos, premium: e.target.value })}
                className="wr-sim-input"
              />
              <button onClick={addPosition} className="wr-btn-add">Add Position</button>
            </div>

            {positions.length > 0 && (
              <>
                <div className="wr-sim-positions">
                  {positions.map((p, i) => (
                    <span key={i} className="wr-pos-tag">
                      {p.lots}x {p.strike} {p.type} @ {p.premium}
                      <button onClick={() => setPositions(positions.filter((_, j) => j !== i))} className="wr-pos-remove">×</button>
                    </span>
                  ))}
                  <button onClick={() => setPositions([])} className="wr-btn-clear">Clear all</button>
                </div>

                <div className="wr-sim-results">
                  <table className="wr-sim-table">
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Probability</th>
                        <th>Nifty Target</th>
                        {positions.map((p, i) => <th key={i}>{p.lots}x {p.strike}{p.type}</th>)}
                        <th>Total P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.scenarios.map((s, si) => {
                        const pnls = positions.map(p => estimatePnl(p.strike, p.type, p.lots, p.premium, s.rangeMid));
                        const total = pnls.reduce((a, b) => a + b, 0);
                        return (
                          <tr key={si}>
                            <td className="wr-sim-scenario">{s.scenario}</td>
                            <td style={{ color: probColor(s.prob) }}>{s.prob}%</td>
                            <td>{s.rangeMid.toLocaleString()}</td>
                            {pnls.map((pnl, pi) => (
                              <td key={pi} className={pnl >= 0 ? 'profit' : 'loss'}>
                                {pnl >= 0 ? '+' : ''}{(pnl / 1000).toFixed(1)}K
                              </td>
                            ))}
                            <td className={`wr-sim-total ${total >= 0 ? 'profit' : 'loss'}`}>
                              {total >= 0 ? '+' : ''}{(total / 1000).toFixed(1)}K
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="wr-sim-expected">
                        <td><strong>Expected (probability-weighted)</strong></td>
                        <td>100%</td>
                        <td>{pw.toLocaleString()}</td>
                        {positions.map((p, pi) => {
                          const expected = state.scenarios.reduce((sum, s) => sum + estimatePnl(p.strike, p.type, p.lots, p.premium, s.rangeMid) * s.prob / 100, 0);
                          return <td key={pi} className={expected >= 0 ? 'profit' : 'loss'}>{expected >= 0 ? '+' : ''}{(expected / 1000).toFixed(1)}K</td>;
                        })}
                        <td className={`wr-sim-total ${state.scenarios.reduce((sum, s) => sum + positions.reduce((ps, p) => ps + estimatePnl(p.strike, p.type, p.lots, p.premium, s.rangeMid), 0) * s.prob / 100, 0) >= 0 ? 'profit' : 'loss'}`}>
                          <strong>
                            {(() => {
                              const ev = state.scenarios.reduce((sum, s) => sum + positions.reduce((ps, p) => ps + estimatePnl(p.strike, p.type, p.lots, p.premium, s.rangeMid), 0) * s.prob / 100, 0);
                              return `${ev >= 0 ? '+' : ''}${(ev / 1000).toFixed(1)}K`;
                            })()}
                          </strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {positions.length === 0 && (
              <div className="wr-sim-empty">
                <p>Add your Nifty options positions above to see how each war scenario affects your P&L.</p>
                <p className="wr-hint">Example: If you hold 2 lots of 23000 PE bought at premium 200, enter Strike: 23000, PUT, Lots: 2, Premium: 200</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ═══ KEY PLAYERS DRAWER ═══ */}
      {showPlayers && (
        <div className="wr-players-drawer">
          <div className="wr-players-header">
            <h3>Key Players</h3>
            <button onClick={() => setShowPlayers(false)} className="wr-drawer-close">×</button>
          </div>
          <div className="wr-players-grid">
            {state.actors.map(a => (
              <div key={a.id} className="wr-player-card">
                <div className="wr-player-top">
                  <span className="wr-player-flag">{a.flag}</span>
                  <span className="wr-player-name">{a.name}</span>
                  <span className="wr-player-status" style={{ color: a.statusColor, borderColor: a.statusColor }}>
                    {a.status}
                  </span>
                </div>
                {a.latestDevelopment ? (
                  <div className="wr-player-latest">{a.latestDevelopment} <span className="wr-player-source">— {a.latestDevSource}</span></div>
                ) : (
                  <div className="wr-player-objective">{a.objective}</div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setShowNotes(!showNotes)} className="wr-notes-toggle">
            {showNotes ? '▼ My Notes' : '▶ My Notes'}
          </button>
          {showNotes && (
            <textarea
              value={state.userNotes}
              onChange={e => save({ ...state, userNotes: e.target.value })}
              placeholder="Paste news links, your analysis, anything..."
              className="wr-notes-area"
            />
          )}
        </div>
      )}

      {/* ═══ FOOTER DISCLAIMER ═══ */}
      <footer className="wr-footer">
        Factual intelligence only. Not investment advice. Probabilities are Bayesian estimates with auditable math. Sources linked. Not SEBI registered.
      </footer>

      <style>{styles}</style>
    </div>
  );
}

function BayesianMathView({ trail, prior, posterior }: { trail: BayesianTrailItem[]; prior: number; posterior: number }) {
  const priorOdds = prior / (100 - prior || 1);
  return (
    <div className="wr-math-detail">
      <div className="wr-math-title">Probability Math (Bayesian Update)</div>
      <div className="wr-math-line">Starting probability: {prior}% (odds: {priorOdds.toFixed(2)})</div>
      {trail.map((t, i) => (
        <div key={i} className="wr-math-step">
          <div className="wr-math-evidence">
            <span style={{ color: t.direction === '+' ? '#ef4444' : '#22c55e', fontWeight: 700 }}>[{t.direction}]</span> {t.evidence}
          </div>
          <div className="wr-math-meta">{t.classification} · {t.source} · Likelihood Ratio: {t.likelihoodRatio}x</div>
          <div className="wr-math-reasoning">{t.reasoning}</div>
          <div className="wr-math-odds">Odds: {t.priorOdds} → {t.posteriorOdds}</div>
        </div>
      ))}
      <div className="wr-math-result">Final probability: {posterior}%</div>
    </div>
  );
}

// ═══ STYLES ═══
const styles = `
  /* Reset & Base */
  .wr-app {
    min-height: 100vh;
    background: #0a0e17;
    color: #c8cdd5;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    font-size: 15px;
    line-height: 1.6;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 16px;
  }

  /* Loading */
  .wr-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0a0e17; }
  .wr-loading-text { color: #22c55e; font-size: 16px; letter-spacing: 3px; font-family: 'IBM Plex Mono', monospace; }

  /* Header */
  .wr-header {
    padding: 20px 0 12px;
    border-bottom: 1px solid #1c2333;
    position: sticky;
    top: 0;
    background: #0a0e17;
    z-index: 50;
  }
  .wr-header-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
  .wr-brand h1 { margin: 0; font-size: 22px; color: #22c55e; font-family: 'IBM Plex Mono', monospace; font-weight: 700; letter-spacing: 3px; }
  .wr-brand-sub { font-size: 13px; color: #8b949e; }
  .wr-header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .wr-refresh-info { font-size: 12px; color: #8b949e; }
  .wr-btn-refresh {
    background: #1a3a28; border: 1px solid #22c55e; color: #22c55e;
    padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
    font-family: inherit; transition: all 0.2s;
  }
  .wr-btn-refresh:hover { background: #22c55e; color: #0a0e17; }
  .wr-btn-refresh:disabled { opacity: 0.5; cursor: default; background: #1a3a28; color: #22c55e; }

  /* Market Strip */
  .wr-market-strip {
    display: flex; gap: 6px; flex-wrap: wrap; align-items: stretch;
  }
  .wr-market-item {
    background: #111827; border: 1px solid #1c2333; border-radius: 6px;
    padding: 6px 14px; display: flex; flex-direction: column; align-items: center; min-width: 90px;
  }
  .wr-market-item.highlight { background: #112a1a; border-color: #22c55e; }
  .wr-market-label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
  .wr-market-val { font-size: 18px; font-weight: 700; color: #e6edf3; font-family: 'IBM Plex Mono', monospace; }
  .wr-market-val.accent { color: #22c55e; }
  .wr-market-chg { font-size: 12px; font-family: 'IBM Plex Mono', monospace; }
  .wr-market-chg.up { color: #22c55e; }
  .wr-market-chg.down { color: #ef4444; }

  /* Delta Card */
  .wr-delta-card {
    background: #1a1535; border: 1px solid #a78bfa; border-radius: 8px;
    padding: 12px 16px; margin: 14px 0; font-size: 14px; color: #d4d4ea; line-height: 1.6;
  }
  .wr-delta-card strong { color: #a78bfa; }

  /* Tabs */
  .wr-tabs {
    display: flex; gap: 4px; border-bottom: 1px solid #1c2333; padding: 8px 0; margin-bottom: 16px;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .wr-tab {
    background: transparent; border: 1px solid transparent; color: #8b949e;
    padding: 10px 18px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 14px;
    font-family: inherit; font-weight: 500; white-space: nowrap; transition: all 0.15s;
  }
  .wr-tab:hover { color: #c8cdd5; background: #111827; }
  .wr-tab.active { color: #e6edf3; background: #111827; border-color: #1c2333; border-bottom-color: #111827; font-weight: 600; }
  .wr-tab-badge {
    background: #1c2333; color: #8b949e; font-size: 12px; padding: 1px 7px;
    border-radius: 10px; margin-left: 6px; font-weight: 600;
  }

  /* Main */
  .wr-main { min-height: 50vh; }

  /* Probability Overview */
  .wr-prob-overview { margin-bottom: 20px; }
  .wr-prob-bar-container {
    display: flex; height: 28px; border-radius: 6px; overflow: hidden; gap: 2px;
    background: #111827; margin-bottom: 10px;
  }
  .wr-prob-segment { cursor: pointer; transition: opacity 0.2s; min-width: 3px; }
  .wr-prob-segment:hover { opacity: 0.8; }
  .wr-prob-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .wr-legend-item { font-size: 13px; color: #8b949e; cursor: pointer; display: flex; align-items: center; gap: 5px; }
  .wr-legend-item:hover { color: #c8cdd5; }
  .wr-legend-item strong { color: #e6edf3; }
  .wr-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* Scenario Grid */
  .wr-scenario-grid { display: flex; flex-direction: column; gap: 8px; }
  .wr-scenario-card {
    background: #111827; border: 1px solid #1c2333; border-radius: 8px;
    transition: all 0.2s; overflow: hidden;
  }
  .wr-scenario-card.expanded { border-color: #2d3f5f; }
  .wr-scenario-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 16px; cursor: pointer; gap: 16px;
  }
  .wr-scenario-header:hover { background: #151d2e; }
  .wr-scenario-info { flex: 1; }
  .wr-scenario-name { font-size: 15px; font-weight: 600; color: #e6edf3; }
  .wr-scenario-range { font-size: 13px; color: #8b949e; margin-top: 2px; }
  .wr-scenario-prob-area { text-align: right; min-width: 70px; }
  .wr-scenario-prob {
    font-size: 24px; font-weight: 700; cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
  }
  .wr-scenario-prob:hover { text-decoration: underline; }
  .wr-mini-bar { height: 4px; background: #1c2333; border-radius: 2px; margin-top: 4px; overflow: hidden; }
  .wr-mini-bar > div { height: 100%; border-radius: 2px; transition: width 0.3s; }
  .wr-prob-edit { display: flex; gap: 4px; align-items: center; }
  .wr-prob-input {
    width: 50px; background: #0a0e17; border: 1px solid #22c55e; color: #22c55e;
    border-radius: 4px; padding: 4px 6px; font-size: 16px; font-family: 'IBM Plex Mono', monospace;
    text-align: right;
  }
  .wr-prob-confirm {
    background: #1a3a28; border: 1px solid #22c55e; color: #22c55e;
    padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; font-family: inherit;
  }

  /* Scenario Detail (expanded) */
  .wr-scenario-detail { padding: 0 16px 16px; border-top: 1px solid #1c2333; }
  .wr-scenario-driver { font-size: 14px; color: #b0b8c4; margin-top: 12px; }
  .wr-market-impact-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px; margin-top: 12px;
  }
  .wr-impact-item {
    background: #0d1420; border: 1px solid #1c2333; border-radius: 6px;
    padding: 8px 10px; text-align: center;
  }
  .wr-impact-label { display: block; font-size: 10px; color: #5a6a8a; letter-spacing: 0.5px; }
  .wr-impact-value { display: block; font-size: 14px; font-weight: 700; color: #e6edf3; margin: 2px 0; }
  .wr-impact-mid { display: block; font-size: 11px; color: #8b949e; }
  .wr-precedent {
    background: #0d1420; border: 1px solid #1c2333; border-radius: 6px;
    padding: 12px; margin-top: 10px;
  }
  .wr-precedent-title { font-size: 13px; font-weight: 600; color: #06b6d4; margin-bottom: 8px; }
  .wr-precedent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 13px; color: #b0b8c4; }
  .wr-precedent-label { color: #8b949e; font-size: 12px; display: block; }
  .wr-precedent-source { font-size: 12px; color: #8b949e; margin-top: 6px; }

  .wr-scenario-pnl { background: #0d1420; border: 1px solid #1c2333; border-radius: 6px; padding: 10px 12px; margin-top: 10px; }
  .wr-pnl-title { font-size: 12px; color: #8b949e; margin-bottom: 6px; }
  .wr-pnl-value { font-size: 14px; font-weight: 600; margin-right: 12px; font-family: 'IBM Plex Mono', monospace; }
  .wr-pnl-value.profit { color: #22c55e; }
  .wr-pnl-value.loss { color: #ef4444; }

  .wr-hint { font-size: 13px; color: #8b949e; margin-top: 12px; }

  /* Updates */
  .wr-updates { display: flex; flex-direction: column; gap: 8px; }
  .wr-empty { text-align: center; padding: 60px 20px; }
  .wr-empty-icon { font-size: 40px; margin-bottom: 12px; }
  .wr-empty h3 { color: #e6edf3; margin: 0 0 8px; }
  .wr-empty p { color: #8b949e; max-width: 400px; margin: 0 auto; font-size: 14px; }

  .wr-update-card {
    background: #111827; border: 1px solid #1c2333; border-left: 3px solid #8b949e;
    border-radius: 8px; padding: 14px 16px;
  }
  .wr-update-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .wr-update-type { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
  .wr-update-badge {
    font-size: 12px; padding: 1px 7px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px;
  }
  .wr-update-badge.fact { background: #052e16; color: #22c55e; }
  .wr-update-badge.reported { background: #2d2204; color: #eab308; }
  .wr-update-badge.derived { background: #1a1035; color: #a78bfa; }
  .wr-update-time { font-size: 12px; color: #8b949e; margin-left: auto; }
  .wr-update-title { font-size: 16px; color: #e6edf3; font-weight: 600; margin: 0 0 6px; line-height: 1.4; }
  .wr-update-body { font-size: 14px; color: #b0b8c4; margin: 0 0 8px; line-height: 1.6; }
  .wr-update-source { font-size: 12px; color: #8b949e; }
  .wr-update-source a { color: #22c55e; }

  .wr-update-impact {
    background: #0d1420; border: 1px solid #1c2333; border-radius: 6px;
    padding: 10px 12px; margin-top: 10px; font-size: 13px; color: #b0b8c4;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  }
  .wr-impact-shift { font-family: 'IBM Plex Mono', monospace; }
  .wr-impact-lr { color: #8b949e; }
  .wr-math-toggle {
    background: transparent; border: none; color: #a78bfa; cursor: pointer;
    font-size: 12px; font-family: inherit; padding: 0; font-weight: 600;
  }
  .wr-math-toggle:hover { text-decoration: underline; }

  /* Bayesian Math */
  .wr-math-detail {
    background: #080c14; border: 1px solid #1c2333; border-radius: 6px;
    padding: 12px; margin-top: 8px; width: 100%;
  }
  .wr-math-title { font-size: 12px; color: #a78bfa; font-weight: 600; letter-spacing: 1px; margin-bottom: 8px; }
  .wr-math-line { font-size: 13px; color: #8b949e; margin-bottom: 8px; }
  .wr-math-step { padding: 6px 0; border-bottom: 1px solid #1c2333; }
  .wr-math-step:last-of-type { border-bottom: none; }
  .wr-math-evidence { font-size: 13px; color: #b0b8c4; }
  .wr-math-meta { font-size: 12px; color: #8b949e; margin-top: 2px; }
  .wr-math-reasoning { font-size: 12px; color: #8b949e; }
  .wr-math-odds { font-size: 12px; color: #8b949e; font-family: 'IBM Plex Mono', monospace; }
  .wr-math-result { font-size: 14px; color: #a78bfa; font-weight: 700; margin-top: 8px; }

  /* Position Simulator */
  .wr-simulator { max-width: 900px; }
  .wr-sim-intro h3 { color: #e6edf3; margin: 0 0 6px; }
  .wr-sim-intro p { color: #8b949e; font-size: 14px; margin: 0 0 16px; }
  .wr-sim-form {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    margin-bottom: 16px;
  }
  .wr-sim-input {
    background: #111827; border: 1px solid #1c2333; color: #e6edf3;
    padding: 10px 12px; border-radius: 6px; font-size: 15px; font-family: inherit;
    width: 140px;
  }
  .wr-sim-input.small { width: 70px; }
  .wr-sim-input:focus { border-color: #22c55e; outline: none; }
  .wr-sim-select {
    background: #111827; border: 1px solid #1c2333; color: #e6edf3;
    padding: 10px 12px; border-radius: 6px; font-size: 15px; font-family: inherit;
  }
  .wr-btn-add {
    background: #1a3a28; border: 1px solid #22c55e; color: #22c55e;
    padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
    font-family: inherit;
  }
  .wr-btn-add:hover { background: #22c55e; color: #0a0e17; }
  .wr-sim-positions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; align-items: center; }
  .wr-pos-tag {
    background: #1c2333; color: #b0b8c4; padding: 4px 10px; border-radius: 20px;
    font-size: 13px; display: flex; align-items: center; gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
  }
  .wr-pos-remove { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px; padding: 0 2px; }
  .wr-btn-clear { background: none; border: none; color: #8b949e; cursor: pointer; font-size: 12px; }
  .wr-btn-clear:hover { color: #ef4444; }

  /* Sim Table */
  .wr-sim-results { overflow-x: auto; }
  .wr-sim-table {
    width: 100%; border-collapse: collapse; font-size: 14px;
    font-family: 'IBM Plex Mono', monospace;
  }
  .wr-sim-table th {
    text-align: left; padding: 10px 12px; color: #8b949e; font-size: 12px;
    border-bottom: 1px solid #1c2333; font-weight: 600; white-space: nowrap;
  }
  .wr-sim-table td { padding: 10px 12px; border-bottom: 1px solid #111827; color: #b0b8c4; }
  .wr-sim-table .profit { color: #22c55e; font-weight: 600; }
  .wr-sim-table .loss { color: #ef4444; font-weight: 600; }
  .wr-sim-scenario { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #e6edf3; }
  .wr-sim-total { font-weight: 700; }
  .wr-sim-expected { background: #111827; }
  .wr-sim-expected td { border-bottom: none; }
  .wr-sim-empty { padding: 30px 0; }
  .wr-sim-empty p { color: #8b949e; font-size: 14px; }

  /* Players Drawer */
  .wr-players-drawer {
    position: fixed; top: 0; right: 0; width: min(420px, 90vw); height: 100vh;
    background: #0d1117; border-left: 1px solid #1c2333;
    overflow-y: auto; padding: 20px; z-index: 100;
    box-shadow: -10px 0 30px rgba(0,0,0,0.5);
    animation: slideIn 0.2s ease;
  }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .wr-players-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .wr-players-header h3 { color: #e6edf3; margin: 0; }
  .wr-drawer-close { background: none; border: none; color: #8b949e; font-size: 24px; cursor: pointer; }
  .wr-players-grid { display: flex; flex-direction: column; gap: 8px; }
  .wr-player-card { background: #111827; border: 1px solid #1c2333; border-radius: 8px; padding: 12px; }
  .wr-player-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .wr-player-flag { font-size: 18px; }
  .wr-player-name { font-size: 14px; font-weight: 600; color: #e6edf3; }
  .wr-player-status { font-size: 12px; border: 1px solid; padding: 1px 6px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; margin-left: auto; }
  .wr-player-latest { font-size: 13px; color: #eab308; line-height: 1.5; }
  .wr-player-source { color: #8b949e; }
  .wr-player-objective { font-size: 13px; color: #8b949e; line-height: 1.5; }
  .wr-notes-toggle {
    width: 100%; margin-top: 12px; background: transparent;
    border: 1px solid #1c2333; color: #8b949e; padding: 8px;
    border-radius: 6px; cursor: pointer; font-size: 13px; font-family: inherit;
  }
  .wr-notes-area {
    width: 100%; min-height: 120px; margin-top: 8px; background: #111827;
    border: 1px solid #1c2333; border-radius: 6px; padding: 10px;
    color: #b0b8c4; font-size: 14px; font-family: inherit; line-height: 1.6; resize: vertical;
  }

  /* CPI Panel */
  .wr-cpi-panel {
    background: #0d1117;
    border: 1px solid #1c2333;
    border-radius: 10px;
    padding: 0 20px 20px;
    font-family: 'SF Mono', 'Fira Code', 'IBM Plex Mono', monospace;
  }

  /* Footer */
  .wr-footer {
    text-align: center; padding: 20px; font-size: 12px; color: #8b949e;
    border-top: 1px solid #1c2333; margin-top: 30px;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .wr-app { padding: 0 10px; }
    .wr-brand h1 { font-size: 18px; }
    .wr-market-strip { gap: 4px; }
    .wr-market-item { padding: 4px 8px; min-width: 70px; }
    .wr-market-val { font-size: 15px; }
    .wr-market-label { font-size: 12px; }
    .wr-scenario-prob { font-size: 20px; }
    .wr-tabs { gap: 2px; }
    .wr-tab { padding: 8px 12px; font-size: 13px; }
    .wr-sim-form { flex-direction: column; align-items: stretch; }
    .wr-sim-input, .wr-sim-select, .wr-btn-add { width: 100%; }
    .wr-sim-input.small { width: 100%; }
    .wr-precedent-grid { grid-template-columns: 1fr; }
  }
`;
