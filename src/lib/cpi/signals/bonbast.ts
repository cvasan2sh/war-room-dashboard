// signals/bonbast.ts — Iranian Rial black market rate
// Rial strengthening = peace signal. Rial weakening = war signal.
// JSON API primary, HTML scraping fallback.

import type { SignalResult } from "../types";
import { getSignalState, setSignalState } from "../store";
import {
  BONBAST_URL,
  BONBAST_TIMEOUT,
  RIAL_SIGNIFICANT_MOVE,
  TOMAN_MIN,
  TOMAN_MAX,
  RIAL_MIN,
  RIAL_MAX,
} from "../config";

function noData(reason: string): SignalResult {
  return {
    signal: "bonbast",
    score: 50,
    confidence: 0.0,
    interpretation: `NO DATA: ${reason}`,
    alert: false,
    rate: null,
    trend_pct: 0,
    timestamp: new Date().toISOString(),
  };
}

function validateRate(val: number | null): number | null {
  if (val === null || val === undefined) return null;
  if (val >= TOMAN_MIN && val <= TOMAN_MAX) return val;
  if (val >= RIAL_MIN && val <= RIAL_MAX) return val;
  return null;
}

function outlierCheck(
  rate: number,
  history: { rate: number; ts: string }[]
): boolean {
  if (history.length === 0) return true;
  const last = history[history.length - 1].rate;
  if (last === 0) return true;
  const pctDiff = Math.abs(rate - last) / last;
  if (pctDiff > 0.3) {
    console.log(
      `[BONBAST] Outlier rejected: ${rate.toLocaleString()} vs last ${last.toLocaleString()} (${(pctDiff * 100).toFixed(1)}% diff)`
    );
    return false;
  }
  return true;
}

async function fetchViaJsonApi(): Promise<{
  rate: number | null;
  html: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BONBAST_TIMEOUT);

  const resp = await fetch(BONBAST_URL, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  clearTimeout(timer);

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[BONBAST] Page fetched: ${html.length} bytes`);

  // Token extraction
  let token: string | null = null;
  const tokenPatterns = [
    /var\s+param\s*=\s*["']([^"']+)/,
    /param["']?\s*:\s*["']([^"']+)/,
    /name=["']param["'][^>]*value=["']([^"']+)/,
    /value=["']([^"']+)["'][^>]*name=["']param/,
    /"token"\s*:\s*"([^"]+)"/,
    /data-token=["']([^"']+)/,
    /getPrice\s*\(\s*["']([^"']+)/,
    /loadData\s*\(\s*["']([^"']+)/,
  ];

  for (const pattern of tokenPatterns) {
    const m = html.match(pattern);
    if (m) {
      const candidate = m[1].trim();
      if (
        candidate.length >= 8 &&
        !candidate.startsWith("http") &&
        !candidate.includes(" ")
      ) {
        token = candidate;
        console.log(
          `[BONBAST] Token found via pattern: ${pattern.source.slice(0, 40)}...`
        );
        break;
      }
    }
  }

  if (!token) {
    console.log("[BONBAST] No API token found, falling back to HTML");
    return { rate: null, html };
  }

  // POST to /json
  try {
    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), BONBAST_TIMEOUT);

    const jsonResp = await fetch(`${BONBAST_URL}/json`, {
      method: "POST",
      signal: ctrl2.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: BONBAST_URL,
      },
      body: `param=${encodeURIComponent(token)}`,
    });
    clearTimeout(timer2);

    console.log(`[BONBAST] /json response: HTTP ${jsonResp.status}`);
    if (jsonResp.status !== 200) return { rate: null, html };

    const data = (await jsonResp.json()) as Record<string, unknown>;
    console.log(
      `[BONBAST] /json keys: ${Object.keys(data).slice(0, 10).join(", ")}`
    );

    const usdKeys = [
      "usd1",
      "usd2",
      "usd_sell",
      "usd_buy",
      "dollar1",
      "dollar2",
    ];
    const usdDebug: Record<string, unknown> = {};
    for (const k of usdKeys) {
      if (data[k] != null) usdDebug[k] = data[k];
    }
    if (Object.keys(usdDebug).length > 0) {
      console.log(`[BONBAST] USD values in JSON: ${JSON.stringify(usdDebug)}`);
    }

    for (const key of usdKeys) {
      const raw = data[key];
      if (raw == null) continue;
      try {
        const val = parseInt(
          String(raw).replace(/,/g, "").replace(/\./g, "").trim(),
          10
        );
        const rate = validateRate(val);
        if (rate) {
          console.log(
            `[BONBAST] API rate from '${key}': ${rate.toLocaleString()}`
          );
          return { rate, html };
        } else {
          console.log(
            `[BONBAST] Key '${key}'=${val} FAILED range check`
          );
        }
      } catch {
        continue;
      }
    }

    console.log("[BONBAST] No valid rate in JSON");
  } catch (e) {
    console.log(
      `[BONBAST] /json POST failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return { rate: null, html };
}

function parseRateFromHtml(html: string): number | null {
  const candidates: number[] = [];

  // Strategy 1: id="usd1" or id="usd2"
  for (const usdId of ["usd1", "usd2"]) {
    const re = new RegExp(`id=["']?${usdId}["']?[^>]*>([^<]*)`, "s");
    const match = html.match(re);
    if (match) {
      const nums = match[1].match(/[\d,]+/g) ?? [];
      for (const n of nums) {
        const v = parseInt(n.replace(/,/g, ""), 10);
        if (!isNaN(v)) candidates.push(v);
      }
    }
  }

  // Strategy 2: data attributes
  for (const attr of ["data-sell", "data-buy", "data-usd"]) {
    const re = new RegExp(`${attr}=["'](\\d[\\d,]+)`);
    const match = html.match(re);
    if (match) candidates.push(parseInt(match[1].replace(/,/g, ""), 10));
  }

  // Strategy 3: class="price" elements
  for (const cls of ["price", "sell", "usd-price"]) {
    const re = new RegExp(
      `class=["'][^"']*${cls}[^"']*["'][^>]*>\\s*(\\d[\\d,]+)`,
      "g"
    );
    let m;
    while ((m = re.exec(html)) !== null) {
      candidates.push(parseInt(m[1].replace(/,/g, ""), 10));
    }
  }

  // Strategy 4: comma-formatted numbers
  const commaNumbers = html.match(/\b(\d{2,3},\d{3})\b/g) ?? [];
  for (const n of commaNumbers) {
    candidates.push(parseInt(n.replace(/,/g, ""), 10));
  }

  // Strategy 5: plain 5-6 digit numbers
  const plainNumbers = html.match(/\b(\d{5,6})\b/g) ?? [];
  for (const n of plainNumbers) {
    candidates.push(parseInt(n, 10));
  }

  for (const val of candidates) {
    const rate = validateRate(val);
    if (rate) return rate;
  }
  return null;
}

function scoreFromTrend(trendPct: number): number {
  const scaled = trendPct * 667;
  const s = 50 + Math.max(-40, Math.min(40, Math.round(scaled)));
  return Math.max(5, Math.min(95, s));
}

export async function collectBonbast(): Promise<SignalResult> {
  const now = new Date().toISOString();

  // Load history (auto-purge bad entries)
  const state = await getSignalState();
  let rates = (state.bonbast_rates ?? []).filter(
    (r) =>
      typeof r.rate === "number" && validateRate(r.rate) !== null
  );

  try {
    // Method 1: JSON API
    const { rate: apiRate, html } = await fetchViaJsonApi();
    let rate = apiRate;
    let method = "api";

    // Method 2: HTML fallback
    if (rate === null && html) {
      rate = parseRateFromHtml(html);
      method = "html";
    }

    if (rate === null) {
      return noData("could not extract valid USD/IRR rate (all methods failed)");
    }

    if (!outlierCheck(rate, rates)) {
      return noData(
        `rate ${rate.toLocaleString()} rejected as outlier vs recent history`
      );
    }

    console.log(`[BONBAST] Rate ${rate.toLocaleString()} via ${method}`);

    // Store rate
    rates.push({ rate, ts: now });
    rates = rates.slice(-672);
    state.bonbast_rates = rates;
    await setSignalState(state);

    // Calculate trend
    if (rates.length < 2) {
      return {
        signal: "bonbast",
        score: 50,
        confidence: 0.8,
        interpretation: `Rial at ${rate.toLocaleString()} \u2014 first reading, no trend yet`,
        alert: false,
        rate,
        trend_pct: 0.0,
        timestamp: now,
      };
    }

    const recent = rates.length >= 96 ? rates.slice(-96) : rates;
    const avgRate =
      recent.reduce((sum, r) => sum + r.rate, 0) / recent.length;
    const trendPct = (avgRate - rate) / avgRate;
    const s = scoreFromTrend(trendPct);
    const significant = Math.abs(trendPct) >= RIAL_SIGNIFICANT_MOVE;

    let interp: string;
    const direction =
      trendPct > 0.005
        ? "strengthening"
        : trendPct < -0.005
          ? "weakening"
          : "stable";

    if (significant && trendPct > 0) {
      interp = `Rial strengthening (${(trendPct * 100).toFixed(1)}%) at ${rate.toLocaleString()} \u2014 peace signal`;
    } else if (significant && trendPct < 0) {
      interp = `Rial weakening (${(trendPct * 100).toFixed(1)}%) at ${rate.toLocaleString()} \u2014 stress signal`;
    } else {
      interp = `Rial ${direction} (${(trendPct * 100).toFixed(1)}%) at ${rate.toLocaleString()} \u2014 no significant move`;
    }

    return {
      signal: "bonbast",
      score: s,
      confidence: 1.0,
      interpretation: interp,
      alert: significant,
      rate,
      trend_pct: Math.round(trendPct * 10000) / 10000,
      timestamp: now,
    };
  } catch (e) {
    return noData(
      `fetch failed \u2014 ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`
    );
  }
}
