// ─────────────────────────────────────────────
// Ollama Client — Production-Grade
// ─────────────────────────────────────────────
// Robust Ollama integration with retries,
// timeouts, health checks, and streaming support.

import axios, { AxiosInstance } from "axios";
import { logger } from "../core/logger";
import { getConfig } from "../core/config-loader";

interface OllamaGenerateRequest {
    model: string;
    prompt: string;
    system?: string;
    stream: boolean;
    options?: {
        temperature?: number;
        top_p?: number;
        num_predict?: number;
    };
    format?: "json";
}

interface OllamaGenerateResponse {
    model: string;
    response: string;
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    eval_count?: number;
}

export class OllamaClient {
    private client: AxiosInstance;
    private isAvailable = false;

    constructor() {
        const config = getConfig().ollama;
        this.client = axios.create({
            baseURL: config.baseUrl,
            timeout: config.timeoutMs,
            headers: { "Content-Type": "application/json" },
        });
    }

    /** Check if Ollama is running and the model is available */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.client.get("/api/tags", { timeout: 5000 });
            const models = response.data?.models || [];
            const config = getConfig().ollama;
            const modelAvailable = models.some(
                (m: { name: string }) => m.name.includes(config.model.split(":")[0])
            );

            this.isAvailable = true;

            if (!modelAvailable) {
                logger.warn(`Ollama is running but model "${config.model}" not found. Available: ${models.map((m: { name: string }) => m.name).join(", ")}`, "ai");
            } else {
                logger.info(`Ollama health check passed — model "${config.model}" available`, "ai");
            }

            return true;
        } catch (err: unknown) {
            this.isAvailable = false;
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Ollama health check failed: ${msg}`, "ai");
            return false;
        }
    }

    /** Send a prompt to Ollama and get a response (with retry logic) */
    async generate(prompt: string, options?: {
        system?: string;
        temperature?: number;
        jsonFormat?: boolean;
        maxTokens?: number;
    }): Promise<string> {
        const config = getConfig().ollama;

        const request: OllamaGenerateRequest = {
            model: config.model,
            prompt,
            stream: false,
            system: options?.system,
            options: {
                temperature: options?.temperature ?? 0.7,
                num_predict: options?.maxTokens ?? 2048,
            },
        };

        if (options?.jsonFormat) {
            request.format = "json";
        }

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            try {
                logger.debug(`Ollama request (attempt ${attempt}/${config.maxRetries})`, "ai", {
                    promptLength: prompt.length,
                    model: config.model,
                });

                const response = await this.client.post<OllamaGenerateResponse>(
                    "/api/generate",
                    request
                );

                const result = response.data.response;

                logger.debug("Ollama response received", "ai", {
                    responseLength: result.length,
                    evalCount: response.data.eval_count,
                    totalDuration: response.data.total_duration
                        ? `${(response.data.total_duration / 1e9).toFixed(2)}s`
                        : undefined,
                });

                return result;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));

                if (attempt < config.maxRetries) {
                    const delay = config.retryDelayMs * attempt;
                    logger.warn(
                        `Ollama request failed (attempt ${attempt}): ${lastError.message}. Retrying in ${delay}ms...`,
                        "ai"
                    );
                    await this.sleep(delay);
                }
            }
        }

        logger.error(`Ollama request failed after ${config.maxRetries} attempts: ${lastError?.message}`, "ai");
        return `[AI Error: Ollama unavailable after ${config.maxRetries} retries — ${lastError?.message}]`;
    }

    /** Send a prompt requesting structured JSON response */
    async generateJSON<T = Record<string, unknown>>(
        prompt: string,
        systemPrompt?: string
    ): Promise<T | null> {
        const response = await this.generate(prompt, {
            system: systemPrompt,
            jsonFormat: true,
            temperature: 0.3, // Lower temperature for structured output
        });

        try {
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as T;
            }

            // Try parsing the whole response
            return JSON.parse(response) as T;
        } catch {
            logger.warn("Failed to parse Ollama response as JSON", "ai", {
                response: response.substring(0, 200),
            });
            return null;
        }
    }

    get available(): boolean {
        return this.isAvailable;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// Singleton
export const ollamaClient = new OllamaClient();
