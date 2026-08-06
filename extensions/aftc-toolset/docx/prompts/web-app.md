# PROJECT-TYPE PACK: Web application

Appended to the /docx core execution prompt. It defines THIS stack's sources
of truth, surface rules and per-surface specifics. Where it sharpens the
core, follow it. The core's rules (mirrored tree, one deep doc per ID,
source-over-docs, full pass) still apply.

This pack covers server-backed web applications: PHP/Apache/MySQL/MariaDB
stacks (often Dockerised), custom MVC backends (including hand-rolled PHP or
Node frameworks), AND JS/TS frontend frameworks - Angular, React, Next.js,
Vue, Svelte - plus custom MVC TS/JS frontends. A project often has BOTH a
public frontend and an admin/CMS frontend: they are SEPARATE UI branches
with separate sitemaps (and separate design docs when their styles differ).

## Sources of truth (recon - read these, never the old docs)

- ROUTES: backend route tables (router files, route registration calls,
  .htaccess / nginx rewrites, custom MVC route arrays) AND SPA route
  definitions (React Router, Angular RouterModule, Vue Router, Next.js app/
  pages directory). Every route is a page.
- CONTROLLERS + MODELS: controller/handler files and their model/entity
  layer - they define what each page does and what data it reads/writes.
- TEMPLATES: blade/twig/phtml/ejs/hbs/html templates and framework component
  templates (.component.html, .jsx/.tsx render, .vue/.svelte) - the fields,
  controls and validation ON each page come from these, not from prose.
- FORMS: every form, its fields (id, label, type, required, validation),
  its submit endpoint and its server-side validators.
- MODALS: search source for modal/dialog/drawer/popup/offcanvas components
  AND the code that opens them (openModal, showModal, bootstrap Modal,
  <dialog>, route-as-modal). Login, register, checkout, confirm-delete,
  settings - each modal found is a PAGE with its own leaf doc.
- SCHEMA: init SQL, migrations, seeders - the tables/columns each page
  stores and reads.
- API: endpoint registrations (REST routes, RPC handlers) consumed by the
  frontend.
- CONFIG: composer.json/package.json + lockfiles (EXACT versions),
  .env(.example), compose files + Dockerfiles (services, env, volumes,
  health gates), Apache/nginx vhost configs.

## Surface rules for this stack

- Public site pages, admin/CMS pages, SPA routes, AND every modal/drawer/
  dialog are all surfaces: each gets a sitemap entry, and each non-trivial
  one a leaf doc under its UI branch's folder.
- Producer/consumer pairs are mandatory cross-links: the admin manager that
  creates/edits the content a public page renders (and vice versa) must be
  linked by ID in both docs' Related sections.
- A page that lists items + has create/edit/delete modals is mapped as the
  list page PLUS one leaf per modal.
- Auth flows (login/register/forgot-password/reset) are usually modals or
  dedicated pages - never skip them; they are the most-used surfaces.

## Per-surface leaf contract (what the core's contract means here)

- Route (URL + method) + the controller action and template file that
  render it.
- What's on it: every field/control FROM THE TEMPLATE (id, label, type,
  validation, options), sections/regions, partials included.
- Data: schema tables + columns it reads/writes, API endpoints it calls,
  session/auth requirements.
- States: empty list, loading, error (validation + server), success,
  unauthenticated redirect, not-found.
- Functionality: the full flow (submit -> validation -> endpoint ->
  redirect/render), including edge cases found in the handler code.

## Extra rules

- Docker in use: the container rules of the core/guide apply IN FULL -
  every container (incl. one-shot seed/migration containers and dev tools
  like phpMyAdmin) gets its own deep doc.
- Record the web server specifics: vhosts, docroots, rewrites, default-page
  handling (per the guide's container/web sections).
- Exact versions from lockfiles/manifests in every tech-stack table.
