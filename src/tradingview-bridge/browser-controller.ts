// ─────────────────────────────────────────────
// Browser Controller — Production-Grade
// ─────────────────────────────────────────────
// Manages the Puppeteer connection to TradingView
// with automatic reconnection, health checks,
// and proper resource management.

import puppeteer, { Browser, Page, CDPSession } from "puppeteer";
import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";

export class BrowserController {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private cdpSession: CDPSession | null = null;
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private isConnected = false;
    private reconnectAttempts = 0;

    async connect(): Promise<Page> {
        const config = getConfig().tradingview;
        logger.browser("Connecting to Chrome debug session...", {
            url: config.browserDebugUrl,
        });

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= config.maxReconnectAttempts; attempt++) {
            try {
                this.browser = await puppeteer.connect({
                    browserURL: config.browserDebugUrl,
                    defaultViewport: null,
                });

                // Find existing TradingView chart tab
                const pages = await this.browser.pages();
                const tvPage = pages.find((p) =>
                    p.url().includes("tradingview.com/chart")
                );

                if (tvPage) {
                    this.page = tvPage;
                    logger.browser("Attached to existing TradingView chart tab");
                } else {
                    this.page = await this.browser.newPage();
                    await this.page.goto(config.chartUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 60000,
                    });
                    logger.browser("Opened new TradingView chart tab");
                }

                await this.page.bringToFront();

                // Maximize window via CDP
                try {
                    this.cdpSession = await this.page.createCDPSession();
                    const { windowId } = await this.cdpSession.send(
                        "Browser.getWindowForTarget"
                    );
                    await this.cdpSession.send("Browser.setWindowBounds", {
                        windowId,
                        bounds: { windowState: "maximized" },
                    });
                    logger.browser("Window maximized via CDP");
                } catch (cdpErr) {
                    logger.warn("CDP maximize failed, continuing anyway", "browser");
                }

                // Set reasonable navigation timeout (2 minutes instead of infinity)
                this.page.setDefaultNavigationTimeout(120000);
                this.page.setDefaultTimeout(30000);

                // Set up disconnect handler
                this.browser.on("disconnected", () => {
                    logger.warn("Browser disconnected!", "browser");
                    this.isConnected = false;
                    this.stopHealthCheck();
                    eventBus.emit("chart:disconnected", {
                        reason: "Browser process disconnected",
                    });
                });

                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.startHealthCheck();

                eventBus.emit("chart:connected", { url: this.page.url() });
                logger.browser("Successfully connected to TradingView", {
                    url: this.page.url(),
                    attempt,
                });

                return this.page;
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

    /** Get the active TradingView page, reconnecting if needed */
    async getPage(): Promise<Page> {
        if (this.page && this.isConnected) {
            // Quick liveness check
            try {
                await this.page.evaluate(() => document.title);
                return this.page;
            } catch {
                logger.warn("Page is stale, reconnecting...", "browser");
            }
        }

        return this.connect();
    }

    /** Check if browser is connected and page is alive */
    get connected(): boolean {
        return this.isConnected && this.page !== null;
    }

    /** Take a screenshot of the current chart */
    async screenshot(savePath: string): Promise<string> {
        const page = await this.getPage();
        await page.screenshot({ path: savePath, fullPage: false });
        logger.browser("Screenshot saved", { path: savePath });
        return savePath;
    }

    /** Clean up resources */
    async disconnect(): Promise<void> {
        this.stopHealthCheck();
        this.isConnected = false;

        if (this.cdpSession) {
            try {
                await this.cdpSession.detach();
            } catch { /* ignore */ }
            this.cdpSession = null;
        }

        // Note: We DON'T close the browser since we attached to an existing session.
        // The user's Chrome should keep running.
        if (this.browser) {
            try {
                this.browser.disconnect();
            } catch { /* ignore */ }
            this.browser = null;
        }

        this.page = null;
        logger.browser("Disconnected from browser");
    }

    // ── Health Check ──

    private startHealthCheck(): void {
        const intervalMs = getConfig().tradingview.healthCheckIntervalMs;
        this.stopHealthCheck();

        this.healthCheckTimer = setInterval(async () => {
            try {
                if (!this.page) throw new Error("No page reference");
                await this.page.evaluate(() => document.readyState);
            } catch {
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
