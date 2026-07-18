/**
 * pi-aftc-toolset — extension entry / orchestrator.
 *
 * Per .dev/dev_guide.md section 1.5, this extension uses the orchestrator pattern:
 *   - index.ts        — this file: orchestrator (default export)
 *   - core.ts         — cache-diagnostics data + events + commands
 *   - footer-widget.ts — cache-diagnostics widget rendering + /aftc-footer
 *   - usage-recording.ts — per-turn SQLite recording (TurnRecorder interface)
 *   - usage-report.ts  — /usage-report + /usage-clear (reads the SQLite DB)
 *   - install.ts      — /aftc-install (npm install + uv sync)
 *   - help.ts         — /aftc-help (commands and shortcuts help)
 *   - ssh/index.ts    — local stdio-carrier SSH tools + slash commands
 *   - response.ts     — full-width <hr> divider above each assistant reply
 *   - input-clear.ts  — Alt+C shortcut to clear the input editor
 *   - intro.ts        — temporary AFTC startup wordmark animation
 *   - theme.ts        — /theme: shortcut to pi's theme picker
 *   - stfu.ts         — /aftc-stop + /stfu: emergency abort of current agent op
 *   - cd.ts           — /cd: switch to a fresh Pi session in another directory
 *   - dir.ts          — /dir /ls: list current directory contents (platform-native)
 *   - cwd.ts          — /cwd: show the current working directory (inline card)
 *   - replay.ts       — /save-replay-prompt + /replay: save a prompt string and re-send it
 *   - keep-it-short.ts — /keep-it-short + /kis: send a fixed "be concise" prompt to the active model
 *   - think-parser.ts — message_end hook that converts inline <think>…</think>
 *                        tags in assistant text into pi's native ThinkingContent
 *                        blocks (no commands, no UI — pure message-content transform)
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
import { createAllowance } from "./allowance";
import { createCore } from "./core";
import { createFooterWidget } from "./footer-widget";
import { createInputClear } from "./input-clear";
import { createIntroAnimation } from "./intro";
import { createTheme } from "./theme";
import { createUsageRecording } from "./usage-recording";
import { createUsageModule } from "./usage-report";
import { createHelpModule } from "./help";
import { createInstallModule } from "./install";
import { createSshModule } from "./ssh/index";
import { createResponseDivider } from "./response";
import { createStfu } from "./stfu";
import { createCd } from "./cd";
import { createDir } from "./dir";
import { createCwd } from "./cwd";
import { createReplay } from "./replay";
import { createKeepItShort } from "./keep-it-short";
import { createThinkParser } from "./think-parser";

export default function (pi: ExtensionAPI): void {
	try {
	// Independent modules first (self-register commands/handlers).
	const allowance = createAllowance(pi);
	const recorder = createUsageRecording(pi);
	const usage = createUsageModule(pi);
	const help = createHelpModule(pi);
	createInstallModule(pi);
	createInputClear(pi);
	createIntroAnimation(pi);
	createTheme(pi);
	createSshModule(pi);
	createResponseDivider(pi);
	createStfu(pi);
	createCd(pi);
	createDir(pi);
	createCwd(pi);
	createReplay(pi);
	createKeepItShort(pi);
	createThinkParser(pi);

	// Core owns the data; the widget renders it. The orchestrator wires
	// them so neither module imports the other (.dev/dev_guide.md section 1.5). allowance
	// is passed into core exactly like recorder, and re-exposed on the
	// FooterDataProvider so the widget can render line 5 without importing
	// allowance.ts.
	const footerData = createCore(pi, recorder, allowance);
	createFooterWidget(pi, footerData);

	// usage and help are intentionally not passed to anyone — they
	// self-register their commands/handlers in attach() and are otherwise
	// standalone.
	void usage;
	void help;
	} catch (err) {
		console.log(`[aftc-toolset] orchestrator error: ${(err as Error).message}`);
		console.log(`[aftc-toolset] stack: ${(err as Error).stack}`);
	}
}
