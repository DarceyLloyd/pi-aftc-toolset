# PROJECT-TYPE PACK: Python application

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers Python applications of any shape: CLI tools, web apps
(Flask/Django/FastAPI), desktop GUIs (Qt/Tk/wx), TUI apps (textual/urwid/
curses), and service/daemon projects.

## Sources of truth (recon - read these, never the old docs)

- ENTRY POINTS: main.py, __main__.py, wsgi/asgi modules, entry_points /
  [project.scripts] in pyproject.toml.
- CLI COMMANDS: argparse subparsers, click/typer command registrations -
  every command is a surface (documented per the CLI rules below).
- WEB ROUTES (when present): Flask/Django/FastAPI route registrations +
  their templates (Jinja2/Django templates) - every route is a page, every
  template modal/partial a surface.
- GUI (when present): QMainWindow/QDialog subclasses + .ui files, Tkinter
  frames/dialogs, wx frames - every window and dialog is a page.
- TUI (when present): textual Screens/Widgets, urwid frames, curses views -
  every screen/pane is a page.
- FORMS/CONTROLS: form classes (Django/WTForms), template fields, widget
  definitions (id, label, type, validation).
- DATA: models (SQLAlchemy/Django ORM/dataclasses), migrations, config
  files + env vars.
- BUILD: pyproject.toml/setup.py/requirements*.txt + lockfiles (EXACT
  versions), venv/uv/poetry/pipenv setup.

## Surface rules for this stack

- CLI surfaces: each command/subcommand is documented like a page
  (purpose, args/flags with validation, I/O, exit codes, examples) - a
  command group gets child leaves per subcommand.
- Web surfaces follow the web rules: routes + templates + modals each a
  page; admin pages (Django admin customisations) are a separate UI branch.
- GUI/TUI surfaces: every window/dialog/screen/pane a page; modal dialogs
  never buried in their opener's doc.

## Per-surface leaf contract (what the core's contract means here)

- The file + function/class that defines the surface.
- What's on it: arguments/flags or fields/controls (id, label, type,
  validation, defaults), from source.
- Data: models/tables read/written, files, env vars.
- States: empty, error (validation + runtime), success, exit codes.
- Functionality: the flow, with copy-pasteable example invocations for
  CLI surfaces.

## Extra rules

- The dev-setup doc records the environment manager actually used (uv/
  venv/poetry) with exact commands from the manifests.
- Scheduled/daemon behaviour (cron entries, systemd units, workers) is
  documented under operations.
