// ─────────────────────────────────────────────
// Desktop Alerts — Windows OS Notifications
// ─────────────────────────────────────────────
// Triggers local desktop popups using Windows
// PowerShell to ensure alerts are seen locally.

import { exec } from "child_process";
import { AlertPayload } from "../types/signals";
import { logger } from "../core/logger";

export function showDesktopPopup(alert: AlertPayload): void {
    try {
        const title = `AI ALERT: ${alert.signal.direction} ${alert.signal.symbol}`;
        const classification = alert.classification;
        
        let message = `${alert.signal.type}\\n`;
        message += `Confidence: ${classification?.confidence || 0}%\\n`;
        message += `Risk: ${classification?.riskLevel || 'UNKNOWN'}\\n`;
        message += `Price: ${alert.signal.price}`;

        // Escape single quotes for PowerShell
        const safeTitle = title.replace(/'/g, "''");
        const safeMessage = message.replace(/'/g, "''");
        
        // Windows PowerShell UI popup (non-blocking)
        const psCommand = `Add-Type -AssemblyName PresentationCore,PresentationFramework; [System.Windows.MessageBox]::Show('${safeMessage}', '${safeTitle}', 'OK', 'Information')`;
        
        exec(`powershell -WindowStyle Hidden -Command "${psCommand}"`, (err) => {
            if (err) {
                logger.debug(`Failed to show desktop popup: ${err.message}`, "alert");
            }
        });
    } catch (err) {
        logger.debug("Desktop popup execution failed", "alert");
    }
}
