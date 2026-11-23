// survey.mjs: check every site on the challenge's public list of agentic websites.
// For each one: can another origin load its manifest and network (CORS), which
// network is the front, and what its agents need (MCP services, site actions,
// coded tools, other peers). Prints a table and writes data/survey.json.
//
// Usage: node scripts/survey.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const LIST_URL = "https://raw.githubusercontent.com/cognizant-ai-labs/agentic-web/main/docs/agentic_websites.md";
const CALLER = "https://pocket-web.example"; // any other origin, to test CORS

async function get(url) {
  const res = await fetch(url, { headers: { Origin: CALLER }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  return { status: res.status, acao: res.headers.get("access-control-allow-origin"), text, finalUrl: res.url };
}

function parseList(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|http")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const agentLink = (cells[4] || "").match(/\((https?:[^)]+)\)/)?.[1] || "";
    rows.push({ site: cells[0], name: cells[1], description: cells[2], team: cells[3], agentLink });
  }
  return rows;
}

// A network URL is <base>/<network name>; a link to <base>/<name>.network.json also names it.
function baseAndName(link) {
  const u = new URL(link);
  const parts = u.pathname.split("/").filter(Boolean);
  let last = parts.pop() || "";
  last = last.replace(/\.network\.json$|\.json$|\.hocon$/, "");
  return { base: `${u.origin}/${parts.join("/")}`.replace(/\/$/, ""), name: last };
}

function toolKinds(network) {
  const agents = network.tools || network.agents || [];
  const kinds = { agents: 0, mcp: new Set(), remote: new Set(), links: new Set(), coded: 0, toolbox: 0 };
  const list = Array.isArray(agents) ? agents : Object.values(agents);
  for (const a of list) {
    kinds.agents += 1;
    if (a.class) kinds.coded += 1;
    if (a.toolbox) kinds.toolbox += 1;
    for (const t of a.tools || []) {
      const ref = typeof t === "string" ? t : t?.url;
      if (!ref) continue;
      if (/\/mcp(\/|$)|\bmcp\b/i.test(ref) && /^https?:/.test(ref)) kinds.mcp.add(new URL(ref).host);
      else if (/^https?:/.test(ref)) kinds.remote.add(ref);
      else if (!list.some((x) => x.name === ref)) kinds.links.add(ref);
    }
  }
  return { agents: kinds.agents, mcp: [...kinds.mcp], remote: [...kinds.remote], links: [...kinds.links], coded: kinds.coded, toolbox: kinds.toolbox };
}

const md = (await get(LIST_URL)).text;
const rows = parseList(md);
const out = [];
for (const row of rows) {
  const r = { ...row, ok: false, problems: [] };
  try {
    const { base, name } = baseAndName(row.agentLink);
    r.base = base; r.requested = name;
    const m = await get(`${base}/agent-manifest.json`);
    r.manifestStatus = m.status; r.manifestCors = m.acao;
    if (m.status !== 200) { r.problems.push(`manifest HTTP ${m.status}`); out.push(r); continue; }
    if (!m.acao) r.problems.push("manifest has no CORS header");
    const manifest = JSON.parse(m.text);
    const nets = manifest.networks || [];
    const entry = nets.find((n) => n.name === name) || (nets.length === 1 ? nets[0] : null);
    if (!entry) { r.problems.push(`no network '${name}' (has: ${nets.map((n) => n.name).join(", ")})`); out.push(r); continue; }
    r.network = entry.name;
    r.frontMan = entry.front_man;
    r.sampleQueries = entry.sample_queries || [];
    r.netDescription = entry.description || "";
    r.peerPolicy = manifest.peer_policy?.mode || "";
    r.router = manifest.llm_router?.base_url || "";
    const hoconUrl = new URL(entry.hocon || `./${entry.name}.network.json`, `${base}/`).href;
    const h = await get(hoconUrl);
    r.networkStatus = h.status; r.networkCors = h.acao;
    if (h.status !== 200) { r.problems.push(`network HTTP ${h.status}`); out.push(r); continue; }
    if (!h.acao) r.problems.push("network file has no CORS header");
    let net;
    try { net = JSON.parse(h.text); } catch { r.problems.push("network file is not JSON"); out.push(r); continue; }
    r.tools = toolKinds(net);
    if (r.tools.coded) r.problems.push(`${r.tools.coded} coded tool(s)`);
    r.ok = r.problems.length === 0 || r.problems.every((p) => p.includes("coded"));
  } catch (err) {
    r.problems.push(String(err.message || err));
  }
  out.push(r);
}

mkdirSync("data", { recursive: true });
writeFileSync("data/survey.json", JSON.stringify(out, null, 2));
for (const r of out) {
  const t = r.tools || {};
  console.log(`${r.ok ? "OK " : "-- "} ${r.name} | net=${r.network || "?"} front=${r.frontMan || "?"} agents=${t.agents ?? "?"} mcp=${(t.mcp || []).join(",") || "-"} peers=${(t.remote || []).length} links=${(t.links || []).join(",") || "-"} | ${r.problems.join("; ") || "loadable"}`);
}
console.log(`\n${out.filter((r) => r.ok).length} of ${out.length} loadable as peers (static check).`);
