// ─────────────────────────────────────────────
// AI TradingView Bot — Main Orchestrator
// ─────────────────────────────────────────────
// Single entry point that wires together all
// components: browser, deployer, monitors,
// AI engine, alert system, and webhook server.
// Handles graceful startup and shutdown.

import { logger } from "./core/logger";
import { loadConfig } from "./core/config-loader";
import { eventBus } from "./core/event-bus";
import { browserController } from "./tradingview-bridge/browser-controller";
import { pineDeployer } from "./tradingview-bridge/pine-deployer";
import { chartMonitor } from "./tradingview-bridge/chart-monitor";
import { scriptMonitor } from "./tradingview-bridge/script-monitor";
import { ollamaClient } from "./ai-engine/ollama-client";
import { signalDetector } from "./ai-engine/signal-detector";
import { alertManager } from "./alert-server/alert-manager";
import { webhookServer } from "./alert-server/webhook-server";

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║       █████╗ ██╗    ████████╗██████╗  █████╗ ██████╗ ██╗███╗ ║
║      ██╔══██╗██║    ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██║████╗║
║      ███████║██║       ██║   ██████╔╝███████║██║  ██║██║██╔█║║
║      ██╔══██║██║       ██║   ██╔══██╗██╔══██║██║  ██║██║████║║
║      ██║  ██║██║       ██║   ██║  ██║██║  ██║██████╔╝██║███╔╝║
║      ╚═╝  ╚═╝╚═╝       ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚══╝║
║                                                              ║
║         AI TradingView Autonomous Assistant v2.0             ║
║         Chart Monitor • Script Deployer • AI Signals         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startBot(): Promise<void> {
    console.log(BANNER);

    // ── Step 1: Load Configuration ──
    logger.separator("INITIALIZATION");
    const config = loadConfig();
    logger.setLevel(config.logging.level);
    logger.info("Configuration loaded", "system");

    // ── Step 2: Start Alert Manager (event listener — must be first) ──
    alertManager.start();
    logger.info("✅ Alert Manager ready", "system");

    // ── Step 3: Connect to TradingView Browser ──
    logger.separator("BROWSER CONNECTION");
    try {
        await browserController.connect();
        logger.info("✅ Browser connected to TradingView", "system");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ Failed to connect to browser: ${msg}`, "system");
        logger.info("", "system");
        logger.info("Make sure Chrome is running with remote debugging:", "system");
        logger.info('  chrome.exe --remote-debugging-port=9222 --user-data-dir="./tv-session"', "system");
        logger.info("", "system");
        logger.info("The bot will continue in limited mode (no chart monitoring).", "system");
    }

    // Wait for chart to fully render
    if (browserController.connected) {
        logger.info("Waiting for chart to render...", "browser");
        await sleep(5000);
    }

    // ── Step 4: Start Pine Script Deployer ──
    logger.separator("PINE DEPLOYER");
    try {
        await pineDeployer.start();
        logger.info("✅ Pine Deployer active — watching Pinescripts folder", "system");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ Pine Deployer failed to start: ${msg}`, "system");
    }

    // ── Step 5: Start Chart Monitor ──
    if (browserController.connected) {
        logger.separator("CHART MONITOR");
        try {
            await chartMonitor.start();
            logger.info("✅ Chart Monitor active — polling chart state", "system");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`❌ Chart Monitor failed to start: ${msg}`, "system");
        }

        // ── Step 6: Start Script Monitor ──
        try {
            await scriptMonitor.start();
            logger.info("✅ Script Monitor active — tracking deployed scripts", "system");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`❌ Script Monitor failed to start: ${msg}`, "system");
        }
    }

    // ── Step 7: Initialize Ollama AI ──
    logger.separator("AI ENGINE");
    const ollamaReady = await ollamaClient.healthCheck();
    if (ollamaReady) {
        logger.info(`✅ Ollama connected — model: ${config.ollama.model}`, "system");

        // ── Step 8: Start Signal Detector ──
        try {
            await signalDetector.start();
            logger.info("✅ Signal Detector active — AI monitoring for opportunities", "system");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`❌ Signal Detector failed to start: ${msg}`, "system");
        }
    } else {
        logger.warn("⚠️ Ollama not available — AI features disabled", "system");
        logger.info("Start Ollama with: ollama serve", "system");
        logger.info(`Then pull the model: ollama pull ${config.ollama.model}`, "system");
    }

    // ── Step 9: Start Webhook Server ──
    logger.separator("WEBHOOK SERVER");
    try {
        await webhookServer.start();
        logger.info(`✅ Webhook server ready on port ${config.alerts.webhookPort}`, "system");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ Webhook server failed to start: ${msg}`, "system");
    }

    // ── Ready ──
    logger.separator("SYSTEM READY");
    eventBus.emit("system:ready", { timestamp: new Date() });

    const statusLines = [
        `  Browser:        ${browserController.connected ? "✅ Connected" : "❌ Disconnected"}`,
        `  Pine Deployer:  ${pineDeployer.running ? "✅ Active" : "❌ Inactive"}`,
        `  Chart Monitor:  ${chartMonitor.running ? "✅ Active" : "❌ Inactive"}`,
        `  Script Monitor: ${scriptMonitor.running ? "✅ Active" : "❌ Inactive"}`,
        `  Ollama AI:      ${ollamaClient.available ? "✅ Connected" : "❌ Unavailable"}`,
        `  Signal Detector:${signalDetector.running ? " ✅ Active" : " ❌ Inactive"}`,
        `  Alert Manager:  ${alertManager.running ? "✅ Active" : "❌ Inactive"}`,
        `  Webhook Server: ${webhookServer.running ? "✅ Active" : "❌ Inactive"}`,
    ];

    console.log("");
    console.log("  📊 AI TradingView Bot Status:");
    console.log("  " + "─".repeat(45));
    for (const line of statusLines) {
        console.log(line);
    }
    console.log("  " + "─".repeat(45));
    console.log("");
    console.log("  Endpoints:");
    console.log(`    Health:  http://localhost:${config.alerts.webhookPort}/health`);
    console.log(`    Status:  http://localhost:${config.alerts.webhookPort}/status`);
    console.log(`    Alert:   http://localhost:${config.alerts.webhookPort}/tv-alert`);
    console.log(`    Detect:  http://localhost:${config.alerts.webhookPort}/detect`);
    console.log(`    Deploy:  http://localhost:${config.alerts.webhookPort}/deploy`);
    console.log("");
    console.log("  Press Ctrl+C to stop the bot.");
    console.log("");
}

// ── Graceful Shutdown ──

async function shutdown(reason: string): Promise<void> {
    logger.separator("SHUTTING DOWN");
    logger.info(`Shutdown initiated: ${reason}`, "system");
    eventBus.emit("system:shutdown", { reason });

    try {
        signalDetector.stop();
        chartMonitor.stop();
        scriptMonitor.stop();
        await pineDeployer.stop();
        await webhookServer.stop();
        alertManager.stop();
        await browserController.disconnect();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Error during shutdown: ${msg}`, "system");
    }

    logger.info("AI TradingView Bot stopped. Goodbye!", "system");
    process.exit(0);
}

// Handle termination signals
process.on("SIGINT", () => shutdown("SIGINT (Ctrl+C)"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.message}`, "error", {
        stack: err.stack,
    });
    // Don't exit — try to keep running
});
process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${msg}`, "error");
    // Don't exit — try to keep running
});

// ── Launch ──
startBot().catch((err) => {
    console.error("Fatal error during startup:", err);
    process.exit(1);
});
