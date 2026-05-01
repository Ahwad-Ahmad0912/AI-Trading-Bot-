// ─────────────────────────────────────────────
// Signal Detector — AI-Powered Market Detection
// ─────────────────────────────────────────────
// Consumes chart:updated events, periodically
// feeds chart state to Ollama for signal detection,
// and emits signal:detected events when high-confidence
// opportunities are found.

import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { ollamaClient } from "./ollama-client";
import { SYSTEM_PROMPTS, buildSignalDetectionPrompt } from "./prompts";
import { chartMonitor } from "../tradingview-bridge/chart-monitor";
import { TradeSignal, SignalType, TradeDirection } from "../types/signals";
import { ChartState } from "../types/chart";

interface DetectedSignalRaw {
    type?: string;
    direction?: string;
    confidence?: number;
    priceLevel?: number;
    reasoning?: string;
}

interface DetectionResponse {
    signalsDetected?: boolean;
    signals?: DetectedSignalRaw[];
    marketSummary?: string;
    overallBias?: string;
}

export class SignalDetector {
    private analysisTimer: ReturnType<typeof setInterval> | null = null;
    private lastAnalysisTime = 0;
    private lastSignalHashes: Set<string> = new Set();
    private isRunning = false;
    private signalCounter = 0;

    /** Start periodic signal detection */
    async start(): Promise<void> {
        const config = getConfig().signalDetection;

        if (!config.enabled) {
            logger.info("Signal detection is disabled in config", "signal");
            return;
        }

        logger.info("Signal Detector starting...", "signal");

        // Check Ollama availability
        const ollamaReady = await ollamaClient.healthCheck();
        if (!ollamaReady) {
            logger.warn("Ollama is not available — signal detection will retry when available", "signal");
        }

        // Start periodic analysis
        this.analysisTimer = setInterval(async () => {
            await this.runDetection();
        }, config.analysisIntervalMs);

        // Also listen for chart updates to detect rapid changes
        eventBus.on("chart:updated", (state: ChartState) => {
            // Check if price moved significantly since last analysis
            if (this.shouldTriggerEarlyAnalysis(state)) {
                this.runDetection();
            }
        });

        this.isRunning = true;
        logger.info(
            `Signal Detector active — analyzing every ${config.analysisIntervalMs / 1000}s, min confidence: ${config.minConfidence}%`,
            "signal"
        );
    }

    /** Stop detection */
    stop(): void {
        if (this.analysisTimer) {
            clearInterval(this.analysisTimer);
            this.analysisTimer = null;
        }
        this.isRunning = false;
        logger.info("Signal Detector stopped", "signal");
    }

    /** Manually trigger a detection cycle */
    async runDetection(): Promise<TradeSignal[]> {
        const config = getConfig().signalDetection;

        // Cooldown check
        const now = Date.now();
        if (now - this.lastAnalysisTime < config.cooldownMs / 10) {
            return []; // Too soon since last analysis
        }
        this.lastAnalysisTime = now;

        const chartState = chartMonitor.getLastState();
        if (!chartState || !chartState.symbol) {
            logger.debug("No chart state available for signal detection", "signal");
            return [];
        }

        if (!ollamaClient.available) {
            // Try health check
            await ollamaClient.healthCheck();
            if (!ollamaClient.available) return [];
        }

        logger.debug(`Running signal detection for ${chartState.symbol} ${chartState.timeframe}...`, "signal");

        try {
            const prompt = buildSignalDetectionPrompt(chartState);
            const response = await ollamaClient.generateJSON<DetectionResponse>(
                prompt,
                SYSTEM_PROMPTS.signalDetector
            );

            if (!response || !response.signalsDetected || !response.signals?.length) {
                logger.debug("No signals detected in this cycle", "signal");
                return [];
            }

            // Log market summary
            if (response.marketSummary) {
                logger.signal(`Market: ${response.marketSummary}`, {
                    bias: response.overallBias,
                    symbol: chartState.symbol,
                });
            }

            // Process detected signals
            const signals: TradeSignal[] = [];

            for (const raw of response.signals) {
                const confidence = raw.confidence ?? 0;
                if (confidence < config.minConfidence) {
                    logger.debug(
                        `Signal below threshold: ${raw.type} (${confidence}% < ${config.minConfidence}%)`,
                        "signal"
                    );
                    continue;
                }

                // Deduplicate: skip if we've seen a very similar signal recently
                const signalHash = `${raw.type}-${raw.direction}-${Math.round((raw.priceLevel ?? 0) * 100)}`;
                if (this.lastSignalHashes.has(signalHash)) {
                    logger.debug(`Duplicate signal skipped: ${signalHash}`, "signal");
                    continue;
                }

                this.signalCounter++;
                const signal: TradeSignal = {
                    id: `sig_${Date.now()}_${this.signalCounter}`,
                    timestamp: new Date(),
                    symbol: chartState.symbol,
                    timeframe: chartState.timeframe,
                    type: this.parseSignalType(raw.type),
                    direction: this.parseDirection(raw.direction),
                    price: raw.priceLevel ?? chartState.currentPrice ?? 0,
                    source: "AI Signal Detector",
                    rawData: raw as unknown as Record<string, unknown>,
                };

                signals.push(signal);
                this.lastSignalHashes.add(signalHash);

                // Emit the signal
                eventBus.emit("signal:detected", signal);

                logger.signal(
                    `🎯 SIGNAL: ${signal.type} | ${signal.direction} | ${signal.symbol} @ ${signal.price} | Confidence: ${confidence}%`,
                    {
                        signalId: signal.id,
                        type: signal.type,
                        direction: signal.direction,
                        confidence,
                        reasoning: raw.reasoning,
                    }
                );

                // Take screenshot if configured
                if (getConfig().chartMonitor.screenshotOnSignal) {
                    chartMonitor.takeScreenshot(`signal_${signal.type}`);
                }
            }

            // Clean old signal hashes (keep last 100)
            if (this.lastSignalHashes.size > 100) {
                const arr = Array.from(this.lastSignalHashes);
                this.lastSignalHashes = new Set(arr.slice(-50));
            }

            return signals;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Signal detection failed: ${msg}`, "signal");
            return [];
        }
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Private ──

    private shouldTriggerEarlyAnalysis(state: ChartState): boolean {
        // Trigger early if there's a large price move (>0.5%)
        if (state.priceChangePercent && Math.abs(state.priceChangePercent) > 0.5) {
            const now = Date.now();
            const minInterval = getConfig().signalDetection.cooldownMs / 5;
            if (now - this.lastAnalysisTime > minInterval) {
                return true;
            }
        }
        return false;
    }

    private parseSignalType(raw?: string): SignalType {
        if (!raw) return "CUSTOM";
        const upper = raw.toUpperCase().replace(/[^A-Z_]/g, "");
        const valid: SignalType[] = [
            "ENTRY_ZONE", "REVERSAL", "BREAKOUT", "TREND_CONFIRMATION",
            "TAKE_PROFIT", "STOP_LOSS_DANGER", "LIQUIDITY_ZONE", "CUSTOM",
        ];
        return valid.find((t) => upper.includes(t.replace("_", ""))) || "CUSTOM";
    }

    private parseDirection(raw?: string): TradeDirection {
        if (!raw) return "NEUTRAL";
        const upper = raw.toUpperCase();
        if (upper.includes("LONG") || upper.includes("BUY") || upper.includes("BULL")) return "LONG";
        if (upper.includes("SHORT") || upper.includes("SELL") || upper.includes("BEAR")) return "SHORT";
        return "NEUTRAL";
    }
}

// Singleton
export const signalDetector = new SignalDetector();
