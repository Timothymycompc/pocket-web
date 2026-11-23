// peer-test.mjs: really call each listed agent site as a peer, from another origin,
// the way the phone app will. A tiny local caller site (127.0.0.1) publishes a
// one-agent network whose only tool is the peer's network URL; the real browser
// runtime runs in Node, asks the peer one of its own sample questions, and records
// the answer, the time and any tool errors.
//
// Usage: node scripts/peer-test.mjs [name filter]
// Needs data/survey.json (node scripts/survey.mjs). Writes data/peer-test.json.
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const RUNTIME = process.env.RUNTIME || path.join(here, "../web/runtime");
const ROUTER = process.env.ROUTER || "https://pulse-safety-desk-1021990235790.us-central1.run.app/llm/v1";
const MODEL = process.env.MODEL || "gemini-flash-lite-latest";
const filter = (process.argv[2] || "").toLowerCase();

const survey = JSON.parse(readFileSync(path.join(here, "../data/survey.json"), "utf8"));
const targets = survey.filter((s) => s.ok && (!filter || s.name.toLowerCase().includes(filter)));

let current = null; // { manifest, network }
const server = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (req.url.endsWith("/agent-manifest.json")) return res.end(JSON.stringify(current.manifest));
  if (req.url.endsWith("/caller.network.json")) return res.end(JSON.stringify(current.network));
  res.statusCode = 404; res.end("{}");
});
await new Promise((ok) => server.listen(8811, "127.0.0.1", ok));
const ORIGIN = "http://127.0.0.1:8811";

globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location ??= new URL(ORIGIN + "/");
const { Engine } = await import(pathToFileURL(path.join(RUNTIME, "engine.js")).href);
const { TraceBus } = await import(pathToFileURL(path.join(RUNTIME, "trace.js")).href);

const results = [];
for (const t of targets) {
  const peerUrl = `${t.base}/${t.network}`;
  const question = (t.sampleQueries || [])[0] || "";
  const r = { name: t.name, peerUrl, question, seconds: 0, answer: "", errors: [], consents: [], toolCalls: [] };
  if (!question) { r.errors.push("site publishes no sample question"); results.push(r); continue; }
  current = {
    manifest: {
      brand: "peer test caller",
      networks: [{ name: "caller", front_man: "caller", hocon: "./caller.network.json" }],
      llm_router: { base_url: ROUTER, publisher_funded: true, default_model: MODEL, mock: false },
      peer_policy: { mode: "open", deny_origins: [] },
      deployment: { mode: "static" },
    },
    network: {
      llm_config: { model_name: MODEL },
      link_labels: { [peerUrl]: t.name },
      tools: [{
        name: "caller",
        function: { description: "Passes a request to one peer agent site." },
        instructions: `Pass the user's message, unchanged, to the ${t.name} tool. Then reply with what it returned, word for word. If it returned an error or nothing, say exactly that.`,
        tools: [peerUrl],
      }],
    },
  };
  const trace = new TraceBus();
  const engine = new Engine({ originUrl: ORIGIN, trace });
  engine.onConsent = async (info) => { r.consents.push(`${info.peerOrigin} (${info.phase || info.kind})`); return "always"; };
  const t0 = Date.now();
  try {
    const { validation } = await engine.loadTop();
    if (validation.errors.length) r.errors.push("caller invalid: " + validation.errors.join("; "));
    const out = await Promise.race([
      engine.run(question),
      new Promise((_, no) => setTimeout(() => no(new Error("timed out after 240 s")), 240000)),
    ]);
    r.answer = typeof out === "string" ? out : JSON.stringify(out);
  } catch (err) {
    r.errors.push(String(err?.message || err).slice(0, 400));
  }
  r.seconds = Math.round((Date.now() - t0) / 1000);
  for (const s of trace.spans.values()) {
    if (s.kind === "tool" || s.kind === "mcp_call" || s.kind === "remote") r.toolCalls.push(`${s.kind}:${s.tool || s.method || ""}:${s.status}`);
    const err = s.error?.message || s.error || s.errorMessage;
    if (err) r.errors.push(`${s.kind} ${s.tool || s.agent || ""}: ${String(err).slice(0, 200)}`);
  }
  results.push(r);
  console.log(`\n=== ${t.name} (${r.seconds}s)\nQ: ${question.slice(0, 160)}\nA: ${r.answer.replace(/\s+/g, " ").slice(0, 400)}\nconsents: ${r.consents.join(", ")}\nerrors: ${r.errors.join(" | ") || "none"}`);
  writeFileSync(path.join(here, "../data/peer-test.json"), JSON.stringify(results, null, 2));
}
server.close();
console.log(`\nDone: ${results.filter((r) => r.answer && !r.errors.length).length} of ${results.length} answered with no errors.`);
