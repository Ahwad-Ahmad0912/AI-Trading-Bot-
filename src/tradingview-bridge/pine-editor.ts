// ─────────────────────────────────────────────
// Pine Editor — DOM-Based Interactions (Multi-Chart)
// ─────────────────────────────────────────────
// Replaces ALL hardcoded pixel-coordinate clicks
// with CSS selector and keyboard-shortcut based
// interactions for reliability across resolutions.
// Updated to accept a symbol to target a specific tab.

import { Page } from "puppeteer";
import { logger } from "../core/logger";
import { browserController } from "./browser-controller";

const SELECTORS = {
    pineEditorPane: '[data-name="pine-editor"]',
    pineEditorToggle: '[data-name="open-pine-editor"]',
    editorTextarea: ".pine-editor-view .view-lines",
    monacoEditor: ".monaco-editor",
    monacoTextarea: ".monaco-editor textarea",
    saveButton: '[data-name="save"]',
    addToChartButton: '[data-name="add-to-chart"]',
    compilationErrors: ".pine-editor-errors",
    errorLine: ".pine-editor-error-line",
    saveDialog: '[data-dialog-name="scriptSaveRenameDialog"]',
    saveDialogInput: '[data-dialog-name="scriptSaveRenameDialog"] input',
    saveDialogConfirm: '[data-dialog-name="scriptSaveRenameDialog"] [data-name="submit"]',
};

export class PineEditor {
    private async getPage(symbol: string): Promise<Page> {
        return browserController.getPage(symbol);
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async openPineEditor(symbol: string): Promise<void> {
        const page = await this.getPage(symbol);
        logger.automation(`Opening Pine Editor on ${symbol}...`);

        const editorVisible = await page.$(SELECTORS.pineEditorPane);
        if (editorVisible) {
            const isVisible = await page.evaluate(
                (sel: string) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== "none" && style.visibility !== "hidden";
                },
                SELECTORS.pineEditorPane
            );
            if (isVisible) {
                logger.automation("Pine Editor is already open");
                return;
            }
        }

        try {
            const toggleBtn = await page.$(SELECTORS.pineEditorToggle);
            if (toggleBtn) {
                await toggleBtn.click();
                await this.sleep(1500);
                return;
            }
        } catch { /* ignore */ }

        try {
            const tabs = await page.$$('.layout__area--bottom [class*="tab"]');
            for (const tab of tabs) {
                const text = await page.evaluate((el: Element) => el.textContent, tab);
                if (text && text.includes("Pine Editor")) {
                    await tab.click();
                    await this.sleep(1500);
                    return;
                }
            }
        } catch { /* ignore */ }
    }

    async focusEditor(symbol: string): Promise<void> {
        const page = await this.getPage(symbol);
        
        const textarea = await page.$(SELECTORS.monacoTextarea);
        if (textarea) {
            await textarea.click();
            await this.sleep(500);
            return;
        }

        const editorView = await page.$(SELECTORS.monacoEditor);
        if (editorView) {
            await editorView.click();
            await this.sleep(500);
            return;
        }

        const pane = await page.$(SELECTORS.pineEditorPane);
        if (pane) {
            await pane.click();
            await this.sleep(500);
            return;
        }

        throw new Error("Could not find Pine Editor code area to focus");
    }

    async clearEditor(symbol: string): Promise<void> {
        const page = await this.getPage(symbol);
        await this.focusEditor(symbol);

        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await this.sleep(300);

        await page.keyboard.press("Backspace");
        await this.sleep(500);
    }

    async insertCode(symbol: string, code: string): Promise<void> {
        const page = await this.getPage(symbol);
        await this.focusEditor(symbol);

        const client = await page.createCDPSession();

        try {
            await client.send("Browser.grantPermissions", {
                permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
            });
        } catch { /* ignore */ }

        await page.evaluate(async (text: string) => {
            await navigator.clipboard.writeText(text);
        }, code);

        await this.sleep(300);

        await page.keyboard.down("Control");
        await page.keyboard.press("v");
        await page.keyboard.up("Control");

        await this.sleep(3000); 

        try {
            await client.detach();
        } catch { /* ignore */ }
    }

    async saveScript(symbol: string, scriptName?: string): Promise<void> {
        const page = await this.getPage(symbol);

        await page.keyboard.down("Control");
        await page.keyboard.press("s");
        await page.keyboard.up("Control");
        await this.sleep(2000);

        const dialog = await page.$(SELECTORS.saveDialog);
        if (dialog) {
            if (scriptName) {
                const input = await page.$(SELECTORS.saveDialogInput);
                if (input) {
                    await input.click({ clickCount: 3 }); 
                    await page.keyboard.type(scriptName, { delay: 30 });
                }
            }

            const confirmBtn = await page.$(SELECTORS.saveDialogConfirm);
            if (confirmBtn) {
                await confirmBtn.click();
            } else {
                await page.keyboard.press("Enter");
            }

            await this.sleep(2000);
        }
    }

    async addToChart(symbol: string): Promise<void> {
        const page = await this.getPage(symbol);

        const addBtn = await page.$(SELECTORS.addToChartButton);
        if (addBtn) {
            await addBtn.click();
            await this.sleep(4000);
            return;
        }

        const buttons = await page.$$("button");
        for (const btn of buttons) {
            const text = await page.evaluate((el: Element) => el.textContent?.trim(), btn);
            if (text && text.toLowerCase().includes("add to chart")) {
                await btn.click();
                await this.sleep(4000);
                return;
            }
        }
    }

    async getCompilationErrors(symbol: string): Promise<string[]> {
        const page = await this.getPage(symbol);
        const errors: string[] = [];

        try {
            const errorElements = await page.$$(SELECTORS.errorLine);
            for (const el of errorElements) {
                const text = await page.evaluate((node: Element) => node.textContent?.trim() || "", el);
                if (text) errors.push(text);
            }

            const errorMarkers = await page.$$(".squiggly-error");
            if (errorMarkers.length > 0) {
                errors.push(`${errorMarkers.length} inline error(s) detected`);
            }
        } catch { /* ignore */ }

        return errors;
    }

    /** Full deployment pipeline for a single chart */
    async deployScriptToChart(symbol: string, code: string, scriptName?: string): Promise<{ success: boolean; errors: string[] }> {
        logger.deployment(`Deploying "${scriptName}" to ${symbol}...`);

        try {
            await browserController.bringToFront(symbol); // CRITICAL for clipboard
            await this.openPineEditor(symbol);
            await this.sleep(1000);

            await this.clearEditor(symbol);
            await this.sleep(500);

            await this.insertCode(symbol, code);
            await this.sleep(1000);

            const preErrors = await this.getCompilationErrors(symbol);
            if (preErrors.length > 0) {
                return { success: false, errors: preErrors };
            }

            await this.saveScript(symbol, scriptName);
            await this.sleep(1000);

            await this.addToChart(symbol);
            await this.sleep(2000);

            const postErrors = await this.getCompilationErrors(symbol);
            if (postErrors.length > 0) {
                return { success: true, errors: postErrors };
            }

            return { success: true, errors: [] };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, errors: [message] };
        }
    }
}

// Singleton
export const pineEditor = new PineEditor();
