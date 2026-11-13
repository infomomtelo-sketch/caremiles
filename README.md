# CareMiles

Mileage reimbursement for multi-home care operators.

CareMiles keeps the mileage log: employees log trips between care homes,
the app totals the miles at the rate in effect on each trip's date, the
employee signs the month, a manager approves it, and payroll gets a PDF
and a CSV. Built for operators whose staff drive between homes every day.

## Status — Stage 3 (Setup) done

- Repo, Cloudflare Pages shell, magic-link sign-in, org creation.
- Supabase connected (project dmemzljerldzeiwqfxzp — TheJudgy's project,
  shared; CareMiles tables live there, Judgy tables untouched). Migration
  applied; URL + anon key in `src/supabase.js`.
- Setup tab live: homes (add / edit / deactivate, one personal/home
  marker), users and roles (owner sets roles; new users join with the
  organization code), rate table (owner adds rates; past rates are
  history and can't change).
- **Not yet done:** Log trip (Stage 4), Report (5), approval + payment
  (6), export (7), real-data test (8).

See `docs/plan.md` for the full plan: data model, RLS approach, screens,
file list, and open questions.

## Stack

- Cloudflare Pages + Functions (mobile-first web, vanilla JS, no framework)
- Supabase (email magic-link auth + Postgres with row-level security)
- No PHI, no resident data. The app stores business locations, trip
  purposes, and miles only.

## Configure Supabase (done — Stage 2)

1. Project chosen: dmemzljerldzeiwqfxzp (TheJudgy's project).
2. `supabase/migrations/0001_init.sql` applied in that project's SQL
   editor (v3 — CareMiles' profile table is `caremiles_profiles`, because
   the Judgy project already has a `profiles` table).
3. `src/supabase.js` carries the project's URL and anon key
   (Project Settings > API). Never paste the service-role key here.
4. Sign in with a magic link. The first sign-in creates the organization;
   the 2026 IRS rates ($0.725 from Jan 1, $0.76 from Jul 1) seed
   automatically. Later users join with the organization code from Setup.

## Deploy

Direct upload to Cloudflare Pages (no build step — the app is static
files plus Supabase). The deploy wrapper builds a staging tree first
(public files + src/*.js at the site root) because index.html loads
`./src/app.js`:

```text
python3 ~/workspace/mileage-app/caremiles-wrangler-deploy.py
```

## Legal note

CareMiles is a record-keeping tool, not legal advice. In California,
employers must reimburse necessary business mileage (Labor Code 2802).
Rates live in an org-level table by effective date and are never
hardcoded. Signed months are locked and never hard-deleted; records are
kept at least 3 years.
