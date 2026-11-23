// directory.ts — the live directory of agent sites, read from the challenge's public list.
//
// Every few hours the server reads docs/agentic_websites.md from the challenge repo,
// fetches each listed site's agent-manifest.json and network file the way a browser on
// another origin would, and keeps what it found. Nobody is hand-picked: a site that is
// on the public list is in the directory. Sites whose files can't be loaded stay in the
// directory too, marked with the reason, so their builders can see what to fix.
//
// The directory then becomes Pocket Web's own agent network (pocketNetwork): one front
// agent whose tools are the listed sites' network URLs. That file is data only.
// @ts-ignore: plain JS module shared with the browser runtime
import { AgentNetwork, validateNetwork } from "../web/runtime/kernel.js";

export const LIST_URL = "https://raw.githubusercontent.com/cognizant-ai-labs/agentic-web/main/docs/agentic_websites.md";
export const LIST_PAGE = "https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/agentic_websites.md";
const CALLER_ORIGIN = "https://pocket-web.invalid"; // any other origin, so CORS is checked as a peer sees it

export type Category = "everyday" | "builders";

export type Site = {
  id: string;              // peer URL, unique
  name: string;
  site: string;            // the human page
  description: string;     // from the public list (the builder's own words)
  team: string;
  peerUrl: string;         // <base>/<network>, what the runtime loads
  network: string;
  toolName: string;        // the name the runtime gives this peer as a tool
  frontMan: string;
  sampleQueries: string[];
  category: Category;
  loadable: boolean;       // manifest + network load cross-origin and the network validates
  problems: string[];      // plain reasons when not loadable
  listedOrder: number;     // position on the public list (newest entries are usually last)
};

export type Directory = { updatedAt: string; source: string; sites: Site[] };

type Fetcher = (url: string) => Promise<{ status: number; cors: boolean; text: string }>;

/** Rejects when a step takes longer than ms, so one slow site can never stall the directory. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, no) => { timer = setTimeout(() => no(new Error(`${what} took over ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(timer));
}

export const liveFetch: Fetcher = (url) => withTimeout((async () => {
  const ctl = new AbortController();
  const res = await fetch(url, { headers: { Origin: CALLER_ORIGIN }, redirect: "follow", signal: ctl.signal });
  const acao = res.headers.get("access-control-allow-origin");
  return { status: res.status, cors: acao === "*" || acao === CALLER_ORIGIN, text: await res.text() };
})(), 15000, "the request");

/** Rows of the public list's table: | URL | Name | Description | Team | [Link](agent url) |. */
export function parseList(md: string): { site: string; name: string; description: string; team: string; agentLink: string }[] {
  const rows = [];
  for (const line of md.split("\n")) {
    if (!/^\|\s*https?:/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const agentLink = (cells[4] || "").match(/\((https?:[^)\s]+)\)/)?.[1] || "";
    if (!agentLink) continue;
    rows.push({ site: cells[0], name: cells[1], description: cells[2], team: cells[3] === "-" ? "" : cells[3], agentLink });
  }
  return rows;
}

/** <base>/<network>, from a link to the network URL or to its .network.json file. */
export function baseAndName(link: string): { base: string; name: string } {
  const u = new URL(link);
  const parts = u.pathname.split("/").filter(Boolean);
  const last = (parts.pop() || "").replace(/\.network\.json$|\.json$|\.hocon$/, "");
  return { base: `${u.origin}/${parts.join("/")}`.replace(/\/$/, ""), name: last };
}

// Words that mark a site as a tool for people who build agent sites rather than for
// everyday visitors. A plain rule, so no site is placed by taste. OVERRIDES corrects
// a site the rule gets wrong (key: network URL); each override says why.
const BUILDER_WORDS = /\b(agentic (web|site|website)s?|manifests?|MVP Profile|sly_data|HOCON|conformance|AI agents|site's AI agents|agent sites?|GitHub repository|ready (it is )?for AI agents|citation-bias|the model the visitor picks|NANDA)\b/i;
export const OVERRIDES: Record<string, { category: Category; why: string }> = {
  "https://bacajelas-agentic.web.app/bacajelas": { category: "everyday", why: "A reading companion for Indonesian and English readers; its description mentions sly_data and a validator only as extras." },
};

export function categorize(peerUrl: string, description: string): Category {
  if (OVERRIDES[peerUrl]) return OVERRIDES[peerUrl].category;
  return BUILDER_WORDS.test(description) ? "builders" : "everyday";
}

export async function readSite(row: ReturnType<typeof parseList>[number], order: number, get: Fetcher): Promise<Site> {
  const problems: string[] = [];
  let base = "", name = "";
  try { ({ base, name } = baseAndName(row.agentLink)); } catch { problems.push("the agent link on the list is not a valid URL"); }
  const site: Site = {
    id: base && name ? `${base}/${name}` : row.agentLink, name: row.name, site: row.site, description: row.description, team: row.team,
    peerUrl: base && name ? `${base}/${name}` : "", network: name, toolName: "", frontMan: "", sampleQueries: [],
    category: categorize(`${base}/${name}`, row.description), loadable: false, problems, listedOrder: order,
  };
  if (!base) return site;
  try {
    const m = await get(`${base}/agent-manifest.json`);
    if (m.status !== 200) { problems.push(`agent-manifest.json answered HTTP ${m.status}`); return site; }
    if (!m.cors) problems.push("agent-manifest.json can't be read by other sites (no CORS header)");
    const manifest = JSON.parse(m.text);
    const nets: any[] = Array.isArray(manifest.networks) ? manifest.networks : [];
    const entry = nets.find((n) => n?.name === name) || (nets.length === 1 ? nets[0] : null);
    if (!entry) { problems.push(`the manifest has no network named '${name}'`); return site; }
    site.network = entry.name;
    site.peerUrl = site.id = `${base}/${entry.name}`;
    site.toolName = toolNameFor(site.peerUrl);
    site.frontMan = String(entry.front_man || "");
    site.sampleQueries = (Array.isArray(entry.sample_queries) ? entry.sample_queries : []).filter((q: unknown) => typeof q === "string").slice(0, 4);
    const fileUrl = new URL(entry.hocon || `./${entry.name}.network.json`, `${base}/`).href;
    const h = await get(fileUrl);
    if (h.status !== 200) { problems.push(`the network file answered HTTP ${h.status}`); return site; }
    if (!h.cors) problems.push("the network file can't be read by other sites (no CORS header)");
    let config: unknown;
    try { config = JSON.parse(h.text); } catch { problems.push("the network file is not JSON"); return site; }
    const { errors } = validateNetwork(new AgentNetwork(config, entry.name));
    if (errors.length) problems.push(`the network doesn't validate: ${errors.slice(0, 2).join(" ")}`);
  } catch (err) {
    problems.push(`could not be reached: ${String((err as Error).message || err).slice(0, 120)}`);
  }
  site.loadable = problems.length === 0;
  return site;
}

/** Same rule as the runtime (runner.js safeName + kernel.js parseExternalAgent). */
export function toolNameFor(peerUrl: string): string {
  const path = new URL(peerUrl).pathname.replace(/^\//, "");
  return path.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 60) || "tool";
}

export async function buildDirectory(get: Fetcher = liveFetch, listUrl = LIST_URL): Promise<Directory> {
  const list = await get(listUrl);
  if (list.status !== 200) throw new Error(`public list answered HTTP ${list.status}`);
  const rows = parseList(list.text);
  const sites = await Promise.all(rows.map((row, i) =>
    withTimeout(readSite(row, i, get), 40000, "reading the site").catch((e): Site => ({
      id: row.agentLink, name: row.name, site: row.site, description: row.description, team: row.team, peerUrl: "", network: "",
      toolName: "", frontMan: "", sampleQueries: [], category: "everyday", loadable: false, listedOrder: i,
      problems: [`could not be reached: ${(e as Error).message}`],
    }))));
  // Two sites whose network URLs end the same way would get the same tool name in the
  // runtime, and the second would hide the first. Keep the earlier listing; tell the later one.
  const seen = new Map<string, string>();
  for (const s of sites) {
    if (!s.loadable) continue;
    const other = seen.get(s.toolName);
    if (other) { s.loadable = false; s.problems.push(`its network path gives the same tool name as ${other}; a different network name fixes it`); }
    else seen.set(s.toolName, s.name);
  }
  return { updatedAt: new Date().toISOString(), source: LIST_PAGE, sites };
}

// ---- Pocket Web's own agent network --------------------------------------------

export const POCKET_NETWORK = "pocket_web";

function helperLine(s: Site): string {
  const examples = s.sampleQueries.slice(0, 2).map((q) => `"${q.slice(0, 160)}"`).join("; ");
  return `- ${s.name} (tool: ${s.toolName}; ${s.category === "builders" ? "for builders" : "for everyone"}): ${s.description}${examples ? ` Example requests: ${examples}` : ""}`;
}

/** The data-only network file: one front agent that hands each request to a listed site. */
export function pocketNetwork(dir: Directory, model: string): Record<string, unknown> {
  const sites = dir.sites.filter((s) => s.loadable);
  const labels: Record<string, string> = {};
  for (const s of sites) labels[s.peerUrl] = s.name;
  const instructions = [
    "You are Pocket Web, a guide to the open agentic web. Agent websites built by many independent people are listed below. Each one is a tool you can hand a request to; its agents then run in this browser, after the person approves.",
    "",
    "How you work:",
    "1. Read what the person shared or asked. Pick the ONE listed site whose description fits best. If two sites are clearly both needed, you may use two, one after the other.",
    "2. Before handing off, say in one short line which site you are asking and why.",
    "3. Hand the site the person's request in full, in plain words, including any text, link, product name or numbers they shared. Do not shorten or change facts.",
    "4. Answer with what the site returned. Start with the site's name as the source, e.g. \"From Recalled?:\". Keep the site's own wording for any verdict or label. Do not add facts of your own.",
    "5. If the site reports an error, declines, or the person declined the hand-off, say so plainly and suggest another listed site only if one truly fits.",
    "6. If no listed site fits, say: \"No site on the open agentic web list does this yet.\" Then name the closest one if any. Do not answer the question yourself from general knowledge.",
    "7. If the person asks what Pocket Web is or what it can do, explain briefly and list a few everyday sites with one example each.",
    "8. Never ask for passwords, card numbers, seed phrases or private keys. If someone shares one, tell them not to, and do not pass it on.",
    "",
    `The listed sites (from the public list, read ${dir.updatedAt.slice(0, 10)}):`,
    ...sites.map(helperLine),
  ].join("\n");
  return {
    metadata: {
      description: "Pocket Web: send anything on your phone to the right agent site on the open agentic web. Its helpers are every site on the challenge's public list, built by independent people, run in your browser after you approve.",
      sample_queries: [
        "Was the Graco Quattro Tour stroller recalled?",
        "What contests can I still enter this month?",
        "What is Pocket Web and what can it do?",
      ],
      directory_updated: dir.updatedAt,
      directory_source: dir.source,
    },
    llm_config: { model_name: model },
    link_labels: labels,
    tools: [{
      name: "pocket_guide",
      function: { description: "Takes anything a person shares or asks, picks the right agent site on the open agentic web's public list, and returns that site's answer with its name as the source." },
      instructions,
      tools: sites.map((s) => s.peerUrl),
    }],
  };
}
