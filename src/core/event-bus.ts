// ─────────────────────────────────────────────
// Internal Event Bus
// ─────────────────────────────────────────────
// Central event system for decoupled communication
// between all modules (chart monitor, deployer,
// signal detector, alert manager, etc.)

import { EventEmitter } from "events";
import { logger } from "./logger";
import { ChartState, ScriptInfo } from "../types/chart";
import { TradeSignal, SignalClassification, AlertPayload, DeploymentResult } from "../types/signals";

// ── Event Map ──

export interface BotEvents {
    // Pine Script lifecycle
    "pine:detected": { filePath: string; isNew: boolean };
    "pine:validating": { filePath: string };
    "pine:validated": { filePath: string; valid: boolean; errors: string[] };
    "pine:deploying": { filePath: string; attempt: number };
    "pine:deployed": DeploymentResult;
    "pine:error": { filePath: string; error: string };

    // Chart state
    "chart:connected": { symbol: string; url: string };
    "chart:disconnected": { reason: string };
    "chart:updated": ChartState;
    "chart:screenshot": { path: string; reason: string };

    // Script monitoring
    "script:loaded": ScriptInfo;
    "script:error": ScriptInfo;
    "script:removed": { name: string };

    // Signals & AI
    "signal:detected": TradeSignal;
    "signal:classified": SignalClassification;
    "signal:dismissed": { signalId: string; reason: string };

    // Alerts
    "alert:fired": AlertPayload;
    "alert:webhook": { body: Record<string, unknown> };

    // System
    "system:ready": { timestamp: Date };
    "system:error": { component: string; error: string };
    "system:shutdown": { reason: string };
}

type EventName = keyof BotEvents;

class BotEventBus extends EventEmitter {
    private eventCounts: Map<string, number> = new Map();

    emit<K extends EventName>(event: K, data: BotEvents[K]): boolean {
        const count = (this.eventCounts.get(event) || 0) + 1;
        this.eventCounts.set(event, count);

        // Log significant events (skip high-frequency chart:updated to avoid spam)
        if (event !== "chart:updated") {
            logger.debug(`Event: ${event} (#${count})`, "system", {
                event,
                data: this.summarize(data),
            });
        }

        return super.emit(event, data);
    }

    on<K extends EventName>(event: K, listener: (data: BotEvents[K]) => void): this {
        return super.on(event, listener);
    }

    once<K extends EventName>(event: K, listener: (data: BotEvents[K]) => void): this {
        return super.once(event, listener);
    }

    /** Get count of times an event has been emitted */
    getEventCount(event: EventName): number {
        return this.eventCounts.get(event) || 0;
    }

    /** Get summary of all event counts */
    getStats(): Record<string, number> {
        const stats: Record<string, number> = {};
        for (const [key, val] of this.eventCounts) {
            stats[key] = val;
        }
        return stats;
    }

    private summarize(data: unknown): unknown {
        if (data && typeof data === "object" && "filePath" in data) {
            return { filePath: (data as { filePath: string }).filePath };
        }
        if (data && typeof data === "object" && "symbol" in data) {
            return { symbol: (data as { symbol: string }).symbol };
        }
        return typeof data === "object" ? "[object]" : data;
    }
}

// Singleton
export const eventBus = new BotEventBus();
eventBus.setMaxListeners(50);
