# BDIH Project Tracking Tool

Project tracker for the design, development and implementation of the BOCRA and UASF Trust websites, built from `BDIH_Project_Tracking_Tool_SRS.docx` (v0.1).

## What is here

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app. With `js/config.js` set it runs against the live database; add `?demo` to the address to use the browser-only demo instead. |
| `js/config.js` | Live database address and public key. Both are public by design; access is controlled by sign-in and Row Level Security. |
| `js/live.js` | Connects the screens to the live database. |
| `supabase/plan.sql` | Loads the full project plan (80 activities, links, deliverables and baseline) into a new database. |
| `supabase/migrations/` | Database: schema, roles and permissions, scheduling engine, Row Level Security, workflow functions, storage policies, reporting views, invoices and developer tickets. |
| `supabase/seed.sql` | Reference data: organisations, workstreams, settings, closure days, lists and resources. |
| `database.html` | **Database index:** every migration, the seed and the Edge Functions in one page, with search, copy and download, the compressed script and the security and performance checklist. Administrators reach it from **Administration, Database scripts**. |
| `supabase/bdih_tracker.min.sql` | Compressed single script: all migrations and the seed with comments and indentation removed. Run it once in the SQL editor to build the database. |
| `tools/build-database-page.mjs` | Rebuilds `database.html` and the compressed script after any change: `node tools/build-database-page.mjs`. |
| `supabase/functions/` | Edge Functions: `login` (username sign-in with lockout), `signed-url` (5 minute download links), `admin-users` (create users and reset passwords). |
| `assets/logos/` | Put the official logo files here (see below). |

## Run it locally

Serve the folder and open it in a browser:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/?demo` for the demo. Demo accounts are listed on its sign-in page and all use the password `Demo!Pass2026`. **Reset demo data** in the sidebar restores the starting position. Without `?demo`, the page signs in to the live database.

Named accounts:

| Person | Username | Role |
|---|---|---|
| Kgakgamatso Letsweletse | `kletsweletse` | System Administrator (BDIH AI) |
| Kgotlayarona Basalumi | `kbasalumi` | BDIH Project Leader |
| Maipelo Jerimiah | `mjerimiah` | BDIH Project Officer |
| Duke Ndubo | `dndubo` | BDIH Developer |
| Seepelo Malefho | `smalefho` | BOCRA Project Lead |

The other demo accounts are placeholders. On the live database only `kletsweletse` and `smalefho` exist so far; the administrator adds everyone else in **User management**.

## Roles and access

- **Roles:** Administrator, BDIH Director (read-only), Project Leader, Project Officer, Business Analyst, BDIH Developer, BOCRA Project Lead, BOCRA Team Member, Developer Lead and Developer Team Member.
- **More than one role:** a user can hold several roles, all within their own organisation. They get every permission of every role they hold.
- **Permissions:** every permission is a tick in **Administration, Roles and permissions**. Administrators can change the grid.
- **Workstream rules:** these apply on top of the permissions. Each developer only ever sees its own website.
- **User management:** groups people by organisation (BDIH, BOCRA, Developer A, Developer B). It handles adding users, primary and extra roles, password resets, unlocking, deactivation and "View as".
- **Forgotten password:** a link on the sign-in page sends a reset request to the administrators.
- **Developer leads:** a developer team can have several Developer Leads. Use **Make lead** in User management. Every grant and removal is audited, and a team always keeps at least one lead.
- **Downloads:** every download of a document, report or export is recorded. BDIH and BOCRA see who downloaded what in **Reports, Download log**. Each person has a daily download limit (30 by default), which an administrator can change in **Settings**.

## What the administrator can change (no code changes needed)

| Where | What |
|---|---|
| Administration, Organisations and workstreams | Registered names of Developer A and B (and the other organisations), contact details, workstream names, websites, owners and ticket key prefixes |
| Administration, Settings | Application name, subtitle, project name, project start, contract length, review days, report day, performance thresholds, VAT rate, escalation step, daily download limit, sign-out times, lockout rules and minimum password length |
| Administration, Closure calendar | Festive closure dates and public holidays (the plan reschedules automatically) |
| Administration, Lists | Phases and their names, ticket board columns, ticket types and priorities, document and document-bank categories, review checklist and meeting forums. Values still in use cannot be removed |
| Administration, Roles and permissions | Role names and the permission grid |
| Administration, Labels | The wording of any button, menu item, tab or window title |
| User management | People, organisations, primary and extra roles, developer leads, password resets, unlocking and deactivation |
| Records | Administrators can void or reopen invoices and delete tickets, meetings and register entries. Every change is audited |

Activity types, activity statuses, health ratings and invoice statuses stay fixed, because the scheduling and approval rules depend on them.

## Logos

The app shows vector redraws of the Botswana Innovation Hub, BOCRA and UASF logos. To use the official artwork, save it as:

- `assets/logos/bdih.png`
- `assets/logos/bocra.png`
- `assets/logos/uasf.png`

The `.svg` and `.jpg` versions of these names also work. The app finds the files when it loads.

## Downloads (dist/)

`node tools/build-standalone.mjs` writes single-file versions that need no other files:

- `dist/bdih-tracker.html`: the whole app in one file
- `dist/bdih-database.html`: the database scripts page in one file
- `dist/bdih_tracker.min.sql`: the compressed database script
- `dist/plan.sql`: the project plan loader

The single-file pages keep the content security policy; each inline script is allowed by its SHA-256 hash.

## Cloudflare Turnstile

- **Site key:** the sign-in page shows a Turnstile check. The site key (`0x4AAAAAAFvlUC69yGzxrwc-`) is public and can be changed in **Administration, Settings**, where the check can also be switched off.
- **Hostnames:** in the Cloudflare dashboard, add the app's hostname to the widget. Add `localhost` too if you want the check on local test copies; without it, test copies on `localhost` or opened from disk let you sign in without the check.
- **Secret key:** keep it secret. Set it only as an Edge Function secret: `supabase secrets set TURNSTILE_SECRET=...`. Once it is set, the `login` function refuses any sign-in that fails Cloudflare's check.
- **Existing databases:** run any migrations from `supabase/migrations/` you have not yet applied, in order (0010 Turnstile, 0011 security fixes, 0012 password change).

## Set up the database

1. Create the development, staging and production projects (NFR-MNT-02).
2. Build the database: run `supabase/bdih_tracker.min.sql` in the SQL editor, or apply the migrations with `supabase db push` and then run `supabase/seed.sql`. Then run `supabase/plan.sql`.
3. Work through the items marked **Configure** in the checklist on `database.html`.
4. Deploy the functions:
   - `supabase functions deploy login --no-verify-jwt`
   - `supabase functions deploy signed-url`
   - `supabase functions deploy admin-users`
5. Allowed web addresses for the functions are in the `app_origins` column of `settings`. Add the live address there (it already holds `https://bocratracker.pages.dev` and `http://localhost:8765`).
6. In Auth settings, set the JWT expiry to 60 seconds or less. This ends a deactivated user's session within one minute (FR-AUTH-10).
7. Enable `pg_cron` and schedule `select public.run_reminders()` for weekday mornings. It handles review timers, late weekly reports, action reminders and escalation.
8. Create the first administrator directly in the dashboard. Create everyone else through `admin-users`.

## Hosting on Cloudflare Pages

Connect the GitHub repository `bdihBW/bocratracker` in Cloudflare, **Workers and Pages, Create, Pages, Connect to Git**. Use project name `bocratracker`, no framework, no build command and output directory `/`. The site is then at `https://bocratracker.pages.dev`. If you use another address, add it to `settings.app_origins` and to the Turnstile widget hostnames.

## Key database entry points (call with `supabase.rpc`)

| Function | Purpose |
|---|---|
| `update_progress` | Progress and status updates. Developers can change only these columns. |
| `submit_deliverable`, `bdih_recommend`, `bocra_decide` | Review workflow with 3 and 5 business-day timers. |
| `file_weekly_report` | Weekly report that also updates % done. |
| `save_baseline` | Saves a baseline. Every baseline after the first needs an approved change request. |
| `lock_progress` | Locks a reporting period. |
| `delete_document`, `restore_document` | Soft delete and restore of documents. |
| `submit_invoice`, `set_invoice_status`, `resubmit_invoice` | Invoices. Developers and BDIH raise them; they go to the BOCRA Project Lead, who sets the status. |
| `has_perm(permission)`, `roles_of(user)`, `admin_set_roles` | Role-based access and multiple roles per user. |
| `request_password_reset(username)` | Forgotten-password request; it gives the same answer whether or not the username exists. |
| `document_trail(id)` | Upload, version and download history for a document-bank file. |
| `record_download(...)`, `download_log(from, to)` | Enforces the daily download limit, records each download and lists who downloaded what. |
| `add_deliverable(...)` | Adds a deliverable to the plan with its BDIH and BOCRA review steps and a register entry. |
| `workstream_progress(date)`, `project_progress(date)` | Dashboard figures. `project_progress` returns nothing to developers. |
| `activity_predecessors(id)` | Shows hidden predecessors as "Waits for BDIH or BOCRA action". |

Developer tickets live in the `tickets`, `ticket_comments` and `ticket_history` tables. Keys such as BOC-12 and UAS-4 are generated automatically. Developers can only see and raise tickets on their own board; BDIH and BOCRA see both.

Views: `v_activities`, `v_deliverables`, `v_review_timers`, `v_weekly_status`, `v_invoices`, `v_document_bank` and `v_tickets`. All of them run with the caller's rights, so RLS applies.

## Scope note

Invoices were added at BDIH's request. The SRS v0.1 lists contract payments as out of scope, so update the SRS to match. The other open issues are in SRS section 10, including data residency and MFA (FR-AUTH-09, which the prototype does not implement).
