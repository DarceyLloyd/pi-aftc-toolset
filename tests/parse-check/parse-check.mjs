// Parse-only smoke test for the largest, most parse-fragile file
// (extensions/toolset/usage-report.ts — heavy SQL + HTML template strings).
// Uses pi's bundled jiti to parse without compilation. Runs from any cwd.
import { createJiti } from "file:///C:/Users/Darcey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Project root = two levels up from this script (tests/<name>/<script>).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/\\/g, "/");
const jiti = createJiti(ROOT, { interopDefault: true });

try {
    jiti(`${ROOT}/extensions/toolset/usage-report.ts`);
    console.log("PARSE OK");
} catch (e) {
    console.error("ERROR:", e.message);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 12).join("\n"));
    process.exit(1);
}