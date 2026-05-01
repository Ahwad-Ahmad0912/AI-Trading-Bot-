// ─────────────────────────────────────────────
// Alert Manager — Signal Routing & Notification
// ─────────────────────────────────────────────
// Listens for signal:detected and signal:classified
// events, formats alerts, deduplicates, and outputs
// to terminal and log files.

import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { tradeAnalyzer } from "../ai-engine/trade-analyzer";
import { TradeSignal, SignalClassification, AlertPayload, AlertSeverity } from "../types/signals";

export class AlertManager {
    private recentAlerts: Map<string, Date> = new Map();
    private alertHistory: AlertPayload[] = [];
    private isRunning = false;

    /** Start listening for signals and generating alerts */
    start(): void {
        logger.info("Alert Manager starting...", "alert");

        // Listen for detected signals
        eventBus.on("signal:detected", async (signal: TradeSignal) => {
            await this.handleSignal(signal);
        });

        // Listen for classified signals (from webhook or other sources)
        eventBus.on("signal:classified", (classification: SignalClassification) => {
            this.logClassification(classification);
        });

        // Listen for webhook alerts
        eventBus.on("alert:webhook", async (data: { body: Record<string, unknown> }) => {
            logger.alert("Webhook alert received", data.body);
        });

        // Listen for system errors
        eventBus.on("system:error", (data: { component: string; error: string }) => {
            logger.error(`System error in ${data.component}: ${data.error}`, "error");
        });

        // Listen for script errors
        eventBus.on("script:error", (script) => {
            logger.error(`Script error: "${script.name}" — ${script.errorMessage}`, "automation");
        });

        this.isRunning = true;
        logger.info("Alert Manager active", "alert");
    }

    /** Stop the alert manager */
    stop(): void {
        this.isRunning = false;
        logger.info("Alert Manager stopped", "alert");
    }

    /** Get alert history */
    getHistory(): AlertPayload[] {
        return [...this.alertHistory];
    }

    /** Get recent alerts (within deduplication window) */
    getRecentAlerts(): AlertPayload[] {
        const windowMs = getConfig().alerts.deduplicationWindowMs;
        const cutoff = Date.now() - windowMs;
        return this.alertHistory.filter((a) => a.timestamp.getTime() > cutoff);
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Private Methods ──

    private async handleSignal(signal: TradeSignal): Promise<void> {
        // Deduplication check
        const dedupKey = `${signal.type}-${signal.direction}-${signal.symbol}`;
        const windowMs = getConfig().alerts.deduplicationWindowMs;
        const lastAlert = this.recentAlerts.get(dedupKey);

        if (lastAlert && Date.now() - lastAlert.getTime() < windowMs) {
            logger.debug(`Alert deduplicated: ${dedupKey}`, "alert");
            return;
        }

        // Run AI analysis on the signal
        let classification: SignalClassification | null = null;
        try {
            classification = await tradeAnalyzer.analyzeSignal(signal);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`AI analysis failed for signal: ${msg}`, "ai");
        }

        // Determine severity
        const severity = this.determineSeverity(signal, classification);

        // Build alert
        const alert: AlertPayload = {
            id: `alert_${Date.now()}`,
            severity,
            signal,
            classification,
            message: this.formatAlertMessage(signal, classification),
            timestamp: new Date(),
        };

        // Store and deduplicate
        this.recentAlerts.set(dedupKey, new Date());
        this.alertHistory.push(alert);

        // Keep history bounded
        if (this.alertHistory.length > 500) {
            this.alertHistory = this.alertHistory.slice(-250);
        }

        // Clean old dedup entries
        this.cleanDedupCache();

        // Emit alert
        eventBus.emit("alert:fired", alert);

        // Output to terminal with formatting
        this.printAlert(alert);
    }

    private logClassification(classification: SignalClassification): void {
        logger.ai(
            `Classification: ${classification.direction} | Confidence: ${classification.confidence}% | Risk: ${classification.riskLevel}`,
            {
                signalId: classification.signalId,
                tp1: classification.targetExpectation.tp1,
                tp2: classification.targetExpectation.tp2,
                stopLoss: classification.targetExpectation.stopLoss,
            }
        );
    }

    private determineSeverity(
        signal: TradeSignal,
        classification: SignalClassification | null
    ): AlertSeverity {
        if (!classification) return "INFO";

        if (classification.confidence >= 80 && classification.riskLevel !== "EXTREME") {
            return "CRITICAL";
        }
        if (classification.confidence >= 60) {
            return "WARNING";
        }
        return "INFO";
    }

    private formatAlertMessage(
        signal: TradeSignal,
        classification: SignalClassification | null
    ): string {
        const parts: string[] = [
            `${signal.type} detected on ${signal.symbol} (${signal.timeframe})`,
            `Direction: ${signal.direction} | Price: ${signal.price}`,
        ];

        if (classification) {
            parts.push(
                `Confidence: ${classification.confidence}% | Risk: ${classification.riskLevel}`,
                `Continuation: ${classification.continuationProbability}%`
            );

            if (classification.targetExpectation.tp1) {
                parts.push(`TP1: ${classification.targetExpectation.tp1}`);
            }
            if (classification.targetExpectation.stopLoss) {
                parts.push(`SL: ${classification.targetExpectation.stopLoss}`);
            }
            if (classification.recommendation) {
                parts.push(`Recommendation: ${classification.recommendation}`);
            }
        }

        return parts.join(" | ");
    }

    private printAlert(alert: AlertPayload): void {
        const colors = {
            CRITICAL: "\x1b[31m\x1b[1m", // Bold Red
            WARNING: "\x1b[33m\x1b[1m",  // Bold Yellow
            INFO: "\x1b[36m",             // Cyan
        };
        const reset = "\x1b[0m";
        const color = colors[alert.severity];

        console.log("");
        console.log(`${color}${"═".repeat(70)}${reset}`);
        console.log(`${color}  🔔 ${alert.severity} ALERT — ${alert.signal.type}${reset}`);
        console.log(`${color}${"═".repeat(70)}${reset}`);
        console.log(`  Symbol:     ${alert.signal.symbol} (${alert.signal.timeframe})`);
        console.log(`  Direction:  ${alert.signal.direction}`);
        console.log(`  Price:      ${alert.signal.price}`);
        console.log(`  Source:     ${alert.signal.source}`);

        if (alert.classification) {
            const c = alert.classification;
            console.log(`  Confidence: ${c.confidence}%`);
            console.log(`  Risk:       ${c.riskLevel}`);
            console.log(`  Continue:   ${c.continuationProbability}%`);
            if (c.targetExpectation.tp1) console.log(`  TP1:        ${c.targetExpectation.tp1}`);
            if (c.targetExpectation.tp2) console.log(`  TP2:        ${c.targetExpectation.tp2}`);
            if (c.targetExpectation.tp3) console.log(`  TP3:        ${c.targetExpectation.tp3}`);
            if (c.targetExpectation.stopLoss) console.log(`  Stop Loss:  ${c.targetExpectation.stopLoss}`);
            console.log(`  Reasoning:  ${c.reasoning}`);
            console.log(`  Action:     ${c.recommendation}`);
        }

        console.log(`  Time:       ${alert.timestamp.toISOString()}`);
        console.log(`${color}${"═".repeat(70)}${reset}`);
        console.log("");

        // Also log structured
        logger.alert(alert.message, {
            alertId: alert.id,
            severity: alert.severity,
            signal: alert.signal.type,
            direction: alert.signal.direction,
            confidence: alert.classification?.confidence,
        });
    }

    private cleanDedupCache(): void {
        const windowMs = getConfig().alerts.deduplicationWindowMs;
        const cutoff = Date.now() - windowMs;
        for (const [key, date] of this.recentAlerts) {
            if (date.getTime() < cutoff) {
                this.recentAlerts.delete(key);
            }
        }
    }
}

// Singleton
export const alertManager = new AlertManager();
