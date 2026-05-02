// ─────────────────────────────────────────────
// Browser Controller — Production-Grade (Multi-Chart)
// ─────────────────────────────────────────────
// Manages the Puppeteer connection to TradingView
// with automatic reconnection, health checks,
// and proper resource management for multiple tabs.

import puppeteer, { Browser, Page, CDPSession } from "puppeteer";
import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";

export interface ChartPage {
    symbol: string;
    page: Page;
    cdpSession: CDPSession | null;
}

export class BrowserController {
    private browser: Browser | null = null;
    private pages: Map<string, ChartPage> = new Map();
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private isConnected = false;
    private reconnectAttempts = 0;

    async connect(): Promise<void> {
        const config = getConfig().tradingview;
        logger.browser("Connecting to Chrome debug session...", {
            url: config.browserDebugUrl,
            symbols: config.symbols,
        });

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= config.maxReconnectAttempts; attempt++) {
            try {
                this.browser = await puppeteer.connect({
                    browserURL: config.browserDebugUrl,
                    defaultViewport: null,
                });

                // Set up disconnect handler
                this.browser.on("disconnected", () => {
                    logger.warn("Browser disconnected!", "browser");
                    this.isConnected = false;
                    this.stopHealthCheck();
                    this.pages.clear();
                    eventBus.emit("chart:disconnected", {
                        reason: "Browser process disconnected",
                    });
                });

                const existingPages = await this.browser.pages();
                this.pages.clear();

                for (const symbol of config.symbols) {
                    let page: Page | null = null;
                    const targetUrlPart = `symbol=${symbol}`;

                    // Find existing TradingView chart tab for this symbol
                    const tvPage = existingPages.find((p) =>
                        p.url().includes("tradingview.com/chart") && p.url().includes(targetUrlPart)
                    );

                    if (tvPage) {
                        page = tvPage;
                        logger.browser(`Attached to existing TradingView chart tab for ${symbol}`);
                    } else {
                        page = await this.browser.newPage();
                        const url = `${config.baseUrl}?symbol=${symbol}`;
                        logger.browser(`Opening new TradingView chart tab for ${symbol}: ${url}`);
                        await page.goto(url, {
                            waitUntil: "domcontentloaded",
                            timeout: 60000,
                        });
                    }

                    // Maximize window via CDP (only needed once, but safe to call per page)
                    let cdpSession: CDPSession | null = null;
                    try {
                        cdpSession = await page.createCDPSession();
                        const { windowId } = await cdpSession.send("Browser.getWindowForTarget");
                        await cdpSession.send("Browser.setWindowBounds", {
                            windowId,
                            bounds: { windowState: "maximized" },
                        });
                    } catch (cdpErr) {
                        logger.debug(`CDP maximize failed for ${symbol}, continuing anyway`, "browser");
                    }

                    // Set reasonable navigation timeouts
                    page.setDefaultNavigationTimeout(120000);
                    page.setDefaultTimeout(30000);

                    this.pages.set(symbol, { symbol, page, cdpSession });
                    eventBus.emit("chart:connected", { symbol, url: page.url() });
                }

                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.startHealthCheck();

                logger.browser(`Successfully connected to ${this.pages.size} TradingView charts`, {
                    attempt,
                });

                return;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                logger.warn(
                    `Connection attempt ${attempt}/${config.maxReconnectAttempts} failed: ${lastError.message}`,
                    "browser"
                );

                if (attempt < config.maxReconnectAttempts) {
                    const delay = config.reconnectDelayMs * attempt;
                    logger.browser(`Retrying in ${delay}ms...`);
                    await this.sleep(delay);
                }
            }
        }

        throw new Error(
            `Failed to connect after ${config.maxReconnectAttempts} attempts: ${lastError?.message}`
        );
    }

    /** Get the active TradingView page for a specific symbol */
    async getPage(symbol: string): Promise<Page> {
        if (!this.isConnected) {
            await this.connect();
        }

        const chartPage = this.pages.get(symbol);
        if (!chartPage) {
            throw new Error(`No open page found for symbol: ${symbol}`);
        }

        // Quick liveness check
        try {
            await chartPage.page.evaluate(() => document.title);
            return chartPage.page;
        } catch {
            logger.warn(`Page for ${symbol} is stale, reconnecting...`, "browser");
            await this.connect();
            return this.pages.get(symbol)!.page;
        }
    }

    /** Get all managed pages */
    getAllPages(): ChartPage[] {
        return Array.from(this.pages.values());
    }

    /** Bring a specific chart to the front (required for DOM automation like paste) */
    async bringToFront(symbol: string): Promise<void> {
        const page = await this.getPage(symbol);
        await page.bringToFront();
        await this.sleep(500); // Give the browser time to focus
    }

    /** Check if browser is connected */
    get connected(): boolean {
        return this.isConnected && this.pages.size > 0;
    }

    /** Take a screenshot of the current chart */
    async screenshot(symbol: string, savePath: string): Promise<string> {
        const page = await this.getPage(symbol);
        await page.bringToFront(); // Ensure it's active before screenshot
        await page.screenshot({ path: savePath, fullPage: false });
        logger.browser(`Screenshot saved for ${symbol}`, { path: savePath });
        return savePath;
    }

    /** Clean up resources */
    async disconnect(): Promise<void> {
        this.stopHealthCheck();
        this.isConnected = false;

        for (const { symbol, cdpSession } of this.pages.values()) {
            if (cdpSession) {
                try {
                    await cdpSession.detach();
                } catch { /* ignore */ }
            }
        }
        this.pages.clear();

        // Note: We DON'T close the browser since we attached to an existing session.
        if (this.browser) {
            try {
                this.browser.disconnect();
            } catch { /* ignore */ }
            this.browser = null;
        }

        logger.browser("Disconnected from browser");
    }

    // ── Health Check ──

    private startHealthCheck(): void {
        const intervalMs = getConfig().tradingview.healthCheckIntervalMs;
        this.stopHealthCheck();

        this.healthCheckTimer = setInterval(async () => {
            try {
                if (this.pages.size === 0) throw new Error("No pages configured");
                for (const { symbol, page } of this.pages.values()) {
                    await page.evaluate(() => document.readyState);
                }
            } catch (err) {
                logger.warn("Health check failed, attempting reconnection...", "browser");
                this.isConnected = false;
                this.stopHealthCheck();

                try {
                    await this.connect();
                    logger.info("Reconnected successfully after health check failure", "browser");
                } catch (reconnectErr: unknown) {
                    const msg = reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr);
                    logger.error(`Reconnection failed: ${msg}`, "browser");
                    eventBus.emit("system:error", {
                        component: "BrowserController",
                        error: msg,
                    });
                }
            }
        }, intervalMs);
    }

    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Singleton instance
export const browserController = new BrowserController();
