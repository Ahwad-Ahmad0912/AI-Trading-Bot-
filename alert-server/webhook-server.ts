import express from "express";
import { analyzeTradeSignal } from "../ai-engine/trade-analyzer";

const app = express();
app.use(express.json());

app.post("/tv-alert", async (req, res) => {
    console.log("TradingView Alert:", req.body);

    const analysis = await analyzeTradeSignal(req.body);

    console.log("AI Analysis:", analysis);

    res.json({
        ok: true,
        analysis
    });
});

app.listen(3000, () => {
    console.log("Webhook listening at http://localhost:3000/tv-alert");
});