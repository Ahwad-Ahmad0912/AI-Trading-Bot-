// ─────────────────────────────────────────────
// Pine Script Deployer — Production-Grade
// ─────────────────────────────────────────────
// Watches the Pinescripts folder for new and updated
// files, validates them, and deploys through the Pine
// Editor with queuing, retries, and confirmation.

import chokidar from "chokidar";
import fs from "fs";
import path from "path";
import { logger } from "../core/logger";
import { eventBus } from "../core/event-bus";
import { getConfig } from "../core/config-loader";
import { pineEditor } from "./pine-editor";
import { validatePineScript } from "./pine-validator";
import { DeploymentResult, PineValidationResult } from "../types/signals";

interface DeployJob {
    filePath: string;
    fileName: string;
    code: string;
    isUpdate: boolean;
    attempt: number;
    addedAt: Date;
}

export class PineDeployer {
    private deployedScripts: Map<string, { hash: string; deployedAt: Date }> = new Map();
    private deployQueue: DeployJob[] = [];
    private isProcessing = false;
    private watcher: chokidar.FSWatcher | null = null;
    private isRunning = false;

    /** Start watching the Pinescripts directory */
    async start(): Promise<void> {
        const config = getConfig().pineScripts;
        const watchDir = path.resolve(config.watchDir);

        logger.info(`Pine Deployer starting — watching: ${watchDir}`, "deployment");

        // Ensure watch directory exists
        if (!fs.existsSync(watchDir)) {
            fs.mkdirSync(watchDir, { recursive: true });
            logger.info(`Created watch directory: ${watchDir}`, "deployment");
        }

        // Index existing files (mark as already deployed)
        await this.indexExistingFiles(watchDir, config.watchExtensions);

        // Start file watcher
        this.watcher = chokidar.watch(watchDir, {
            ignoreInitial: true,
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 200,
            },
        });

        this.watcher.on("add", (filePath: string) => {
            if (this.isWatchedExtension(filePath, config.watchExtensions)) {
                logger.info(`New Pine file detected: ${path.basename(filePath)}`, "deployment");
                eventBus.emit("pine:detected", { filePath, isNew: true });
                this.queueDeployment(filePath, false);
            }
        });

        this.watcher.on("change", (filePath: string) => {
            if (this.isWatchedExtension(filePath, config.watchExtensions)) {
                logger.info(`Pine file updated: ${path.basename(filePath)}`, "deployment");
                eventBus.emit("pine:detected", { filePath, isNew: false });
                this.queueDeployment(filePath, true);
            }
        });

        this.watcher.on("unlink", (filePath: string) => {
            if (this.isWatchedExtension(filePath, config.watchExtensions)) {
                const normalized = this.normalizePath(filePath);
                this.deployedScripts.delete(normalized);
                logger.info(`Pine file removed: ${path.basename(filePath)}`, "deployment");
            }
        });

        this.watcher.on("error", (error: unknown) => {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`File watcher error: ${errMsg}`, "deployment");
            eventBus.emit("system:error", {
                component: "PineDeployer",
                error: errMsg,
            });
        });

        this.isRunning = true;
        logger.info(`Pine Deployer active — ${this.deployedScripts.size} existing scripts indexed`, "deployment");
    }

    /** Stop the file watcher */
    async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.isRunning = false;
        logger.info("Pine Deployer stopped", "deployment");
    }

    /** Manually trigger deployment of a specific file */
    async deployFile(filePath: string): Promise<DeploymentResult> {
        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            return {
                success: false,
                filePath: resolvedPath,
                fileName: path.basename(resolvedPath),
                timestamp: new Date(),
                errors: [`File not found: ${resolvedPath}`],
                retryCount: 0,
            };
        }

        const code = fs.readFileSync(resolvedPath, "utf-8");
        return this.executeDeploy({
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
            code,
            isUpdate: this.deployedScripts.has(this.normalizePath(resolvedPath)),
            attempt: 1,
            addedAt: new Date(),
        });
    }

    /** Get list of all tracked scripts */
    getDeployedScripts(): Array<{ file: string; hash: string; deployedAt: Date }> {
        const result: Array<{ file: string; hash: string; deployedAt: Date }> = [];
        for (const [file, info] of this.deployedScripts) {
            result.push({ file, ...info });
        }
        return result;
    }

    get running(): boolean {
        return this.isRunning;
    }

    // ── Private Methods ──

    private async indexExistingFiles(dir: string, extensions: string[]): Promise<void> {
        try {
            const files = fs.readdirSync(dir).filter((f) =>
                extensions.some((ext) => f.endsWith(ext))
            );

            for (const file of files) {
                const fullPath = path.join(dir, file);
                const code = fs.readFileSync(fullPath, "utf-8");
                const normalized = this.normalizePath(fullPath);
                this.deployedScripts.set(normalized, {
                    hash: this.hashCode(code),
                    deployedAt: new Date(),
                });
            }

            logger.info(`Indexed ${files.length} existing Pine files`, "deployment");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to index existing files: ${message}`, "deployment");
        }
    }

    private queueDeployment(filePath: string, isUpdate: boolean): void {
        const resolvedPath = path.resolve(filePath);
        const code = fs.readFileSync(resolvedPath, "utf-8");
        const normalized = this.normalizePath(resolvedPath);
        const currentHash = this.hashCode(code);

        // Skip if content hasn't actually changed
        const existing = this.deployedScripts.get(normalized);
        if (existing && existing.hash === currentHash) {
            logger.debug(`Skipping ${path.basename(filePath)} — content unchanged`, "deployment");
            return;
        }

        // Remove any existing queue entry for this file (replace with latest)
        this.deployQueue = this.deployQueue.filter(
            (job) => this.normalizePath(job.filePath) !== normalized
        );

        this.deployQueue.push({
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
            code,
            isUpdate,
            attempt: 1,
            addedAt: new Date(),
        });

        logger.deployment(`Queued for deployment: ${path.basename(filePath)} (${isUpdate ? "update" : "new"})`, {
            queueLength: this.deployQueue.length,
        });

        // Start processing queue if not already running
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.deployQueue.length === 0) return;
        this.isProcessing = true;

        const config = getConfig().pineScripts;

        while (this.deployQueue.length > 0) {
            const job = this.deployQueue.shift()!;

            const result = await this.executeDeploy(job);

            if (!result.success && job.attempt < config.maxDeployRetries) {
                // Re-queue with incremented attempt
                job.attempt++;
                this.deployQueue.push(job);
                logger.warn(
                    `Retry ${job.attempt}/${config.maxDeployRetries} queued for ${job.fileName}`,
                    "deployment"
                );
            }

            // Delay between deployments to avoid overwhelming TradingView
            if (this.deployQueue.length > 0) {
                await this.sleep(config.deployQueueDelayMs);
            }
        }

        this.isProcessing = false;
    }

    private async executeDeploy(job: DeployJob): Promise<DeploymentResult> {
        const config = getConfig().pineScripts;

        logger.deployment(`Deploying: ${job.fileName} (attempt ${job.attempt})...`);
        eventBus.emit("pine:deploying", { filePath: job.filePath, attempt: job.attempt });

        // Step 1: Validate (if enabled)
        if (config.preValidate) {
            eventBus.emit("pine:validating", { filePath: job.filePath });
            const validation = validatePineScript(job.code, job.filePath);
            eventBus.emit("pine:validated", {
                filePath: job.filePath,
                valid: validation.valid,
                errors: validation.errors,
            });

            if (!validation.valid) {
                const result: DeploymentResult = {
                    success: false,
                    filePath: job.filePath,
                    fileName: job.fileName,
                    timestamp: new Date(),
                    errors: validation.errors,
                    retryCount: job.attempt,
                };
                eventBus.emit("pine:error", {
                    filePath: job.filePath,
                    error: `Validation failed: ${validation.errors.join("; ")}`,
                });
                eventBus.emit("pine:deployed", result);
                return result;
            }
        }

        // Step 2: Deploy via Pine Editor
        try {
            const scriptName = job.fileName.replace(/\.(pine|txt)$/, "");
            const symbols = getConfig().tradingview.symbols;
            
            let anySuccess = false;
            const allErrors: string[] = [];

            for (const symbol of symbols) {
                const deployResult = await pineEditor.deployScriptToChart(symbol, job.code, scriptName);
                if (deployResult.success) {
                    anySuccess = true;
                } else if (deployResult.errors && deployResult.errors.length > 0) {
                    allErrors.push(`[${symbol}]: ${deployResult.errors.join("; ")}`);
                }
            }

            const deployResult = { success: anySuccess, errors: allErrors };

            const result: DeploymentResult = {
                success: deployResult.success,
                filePath: job.filePath,
                fileName: job.fileName,
                timestamp: new Date(),
                errors: deployResult.errors,
                retryCount: job.attempt,
            };

            if (deployResult.success) {
                // Update tracking
                const normalized = this.normalizePath(job.filePath);
                this.deployedScripts.set(normalized, {
                    hash: this.hashCode(job.code),
                    deployedAt: new Date(),
                });

                logger.deployment(`✅ Successfully deployed: ${job.fileName}`, {
                    attempt: job.attempt,
                    isUpdate: job.isUpdate,
                });
            } else {
                logger.error(`❌ Deployment failed: ${job.fileName} — ${deployResult.errors.join("; ")}`, "deployment");
                eventBus.emit("pine:error", {
                    filePath: job.filePath,
                    error: deployResult.errors.join("; "),
                });
            }

            eventBus.emit("pine:deployed", result);
            return result;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Deployment exception: ${job.fileName} — ${message}`, "deployment");

            const result: DeploymentResult = {
                success: false,
                filePath: job.filePath,
                fileName: job.fileName,
                timestamp: new Date(),
                errors: [message],
                retryCount: job.attempt,
            };

            eventBus.emit("pine:error", { filePath: job.filePath, error: message });
            eventBus.emit("pine:deployed", result);
            return result;
        }
    }

    private isWatchedExtension(filePath: string, extensions: string[]): boolean {
        return extensions.some((ext) => filePath.endsWith(ext));
    }

    private normalizePath(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
    }

    private hashCode(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Singleton
export const pineDeployer = new PineDeployer();
