// The daily check's rule (server/status.ts judge), on cases taken from the real 2026-11-23 browser run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, checksBySite } from "../server/status.ts";

const tool = (name: string, error = "") => ({ kind: "tool", tool: name, origin: "pocket-web-1021990235790.us-central1.run.app", error });

test("answered: hand-off ran and the site's own words were shown (Recalled?, real reply)", () => {
  const r = judge({ name: "Recalled?", peerUrl: "u", status: "answered", answer: "Here is what Recalled? found.", seconds: 7,
    spans: [tool("recalled_recall_check")], siteWords: [{ site: "Recalled?", text: "The result is possible: we found matching brand and product terms..." }] }, "recalled_recall_check");
  assert.equal(r.result, "answered");
  assert.match(r.note, /possible/);
});

test("a site that says it couldn't do something still answered (Agent Customs, real reply)", () => {
  const r = judge({ name: "Agent Customs", peerUrl: "u", status: "answered", answer: "x", seconds: 25, spans: [tool("agent_customs_agent_customs")],
    siteWords: [{ site: "Agent Customs", text: "I could not run the instruction analyst because the network has not been inspected in this visit yet." }] }, "agent_customs_agent_customs");
  assert.equal(r.result, "answered");
});

test("didn't answer: hand-off still running at the time limit (BacaJelas, real case)", () => {
  assert.equal(judge({ name: "BacaJelas", peerUrl: "u", status: "timeout", answer: "", seconds: 202, spans: [tool("bacajelas")] }, "bacajelas").result, "no-answer");
});

test("didn't answer: the hand-off errored (ScopeGate, real error)", () => {
  const r = judge({ name: "ScopeGate Studio", peerUrl: "u", status: "answered", answer: "x", seconds: 14, spans: [tool("scopegate_studio_scopegate_broker", "Object schema requires properties.")] }, "scopegate_studio_scopegate_broker");
  assert.equal(r.result, "no-answer");
  assert.match(r.note, /Object schema requires properties/);
});

test("didn't answer: the guide's own words don't count, only the site's", () => {
  const r = judge({ name: "Recalled?", peerUrl: "u", status: "answered", answer: "From Recalled?: Yes, it appears in a recall notice.", seconds: 7, spans: [tool("recalled_recall_check")], siteWords: [] }, "recalled_recall_check");
  assert.equal(r.result, "no-answer");
});

test("results attach to sites by network URL; unknown sites are ignored", () => {
  const m = checksBySite({ checkedAt: "2026-11-24T11:00:00Z", results: [
    { name: "Recalled?", peerUrl: "https://chen931222.github.io/recalled/recall_check", status: "answered", answer: "x", seconds: 7, spans: [tool("recalled_recall_check")], siteWords: [{ site: "Recalled?", text: "No match found." }] },
    { name: "Gone", peerUrl: "https://gone.example/x", status: "answered", answer: "x", seconds: 1 },
  ] }, new Map([["https://chen931222.github.io/recalled/recall_check", "recalled_recall_check"]]));
  assert.equal(m.size, 1);
  assert.equal(m.get("https://chen931222.github.io/recalled/recall_check")!.result, "answered");
});
