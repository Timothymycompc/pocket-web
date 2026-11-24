// screens.mjs: screenshots of every Pocket Web page on a phone and on a desktop, from the LIVE
// site, for a visual review (and Devpost). One real question is asked so the Ask page shows a
// finished answer. Writes out/screen-*.png. Runs in Cloud Build.
import { chromium, devices } from "playwright";
import fs from "node:fs";

const SITE = process.env.SITE || "https://pocket-web-1021990235790.us-central1.run.app";
fs.mkdirSync("out", { recursive: true });
const browser = await chromium.launch();

async function shoot(label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 200)));
  for (const view of ["home", "helpers", "builders"]) {
    await page.goto(`${SITE}/#${view}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `out/screen-${label}-${view}.png`, fullPage: true });
  }
  await page.goto(`${SITE}/#ask`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ns-input", { timeout: 60_000 });
  await page.screenshot({ path: `out/screen-${label}-ask-empty.png` });
  await page.fill("#ns-input", "Was the Graco Quattro Tour stroller recalled?");
  await page.click("#ns-send");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `out/screen-${label}-ask-consent.png` });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const allow = page.locator(".ns-consent button[data-d=allow]");
    for (let k = 0; k < await allow.count(); k++) if (await allow.nth(k).isVisible().catch(() => false)) await allow.nth(k).click().catch(() => {});
    if (await page.locator(".site-words").count()) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `out/screen-${label}-ask-answer.png` });
  // Shared-from-another-app flow
  await page.goto(`${SITE}/share?title=${encodeURIComponent("Graco stroller for sale")}&text=${encodeURIComponent("Graco Quattro Tour stroller, barely used, $40")}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `out/screen-${label}-shared.png` });
  fs.writeFileSync(`out/console-${label}.json`, JSON.stringify(errors, null, 2));
  console.log(label, "console errors:", errors);
  await ctx.close();
}

await shoot("phone", { ...devices["Pixel 7"] });
await shoot("desktop", { viewport: { width: 1366, height: 860 } });
await browser.close();
