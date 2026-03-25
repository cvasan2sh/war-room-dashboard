# GAP ANALYSIS RESULT — War Room CPI Integration
Generated: 2026-03-25

## EXISTING WARROOM PROJECT

### What exists
| Component | Location | Tech | Status |
|-----------|----------|------|--------|
| Dashboard (Bayesian) | `src/app/page.tsx` | Next.js 16 + React 19 | Working |
| AI Refresh API | `src/app/api/ai-refresh/route.ts` | Claude/GPT-4o/Gemini | Working |
| Market Data API | `src/app/api/market-data/route.ts` | Yahoo Finance | Working |
| Bayesian Engine | `src/lib/bayesian.ts` | TypeScript | Working |
| 7 Scenarios + 10 Actors | `src/lib/initial-data.ts` | TypeScript | Working |
| Type System | `src/lib/types.ts` | TypeScript | Working |
| UAT Quality Gate | `scripts/uat.mjs` | Node.js | Working |

### What was missing
- ❌ No Telegram bot or alerts
- ❌ No signal collectors (AIS, NetBlocks, Polymarket, etc.)
- ❌ No CPI composite scoring
- ❌ No scheduler / background jobs
- ❌ No morning brief generation
- ❌ No data/history.json pipeline
- ❌ No real-time war signal monitoring

### Conflicts / Overlaps
- Dashboard: Existing Next.js dashboard is scenario-focused (Bayesian). CPI adds a signal-focused layer.
  → Resolution: Added CPI as a new tab in the existing dashboard
- No scheduler conflict (none existed)
- No Telegram conflict (none existed)
- No signal conflict (none existed)

---

## WHAT WAS BUILT

### Python CPI Backend (`cpi/`)
| File | Purpose |
|------|---------|
| `config.py` | API keys (placeholder), weights, thresholds, trading context |
| `cpi_engine.py` | Composite CPI scoring with independence groups + confluence checks |
| `alerts.py` | Telegram alert system with priority levels |
| `morning_brief.py` | 8:45 AM IST daily summary generator |
| `scheduler.py` | Main orchestrator — 15-min signal collection loop |
| `validate.py` | Signal health checker with noise/correlation analysis |
| `backtest.py` | June 2025 war calibration (lead time analysis) |
| `requirements.txt` | Python dependencies |
| `signals/hormuz.py` | AIS vessel tracking in Strait of Hormuz (WebSocket) |
| `signals/netblocks.py` | Iran internet connectivity (NetBlocks + Cloudflare fallback) |
| `signals/polymarket.py` | Ceasefire prediction market odds |
| `signals/iranwarlive.py` | Conflict event keyword analysis |
| `signals/bonbast.py` | Iranian Rial black market rate scraper |
| `signals/gpsjam.py` | GPS spoofing density in Gulf region |
| `signals/diplomatic.py` | RSS keyword scanner (Dawn, Geo — Pakistan/Oman/Turkey) |
| `signals/flightradar.py` | Gulf airspace closure detector (optional, not in CPI) |
| `signals/nasa_firms.py` | Thermal anomaly detector via NASA FIRMS (optional) |

### Next.js Dashboard Integration
| File | Change |
|------|--------|
| `src/app/api/cpi-data/route.ts` | NEW — API route serving CPI data from Python output |
| `src/app/page.tsx` | MODIFIED — Added CPI tab with full signal dashboard |

### Data Flow
```
Python scheduler.py (every 15 min)
  → Collects 7 signals concurrently
  → Computes CPI score (0-100)
  → Sends Telegram alerts if thresholds crossed
  → Writes to cpi/data/history.json + public/data/history.json + latest.json

Next.js dashboard (polls every 30s)
  → Fetches /api/cpi-data
  → Renders CPI score, signal breakdown, alerts, trade recs
```

---

## INTEGRATION APPROACH USED

Since the warroom already had a working Next.js dashboard:
- ✅ Added CPI as a NEW TAB (did not replace anything)
- ✅ Reused the existing dark terminal aesthetic
- ✅ Python backend writes to `public/data/` so Next.js can serve it
- ✅ No web server needed for CPI — reads JSON files
- ✅ Both systems run independently (Next.js dashboard + Python scheduler)

---

## VALIDATION STATUS

- ✅ 16/16 Python files compile without errors
- ✅ Backtest calibration completed (data/backtest_results.json)
- ✅ All signal collectors have error handling and fallbacks
- ✅ CPI engine has confluence checks and false positive prevention
- ⏳ Live signal check pending (requires API keys)
- ⏳ Telegram alerts pending (requires bot token + chat ID)
- ⏳ Next.js build pending (requires npm install on Siva's machine)

---

## NEXT STEPS FOR SIVA

1. Fill in `cpi/config.py` with 3 API keys (see SETUP.md)
2. Run `cd cpi && python scheduler.py` to start CPI backend
3. Run `npm run dev` to start the Next.js dashboard
4. Check the CPI tab in the dashboard
5. Verify Telegram alerts arrive on your phone
