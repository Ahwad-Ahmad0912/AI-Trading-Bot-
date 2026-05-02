<div align="center">

# 🤖 AI TradingView Bot v2.0
### Autonomous AI-Powered TradingView Strategy Deployment & Signal Intelligence System

<img src="https://img.shields.io/badge/TypeScript-100%25-blue?style=for-the-badge&logo=typescript" />
<img src="https://img.shields.io/badge/Node.js-Backend-green?style=for-the-badge&logo=node.js" />
<img src="https://img.shields.io/badge/Puppeteer-Browser%20Automation-orange?style=for-the-badge&logo=googlechrome" />
<img src="https://img.shields.io/badge/Ollama-AI%20Engine-purple?style=for-the-badge" />
<img src="https://img.shields.io/badge/TradingView-Pine%20Automation-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Architecture-Event%20Driven-black?style=for-the-badge" />

---

### ⚡ A Fully Autonomous TradingView Companion that Watches Charts, Deploys Pine Scripts, Detects Signals, and Delivers AI-Enhanced Trade Intelligence in Real Time.

</div>

---

# 📌 Overview

AI TradingView Bot v2.0 is a production-grade modular trading assistant engineered to bridge **TradingView browser automation**, **Pine Script deployment**, **continuous chart surveillance**, **AI-powered market signal analysis**, and **webhook-based alert routing** into one resilient autonomous system.

Unlike simple TradingView automation scripts, this bot acts like an **intelligent orchestration engine** capable of:

- Monitoring live TradingView chart state
- Auto-deploying Pine indicators/scripts
- Validating Pine syntax before deployment
- Detecting technical opportunities using AI
- Running structured trade analysis via Ollama LLM
- Sending rich alert notifications
- Logging all subsystems with fault tolerance
- Recovering from browser disconnects automatically

---

# 🧠 Core Engineering Highlights

✅ Fully rebuilt from broken legacy skeleton into a **19-file enterprise architecture**  
✅ Fixed **23+ critical runtime and automation bugs**  
✅ Removed pixel-click fragility → replaced with DOM/CSS automation  
✅ Added retry loops, health checks, deployment queues, typed event bus  
✅ Added AI signal detection + structured confidence scoring  
✅ Added REST monitoring endpoints `/health`, `/status`, `/detect`, `/deploy`  
✅ Structured Winston logging across all subsystems

---

# 🏗️ System Architecture

```bash
AI-Trading-View/
│
├── ai-engine/                  # Legacy AI modules
├── alert-server/              # Legacy webhook modules
├── tradingview-bridge/        # Legacy TV automation modules
│
├── src/
│   ├── index.ts               # Main orchestration entry point
│   │
│   ├── core/
│   │   ├── logger.ts
│   │   ├── config-loader.ts
│   │   └── event-bus.ts
│   │
│   ├── types/
│   │   ├── config.ts
│   │   ├── signals.ts
│   │   └── chart.ts
│   │
│   ├── tradingview-bridge/
│   │   ├── browser-controller.ts
│   │   ├── pine-editor.ts
│   │   ├── pine-deployer.ts
│   │   ├── pine-validator.ts
│   │   ├── chart-monitor.ts
│   │   └── script-monitor.ts
│   │
│   ├── ai-engine/
│   │   ├── ollama-client.ts
│   │   ├── trade-analyzer.ts
│   │   ├── signal-detector.ts
│   │   └── prompts.ts
│   │
│   └── alert-server/
│       ├── webhook-server.ts
│       └── alert-manager.ts
│
├── Pinescripts/               # Drop .pine files here
├── config.json                # Global subsystem configuration
├── package.json
└── tsconfig.json
```

---

# 🚀 Major Features

## 📈 Continuous Chart Monitoring
The bot continuously polls TradingView DOM every few seconds and extracts:

- Symbol
- Current price
- Timeframe
- Indicator state
- Script health
- UI alerts

This allows the bot to maintain a live understanding of the chart without manual refresh.

---

## 📝 Autonomous Pine Script Deployment
Simply drop any `.pine` file inside:

```bash
/Pinescripts/
```

The bot automatically:

- Detects file changes
- Validates Pine syntax
- Opens Pine editor
- Injects script content
- Saves and adds indicator to chart
- Retries failed deployment up to 3 times

No manual TradingView editing required.

---

## 🤖 AI Market Signal Detection (Ollama Powered)
Every cycle, the chart state is passed into the local Ollama model for:

- breakout detection
- reversal spotting
- support/resistance behavior
- trend continuation
- unusual momentum shifts

Signals are returned with:

- confidence %
- direction
- trade bias
- TP / SL estimation
- risk level

---

## 📡 Intelligent Alert Routing
When a signal is generated:

- duplicate alerts are filtered
- structured terminal notification is printed
- webhook endpoint can broadcast signal externally

Future integrations:
- Telegram
- Discord
- Slack
- Mobile push

---

## 🛡️ Resilient Browser Recovery Layer
Traditional TradingView bots crash when browser disconnects.

This system includes:

- browser health checks
- reconnect loops
- deployment queue persistence
- script state tracking

Meaning the bot survives unstable browser sessions.

---

# 🔥 Critical Problems Solved in v2.0

| Legacy Problem | Production Fix |
|----------------|----------------|
| ESM/CJS package crash | unified CommonJS-safe runtime |
| Hardcoded pixel clicking | CSS selector automation |
| Zero error handling | retry + try/catch loops |
| No browser recovery | health-check reconnect |
| Broken config loading | validated config loader |
| Silent Pine failures | deployment queue + validator |
| No AI structure | typed JSON trade classification |
| No logging | Winston structured logs |

---

# ⚙️ Technology Stack

- **TypeScript**
- **Node.js**
- **Puppeteer**
- **TradingView Browser DOM Automation**
- **Ollama Local LLM**
- **Winston Logger**
- **Express Webhook Server**
- **Event-Driven Internal Bus**
- **Pine Script Runtime Deployment**

---

# 🌐 REST Monitoring Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | overall bot health |
| `/status` | subsystem diagnostics |
| `/tv-alert` | TradingView alert receiver |
| `/detect` | manual AI signal detection |
| `/deploy` | manual Pine deployment |

---

# ⚙️ Installation

## 1. Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/AI-Trading-Bot.git
cd AI-Trading-Bot
```

## 2. Install Packages
```bash
npm install
```

## 3. Launch Chrome With Remote Debugging
```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir="./tv-session" https://www.tradingview.com/chart/
```

## 4. Login To TradingView Manually

Keep this browser window open.

## 5. (Optional) Start Ollama
```bash
ollama serve
ollama pull qwen2.5-coder:14b
```

## 6. Start Bot
```bash
npm start
```

---

# 📂 Pine Script Deployment Usage

Drop any TradingView Pine script into:

```bash
/Pinescripts/
```

Bot automatically detects, validates, and deploys it live.

---

# 📊 Logging System

Separate logs are generated for observability:

```bash
logs/
 ├── combined.log
 ├── deployment.log
 ├── signals.log
 └── errors.log
```

---

# 🧪 Verification

```bash
npx tsc --noEmit   ✅ Zero TypeScript errors
npm install        ✅ Clean dependency tree
19 source files    ✅ Created and wired
23+ bugs fixed     ✅ Stable production runtime
```

---

# 🔮 Planned Future Upgrades

- Binance/Bybit broker execution layer
- Telegram live trade alerts
- Dashboard monitoring UI
- Historical signal learning memory
- Reinforcement AI trade adaptation
- VPS 24/7 deployment mode
- Multi-chart simultaneous scanning

---

⚙️ INSTALLATION GUIDE
1️⃣ Clone Repository
git clone https://github.com/yourusername/AI-Trading-View.git
cd AI-Trading-View
2️⃣ Install Dependencies
npm install
3️⃣ Required Packages
npm install puppeteer chokidar clipboardy axios express ws
npm install -D typescript ts-node @types/node @types/express
▶️ HOW TO RUN THE BOT
STEP 01 — Launch Google Chrome In Remote Debug Mode

Open PowerShell and run:

& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\AI-Trading View\tv-session" "https://www.tradingview.com/chart/"

This launches a dedicated Chrome automation browser attached directly to your TradingView account.

STEP 02 — Start Autonomous Pine Deployment Bot
npm run start-deployer

The bot will automatically:

connect to Chrome debug browser
attach TradingView chart tab
initialize Pine deployment watcher
STEP 03 — Add Any New Pine Script File

Create a new file inside:

Pinescripts/

Example:

Pinescripts/EMA_CROSS_AUTO.pine

As soon as you save the file:

Bot detects → Injects → Saves → Adds To Chart

🔁 LIVE WORKFLOW EXAMPLE
Write Pine Script in VSCode:
//@version=6
indicator("EMA CROSS AUTO", overlay=true)

fast = ta.ema(close,20)
slow = ta.ema(close,50)

plot(fast)
plot(slow)

buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)

plotshape(buy)
plotshape(sell)

Save this file into:

Pinescripts/

Bot automatically deploys it to TradingView.

🧩 AUTOMATION FLOW DIAGRAM
VSCode Pine File Save
        ↓
Chokidar detects new Pine file
        ↓
Puppeteer attaches TradingView browser
        ↓
Pine Editor opens
        ↓
Old code cleared
        ↓
New Pine Script pasted
        ↓
Script saved
        ↓
Add To Chart executed
        ↓
Indicator Live on TradingView
🛠️ PACKAGE.JSON RUN SCRIPT

Add this inside package.json:

"scripts": {
   "start-deployer": "ts-node tradingview-bridge/pine-deployer.ts"
}

Then run:

npm run start-deployer
🔮 DEVELOPMENT ROADMAP
 Chrome debug browser attach
 Autonomous Pine file deployment
 Multi-chart tab launcher
 Deploy latest 2 Pine scripts across all charts
 Continuous chart state monitoring
 Ollama natural language Pine generator
 AI buy/sell opportunity detector
 TradingView native account alert creator
 Mobile push notifications
 Full autonomous AI trading desk
Use in live trading environments at your own risk.


---

# 👨‍💻 Author

### Ahwad Ahmad
AI Systems Developer • Full Stack Engineer • Automation Architect • Quant Research Builder

---

## ⚠️ Disclaimer
This software is built for educational research, AI automation experimentation, and TradingView workflow enhancement only.  
</div>
