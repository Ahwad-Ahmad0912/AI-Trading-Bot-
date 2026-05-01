// ─────────────────────────────────────────────
// Chart State Type Definitions
// ─────────────────────────────────────────────

export interface CandleData {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: Date;
}

export interface ChartState {
    symbol: string;
    timeframe: string;
    lastCandle: CandleData | null;
    currentPrice: number | null;
    priceChange: number | null;
    priceChangePercent: number | null;
    activeIndicators: IndicatorState[];
    timestamp: Date;
}

export type IndicatorStatus = "active" | "error" | "loading" | "disabled";

export interface IndicatorState {
    name: string;
    status: IndicatorStatus;
    type: "indicator" | "strategy";
    errorMessage: string | null;
    values: Record<string, string>; // Label values visible on the chart
}

export interface ScriptInfo {
    name: string;
    type: "indicator" | "strategy" | "library";
    source: "local" | "favorites" | "chart";
    isActive: boolean;
    hasErrors: boolean;
    lastDeployed: Date | null;
    errorMessage: string | null;
}

export interface ChartScreenshot {
    path: string;
    timestamp: Date;
    symbol: string;
    timeframe: string;
}
