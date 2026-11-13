-- CareMiles — rate seeds
-- Applied PER ORG at org creation (see src/app.js createOrg), NOT at
-- migration time. The rate table is org-scoped, so there is no global seed.
--
-- Run with psql if ever seeding by hand:
--   psql -v org_id='<org uuid>' -v created_by='<owner uuid>' -f seed.sql
--
-- 2026-01-01 = $0.725, 2026-07-01 = $0.76 (IRS business rate).
-- Rates are never hardcoded in the app; the rate applies by trip date.

insert into public.rate_table (org_id, effective_date, rate, created_by)
values
  (:'org_id', '2026-01-01', 0.725, :'created_by'),
  (:'org_id', '2026-07-01', 0.760, :'created_by')
on conflict (org_id, effective_date) do nothing;
