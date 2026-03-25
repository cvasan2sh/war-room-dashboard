import { NextResponse } from 'next/server';
import { NiftyScenario, Actor, EvidenceItem, FeedCard } from '@/lib/types';
import { bayesianUpdate, redistributeProbabilities } from '@/lib/bayesian';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface RefreshRequest {
  scenarios: NiftyScenario[];
  actors: Actor[];
  userNotes: string;
  marketData: {
    nifty: number;
    oil: number;
    inr: number;
    vix: number;
  };
}

// Read CPI data from Python backend if available
async function getCpiContext(): Promise<string> {
  try {
    const latestPath = join(process.cwd(), 'public', 'data', 'latest.json');
    const raw = await readFile(latestPath, 'utf-8');
    const data = JSON.parse(raw);
    const cpi = data.cpi_result || {};
    const signals = data.signals || {};

    const signalSummary = Object.entries(signals)
      .map(([k, v]: [string, any]) => `${k}: ${v.score ?? '?'} — ${v.interpretation || ''}`)
      .join('\n');

    return `
CEASEFIRE PROBABILITY INDEX (CPI): ${cpi.cpi ?? 'N/A'} / 100
Zone: ${cpi.zone?.name || 'N/A'}
Hourly change: ${cpi.hourly_change || 0} pts
Confluence satisfied: ${cpi.confluence_satisfied ?? 'N/A'}

Signal scores:
${signalSummary}

Active CPI alerts:
${(cpi.alerts || []).join('\n') || 'None'}

Group scores: ${JSON.stringify(cpi.group_scores || {})}`;
  } catch {
    return 'CPI data not available (Python backend not running).';
  }
}

const SYSTEM_PROMPT = `You are a factual intelligence research agent for a geopolitical risk monitoring system focused on the US-Israel-Iran conflict (Operation Epic Fury, Day 26+, March 2026).

YOUR ROLE: Find and classify evidence. Assess scenario evolution. Update multi-market impact estimates. You do NOT give opinions or trading advice. You report facts and assign quantitative likelihood ratios.

RULES:
- Every claim must have a source
- Classify evidence as FACT (verified primary source) or REPORTED (credible news)
- Never use "should", "recommend", "consider", "concerning"
- Be conservative with likelihood ratios: most evidence = 1.05x-1.3x
- Only >1.5x for highly direct, confirmed, unprecedented developments
- If uncertain about a likelihood ratio, use 1.0 (no change)

SCENARIO EVOLUTION:
- You can PROPOSE new scenarios that have emerged from the evolving situation
- You can mark existing scenarios as "fading" if evidence makes them irrelevant
- You can update market impact ranges (Nifty, Oil, INR) if conditions have shifted
- Keep total scenarios between 5-8
- New scenarios need: key, name, probability (taken from others), market ranges, driver, timeHorizon

OUTPUT FORMAT: Respond with ONLY a valid JSON object (no markdown, no code fences):
{
  "evidenceItems": [
    {
      "headline": "Factual headline",
      "source": "Source name",
      "sourceUrl": "URL if available",
      "classification": "FACT or REPORTED",
      "scenarioKey": "key from active scenarios",
      "actorId": "usa|israel|iran|russia|china|saudi|qatar|india|pakistan|gulf_others",
      "direction": "+ or - or neutral",
      "likelihoodRatio": 1.15,
      "reasoning": "Why this ratio"
    }
  ],
  "scenarioEvolution": {
    "updates": [
      {
        "key": "existing_scenario_key",
        "oilRange": "$95-110",
        "oilMid": 102,
        "inrRange": "86.5-87.5",
        "inrMid": 87.0,
        "range": "22,400-23,200",
        "rangeMid": 22800,
        "driver": "Updated driver text if changed",
        "timeHorizon": "2-4 weeks",
        "status": "active or fading"
      }
    ],
    "newScenarios": [
      {
        "key": "new_scenario_key",
        "scenario": "Scenario name",
        "prob": 5,
        "range": "22,000-23,000",
        "rangeMid": 22500,
        "driver": "What drives this scenario",
        "ivEstimate": "VIX 20-25",
        "oilRange": "$90-100",
        "oilMid": 95,
        "inrRange": "86-87",
        "inrMid": 86.5,
        "timeHorizon": "1-2 weeks",
        "reasoning": "Why this scenario has emerged"
      }
    ],
    "retireKeys": [],
    "evolutionSummary": "1-2 sentence summary of how the scenario landscape shifted"
  },
  "actorUpdates": [
    {
      "actorId": "iran",
      "latestDevelopment": "Factual one-line summary",
      "source": "Source name"
    }
  ],
  "situationSummary": "3-4 sentence factual summary of what changed."
}`;

function buildUserPrompt(req: RefreshRequest, cpiContext: string): string {
  const scenarioBlock = req.scenarios.map(s => {
    const markets = [
      s.oilRange ? `Oil ${s.oilRange}` : '',
      s.inrRange ? `INR ${s.inrRange}` : '',
    ].filter(Boolean).join(', ');
    const statusTag = s.status === 'fading' ? ' [FADING]' : s.status === 'emerging' ? ' [EMERGING]' : '';
    return `- [${s.key}] ${s.scenario}: ${s.prob}%${statusTag} → Nifty ${s.range} | ${markets} | ${s.timeHorizon || '?'}`;
  }).join('\n');

  return `Current dashboard state (Day ${Math.floor((Date.now() - new Date('2026-02-28').getTime()) / 86400000)} of Operation Epic Fury):

Market: Nifty ${req.marketData.nifty}, Oil $${req.marketData.oil}/bbl, INR ${req.marketData.inr}, VIX ${req.marketData.vix}

Active scenarios and current probabilities:
${scenarioBlock}

Actors being tracked:
${req.actors.map(a => `- ${a.flag} ${a.name} (${a.status}): Key signal = ${a.keySignal}`).join('\n')}

CPI SIGNALS (from real-time monitoring system):
${cpiContext}

User intelligence notes:
${req.userNotes || 'None provided'}

TASKS:
1. Search for the latest developments (last 4-6 hours) related to:
   - US-Israel-Iran military operations and strike tempo
   - Hormuz strait shipping / oil infrastructure status
   - Diplomatic back-channels (Pakistan, Oman, Qatar, Russia, Turkey)
   - Iran missile inventory and operational capability
   - India-specific macro impact (INR, oil imports, RBI actions)
   - Any emerging scenarios not currently tracked

2. For each evidence item, assign it to the most relevant scenario key and provide a likelihood ratio.

3. SCENARIO EVOLUTION: Based on the evidence AND the CPI signals:
   - Should any scenario's market impact ranges be updated? (Nifty, Oil, INR)
   - Are any scenarios becoming irrelevant ("fading")?
   - Are any new scenarios emerging that we're not tracking?
   - Has any scenario's timeHorizon changed?

4. Return classified evidence items, scenario evolution updates, and actor updates.

Remember: facts only, sources required, conservative ratios. New scenarios must take probability from existing ones (total must stay ~100%).`;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      console.error('Claude API error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return data.content?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('') || null;
  } catch (e) {
    console.error('Claude call failed:', e);
    return null;
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 6000,
        temperature: 0.3,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 6000 },
        }),
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body: RefreshRequest = await request.json();

    // Get CPI context from Python backend
    const cpiContext = await getCpiContext();
    const userPrompt = buildUserPrompt(body, cpiContext);

    // Try providers in order: Claude → OpenAI → Gemini
    let rawResponse = await callClaude(SYSTEM_PROMPT, userPrompt);
    let provider = 'Claude';

    if (!rawResponse) {
      rawResponse = await callOpenAI(SYSTEM_PROMPT, userPrompt);
      provider = 'OpenAI';
    }

    if (!rawResponse) {
      rawResponse = await callGemini(SYSTEM_PROMPT, userPrompt);
      provider = 'Gemini';
    }

    if (!rawResponse) {
      return NextResponse.json({
        feedCards: [{
          id: `system-${Date.now()}`,
          type: 'SYSTEM',
          timestamp: new Date().toISOString(),
          title: 'AI REFRESH FAILED',
          body: 'All AI providers unavailable. No API keys configured or all returned errors. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY in environment variables.',
        }],
        updatedScenarios: body.scenarios,
        updatedActors: body.actors,
      });
    }

    // Parse AI response
    let parsed;
    try {
      const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        feedCards: [{
          id: `system-${Date.now()}`,
          type: 'SYSTEM',
          timestamp: new Date().toISOString(),
          title: 'AI PARSE ERROR',
          body: `${provider} returned non-JSON response. Raw output preserved for debugging.`,
        }],
        updatedScenarios: body.scenarios,
        updatedActors: body.actors,
        rawResponse,
      });
    }

    const now = new Date().toISOString();
    const feedCards: FeedCard[] = [];

    // System card: refresh started
    feedCards.push({
      id: `system-${Date.now()}`,
      type: 'SYSTEM',
      timestamp: now,
      title: 'AGENT RUN COMPLETE',
      body: `Provider: ${provider}. Evidence: ${parsed.evidenceItems?.length || 0}. Actor updates: ${parsed.actorUpdates?.length || 0}. Scenario evolution: ${parsed.scenarioEvolution ? 'yes' : 'no'}.`,
    });

    // ── BUILD DYNAMIC SCENARIO KEY MAP ──
    const scenarioKeyMap: Record<string, string> = {};
    for (const s of body.scenarios) {
      if (s.key) scenarioKeyMap[s.key] = s.scenario;
    }

    // ── PROCESS EVIDENCE ITEMS ──
    const evidenceByScenario = new Map<string, EvidenceItem[]>();

    if (parsed.evidenceItems && Array.isArray(parsed.evidenceItems)) {
      for (const item of parsed.evidenceItems) {
        const scenarioName = scenarioKeyMap[item.scenarioKey] || item.scenarioKey;

        const evidence: EvidenceItem = {
          id: `ev-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          timestamp: now,
          headline: item.headline,
          source: item.source,
          sourceUrl: item.sourceUrl,
          classification: item.classification === 'FACT' ? 'FACT' : 'REPORTED',
          scenarioId: item.scenarioKey,
          direction: item.direction === '+' ? '+' : item.direction === '-' ? '-' : 'neutral',
          likelihoodRatio: typeof item.likelihoodRatio === 'number' ? item.likelihoodRatio : 1.0,
          reasoning: item.reasoning || '',
          actorId: item.actorId,
        };

        const impactScenario = body.scenarios.find(s => s.scenario === scenarioName || s.key === item.scenarioKey);

        feedCards.push({
          id: evidence.id,
          type: 'EVIDENCE',
          timestamp: now,
          title: evidence.headline,
          body: evidence.reasoning,
          source: evidence.source,
          sourceUrl: evidence.sourceUrl,
          classification: evidence.classification,
          scenarioImpact: impactScenario ? {
            scenarioId: item.scenarioKey,
            scenario: scenarioName,
            prior: impactScenario.prob,
            posterior: 0,
            likelihoodRatio: evidence.likelihoodRatio,
          } : undefined,
          actorId: evidence.actorId,
        });

        const key = impactScenario?.scenario || scenarioName;
        if (!evidenceByScenario.has(key)) {
          evidenceByScenario.set(key, []);
        }
        evidenceByScenario.get(key)!.push(evidence);
      }
    }

    // ── BAYESIAN UPDATES ──
    const updates = [];
    for (const scenario of body.scenarios) {
      const evidence = evidenceByScenario.get(scenario.scenario);
      if (evidence && evidence.length > 0) {
        const update = bayesianUpdate(scenario, evidence);
        updates.push(update);

        for (const card of feedCards) {
          if (card.scenarioImpact?.scenario === scenario.scenario) {
            card.scenarioImpact.posterior = update.posterior;
            card.bayesianTrail = update.trail;
          }
        }
      }
    }

    let updatedScenarios = updates.length > 0
      ? redistributeProbabilities(body.scenarios, updates)
      : [...body.scenarios];

    // ── SCENARIO EVOLUTION ──
    const evolution = parsed.scenarioEvolution;
    if (evolution) {
      // Apply market range updates to existing scenarios
      if (evolution.updates && Array.isArray(evolution.updates)) {
        for (const upd of evolution.updates) {
          const idx = updatedScenarios.findIndex(s => s.key === upd.key);
          if (idx !== -1) {
            const s = updatedScenarios[idx];
            updatedScenarios[idx] = {
              ...s,
              oilRange: upd.oilRange || s.oilRange,
              oilMid: upd.oilMid ?? s.oilMid,
              inrRange: upd.inrRange || s.inrRange,
              inrMid: upd.inrMid ?? s.inrMid,
              range: upd.range || s.range,
              rangeMid: upd.rangeMid ?? s.rangeMid,
              driver: upd.driver || s.driver,
              timeHorizon: upd.timeHorizon || s.timeHorizon,
              status: upd.status || s.status,
              lastUpdated: now,
            };
          }
        }
      }

      // Mark scenarios for retirement (set to fading, reduce prob)
      if (evolution.retireKeys && Array.isArray(evolution.retireKeys)) {
        for (const key of evolution.retireKeys) {
          const idx = updatedScenarios.findIndex(s => s.key === key);
          if (idx !== -1) {
            const freedProb = updatedScenarios[idx].prob;
            updatedScenarios[idx] = {
              ...updatedScenarios[idx],
              status: 'fading',
              prob: Math.max(1, Math.floor(freedProb * 0.3)), // reduce to 30% of original
              lastUpdated: now,
            };
            // Redistribute freed probability to remaining active scenarios
            const activeSc = updatedScenarios.filter((s, i) => i !== idx && s.status !== 'fading');
            const redistAmount = freedProb - updatedScenarios[idx].prob;
            if (activeSc.length > 0) {
              const perScenario = redistAmount / activeSc.length;
              for (const as of activeSc) {
                const ai = updatedScenarios.findIndex(s => s.key === as.key);
                if (ai !== -1) {
                  updatedScenarios[ai] = {
                    ...updatedScenarios[ai],
                    prob: Math.round(updatedScenarios[ai].prob + perScenario),
                  };
                }
              }
            }
          }
        }
      }

      // Add new scenarios
      if (evolution.newScenarios && Array.isArray(evolution.newScenarios)) {
        for (const ns of evolution.newScenarios) {
          // Don't add if key already exists
          if (updatedScenarios.some(s => s.key === ns.key)) continue;
          // Don't exceed 8 scenarios
          if (updatedScenarios.filter(s => s.status !== 'fading').length >= 8) continue;

          const newProb = Math.min(ns.prob || 5, 15); // cap new scenarios at 15%

          // Take probability from largest scenario
          const largestIdx = updatedScenarios.reduce(
            (maxI, s, i) => s.prob > updatedScenarios[maxI].prob ? i : maxI, 0
          );
          updatedScenarios[largestIdx] = {
            ...updatedScenarios[largestIdx],
            prob: Math.max(5, updatedScenarios[largestIdx].prob - newProb),
          };

          updatedScenarios.push({
            scenario: ns.scenario,
            key: ns.key,
            prob: newProb,
            range: ns.range || '22,000–23,000',
            rangeMid: ns.rangeMid || 22500,
            driver: ns.driver || '',
            ivEstimate: ns.ivEstimate || 'VIX 20–25',
            oilRange: ns.oilRange,
            oilMid: ns.oilMid,
            inrRange: ns.inrRange,
            inrMid: ns.inrMid,
            timeHorizon: ns.timeHorizon,
            status: 'emerging',
            lastUpdated: now,
            analogues: [],
          });

          feedCards.push({
            id: `scenario-new-${ns.key}-${Date.now()}`,
            type: 'ANALYSIS',
            timestamp: now,
            title: `NEW SCENARIO: ${ns.scenario}`,
            body: `${ns.reasoning || ns.driver}. Initial probability: ${newProb}%.`,
            classification: 'DERIVED',
          });
        }
      }

      // Evolution summary card
      if (evolution.evolutionSummary) {
        feedCards.push({
          id: `evolution-${Date.now()}`,
          type: 'ANALYSIS',
          timestamp: now,
          title: 'SCENARIO EVOLUTION',
          body: evolution.evolutionSummary,
          classification: 'DERIVED',
        });
      }
    }

    // Normalize probabilities to sum to 100
    const totalProb = updatedScenarios.reduce((s, sc) => s + sc.prob, 0);
    if (totalProb > 0 && Math.abs(totalProb - 100) > 1) {
      const factor = 100 / totalProb;
      updatedScenarios = updatedScenarios.map(s => ({
        ...s,
        prob: Math.round(s.prob * factor),
      }));
      // Fix rounding — add remainder to largest
      const roundedTotal = updatedScenarios.reduce((s, sc) => s + sc.prob, 0);
      if (roundedTotal !== 100) {
        const lIdx = updatedScenarios.reduce((mi, s, i) => s.prob > updatedScenarios[mi].prob ? i : mi, 0);
        updatedScenarios[lIdx] = { ...updatedScenarios[lIdx], prob: updatedScenarios[lIdx].prob + (100 - roundedTotal) };
      }
    }

    // Remove fully faded scenarios (prob <= 1 and fading)
    updatedScenarios = updatedScenarios.filter(s => !(s.status === 'fading' && s.prob <= 1));

    // Analysis summary
    if (updates.length > 0) {
      const totalShift = updates.reduce((sum, u) => sum + Math.abs(u.posterior - u.prior), 0);
      feedCards.push({
        id: `analysis-${Date.now()}`,
        type: 'ANALYSIS',
        timestamp: now,
        title: 'BAYESIAN UPDATE COMPLETE',
        body: `${updates.length} scenario(s) updated. Total shift: ${totalShift.toFixed(1)}pp. ${parsed.situationSummary || ''}`,
        classification: 'DERIVED',
      });
    }

    // ── ACTOR UPDATES ──
    const updatedActors = [...body.actors];
    if (parsed.actorUpdates && Array.isArray(parsed.actorUpdates)) {
      for (const au of parsed.actorUpdates) {
        const idx = updatedActors.findIndex(a => a.id === au.actorId);
        if (idx !== -1) {
          updatedActors[idx] = {
            ...updatedActors[idx],
            latestDevelopment: au.latestDevelopment,
            latestDevTimestamp: now,
            latestDevSource: au.source,
          };

          feedCards.push({
            id: `actor-${au.actorId}-${Date.now()}`,
            type: 'ACTOR_UPDATE',
            timestamp: now,
            title: `${updatedActors[idx].flag} ${updatedActors[idx].name}`,
            body: au.latestDevelopment,
            source: au.source,
            actorId: au.actorId,
          });
        }
      }
    }

    return NextResponse.json({
      feedCards,
      updatedScenarios,
      updatedActors,
      provider,
      timestamp: now,
    });

  } catch (error) {
    console.error('AI refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error during AI refresh' },
      { status: 500 }
    );
  }
}
