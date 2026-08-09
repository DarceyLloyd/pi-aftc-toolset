/**
 * pi-aftc-toolset — extension entry / orchestrator.
 *
 * Per AGENTS.md, this extension uses the orchestrator pattern:
 *   - index.ts        — this file: orchestrator (default export)
 *   - core.ts         — cache-diagnostics data + events + commands
 *   - footer-widget.ts — cache-diagnostics widget rendering + /aftc-footer
 *   - usage-recording.ts — per-turn SQLite recording (TurnRecorder interface)
 *   - usage-report.ts  — /usage-report + /usage-clear (reads the SQLite DB)
 *   - install.ts      — /aftc-install (npm install + uv sync)
 *   - help.ts         — /aftc-help (commands and shortcuts help)
 *   - ssh/index.ts    — local stdio-carrier SSH tools + slash commands
 *   - response.ts     — full-width <hr> divider above each assistant reply
 *   - keys.ts         — keyboard shortcuts: Alt+C clear editor, Alt+N newline at caret,
 *                        Alt+X cut input to clipboard (+ /aftc-cut-input)
 *   - intros/         — AFTC text startup intro (factory disconnected; only intro-text wired)
 *   - theme.ts        — /theme: shortcut to pi's theme picker
 *   - stfu.ts         — /aftc-stop + /stfu: emergency abort of current agent op
 *   - dir.ts          — /dir /ls: list current directory contents (platform-native)
 *   - cwd.ts          — /cwd: show the current working directory (inline card)
 *   - replay.ts       — /save-replay-prompt + /replay: save a prompt string and re-send it
 *   - keep-it-short.ts — /keep-it-short + /kis: send a fixed "be concise" prompt to the active model
 *   - think-parser.ts — message_end hook that converts inline <think>…</think>
 *                        tags in assistant text into pi's native ThinkingContent
 *                        blocks (no commands, no UI — pure message-content transform)
 *   - notify.ts       — audio notification: plays MP3 on task completion (after a
 *                        configurable threshold) and when the AI asks a question
 *   - quick-open-dir.ts — /qd: quick dir access menu (data dir, .pi dir,
 *                        toolset dir — the last gated by a .dev marker folder)
 *   - debug-log.ts    — /aftc-debug-log-on|off: gate the [aftc-toolset] stdout
 *                        diagnostics (off by default — clean TUI)
 *   - docx/          — /docx: regenerate the project's full documentation set
 *                        into ./docx/ per the shipped documentation guide;
 *                        old docs backed up to docx/old_docs.zip
 *   - aftc-codex/     — opt-in knowledge base: injects codex rules + guidance +
 *                        resource list into the system prompt; codex_load tool;
 *                        /aftc-codex-* commands (off by default)
 *   - subagents/      — 007 sub-agents: delegate focused work to isolated child
 *                        pi processes (foreground subagent tool, /007 menus,
 *                        supervisor with killable trees + watchdogs; off by default)
 *   - providers/      — LLM provider features; today: qwencloud.ts (Alibaba Qwen
 *                        Cloud + Coding Plan via pi's native /login, /qwencloud)
 *                        DISABLED: pi now ships this natively; kept on disk in
 *                        case the built-in proves weaker (see index body)
 *   - db.ts           — shared SQLite connection utility
 *   - paths.ts        — package/runtime path helpers
 *   - types.ts        — shared TurnRecord / FooterDataProvider interfaces
 *
 * The orchestrator instantiates the feature modules and wires them to
 * pi. Cross-module data flows through the orchestrator: core.ts returns
 * a FooterDataProvider that the orchestrator passes to footer-widget.ts.
 * Modules own their own state in closure and do not import each other.
 *
 * See `index-readme.md` for the orchestration responsibilities.
 * See `readme.md` (folder level) for the full file map.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAllowance } from "./allowance";
import { createCore } from "./core";
import { createFooterWidget } from "./footer-widget";
import { createKeys } from "./keys";
// Intros: the factory (intros/intro-factory.ts) is DISCONNECTED 2026-07 —
// files kept on disk. Only the AFTC text intro runs, wired directly below
// (it was rock solid). Re-enable the factory to restore the random draw.
import { createTextIntro, initTextIntro } from "./intros/intro-text";
import { createTheme } from "./theme";
import { createUsageRecording } from "./usage-recording";
import { createUsageModule } from "./usage-report";
import { createHelpModule } from "./help";
import { registerHelpEntry } from "./help-registry";
import { createInstallModule } from "./install";
import { createSshModule } from "./ssh/index";
import { createResponseDivider } from "./response";
import { createStfu } from "./stfu";
import { createDir } from "./dir";
import { createCwd } from "./cwd";
import { createReplay } from "./replay";
import { createKeepItShort } from "./keep-it-short";
import { createThinkParser } from "./think-parser";
import { createNotify } from "./notify";
import { createQuickOpenDir } from "./quick-open-dir";
import { createDebugLog } from "./debug-log";
import { createDocx } from "./docx/docx";
import { createAftcCodex } from "./aftc-codex/aftc-codex";
import { createSubAgents, buildSubAgentFooterLine } from "./subagents/subagents";
import { getSubAgentPref } from "./subagents/subagent-config";
import { createRunScript } from "./run-script";
import { migrateLegacyData } from "./paths";
import * as aftcConsole from "./ui/aftc-console";
// DISABLED 2026-07: pi 0.81 added native provider support. Module kept on
// disk (not deleted) in case the built-in proves weaker — re-enable both
// lines to restore it.
// import { createProviders } from "./providers/index";

export default function (pi: ExtensionAPI): void {
	try {
	// Migrate any legacy package-local data (turns.db, config.json, ssh.json, ...)
	// to the persistent OS data dir BEFORE any module reads it. Idempotent, lock-safe.
	migrateLegacyData();

	// Centralised console output — register the emphasis entry renderer once.
	aftcConsole.init(pi);
	// Intro feedback console lines — register the entry renderer once.
	initTextIntro(pi);

	// Independent modules first (self-register commands/handlers).
	const allowance = createAllowance(pi);
	const recorder = createUsageRecording(pi);
	const usage = createUsageModule(pi);
	const help = createHelpModule(pi);
	createInstallModule(pi);
	createKeys(pi);
	// AFTC text intro only (factory disconnected — see the import note above).
	const textIntro = createTextIntro();
	registerHelpEntry({
		command: "aftc-intro-on",
		description: "Enable and play the AFTC text startup animation",
		category: "Response",
	});

	pi.registerCommand("aftc-intro-on", {
		description: "Enable and play the AFTC text startup animation",
		handler: async (_args, ctx) => {
			if (textIntro.isEnabled()) { aftcConsole.emphasis(ctx, "AFTC text intro is already ON"); return; }
			textIntro.setEnabled(true);
			aftcConsole.emphasis(ctx, "AFTC text intro: ON");
			textIntro.play(ctx, 0); // instant feedback (no start delay from the command)
		},
	});
	registerHelpEntry({
		command: "aftc-intro-off",
		description: "Disable the AFTC text startup animation",
		category: "Response",
	});

	pi.registerCommand("aftc-intro-off", {
		description: "Disable the AFTC text startup animation",
		handler: async (_args, ctx) => {
			if (!textIntro.isEnabled()) { aftcConsole.emphasis(ctx, "AFTC text intro is already OFF"); return; }
			textIntro.setEnabled(false);
			textIntro.stop(ctx);
			aftcConsole.emphasis(ctx, "AFTC text intro: OFF");
		},
	});
	pi.on("session_start", async (event, ctx) => {
		// The intro plays ONLY on a real pi startup (reason "startup"):
		// /reload, /new, resume and fork re-fire session_start in the SAME
		// process and must not replay the wordmark + feedback line.
		if (event.reason !== "startup") return;
		// Default START_DELAY_MS applies so pi's startup paint settles first.
		if (textIntro.isEnabled()) textIntro.play(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		textIntro.stop(ctx);
	});
	createTheme(pi);
	createSshModule(pi);
	createResponseDivider(pi);
	createStfu(pi);
	createDir(pi);
	createCwd(pi);
	createReplay(pi);
	createKeepItShort(pi);
	createThinkParser(pi);
	createNotify(pi);
	createQuickOpenDir(pi);
	createDebugLog(pi);
	createDocx(pi);
	createAftcCodex(pi);
	const subAgents = createSubAgents(pi, { allowance });
	createRunScript(pi);
	// createProviders(pi); // disabled — see note at the import above

	// Core owns the data; the widget renders it. The orchestrator wires
	// them so neither module imports the other (AGENTS.md). allowance
	// is passed into core exactly like recorder, and re-exposed on the
	// FooterDataProvider so the widget can render line 5 without importing
	// allowance.ts.
	const footerData = createCore(pi, recorder, allowance);
	createFooterWidget(pi, footerData, {
		// Sub-agents footer line: in-memory snapshot only (no DB). Always
		// visible while the feature is enabled; hidden only when the feature
		// is disabled or the footerLineEnabled toggle is off.
		subAgentLine: (colors) => {
			if (!getSubAgentPref("enabled", false)) return null;
			if (!getSubAgentPref("footerLineEnabled", true)) return null;
			const snapshot = subAgents.getStatusSnapshot();
			return buildSubAgentFooterLine(snapshot, colors, getSubAgentPref("maxConcurrent", 4));
		},
	});

	// usage and help are intentionally not passed to anyone — they
	// self-register their commands/handlers in attach() and are otherwise
	// standalone.
	void usage;
	void help;
	} catch (err) {
		aftcConsole.logError(`orchestrator error: ${(err as Error).message}`);
		aftcConsole.logError(`stack: ${(err as Error).stack}`);
	}
}
