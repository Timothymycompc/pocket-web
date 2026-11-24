// index.ts — Pocket Web server.
//
// Serves the phone app (static files + the reference browser runtime), the site's
// agent manifest and its network file, and the model routes in llm.ts. All agent
// logic runs in the visitor's browser. The network file is rebuilt from the
// challenge's public list of agent sites every few hours (directory.ts), so a newly
// listed site becomes a Pocket Web helper without anyone changing this code.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecrets } from "./secrets.js";
import { llmRoutes, DEFAULT_MODEL } from "./llm.js";
import { buildDirectory, pocketNetwork, attachChecks, POCKET_NETWORK, LIST_URL, liveFetch, type Directory } from "./directory.js";
import { readLatestCheck } from "./status.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.POCKET_WEB_DIR || path.resolve(here, "../web");
const REFRESH_MS = Number(process.env.POCKET_REFRESH_MINUTES || 180) * 60_000;
export const SOURCE_URL = "https://github.com/Timothymycompc/pocket-web";

// Sandbox worker CSP from the reference runtime: peer code runs with no network access.
const WORKER_CSP = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";
// Page CSP: scripts only from this origin. The browser may contact this origin and any https
// agent site, MCP service or BYOK router the visitor approves (the runtime asks first).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https:; worker-src 'self' blob:; frame-src https:; manifest-src 'self'; base-uri 'none'; form-action 'self'";

export function publicOrigin(req: express.Request): string {
  if (process.env.POCKET_PUBLIC_URL) return process.env.POCKET_PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

/** The site's agent manifest (spec 3.3), with absolute router URLs for this origin. */
export function manifestFor(origin: string, dir: Directory | null): Record<string, unknown> {
  return {
    brand: "Pocket Web",
    networks: [{
      name: POCKET_NETWORK,
      front_man: "pocket_guide",
      hocon: `./${POCKET_NETWORK}.network.json`,
      description: "Send anything on your phone to the right agent site on the open agentic web. Its helpers are every site on the challenge's public list, built by independent people, run in your browser after you approve.",
      tags: ["directory", "mobile", "share", "open-agentic-web"],
      sample_queries: [
        "Was the Graco Quattro Tour stroller recalled?",
        "What contests can I still enter this month?",
        "What is Pocket Web and what can it do?",
      ],
    }],
    llm_router: {
      base_url: `${origin}/llm/v1`,
      byok_router: `${origin}/byok/v1`,
      publisher_funded: true,
      default_model: DEFAULT_MODEL,
      provider: "Google Gemini (OpenAI-compatible)",
      mock: false,
    },
    // Pocket Web hands requests to any https agent site; the runtime asks the visitor before each one.
    peer_policy: { mode: "open", deny_origins: [], note: "Pocket Web may contact any https agent site on the public list, after the visitor approves each one. Any agent site may also load Pocket Web's network." },
    allowed_peers: [],
    linking: { exports: [{ name: POCKET_NETWORK, url: `${origin}/${POCKET_NETWORK}`, description: "A guide that hands a request to the right site on the open agentic web's public list." }] },
    directory: { url: `${origin}/directory.json`, source: dir?.source || "", updated: dir?.updatedAt || "", sites: dir?.sites.length || 0 },
    source_code: SOURCE_URL,
    deployment: { mode: "static", self_contained_runtime: true, browser_mock: false, direct_byok: false, direct_mcp_requires_cors: true, public_mcp_facade: false },
  };
}

export type DirectoryStore = { get: () => Directory | null; refresh: () => Promise<void> };

/** True when a new read looks like a network failure on our side rather than real change:
 *  fewer than half as many sites load as in the last good read. */
export function looksBroken(next: Directory, prev: Directory | null): boolean {
  if (!prev) return false;
  const ok = (d: Directory) => d.sites.filter((s) => s.loadable).length;
  return ok(prev) >= 4 && ok(next) < ok(prev) / 2;
}

/** Keeps the latest good directory in memory. A failed or suspect refresh keeps the previous one
 *  and tries again in 10 minutes (on Cloud Run a paused CPU makes every site time out at once). */
export function directoryStore(build: () => Promise<Directory> = () => buildDirectory(liveFetch, LIST_URL, () => readLatestCheck()), retryMs = 600_000): DirectoryStore {
  let current: Directory | null = null;
  let running: Promise<void> | null = null;
  const store: DirectoryStore = {
    get: () => current,
    refresh: () => {
      if (running) return running;
      const t0 = Date.now();
      console.log("Directory: reading the public list");
      running = build()
        .then((d) => {
          const ok = d.sites.filter((s) => s.loadable).length;
          if (looksBroken(d, current)) {
            console.warn(`Directory: only ${ok} sites loaded (was ${current!.sites.filter((s) => s.loadable).length}); keeping the previous read, retrying soon`);
            setTimeout(() => store.refresh(), retryMs).unref?.();
            return;
          }
          current = d;
          console.log(`Directory: ${d.sites.length} sites, ${ok} loadable, ${Date.now() - t0} ms`);
        })
        .catch((e) => console.warn("Directory refresh failed, keeping the previous one:", (e as Error).message))
        .finally(() => { running = null; });
      return running;
    },
  };
  return store;
}

export function createApp(store: DirectoryStore, getKey: () => string | undefined = () => process.env.GEMINI_API_KEY): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    // Public agent artifacts must be readable by agent sites on other origins (spec 3.3, 3.4).
    if (req.path.endsWith(".json")) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    }
    if (req.path.endsWith("/sandbox-worker.js")) res.setHeader("content-security-policy", WORKER_CSP);
    else if (req.path === "/" || req.path.endsWith(".html")) res.setHeader("content-security-policy", PAGE_CSP);
    next();
  });

  app.get("/health", (_req, res) => {
    const d = store.get();
    res.json({ ok: !!d, model_key: !!getKey(), directory_updated: d?.updatedAt || null, sites: d?.sites.length || 0 });
  });

  // Waits for the first directory read after a cold start, so the first visitor never gets an empty list.
  const ready = async (res: express.Response): Promise<Directory | null> => {
    if (!store.get()) await store.refresh();
    const d = store.get();
    if (!d) res.status(503).json({ error: "The directory of agent sites couldn't be read yet. Try again in a minute." });
    return d;
  };

  app.get("/agent-manifest.json", (req, res) => {
    res.setHeader("cache-control", "public, max-age=300");
    res.json(manifestFor(publicOrigin(req), store.get()));
  });

  app.get(`/${POCKET_NETWORK}.network.json`, async (_req, res) => {
    const d = await ready(res); if (!d) return;
    res.setHeader("cache-control", "public, max-age=300");
    res.json(pocketNetwork(d, DEFAULT_MODEL));
  });

  app.get("/directory.json", async (_req, res) => {
    const d = await ready(res); if (!d) return;
    res.setHeader("cache-control", "public, max-age=300");
    res.json(d);
  });

  // The peer address other agent sites load. A person who opens it goes to the builders page.
  app.get(`/${POCKET_NETWORK}`, (req, res) => {
    if (req.accepts(["html", "json"]) === "html") return res.redirect(302, "/#builders");
    res.setHeader("access-control-allow-origin", "*");
    res.json({ network: POCKET_NETWORK, manifest: "/agent-manifest.json", hocon: `/${POCKET_NETWORK}.network.json` });
  });

  // Android share target (manifest.webmanifest, method GET): hand the shared text to the app page.
  app.get("/share", (req, res) => {
    const pick = (k: string) => String(req.query[k] || "").slice(0, 4000);
    const q = new URLSearchParams({ title: pick("title"), text: pick("text"), url: pick("url") });
    res.redirect(303, `/?${q.toString()}#ask`);
  });

  // A photo share reaches the server only when the app's service worker isn't running yet. The photo
  // is not kept here; the person is told to open the app once and share again.
  app.post("/share", (_req, res) => { res.redirect(303, "/?photo=missed#ask"); });

  app.use(llmRoutes(getKey));

  app.use(express.static(WEB, {
    extensions: ["html"],
    setHeaders: (res, file) => {
      if (file.endsWith(".js") || file.endsWith(".mjs")) res.setHeader("content-type", "text/javascript; charset=utf-8");
      if (file.endsWith(".webmanifest")) res.setHeader("content-type", "application/manifest+json");
      // The service worker must always be fresh, or an old app shell lingers on phones.
      const noCache = file.endsWith(`${path.sep}sw.js`);
      res.setHeader("cache-control", noCache ? "no-cache" : file.includes(`${path.sep}runtime${path.sep}`) ? "public, max-age=3600" : "public, max-age=300");
    },
  }));

  app.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain || process.env.POCKET_START === "1") {
  await loadSecrets(["GEMINI_API_KEY"]);
  const store = directoryStore();
  store.refresh();
  setInterval(() => store.refresh(), REFRESH_MS).unref();
  // The daily check finishes at its own time; pick up its results within 10 minutes.
  setInterval(async () => { const d = store.get(); if (d) attachChecks(d.sites, await readLatestCheck()); }, 600_000).unref();
  const port = Number(process.env.PORT || 8080);
  createApp(store).listen(port, () => console.log(`Pocket Web on :${port}`));
}
