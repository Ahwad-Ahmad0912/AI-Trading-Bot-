// ─────────────────────────────────────────────
// Pine Editor — DOM-Based Interactions
// ─────────────────────────────────────────────
// Replaces ALL hardcoded pixel-coordinate clicks
// with CSS selector and keyboard-shortcut based
// interactions for reliability across resolutions.

import { Page } from "puppeteer";
import { logger } from "../core/logger";
import { browserController } from "./browser-controller";

const SELECTORS = {
    // Pine Editor panel
    pineEditorPane: '[data-name="pine-editor"]',
    pineEditorToggle: '[data-name="open-pine-editor"]',
    editorTextarea: ".pine-editor-view .view-lines",
    monacoEditor: ".monaco-editor",
    monacoTextarea: ".monaco-editor textarea",

    // Editor toolbar buttons
    saveButton: '[data-name="save"]',
    addToChartButton: '[data-name="add-to-chart"]',
    openScriptButton: '[data-name="open-script"]',
    newIndicatorButton: '[data-name="new-indicator"]',
    newStrategyButton: '[data-name="new-strategy"]',

    // Error/status indicators
    compilationErrors: ".pine-editor-errors",
    errorLine: ".pine-editor-error-line",
    successIndicator: ".pine-editor-success",

    // Save dialog
    saveDialog: '[data-dialog-name="scriptSaveRenameDialog"]',
    saveDialogInput: '[data-dialog-name="scriptSaveRenameDialog"] input',
    saveDialogConfirm: '[data-dialog-name="scriptSaveRenameDialog"] [data-name="submit"]',

    // Indicators on chart
    indicatorTitleBar: ".study .pane-legend-title__description",
    indicatorError: ".study .pane-legend-title__error",
    indicatorsPanel: '[data-name="legend"]',
};

// Keyboard shortcuts for TradingView Pine Editor
const SHORTCUTS = {
    openPineEditor: { key: "/", modifiers: [] as string[] },      // "/" opens Pine Editor
    saveScript: { key: "s", modifiers: ["Control"] },
    selectAll: { key: "a", modifiers: ["Control"] },
    paste: { key: "v", modifiers: ["Control"] },
    undo: { key: "z", modifiers: ["Control"] },
};

export class PineEditor {
    private page: Page | null = null;

    private async getPage(): Promise<Page> {
        this.page = await browserController.getPage();
        return this.page;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Ensure Pine Editor panel is open */
    async openPineEditor(): Promise<void> {
        const page = await this.getPage();
        logger.automation("Opening Pine Editor...");

        // Check if Pine Editor is already visible
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

        // Try clicking the toggle button first
        try {
            const toggleBtn = await page.$(SELECTORS.pineEditorToggle);
            if (toggleBtn) {
                await toggleBtn.click();
                await this.sleep(1500);
                logger.automation("Pine Editor opened via toggle button");
                return;
            }
        } catch {
            logger.debug("Toggle button method failed, trying alternatives", "automation");
        }

        // Fallback: try keyboard shortcut or bottom panel tab
        try {
            // Look for "Pine Editor" text in bottom panel tabs
            const tabs = await page.$$('.layout__area--bottom [class*="tab"]');
            for (const tab of tabs) {
                const text = await page.evaluate(
                    (el: Element) => el.textContent,
                    tab
                );
                if (text && text.includes("Pine Editor")) {
                    await tab.click();
                    await this.sleep(1500);
                    logger.automation("Pine Editor opened via bottom tab");
                    return;
                }
            }
        } catch {
            logger.debug("Tab method failed", "automation");
        }

        logger.warn("Could not find Pine Editor toggle — it may need manual opening", "automation");
    }

    /** Focus the code editor textarea */
    async focusEditor(): Promise<void> {
        const page = await this.getPage();
        logger.automation("Focusing Pine Editor code area...");

        // Try Monaco editor textarea (TradingView uses Monaco)
        const textarea = await page.$(SELECTORS.monacoTextarea);
        if (textarea) {
            await textarea.click();
            await this.sleep(500);
            logger.automation("Focused Monaco editor textarea");
            return;
        }

        // Fallback: click on the editor view area
        const editorView = await page.$(SELECTORS.monacoEditor);
        if (editorView) {
            await editorView.click();
            await this.sleep(500);
            logger.automation("Focused editor view area");
            return;
        }

        // Last resort: click on the Pine Editor pane itself
        const pane = await page.$(SELECTORS.pineEditorPane);
        if (pane) {
            await pane.click();
            await this.sleep(500);
            logger.automation("Focused Pine Editor pane (fallback)");
            return;
        }

        throw new Error("Could not find Pine Editor code area to focus");
    }

    /** Select all code in the editor and delete it */
    async clearEditor(): Promise<void> {
        const page = await this.getPage();
        logger.automation("Clearing Pine Editor...");

        await this.focusEditor();

        // Select all
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await this.sleep(300);

        // Delete selected content
        await page.keyboard.press("Backspace");
        await this.sleep(500);

        logger.automation("Pine Editor cleared");
    }

    /** Insert Pine Script code into the editor using clipboard */
    async insertCode(code: string): Promise<void> {
        const page = await this.getPage();
        logger.automation("Inserting Pine Script code...", {
            codeLength: code.length,
        });

        await this.focusEditor();

        // Use CDP to write to clipboard and paste — avoids clipboardy ESM issues
        const client = await page.createCDPSession();

        try {
            // Write code to system clipboard via CDP
            await client.send("Browser.grantPermissions", {
                permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
            });
        } catch {
            // Permissions API may not be available in all contexts, continue anyway
        }

        // Use page.evaluate to write to clipboard
        await page.evaluate(async (text: string) => {
            await navigator.clipboard.writeText(text);
        }, code);

        await this.sleep(300);

        // Paste
        await page.keyboard.down("Control");
        await page.keyboard.press("v");
        await page.keyboard.up("Control");

        await this.sleep(3000); // Wait for syntax highlighting to process

        logger.automation("Code inserted into Pine Editor");

        try {
            await client.detach();
        } catch { /* ignore */ }
    }

    /** Save the current script */
    async saveScript(scriptName?: string): Promise<void> {
        const page = await this.getPage();
        logger.automation("Saving Pine Script...");

        // Use keyboard shortcut to save
        await page.keyboard.down("Control");
        await page.keyboard.press("s");
        await page.keyboard.up("Control");
        await this.sleep(2000);

        // Check if a save dialog appeared (first-time save or "Save As")
        const dialog = await page.$(SELECTORS.saveDialog);
        if (dialog) {
            logger.automation("Save dialog detected, entering name...");

            if (scriptName) {
                const input = await page.$(SELECTORS.saveDialogInput);
                if (input) {
                    await input.click({ clickCount: 3 }); // Select existing text
                    await page.keyboard.type(scriptName, { delay: 30 });
                }
            }

            // Click confirm/submit button in dialog
            const confirmBtn = await page.$(SELECTORS.saveDialogConfirm);
            if (confirmBtn) {
                await confirmBtn.click();
            } else {
                // Fallback: press Enter to accept
                await page.keyboard.press("Enter");
            }

            await this.sleep(2000);
            logger.automation("Save dialog confirmed");
        }

        logger.automation("Pine Script saved");
    }

    /** Click "Add to chart" button */
    async addToChart(): Promise<void> {
        const page = await this.getPage();
        logger.automation("Adding script to chart...");

        // Try selector-based click
        const addBtn = await page.$(SELECTORS.addToChartButton);
        if (addBtn) {
            await addBtn.click();
            await this.sleep(4000);
            logger.automation("Script added to chart via button click");
            return;
        }

        // Fallback: look for button with "Add to chart" text
        const buttons = await page.$$("button");
        for (const btn of buttons) {
            const text = await page.evaluate(
                (el: Element) => el.textContent?.trim(),
                btn
            );
            if (text && text.toLowerCase().includes("add to chart")) {
                await btn.click();
                await this.sleep(4000);
                logger.automation("Script added to chart via text search");
                return;
            }
        }

        logger.warn("Could not find 'Add to Chart' button", "automation");
    }

    /** Read compilation errors from Pine Editor */
    async getCompilationErrors(): Promise<string[]> {
        const page = await this.getPage();
        const errors: string[] = [];

        try {
            // Check for error panel
            const errorElements = await page.$$(SELECTORS.errorLine);
            for (const el of errorElements) {
                const text = await page.evaluate(
                    (node: Element) => node.textContent?.trim() || "",
                    el
                );
                if (text) errors.push(text);
            }

            // Also check for inline error markers
            const errorMarkers = await page.$$(".squiggly-error");
            if (errorMarkers.length > 0) {
                errors.push(`${errorMarkers.length} inline error(s) detected`);
            }
        } catch (err) {
            logger.debug("Error reading compilation errors (may not exist)", "automation");
        }

        return errors;
    }

    /** Read the list of indicators active on the chart */
    async getActiveIndicators(): Promise<Array<{ name: string; hasError: boolean }>> {
        const page = await this.getPage();
        const indicators: Array<{ name: string; hasError: boolean }> = [];

        try {
            const legendItems = await page.$$('[data-name="legend"] [class*="sourcesWrapper"] [class*="item"]');
            for (const item of legendItems) {
                const name = await page.evaluate(
                    (el: Element) => {
                        const titleEl = el.querySelector('[class*="title"]');
                        return titleEl?.textContent?.trim() || "";
                    },
                    item
                );
                const hasError = await page.evaluate(
                    (el: Element) => {
                        return !!el.querySelector('[class*="error"]');
                    },
                    item
                );
                if (name) {
                    indicators.push({ name, hasError });
                }
            }
        } catch {
            logger.debug("Could not read indicator list from chart legend", "automation");
        }

        return indicators;
    }

    /** Full deployment pipeline: open → clear → insert → save → add to chart */
    async deployScript(code: string, scriptName?: string): Promise<{ success: boolean; errors: string[] }> {
        logger.deployment(`Starting full deployment pipeline${scriptName ? ` for "${scriptName}"` : ""}...`);

        try {
            await this.openPineEditor();
            await this.sleep(1000);

            await this.clearEditor();
            await this.sleep(500);

            await this.insertCode(code);
            await this.sleep(1000);

            // Check for immediate compilation errors
            const preErrors = await this.getCompilationErrors();
            if (preErrors.length > 0) {
                logger.error(`Compilation errors before save: ${preErrors.join(", ")}`, "deployment");
                return { success: false, errors: preErrors };
            }

            await this.saveScript(scriptName);
            await this.sleep(1000);

            await this.addToChart();
            await this.sleep(2000);

            // Check for post-deployment errors
            const postErrors = await this.getCompilationErrors();
            if (postErrors.length > 0) {
                logger.warn(`Post-deployment warnings: ${postErrors.join(", ")}`, "deployment");
                return { success: true, errors: postErrors };
            }

            logger.deployment(`Deployment pipeline completed successfully${scriptName ? ` for "${scriptName}"` : ""}`);
            return { success: true, errors: [] };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Deployment pipeline failed: ${message}`, "deployment");
            return { success: false, errors: [message] };
        }
    }
}

// Singleton
export const pineEditor = new PineEditor();
