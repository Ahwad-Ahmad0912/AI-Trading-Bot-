// ─────────────────────────────────────────────
// Signal & Trade Analysis Type Definitions
// ─────────────────────────────────────────────

export type TradeDirection = "LONG" | "SHORT" | "NEUTRAL";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type SignalType =
    | "ENTRY_ZONE"
    | "REVERSAL"
    | "BREAKOUT"
    | "TREND_CONFIRMATION"
    | "TAKE_PROFIT"
    | "STOP_LOSS_DANGER"
    | "LIQUIDITY_ZONE"
    | "CUSTOM";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface TradeSignal {
    id: string;
    timestamp: Date;
    symbol: string;
    timeframe: string;
    type: SignalType;
    direction: TradeDirection;
    price: number;
    source: string; // Which indicator/script generated it
    rawData: Record<string, unknown>;
}

export interface SignalClassification {
    signalId: string;
    confidence: number;          // 0-100
    direction: TradeDirection;
    riskLevel: RiskLevel;
    continuationProbability: number; // 0-100
    targetExpectation: {
        tp1: number | null;
        tp2: number | null;
        tp3: number | null;
        stopLoss: number | null;
    };
    reasoning: string;
    recommendation: string;
    timestamp: Date;
}

export interface AlertPayload {
    id: string;
    severity: AlertSeverity;
    signal: TradeSignal;
    classification: SignalClassification | null;
    message: string;
    timestamp: Date;
}

export interface WebhookAlert {
    symbol?: string;
    action?: string;
    price?: number;
    timeframe?: string;
    strategy?: string;
    message?: string;
    [key: string]: unknown;
}

export interface DeploymentResult {
    success: boolean;
    filePath: string;
    fileName: string;
    timestamp: Date;
    errors: string[];
    retryCount: number;
}

export interface PineValidationResult {
    valid: boolean;
    version: number | null;
    scriptType: "indicator" | "strategy" | "library" | null;
    scriptName: string | null;
    errors: string[];
    warnings: string[];
}
