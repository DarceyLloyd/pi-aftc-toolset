# PROJECT-TYPE PACK: Desktop application (Electron, .NET, Java, Qt)

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers desktop applications: Electron, .NET (WPF, WinForms,
MAUI, Avalonia), Java (Swing, JavaFX), Qt, and similar native/cross
toolkits.

## Sources of truth (recon - read these, never the old docs)

- WINDOWS/SCREENS: window constructors and screen classes - Electron
  BrowserWindow creations, .NET Window/Page/Form classes, Java JFrame/
  Stage/FXML controllers, Qt .ui files and QWidget/QDialog subclasses.
- DIALOGS/POPUPS: dialog.show* (Electron), MessageBox/CommonDialogs,
  JOptionPane/JDialog, AlertWindow equivalents, wizards - each is a PAGE
  with its own leaf doc (settings, about, confirm, open/save flows).
- MENUS: application menu definitions, tray menus, context menus - the
  menu tree is the surface map's skeleton.
- NAV: in-app navigation (tab controls, navigation drawers, router for the
  shell) - every reachable view.
- ELECTRON IPC: ipcMain.handle/on + ipcRenderer.invoke/send + preload
  bridges - the IPC channel list IS the app's API contract; document every
  channel (name, payload, response, which window uses it).
- FORMS/CONTROLS: XAML/AXAML files, *.Designer.cs, FXML, .ui files - every
  control (id, label, type, validation/binding) comes from these files.
- BUILD: package.json/.csproj/pom.xml/build.gradle/CMakeLists + lockfiles
  (EXACT versions), packaging config (electron-builder, MSIX, jpackage).

## Surface rules for this stack

- Every window, screen, dialog, wizard and tray/menu surface gets a
  sitemap entry; each non-trivial one a leaf doc under the window-set
  branch's folder.
- SINGLE-WINDOW MULTI-REGION apps (one window carrying nav + editor +
  panel areas): apply the core's sub-page breakdown - child leaf docs per
  region when 2+ regions have their own rules/states/data-contracts, one
  doc when inseparable. State the decision per screen.
- Modal dialogs opened from a window are never documented only inside that
  window's doc.

## Per-surface leaf contract (what the core's contract means here)

- The class/file that defines the window/dialog (+ its designer/FXML/.ui
  file).
- What's on it: every control from the definition file (id, label, type,
  binding, validation), menus/toolbars present.
- Data: models/viewmodels bound, IPC channels used (Electron), files read/
  written, settings stores.
- States: empty, loading, error, success, disabled, dirty/unsaved.
- Functionality: the flow (open -> edit -> validate -> save -> close),
  including cancel/dirty handling found in code.

## Extra rules

- Electron: main/renderer/preload process split is documented in the app
  deep doc (what runs where, and why); the IPC contract is a mandatory
  section.
- Installer/packaging and auto-update flow belong in operations sections.
- Platform differences (win/mac/linux behaviour in code) are recorded
  where they exist.
