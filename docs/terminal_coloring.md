Standard 16-color reference (foreground)
Code	Color
\x1b[30m	Black
\x1b[31m	Red
\x1b[32m	Green
\x1b[33m	Yellow
\x1b[34m	Blue
\x1b[35m	Magenta
\x1b[36m	Cyan
\x1b[37m	White
\x1b[90m	Bright Black (dark gray)
\x1b[91m	Bright Red
\x1b[92m	Bright Green
\x1b[93m	Bright Yellow
\x1b[94m	Bright Blue (light blue)
\x1b[95m	Bright Magenta
\x1b[96m	Bright Cyan
\x1b[97m	Bright White



Background colors
Prefix 3 → foreground, 4 → background. So \x1b[43m is yellow background, \x1b[44m is blue background, \x1b[104m is bright blue background, etc.

Common styles
Code	Effect
\x1b[0m	Reset all
\x1b[1m	Bold / Bright
\x1b[3m	Italic
\x1b[4m	Underline
\x1b[7m	Inverse / Reverse
You can chain them: \x1b[1;33m = bold + yellow. Always end with \x1b[0m to reset









// ─────────────────────────────────────────────────────────────────────────────
// THEME COLOR REFERENCE
// ─────────────────────────────────────────────────────────────────────────────
//
// In pi, every renderer / component factory receives a `theme` argument:
//   - renderCall(args, theme, context)             → theme
//   - renderResult(result, options, theme, context) → theme
//   - registerMessageRenderer(type, fn)            → fn(message, opts, theme)
//   - ctx.ui.custom((tui, theme, keybindings, done) => ...)
//   - ctx.ui.setFooter((tui, theme, footerData) => ...)
//   - ctx.ui.setHeader((tui, theme) => ...)
//   - ctx.ui.setWidget("k", (tui, theme) => ...)
//   - ctx.ui.setStatus("k", ctx.ui.theme.fg(...))  ← also accessible here
//
// Use ONLY the theme passed to you. Never import a theme directly. Themes
// change at runtime (e.g. /settings), and the new theme is re-injected on
// each render. If you cache styled strings, invalidate() must rebuild them.
//
// USAGE
//   theme.fg("token", "text")     → foreground (text) color
//   theme.bg("token", "text")     → background color
//   theme.fg("token", theme.bg("other", "text"))  → compose fg + bg
//   theme.bold("text")            → bold
//   theme.italic("text")          → italic
//   theme.strikethrough("text")   → strikethrough
//   theme.bold(theme.fg("accent", "X"))           → style + color
//
// ⚠ Styles do NOT carry across lines. The TUI resets SGR at the end of each
//   line. For multi-line text with styling, re-apply the style per line, or
//   use wrapTextWithAnsi() from @earendil-works/pi-tui.
//
// ─────────────────────────────────────────────────────────────────────────────
// FOREGROUND (TEXT) COLOR TOKENS  -  all 51 required theme tokens
// ─────────────────────────────────────────────────────────────────────────────
//
// CORE UI (11)
//   "accent"           primary accent (logo, selection cursor, headings)
//   "border"           normal border color
//   "borderAccent"     highlighted/active border
//   "borderMuted"      subtle border (e.g. inactive editor frame)
//   "success"          green - success states
//   "error"            red   - error states
//   "warning"          yellow - warning states
//   "muted"            secondary text (de-emphasised but still readable)
//   "dim"              tertiary text (timestamps, hints, "faint" labels)
//   "text"             default text  (pass "" to use terminal default)
//   "thinkingText"     text inside <thinking> blocks
//
// BACKGROUNDS & CONTENT (11)  ← use with theme.bg()
//   "userMessageBg" / "userMessageText"      your own messages
//   "customMessageBg" / "customMessageText"  extension-injected messages
//   "customMessageLabel"                     extension message label
//   "toolPendingBg" / "toolSuccessBg" / "toolErrorBg"   tool box states
//   "toolTitle"                              tool call/result title
//   "toolOutput"                             tool output text
//   "selectedBg"                             selected line in any list
//
// MARKDOWN (10)  - pi renders markdown for assistant text and tool outputs
//   "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
//   "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet"
//
// TOOL DIFFS (3)  - used in edit / write tool result rendering
//   "toolDiffAdded", "toolDiffRemoved", "toolDiffContext"
//
// SYNTAX HIGHLIGHTING (9)  - for code blocks (use highlightCode() helper)
//   "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
//   "syntaxString", "syntaxNumber", "syntaxType",
//   "syntaxOperator", "syntaxPunctuation"
//
// THINKING-LEVEL BORDER (6)  - editor border color reflects current
//                               /thinking level, from subtle to loud
//   "thinkingOff", "thinkingMinimal", "thinkingLow",
//   "thinkingMedium", "thinkingHigh", "thinkingXhigh"
//
// MODES (1)
//   "bashMode"         editor border when in `!` bash-input mode
//
// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND-ONLY TOKENS  (use with theme.bg(), not theme.fg())
// ─────────────────────────────────────────────────────────────────────────────
//   "selectedBg", "userMessageBg", "customMessageBg",
//   "toolPendingBg", "toolSuccessBg", "toolErrorBg"
//
// ─────────────────────────────────────────────────────────────────────────────
// QUICK CHEAT SHEET  - common patterns
// ─────────────────────────────────────────────────────────────────────────────
//
//   // Status line in the footer
//   ctx.ui.setStatus("my-ext", theme.fg("accent", "● active"));
//
//   // Error notification (use ctx.ui.notify for popups, not styling)
//   ctx.ui.notify("Boom", "error");
//
//   // Render a heading + a muted body
//   const head = theme.fg("accent", theme.bold("Result:"));
//   const body = theme.fg("text",  " 42 items processed");
//
//   // Compose fg + bg
//   const pill = theme.fg("customMessageText",
//                  theme.bg("customMessageBg", " status "));
//
//   // A horizontal rule in YOUR color (the built-in `---` uses mdHr):
//   const hr = theme.fg("borderMuted", "─".repeat(width));
//
//   // Highlight code in a custom tool renderer
//   import { highlightCode, getLanguageFromPath } from "@earendil-works/pi-coding-agent";
//   const html = highlightCode(src, getLanguageFromPath(p) ?? "typescript", theme);
//
//   // Custom message renderer
//   pi.registerMessageRenderer("my-type", (msg, { expanded }, theme) => {
//       const head = theme.fg("customMessageLabel", theme.bold("[my-ext] "));
//       const body = theme.fg("customMessageText", msg.content);
//       return new Text(head + body, 0, 0);
//   });
//
//   // Custom tool result
//   renderResult(result, { expanded, isPartial }, theme, context) {
//       if (result.isError) return new Text(theme.fg("error", "✗ Failed"), 0, 0);
//       if (isPartial)      return new Text(theme.fg("warning", "Working…"), 0, 0);
//       return new Text(theme.fg("success", "✓ Done"), 0, 0);
//   }
//
// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME THEME SWITCHING  (admin / `/settings` re-route)
// ─────────────────────────────────────────────────────────────────────────────
//   ctx.ui.getAllThemes()                // [{ name, path? }, ...]
//   ctx.ui.getTheme("light")             // load without switching
//   ctx.ui.setTheme("light")             // → { success, error? }
//   ctx.ui.setTheme(themeObject)         // or pass the Theme object
//   ctx.ui.theme.fg(...)                 // current active theme (anytime)
//
// When the theme changes, the TUI calls invalidate() on every component.
// Components that pre-bake theme colors into child components must override
// invalidate() and rebuild (see tui.md → "Invalidation and Theme Changes").
//
// ─────────────────────────────────────────────────────────────────────────────
