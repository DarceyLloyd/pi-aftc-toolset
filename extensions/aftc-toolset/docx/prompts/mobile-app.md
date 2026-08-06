# PROJECT-TYPE PACK: Mobile application

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it.

This pack covers mobile apps: native Android (Kotlin/Java) and iOS
(Swift/Obj-C), React Native, Flutter, and similar cross-platform shells.

## Sources of truth (recon - read these, never the old docs)

- NAVIGATION: the navigation registry IS the surface tree - React
  Navigation navigators, Flutter Navigator/routes table, Android nav
  graphs (navigation XML) + Activity/Fragment list, iOS storyboards +
  ViewController segues. Every registered destination is a page.
- SCREENS: screen/composable/view files per destination.
- MODALS: bottom sheets, alerts/action sheets, modal presentations,
  dialogs - EACH IS A PAGE with its own leaf doc (login, filters, share,
  confirm, upgrade).
- TABS/DRAWERS: tab bars and drawer menus - both the container surface and
  each tab's content surface.
- CONTROLS: form fields and validation from the screen definitions
  (widgets, XML layouts, SwiftUI views).
- DATA: API clients, local storage (Room/CoreData/SQLite/SharedPreferences/
  UserDefaults), state management (stores/blocs/viewmodels).
- PLATFORM: permissions (manifest/Info.plist), deep links, push
  notifications, platform-specific code branches.
- BUILD: pubspec.yaml, build.gradle, Podfile/package.json + lockfiles
  (EXACT versions).

## Surface rules for this stack

- Every screen, tab, sheet, dialog and modal gets a sitemap entry; each
  non-trivial one a leaf doc under the screen-set branch's folder.
- Onboarding/auth flows (login, register, permissions primers) are
  surfaces - never skipped.

## Per-surface leaf contract (what the core's contract means here)

- The route/destination name + the file that defines the screen.
- What's on it: every control (id/key, label, type, validation), lists and
  their item layouts.
- Data: APIs called, local tables/stores read/written, required
  permissions.
- States: empty, loading, error, offline, success, permission-denied.
- Functionality: the flow + navigation transitions in/out of the screen.

## Extra rules

- Record platform differences where code branches (iOS vs Android).
- Deep links and push-notification entry points are documented per screen
  they land on.
