// ─────────────────────────────────────────────
// Chart Monitor — Continuous Chart State Reader (Multi-Chart)
// ─────────────────────────────────────────────
// Polls the TradingView DOM across all active tabs
// at regular intervals to read symbol, timeframe, price,
// candle data, and active indicator states.

import path from "path";
import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { browserController } from "./browser-controller";
import { ChartState, CandleData, IndicatorState } from "../types/chart";

export class ChartMonitor {
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private lastStates: Map<string, ChartState> = new Map();
    private isRunning = false;
    private consecutiveFailures = 0;
    private readonly maxConsecutiveFailures = 5;

    /** Start continuous chart monitoring */
    async start(): Promise<void> {
        const config = getConfig().chartMonitor;

        logger.info("Chart Monitor starting...", "browser");

        // Initial read
        try {
            await this.pollChartStates();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Initial chart read failed: ${msg}`, "browser");
        }

        // Start polling loop
        this.pollTimer = setInterval(async () => {
            try {
                await this.pollChartStates();
                this.consecutiveFailures = 0;
            } catch (err: unknown) {
                this.consecutiveFailures++;
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(`Chart poll failed (${this.consecutiveFailures}/${this.maxConsecutiveFailures}): ${msg}`, "browser");

                if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
                    logger.error("Chart monitor: too many consecutive failures, pausing...", "browser");
                    eventBus.emit("system:error", {
                        component: "ChartMonitor",
                        error: `${this.consecutiveFailures} consecutive poll failures`,
                    });
                    this.consecutiveFailures = 0;
                }
            }
        }, config.pollIntervalMs);

        this.isRunning = true;
        logger.info(`Chart Monitor active — polling every ${config.pollIntervalMs}ms`, "browser");
    }

    /** Stop monitoring */
    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.isRunning = false;
        logger.info("Chart Monitor stopped", "browser");
    }

    /** Get the last known chart state for a symbol */
    getLastState(symbol: string): ChartState | null {
        return this.lastStates.get(symbol) || null;
    }

    /** Get all known chart states */
    getAllStates(): ChartState[] {
        return Array.from(this.lastStates.values());
    }

    get running(): boolean {
        return this.isRunning;
    }

    /** Take a screenshot of the current chart */
    async takeScreenshot(symbol: string, reason: string = "manual"): Promise<string | null> {
        try {
            const config = getConfig().chartMonitor;
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const fileName = `chart_${symbol}_${timestamp}.png`;
            const savePath = path.resolve(config.screenshotDir, fileName);

            await browserController.screenshot(symbol, savePath);
            eventBus.emit("chart:screenshot", { path: savePath, reason });
            return savePath;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Screenshot failed for ${symbol}: ${msg}`, "browser");
            return null;
        }
    }

    // ── Private Methods ──

    private async pollChartStates(): Promise<void> {
        const pages = browserController.getAllPages();

        for (const chartPage of pages) {
            const { symbol, page } = chartPage;
            
            try {
                // Extract chart data from TradingView DOM
                const rawState = await page.evaluate(() => {
                    const result: {
                        symbol: string;
                        timeframe: string;
                        currentPrice: number | null;
                        priceChange: number | null;
                        priceChangePercent: number | null;
                        lastCandle: {
                            open: number;
                            high: number;
                            low: number;
                            close: number;
                            volume: number;
                        } | null;
                        indicators: Array<{
                            name: string;
                            status: string;
                            hasError: boolean;
                            values: Record<string, string>;
                        }>;
                    } = {
                        symbol: "",
                        timeframe: "",
                        currentPrice: null,
                        priceChange: null,
                        priceChangePercent: null,
                        lastCandle: null,
                        indicators: [],
                    };

                    // ── Read symbol ──
                    try {
                        const symbolEl =
                            document.querySelector('[data-name="legend-source-title"]') ||
                            document.querySelector('[class*="titleWrapper"] [class*="title"]') ||
                            document.querySelector('.chart-widget .pane-legend-title__description');

                        if (symbolEl) {
                            result.symbol = symbolEl.textContent?.trim() || "";
                        }
                    } catch { /* ignore */ }

                    // ── Read timeframe ──
                    try {
                        const tfEl =
                            document.querySelector('[data-name="time-interval-button"] [class*="value"]') ||
                            document.querySelector('[id="header-toolbar-intervals"] .isActive') ||
                            document.querySelector('.apply-common-tooltip.isActive');

                        if (tfEl) {
                            result.timeframe = tfEl.textContent?.trim() || "";
                        }
                    } catch { /* ignore */ }

                    // ── Read current price ──
                    try {
                        const priceEl =
                            document.querySelector('[class*="lastContainer"] [class*="last"]') ||
                            document.querySelector('[class*="headerItem"] [class*="last-"]') ||
                            document.querySelector('.pane-legend-line .pane-legend-item-value');

                        if (priceEl) {
                            const priceText = priceEl.textContent?.trim().replace(/[^0-9.,-]/g, "") || "";
                            result.currentPrice = parseFloat(priceText) || null;
                        }
                    } catch { /* ignore */ }

                    // ── Read price change ──
                    try {
                        const changeEl = document.querySelector('[class*="headerItem"] [class*="change"]');
                        if (changeEl) {
                            const text = changeEl.textContent?.trim() || "";
                            const parts = text.split(/[()%]/);
                            if (parts[0]) result.priceChange = parseFloat(parts[0]) || null;
                            if (parts[1]) result.priceChangePercent = parseFloat(parts[1]) || null;
                        }
                    } catch { /* ignore */ }

                    // ── Read indicators from legend ──
                    try {
                        const legendSources = document.querySelectorAll(
                            '[data-name="legend"] [class*="sources"] [class*="item"]'
                        );

                        legendSources.forEach((item) => {
                            const titleEl = item.querySelector('[class*="title"]');
                            const name = titleEl?.textContent?.trim() || "";
                            if (!name) return;

                            const hasError = !!item.querySelector('[class*="error"]');

                            const values: Record<string, string> = {};
                            const valueEls = item.querySelectorAll('[class*="value"]');
                            valueEls.forEach((valEl, idx) => {
                                const val = valEl.textContent?.trim() || "";
                                if (val) values[`value_${idx}`] = val;
                            });

                            result.indicators.push({
                                name,
                                status: hasError ? "error" : "active",
                                hasError,
                                values,
                            });
                        });
                    } catch { /* ignore */ }

                    return result;
                });

                // Overwrite the DOM-extracted symbol with our configured symbol to ensure consistency
                const displaySymbol = rawState.symbol || symbol;

                const state: ChartState = {
                    symbol: displaySymbol,
                    timeframe: rawState.timeframe,
                    currentPrice: rawState.currentPrice,
                    priceChange: rawState.priceChange,
                    priceChangePercent: rawState.priceChangePercent,
                    lastCandle: rawState.lastCandle
                        ? { ...rawState.lastCandle, timestamp: new Date() }
                        : null,
                    activeIndicators: rawState.indicators.map((ind) => ({
                        name: ind.name,
                        status: ind.hasError ? "error" as const : "active" as const,
                        type: "indicator" as const,
                        errorMessage: ind.hasError ? "Indicator has errors" : null,
                        values: ind.values,
                    })),
                    timestamp: new Date(),
                };

                const lastState = this.lastStates.get(symbol);

                if (lastState) {
                    for (const ind of state.activeIndicators) {
                        if (ind.status === "error") {
                            const wasPreviouslyOk = lastState.activeIndicators.find(
                                (prev) => prev.name === ind.name && prev.status !== "error"
                            );
                            if (wasPreviouslyOk) {
                                logger.error(`Indicator error detected on ${symbol}: ${ind.name}`, "browser");
                                eventBus.emit("script:error", {
                                    name: ind.name,
                                    type: "indicator",
                                    source: "chart",
                                    isActive: true,
                                    hasErrors: true,
                                    lastDeployed: null,
                                    errorMessage: ind.errorMessage,
                                });
                            }
                        }
                    }
                }

                this.lastStates.set(symbol, state);
                eventBus.emit("chart:updated", state);
                
            } catch (err: unknown) {
                // Ignore transient errors on individual pages during polling
            }
        }
    }
}

// Singleton
export const chartMonitor = new ChartMonitor();
