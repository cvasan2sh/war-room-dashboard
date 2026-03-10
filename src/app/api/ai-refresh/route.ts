import { NextResponse } from 'next/server';
import { NiftyScenario, Actor, EvidenceItem, FeedCard } from '@/lib/types';
import { bayesianUpdate, redistributeProbabilities } from '@/lib/bayesian';

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

const SYSTEM_PROMPT = `You are a factual intelligence research agent for a geopolitical risk monitoring system focused on the US-Israel-Iran conflict (Operation Epic Fury, March 2026).

YOUR ROLE: Find and classify evidence. You do NOT give opinions, recommendations, or predictions. You report facts and assign quantitative likelihood ratios with cited reasoning.

RULES:
- Every claim must have a source
- Classify each evidence item as FACT (verified from primary source) or REPORTED (credible news, not independently verified)
- Never use words like "should", "recommend", "consider", "concerning", "significant"
- Never give trading advice or suggest positions
- Be conservative with likelihood ratios: most evidence shifts probability by 1.05x-1.3x only
- Only assign >1.5x for highly direct, confirmed, unprecedented developments
- If uncertain about a likelihood ratio, use 1.0 (no change)

OUTPUT FORMAT: You must respond with ONLY a valid JSON object (no markdown, no code fences) with this structure:
{
  "evidenceItems": [
    {
      "headline": "Factual headline, no editorializing",
      "source": "Source name",
      "sourceUrl": "URL if available",
      "classification": "FACT or REPORTED",
      "scenarioKey": "one of: stalemate, tanker, ceasefire, abqaiq, mojtaba, pakistan, deal",
      "actorId": "one of: usa, israel, iran, russia, china, saudi, qatar, india, pakistan, gulf_others",
      "direction": "+ or - or neutral",
      "likelihoodRatio": 1.15,
      "reasoning": "Why this ratio, citing historical precedent where possible"
    }
  ],
  "actorUpdates": [
    {
      "actorId": "iran",
      "latestDevelopment": "One-line factual summary of most important development",
      "source": "Source name"
    }
  ],
  "situationSummary": "3-4 sentence factual summary of what changed. No opinions. Only source-backed statements."
}`;

function buildUserPrompt(req: RefreshRequest): string {
  return `Current dashboard state:
Market: Nifty ${req.marketData.nifty}, Oil $${req.marketData.oil}/bbl, INR ${req.marketData.inr}, VIX ${req.marketData.vix}

Active scenarios and current probabilities:
${req.scenarios.map(s => `- ${s.scenario}: ${s.prob}% → Nifty ${s.range}`).join('\n')}

Actors being tracked:
${req.actors.map(a => `- ${a.flag} ${a.name} (${a.status}): Key signal = ${a.keySignal}`).join('\n')}

User intelligence notes (may contain recent news the user pasted):
${req.userNotes || 'None provided'}

Search for the latest developments (last 4-6 hours) related to:
1. The US-Israel-Iran military conflict
2. Hormuz strait shipping / oil infrastructure
3. Diplomatic back-channels (Qatar, Saudi, Oman, Russia)
4. India-specific macro impact (INR, oil imports, RBI)
5. Any developments matching the tracked scenarios

Return classified evidence items with likelihood ratios and actor updates. Remember: facts only, sources required, conservative ratios.`;
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
        max_tokens: 4000,
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
        max_tokens: 4000,
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
          generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
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
    const userPrompt = buildUserPrompt(body);

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
      // Strip markdown code fences if present
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
      body: `Provider: ${provider}. Evidence items: ${parsed.evidenceItems?.length || 0}. Actor updates: ${parsed.actorUpdates?.length || 0}.`,
    });

    // Map scenario keys to full names
    const scenarioKeyMap: Record<string, string> = {
      stalemate: 'Controlled stalemate',
      tanker: 'Iran fires on US-escorted tanker',
      ceasefire: 'Qatar/Saudi ceasefire framework',
      abqaiq: 'Abqaiq / major infra hit',
      mojtaba: 'Israel assassinates Mojtaba',
      pakistan: 'Pakistan nuclear-adjacent crisis',
      deal: 'US-Russia brokered deal',
    };

    // Process evidence items
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

        // Build feed card for each evidence item
        const impactScenario = body.scenarios.find(s => s.scenario === scenarioName);

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
            posterior: 0, // filled after Bayesian update
            likelihoodRatio: evidence.likelihoodRatio,
          } : undefined,
          actorId: evidence.actorId,
        });

        // Group by scenario for Bayesian update
        if (!evidenceByScenario.has(scenarioName)) {
          evidenceByScenario.set(scenarioName, []);
        }
        evidenceByScenario.get(scenarioName)!.push(evidence);
      }
    }

    // Run Bayesian updates (deterministic math)
    const updates = [];
    for (const scenario of body.scenarios) {
      const evidence = evidenceByScenario.get(scenario.scenario);
      if (evidence && evidence.length > 0) {
        const update = bayesianUpdate(scenario, evidence);
        updates.push(update);

        // Update the evidence feed cards with posterior values
        for (const card of feedCards) {
          if (card.scenarioImpact?.scenario === scenario.scenario) {
            card.scenarioImpact.posterior = update.posterior;
            card.bayesianTrail = update.trail;
          }
        }
      }
    }

    // Redistribute probabilities
    const updatedScenarios = updates.length > 0
      ? redistributeProbabilities(body.scenarios, updates)
      : body.scenarios;

    // Add analysis summary card
    if (updates.length > 0) {
      const totalShift = updates.reduce((sum, u) => sum + Math.abs(u.posterior - u.prior), 0);
      feedCards.push({
        id: `analysis-${Date.now()}`,
        type: 'ANALYSIS',
        timestamp: now,
        title: 'BAYESIAN UPDATE COMPLETE',
        body: `${updates.length} scenario(s) updated. Total probability shift: ${totalShift.toFixed(1)}pp. ${parsed.situationSummary || ''}`,
        classification: 'DERIVED',
      });
    }

    // Process actor updates
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
