// ─────────────────────────────────────────────
// AI Prompt Templates
// ─────────────────────────────────────────────
// Centralized, structured prompts for all AI
// analysis tasks. Each prompt requests JSON output
// for reliable downstream parsing.

import { ChartState } from "../types/chart";
import { TradeSignal } from "../types/signals";

export const SYSTEM_PROMPTS = {
    tradeAnalyst: `You are an expert institutional Forex/Gold/Crypto trade analyst with 20+ years of experience.
You analyze chart conditions, indicator signals, and market structure with extreme precision.
You always provide structured, actionable analysis with clear confidence levels and risk assessment.
You respond ONLY with valid JSON — no markdown, no explanations outside the JSON structure.`,

    signalDetector: `You are a real-time market signal detection engine.
You analyze chart state data (price, indicators, momentum) and identify high-probability trade setups.
You detect: entry zones, reversals, breakouts, trend confirmations, take-profit targets, stop-loss dangers, and institutional liquidity zones.
You respond ONLY with valid JSON — no markdown, no explanations outside the JSON structure.`,

    chartSummarizer: `You are a concise market analyst.
You summarize chart conditions in 2-3 sentences, highlighting the most important observations.
Focus on trend direction, key levels, and momentum.`,
};

export function buildTradeAnalysisPrompt(signal: TradeSignal, chartState: ChartState | null): string {
    const chartContext = chartState
        ? `
Current Chart Context:
- Symbol: ${chartState.symbol}
- Timeframe: ${chartState.timeframe}
- Current Price: ${chartState.currentPrice}
- Price Change: ${chartState.priceChange} (${chartState.priceChangePercent}%)
- Active Indicators: ${chartState.activeIndicators.map((i) => i.name).join(", ")}
- Indicator Values: ${JSON.stringify(
              chartState.activeIndicators.reduce<Record<string, Record<string, string>>>((acc, i) => {
                  acc[i.name] = i.values;
                  return acc;
              }, {})
          )}
`
        : "No chart context available.";

    return `Analyze this trade signal and provide a structured assessment.

Signal Details:
- Type: ${signal.type}
- Direction: ${signal.direction}
- Price: ${signal.price}
- Source: ${signal.source}
- Timestamp: ${signal.timestamp.toISOString()}
- Raw Data: ${JSON.stringify(signal.rawData)}

${chartContext}

Respond with this exact JSON structure:
{
  "confidence": <number 0-100>,
  "direction": "<LONG|SHORT|NEUTRAL>",
  "riskLevel": "<LOW|MEDIUM|HIGH|EXTREME>",
  "continuationProbability": <number 0-100>,
  "targetExpectation": {
    "tp1": <number|null>,
    "tp2": <number|null>,
    "tp3": <number|null>,
    "stopLoss": <number|null>
  },
  "reasoning": "<detailed analysis string>",
  "recommendation": "<clear action recommendation>"
}`;
}

export function buildSignalDetectionPrompt(chartState: ChartState): string {
    const indicatorSummary = chartState.activeIndicators
        .map((ind) => `  - ${ind.name}: ${ind.status}${Object.keys(ind.values).length > 0 ? ` | Values: ${JSON.stringify(ind.values)}` : ""}`)
        .join("\n");

    return `Analyze the following real-time chart data and detect any potential trade signals.

Market Data:
- Symbol: ${chartState.symbol}
- Timeframe: ${chartState.timeframe}
- Current Price: ${chartState.currentPrice}
- Price Change: ${chartState.priceChange} (${chartState.priceChangePercent}%)

Active Indicators:
${indicatorSummary || "  No indicators detected"}

Last Candle:
${chartState.lastCandle
        ? `  O: ${chartState.lastCandle.open} | H: ${chartState.lastCandle.high} | L: ${chartState.lastCandle.low} | C: ${chartState.lastCandle.close} | V: ${chartState.lastCandle.volume}`
        : "  No candle data available"
    }

Detect any of the following signal types:
1. ENTRY_ZONE — Strong buy/sell entry area
2. REVERSAL — Price reversal zone
3. BREAKOUT — Breakout from consolidation
4. TREND_CONFIRMATION — Trend continuation signal
5. TAKE_PROFIT — Take profit target reached
6. STOP_LOSS_DANGER — Price approaching stop loss
7. LIQUIDITY_ZONE — Institutional liquidity area

Respond with this exact JSON structure:
{
  "signalsDetected": true|false,
  "signals": [
    {
      "type": "<signal type from list above>",
      "direction": "<LONG|SHORT|NEUTRAL>",
      "confidence": <number 0-100>,
      "priceLevel": <number>,
      "reasoning": "<explanation>"
    }
  ],
  "marketSummary": "<1-2 sentence market condition summary>",
  "overallBias": "<BULLISH|BEARISH|NEUTRAL>"
}`;
}

export function buildChartSummaryPrompt(chartState: ChartState): string {
    return `Provide a brief market summary for:

Symbol: ${chartState.symbol} (${chartState.timeframe})
Price: ${chartState.currentPrice} (${chartState.priceChangePercent}%)
Indicators: ${chartState.activeIndicators.map((i) => `${i.name}(${i.status})`).join(", ")}

Summarize in 2-3 sentences: current trend, key observations, and immediate outlook.`;
}
