// llm.ts — the two model routes the browser runtime can use (adapted from Pulse Safety Desk).
//
// /llm/v1  = the site's default inference (publisher-funded). The server adds its own
//            Gemini key, forces one cheap model and caps request size and daily volume,
//            so a visitor can use Pocket Web without any key of their own.
// /byok/v1 = Bring Your Own Key. Forwards exactly the visitor's Authorization header
//            to Gemini and never adds the server key (spec section 4, "caller-site BYOK proxy").
//
// Visitor IP addresses are never stored or logged. The per-visitor limit keys on a
// salted hash that lives only in memory and resets every hour.

import type { Request, Response, Router } from "express";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { ModelQueue } from "./queue.js";

export const GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";

// Paid backup for the free route (Tim's choice, 2026-11-24): when Google's free daily quota is used
// up, the same capped requests go to Vertex AI on the site's own Google Cloud project, billed to it,
// using the service's own identity (no key). Off unless POCKET_VERTEX_PROJECT is set.
export type Backup = { url: string; model: string; token: () => Promise<string> };
export function vertexBackup(project = process.env.POCKET_VERTEX_PROJECT, model = process.env.POCKET_VERTEX_MODEL || "google/gemini-3.5-flash-lite"): Backup | null {
  if (!project) return null;
  let cached = { token: "", until: 0 };
  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi/chat/completions`,
    model,
    token: async () => {
      if (cached.token && Date.now() < cached.until) return cached.token;
      const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
      const j = await r.json() as { access_token: string; expires_in: number };
      cached = { token: j.access_token, until: Date.now() + Math.max(60, j.expires_in - 120) * 1000 };
      return cached.token;
    },
  };
}

// Google's free quota resets at midnight Pacific time. After a daily refusal, skip the free route
// until then, so visitors don't wait through its retries on every call.
const pacificDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
let freeOutDay = "";
let backupDay = "", backupCalls = 0;
export function quotaStatus(now = new Date()): { free_quota_out_today: boolean; backup_calls_today: number } {
  return { free_quota_out_today: freeOutDay === pacificDay(now), backup_calls_today: backupDay === pacificDay(now) ? backupCalls : 0 };
}
/** Test hook. */
export function resetQuota(): void { freeOutDay = ""; backupDay = ""; backupCalls = 0; }
export const DEFAULT_MODEL = process.env.POCKET_MODEL || "gemini-flash-lite-latest";

const DAILY_CAP = Number(process.env.POCKET_DAILY_CAP || 1200); // whole site, default route only
const HOURLY_PER_VISITOR = Number(process.env.POCKET_HOURLY_PER_VISITOR || 60);
const MAX_OUTPUT_TOKENS = 2048;
const MAX_BODY = "1mb"; // a shared photo, shrunk to 1024 px in the browser, fits
export let RETRY_WAITS_MS = [2000, 5000, 10000];
/** Test hook: shortens retry waits. */
export function setRetryWaits(ms: number[]): void { RETRY_WAITS_MS = ms; }

let day = "";
let dayCount = 0;
let hour = "";
let salt = randomBytes(16);
const perVisitor = new Map<string, number>();

/** Counts one default-route request. Returns a reason string when it must be refused. */
export function admit(visitorKey: string, now = new Date()): string | null {
  const d = now.toISOString().slice(0, 10);
  const h = now.toISOString().slice(0, 13);
  if (d !== day) { day = d; dayCount = 0; }
  if (h !== hour) { hour = h; perVisitor.clear(); salt = randomBytes(16); }
  if (dayCount >= DAILY_CAP) return "The free model on this site has reached today's limit. Add your own key in AI model settings (the gear icon) to keep going.";
  const id = createHash("sha256").update(salt).update(visitorKey).digest("hex").slice(0, 16);
  const n = perVisitor.get(id) || 0;
  if (n >= HOURLY_PER_VISITOR) return "You've reached this hour's free limit. Wait a bit, or add your own key in AI model settings (the gear icon).";
  perVisitor.set(id, n + 1);
  dayCount += 1;
  return null;
}

/** Test hook: clears all counters. */
export function resetLimits(): void { day = ""; dayCount = 0; hour = ""; perVisitor.clear(); }

function refuse(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message, type: "pocket_limit", code: status } });
}

/** Copies an upstream response (streamed or not) to the client. */
async function relay(upstream: globalThis.Response, res: Response): Promise<void> {
  res.status(upstream.status);
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  if (!upstream.body) { res.end(); return; }
  Readable.fromWeb(upstream.body as any).pipe(res);
}

// Gemini 3 models require each earlier function call to carry its "thought signature".
// The reference browser runtime does not keep it, so earlier tool calls get Google's
// documented placeholder signature (ai.google.dev, "Thought signatures": dummy values
// for history that has none). The visitor's messages are otherwise passed unchanged.
export const PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator";

export function withThoughtSignatures(messages: any[]): any[] {
  return messages.map((m) => {
    if (!m || m.role !== "assistant" || !Array.isArray(m.tool_calls)) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((c: any) =>
        c?.extra_content?.google?.thought_signature
          ? c
          : { ...c, extra_content: { ...(c?.extra_content || {}), google: { ...(c?.extra_content?.google || {}), thought_signature: PLACEHOLDER_SIGNATURE } } }),
    };
  });
}

/** Keeps only fields an OpenAI-compatible chat call needs, so the proxy can't be used for anything else. */
export function cleanBody(body: any, forceModel?: string): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) return null;
  const out: Record<string, unknown> = {
    model: forceModel || (typeof body.model === "string" ? body.model : DEFAULT_MODEL),
    messages: withThoughtSignatures(body.messages),
    stream: body.stream === true,
  };
  if (Array.isArray(body.tools) && body.tools.length) { out.tools = body.tools; out.tool_choice = body.tool_choice ?? "auto"; }
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (forceModel) out.max_tokens = MAX_OUTPUT_TOKENS;
  else if (typeof body.max_tokens === "number") out.max_tokens = body.max_tokens;
  return out;
}

export function llmRoutes(getKey: () => string | undefined, fetchImpl: typeof fetch = fetch, queue = new ModelQueue(), backup: Backup | null = vertexBackup()): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  r.post("/llm/v1/chat/completions", async (req: Request, res: Response) => {
    const key = getKey();
    if (!key && !backup) return refuse(res, 503, "The site's free model is not configured right now. Add your own key in AI model settings.");
    const body = cleanBody(req.body, DEFAULT_MODEL);
    if (!body) return refuse(res, 400, "Expected an OpenAI-style chat request with messages.");
    const why = admit(req.ip || req.socket.remoteAddress || "unknown");
    if (why) return refuse(res, 429, why);
    // Wait in line for the shared free model (see queue.ts). The page shows the position.
    const ticket = String(req.get("x-pocket-ticket") || "").slice(0, 64);
    try { await queue.acquire(ticket); } catch (e) { return refuse(res, 429, (e as Error).message); }
    if (req.socket.destroyed) return; // visitor left while waiting
    try {
      const send = (messages: unknown[]) => fetchImpl(`${GEMINI_OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, messages }),
      });
      const sendBackup = async () => {
        if (pacificDay() !== backupDay) { backupDay = pacificDay(); backupCalls = 0; }
        backupCalls += 1;
        return fetchImpl(backup!.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await backup!.token()}` },
          body: JSON.stringify({ ...body, model: backup!.model }),
        });
      };
      // The free tier allows only a few requests per minute, and the model is sometimes
      // briefly overloaded (503). Wait and retry before giving up, so a busy moment
      // doesn't break an answer.
      const sendWithRetry = async (messages: unknown[]) => {
        let upstream = await send(messages);
        for (const wait of RETRY_WAITS_MS) {
          if (upstream.status !== 429 && upstream.status !== 503) break;
          const peek = upstream.status === 429 ? await upstream.clone().text().catch(() => "") : "";
          if (/PerDay|per day|daily/i.test(peek)) break; // a daily quota won't clear by waiting
          await upstream.body?.cancel().catch(() => {});
          await new Promise((r) => setTimeout(r, wait));
          upstream = await send(messages);
        }
        return upstream;
      };
      const messages = body.messages as unknown[];
      const freeOut = freeOutDay === pacificDay() || !key;
      let upstream = freeOut ? null : await sendWithRetry(messages);
      if (upstream && (upstream.status === 429 || upstream.status === 503)) {
        // Google says which limit was hit. A daily quota needs a different message than a busy minute.
        const why = await upstream.text().catch(() => "");
        const daily = upstream.status === 429 && /PerDay|per day|daily/i.test(why);
        console.warn(`Free model refused: HTTP ${upstream.status}${daily ? " (daily quota)" : ""}: ${why.replace(/\s+/g, " ").slice(0, 300)}`);
        if (daily) freeOutDay = pacificDay();
        if (!backup) {
          return refuse(res, 429, daily
            ? "The free model has used up today's free quota. Add your own key in AI model settings (the gear icon), or try again tomorrow."
            : "The free model is busy right now. Try again in a minute, or add your own key in AI model settings (the gear icon).");
        }
        upstream = null;
      }
      if (!upstream) {
        if (!backup) return refuse(res, 429, "The free model has used up today's free quota. Add your own key in AI model settings (the gear icon), or try again tomorrow.");
        upstream = await sendBackup();
        if (!upstream.ok) console.warn(`Backup model refused: HTTP ${upstream.status}: ${(await upstream.clone().text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`);
        if (upstream.status === 429 || upstream.status === 503) {
          await upstream.body?.cancel().catch(() => {});
          return refuse(res, 429, "The model is busy right now. Try again in a minute, or add your own key in AI model settings (the gear icon).");
        }
      }
      await relay(upstream, res);
    } catch {
      refuse(res, 502, "Could not reach the model provider. Please try again.");
    }
  });

  // Where this tab is in line: { waiting, position, eta_seconds, per_minute }.
  r.get("/queue", (req: Request, res: Response) => {
    res.setHeader("cache-control", "no-store");
    res.json(queue.status(String(req.query.ticket || "").slice(0, 64)));
  });

  r.get("/llm/v1/models", (_req, res) => { res.json({ object: "list", data: [{ id: DEFAULT_MODEL, object: "model" }] }); });

  r.post("/byok/v1/chat/completions", async (req: Request, res: Response) => {
    const auth = req.get("authorization") || "";
    if (!/^Bearer \S{10,}$/.test(auth)) return refuse(res, 401, "Add your Gemini API key in AI model settings to use your own key.");
    const body = cleanBody(req.body);
    if (!body) return refuse(res, 400, "Expected an OpenAI-style chat request with messages.");
    try {
      const upstream = await fetchImpl(`${GEMINI_OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(body),
      });
      await relay(upstream, res);
    } catch {
      refuse(res, 502, "Could not reach the model provider. Please try again.");
    }
  });

  return r;
}
