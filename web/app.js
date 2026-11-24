// app.js — the Pocket Web phone app around the reference agent runtime.
// Pages: Home (what/when/how), Ask (the runtime chat), Helpers and Builders (the live
// directory from directory.json). Agent logic lives in the runtime, not here.
import { boot } from "./runtime/index.js";

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
};
const siteBase = new URL("./", location.href).href;

// ---- Pages ------------------------------------------------------------------------
const VIEWS = ["home", "ask", "helpers", "builders"];
function show() {
  const want = location.hash.slice(1);
  const view = VIEWS.includes(want) ? want : "home";
  for (const v of document.querySelectorAll(".view")) v.hidden = v.dataset.view !== view;
  for (const a of document.querySelectorAll(".tabs a")) a.toggleAttribute("aria-current", a.dataset.tab === view);
  document.body.dataset.view = view;
  if (view !== "ask") window.scrollTo({ top: 0 });
}
addEventListener("hashchange", show);
show();

// ---- Agent runtime ----------------------------------------------------------------
let runtimeReady = null;
function startRuntime() {
  runtimeReady ??= boot("#app", {
    originUrl: siteBase,
    sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
  }).catch((e) => {
    $("#app").textContent = "The agent runtime couldn't start: " + e.message;
    throw e;
  });
  return runtimeReady;
}
startRuntime();

/** Puts text in the chat box; sends it too when send is true. */
async function ask(text, send = false) {
  location.hash = "#ask";
  await startRuntime().catch(() => {});
  const input = $("#ns-input");
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  if (send) $("#ns-send")?.click();
}

// ---- Shared from another app (Android share target -> /share -> ?title&text&url) ----
{
  const p = new URLSearchParams(location.search);
  const parts = [p.get("title"), p.get("text"), p.get("url")].map((s) => (s || "").trim()).filter(Boolean);
  // Some apps put the link inside the text as well; don't repeat it.
  const unique = parts.filter((s, i) => !parts.some((o, j) => j !== i && o.length > s.length && o.includes(s)));
  if (unique.length) {
    const text = [...new Set(unique)].join("\n");
    $("#shared").hidden = false;
    $("#shared-text").textContent = text;
    ask(text);
    history.replaceState(null, "", location.pathname + "#ask");
  }
}

// ---- The helper site's own words ---------------------------------------------------------
// The guide model only routes. What a helper site answered is shown here word for word,
// straight from the runtime's trace (agent_result of that site's front agent), so no model
// can reword, soften or upgrade it. Only sites Pocket Web itself handed off to are shown
// (a site that a helper consulted along the way stays inside that helper's answer).
let sitesByTool = new Map();   // toolName -> site, filled from directory.json
const ownHost = location.host;
const turn = { called: new Set(), results: [] };

function plain(md) {
  return String(md || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

function showSiteWords() {
  const msgs = document.getElementById("ns-msgs");
  if (!msgs) return;
  for (const r of turn.results) {
    if (!turn.called.has(r.site.toolName) || r.shown) continue;
    r.shown = true;
    const text = plain(r.text);
    msgs.append(el("div", { class: "site-words", "data-site": r.site.name },
      el("div", { class: "site-words-head" },
        el("span", { class: "site-words-label" }, "Answer from ", el("b", {}, r.site.name)),
        el("a", { href: r.site.site, target: "_blank", rel: "noopener" }, "Open site ↗")),
      el("p", { class: "site-words-text" }, text || "(The site sent back an empty answer.)"),
      el("p", { class: "site-words-foot" }, "These are the site's own words, shown unchanged. Built and run by ", r.site.team || "its own team", ".")));
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function watchTrace(trace) {
  trace.addEventListener("event", ({ detail: ev }) => {
    if (ev.kind === "run" && ev.phase === "start") { turn.called.clear(); turn.results = []; }
    if (ev.kind === "tool" && ev.phase === "start" && ev.origin === ownHost && sitesByTool.has(ev.tool)) turn.called.add(ev.tool);
    if (ev.kind === "agent_result" && ev.origin !== ownHost) {
      for (const site of sitesByTool.values()) {
        if (site.frontMan === ev.agent && site.network === ev.network && new URL(site.peerUrl).host === ev.origin) turn.results.push({ site, text: ev.text });
      }
    }
    if (ev.kind === "run" && ev.phase === "end") setTimeout(showSiteWords, 50);
  });
}
startRuntime().then((rt) => rt?.trace && watchTrace(rt.trace)).catch(() => {});

// ---- Directory ----------------------------------------------------------------------
function dayWord(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days === 0 ? "today" : days === 1 ? "yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
// What the daily live check found: a real question from the site's own examples, asked through Pocket Web.
function checkBadge(s) {
  if (!s.loadable) return null;
  if (!s.check) return el("span", { class: "check none", title: "The daily live check hasn't asked this site yet." }, "Not checked yet");
  const ok = s.check.result === "answered";
  return el("span", { class: "check " + (ok ? "ok" : "bad"), title: s.check.note },
    (ok ? "Answered " : "Didn't answer ") + dayWord(s.check.checkedAt));
}
function siteCard(s, { example = true, problems = false } = {}) {
  const q = s.sampleQueries?.[0];
  return el("article", { class: "card" },
    el("div", { class: "card-head" },
      el("h3", {}, s.name),
      s.team ? el("span", { class: "team" }, "by " + s.team) : null),
    checkBadge(s),
    el("p", {}, s.description),
    problems && s.problems?.length ? el("ul", { class: "problems" }, s.problems.map((p) => el("li", {}, p))) : null,
    el("div", { class: "card-actions" },
      example && q && s.loadable ? el("button", { class: "try", onclick: () => ask(q, true) }, "Try: ", el("span", {}, q.length > 90 ? q.slice(0, 88) + "…" : q)) : null,
      el("a", { href: s.site, target: "_blank", rel: "noopener" }, "Open site ↗")));
}

async function loadDirectory() {
  try {
    const r = await fetch("./directory.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const sites = d.sites || [];
    sitesByTool = new Map(sites.filter((x) => x.loadable).map((x) => [x.toolName, x]));
    const ok = sites.filter((s) => s.loadable);
    const everyday = ok.filter((s) => s.category === "everyday");
    const builders = ok.filter((s) => s.category === "builders");
    const broken = sites.filter((s) => !s.loadable);

    $("#when").replaceChildren(...everyday.filter((s) => s.sampleQueries?.length).map((s) => siteCard(s)));
    $("#helper-list").replaceChildren(...(everyday.length ? everyday.map((s) => siteCard(s)) : [el("p", { class: "dim" }, "No everyday helpers on the list right now.")]));
    $("#builder-list").replaceChildren(...builders.map((s) => siteCard(s)));
    $("#broken-list").replaceChildren(...(broken.length ? broken.map((s) => siteCard(s, { example: false, problems: true })) : [el("p", { class: "dim" }, "None. Every listed site loads.")]));
    const when = new Date(d.updatedAt);
    $("#updated").textContent = `${sites.length} sites listed · ${ok.length} load from other sites · read ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  } catch (e) {
    $("#when").replaceChildren(el("p", { class: "dim" }, "Couldn't read the public list right now (" + e.message + "). Try again in a minute."));
  }
}
loadDirectory();
$("#peer-url").textContent = new URL("pocket_web", siteBase).href;

// ---- Line for the shared free model ---------------------------------------------------
// Each tab gets a random ticket. Model calls to this site carry it, and while one waits the
// page shows "You're #N in line · about X s". Nothing personal is sent.
const TICKET = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 36);
let pending = 0, polling = null;
async function pollLine() {
  const box = $("#line");
  try {
    const s = await (await fetch(`./queue?ticket=${encodeURIComponent(TICKET)}`, { cache: "no-store" })).json();
    if (s.position > 0) {
      box.replaceChildren(el("span", { class: "dot" }), "You're ", el("b", {}, "#" + s.position), " in line for the free model · about ", el("b", {}, s.eta_seconds + " s"), ". It runs automatically.");
      box.hidden = false;
    } else box.hidden = true;
  } catch { box.hidden = true; }
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  let path = "";
  try { path = new URL(url, location.href).href; } catch {}
  if (!path.startsWith(new URL("llm/v1/chat/completions", siteBase).href)) return realFetch(input, init);
  const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
  headers.set("x-pocket-ticket", TICKET);
  pending += 1;
  if (!polling) { polling = setInterval(pollLine, 1500); setTimeout(pollLine, 400); }
  try { return await realFetch(input, { ...init, headers }); }
  finally {
    pending -= 1;
    if (pending <= 0 && polling) { clearInterval(polling); polling = null; $("#line").hidden = true; }
  }
};

// ---- Install + offline shell ----------------------------------------------------------
let installEvent = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("#install").hidden = false; });
$("#install").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null; $("#install").hidden = true;
});
addEventListener("appinstalled", () => { $("#install").hidden = true; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
