// load-check.mjs: loads a Pocket Web site in the real runtime (in Node) without calling any model,
// and prints whether the network validates. Usage: node scripts/load-check.mjs [siteUrl]
import path from "node:path";
import { pathToFileURL } from "node:url";
const site = process.argv[2] || "http://localhost:8822";
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location ??= new URL(site + "/");
const rt = path.join(path.dirname(new URL(import.meta.url).pathname), "../web/runtime");
const { Engine } = await import(pathToFileURL(path.join(rt, "engine.js")).href);
const { TraceBus } = await import(pathToFileURL(path.join(rt, "trace.js")).href);
const engine = new Engine({ originUrl: site, trace: new TraceBus() });
const { validation } = await engine.loadTop();
console.log("errors:", validation.errors, "warnings:", (validation.warnings || []).length, "router:", engine.top.llm.baseUrl);
