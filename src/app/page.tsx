'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardState, FeedCard, MarketData, BayesianTrailItem } from '@/lib/types';
import { createInitialState, weightedNifty, WAR_START_DATE } from '@/lib/initial-data';
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

function dc(val: number): string {
  return val > 0 ? '#4ade80' : val < 0 ? '#ef4444' : '#6b7280';
}

function fcBorder(type: string): string {
  const m: Record<string, string> = { EVIDENCE: '#4ade80', MARKET: '#06b6d4', ANALYSIS: '#a78bfa', ACTOR_UPDATE: '#eab308', SYSTEM: '#374151' };
  return m[type] || '#374151';
}

export default function WarRoomDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedMath, setExpandedMath] = useState<Set<string>>(new Set());
  const [editingScenario, setEditingScenario] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [expandedAnalogue, setExpandedAnalogue] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'feed' | 'scenarios' | 'actors'>('feed');
  const feedRef = useRef<HTMLDivElement>(null);

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

  if (loading || !state) {
    return (
      <div style={{ background: '#080c14', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#4ade80', fontSize: 14, letterSpacing: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
          INITIALIZING WAR ROOM...
        </div>
      </div>
    );
  }

  const pw = weightedNifty(state.scenarios);
  const spot = marketData?.nifty || 0;
  const gap = spot ? pw - spot : 0;
  const gapPct = spot ? ((gap / spot) * 100).toFixed(1) : '0';
  const lastVisitTime = state.lastVisit ? new Date(state.lastVisit) : null;
  const newCards = lastVisitTime ? state.feedCards.filter(c => new Date(c.timestamp) > lastVisitTime) : [];

  return (
    <div style={{ background: '#080c14', minHeight: '100vh', fontFamily: "'IBM Plex Mono', monospace" }}>

      {/* ═══ COMMAND BAR ═══ */}
      <div style={{
        borderBottom: '1px solid #1e3a2f', padding: '12px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 10, position: 'sticky', top: 0, background: '#080c14', zIndex: 50,
      }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ color: '#4ade80', fontSize: 16, letterSpacing: 3, fontWeight: 700 }}>◆ WAR ROOM</div>
          <div style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>
            Day {warDay()} · Next: {countdown(state.lastAiRefresh)}
            {state.lastAiRefresh && ` · Last: ${timeAgo(state.lastAiRefresh)}`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { l: 'NIFTY', v: marketData?.nifty, c: marketData?.niftyChangePct, f: (n: number) => n.toLocaleString() },
            { l: 'BRENT', v: marketData?.oil, c: marketData?.oilChangePct, f: (n: number) => `$${n}` },
            { l: 'INR', v: marketData?.inr, c: marketData?.inrChangePct, f: (n: number) => n.toFixed(2) },
            { l: 'VIX', v: marketData?.vix, c: marketData?.vixChangePct, f: (n: number) => n.toFixed(1) },
          ].map(t => (
            <div key={t.l} style={{
              background: '#0d1117', border: '1px solid #1e3a2f', borderRadius: 4,
              padding: '5px 12px', textAlign: 'center', minWidth: 80,
            }}>
              <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: 2 }}>{t.l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.v ? '#e6edf3' : '#374151' }}>
                {t.v ? t.f(t.v) : '—'}
              </div>
              {t.c != null && t.c !== 0 && (
                <div style={{ fontSize: 11, color: dc(t.c) }}>
                  {t.c > 0 ? '↑' : '↓'}{Math.abs(t.c).toFixed(1)}%
                </div>
              )}
            </div>
          ))}

          <div style={{
            background: '#112a1a', border: '1px solid #4ade80', borderRadius: 4,
            padding: '5px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: 2 }}>P-WEIGHT</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>{pw.toLocaleString()}</div>
            {spot > 0 && <div style={{ fontSize: 11, color: dc(gap) }}>GAP {gap > 0 ? '+' : ''}{gap.toFixed(0)}</div>}
          </div>

          <button onClick={triggerAiRefresh} disabled={aiLoading} style={{
            background: aiLoading ? '#0d1117' : '#112a1a',
            border: `1px solid ${aiLoading ? '#374151' : '#a78bfa'}`,
            color: aiLoading ? '#6b7280' : '#a78bfa',
            padding: '8px 16px', borderRadius: 4, cursor: aiLoading ? 'default' : 'pointer',
            fontSize: 12, letterSpacing: 2, fontFamily: 'inherit', fontWeight: 600,
          }}>
            {aiLoading ? '◌ RUNNING...' : '⚡ REFRESH'}
          </button>
        </div>
      </div>

      {/* ═══ MOBILE TABS ═══ */}
      <div className="mobile-tabs" style={{
        display: 'none', padding: '8px 16px', gap: 6, borderBottom: '1px solid #1e3a2f',
      }}>
        {(['feed', 'scenarios', 'actors'] as const).map(p => (
          <button key={p} onClick={() => setMobilePanel(p)} style={{
            flex: 1, background: mobilePanel === p ? '#112a1a' : 'transparent',
            border: `1px solid ${mobilePanel === p ? '#4ade80' : '#1e3a2f'}`,
            color: mobilePanel === p ? '#4ade80' : '#6b7280',
            padding: '8px', borderRadius: 4, fontSize: 12, letterSpacing: 1,
            textTransform: 'uppercase', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600,
          }}>{p}</button>
        ))}
      </div>

      {/* ═══ THREE-PANEL LAYOUT ═══ */}
      <div className="main-grid" style={{
        display: 'grid', gridTemplateColumns: '240px 1fr 320px',
        height: 'calc(100vh - 70px)', overflow: 'hidden',
      }}>

        {/* ─── LEFT: Actors ─── */}
        <div className="panel-left" style={{
          borderRight: '1px solid #1e3a2f', overflowY: 'auto', padding: '12px 10px',
        }}>
          <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>ACTORS ({state.actors.length})</div>
          {state.actors.map(a => (
            <div key={a.id} style={{
              background: '#0a0f1a', border: '1px solid #1e3a2f', borderRadius: 5,
              padding: '8px 10px', marginBottom: 6,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 14 }}>{a.flag}</span>
                <span style={{ fontSize: 9, color: a.statusColor, border: `1px solid ${a.statusColor}`, padding: '1px 5px', borderRadius: 3, letterSpacing: 1, fontWeight: 600 }}>
                  {a.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>{a.name}</div>
              {a.latestDevelopment ? (
                <div style={{ fontSize: 10, color: '#eab308', marginTop: 4, lineHeight: 1.5 }}>
                  {a.latestDevelopment}
                  <span style={{ color: '#4b5563' }}> — {a.latestDevSource}</span>
                </div>
              ) : (
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4, lineHeight: 1.4 }}>{a.objective.slice(0, 60)}...</div>
              )}
            </div>
          ))}

          <button onClick={() => setShowNotes(!showNotes)} style={{
            width: '100%', marginTop: 10, background: 'transparent',
            border: '1px solid #1e3a2f', color: '#6b7280', padding: '6px',
            borderRadius: 4, fontSize: 11, letterSpacing: 2, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {showNotes ? '▼ NOTES' : '▶ NOTES'}
          </button>
          {showNotes && (
            <textarea value={state.userNotes} onChange={e => save({ ...state, userNotes: e.target.value })}
              placeholder="Paste news, intel..."
              style={{
                width: '100%', minHeight: 120, marginTop: 6, background: '#0d1117',
                border: '1px solid #1e3a2f', borderRadius: 4, padding: 8,
                color: '#c9d1d9', fontSize: 11, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical',
              }} />
          )}
        </div>

        {/* ─── CENTER: Intelligence Feed ─── */}
        <div ref={feedRef} className="panel-center" style={{
          overflowY: 'auto', padding: '12px 18px', borderRight: '1px solid #1e3a2f',
        }}>
          {/* Delta card */}
          {newCards.length > 0 && lastVisitTime && (
            <div style={{
              background: '#0d1020', border: '1px solid #a78bfa', borderRadius: 6,
              padding: '10px 14px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, color: '#a78bfa', letterSpacing: 2, marginBottom: 5, fontWeight: 600 }}>
                SINCE LAST VISIT ({timeAgo(lastVisitTime.toISOString())})
              </div>
              <div style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.5 }}>
                {newCards.length} update{newCards.length !== 1 ? 's' : ''}.
                P-weighted Nifty: {pw.toLocaleString()}.
                {marketData && ` Oil $${marketData.oil}. VIX ${marketData.vix?.toFixed(1) || '?'}.`}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>
            INTELLIGENCE FEED
            <span style={{ color: '#4b5563', marginLeft: 8, fontWeight: 400 }}>{state.feedCards.length} entries</span>
          </div>

          {state.feedCards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4b5563' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>◇</div>
              <div style={{ fontSize: 14 }}>No intelligence yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Click ⚡ REFRESH to run the first analysis.</div>
            </div>
          )}

          {state.feedCards.map(card => (
            <div key={card.id} style={{
              background: '#0d1117', borderRadius: 5,
              borderLeft: `3px solid ${fcBorder(card.type)}`,
              padding: '10px 14px', marginBottom: 8, animation: 'slide-in 0.3s ease',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: fcBorder(card.type), letterSpacing: 1, fontWeight: 600 }}>{card.type.replace('_', ' ')}</span>
                  {card.classification && (
                    <span style={{
                      fontSize: 9, letterSpacing: 1, padding: '1px 6px',
                      border: `1px solid ${card.classification === 'FACT' ? '#4ade80' : card.classification === 'REPORTED' ? '#eab308' : '#a78bfa'}`,
                      color: card.classification === 'FACT' ? '#4ade80' : card.classification === 'REPORTED' ? '#eab308' : '#a78bfa',
                      borderRadius: 3, fontWeight: 600,
                    }}>{card.classification}</span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: '#4b5563' }}>{timeAgo(card.timestamp)}</span>
              </div>

              <div style={{ fontSize: 14, color: '#e6edf3', fontWeight: 600, marginBottom: 5, lineHeight: 1.5 }}>{card.title}</div>
              <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6, marginBottom: 6 }}>{card.body}</div>

              {card.source && (
                <div style={{ fontSize: 10, color: '#4b5563' }}>
                  Source: {card.source}
                  {card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4ade80', marginLeft: 4 }}>↗</a>}
                </div>
              )}

              {card.scenarioImpact && card.scenarioImpact.posterior > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#080c14', borderRadius: 4, border: '1px solid #1e3a2f' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#c9d1d9' }}>{card.scenarioImpact.scenario}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      <span style={{ color: '#6b7280' }}>{card.scenarioImpact.prior}%</span>
                      <span style={{ color: '#4b5563' }}> → </span>
                      <span style={{ color: card.scenarioImpact.posterior > card.scenarioImpact.prior ? '#ef4444' : '#4ade80' }}>
                        {card.scenarioImpact.posterior}%
                      </span>
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>LR: {card.scenarioImpact.likelihoodRatio}x</div>

                  {card.bayesianTrail && card.bayesianTrail.length > 0 && (
                    <>
                      <button onClick={() => toggleMath(card.id)} style={{
                        background: 'transparent', border: 'none', color: '#a78bfa',
                        fontSize: 10, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', letterSpacing: 1, fontWeight: 600,
                      }}>
                        {expandedMath.has(card.id) ? '▼ HIDE MATH' : '▶ SHOW MATH'}
                      </button>
                      {expandedMath.has(card.id) && (
                        <BayesianMathView trail={card.bayesianTrail} prior={card.scenarioImpact.prior} posterior={card.scenarioImpact.posterior} />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ─── RIGHT: Scenario Engine ─── */}
        <div className="panel-right" style={{ overflowY: 'auto', padding: '12px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 2, fontWeight: 600 }}>SCENARIO ENGINE</div>
            <div style={{ fontSize: 14, color: '#4ade80', fontWeight: 700 }}>{pw.toLocaleString()}</div>
          </div>

          {spot > 0 && (
            <div style={{
              background: '#112a1a', border: '1px solid #1e3a2f', borderRadius: 4,
              padding: '7px 10px', marginBottom: 10, textAlign: 'center', fontSize: 11,
            }}>
              <span style={{ color: '#6b7280' }}>SPOT {spot.toLocaleString()}</span>
              <span style={{ color: '#374151' }}> · </span>
              <span style={{ color: '#4ade80' }}>TARGET {pw.toLocaleString()}</span>
              <span style={{ color: '#374151' }}> · </span>
              <span style={{ color: dc(gap) }}>GAP {gap > 0 ? '+' : ''}{gap.toFixed(0)} ({gapPct}%)</span>
            </div>
          )}

          <div style={{ fontSize: 9, color: '#4b5563', letterSpacing: 1, marginBottom: 8 }}>CLICK % TO EDIT · AUTO-REDISTRIBUTES TO 100</div>

          {state.scenarios.map((s, i) => {
            const bc = s.prob > 30 ? '#4ade80' : s.prob > 15 ? '#eab308' : s.prob > 7 ? '#f97316' : '#ef4444';
            return (
              <div key={i} style={{ background: '#0d1117', border: '1px solid #1e3a2f', borderRadius: 5, padding: '9px 11px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600, flex: 1 }}>{s.scenario}</div>
                  {editingScenario === i ? (
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <input value={editInput} onChange={e => setEditInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleProbEdit(i); if (e.key === 'Escape') setEditingScenario(null); }}
                        autoFocus style={{ width: 42, background: '#080c14', border: '1px solid #4ade80', color: '#4ade80', borderRadius: 3, padding: '2px 4px', fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }}
                      />
                      <button onClick={() => handleProbEdit(i)} style={{ background: '#112a1a', border: '1px solid #4ade80', color: '#4ade80', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>✓</button>
                    </div>
                  ) : (
                    <span onClick={() => { setEditingScenario(i); setEditInput(String(s.prob)); }}
                      style={{ fontSize: 16, color: bc, fontWeight: 700, cursor: 'pointer', minWidth: 42, textAlign: 'right' }}>
                      {s.prob}%
                    </span>
                  )}
                </div>

                <div style={{ background: '#080c14', borderRadius: 3, height: 5, marginBottom: 5 }}>
                  <div style={{ background: bc, height: 5, borderRadius: 3, width: `${s.prob}%`, transition: 'width 0.3s' }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: '#a78bfa' }}>Nifty {s.range}</span>
                  <span style={{ color: '#4b5563' }}>{s.ivEstimate}</span>
                </div>
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2, lineHeight: 1.4 }}>{s.driver}</div>

                {s.analogues.length > 0 && (
                  <>
                    <button onClick={() => setExpandedAnalogue(expandedAnalogue === i ? null : i)}
                      style={{ background: 'transparent', border: 'none', color: '#06b6d4', fontSize: 10, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', letterSpacing: 1, fontWeight: 600 }}>
                      {expandedAnalogue === i ? '▼ PRECEDENT' : '▶ PRECEDENT'}
                    </button>
                    {expandedAnalogue === i && s.analogues.map((a, ai) => (
                      <div key={ai} style={{ background: '#080c14', borderRadius: 4, padding: '7px 9px', border: '1px solid #0e3347', marginTop: 3 }}>
                        <div style={{ fontSize: 11, color: '#06b6d4', marginBottom: 3, fontWeight: 600 }}>{a.event} ({a.date})</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.6 }}>
                          Oil: {a.oilMove} · Nifty: {a.niftyMove}<br />
                          VIX: {a.vixMove} · Recovery: {a.recoveryDays} sessions
                        </div>
                        <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2 }}>Source: {a.source}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}

          <div style={{ marginTop: 14, padding: '8px 10px', background: '#0a0f1a', border: '1px solid #1e3a2f', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: '#4b5563', lineHeight: 1.6 }}>
              Factual intelligence only. Not investment advice. Probabilities are Bayesian
              estimates with auditable math. Sources linked. Not SEBI registered.
            </div>
          </div>
        </div>
      </div>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 1100px) {
          .main-grid { grid-template-columns: 200px 1fr 280px !important; }
        }
        @media (max-width: 900px) {
          .main-grid { grid-template-columns: 1fr !important; height: auto !important; }
          .panel-left { display: ${mobilePanel === 'actors' ? 'block' : 'none'} !important; border-right: none !important; }
          .panel-center { display: ${mobilePanel === 'feed' ? 'block' : 'none'} !important; border-right: none !important; min-height: calc(100vh - 130px); }
          .panel-right { display: ${mobilePanel === 'scenarios' ? 'block' : 'none'} !important; }
          .mobile-tabs { display: flex !important; }
        }
        @media (max-width: 600px) {
          .main-grid { padding: 0 !important; }
          .panel-center, .panel-left, .panel-right { padding: 10px 12px !important; }
        }
      `}</style>
    </div>
  );
}

function BayesianMathView({ trail, prior, posterior }: { trail: BayesianTrailItem[]; prior: number; posterior: number }) {
  const priorOdds = prior / (100 - prior);
  return (
    <div style={{ marginTop: 6, padding: '8px', background: '#060a12', borderRadius: 4, border: '1px solid #1a1a2e' }}>
      <div style={{ fontSize: 10, color: '#a78bfa', letterSpacing: 1, marginBottom: 5, fontWeight: 600 }}>BAYESIAN AUDIT TRAIL</div>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>Prior: {prior}% → Odds: {priorOdds.toFixed(4)}</div>
      {trail.map((t, i) => (
        <div key={i} style={{ padding: '4px 0', borderBottom: i < trail.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
          <div style={{ fontSize: 10, color: '#c9d1d9', lineHeight: 1.5 }}>
            <span style={{ color: t.direction === '+' ? '#ef4444' : '#4ade80', fontWeight: 700 }}>[{t.direction}]</span> {t.evidence}
          </div>
          <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>{t.classification} · {t.source} · LR: {t.likelihoodRatio}x</div>
          <div style={{ fontSize: 9, color: '#4b5563', lineHeight: 1.4 }}>{t.reasoning}</div>
          <div style={{ fontSize: 9, color: '#374151' }}>Odds: {t.priorOdds} → {t.posteriorOdds}</div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#a78bfa', marginTop: 6, fontWeight: 700 }}>
        Final posterior: {posterior}%
      </div>
    </div>
  );
}
