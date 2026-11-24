// app.js — the Pocket Web phone app around the reference agent runtime.
// Pages: Home (what/when/how), Ask (the runtime chat), Helpers and Builders (the live
// directory from directory.json). Agent logic lives in the runtime, not here.
import { boot } from "./runtime/index.js";
import { findPersonal, removePersonal, describe } from "./privacy.js";

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
  // The runtime's message box is one line: keep line breaks readable as " · ".
  input.value = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" · ").replace(/: · /g, ": ").replace(/ · My question:$/, " · My question: ");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (!document.activeElement?.closest?.("#photo") && !$("#photo").contains(document.activeElement)) input.focus({ preventScroll: !!document.querySelector("#photo:not([hidden])") });
  if (send) $("#ns-send")?.click();
}

// ---- Privacy guard on Send ---------------------------------------------------------------
// Before a message leaves the phone, plain code (privacy.js) looks for emails, phone numbers,
// card numbers and SSNs. If it finds any, Send waits and offers to remove them, because the
// helper site that answers would see them. The person decides; nothing is changed silently.
let approvedText = null;
function guardBox() {
  let box = document.getElementById("privacy");
  if (!box) {
    box = el("div", { id: "privacy", class: "privacy", role: "alert", hidden: "" });
    document.querySelector("#ask .app-wrap")?.before(box);
  }
  return box;
}
function guardSend(e) {
  const input = document.getElementById("ns-input");
  if (!input) return;
  const isSend = e.type === "click" ? e.target.closest?.("#ns-send") : (e.key === "Enter" && e.target === input && !e.shiftKey);
  if (!isSend) return;
  if (document.querySelector(".ns-inputbar")?.dataset.turnActive === "true") return; // steering a running answer
  const text = input.value;
  if (approvedText === text) { approvedText = null; return; }
  const hits = findPersonal(text);
  if (!hits.length) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const box = guardBox();
  const send = (value) => {
    box.hidden = true;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    approvedText = value;
    document.getElementById("ns-send")?.click();
  };
  box.replaceChildren(
    el("p", {}, el("b", {}, "Your message has " + describe(hits) + "."), (hits.length > 1 ? " The helper site that answers would see them. Remove them first?" : " The helper site that answers would see it. Remove it first?")),
    el("div", { class: "privacy-actions" },
      el("button", { class: "primary", onclick: () => send(removePersonal(text, hits)) }, "Remove and send"),
      el("button", { onclick: () => send(text) }, "Send as is"),
      el("button", { onclick: () => { box.hidden = true; input.focus(); } }, "Edit")));
  box.hidden = false;
}
addEventListener("click", guardSend, true);
addEventListener("keydown", guardSend, true);

// ---- Photos: read the text on them ---------------------------------------------------------
// The photo goes only to this site's AI model (or nowhere, if the person cancels), which copies
// the printed text: brand, model number, UPC, dates. That text lands in the message box for the
// person to check and edit. Helper sites only ever get the text the person sends.
const PHOTO_PROMPT = "A person shared this photo to ask an AI helper about it. Write down the text you can read on it exactly as printed: brand, product name, model number, UPC or barcode digits, dates, and label wording that matters. Then one short line saying what the item or document is. Do not guess: write [unreadable] for anything you can't read. Never copy people's names, addresses, phone numbers, emails or account numbers: write [personal detail] instead. Plain text, no markdown.";

async function shrink(blob, max = 1024) {
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

async function readPhoto(blob) {
  const box = $("#photo");
  location.hash = "#ask";
  const url = URL.createObjectURL(blob);
  const status = el("p", { class: "photo-status" }, el("span", { class: "dot" }), "Reading the text in your photo…");
  box.replaceChildren(el("img", { src: url, alt: "Your photo" }), el("div", {}, status));
  box.hidden = false;
  try {
    const dataUrl = await shrink(blob);
    const r = await fetch(new URL("llm/v1/chat/completions", siteBase), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: PHOTO_PROMPT }, { type: "image_url", image_url: { url: dataUrl } }] }] }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error?.message || `HTTP ${r.status}`);
    const text = String(body?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("the model sent back no text");
    status.replaceChildren(el("b", {}, "Read from your photo. "), "Check it and fix anything wrong. Only this text goes to a helper site, not the photo.");
    // The message box is one line, so the read text is shown here in full, editable, and kept in step.
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const area = el("textarea", { class: "photo-text", rows: String(Math.min(8, lines.length + 1)), "aria-label": "Text read from your photo" });
    area.value = lines.join("\n");
    const question = el("input", { class: "photo-q", placeholder: "Your question, e.g. Was this recalled?", "aria-label": "Your question" });
    const sync = () => ask(`From my photo:\n${area.value}\nMy question: ${question.value}`);
    area.addEventListener("input", sync); question.addEventListener("input", sync);
    question.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#ns-send")?.click(); } });
    status.after(area, question);
    await sync();
    question.focus({ preventScroll: true });
    box.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (e) {
    status.replaceChildren("Couldn't read the photo: " + e.message + ". You can type what's on it instead.");
  }
}
$("#photo-input").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) readPhoto(f); e.target.value = ""; });

// ---- Shared from another app (Android share target -> /share -> ?title&text&url&photo) ----
{
  const p = new URLSearchParams(location.search);
  if (p.get("photo") === "1") {
    caches.open("pocket-shared").then(async (c) => {
      const res = await c.match("./shared-photo");
      if (res) { await c.delete("./shared-photo"); readPhoto(await res.blob()); }
    }).catch(() => {});
  } else if (p.get("photo") === "missed") {
    $("#shared").hidden = false;
    $("#shared-text").textContent = "The photo didn't come through. Open Pocket Web once, then share it again, or tap 📷 Read a photo.";
  }
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

// A small, safe Markdown subset for helper answers: headings, bullets, **bold**, [links](https://...)
// and bare https links. Built as DOM nodes (never innerHTML), so a site's answer can't inject markup.
function inline(text) {
  const out = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(el("a", { href: m[2], target: "_blank", rel: "noopener nofollow" }, m[1]));
    else if (m[3]) out.push(el("b", {}, m[3]));
    else out.push(el("a", { href: m[4], target: "_blank", rel: "noopener nofollow" }, m[4].replace(/^https?:\/\//, "").slice(0, 60) + (m[4].length > 68 ? "…" : "")));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function renderAnswer(md) {
  const box = el("div", { class: "site-words-text" });
  let list = null;
  for (const raw of String(md || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) { list ??= box.appendChild(el("ul")); list.append(el("li", {}, inline(bullet[1]))); continue; }
    list = null;
    if (!line.trim()) continue;
    if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // table divider row
    const head = line.match(/^#{1,6}\s+(.*)$/);
    if (head) box.append(el("p", { class: "h" }, inline(head[1])));
    else if (line.includes("|") && /^\s*\|/.test(line)) box.append(el("p", { class: "row" }, inline(line.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim()).join("  ·  "))));
    else box.append(el("p", {}, inline(line)));
  }
  if (!box.childNodes.length) box.append(el("p", {}, "(The site sent back an empty answer.)"));
  return box;
}

function showSiteWords() {
  const msgs = document.getElementById("ns-msgs");
  if (!msgs) return;
  for (const r of turn.results) {
    if (!turn.called.has(r.site.toolName) || r.shown) continue;
    r.shown = true;
    msgs.append(el("div", { class: "site-words", "data-site": r.site.name },
      el("div", { class: "site-words-head" },
        el("span", { class: "site-words-label" }, "Answer from ", el("b", {}, r.site.name)),
        el("a", { href: r.site.site, target: "_blank", rel: "noopener" }, "Open site ↗")),
      renderAnswer(r.text),
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
// The builder's own description, cut to its first sentence for the short cards on Home.
function shortText(d) {
  // A sentence ends at . ! or ? after a lowercase word or digit, then a space and a capital,
  // so abbreviations like "U.S." or "e.g." don't cut it short.
  const text = String(d || "").trim();
  const end = text.search(/[a-z0-9)\]"'][.!?](?=\s+[A-Z(])/);
  const first = end >= 0 ? text.slice(0, end + 2) : text;
  return first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, "") + "…" : first;
}
function siteCard(s, { example = true, problems = false, short = false } = {}) {
  const q = s.sampleQueries?.[0];
  return el("article", { class: "card" },
    el("div", { class: "card-head" },
      el("h3", {}, s.name),
      s.team ? el("span", { class: "team" }, "by " + s.team) : null),
    checkBadge(s),
    short ? el("p", {}, shortText(s.description))
      : s.description.length > 200 ? el("details", { class: "more" }, el("summary", {}, shortText(s.description)), el("p", {}, s.description))
      : el("p", {}, s.description),
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

    // Home: everyday helpers with an example, the ones that answered in the latest check first.
    const rank = (s) => (s.check?.result === "answered" ? 0 : s.check ? 2 : 1);
    const home = everyday.filter((s) => s.sampleQueries?.length).sort((a, b) => rank(a) - rank(b) || a.listedOrder - b.listedOrder);
    $("#when").replaceChildren(...home.map((s) => siteCard(s, { short: true })));
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
