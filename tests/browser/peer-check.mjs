// peer-check.mjs: a real phone-sized browser uses the LIVE Pocket Web and asks every loadable
// listed site one of its own sample questions, approving each hand-off like a person would.
// Writes out/peer-results.json and one screenshot per site (out/shot-<n>.png).
// Runs in Cloud Build (tests/browser/cloudbuild.yaml), never on the phone.
import { chromium, devices } from "playwright";
import fs from "node:fs";

const SITE = process.env.SITE || "https://pocket-web-1021990235790.us-central1.run.app";
const ONLY = (process.env.ONLY || "").toLowerCase();
const LIMIT_S = Number(process.env.LIMIT_S || 200);
fs.mkdirSync("out", { recursive: true });

const dir = await (await fetch(`${SITE}/directory.json`)).json();
const sites = dir.sites.filter((s) => s.loadable && s.sampleQueries?.length && (!ONLY || s.name.toLowerCase().includes(ONLY)));
console.log(`${sites.length} sites to check (directory read ${dir.updatedAt})`);

const browser = await chromium.launch();
const results = [];
let n = 0;
for (const s of sites) {
  n += 1;
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  const peerHost = new URL(s.peerUrl).host;
  const peerRequests = [];
  page.on("response", (res) => { try { const u = new URL(res.url()); if (u.host === peerHost || /\/(llm|byok)\/v1\//.test(u.pathname)) peerRequests.push(`${res.status()} ${u.host}${u.pathname}`); } catch {} });
  const question = `Ask ${s.name}: ${s.sampleQueries[0]}`;
  const r = { name: s.name, peerUrl: s.peerUrl, category: s.category, question, seconds: 0, consents: [], answer: "", status: "", consoleErrors, peerRequests, actionStatus: "", spans: [] };
  const t0 = Date.now();
  try {
    await page.goto(`${SITE}/#ask`, { waitUntil: "networkidle" });
    await page.waitForSelector("#ns-input", { timeout: 60_000 });
    await page.fill("#ns-input", question);
    await page.click("#ns-send");
    const bar = page.locator(".ns-inputbar");
    await page.waitForFunction(() => document.querySelector(".ns-inputbar")?.dataset.turnActive === "true", null, { timeout: 15_000 }).catch(() => {});
    const deadline = Date.now() + LIMIT_S * 1000;
    for (;;) {
      if (Date.now() > deadline) { r.status = "timeout"; break; }
      const allow = page.locator(".ns-consent button[data-d=allow]");
      const count = await allow.count();
      for (let i = 0; i < count; i++) {
        const b = allow.nth(i);
        if (await b.isVisible().catch(() => false)) {
          const text = await b.locator("xpath=ancestor::*[contains(@class,'ns-consent')]").first().innerText().catch(() => "");
          r.consents.push(text.replace(/\s+/g, " ").slice(0, 200));
          await b.click().catch(() => {});
        }
      }
      if ((await bar.getAttribute("data-turn-active")) === "false") break;
      await page.waitForTimeout(700);
    }
    const answers = await page.$$eval(".ns-msg.bot:not(.ns-turn-status):not(.ns-consent):not(.ns-linker)", (els) => els.map((e) => e.innerText));
    r.answer = (answers[answers.length - 1] || "").trim();
    if (!r.status) r.status = r.answer ? "answered" : "no answer";
    r.actionStatus = await page.locator(".ns-action-status").innerText().catch(() => "");
    // The helper site's own words, as the app shows them (web/app.js showSiteWords).
    await page.waitForSelector(".site-words", { timeout: 3000 }).catch(() => {});
    r.siteWords = await page.$$eval(".site-words", (els) => els.map((e) => ({ site: e.dataset.site, text: e.querySelector(".site-words-text")?.innerText || "" })));
    // The runtime's own trace (no secrets in spans): which agents, tools and peers ran, and their errors.
    r.spans = await page.evaluate(() => {
      const t = window.__nsweb?.trace;
      if (!t) return [];
      return [...t.spans.values()].map((sp) => ({
        kind: sp.kind, status: sp.status, agent: sp.agent, tool: sp.tool || sp.method || sp.name, origin: sp.origin, peerOrigin: sp.peerOrigin,
        error: String(sp.error?.message || sp.error || sp.errorMessage || "").slice(0, 300),
        result: String(sp.resultPreview || sp.result || "").slice(0, 300),
        ms: Math.round(sp.durationMs || 0),
        offered: sp.toolNames, called: sp.toolCalls, finish: sp.finishReason, chars: sp.contentChars, model: sp.respModel || sp.model,
      }));
    }).catch(() => []);
  } catch (e) {
    r.status = "error";
    r.answer = String(e.message || e).slice(0, 400);
  }
  r.seconds = Math.round((Date.now() - t0) / 1000);
  await page.screenshot({ path: `out/shot-${String(n).padStart(2, "0")}.png`, fullPage: false }).catch(() => {});
  results.push(r);
  console.log(`\n=== ${s.name} [${r.status}, ${r.seconds}s, ${r.consents.length} approvals]\nQ: ${question}\nA: ${r.answer.replace(/\s+/g, " ").slice(0, 500)}`);
  fs.writeFileSync("out/peer-results.json", JSON.stringify({ site: SITE, checkedAt: new Date().toISOString(), directoryRead: dir.updatedAt, results }, null, 2));
  await ctx.close();
}
await browser.close();
console.log(`\n${results.filter((r) => r.status === "answered").length} of ${results.length} returned an answer (read each one: an answer can still be an error message).`);
