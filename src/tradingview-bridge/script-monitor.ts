// ─────────────────────────────────────────────
// Script Monitor — Active Script & Favorites Tracker (Multi-Chart)
// ─────────────────────────────────────────────
// Monitors all Pine indicators/strategies deployed
// on all TradingView charts and tracks compilation
// errors and script status changes.

import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { browserController } from "./browser-controller";
import { ScriptInfo, IndicatorStatus } from "../types/chart";

export class ScriptMonitor {
    // Maps symbol -> (Maps script name -> ScriptInfo)
    private knownScripts: Map<string, Map<string, ScriptInfo>> = new Map();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private isRunning = false;

    /** Start monitoring scripts on the chart */
    async start(): Promise<void> {
        logger.info("Script Monitor starting...", "automation");

        // Initial scan
        try {
            await this.scanScripts();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Initial script scan failed: ${msg}`, "automation");
        }

        // Poll for changes
        const intervalMs = getConfig().chartMonitor.pollIntervalMs * 2; 
        this.pollTimer = setInterval(async () => {
            try {
                await this.scanScripts();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.debug(`Script scan failed: ${msg}`, "automation");
            }
        }, intervalMs);

        this.isRunning = true;
        logger.info("Script Monitor active", "automation");
    }

    /** Stop monitoring */
    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.isRunning = false;
        logger.info("Script Monitor stopped", "automation");
    }

    /** Get all known scripts for a specific symbol */
    getScripts(symbol: string): ScriptInfo[] {
        const symbolMap = this.knownScripts.get(symbol);
        return symbolMap ? Array.from(symbolMap.values()) : [];
    }

    /** Get scripts with errors across all charts */
    getErrorScripts(): { symbol: string; script: ScriptInfo }[] {
        const errors: { symbol: string; script: ScriptInfo }[] = [];
        for (const [symbol, map] of this.knownScripts.entries()) {
            for (const script of map.values()) {
                if (script.hasErrors) {
                    errors.push({ symbol, script });
                }
            }
        }
        return errors;
    }

    /** Get active (healthy) scripts across all charts */
    getActiveScripts(): { symbol: string; script: ScriptInfo }[] {
        const active: { symbol: string; script: ScriptInfo }[] = [];
        for (const [symbol, map] of this.knownScripts.entries()) {
            for (const script of map.values()) {
                if (script.isActive && !script.hasErrors) {
                    active.push({ symbol, script });
                }
            }
        }
        return active;
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Private Methods ──

    private async scanScripts(): Promise<void> {
        const pages = browserController.getAllPages();

        for (const chartPage of pages) {
            const { symbol, page } = chartPage;

            try {
                const rawScripts = await page.evaluate(() => {
                    const scripts: Array<{
                        name: string;
                        hasError: boolean;
                        isVisible: boolean;
                        errorText: string;
                    }> = [];

                    // Read from chart legend
                    const legendItems = document.querySelectorAll(
                        '[class*="sourcesWrapper"] [class*="item"], ' +
                        '[data-name="legend"] [class*="sources"] > div'
                    );

                    legendItems.forEach((item) => {
                        const titleEl =
                            item.querySelector('[class*="title"]') ||
                            item.querySelector('[class*="description"]');
                        const name = titleEl?.textContent?.trim() || "";
                        if (!name) return;

                        if (name === "Vol" || name === "Volume") return;

                        const hasError = !!(
                            item.querySelector('[class*="error"]') ||
                            item.querySelector('[class*="warning"]') ||
                            item.querySelector('[class*="alert-error"]')
                        );

                        const eyeIcon = item.querySelector('[class*="eye"]');
                        const isVisible = eyeIcon
                            ? !eyeIcon.classList.toString().includes("hidden")
                            : true;

                        let errorText = "";
                        if (hasError) {
                            const errorEl = item.querySelector('[class*="error"]');
                            errorText = errorEl?.textContent?.trim() || "Unknown error";
                        }

                        scripts.push({ name, hasError, isVisible, errorText });
                    });

                    return scripts;
                });

                if (!this.knownScripts.has(symbol)) {
                    this.knownScripts.set(symbol, new Map());
                }
                const symbolScripts = this.knownScripts.get(symbol)!;
                const currentNames = new Set<string>();

                for (const raw of rawScripts) {
                    currentNames.add(raw.name);

                    const existing = symbolScripts.get(raw.name);
                    const scriptInfo: ScriptInfo = {
                        name: raw.name,
                        type: "indicator",
                        source: "chart",
                        isActive: raw.isVisible,
                        hasErrors: raw.hasError,
                        lastDeployed: existing?.lastDeployed || null,
                        errorMessage: raw.hasError ? raw.errorText : null,
                    };

                    if (existing) {
                        if (!existing.hasErrors && raw.hasError) {
                            logger.error(`Script error detected on ${symbol}: "${raw.name}" — ${raw.errorText}`, "automation");
                            eventBus.emit("script:error", scriptInfo);
                        } else if (existing.hasErrors && !raw.hasError) {
                            logger.info(`Script recovered on ${symbol}: "${raw.name}"`, "automation");
                            eventBus.emit("script:loaded", scriptInfo);
                        }
                    } else {
                        logger.info(`Script found on ${symbol}: "${raw.name}" (${raw.hasError ? "ERROR" : "OK"})`, "automation");
                        eventBus.emit("script:loaded", scriptInfo);
                    }

                    symbolScripts.set(raw.name, scriptInfo);
                }

                for (const [name] of symbolScripts) {
                    if (!currentNames.has(name)) {
                        logger.info(`Script removed from ${symbol}: "${name}"`, "automation");
                        eventBus.emit("script:removed", { name });
                        symbolScripts.delete(name);
                    }
                }
            } catch (err: unknown) {
                // Ignore transient errors
            }
        }
    }
}

// Singleton
export const scriptMonitor = new ScriptMonitor();
