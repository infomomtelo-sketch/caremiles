# Mileage Reimbursement SaaS — Plan (Stage 0)

**For:** multi-home care operators. First user: Eli's wife, a certified care-home administrator who travels every day to and from 10 homes. Same need as every multi-home operator.
**Status:** PLAN ONLY. No code written. No repo created. No tables created. Waiting for Eli's yes.
**Rules for this build:** NEW, SEPARATE repo/app. Do NOT touch Title22, Tello/tello.live, or staff.tello.live. Build in small stages, confirm each one. Full-file replacements, not patches. Strictly the MVP scope below — no added features, integrations, or assumptions.

## Repo state check

There is no repo for this yet. Nothing exists to check — the repo, the Cloudflare Pages project, and the Supabase project are all to be created, in that order, after this plan is approved. (Open question 1 and 2 below.)

## Stack

- **Cloudflare Pages + Functions** (mobile-first web app)
- **Supabase** (email magic-link auth + Postgres with RLS)
- **No PHI, no resident data.** The app stores only business locations (home names/addresses), trip purposes, and miles.

## Data model

All tables carry `org_id` (except `orgs` itself). All rows are scoped by org. Money is stored as `numeric(6,3)` dollars-per-mile (rates like $0.725 need three decimals); expense totals are rounded to cents at report time.

### `orgs`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. the operator's business name |
| created_by | uuid → auth.users | the owner who created it |
| created_at | timestamptz | |

### `profiles`
One row per user. One org per user in MVP (multi-org later, if ever).

| column | type | notes |
|---|---|---|
| id | uuid PK | = auth.users id |
| org_id | uuid FK → orgs | |
| email | text | |
| full_name | text | shown on reports and signatures |
| role | text | `employee` \| `manager` \| `owner` |
| created_at | timestamptz | |

### `homes`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| name | text | e.g. "House 3 — Lester Ave" |
| address | text | |
| is_personal_home | boolean | marks the "personal/home" location — triggers the commute warning |
| active | boolean | deactivate instead of delete (trips reference homes) |
| created_at | timestamptz | |

### `routes`
Saved routes: a unique pair of locations → miles. First entry saves it; next time it auto-fills.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| from_label | text | home name or typed custom location |
| to_label | text | home name or typed custom location |
| miles | numeric(6,2) | |
| created_by | uuid → profiles | |
| updated_by | uuid → profiles | |
| updated_at | timestamptz | |
| unique | (org_id, from_label, to_label) | one saved miles value per pair |

### `trips`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| user_id | uuid → profiles | the employee who drove |
| trip_date | date | the rate applies by this date |
| from_label | text | home or typed location |
| to_label | text | home or typed location |
| purpose | text | default "Between care homes" |
| miles | numeric(6,2) | auto-filled from routes, editable |
| route_id | uuid FK → routes, nullable | the saved route used, if any |
| deleted_at | timestamptz, nullable | soft delete (never hard-delete once signed — see below) |
| created_at / updated_at | timestamptz | |

**Locking rule:** a trip is editable or deletable only while its month is still a draft. Once the month is signed, trips are locked.

### `rate_table`
Per org, by effective date. The rate applies by the trip date (latest `effective_date` on or before the trip date).

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| effective_date | date | |
| rate | numeric(6,3) | dollars per mile |
| created_by | uuid → profiles | |
| created_at | timestamptz | |
| unique | (org_id, effective_date) | |

**Seeded at org creation:** 2026-01-01 = $0.725, 2026-07-01 = $0.76 (IRS business rate). Admin-editable after that. Never hardcode a rate in the app.

### `monthly_reports`
One row per employee per month. This is the locked, signable record.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| user_id | uuid → profiles | the employee |
| month | date | first day of the month |
| status | text | `draft` → `signed` → `approved` → `paid` |
| signed_name | text, nullable | typed-name e-signature |
| signed_at | timestamptz, nullable | |
| snapshot_miles | numeric, nullable | total miles, frozen at signing |
| snapshot_breakdown | jsonb, nullable | [{rate, miles, amount}] — the mixed-rate breakdown, frozen at signing |
| snapshot_expense_cents | integer, nullable | total expense in cents, rounded, frozen at signing |
| approved_by | uuid → profiles, nullable | manager (or owner) |
| approved_at | timestamptz, nullable | |
| paid_date | date, nullable | |
| paid_method | text, nullable | e.g. check, direct deposit, cash |
| created_at / updated_at | timestamptz | |
| unique | (org_id, user_id, month) | |

**Why the snapshot:** once signed, the record must be unalterable. Freezing the miles, breakdown, and total at signing means later rate or trip changes can never rewrite a signed month. The PDF/CSV export reads the snapshot, not live trips.

**Unsign:** allowed only while status is `signed` (not after `approved`). Unsigning returns the month to `draft` and clears the signature and snapshot.

### `audit_log`
Append-only. No update or delete policy for anyone.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK → orgs | |
| actor_id | uuid → profiles | who did it |
| action | text | `trip.created`, `trip.updated`, `trip.deleted`, `report.signed`, `report.unsigned`, `report.approved`, `report.paid`, `rate.changed`, `route.updated`, … |
| target_type | text | `trip` \| `report` \| `rate` \| `route` |
| target_id | uuid | |
| details | jsonb | what changed |
| created_at | timestamptz | |

## RLS approach

- RLS enabled on every table. Every policy starts from the caller's profile: `org_id = (select org_id from profiles where id = auth.uid())`.
- **Employees:** read/write their own trips and their own reports; read org homes, routes, and rate table. Can insert a trip only while its month is a draft; can update/delete their own trips only while the month is a draft (enforced by a policy check against the month's report status).
- **Managers:** everything employees can do, plus read all trips/reports in the org, approve reports, and edit saved routes.
- **Owners:** everything managers can do, plus edit the rate table, manage homes, and manage users/roles.
- **Rates:** select for all org members; insert/update for owners only.
- **Audit log:** insert for any authenticated org member (the app writes it on every status change); select for managers and owners only.
- **Signed/paid months:** no trip insert/update/delete policy passes once the month is signed — the lock lives in the database, not just the UI.
- **Retention:** signed reports and their trips are never hard-deleted. Records kept at least 3 years (soft-delete only, and no delete path at all for signed data).

## Screens (mobile-first, three tabs — mirrors the reference prototype)

### Tab 1 — Log trip (default)
- Date (defaults to today), From (pick a home or type a location), To (same), Purpose (defaults to "Between care homes"), Miles (auto-fills from the saved route for the pair; editable).
- Save. Below: this month's trips, each editable/deletable while the month is a draft.
- **Commute warning:** if From or To is a location marked "personal/home", show a warning that home-to-first-site travel is normally not reimbursable. Warning only — the final policy is the owner's call.

### Tab 2 — Report
- Month picker. Trip rows with date, from → to, purpose, miles.
- Totals: total miles, mixed-rate breakdown (miles × the rate in effect on each trip's date), total expense = sum(miles × rate), rounded to cents.
- Status badge: draft / signed / approved / paid.
- Signature box: typed name + timestamp. Sign locks the month. Unsign allowed only until approved.
- Manager view: Approve button, then Date paid + Method of payment fields.
- Export: PDF (matching the paper form: employee name, month, trip rows with purpose, total miles, rate, total expense, employee signature, approved by, date paid, method) and CSV for payroll.
- Small notice on the screen and on the export: "This is a record-keeping tool, not legal advice."

### Tab 3 — Setup
- Org name.
- Homes: add / edit / deactivate; mark which location is "personal/home".
- Users and roles: invite by email (magic link), set role (employee / manager / owner).
- Rate table: list of effective dates and rates (seeded, see above), owner-editable.
- Saved routes: list of location pairs and miles; managers can edit.

### Auth screen
- Email magic-link sign-in (Supabase Auth). First run: the owner creates the org, then adds homes.

## File list (new repo)

```
mileage-app/                        (repo name TBD — open question 2)
├── README.md
├── wrangler.toml                   (Pages project + Functions binding)
├── package.json
├── public/
│   └── index.html                  (app shell)
├── src/
│   ├── app.js                      (tab router: Log trip / Report / Setup)
│   ├── auth.js                     (Supabase magic-link sign-in, session)
│   ├── trips.js                    (trip form, route auto-fill, month list)
│   ├── report.js                   (totals, breakdown, signature, approval)
│   ├── setup.js                    (homes, users, rates, routes)
│   └── supabase.js                 (client, org scoping)
├── functions/
│   └── api/
│       ├── reports/[id]/pdf.js     (PDF export from the signed snapshot)
│       └── reports/[id]/csv.js     (CSV export for payroll)
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql           (all tables + RLS + policies + audit)
│   └── seed.sql                    (rate seeds, applied per org at creation)
└── docs/
    └── plan.md                     (this file)
```

Notes:
- The browser talks to Supabase directly with the anon key; RLS is the enforcement. Cloudflare Functions exist only for PDF/CSV export (server-side, using the service key, reading the signed snapshot so the export can never differ from the signed record).
- Full-file replacements at every stage, per the working rules.

## Build stages (confirm each one before the next)

0. **Plan** — this document. Wait for yes.
1. **Repo + hosting + auth** — new GitHub repo, Cloudflare Pages project, Supabase project (open question 1), magic-link sign-in, org creation.
2. **Schema** — migration with all tables + RLS + audit log, rate seeds.
3. **Setup tab** — homes, users/roles, rate table, saved routes.
4. **Log trip tab** — trip form, route auto-fill, month list, commute warning.
5. **Report tab** — totals, mixed-rate breakdown, signature + locking, unsign.
6. **Approval + payment** — manager approval, date paid, method, status flow.
7. **Export** — PDF + CSV from the signed snapshot.
8. **Real-data test** — his wife's 10 homes, a full month walked end to end, then handover.

## Open questions (need Eli's answers before building)

1. **Which Supabase project?** New project, or an existing one? (Per your rule: ask before creating any tables.)
2. **Product name and repo name?** Candidates, pick one or give your own: CareMiles, HomeMiles, RoutePay, Mileage. (No name is decided.)
3. **The org:** what is your wife's organisation called for the app, and will you give me the 10 homes (names + addresses) at setup, or enter them yourself?
4. **Who approves whose report?** She is the owner/admin — who approves *her* monthly report? (Options: she approves her own as owner, or a named manager approves it.) The approval chain needs one named approver per employee.
5. **Home-to-first-site policy:** warn only, or block the trip from being saved? Default is warn only — your call as owner.
6. **The paper form:** do you have a paper mileage form the PDF must match, or should I draft the layout from the listed fields (employee name, month, trip rows with purpose, total miles, rate, total expense, signature, approved by, date paid, method)?
7. **Magic-link email:** is Supabase's default sender fine, or do you want it sent from your own domain?
8. **Reference prototype:** I could not open the link — claude.ai requires a sign-in. The plan above copies the described behaviour (Log trip / Report / Setup tabs, localStorage-only logic → Supabase instead). If any screen behaves differently from what I have described, send me a screenshot of that tab and I will match it exactly.

## Out of scope (not in this build)

GPS tracking, Maps API, payments, payroll integration, AI features, native app.
