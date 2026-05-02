// ─────────────────────────────────────────────
// Configuration Loader
// ─────────────────────────────────────────────
// Loads and validates config.json at startup,
// providing a typed AppConfig object.

import fs from "fs";
import path from "path";
import { AppConfig } from "../types/config";
import { logger } from "./logger";

const CONFIG_PATH = path.resolve(process.cwd(), "config.json");

const DEFAULT_CONFIG: AppConfig = {
    tradingview: {
        baseUrl: "https://www.tradingview.com/chart/",
        symbols: ["XAUUSD", "BTCUSD", "NAS100"],
        browserDebugUrl: "http://127.0.0.1:9222",
        sessionDir: "./tv-session",
        healthCheckIntervalMs: 10000,
        reconnectDelayMs: 5000,
        maxReconnectAttempts: 10,
    },
    pineScripts: {
        watchDir: "./Pinescripts",
        watchExtensions: [".pine"],
        deployQueueDelayMs: 2000,
        maxDeployRetries: 3,
        preValidate: true,
    },
    ollama: {
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:14b",
        timeoutMs: 120000,
        maxRetries: 3,
        retryDelayMs: 2000,
    },
    chartMonitor: {
        pollIntervalMs: 5000,
        screenshotOnSignal: true,
        screenshotDir: "./logs/screenshots",
    },
    signalDetection: {
        enabled: true,
        minConfidence: 60,
        analysisIntervalMs: 30000,
        cooldownMs: 300000,
    },
    alerts: {
        webhookPort: 3000,
        apiKey: "",
        deduplicationWindowMs: 600000,
    },
    logging: {
        dir: "./logs",
        level: "info",
        maxFileSizeMb: 10,
        maxFiles: 5,
    },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        const sourceVal = source[key];
        const targetVal = target[key];
        if (
            sourceVal &&
            typeof sourceVal === "object" &&
            !Array.isArray(sourceVal) &&
            targetVal &&
            typeof targetVal === "object" &&
            !Array.isArray(targetVal)
        ) {
            result[key] = deepMerge(targetVal, sourceVal);
        } else {
            result[key] = sourceVal;
        }
    }
    return result;
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
    if (cachedConfig) return cachedConfig;

    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            logger.warn(`Config file not found at ${CONFIG_PATH}, using defaults`, "system");
            cachedConfig = DEFAULT_CONFIG;
            return cachedConfig;
        }

        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        const merged: AppConfig = deepMerge(DEFAULT_CONFIG, parsed);
        cachedConfig = merged;

        logger.info("Configuration loaded successfully", "system", {
            configPath: CONFIG_PATH,
            model: merged.ollama.model,
            baseUrl: merged.tradingview.baseUrl,
            symbols: merged.tradingview.symbols.join(", "),
        });

        return merged;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to load config: ${message}`, "error");
        logger.warn("Falling back to default configuration", "system");
        cachedConfig = DEFAULT_CONFIG;
        return cachedConfig;
    }
}

export function getConfig(): AppConfig {
    if (!cachedConfig) return loadConfig();
    return cachedConfig;
}

/** Force reload config from disk (useful for hot-reload) */
export function reloadConfig(): AppConfig {
    cachedConfig = null;
    return loadConfig();
}

