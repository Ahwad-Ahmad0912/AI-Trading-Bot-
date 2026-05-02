// ─────────────────────────────────────────────
// Trade Analyzer — Structured AI Analysis
// ─────────────────────────────────────────────
// Takes trade signals and chart state, sends them
// to Ollama for analysis, and returns structured
// SignalClassification with confidence, risk,
// direction, and target levels.

import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { ollamaClient } from "./ollama-client";
import { SYSTEM_PROMPTS, buildTradeAnalysisPrompt } from "./prompts";
import { TradeSignal, SignalClassification, TradeDirection, RiskLevel } from "../types/signals";
import { ChartState } from "../types/chart";
import { chartMonitor } from "../tradingview-bridge/chart-monitor";

interface RawClassification {
    confidence?: number;
    direction?: string;
    riskLevel?: string;
    continuationProbability?: number;
    targetExpectation?: {
        tp1?: number | null;
        tp2?: number | null;
        tp3?: number | null;
        stopLoss?: number | null;
    };
    reasoning?: string;
    recommendation?: string;
}

export class TradeAnalyzer {
    /** Analyze a trade signal with full AI classification */
    async analyzeSignal(
        signal: TradeSignal,
        chartState?: ChartState | null
    ): Promise<SignalClassification> {
        logger.ai(`Analyzing signal: ${signal.type} ${signal.direction} @ ${signal.price}`, {
            signalId: signal.id,
            source: signal.source,
        });

        // Use provided chart state or get latest from monitor
        const state = chartState ?? chartMonitor.getLastState(signal.symbol);

        const prompt = buildTradeAnalysisPrompt(signal, state);

        const rawResult = await ollamaClient.generateJSON<RawClassification>(
            prompt,
            SYSTEM_PROMPTS.tradeAnalyst
        );

        const classification = this.parseClassification(signal.id, rawResult);

        logger.ai(
            `Analysis complete: ${classification.direction} | Confidence: ${classification.confidence}% | Risk: ${classification.riskLevel}`,
            {
                signalId: signal.id,
                confidence: classification.confidence,
                direction: classification.direction,
                risk: classification.riskLevel,
            }
        );

        eventBus.emit("signal:classified", classification);

        return classification;
    }

    /** Quick analysis without full classification — returns text summary */
    async quickAnalysis(context: string): Promise<string> {
        logger.ai("Running quick analysis...");

        const result = await ollamaClient.generate(
            `Provide a brief institutional-grade analysis:\n\n${context}\n\nBe concise — 3-4 sentences max.`,
            { system: SYSTEM_PROMPTS.tradeAnalyst, temperature: 0.5 }
        );

        return result;
    }

    // ── Private ──

    private parseClassification(
        signalId: string,
        raw: RawClassification | null
    ): SignalClassification {
        if (!raw) {
            logger.warn("AI returned null/unparseable response, using defaults", "ai");
            return this.defaultClassification(signalId);
        }

        // Validate and clamp values
        const confidence = this.clamp(raw.confidence ?? 50, 0, 100);
        const continuationProbability = this.clamp(raw.continuationProbability ?? 50, 0, 100);

        const direction = this.parseDirection(raw.direction);
        const riskLevel = this.parseRiskLevel(raw.riskLevel);

        return {
            signalId,
            confidence,
            direction,
            riskLevel,
            continuationProbability,
            targetExpectation: {
                tp1: raw.targetExpectation?.tp1 ?? null,
                tp2: raw.targetExpectation?.tp2 ?? null,
                tp3: raw.targetExpectation?.tp3 ?? null,
                stopLoss: raw.targetExpectation?.stopLoss ?? null,
            },
            reasoning: raw.reasoning || "No reasoning provided by AI",
            recommendation: raw.recommendation || "No recommendation provided",
            timestamp: new Date(),
        };
    }

    private defaultClassification(signalId: string): SignalClassification {
        return {
            signalId,
            confidence: 0,
            direction: "NEUTRAL",
            riskLevel: "HIGH",
            continuationProbability: 50,
            targetExpectation: { tp1: null, tp2: null, tp3: null, stopLoss: null },
            reasoning: "AI analysis unavailable — using default conservative classification",
            recommendation: "Wait for AI to become available before acting",
            timestamp: new Date(),
        };
    }

    private parseDirection(raw?: string): TradeDirection {
        if (!raw) return "NEUTRAL";
        const upper = raw.toUpperCase();
        if (upper.includes("LONG") || upper.includes("BUY")) return "LONG";
        if (upper.includes("SHORT") || upper.includes("SELL")) return "SHORT";
        return "NEUTRAL";
    }

    private parseRiskLevel(raw?: string): RiskLevel {
        if (!raw) return "MEDIUM";
        const upper = raw.toUpperCase();
        if (upper.includes("LOW")) return "LOW";
        if (upper.includes("EXTREME")) return "EXTREME";
        if (upper.includes("HIGH")) return "HIGH";
        return "MEDIUM";
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}

// Singleton
export const tradeAnalyzer = new TradeAnalyzer();
