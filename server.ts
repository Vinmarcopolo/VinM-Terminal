import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Initialize server-side Gemini client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Endpoint for terminal AI intelligence streaming
app.post('/api/terminal/query', async (req: Request, res: Response) => {
  const { query, marketContext } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Query parameter required' });
    return;
  }

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY);

  if (!apiKeyPresent) {
    const notice = `\n[V.TERMINAL LOCAL ENGINE ACTIVE]\nNOTICE: GEMINI_API_KEY not detected in server environment.\nGenerating quantitative heuristic response:\n> Query: "${query}"\n\n[MARKET ASSESSMENT]\nAnalysis of currently buffered asset flows indicates elevated dispersion across high-beta equities and sovereign duration. Institutional dark-pool blocks continue to price skewed tail risk.\n\n[KEY LEVELS TO MONITOR]\n- S&P 500 (SPX): 5,820 (Support) / 5,910 (Breakout Pivot)\n- US 10-Year Yield: 4.02% / 4.15% Range\n- WTI Crude: $72.50 key resistance / $69.80 demand shelf\n\n[DISCLAIMER: NOT FINANCIAL ADVICE]\n`;
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
- Use bracketed terminal tags: [SUMMARY], [MACRO IMPLICATIONS], [ASSET CROSS-IMPACT], [RISK METRICS], [EXECUTION/ACTIONABLE LEVELS].
- Use ASCII dividers (e.g. "--------------------------------------------------") or clean tabular ASCII columns where relevant.
- Be razor-sharp, analytical, highly specific, and numbers-driven. Avoid conversational filler or introductory pleasantries ("Sure, here is...").
- Conclude every query response with "[V.TERMINAL NOTICE: SAMPLE / SIMULATION ENVIRONMENT - NOT FINANCIAL ADVICE]".`;

    const contents = `${contextPrompt}\nUSER TERMINAL QUERY: ${query}`;

    const stream = await ai.models.generateContentStream({
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
    const errorMsg = `\n[UPSTREAM SERVICE ANOMALY]\nCode: 502_STREAM_ABORT\nMessage: ${error?.message || 'Gemini inference timeout'}\nLocal Fallback: Use standard terminal built-in commands (help, status, theme, clear).\n`;
    res.write(`data: ${JSON.stringify({ text: errorMsg })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
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

startServer().catch((err) => {
  console.error('[V.TERMINAL] Failed to start server:', err);
  process.exit(1);
});
