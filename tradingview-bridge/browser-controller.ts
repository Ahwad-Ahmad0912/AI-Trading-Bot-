import puppeteer, { Browser, Page } from "puppeteer";

let browser: Browser;
let page: Page;

export async function launchTradingView(): Promise<Page> {
    browser = await puppeteer.connect({
        browserURL: "http://127.0.0.1:9222",
        defaultViewport: null
    });

    const pages = await browser.pages();

    const tvPage = pages.find(p => p.url().includes("tradingview.com/chart"));

    if (tvPage) {
        page = tvPage;
    } else {
        page = await browser.newPage();
        await page.goto("https://www.tradingview.com/chart/", {
            waitUntil: "domcontentloaded"
        });
    }

    await page.bringToFront();

    await page.setViewport({
        width: 1540,
        height: 720
    });

    const client = await page.target().createCDPSession();
    await client.send("Browser.setWindowBounds", {
        windowId: (await client.send("Browser.getWindowForTarget")).windowId,
        bounds: { windowState: "maximized" }
    });

    page.setDefaultNavigationTimeout(0);

    console.log("Attached specifically to full TradingView chart tab.");

    return page;
}

export function getTradingPage(): Page {
    return page;
}