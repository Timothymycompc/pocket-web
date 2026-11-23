// record-fixture.ts: saves the live public list and every listed site's files exactly as
// fetched (status, CORS, body), so tests replay real data. Usage: npx tsx scripts/record-fixture.ts
import { writeFileSync } from "node:fs";
import { buildDirectory, liveFetch } from "../server/directory.ts";
const seen: Record<string, { status: number; cors: boolean; text: string }> = {};
const recorder = async (url: string) => { const r = await liveFetch(url); seen[url] = r; return r; };
const d = await buildDirectory(recorder);
const day = d.updatedAt.slice(0, 10);
writeFileSync(`tests/fixtures/agentic-web-${day}.json`, JSON.stringify({ recordedAt: d.updatedAt, responses: seen }));
console.log(`recorded ${Object.keys(seen).length} responses -> tests/fixtures/agentic-web-${day}.json`);
