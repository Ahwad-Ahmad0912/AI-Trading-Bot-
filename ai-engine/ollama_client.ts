import axios from "axios";

export async function askOllama(prompt: string): Promise<string> {
    try {
        const response = await axios.post("http://localhost:11434/api/generate", {
            model: "qwen2.5-coder:14b",
            prompt,
            stream: false
        });

        return response.data.response;
    } catch (err: any) {
        console.error("Ollama error:", err.message);
        return "Ollama failed.";
    }
}