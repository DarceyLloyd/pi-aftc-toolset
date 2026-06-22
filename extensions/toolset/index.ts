/**
 * pi-aftc-toolset — extension entry / orchestrator.
 *
 * Per rules.md §2.4, this extension uses the multi-file layout:
 *   - index.ts        — this file: orchestrator (default export)
 *   - core.ts         — cache diagnostics footer + slash commands
 *   - input-clear.ts  — Alt+C shortcut to clear the input editor
 *   - thinking.ts     — per-turn SQLite recording (visibility of model
 *                       <thinking> blocks in the main output is handled
 *                       by pi's built-in Ctrl+T, not by this extension)
 *   - usage.ts        — /usage-report (reads the SQLite DB)
 *   - install.ts      — /aftc-install (runs npm install for better-sqlite3)
 *                       + session_start warning if deps are missing
 *   - help.ts         — /aftc-help (commands and shortcuts help)
 *   - ssh.ts          — SSH remote terminal tools + slash commands
 *                       (ssh_status, ssh_connect, ssh_run, ssh_peek,
 *                       ssh_interrupt, /ssh-connect, /ssh-disconnect,
 *                       /ssh-status, /ssh-gui, /ssh-run)
 *   - db.ts           — shared SQLite connection utility (utility, not a feature)
 *   - types.ts        — shared TurnRecord / TurnRecorder interfaces
 *
 * The orchestrator instantiates the feature modules and wires them to
 * pi. Modules own their own state in closure and do not import each
 * other (per rules.md §2.3). Cross-module data flows through the
 * orchestrator: the ThinkingModule instance is passed into createCore
 * and reaches the footer / message_end via a structural TurnRecorder
 * type. The other modules are independent — they just need to be
 * instantiated so their commands register.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCore } from "./core";
import { createInputClear } from "./input-clear";
import { createThinkingModule } from "./thinking";
import { createUsageModule } from "./usage";
import { createHelpModule } from "./help";
import { createInstallModule } from "./install";
import { createSshModule } from "./ssh";

export default function (pi: ExtensionAPI): void {
    const thinking = createThinkingModule(pi);
    const usage = createUsageModule(pi);
    const help = createHelpModule(pi);
    createInstallModule(pi);
    createCore(pi, thinking);
    createInputClear(pi);
    createSshModule(pi);
    // usage, help, and ssh are intentionally not passed to anyone —
    // they self-register their commands/handlers in attach() and are
    // otherwise standalone.
    void usage;
    void help;
}
