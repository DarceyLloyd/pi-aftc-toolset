# PROJECT-TYPE PACK: Shell script collection (bash / sh / ps1 / bat)

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers projects that are collections of shell scripts - bash/sh,
PowerShell (.ps1), Windows batch (.bat/.cmd) - automation, deployment,
maintenance and tooling scripts, with no compiled application.

## Sources of truth (recon - read these, never the old docs)

- THE SCRIPTS THEMSELVES: every .sh/.bash/.ps1/.bat/.cmd file. Each script
  is a MODULE - its purpose comes from its code (header comments are hints;
  the commands are truth).
- PARAMETERS: each script's argument handling ($1..$n, getopts, param()
  blocks, %1..%9, flags) and its usage/help output.
- ENVIRONMENT: every env var read or set, config files sourced, secrets
  expected (document WHERE they are expected from - never the values).
- SIDE EFFECTS: files/dirs created or deleted, services started/stopped,
  registry edits, scheduled tasks, packages installed - the destructive
  ones get called out explicitly.
- CALL GRAPH: which script calls which (source, &, call, Start-Process) and
  what invokes the entry points (cron, Task Scheduler, CI, a human).
- INTERACTIVE BITS: read/choice/prompt menus inside scripts - each
  interactive menu is a surface with its own leaf doc.

## Surface rules for this stack

- Most scripts have no UI: document each script as a leaf doc (the "pages"
  of this project type are the scripts). Scripts with interactive menus
  additionally get surface leaf docs per menu.
- Group scripts by folder/purpose into branch nodes (deployment, backup,
  dev tools, ...); one leaf doc per script inside its branch folder.

## Per-script leaf contract (what the core's contract means here)

- The script file + how it is invoked (exact command line, who runs it).
- Purpose (owns / does not own) from the code.
- Every parameter/flag (name, type, default, validation), every env var
  (meaning, required?, default).
- What it reads/writes/changes (files, services, state) - destructive
  operations flagged.
- Exit codes / failure behaviour + rollback or recovery steps.
- Example invocations (copy-pasteable), including the dangerous ones with
  their warnings.
- Scheduling: cron/Task Scheduler entry if one exists.

## Extra rules

- Document the required interpreter + version and OS scope per script
  (a bash script assuming GNU tools, a .ps1 requiring pwsh 7).
- Record elevation requirements (sudo/admin) and what breaks without them.
- A runner/dispatcher script (one menu that calls the rest) is documented
  as the branch's surface with the per-script leaves under it.
