# WAR ROOM

AI-powered geopolitical risk terminal for Nifty options traders.
Bayesian probability engine with auditable math. Not investment advice.

## Quick Deploy

### 1. Push to GitHub
```bash
cd war-room-dashboard
gh repo create war-room-dashboard --public --source=. --push
```
Or manually: create a repo on GitHub, then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/war-room-dashboard.git
git push -u origin main
```

### 2. Deploy to Vercel
- Go to [vercel.com/new](https://vercel.com/new)
- Import your GitHub repo
- Add environment variables (see below)
- Deploy

### 3. Environment Variables (Vercel Dashboard → Settings → Environment Variables)

At least ONE of these is required for AI refresh to work:
```
ANTHROPIC_API_KEY=sk-ant-...     (Primary — Claude Sonnet)
OPENAI_API_KEY=sk-...            (Fallback — GPT-4o)
GOOGLE_AI_API_KEY=AIza...        (Tertiary — Gemini Flash)
```

## Architecture

```
src/
├── app/
│   ├── page.tsx              # Three-panel dashboard (client component)
│   ├── layout.tsx            # HTML shell + IBM Plex Mono font
│   ├── globals.css           # Dark terminal styles
│   └── api/
│       ├── ai-refresh/route.ts   # AI agent pipeline (Claude→GPT→Gemini fallback)
│       └── market-data/route.ts  # Live prices (Yahoo Finance)
├── lib/
│   ├── types.ts              # TypeScript interfaces
│   ├── initial-data.ts       # 10 actors, 7 scenarios, historical analogues
│   └── bayesian.ts           # Deterministic Bayesian updater (pure JS, not AI)
```

## How It Works

- **Market data** polls every 60 seconds (Nifty, Brent, INR, VIX)
- **AI refresh** runs every 4 hours (or on-demand via button)
- AI searches for latest developments, classifies evidence as FACT/REPORTED
- Bayesian engine (deterministic JavaScript) computes posterior probabilities
- Every probability change shows expandable audit trail with the math
- 7 scenarios map to Nifty ranges with historical analogues

## Local Development
```bash
npm install
npm run dev
```
Create `.env.local` with your API keys.
