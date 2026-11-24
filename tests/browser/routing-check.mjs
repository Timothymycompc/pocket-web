// routing-check.mjs: measures whether Pocket Web hands each request to the right listed site,
// or to none when nothing fits, in a real phone-sized browser on the LIVE site.
// Cases: routing.json. Writes out/routing-results.json with accuracy. Runs in Cloud Build.
import { chromium, devices } from "playwright";
import fs from "node:fs";

const SITE = process.env.SITE || "https://pocket-web-1021990235790.us-central1.run.app";
const cases = JSON.parse(fs.readFileSync(new URL("./routing.json", import.meta.url), "utf8"));
fs.mkdirSync("out", { recursive: true });
const host = new URL(SITE).host;
const browser = await chromium.launch();
const results = [];
for (const [i, c] of cases.entries()) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const r = { q: c.q, expect: c.expect, why: c.why, called: [], consents: 0, reply: "", pass: false };
  try {
    await page.goto(`${SITE}/#ask`, { waitUntil: "networkidle" });
    await page.waitForSelector("#ns-input", { timeout: 60_000 });
    await page.fill("#ns-input", c.q);
    await page.click("#ns-send");
    await page.waitForFunction(() => document.querySelector(".ns-inputbar")?.dataset.turnActive === "true", null, { timeout: 15_000 }).catch(() => {});
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const allow = page.locator(".ns-consent button[data-d=allow]");
      for (let k = 0; k < await allow.count(); k++) if (await allow.nth(k).isVisible().catch(() => false)) { r.consents += 1; await allow.nth(k).click().catch(() => {}); }
      if ((await page.locator(".ns-inputbar").getAttribute("data-turn-active")) === "false") break;
      await page.waitForTimeout(700);
    }
    r.called = await page.evaluate((h) => [...new Set([...(window.__nsweb?.trace?.spans.values() || [])]
      .filter((s) => s.kind === "tool" && s.origin === h).map((s) => s.tool))], host);
    const bots = await page.$$eval(".ns-msg.bot:not(.ns-turn-status):not(.ns-consent):not(.ns-linker)", (els) => els.map((e) => e.innerText));
    r.reply = (bots[bots.length - 1] || "").trim().slice(0, 400);
    r.pass = JSON.stringify([...r.called].sort()) === JSON.stringify([...c.expect].sort());
  } catch (e) { r.reply = "ERROR " + String(e.message || e).slice(0, 200); }
  await page.screenshot({ path: `out/routing-${String(i + 1).padStart(2, "0")}.png` }).catch(() => {});
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"} | expect ${JSON.stringify(c.expect)} got ${JSON.stringify(r.called)} | ${c.q.slice(0, 70)}\n     reply: ${r.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  await ctx.close();
}
await browser.close();
const passed = results.filter((r) => r.pass).length;
fs.writeFileSync("out/routing-results.json", JSON.stringify({ site: SITE, checkedAt: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log(`\nRouting: ${passed} of ${results.length} correct.`);
