'use client';

import { useState, useEffect } from 'react';

// Signal status indicator
function StatusBadge({ status }: { status: 'weighted' | 'override' | 'output' }) {
  const colors = {
    weighted: 'bg-blue-900/50 text-blue-300 border-blue-700',
    override: 'bg-amber-900/50 text-amber-300 border-amber-700',
    output: 'bg-purple-900/50 text-purple-300 border-purple-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colors[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

// Collapsible section
function Section({ title, badge, children, defaultOpen = false }: {
  title: string; badge?: 'weighted' | 'override' | 'output';
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-700 rounded-lg mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 transition text-left"
      >
        <span className="text-zinc-400 font-mono text-sm">{open ? '▼' : '▶'}</span>
        <span className="font-semibold text-zinc-100">{title}</span>
        {badge && <StatusBadge status={badge} />}
      </button>
      {open && <div className="px-4 py-3 text-sm text-zinc-300 leading-relaxed">{children}</div>}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 py-1">
      <span className="text-zinc-500 min-w-[140px]">{label}</span>
      <span className={mono ? 'font-mono text-emerald-400' : 'text-zinc-200'}>{value}</span>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-700">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-2 px-3 text-zinc-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-zinc-800">
              {row.map((cell, ci) => (
                <td key={ci} className="py-1.5 px-3 text-zinc-300 font-mono">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 my-2 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre">
      {children}
    </pre>
  );
}

export default function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <a href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">← Dashboard</a>
        </div>
        <h1 className="text-2xl font-bold">CPI API Reference</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Every external API the Ceasefire Probability Index consumes — how we use it, what we expect, and what breaks.
        </p>
        <div className="flex gap-3 mt-3">
          <StatusBadge status="weighted" />
          <span className="text-xs text-zinc-500">Contributes to CPI score</span>
          <StatusBadge status="override" />
          <span className="text-xs text-zinc-500">Binary alert / scenario shift</span>
          <StatusBadge status="output" />
          <span className="text-xs text-zinc-500">Output channel</span>
        </div>
      </div>

      {/* 1. AISstream */}
      <Section title="1. AISstream — Hormuz Vessel Tracking (35%)" badge="weighted" defaultOpen={true}>
        <p className="mb-3">Counts tankers and cargo vessels transiting the Strait of Hormuz via AIS transponder data over WebSocket. More vessels = normal flow = higher ceasefire score.</p>

        <KV label="Protocol" value="WebSocket Secure (WSS)" />
        <KV label="Endpoint" value="wss://stream.aisstream.io/v0/stream" mono />
        <KV label="Auth" value="API key inside subscription JSON (not headers)" />
        <KV label="Listen window" value="60 seconds per cycle" />
        <KV label="Docs" value="https://aisstream.io/documentation" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Bounding Box</h4>
        <p className="text-zinc-400 text-xs mb-2">⚠ Coordinate order is [longitude, latitude], NOT [lat, lon]</p>
        <CodeBlock>{`"BoundingBoxes": [[[54.0, 23.0], [60.5, 27.5]]]\n"FilterMessageTypes": ["PositionReport"]`}</CodeBlock>

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Scoring</h4>
        <p>Sigmoid curve: <code className="text-emerald-400 text-xs">100 × (1 - e^(-k×count))</code> where k = 2.5/20. Flag diversity gives ±5-8 bonus.</p>

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Confidence</h4>
        <Table
          headers={['Condition', 'Confidence', 'Meaning']}
          rows={[
            ['WebSocket fails', '0.0', 'No data at all'],
            ['Connected, 0 messages', '0.5', 'Connected but suspicious'],
            ['Real vessel data', '1.0', 'Trustworthy reading'],
          ]}
        />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Known Issues</h4>
        <p>Queue overflow causes silent disconnect. Zero messages during coverage gap ≠ zero ships (hence confidence=0.5). MetaData field <code className="text-xs text-emerald-400">country_iso</code> sometimes appears as <code className="text-xs text-emerald-400">Flag</code> — we check both.</p>
      </Section>

      {/* 2. Polymarket */}
      <Section title="2. Polymarket Gamma API — Ceasefire Probability (35%)" badge="weighted">
        <p className="mb-3">Fetches ceasefire probability from prediction market. Price = probability. 0.30 = 30% chance.</p>

        <KV label="Base URL" value="https://gamma-api.polymarket.com" mono />
        <KV label="Auth" value="None — fully public, read-only" />
        <KV label="Rate limit" value="Cloudflare-throttled (no hard 429)" />
        <KV label="Docs" value="https://docs.polymarket.com/developers/gamma-markets-api/overview" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Search Strategy (ordered)</h4>
        <Table
          headers={['Phase', 'Method', 'Endpoint', 'Speed']}
          rows={[
            ['1', 'Direct slug path', 'GET /markets/slug/<slug>', 'O(1)'],
            ['2', 'Text query', 'GET /markets?text_query=iran ceasefire', 'Full-text'],
            ['3', 'Tag filter', 'GET /markets?tag=iran', 'Broadest'],
          ]}
        />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">outcomePrices Parsing</h4>
        <p className="text-zinc-400 text-xs mb-1">⚠ Stringified JSON array of strings — double parse required</p>
        <CodeBlock>{`raw = market["outcomePrices"]      # '["0.35","0.65"]'\nparsed = json.loads(raw)           # ["0.35", "0.65"]\nyes_price = float(parsed[0])       # 0.35`}</CodeBlock>

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Fast-Fail Logic</h4>
        <p>Pre-flight DNS+TCP check in 5s. Early abort after 2 timeouts. Split timeouts: 5s connect / 15s read.</p>
      </Section>

      {/* 3. Bonbast */}
      <Section title="3. Bonbast — Iranian Rial Black Market Rate (30%)" badge="weighted">
        <p className="mb-3">Tracks USD/IRR black market rate. Rial strengthening = peace signal. Weakening = war signal.</p>

        <KV label="URL" value="https://bonbast.com" mono />
        <KV label="Method" value="Token extraction → POST /json (primary), HTML scrape (fallback)" />
        <KV label="Rate format" value="Toman (1 Toman = 10 Rial), current ~84,000" />
        <KV label="Protection" value="Cloudflare, token rotation" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Two-Step API Flow</h4>
        <CodeBlock>{`1. GET bonbast.com → extract token from JS\n2. POST bonbast.com/json {param: token} → JSON with usd1, usd2\n   Headers: X-Requested-With: XMLHttpRequest, Referer: bonbast.com`}</CodeBlock>

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Validation</h4>
        <Table
          headers={['Check', 'Rule', 'Action']}
          rows={[
            ['Range (Toman)', '50,000 – 150,000', 'Reject if outside'],
            ['Range (Rial)', '500,000 – 1,500,000', 'Accept as-is'],
            ['Outlier', '>30% diff from last', 'Reject'],
            ['History purge', 'Invalid entries', 'Auto-clean on load'],
          ]}
        />
      </Section>

      {/* 4. NASA FIRMS */}
      <Section title="4. NASA FIRMS — Satellite Thermal Anomaly" badge="override">
        <p className="mb-3">VIIRS satellite detects thermal anomalies at critical infrastructure. Alerts only when hits exceed daily industrial baseline.</p>

        <KV label="Primary URL" value="Regional API: /api/area/csv/... (44,22,64,40)" mono />
        <KV label="Fallback" value="Global CSV: J1_VIIRS_C2_Global_24h.csv" />
        <KV label="Auth" value="None — free public data" />
        <KV label="Resolution" value="375 meters (VIIRS)" />
        <KV label="Latency" value="~3 hours from observation" />
        <KV label="Docs" value="https://firms.modaps.eosdis.nasa.gov/" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Filters Applied</h4>
        <Table
          headers={['Filter', 'What it removes']}
          rows={[
            ['Nighttime only', 'Sun glint false positives (daytime)'],
            ['confidence="l" + FRP<50', 'Low-quality marginal detections'],
            ['14 known flare sites', 'Permanent industrial thermal (refineries, LNG)'],
            ['Baseline subtraction', 'Normal daily count per region'],
          ]}
        />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Region Baselines</h4>
        <Table
          headers={['Region', 'Baseline/day', 'Why']}
          rows={[
            ['South Pars', '5', "World's largest gas field — always flaring"],
            ['Strait Hormuz', '3', 'Tightened box, some shipping thermal'],
            ['Kharg Island', '1', 'Oil terminal operations'],
            ['Ras Tanura', '1', 'Saudi oil terminal'],
            ['Bushehr Nuclear', '0', 'Any hit is significant'],
          ]}
        />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Cross-Signal Validation</h4>
        <p>If Hormuz vessels flowing normally (score {">"} 60) while FIRMS fires, alert is downgraded. Ships don't transit through active strike zones.</p>
      </Section>

      {/* 5. Flightradar24 */}
      <Section title="5. Flightradar24 — Gulf Airspace Monitoring" badge="override">
        <p className="mb-3">Counts commercial flights in Gulf airspace. Near-zero = NOTAM closure = military ops likely. Unofficial API, no SLA.</p>

        <KV label="URL" value="data-live.flightradar24.com/zones/fcgi/feed.js" mono />
        <KV label="Auth" value="None (public endpoint)" />
        <KV label="Rate limit" value="~1 req per 5 seconds (practical)" />
        <KV label="Bounds" value="north=28, south=22, west=50, east=62" />
        <KV label="Alert threshold" value="< 20 flights" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Response Parsing</h4>
        <p>Each aircraft is a JSON array with 18 elements, keyed by hex ICAO code. We count entries with <code className="text-emerald-400 text-xs">len(v) {">"}= 13</code> to distinguish from metadata.</p>

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">⚠ Unofficial Endpoint</h4>
        <p>May break without notice. Official API at fr24api.flightradar24.com starts ~$500/month.</p>
      </Section>

      {/* 6. Telegram */}
      <Section title="6. Telegram Bot API — Alert Delivery" badge="output">
        <p className="mb-3">Interrupt-only alerts on zone transitions, large CPI moves, and critical overrides. No morning briefs, no trade recs.</p>

        <KV label="Base URL" value="api.telegram.org/bot{TOKEN}/sendMessage" mono />
        <KV label="Parse mode" value="HTML" />
        <KV label="Rate limit" value="1 msg/sec per chat, 30 msg/sec global" />
        <KV label="Docs" value="https://core.telegram.org/bots/api" />

        <h4 className="text-zinc-200 font-semibold mt-4 mb-2">Error Handling</h4>
        <Table
          headers={['HTTP', 'Meaning', 'Action']}
          rows={[
            ['200', 'Success', 'Done'],
            ['400', 'Bad request', 'Don\'t retry — log to disk'],
            ['401', 'Invalid token', 'Don\'t retry — fix config'],
            ['403', 'Bot blocked', 'Don\'t retry — user must /start'],
            ['429', 'Rate limited', 'Wait retry_after seconds'],
            ['5xx', 'Server error', 'Retry with backoff'],
          ]}
        />
        <p className="mt-2 text-zinc-400 text-xs">3 attempts max. On failure, message saved to <code className="text-emerald-400">alert_log.json</code> — nothing silently lost.</p>
      </Section>

      {/* Data Flow */}
      <Section title="Data Flow" defaultOpen={false}>
        <CodeBlock>{`[AISstream WSS]  → hormuz.py     → score + confidence  ─┐
[Gamma API REST] → polymarket.py → score + confidence   ├→ cpi_engine.py
[Bonbast HTTP]   → bonbast.py    → score + confidence  ─┤  ├ confidence-weighted CPI
[FIRMS CSV]      → nasa_firms.py → alert (T/F/None)    ─┤  ├ zone classification
[FR24 REST]      → flightradar.py→ alert (T/F)         ─┘  ├ Bayesian scenario shifts
                                                            └ cross-signal validation
                                                                    │
                                                      ┌────────────┘
                                                      ▼
                                              alerts.py → Telegram
                                              scheduler.py → JSON → Next.js dashboard`}</CodeBlock>
      </Section>

      {/* Cross-Reference */}
      <Section title="Signal Interaction Matrix" defaultOpen={false}>
        <Table
          headers={['If...', 'And...', 'Then...']}
          rows={[
            ['Hormuz > 60', 'FIRMS alert fires', 'FIRMS downgraded to "info"'],
            ['Hormuz > 60', 'FIRMS above baseline', 'FIRMS → "warning" + note'],
            ['Hormuz < 25', 'FIRMS alert fires', 'FIRMS stays "critical"'],
            ['Hormuz > 70', 'Any', 'ceasefire +5, attrition -3'],
            ['Hormuz < 25', 'Any', 'hormuz_closure +12, infra_hit +5'],
            ['Bonbast +3%', 'Any', 'ceasefire +8, trump_putin +3'],
            ['Bonbast -3%', 'Any', 'hormuz_closure +3, mojtaba +2'],
            ['Polymarket > 60%', 'Any', 'ceasefire +12, depletion +4'],
            ['Polymarket < 20%', 'Any', 'ceasefire -10, attrition +5'],
          ]}
        />
      </Section>

      <div className="text-center text-zinc-600 text-xs mt-8 pb-8">
        War Room CPI v2 — Last updated 2026-03-25
      </div>
    </div>
  );
}
