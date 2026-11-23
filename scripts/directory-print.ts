import { buildDirectory, pocketNetwork } from "../server/directory.ts";
import { writeFileSync } from "node:fs";
const d = await buildDirectory();
writeFileSync("data/directory-live.json", JSON.stringify(d, null, 2));
for (const s of d.sites) console.log(s.loadable ? "OK" : "--", s.category.padEnd(8), s.name, "|", s.toolName, "|", s.problems.join("; "));
const n: any = pocketNetwork(d, "gemini-flash-lite-latest");
console.log("tools:", n.tools[0].tools.length, "instructions chars:", n.tools[0].instructions.length);
