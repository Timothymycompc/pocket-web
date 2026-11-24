// photo-check.mjs: on the LIVE site in a real phone browser, a photo of a stroller label is read
// (1) through the 📷 button and (2) through an Android-style share (POST /share with the photo,
// handled by the service worker). Both must put the label's text in the message box. label.jpg is
// a made-up label (test data, not a real product photo).
import { chromium, devices } from "playwright";
import fs from "node:fs";
const SITE = process.env.SITE || "https://pocket-web-1021990235790.us-central1.run.app";
fs.mkdirSync("out", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const out = {};
const waitText = async () => {
  for (let i = 0; i < 60; i++) { const v = await page.inputValue("#ns-input").catch(() => ""); if (/From my photo/.test(v)) return v; await page.waitForTimeout(1000); }
  return await page.inputValue("#ns-input").catch(() => "");
};
await page.goto(`${SITE}/#ask`, { waitUntil: "networkidle" });
await page.waitForSelector("#ns-input", { timeout: 60_000 });
await page.setInputFiles("#photo-input", "label.jpg");
out.button = await waitText();
out.buttonStatus = await page.locator(".photo-status").innerText().catch(() => "");
await page.screenshot({ path: "out/photo-1-button.png" });

// Android share: the service worker is active now; submit the same form Android would.
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.reload({ waitUntil: "networkidle" });
const bytes = fs.readFileSync("label.jpg").toString("base64");
await page.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const f = document.createElement("form");
  f.method = "POST"; f.action = "/share"; f.enctype = "multipart/form-data";
  const t = document.createElement("input"); t.name = "title"; t.value = "Stroller label"; f.append(t);
  const i = document.createElement("input"); i.type = "file"; i.name = "photo";
  const dt = new DataTransfer(); dt.items.add(new File([bin], "label.jpg", { type: "image/jpeg" })); i.files = dt.files; f.append(i);
  document.body.append(f); f.submit();
}, bytes);
await page.waitForLoadState("networkidle");
await page.waitForSelector("#ns-input", { timeout: 60_000 });
out.shareUrl = page.url();
out.share = await waitText();
await page.screenshot({ path: "out/photo-2-share.png" });
out.ok = [out.button, out.share].every((v) => /Quattro/i.test(v) && /1757345/.test(v));
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.ok ? 0 : 1);
