import { EvidenceItem, BayesianUpdate, BayesianTrailItem, NiftyScenario } from './types';

/**
 * Pure deterministic Bayesian updater.
 * No AI involved — this is math, not generation.
 * Every calculation is auditable.
 */
export function bayesianUpdate(
  scenario: NiftyScenario,
  evidenceItems: EvidenceItem[]
): BayesianUpdate {
  const prior = scenario.prob / 100;
  let odds = prior / (1 - prior);
  const trail: BayesianTrailItem[] = [];

  for (const item of evidenceItems) {
    if (item.classification === 'DERIVED') continue; // only use FACT and REPORTED
    if (item.likelihoodRatio === 1.0) continue; // no change

    const oldOdds = odds;
    odds *= item.likelihoodRatio;

    trail.push({
      evidence: item.headline,
      source: item.source,
      classification: item.classification,
      direction: item.direction,
      likelihoodRatio: item.likelihoodRatio,
      reasoning: item.reasoning,
      priorOdds: oldOdds.toFixed(4),
      posteriorOdds: odds.toFixed(4),
    });
  }

  // Clamp odds to prevent extreme values
  odds = Math.max(0.001, Math.min(99, odds));

  const posterior = odds / (1 + odds);
  const posteriorPct = Math.round(posterior * 1000) / 10;

  return {
    scenarioId: scenario.scenario.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    scenario: scenario.scenario,
    prior: scenario.prob,
    posterior: posteriorPct,
    evidenceCount: trail.length,
    trail,
  };
}

/**
 * After Bayesian updates, redistribute probabilities to sum to 100%.
 * Updated scenarios get their new values; remaining budget is distributed
 * proportionally among non-updated scenarios.
 */
export function redistributeProbabilities(
  scenarios: NiftyScenario[],
  updates: BayesianUpdate[]
): NiftyScenario[] {
  const updated = new Map<string, number>();
  for (const u of updates) {
    updated.set(u.scenario, u.posterior);
  }

  // Calculate how much probability the updated scenarios use
  let updatedTotal = 0;
  let nonUpdatedTotal = 0;

  for (const s of scenarios) {
    if (updated.has(s.scenario)) {
      updatedTotal += updated.get(s.scenario)!;
    } else {
      nonUpdatedTotal += s.prob;
    }
  }

  const remaining = Math.max(0, 100 - updatedTotal);

  return scenarios.map(s => {
    if (updated.has(s.scenario)) {
      return { ...s, prob: Math.round(updated.get(s.scenario)! * 10) / 10 };
    }
    // Proportional redistribution
    const share = nonUpdatedTotal > 0
      ? Math.round((s.prob / nonUpdatedTotal) * remaining * 10) / 10
      : Math.round((remaining / (scenarios.length - updated.size)) * 10) / 10;
    return { ...s, prob: share };
  });
}

/**
 * Manual probability edit with auto-redistribution.
 * When user changes one scenario, others adjust proportionally to keep sum = 100.
 */
export function manualProbUpdate(
  scenarios: NiftyScenario[],
  editedIndex: number,
  newProb: number
): NiftyScenario[] {
  const result = [...scenarios];
  result[editedIndex] = { ...result[editedIndex], prob: newProb };

  const others = result.filter((_, i) => i !== editedIndex);
  const othersTotal = others.reduce((s, x) => s + x.prob, 0);
  const remaining = 100 - newProb;
  let assigned = 0;

  for (let i = 0; i < result.length; i++) {
    if (i === editedIndex) continue;
    const isLast = others.indexOf(result[i]) === others.length - 1;
    if (isLast) {
      result[i] = { ...result[i], prob: Math.max(0, Math.round((remaining - assigned) * 10) / 10) };
    } else {
      const share = othersTotal > 0
        ? Math.round((result[i].prob / othersTotal) * remaining * 10) / 10
        : Math.round((remaining / others.length) * 10) / 10;
      result[i] = { ...result[i], prob: Math.max(0, share) };
      assigned += result[i].prob;
    }
  }

  return result;
}
