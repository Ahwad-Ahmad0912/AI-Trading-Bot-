// ─────────────────────────────────────────────
// Pine Script Validator
// ─────────────────────────────────────────────
// Pre-deployment syntax checking to catch errors
// before injecting code into TradingView.

import { logger } from "../core/logger";
import { PineValidationResult } from "../types/signals";

// Known Pine Script v5/v6 built-in functions (subset for validation)
const PINE_BUILTINS = new Set([
    "indicator", "strategy", "library",
    "input.int", "input.float", "input.bool", "input.string",
    "input.color", "input.timeframe", "input.source", "input.price",
    "input", "input.session", "input.symbol", "input.text_area",
    "ta.sma", "ta.ema", "ta.rma", "ta.wma", "ta.vwma",
    "ta.rsi", "ta.macd", "ta.atr", "ta.stoch", "ta.cci",
    "ta.crossover", "ta.crossunder", "ta.highest", "ta.lowest",
    "ta.change", "ta.mom", "ta.pivothigh", "ta.pivotlow",
    "ta.supertrend", "ta.bb",
    "request.security", "request.security_lower_tf",
    "plot", "plotshape", "plotchar", "plotarrow", "plotcandle", "plotbar",
    "hline", "fill", "bgcolor",
    "line.new", "label.new", "box.new", "table.new",
    "str.tostring", "str.format", "str.contains", "str.length",
    "math.abs", "math.max", "math.min", "math.round", "math.log",
    "math.sqrt", "math.pow", "math.ceil", "math.floor",
    "array.new_float", "array.new_int", "array.new_string",
    "array.push", "array.pop", "array.get", "array.set", "array.size",
    "alertcondition", "alert",
    "syminfo.tickerid", "syminfo.ticker", "syminfo.currency",
    "timeframe.period", "timeframe.multiplier",
    "barmerge.lookahead_on", "barmerge.lookahead_off",
    "color.new", "color.rgb",
]);

const VERSION_REGEX = /\/\/@version=(\d+)/;
const DECLARATION_REGEX = /^(indicator|strategy|library)\s*\(/m;
const UNCLOSED_PAREN_REGEX = /\([^)]*$/m;
const UNCLOSED_BRACKET_REGEX = /\[[^\]]*$/m;

export function validatePineScript(code: string, filePath: string = ""): PineValidationResult {
    const result: PineValidationResult = {
        valid: true,
        version: null,
        scriptType: null,
        scriptName: null,
        errors: [],
        warnings: [],
    };

    const lines = code.split("\n").map((l) => l.replace(/\r$/, ""));

    if (code.trim().length === 0) {
        result.valid = false;
        result.errors.push("File is empty");
        return result;
    }

    // ── Check @version header ──
    const versionMatch = code.match(VERSION_REGEX);
    if (!versionMatch) {
        result.valid = false;
        result.errors.push("Missing //@version= header. Pine Script requires a version declaration (e.g., //@version=6)");
    } else {
        result.version = parseInt(versionMatch[1], 10);
        if (result.version < 4) {
            result.warnings.push(`Pine Script v${result.version} is very old. Consider upgrading to v5 or v6.`);
        }
        if (result.version > 6) {
            result.warnings.push(`Pine Script v${result.version} is not a known version. Latest known is v6.`);
        }
    }

    // ── Check declaration (indicator/strategy/library) ──
    const declMatch = code.match(DECLARATION_REGEX);
    if (!declMatch) {
        result.valid = false;
        result.errors.push("Missing indicator(), strategy(), or library() declaration");
    } else {
        result.scriptType = declMatch[1] as "indicator" | "strategy" | "library";

        // Try to extract script name
        const nameRegex = new RegExp(`${declMatch[1]}\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`);
        const nameMatch = code.match(nameRegex);
        if (nameMatch) {
            result.scriptName = nameMatch[1];
        }
    }

    // ── Check balanced brackets/parentheses ──
    let parenDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let stringChar = "";
    let inComment = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments
        if (trimmed.startsWith("//")) continue;

        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            const prev = j > 0 ? line[j - 1] : "";

            // Handle string state
            if (!inComment && (ch === '"' || ch === "'") && prev !== "\\") {
                if (inString && ch === stringChar) {
                    inString = false;
                } else if (!inString) {
                    inString = true;
                    stringChar = ch;
                }
                continue;
            }

            if (inString) continue;

            // Handle line comments
            if (ch === "/" && j + 1 < line.length && line[j + 1] === "/") {
                break; // Rest of line is comment
            }

            if (ch === "(") parenDepth++;
            if (ch === ")") parenDepth--;
            if (ch === "[") bracketDepth++;
            if (ch === "]") bracketDepth--;

            if (parenDepth < 0) {
                result.errors.push(`Line ${i + 1}: Unexpected closing parenthesis ')'`);
                result.valid = false;
                parenDepth = 0;
            }
            if (bracketDepth < 0) {
                result.errors.push(`Line ${i + 1}: Unexpected closing bracket ']'`);
                result.valid = false;
                bracketDepth = 0;
            }
        }
    }

    if (parenDepth > 0) {
        result.errors.push(`Unclosed parenthesis: ${parenDepth} opening '(' without matching ')'`);
        result.valid = false;
    }
    if (bracketDepth > 0) {
        result.errors.push(`Unclosed bracket: ${bracketDepth} opening '[' without matching ']'`);
        result.valid = false;
    }

    // ── Check for common mistakes ──

    // Empty function body
    if (result.scriptType === "strategy") {
        const hasEntryExit = /strategy\.(entry|close|exit|order)/.test(code);
        if (!hasEntryExit) {
            result.warnings.push("Strategy has no strategy.entry(), strategy.close(), or strategy.exit() calls");
        }
    }

    // Check for v4-style syntax used in v5/v6
    if (result.version && result.version >= 5) {
        if (/\bstudy\s*\(/.test(code)) {
            result.errors.push("study() is deprecated in v5+. Use indicator() instead.");
            result.valid = false;
        }
        if (/\bsecurity\s*\(/.test(code) && !/request\.security/.test(code)) {
            result.warnings.push("security() is deprecated in v5+. Use request.security() instead.");
        }
    }

    // ── Log results ──
    const fileName = filePath ? filePath.split(/[/\\]/).pop() : "unknown";
    if (result.valid) {
        logger.info(`Pine validation passed: ${fileName} (v${result.version}, ${result.scriptType}: "${result.scriptName}")`, "deployment");
    } else {
        logger.error(`Pine validation failed: ${fileName} — ${result.errors.join("; ")}`, "deployment");
    }
    if (result.warnings.length > 0) {
        logger.warn(`Pine warnings for ${fileName}: ${result.warnings.join("; ")}`, "deployment");
    }

    return result;
}
