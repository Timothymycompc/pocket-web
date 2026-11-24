// Replays the challenge's public list and every listed site's files as recorded on
// 2026-11-23 (tests/fixtures), so the directory rules are tested on real sites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import request from "node:http";
import { buildDirectory, parseList, baseAndName, categorize, toolNameFor, pocketNetwork } from "../server/directory.ts";
import { createApp, directoryStore, manifestFor, looksBroken } from "../server/index.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agentic-web-2026-11-23.json", import.meta.url), "utf8"));
const replay = async (url: string) => {
  const r = fixture.responses[url];
  if (!r) throw new Error(`not in fixture: ${url}`);
  return r;
};

test("reads all 20 sites from the recorded public list", async () => {
  const d = await buildDirectory(replay);
  assert.equal(d.sites.length, 20);
  assert.equal(d.sites.filter((s) => s.loadable).length, 18);
});

test("a site without CORS is kept, marked, with the reason", async () => {
  const d = await buildDirectory(replay);
  const s = d.sites.find((x) => x.name === "The Open Agentic Web Challenge")!;
  assert.equal(s.loadable, false);
  assert.match(s.problems.join(" "), /no CORS header/);
});

test("a network that references missing agents fails validation (AegisWeave, real case)", async () => {
  const d = await buildDirectory(replay);
  const s = d.sites.find((x) => x.name === "AegisWeave")!;
  assert.equal(s.loadable, false);
  assert.match(s.problems.join(" "), /references missing tool 'nordic_compute'/);
});

test("everyday vs builders follows the written rule, with the BacaJelas override", async () => {
  const d = await buildDirectory(replay);
  const cat = Object.fromEntries(d.sites.map((s) => [s.name, s.category]));
  for (const n of ["Recalled?", "Plainly (agentic edition)", "Deadline Desk", "Spare Hours", "Overlap", "BacaJelas"]) assert.equal(cat[n], "everyday", n);
  for (const n of ["Agent Customs", "Agent Atlas", "NandaSeal Trust Studio", "ScopeGate Studio", "Retrofit"]) assert.equal(cat[n], "builders", n);
  assert.equal(categorize("https://x.example/y", "Checks the conformance of a manifest"), "builders");
  assert.equal(categorize("https://x.example/y", "Finds a bus home"), "everyday");
});

test("peer URLs and tool names match the runtime's naming", () => {
  assert.deepEqual(baseAndName("https://chen931222.github.io/recalled/recall_check.network.json"), { base: "https://chen931222.github.io/recalled", name: "recall_check" });
  assert.deepEqual(baseAndName("https://agent-atlas-phi.vercel.app/agent_atlas"), { base: "https://agent-atlas-phi.vercel.app", name: "agent_atlas" });
  assert.equal(toolNameFor("https://chen931222.github.io/recalled/recall_check"), "recalled_recall_check");
  assert.equal(toolNameFor("https://deadline-desk-agent.vercel.app/deadline_desk"), "deadline_desk");
});

test("a list row without an agent link is skipped", () => {
  const rows = parseList("|https://a.example/|A|desc|-|[Link](https://a.example/a.network.json)|\n|https://b.example/|B|desc|-|-|");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].team, "");
});

test("two sites with the same tool name: the later one is marked, not silently hidden", async () => {
  const md = "|https://a.example/|A|desc|-|[Link](https://a.example/x/net.network.json)|\n|https://b.example/|B|desc|-|[Link](https://b.example/x/net.network.json)|";
  const manifest = JSON.stringify({ networks: [{ name: "net", front_man: "f", hocon: "./net.network.json" }] });
  const network = JSON.stringify({ tools: [{ name: "f", function: { description: "d" }, instructions: "i" }] });
  const d = await buildDirectory(async (url) => ({ status: 200, cors: true, text: url.endsWith(".md") ? md : url.endsWith("agent-manifest.json") ? manifest : network }), "https://list.example/list.md");
  assert.equal(d.sites[0].loadable, true);
  assert.equal(d.sites[1].loadable, false);
  assert.match(d.sites[1].problems[0], /same tool name as A/);
});

test("Pocket Web's network hands off only to loadable sites and names each one", async () => {
  const d = await buildDirectory(replay);
  const n: any = pocketNetwork(d, "gemini-flash-lite-latest");
  const front = n.tools[0];
  assert.equal(front.name, "pocket_guide");
  assert.equal(front.tools.length, 18);
  assert.ok(!front.tools.some((t: string) => t.includes("aegisweave")));
  assert.match(front.instructions, /Recalled\? \(tool: recalled_recall_check/);
  assert.match(front.instructions, /Do not answer the question yourself/);
  assert.match(front.instructions, /Never repeat the person.s question as if it were the site.s answer/);
  assert.match(front.instructions, /do NOT restate, summarize or rephrase it/);
  assert.equal(n.link_labels["https://chen931222.github.io/recalled/recall_check"], "Recalled?");
});

test("manifest: open peer policy, publisher-funded default router, BYOK route", () => {
  const m: any = manifestFor("https://pocket.example", null);
  assert.equal(m.networks[0].name, "pocket_web");
  assert.equal(m.peer_policy.mode, "open");
  assert.equal(m.llm_router.base_url, "https://pocket.example/llm/v1");
  assert.equal(m.llm_router.byok_router, "https://pocket.example/byok/v1");
});

test("server: share target hands shared text to the app; public files have CORS", async () => {
  const store = directoryStore(() => buildDirectory(replay));
  await store.refresh();
  const server = createApp(store, () => undefined).listen(0);
  const port = (server.address() as any).port;
  const get = (path: string) => new Promise<{ status: number; headers: any; body: string }>((ok) => {
    request.get({ host: "127.0.0.1", port, path, headers: { accept: "application/json" } }, (res) => {
      let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => ok({ status: res.statusCode!, headers: res.headers, body }));
    });
  });
  try {
    const share = await get("/share?title=Stroller&text=Was%20this%20recalled%3F");
    assert.equal(share.status, 303);
    assert.match(share.headers.location, /^\/\?title=Stroller&text=Was\+this\+recalled%3F&url=#ask$/);
    const net = await get("/pocket_web.network.json");
    assert.equal(net.status, 200);
    assert.equal(net.headers["access-control-allow-origin"], "*");
    const dir = await get("/directory.json");
    assert.equal(JSON.parse(dir.body).sites.length, 20);
    const health = await get("/health");
    assert.equal(JSON.parse(health.body).ok, true);
  } finally { server.close(); }
});

test("a refresh where most sites suddenly fail is not trusted; the last good read stays", async () => {
  const good = await buildDirectory(replay);
  const bad = { ...good, sites: good.sites.map((s) => ({ ...s, loadable: false, problems: ["could not be reached: the request took over 15 s"] })) };
  assert.equal(looksBroken(bad, good), true);
  assert.equal(looksBroken(good, null), false);
  const oneGone = { ...good, sites: good.sites.slice(1) };
  assert.equal(looksBroken(oneGone, good), false, "a real removal is accepted");
  let n = 0;
  const store = directoryStore(async () => (n++ === 0 ? good : bad), 60_000);
  await store.refresh();
  await store.refresh();
  assert.equal(store.get(), good);
});
