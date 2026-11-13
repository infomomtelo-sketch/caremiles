# CareMiles

Mileage reimbursement for multi-home care operators.

CareMiles keeps the mileage log: employees log trips between care homes,
the app totals the miles at the rate in effect on each trip's date, the
employee signs the month, a manager approves it, and payroll gets a PDF
and a CSV. Built for operators whose staff drive between homes every day.

## Status — Stage 1 (scaffold)

- Repo, Cloudflare Pages shell, magic-link sign-in, org creation.
- **Not yet done:** no Supabase project is connected, so sign-in and org
  creation cannot run yet. The app shell loads and says so plainly.
- Next stages: schema (Stage 2), Setup tab (3), Log trip (4), Report (5),
  approval + payment (6), export (7), real-data test (8).

See `docs/plan.md` for the full plan: data model, RLS approach, screens,
file list, and open questions.

## Stack

- Cloudflare Pages + Functions (mobile-first web, vanilla JS, no framework)
- Supabase (email magic-link auth + Postgres with row-level security)
- No PHI, no resident data. The app stores business locations, trip
  purposes, and miles only.

## Configure Supabase (needed before Stage 2)

1. Choose or create the Supabase project (decision still with the owner).
2. Apply `supabase/migrations/0001_init.sql` in the SQL editor.
3. In `src/supabase.js`, replace `YOUR_SUPABASE_URL` and
   `YOUR_SUPABASE_ANON_KEY` with the project's URL and anon key
   (Project Settings > API). Never paste the service-role key here.
4. Sign in with a magic link. The first sign-in creates the organization;
   the 2026 IRS rates ($0.725 from Jan 1, $0.76 from Jul 1) seed
   automatically.

## Deploy

Direct upload to Cloudflare Pages (no build step — the app is static
files plus Supabase):

```text
# Create the Pages project once:
# POST /accounts/<account>/pages/projects  {"name": "caremiles", "production_branch": "main"}
# Then upload the public/ directory as a deployment.
```

## Legal note

CareMiles is a record-keeping tool, not legal advice. In California,
employers must reimburse necessary business mileage (Labor Code 2802).
Rates live in an org-level table by effective date and are never
hardcoded. Signed months are locked and never hard-deleted; records are
kept at least 3 years.
