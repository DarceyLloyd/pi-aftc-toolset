# PROJECT-TYPE PACK: CLI tool / TUI application

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers command-line tools and terminal-UI applications in any
language (Node, Go, Rust, Python, C++, ...): tools whose interface is
commands, flags, interactive prompts and terminal screens.

## Sources of truth (recon - read these, never the old docs)

- COMMAND DEFINITIONS: commander/yargs/cobra/clap/argparse/typer
  registrations - every command and subcommand, its args/flags, defaults
  and validation. The command tree IS the surface tree.
- HELP TEXT: --help output strings in source - cross-check them against
  the actual flags (help text lies; the parser is truth).
- INTERACTIVE PROMPTS: inquirer/enquirer/prompt-toolkit/questionary prompt
  flows - wizards, confirms, selects - each interactive flow is a surface
  with its own leaf doc.
- TUI SCREENS: blessed/ink/tview/bubbletea/textual screen and pane
  registries - every screen/pane/dialog is a page.
- CONFIG: config file formats, env vars, flag precedence (flag > env >
  config > default) from the loading code.
- I/O CONTRACTS: stdin/stdout shapes, --json output, files read/written,
  exit codes (from process.exit/os.Exit calls, not prose).
- BUILD: the tool's manifest + lockfile (EXACT versions), install method
  (npm -g, brew, cargo install, curl script).

## Surface rules for this stack

- Each command/subcommand is documented like a page: purpose, usage line,
  every arg/flag (name, type, default, validation, required), input,
  output, exit codes, side effects, examples. A command group gets child
  leaves per subcommand.
- TUI screens/panes/dialogs each get a leaf doc (layout regions, key
  bindings, states).
- Interactive wizards get a leaf doc per flow (every prompt step, branches,
  validation, abort behaviour).

## Per-surface leaf contract (what the core's contract means here)

- The file + registration that defines the command/screen.
- What's on it: flags/args or panes/keys (id, label, type, validation).
- Data: files/config/state read and written; env vars honoured.
- States: success + every exit code, empty input, error output shape.
- Functionality: the flow, with copy-pasteable example invocations and
  real output samples (short).

## Extra rules

- Key-binding conventions across TUI screens go in the design doc (one
  place), not repeated per screen.
- Shell completion, man pages and aliases are documented under setup.
- Piping/scripting behaviour (TTY vs non-TTY differences) is recorded per
  command where the code branches.
