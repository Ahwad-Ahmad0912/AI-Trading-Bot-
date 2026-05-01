// ─────────────────────────────────────────────
// Script Monitor — Active Script & Favorites Tracker
// ─────────────────────────────────────────────
// Monitors all Pine indicators/strategies deployed
// on the TradingView chart and tracks compilation
// errors and script status changes.

import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { browserController } from "./browser-controller";
import { ScriptInfo, IndicatorStatus } from "../types/chart";

export class ScriptMonitor {
    private knownScripts: Map<string, ScriptInfo> = new Map();
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
        const intervalMs = getConfig().chartMonitor.pollIntervalMs * 2; // Slower than chart monitor
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

    /** Get all known scripts */
    getScripts(): ScriptInfo[] {
        return Array.from(this.knownScripts.values());
    }

    /** Get scripts with errors */
    getErrorScripts(): ScriptInfo[] {
        return this.getScripts().filter((s) => s.hasErrors);
    }

    /** Get active (healthy) scripts */
    getActiveScripts(): ScriptInfo[] {
        return this.getScripts().filter((s) => s.isActive && !s.hasErrors);
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Private Methods ──

    private async scanScripts(): Promise<void> {
        const page = await browserController.getPage();

        const rawScripts = await page.evaluate(() => {
            const scripts: Array<{
                name: string;
                hasError: boolean;
                isVisible: boolean;
                errorText: string;
            }> = [];

            // Read from chart legend — this shows all active indicators/strategies
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

                // Skip built-in items like "Volume", candlestick source
                if (name === "Vol" || name === "Volume") return;

                const hasError = !!(
                    item.querySelector('[class*="error"]') ||
                    item.querySelector('[class*="warning"]') ||
                    item.querySelector('[class*="alert-error"]')
                );

                // Check visibility (eye icon)
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

        // Track changes
        const currentNames = new Set<string>();

        for (const raw of rawScripts) {
            currentNames.add(raw.name);

            const existing = this.knownScripts.get(raw.name);
            const scriptInfo: ScriptInfo = {
                name: raw.name,
                type: "indicator", // Default; can be refined
                source: "chart",
                isActive: raw.isVisible,
                hasErrors: raw.hasError,
                lastDeployed: existing?.lastDeployed || null,
                errorMessage: raw.hasError ? raw.errorText : null,
            };

            // Detect state changes
            if (existing) {
                if (!existing.hasErrors && raw.hasError) {
                    logger.error(`Script error detected: "${raw.name}" — ${raw.errorText}`, "automation");
                    eventBus.emit("script:error", scriptInfo);
                } else if (existing.hasErrors && !raw.hasError) {
                    logger.info(`Script recovered: "${raw.name}"`, "automation");
                    eventBus.emit("script:loaded", scriptInfo);
                }
            } else {
                // New script detected on chart
                logger.info(`Script found on chart: "${raw.name}" (${raw.hasError ? "ERROR" : "OK"})`, "automation");
                eventBus.emit("script:loaded", scriptInfo);
            }

            this.knownScripts.set(raw.name, scriptInfo);
        }

        // Detect removed scripts
        for (const [name] of this.knownScripts) {
            if (!currentNames.has(name)) {
                logger.info(`Script removed from chart: "${name}"`, "automation");
                eventBus.emit("script:removed", { name });
                this.knownScripts.delete(name);
            }
        }
    }
}

// Singleton
export const scriptMonitor = new ScriptMonitor();
