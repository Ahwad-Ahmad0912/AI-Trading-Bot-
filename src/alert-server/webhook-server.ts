// ─────────────────────────────────────────────
// Webhook Server — Hardened Alert Receiver
// ─────────────────────────────────────────────
// Receives TradingView webhook alerts, validates
// them, and routes to the AI analysis pipeline.

import express, { Request, Response, NextFunction } from "express";
import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { tradeAnalyzer } from "../ai-engine/trade-analyzer";
import { TradeSignal, WebhookAlert } from "../types/signals";
import { chartMonitor } from "../tradingview-bridge/chart-monitor";
import { pineDeployer } from "../tradingview-bridge/pine-deployer";
import { scriptMonitor } from "../tradingview-bridge/script-monitor";
import { signalDetector } from "../ai-engine/signal-detector";
import { alertManager } from "./alert-manager";
import http from "http";

export class WebhookServer {
    private app = express();
    private server: http.Server | null = null;
    private isRunning = false;
    private requestCount = 0;

    constructor() {
        this.setupMiddleware();
        this.setupRoutes();
    }

    /** Start the webhook server */
    async start(): Promise<void> {
        const config = getConfig().alerts;

        return new Promise<void>((resolve, reject) => {
            try {
                this.server = this.app.listen(config.webhookPort, () => {
                    this.isRunning = true;
                    logger.info(
                        `Webhook server listening on http://localhost:${config.webhookPort}`,
                        "alert"
                    );
                    resolve();
                });

                this.server.on("error", (err: Error) => {
                    logger.error(`Webhook server error: ${err.message}`, "alert");
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /** Stop the server */
    async stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.isRunning = false;
                    logger.info("Webhook server stopped", "alert");
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Setup ──

    private setupMiddleware(): void {
        this.app.use(express.json({ limit: "1mb" }));

        // Request logging
        this.app.use((req: Request, _res: Response, next: NextFunction) => {
            this.requestCount++;
            logger.debug(`${req.method} ${req.path}`, "alert", {
                requestId: this.requestCount,
                ip: req.ip,
            });
            next();
        });

        // API key authentication (if configured)
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            const config = getConfig().alerts;
            if (!config.apiKey || config.apiKey === "") {
                return next(); // No auth configured
            }

            const providedKey =
                req.headers["x-api-key"] ||
                req.headers["authorization"]?.replace("Bearer ", "") ||
                (req.query as Record<string, string>)["key"];

            if (providedKey !== config.apiKey) {
                logger.warn(`Unauthorized webhook request from ${req.ip}`, "alert");
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            next();
        });
    }

    private setupRoutes(): void {
        // ── Health Check ──
        this.app.get("/health", (_req: Request, res: Response) => {
            res.json({
                status: "ok",
                uptime: process.uptime(),
                requests: this.requestCount,
                components: {
                    chartMonitor: chartMonitor.running,
                    pineDeployer: pineDeployer.running,
                    scriptMonitor: scriptMonitor.running,
                    signalDetector: signalDetector.running,
                    alertManager: alertManager.running,
                },
                timestamp: new Date().toISOString(),
            });
        });

        // ── TradingView Alert Webhook ──
        this.app.post("/tv-alert", async (req: Request, res: Response) => {
            try {
                const body = req.body as WebhookAlert;

                if (!body || Object.keys(body).length === 0) {
                    res.status(400).json({ error: "Empty request body" });
                    return;
                }

                logger.alert("TradingView webhook received", body as Record<string, unknown>);
                eventBus.emit("alert:webhook", { body: body as Record<string, unknown> });

                // Convert webhook to TradeSignal
                const chartState = chartMonitor.getLastState();
                const signal: TradeSignal = {
                    id: `webhook_${Date.now()}`,
                    timestamp: new Date(),
                    symbol: body.symbol || chartState?.symbol || "UNKNOWN",
                    timeframe: body.timeframe || chartState?.timeframe || "",
                    type: this.parseSignalType(body.action || body.message),
                    direction: this.parseDirection(body.action),
                    price: body.price || chartState?.currentPrice || 0,
                    source: body.strategy || "TradingView Webhook",
                    rawData: body as Record<string, unknown>,
                };

                // Run AI analysis
                const analysis = await tradeAnalyzer.analyzeSignal(signal, chartState);

                // Emit signal for alert manager
                eventBus.emit("signal:detected", signal);

                res.json({
                    ok: true,
                    signalId: signal.id,
                    analysis: {
                        confidence: analysis.confidence,
                        direction: analysis.direction,
                        riskLevel: analysis.riskLevel,
                        recommendation: analysis.recommendation,
                    },
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`Webhook processing error: ${msg}`, "alert");
                res.status(500).json({ error: "Internal processing error" });
            }
        });

        // ── Status Dashboard ──
        this.app.get("/status", (_req: Request, res: Response) => {
            const chartState = chartMonitor.getLastState();
            res.json({
                chart: chartState
                    ? {
                          symbol: chartState.symbol,
                          timeframe: chartState.timeframe,
                          price: chartState.currentPrice,
                          priceChange: chartState.priceChangePercent,
                          indicators: chartState.activeIndicators.length,
                          indicatorErrors: chartState.activeIndicators.filter(
                              (i) => i.status === "error"
                          ).length,
                      }
                    : null,
                scripts: {
                    deployed: pineDeployer.getDeployedScripts().length,
                    active: scriptMonitor.getActiveScripts().length,
                    errors: scriptMonitor.getErrorScripts().length,
                },
                alerts: {
                    recent: alertManager.getRecentAlerts().length,
                    total: alertManager.getHistory().length,
                },
                events: eventBus.getStats(),
                timestamp: new Date().toISOString(),
            });
        });

        // ── Manual Signal Detection Trigger ──
        this.app.post("/detect", async (_req: Request, res: Response) => {
            try {
                const signals = await signalDetector.runDetection();
                res.json({
                    ok: true,
                    signalsFound: signals.length,
                    signals: signals.map((s) => ({
                        id: s.id,
                        type: s.type,
                        direction: s.direction,
                        price: s.price,
                    })),
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                res.status(500).json({ error: msg });
            }
        });

        // ── Deploy Pine Script ──
        this.app.post("/deploy", async (req: Request, res: Response) => {
            try {
                const { filePath } = req.body as { filePath: string };
                if (!filePath) {
                    res.status(400).json({ error: "filePath is required" });
                    return;
                }

                const result = await pineDeployer.deployFile(filePath);
                res.json(result);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                res.status(500).json({ error: msg });
            }
        });
    }

    // ── Helpers ──

    private parseSignalType(action?: string): "ENTRY_ZONE" | "TAKE_PROFIT" | "STOP_LOSS_DANGER" | "CUSTOM" {
        if (!action) return "CUSTOM";
        const lower = action.toLowerCase();
        if (lower.includes("buy") || lower.includes("sell") || lower.includes("entry")) return "ENTRY_ZONE";
        if (lower.includes("tp") || lower.includes("profit")) return "TAKE_PROFIT";
        if (lower.includes("sl") || lower.includes("stop")) return "STOP_LOSS_DANGER";
        return "CUSTOM";
    }

    private parseDirection(action?: string): "LONG" | "SHORT" | "NEUTRAL" {
        if (!action) return "NEUTRAL";
        const lower = action.toLowerCase();
        if (lower.includes("buy") || lower.includes("long")) return "LONG";
        if (lower.includes("sell") || lower.includes("short")) return "SHORT";
        return "NEUTRAL";
    }
}

// Singleton
export const webhookServer = new WebhookServer();
