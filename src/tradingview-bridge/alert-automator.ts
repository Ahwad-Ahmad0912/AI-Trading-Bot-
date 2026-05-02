// ─────────────────────────────────────────────
// Alert Automator — TradingView Native Automation
// ─────────────────────────────────────────────
// Manages DOM interactions to automatically create
// native TradingView alerts when AI signals trigger.

import { logger } from "../core/logger";
import { browserController } from "./browser-controller";
import { AlertPayload } from "../types/signals";

export class TVAlertAutomator {
    /** Automate creating a TradingView alert */
    async createAlert(symbol: string, payload: AlertPayload): Promise<boolean> {
        logger.automation(`Creating TV native alert for ${symbol}...`);
        
        try {
            await browserController.bringToFront(symbol);
            const page = await browserController.getPage(symbol);

            // Press Alt+A to open alert dialog (standard TradingView shortcut)
            await page.keyboard.down("Alt");
            await page.keyboard.press("a");
            await page.keyboard.up("Alt");
            await this.sleep(2000); // Wait for dialog animation

            // Find the message textarea
            const messageBoxes = await page.$$('textarea');
            let messageBox = null;
            for (const box of messageBoxes) {
                // Look for visible textarea
                const isVisible = await page.evaluate((el: Element) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                }, box);
                if (isVisible) {
                    messageBox = box;
                    break;
                }
            }

            if (!messageBox) {
                logger.warn("Could not find alert message textarea, aborting native alert", "automation");
                // Try to close dialog if it's open but unrecognized
                await page.keyboard.press("Escape");
                return false;
            }

            // Clear textarea
            await messageBox.click({ clickCount: 3 });
            await page.keyboard.press("Backspace");

            // Build dynamic message
            const tvMessage = 
                `AI: ${payload.signal.type} | ${payload.signal.direction}\n` +
                `Risk: ${payload.classification?.riskLevel || 'UNKNOWN'}\n` +
                `TP1: ${payload.classification?.targetExpectation?.tp1 || 'N/A'}\n` +
                `SL: ${payload.classification?.targetExpectation?.stopLoss || 'N/A'}\n` +
                `Info: ${payload.message}`;

            // Type message
            await page.keyboard.type(tvMessage, { delay: 10 });
            await this.sleep(500);

            // Optional: Find alert name input and set it
            const inputs = await page.$$('input[type="text"]');
            for (const input of inputs) {
                const nameAttr = await page.evaluate((el: Element) => el.getAttribute('name') || el.getAttribute('placeholder') || '', input);
                if (nameAttr.toLowerCase().includes('name') || nameAttr.toLowerCase().includes('alert')) {
                    await input.click({ clickCount: 3 });
                    await page.keyboard.type(`AI: ${payload.signal.type}`, { delay: 10 });
                    break;
                }
            }

            // Find create/save button (Primary button)
            const buttons = await page.$$('button');
            let submitBtn = null;
            for (const btn of buttons) {
                const text = await page.evaluate((el: Element) => el.textContent?.trim().toLowerCase() || '', btn);
                if (text === 'create' || text === 'save') {
                    submitBtn = btn;
                    break;
                }
            }

            if (submitBtn) {
                await submitBtn.click();
                await this.sleep(2000);
            } else {
                // Fallback: hit Enter
                await page.keyboard.press('Enter');
                await this.sleep(2000);
            }

            logger.automation(`✅ Successfully created native TV alert for ${symbol}`);
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to create native TV alert for ${symbol}: ${msg}`, "automation");
            
            // Failsafe escape to close stuck dialogs
            try {
                const page = await browserController.getPage(symbol);
                await page.keyboard.press("Escape");
            } catch { /* ignore */ }
            
            return false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const alertAutomator = new TVAlertAutomator();
