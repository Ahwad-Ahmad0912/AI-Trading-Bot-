import chokidar from "chokidar";
import fs from "fs";
import path from "path";
import clipboardy from "clipboardy";
import { launchTradingView, getTradingPage } from "./browser-controller";

const deployedScripts = new Set<string>();

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function focusEditor(page: any) {
    await page.mouse.click(1040, 420);
    await sleep(1000);
}

async function clearEditor(page: any) {
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await sleep(500);
    await page.keyboard.press("Backspace");
    await sleep(1000);
}

async function pasteCode(page: any, code: string) {
    clipboardy.writeSync(code);

    await page.keyboard.down("Control");
    await page.keyboard.press("V");
    await page.keyboard.up("Control");

    await sleep(4000);
}

async function clickSave(page: any) {
    await page.mouse.click(1450, 98); // Save button
    console.log("Clicked Save");
    await sleep(2500);

    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await sleep(500);

    await page.keyboard.press("Enter"); // accept filename if modal appears
    await sleep(3000);
}

async function clickAddToChart(page: any) {
    await page.mouse.click(1240, 98); // Add to chart button
    console.log("Clicked Add To Chart");
    await sleep(5000);
}

async function deployNewPineFile(filePath: string) {
    if (deployedScripts.has(filePath)) return;

    const page = getTradingPage();
    const pineCode = fs.readFileSync(filePath, "utf8");

    console.log(`Deploying ${path.basename(filePath)}`);

    await page.bringToFront();
    await sleep(1500);

    await focusEditor(page);
    await clearEditor(page);
    await pasteCode(page, pineCode);
    await clickSave(page);
    await clickAddToChart(page);

    deployedScripts.add(filePath);

    console.log(`${path.basename(filePath)} deployed successfully.`);
}

async function preloadExistingFiles() {
    const files = fs.readdirSync("./Pinescripts").filter(f => f.endsWith(".pine"));

    for (const file of files) {
        deployedScripts.add(path.join("./Pinescripts", file));
    }

    console.log(`Preloaded ${files.length} old Pine files.`);
}

async function startAutonomousWatcher() {
    await launchTradingView();

    console.log("Waiting 6 seconds for chart render...");
    await sleep(6000);

    await preloadExistingFiles();

    console.log("Watching for NEW Pine files...");

    chokidar.watch("./Pinescripts", {
        ignoreInitial: true,
        persistent: true
    }).on("add", async (filePath) => {
        if (filePath.endsWith(".pine")) {
            console.log(`New Pine detected: ${path.basename(filePath)}`);
            await deployNewPineFile(filePath);
        }
    });
}

startAutonomousWatcher();