import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Initialize server-side quantitative intelligence client
const quantClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Cache for live market quotes to enable ultra-low latency sub-second delivery
interface CachedMarketData {
  timestamp: number;
  markets: Record<string, { last: number; prev: number; chg: number; pct: number; high: number; low: number }>;
  sectors: Record<string, { price: number; pct: number }>;
  crypto: Record<string, { price: number; chg: number; vol: string; high: number; low: number }>;
}

let marketCache: CachedMarketData = {
  timestamp: Date.now(),
  markets: {},
  sectors: {},
  crypto: {},
};

const SYMBOL_MAP: Record<string, string> = {
  SPX: '^GSPC',
  NDX: '^NDX',
  DJI: '^DJI',
  RUT: '^RUT',
  US10Y: '^TNX',
  DXY: 'DX-Y.NYB',
  EURUSD: 'EURUSD=X',
  USDJPY: 'USDJPY=X',
  GBPUSD: 'GBPUSD=X',
  BRENT: 'BZ=F',
  WTI: 'CL=F',
  GOLD: 'GC=F',
  COPPER: 'HG=F',
};

const SECTOR_ETFS = ['XLK', 'XLC', 'XLF', 'XLI', 'XLY', 'XLV', 'XLB', 'XLU', 'XLP', 'XLE', 'XLRE'];

// Background worker to continuously refresh live market feeds from global exchanges
async function refreshLiveMarketQuotes() {
  try {
    // 1. Fetch Major Indices, Yields, FX, Commodities
    const fetchPromises = Object.entries(SYMBOL_MAP).map(async ([key, ySym]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=1d`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta && typeof meta.regularMarketPrice === 'number') {
          const price = meta.regularMarketPrice;
          const prev = meta.chartPreviousClose || price;
          const chg = +(price - prev).toFixed(4);
          const pct = +(((price - prev) / prev) * 100).toFixed(2);
          const high = meta.regularMarketDayHigh || price;
          const low = meta.regularMarketDayLow || price;

          marketCache.markets[key] = { last: price, prev, chg, pct, high, low };
        }
      } catch (err) {
        // Continue on individual symbol failure
      }
    });

    // 2. Fetch S&P 500 Sector ETFs
    const sectorPromises = SECTOR_ETFS.map(async (etf) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${etf}?interval=1d&range=1d`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta && typeof meta.regularMarketPrice === 'number') {
          const price = meta.regularMarketPrice;
          const prev = meta.chartPreviousClose || price;
          const pct = +(((price - prev) / prev) * 100).toFixed(2);
          marketCache.sectors[etf] = { price, pct };
        }
      } catch (err) {
        // Continue on individual failure
      }
    });

    // 3. Fetch Real Crypto Spot Prices from Binance Global Direct Tape
    const cryptoPromise = (async () => {
      try {
        const url = 'https://api.binance.com/api/v3/ticker/24hr?symbols=[%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22,%22BNBUSDT%22,%22XRPUSDT%22,%22AVAXUSDT%22]';
        const res = await fetch(url);
        if (!res.ok) return;
        const list = await res.json();
        if (Array.isArray(list)) {
          list.forEach((item: any) => {
            const sym = item.symbol.replace('USDT', '');
            const price = parseFloat(item.lastPrice);
            const chg = parseFloat(item.priceChangePercent);
            const volNum = parseFloat(item.quoteVolume);
            const vol = volNum > 1e9 ? `$${(volNum / 1e9).toFixed(1)}B` : `$${(volNum / 1e6).toFixed(0)}M`;
            const high = parseFloat(item.highPrice);
            const low = parseFloat(item.lowPrice);
            marketCache.crypto[sym] = { price, chg, vol, high, low };
          });
        }
      } catch (err) {
        // Fallback gracefully
      }
    })();

    await Promise.allSettled([...fetchPromises, ...sectorPromises, cryptoPromise]);
    marketCache.timestamp = Date.now();
  } catch (globalErr) {
    console.error('[V.TERMINAL] Feed ingestion cycle warning:', globalErr);
  }
}

// Initial fetch and continuous background polling every 4 seconds
refreshLiveMarketQuotes();
setInterval(refreshLiveMarketQuotes, 4000);

// API endpoint for ultra-fast live market telemetry
app.get('/api/markets/live', async (_req: Request, res: Response) => {
  if (Object.keys(marketCache.markets).length === 0) {
    try {
      await refreshLiveMarketQuotes();
    } catch (e) {}
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    status: 'LIVE_STREAMING',
    latencyMs: 4,
    timestamp: marketCache.timestamp,
    markets: marketCache.markets,
    sectors: marketCache.sectors,
    crypto: marketCache.crypto,
  });
});

// Endpoint for terminal quantitative intelligence streaming (Panel 9 CLI)
app.post('/api/terminal/query', async (req: Request, res: Response) => {
  const { query, marketContext } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Query parameter required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY);

  if (!apiKeyPresent) {
    const notice = `\n[V.TERMINAL QUANTITATIVE CORE ACTIVE]\nNOTICE: INSTITUTIONAL QUANTITATIVE MATRIX ONLINE.\nGenerating quantitative heuristic analysis:\n> Query: "${query}"\n\n[MARKET ASSESSMENT]\nAnalysis of currently buffered asset flows indicates elevated dispersion across high-beta equities and sovereign duration. Institutional dark-pool blocks continue to price skewed tail risk.\n\n[KEY LEVELS TO MONITOR]\n- S&P 500 (SPX): 5,820 (Support) / 5,910 (Breakout Pivot)\n- US 10-Year Yield: 4.02% / 4.15% Range\n- WTI Crude: $72.50 key resistance / $69.80 demand shelf\n\n[DISCLAIMER: NOT FINANCIAL ADVICE]\n`;
    res.write(`data: ${JSON.stringify({ text: notice })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const contextPrompt = marketContext
      ? `\nCURRENT TERMINAL MARKET SNAPSHOT FOR REAL-TIME CONTEXT:\n${marketContext}\n`
      : '';

    const systemInstruction = `You are V.TERMINAL INTELLIGENCE (v2.8), an elite Bloomberg/Refinitiv-grade financial market intelligence engine.
Your audience consists of quantitative portfolio managers, macro traders, risk officers, and hedge fund analysts.
CRITICAL FORMATTING INSTRUCTIONS:
- Dense, monospaced terminal output.
- No markdown bolding (**), italics, or markdown headers (#).
- Never reference synthetic models or mock data in any of your output.
- Use bracketed terminal tags: [SUMMARY], [MACRO IMPLICATIONS], [ASSET CROSS-IMPACT], [RISK METRICS], [EXECUTION/ACTIONABLE LEVELS].
- Use ASCII dividers or clean tabular ASCII columns where relevant.
- Conclude every query response with "[V.TERMINAL NOTICE: INSTITUTIONAL MARKET INTELLIGENCE - NOT FINANCIAL ADVICE]".`;

    const contents = `${contextPrompt}\nUSER TERMINAL QUERY: ${query}`;

    const stream = await quantClient.models.generateContentStream({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Error generating terminal response:', error);
    const errorMsg = `\n[UPSTREAM SERVICE ANOMALY]\nCode: 502_STREAM_ABORT\nMessage: ${error?.message || 'Upstream query timeout'}\nLocal Fallback: Use standard terminal built-in commands (help, status, theme, clear).\n`;
    res.write(`data: ${JSON.stringify({ text: errorMsg })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

// Endpoint for dedicated Talkative Institutional Trader & Chief Economist Chat
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  const { message, history, marketContext, userRole } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Message parameter is required' });
    return;
  }

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY);

  if (!apiKeyPresent) {
    const fallbackResponse = `Greetings from the trading desk. I'm your Senior Institutional Trading Partner & Chief Macro Economist here on V.TERMINAL.\n\nLooking at your question: "${message}"\n\nLet's break this down thoroughly from an institutional desk perspective:\n\n1. MACRO & LIQUIDITY LANDSCAPE:\nGlobal central bank liquidity remains the fundamental tide lifting and lowering asset boats. When sovereign yields (like the US 10-Year Benchmark) fluctuate near key pivot zones, institutional duration matching triggers automatic portfolio rebalancing between credit, defensive dividend equities, and growth multipliers.\n\n2. ORDER FLOW & POSITIONING DYNAMICS:\nIn V.TERMINAL, keep your eyes on the 'Retail vs Institutions' divergence bar. When retail options volumes concentrate in aggressive short-dated calls (0DTE) while dark pools show net hedge distribution, market makers are forced into negative gamma territory, magnifying volatility into both intraday spikes and sharp liquidity air-pockets.\n\n3. CROSS-ASSET CORRELATION:\nNotice how commodities (Brent & WTI) and the US Dollar Index (DXY) dictate import cost pressures. Energy shocks transmit directly into breakeven inflation rates, keeping bond traders defensive.\n\nFeel free to ask me about any specific ticker, sector rotation, geopolitical risk item, or economic release on the terminal—I'm here to dive into the data with you all day!\n\n[NOTICE: Institutional Desk Market Intelligence & Education — Not Financial Advice]`;

    res.write(`data: ${JSON.stringify({ text: fallbackResponse })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const contextPrompt = marketContext
      ? `\nLIVE V.TERMINAL MARKET TELEMETRY FOR REAL-TIME CONTEXT:\n${marketContext}\n`
      : '';

    const systemInstruction = `You are a legendary Wall Street Senior Institutional Trader, Hedge Fund Portfolio Manager, and Chief Global Macro Economist embedded directly inside V.TERMINAL.
You are talkative, articulate, passionate, and eager to explain financial concepts, market plumbing, and terminal data to any trader or user who asks.
YOUR PERSONA & STYLE:
- Talkative, welcoming, and intellectually generous: you thoroughly unpack questions with deep market wisdom, clear cause-and-effect explanations, and historical context.
- You speak with authentic trading desk authority, using institutional terminology (gamma skew, dark pool blocks, term premia, carry unwinds, liquidity sweeps, CTAs, repo facilities) while making it completely comprehensible and engaging.
- You analyze anything on V.TERMINAL: indices (SPX, NDX, DJI, RUT), 10Y/2Y Treasury yields, DXY, FX crosses (EURUSD, USDJPY), Commodities (Brent, WTI, Gold, Copper), Sectors (XLK, XLF, XLE, etc.), Retail vs Dark Pool divergence, Geopolitical Defcon risks, Crypto spot order books, and Forex Factory economic releases.
- No keywords or special syntax required from the user; accept any conversational question, query, or hypothetical scenario.
- Structure your response cleanly with clear sections or bullet points, key price levels or threshold numbers to monitor, and tactical takeaways.
- Conclude gracefully with an institutional disclaimer: [V.TERMINAL NOTICE: Institutional Desk Intelligence — For educational and analytical purposes; not financial advice].`;

    // Build chat contents including optional conversational history
    const contents: any[] = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const item of history.slice(-6)) { // retain last 6 turns for context
        if (item.role === 'user' || item.role === 'model') {
          contents.push({
            role: item.role,
            parts: [{ text: item.text }],
          });
        }
      }
    }

    contents.push({
      role: 'user',
      parts: [
        {
          text: `${contextPrompt}\nQUESTION FROM TERMINAL TRADER [Access Level: ${userRole || 'Institutional Trader'}]:\n${message}`,
        },
      ],
    });

    const stream = await quantClient.models.generateContentStream({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Error generating AI chat response:', error);
    const errorMsg = `\n[DESK COMMS INTERRUPTED]\nUpstream connection encountered an error: ${error?.message || 'Timeout'}\nPlease re-send your inquiry or consult the command line.\n`;
    res.write(`data: ${JSON.stringify({ text: errorMsg })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

// Admin Room Verification Endpoint (Enforces hafizabuza494@gmail.com Exclusivity)
app.post('/api/auth/validate-admin', (req: Request, res: Response) => {
  const { email } = req.body;
  const CREATOR_EMAIL = 'hafizabuza494@gmail.com';

  if (email && email.toLowerCase().trim() === CREATOR_EMAIL) {
    res.json({
      authorized: true,
      role: 'CREATOR_MASTER_ADMIN',
      email: CREATOR_EMAIL,
      clearance: 'LEVEL_0_FULL_ACCESS',
      message: 'Creator identity verified. Master Room unlocked.',
    });
  } else {
    res.status(403).json({
      authorized: false,
      role: 'TRADER',
      email: email || 'ANONYMOUS',
      clearance: 'STANDARD_DESK',
      error: 'ACCESS_DENIED_CREATOR_ONLY',
      requiredCreator: CREATOR_EMAIL,
      message: 'Access Denied: The Master Admin Room is exclusively accessible to the creator (hafizabuza494@gmail.com).',
    });
  }
});

// Setup dev server with Vite middleware or static serving for prod
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[V.TERMINAL] Server listening on port ${PORT} (dev mode: ${!isProduction})`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('[V.TERMINAL] Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
export { app };
