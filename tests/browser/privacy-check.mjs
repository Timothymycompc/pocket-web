// privacy-check.mjs: in a real phone browser on the LIVE site, a message with a phone number and an
// email must stop at the privacy guard, and "Remove and send" must send it with both removed.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const SITE = process.env.SITE || "https://pocket-web-1021990235790.us-central1.run.app";
fs.mkdirSync("out", { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
await page.goto(`${SITE}/#ask`, { waitUntil: "networkidle" });
await page.waitForSelector("#ns-input", { timeout: 60_000 });
await page.fill("#ns-input", "Was the Graco Quattro Tour stroller recalled? Text me at 214-555-0182 or tim.test@example.com");
await page.click("#ns-send");
await page.waitForTimeout(800);
const shown = await page.locator("#privacy").isVisible();
const said = shown ? await page.locator("#privacy p").first().innerText() : "";
const userBefore = await page.locator(".ns-msg.user").count();
await page.screenshot({ path: "out/privacy-1-guard.png" });
await page.click("#privacy button.primary");
await page.waitForTimeout(1500);
const users = await page.$$eval(".ns-msg.user", (els) => els.map((e) => e.innerText));
await page.screenshot({ path: "out/privacy-2-sent.png" });
const sent = users[users.length - 1] || "";
const ok = shown && userBefore === 0 && /phone number removed/.test(sent) && /email address removed/.test(sent) && !/555-0182|example\.com/.test(sent);
console.log(JSON.stringify({ ok, guardShown: shown, guardSaid: said, sentBeforeGuard: userBefore, sent }, null, 1));
await browser.close();
process.exit(ok ? 0 : 1);
