// run.mjs: runs peer-check.mjs, then saves its results to Cloud Storage as status/latest.json
// (read by the Pocket Web server for "Answered today") and status/<date>.json (history).
// Uses the job's own service account through the metadata server; no keys in the image.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BUCKET = process.env.BUCKET || "x300-506418-pulse-videos";
const PREFIX = process.env.PREFIX || "pocket-web/status";

const run = spawnSync("node", ["peer-check.mjs"], { stdio: "inherit", env: process.env });
if (run.status !== 0) console.error(`peer-check exited with ${run.status}; saving whatever results it wrote`);

let body;
try { body = readFileSync("out/peer-results.json", "utf8"); } catch { console.error("no results file"); process.exit(1); }

const tokenRes = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
const { access_token } = await tokenRes.json();
for (const name of [`${PREFIX}/latest.json`, `${PREFIX}/${new Date().toISOString().slice(0, 10)}.json`]) {
  const up = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body,
  });
  console.log(`saved gs://${BUCKET}/${name}: HTTP ${up.status}`);
  if (!up.ok) process.exitCode = 1;
}
