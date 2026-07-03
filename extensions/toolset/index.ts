/**
 * pi-aftc-toolset — extension entry / orchestrator.
 *
 * Per rules.md §1.5, this extension uses the orchestrator pattern:
 *   - index.ts        — this file: orchestrator (default export)
 *   - core.ts         — cache-diagnostics data + events + commands
 *   - footer-widget.ts — cache-diagnostics widget rendering + /aftc-footer
 *   - usage-recording.ts — per-turn SQLite recording (TurnRecorder interface)
 *   - usage-report.ts  — /usage-report + /usage-clear (reads the SQLite DB)
 *   - install.ts      — /aftc-install (npm install + uv sync)
 *   - help.ts         — /aftc-help (commands and shortcuts help)
 *   - ssh.ts          — SSH remote terminal tools + slash commands
 *   - response.ts     — full-width <hr> divider above each assistant reply
 *   - input-clear.ts  — Alt+C shortcut to clear the input editor
 *   - stfu.ts         — /aftc-stop + /stfu: emergency abort of current agent op
 *   - cd.ts           — /cd: switch to a fresh Pi session in another directory
 *   - db.ts           — shared SQLite connection utility
 *   - paths.ts        — package/runtime path helpers
 *   - types.ts        — shared TurnRecord / FooterDataProvider interfaces
 *
 * The orchestrator instantiates the feature modules and wires them to
 * pi. Cross-module data flows through the orchestrator: core.ts returns
 * a FooterDataProvider that the orchestrator passes to footer-widget.ts.
 * Modules own their own state in closure and do not import each other.
 *
 * See `index.readme.md` for the orchestration responsibilities.
 * See `readme.md` (folder level) for the full file map.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCore } from "./core";
import { createFooterWidget } from "./footer-widget";
import { createInputClear } from "./input-clear";
import { createUsageRecording } from "./usage-recording";
import { createUsageModule } from "./usage-report";
import { createHelpModule } from "./help";
import { createInstallModule } from "./install";
import { createSshModule } from "./ssh";
import { createResponseDivider } from "./response";
import { createStfu } from "./stfu";
import { createCd } from "./cd";

export default function (pi: ExtensionAPI): void {
	// Independent modules first (self-register commands/handlers).
	const recorder = createUsageRecording(pi);
	const usage = createUsageModule(pi);
	const help = createHelpModule(pi);
	createInstallModule(pi);
	createInputClear(pi);
	createSshModule(pi);
	createResponseDivider(pi);
	createStfu(pi);
	createCd(pi);

	// Core owns the data; the widget renders it. The orchestrator wires
	// them so neither module imports the other (rules.md §1.5).
	const footerData = createCore(pi, recorder);
	createFooterWidget(pi, footerData);

	// usage and help are intentionally not passed to anyone — they
	// self-register their commands/handlers in attach() and are otherwise
	// standalone.
	void usage;
	void help;
}
