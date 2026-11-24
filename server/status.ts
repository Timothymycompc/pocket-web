// status.ts — what the daily live check found for each listed site.
//
// The Cloud Run job pocket-web-peer-check (jobs/peer-check) asks every loadable site one
// of its own sample questions through Pocket Web in a real phone-sized browser, and saves
// the results to Cloud Storage. The server reads the latest file and marks each site.
//
// The rule (judge) is deliberately plain: a site "answered" only when the hand-off to it ran
// without an error and the app showed a non-empty answer in the site's own words. An answer
// that says the site couldn't do something still counts as an answer: the site replied.
// Anything else is "didn't answer", with the reason.

export type CheckResult = {
  name: string; peerUrl: string; status: string; answer: string; seconds: number;
  siteWords?: { site: string; text: string }[];
  spans?: { kind: string; tool?: string; error?: string; origin?: string }[];
};
export type CheckFile = { checkedAt: string; results: CheckResult[] };
export type SiteCheck = { result: "answered" | "no-answer"; checkedAt: string; seconds: number; note: string };

export function judge(r: CheckResult, toolName: string): { result: SiteCheck["result"]; note: string } {
  if (r.status === "timeout") return { result: "no-answer", note: "no reply within the time limit" };
  if (r.status !== "answered") return { result: "no-answer", note: `the browser saw: ${r.status}` };
  const handoff = (r.spans || []).filter((s) => s.kind === "tool" && s.tool === toolName);
  if (!handoff.length) return { result: "no-answer", note: "Pocket Web didn't hand the question to this site" };
  const failed = handoff.find((s) => s.error);
  if (failed) return { result: "no-answer", note: `the hand-off failed: ${failed.error!.slice(0, 160)}` };
  const own = (r.siteWords || []).find((w) => w.site === r.name)?.text.trim() || "";
  if (!own || own.startsWith("(The site sent back an empty answer.)")) return { result: "no-answer", note: "the site sent back an empty answer" };
  return { result: "answered", note: own.slice(0, 240) };
}

export const STATUS_OBJECT = { bucket: process.env.POCKET_STATUS_BUCKET || "x300-506418-pulse-videos", name: "pocket-web/status/latest.json" };

/** Reads the latest check file with the service's own identity (metadata server). Null when unavailable. */
export async function readLatestCheck(fetchImpl: typeof fetch = fetch): Promise<CheckFile | null> {
  try {
    const t = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000),
    });
    if (!t.ok) return null;
    const { access_token } = await t.json() as { access_token: string };
    const r = await fetchImpl(`https://storage.googleapis.com/storage/v1/b/${STATUS_OBJECT.bucket}/o/${encodeURIComponent(STATUS_OBJECT.name)}?alt=media`, {
      headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.json() as CheckFile;
  } catch {
    return null; // local runs have no metadata server; sites then show "not checked yet"
  }
}

/** Matches check results to directory sites by network URL. */
export function checksBySite(file: CheckFile | null, toolNames: Map<string, string>): Map<string, SiteCheck> {
  const out = new Map<string, SiteCheck>();
  if (!file) return out;
  for (const r of file.results || []) {
    const tool = toolNames.get(r.peerUrl);
    if (!tool) continue;
    const { result, note } = judge(r, tool);
    out.set(r.peerUrl, { result, checkedAt: file.checkedAt, seconds: r.seconds, note });
  }
  return out;
}
