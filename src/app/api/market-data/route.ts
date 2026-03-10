import { NextResponse } from 'next/server';

// Fetch market data from free APIs
// Uses Yahoo Finance v8 API (unofficial but widely used)
async function fetchYahooQuote(symbol: string): Promise<{ price: number; change: number; changePct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Fetch all market data in parallel
    const [nifty, oil, inr, vix] = await Promise.all([
      fetchYahooQuote('^NSEI'),      // Nifty 50
      fetchYahooQuote('BZ=F'),       // Brent Crude Futures
      fetchYahooQuote('INR=X'),      // USD/INR
      fetchYahooQuote('^INDIAVIX'),  // India VIX
    ]);

    const marketData = {
      nifty: nifty?.price ?? 0,
      niftyChange: nifty?.change ?? 0,
      niftyChangePct: nifty?.changePct ?? 0,
      oil: oil?.price ?? 0,
      oilChange: oil?.change ?? 0,
      oilChangePct: oil?.changePct ?? 0,
      inr: inr?.price ?? 0,
      inrChange: inr?.change ?? 0,
      inrChangePct: inr?.changePct ?? 0,
      vix: vix?.price ?? 0,
      vixChange: vix?.change ?? 0,
      vixChangePct: vix?.changePct ?? 0,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(marketData);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch market data', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
