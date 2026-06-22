import { createJiti } from "file:///C:/Users/Darcey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const jiti = createJiti(ROOT, { interopDefault: true });

try {
  jiti(`${ROOT}/extensions/toolset/usage.ts`);
  console.log("PARSE OK");
} catch (e) {
  console.error("ERROR:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 12).join("\n"));
  process.exit(1);
}
