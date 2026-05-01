import { askOllama } from "./ollama_client";

export async function analyzeTradeSignal(signal: any): Promise<string> {
    const prompt = `
You are a professional Forex/Gold institutional analyst.

Analyze this TradingView signal:
${JSON.stringify(signal)}

Tell:
- signal quality
- continuation chance
- should add more lots?
- stoploss danger
- quick recommendation
`;

    return await askOllama(prompt);
}