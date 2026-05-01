// ─────────────────────────────────────────────
// Structured Logger — Winston-based
// ─────────────────────────────────────────────
// Provides separate log channels for deployment, automation,
// signals, errors, and general operations.

import winston from "winston";
import path from "path";
import fs from "fs";

const LOG_COLORS: Record<string, string> = {
    error: "\x1b[31m",   // Red
    warn: "\x1b[33m",    // Yellow
    info: "\x1b[36m",    // Cyan
    debug: "\x1b[90m",   // Gray
    reset: "\x1b[0m",
};

const CATEGORY_ICONS: Record<string, string> = {
    deployment: "📦",
    automation: "🤖",
    signal: "📊",
    ai: "🧠",
    alert: "🔔",
    browser: "🌐",
    system: "⚙️",
    error: "❌",
};

type LogCategory = keyof typeof CATEGORY_ICONS;

class Logger {
    private mainLogger: winston.Logger;
    private deploymentLogger: winston.Logger;
    private signalLogger: winston.Logger;
    private errorLogger: winston.Logger;
    private logDir: string;

    constructor() {
        this.logDir = "./logs";
        this.ensureLogDir();

        const jsonFormat = winston.format.combine(
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
            winston.format.json()
        );

        const consoleFormat = winston.format.combine(
            winston.format.timestamp({ format: "HH:mm:ss" }),
            winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
                const icon = CATEGORY_ICONS[category as string] || "📝";
                const color = LOG_COLORS[level] || "";
                const reset = LOG_COLORS.reset;
                const metaStr = Object.keys(meta).length > 0
                    ? ` ${color}${JSON.stringify(meta)}${reset}`
                    : "";
                return `${color}[${timestamp}]${reset} ${icon} ${color}${level.toUpperCase().padEnd(5)}${reset} ${message}${metaStr}`;
            })
        );

        // Main logger — console + combined file
        this.mainLogger = winston.createLogger({
            level: "debug",
            format: jsonFormat,
            transports: [
                new winston.transports.Console({ format: consoleFormat }),
                new winston.transports.File({
                    filename: path.join(this.logDir, "combined.log"),
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 5,
                }),
            ],
        });

        // Deployment-specific log
        this.deploymentLogger = winston.createLogger({
            level: "info",
            format: jsonFormat,
            transports: [
                new winston.transports.File({
                    filename: path.join(this.logDir, "deployment.log"),
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 3,
                }),
            ],
        });

        // Signal-specific log
        this.signalLogger = winston.createLogger({
            level: "info",
            format: jsonFormat,
            transports: [
                new winston.transports.File({
                    filename: path.join(this.logDir, "signals.log"),
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 3,
                }),
            ],
        });

        // Error-specific log
        this.errorLogger = winston.createLogger({
            level: "error",
            format: jsonFormat,
            transports: [
                new winston.transports.File({
                    filename: path.join(this.logDir, "errors.log"),
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 5,
                }),
            ],
        });
    }

    private ensureLogDir(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        const screenshotDir = path.join(this.logDir, "screenshots");
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
    }

    /** Update log directory and recreate file transports */
    setLogDir(dir: string): void {
        this.logDir = dir;
        this.ensureLogDir();
    }

    /** Update log level */
    setLevel(level: string): void {
        this.mainLogger.level = level;
    }

    // ── Logging Methods ──

    info(message: string, category: LogCategory = "system", meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category, ...meta });
    }

    warn(message: string, category: LogCategory = "system", meta: Record<string, unknown> = {}): void {
        this.mainLogger.warn(message, { category, ...meta });
    }

    error(message: string, category: LogCategory = "error", meta: Record<string, unknown> = {}): void {
        this.mainLogger.error(message, { category, ...meta });
        this.errorLogger.error(message, { category, ...meta });
    }

    debug(message: string, category: LogCategory = "system", meta: Record<string, unknown> = {}): void {
        this.mainLogger.debug(message, { category, ...meta });
    }

    // ── Specialized Log Methods ──

    deployment(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category: "deployment", ...meta });
        this.deploymentLogger.info(message, { category: "deployment", ...meta });
    }

    signal(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category: "signal", ...meta });
        this.signalLogger.info(message, { category: "signal", ...meta });
    }

    ai(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category: "ai", ...meta });
    }

    alert(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.warn(message, { category: "alert", ...meta });
        this.signalLogger.warn(message, { category: "alert", ...meta });
    }

    browser(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category: "browser", ...meta });
    }

    automation(message: string, meta: Record<string, unknown> = {}): void {
        this.mainLogger.info(message, { category: "automation", ...meta });
    }

    // ── Separator for visual clarity in terminal ──

    separator(title: string = ""): void {
        const line = "─".repeat(50);
        if (title) {
            this.mainLogger.info(`${line} ${title} ${line}`, { category: "system" });
        } else {
            this.mainLogger.info(line, { category: "system" });
        }
    }
}

// Singleton instance
export const logger = new Logger();
