// ─────────────────────────────────────────────
// Configuration Type Definitions
// ─────────────────────────────────────────────

export interface TradingViewConfig {
    baseUrl: string;
    symbols: string[];
    browserDebugUrl: string;
    sessionDir: string;
    healthCheckIntervalMs: number;
    reconnectDelayMs: number;
    maxReconnectAttempts: number;
}

export interface PineScriptsConfig {
    watchDir: string;
    watchExtensions: string[];
    deployQueueDelayMs: number;
    maxDeployRetries: number;
    preValidate: boolean;
}

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
}

export interface ChartMonitorConfig {
    pollIntervalMs: number;
    screenshotOnSignal: boolean;
    screenshotDir: string;
}

export interface SignalDetectionConfig {
    enabled: boolean;
    minConfidence: number;
    analysisIntervalMs: number;
    cooldownMs: number;
}

export interface AlertsConfig {
    webhookPort: number;
    apiKey: string;
    deduplicationWindowMs: number;
}

export interface LoggingConfig {
    dir: string;
    level: string;
    maxFileSizeMb: number;
    maxFiles: number;
}

export interface AppConfig {
    tradingview: TradingViewConfig;
    pineScripts: PineScriptsConfig;
    ollama: OllamaConfig;
    chartMonitor: ChartMonitorConfig;
    signalDetection: SignalDetectionConfig;
    alerts: AlertsConfig;
    logging: LoggingConfig;
}
