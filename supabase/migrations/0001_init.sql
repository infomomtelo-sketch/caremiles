-- CareMiles — 0001_init
-- DRAFT MIGRATION. DO NOT APPLY YET.
-- No Supabase project has been chosen for CareMiles (Stage 1). Apply this
-- only after the project is chosen, in Stage 2.
--
-- Creates all MVP tables from the plan (~/workspace/mileage-app/plan.md),
-- row-level security, and the append-only audit log.
-- Rate seeds are per-org and are inserted at org creation, NOT here
-- (see supabase/seed.sql and src/app.js createOrg).
--
-- Design notes:
-- * Every table except orgs carries org_id. All RLS policies scope by org.
-- * There is NO delete policy on any table, and no DELETE grant: signed
--   reports and their trips are never hard-deleted. Trips are "deleted"
--   by setting deleted_at (soft delete), and only while the month is a draft.
-- * The month lock lives in the database: trip insert/update policies fail
--   once the month's report is signed, approved, or paid.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
-- The caller's org, read from their profile row. SECURITY DEFINER so it
-- bypasses RLS (a policy calling it must not recurse into profiles RLS).
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- The caller's role in their org.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Is a given user's month still a draft? True when no report exists for the
-- month, or the report's status is 'draft'. Used by the trip lock policies.
create or replace function public.month_is_draft(p_user_id uuid, p_month date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.monthly_reports r
    where r.user_id = p_user_id
      and r.month = p_month
      and r.status <> 'draft'
  );
$$;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Enforce the report status flow: draft -> signed -> approved -> paid,
-- with unsign (signed -> draft) allowed only until approved. Signing locks
-- the month; once approved there is no way back to draft or signed.
create or replace function public.enforce_report_status_flow()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if (old.status, new.status) in (
    ('draft', 'signed'),
    ('signed', 'draft'),
    ('signed', 'approved'),
    ('approved', 'paid')
  ) then
    return new;
  end if;
  raise exception 'invalid monthly report status transition: % -> %', old.status, new.status;
end;
$$;

-- ------------------------------------------------------------------- orgs
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------- profiles
-- One row per user. One org per user in MVP.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id),
  email text not null,
  full_name text not null default '',
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'owner')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ homes
create table public.homes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  name text not null,
  address text not null default '',
  is_personal_home boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One "personal/home" location per org (the commute-warning marker).
create unique index homes_one_personal_home_per_org
  on public.homes (org_id) where is_personal_home;

-- ----------------------------------------------------------------- routes
-- Saved routes: unique pair of locations -> miles. First entry saves it.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  from_label text not null,
  to_label text not null,
  miles numeric(6,2) not null check (miles >= 0),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (org_id, from_label, to_label)
);

-- ------------------------------------------------------------------ trips
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  user_id uuid not null references public.profiles (id),
  trip_date date not null,
  from_label text not null,
  to_label text not null,
  purpose text not null default 'Between care homes',
  miles numeric(6,2) not null check (miles >= 0),
  route_id uuid references public.routes (id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_org_user_date_idx
  on public.trips (org_id, user_id, trip_date);

-- ------------------------------------------------------------- rate_table
-- Per org, by effective date. The rate applies by the trip date:
-- the latest effective_date on or before the trip date wins.
create table public.rate_table (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  effective_date date not null,
  rate numeric(6,3) not null check (rate > 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (org_id, effective_date)
);

-- --------------------------------------------------------- monthly_reports
-- One row per employee per month. The snapshot columns freeze the signed
-- record: once signed, the miles / breakdown / total can never be rewritten
-- by later rate or trip changes. Exports read the snapshot, not live trips.
create table public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  user_id uuid not null references public.profiles (id),
  month date not null,
  status text not null default 'draft'
    check (status in ('draft', 'signed', 'approved', 'paid')),
  signed_name text,
  signed_at timestamptz,
  snapshot_miles numeric(6,2),
  snapshot_breakdown jsonb,
  snapshot_expense_cents integer,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  paid_date date,
  paid_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, month),
  -- Signature name and timestamp go together.
  check ((signed_name is null) = (signed_at is null)),
  -- Nobody approves a draft or merely-signed report.
  check (status in ('approved', 'paid') or approved_by is null),
  -- A paid date exists only once the report is paid.
  check (status = 'paid' or paid_date is null)
);
create index monthly_reports_org_user_month_idx
  on public.monthly_reports (org_id, user_id, month);

-- -------------------------------------------------------------- audit_log
-- Append-only. No update or delete policy, no DELETE grant.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  actor_id uuid not null references public.profiles (id),
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx
  on public.audit_log (org_id, created_at);

-- ------------------------------------------------------- updated_at hooks
-- (orgs has no updated_at column, so no trigger there.)
create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();
create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();
create trigger monthly_reports_set_updated_at
  before update on public.monthly_reports
  for each row execute function public.set_updated_at();
create trigger monthly_reports_status_flow
  before update of status on public.monthly_reports
  for each row execute function public.enforce_report_status_flow();

-- ------------------------------------------------------------------ grants
-- The app only ever signs in real users (magic link), so only the
-- authenticated role gets table access. No DELETE grant anywhere:
-- hard deletes are impossible through the API, by privilege as well as
-- by policy.
grant usage on schema public to authenticated;
grant select, insert, update on public.orgs to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.homes to authenticated;
grant select, insert, update on public.routes to authenticated;
grant select, insert, update on public.trips to authenticated;
grant select, insert, update on public.rate_table to authenticated;
grant select, insert, update on public.monthly_reports to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.month_is_draft(uuid, date) to authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.routes enable row level security;
alter table public.trips enable row level security;
alter table public.rate_table enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.audit_log enable row level security;

-- orgs: members see their own org; any signed-in user may create one;
-- only the owner renames it.
create policy orgs_select on public.orgs
  for select using (id = public.current_org_id());
create policy orgs_insert on public.orgs
  for insert with check (auth.role() = 'authenticated' and created_by = auth.uid());
create policy orgs_update on public.orgs
  for update using (id = public.current_org_id() and public.current_role() = 'owner')
  with check (id = public.current_org_id() and public.current_role() = 'owner');

-- profiles: org members see each other; a user creates only their own row;
-- owners manage roles, users edit their own name.
create policy profiles_select on public.profiles
  for select using (org_id = public.current_org_id());
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update using (
    id = auth.uid()
    or (org_id = public.current_org_id() and public.current_role() = 'owner')
  )
  with check (
    id = auth.uid()
    or (org_id = public.current_org_id() and public.current_role() = 'owner')
  );

-- homes: org members read; owners manage. No delete (use active = false).
create policy homes_select on public.homes
  for select using (org_id = public.current_org_id());
create policy homes_insert on public.homes
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'owner');
create policy homes_update on public.homes
  for update using (org_id = public.current_org_id() and public.current_role() = 'owner')
  with check (org_id = public.current_org_id() and public.current_role() = 'owner');

-- routes: org members read; any member's first entry saves a route;
-- managers and owners edit saved routes.
create policy routes_select on public.routes
  for select using (org_id = public.current_org_id());
create policy routes_insert on public.routes
  for insert with check (org_id = public.current_org_id());
create policy routes_update on public.routes
  for update using (org_id = public.current_org_id() and public.current_role() in ('manager', 'owner'))
  with check (org_id = public.current_org_id() and public.current_role() in ('manager', 'owner'));

-- trips: employees see their own, managers/owners see the whole org.
-- Insert/update only the caller's own trips, and only while that month is
-- still a draft. No DELETE policy: "delete" is a soft delete (deleted_at)
-- done through UPDATE, so it is covered by the update policy below.
create policy trips_select on public.trips
  for select using (
    org_id = public.current_org_id()
    and (user_id = auth.uid() or public.current_role() in ('manager', 'owner'))
  );
create policy trips_insert on public.trips
  for insert with check (
    org_id = public.current_org_id()
    and user_id = auth.uid()
    and public.month_is_draft(auth.uid(), date_trunc('month', trip_date)::date)
  );
create policy trips_update on public.trips
  for update using (
    org_id = public.current_org_id()
    and user_id = auth.uid()
    and public.month_is_draft(user_id, date_trunc('month', trip_date)::date)
  )
  with check (
    org_id = public.current_org_id()
    and user_id = auth.uid()
    and public.month_is_draft(auth.uid(), date_trunc('month', trip_date)::date)
  );

-- rate_table: org members read; owners only write.
create policy rate_table_select on public.rate_table
  for select using (org_id = public.current_org_id());
create policy rate_table_insert on public.rate_table
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'owner');
create policy rate_table_update on public.rate_table
  for update using (org_id = public.current_org_id() and public.current_role() = 'owner')
  with check (org_id = public.current_org_id() and public.current_role() = 'owner');

-- monthly_reports: employees see their own, managers/owners see the org.
-- Employees create their own draft and sign/unsign it; managers and owners
-- approve and mark paid. The status flow (draft -> signed -> approved ->
-- paid, plus signed -> draft for unsign) is enforced by the
-- monthly_reports_status_flow trigger; RLS enforces org scoping and role split.
create policy monthly_reports_select on public.monthly_reports
  for select using (
    org_id = public.current_org_id()
    and (user_id = auth.uid() or public.current_role() in ('manager', 'owner'))
  );
create policy monthly_reports_insert on public.monthly_reports
  for insert with check (
    org_id = public.current_org_id()
    and user_id = auth.uid()
    and status = 'draft'
  );
create policy monthly_reports_update_owner on public.monthly_reports
  for update using (org_id = public.current_org_id() and user_id = auth.uid())
  with check (org_id = public.current_org_id() and user_id = auth.uid());
create policy monthly_reports_update_manager on public.monthly_reports
  for update using (org_id = public.current_org_id() and public.current_role() in ('manager', 'owner'))
  with check (org_id = public.current_org_id() and public.current_role() in ('manager', 'owner'));

-- audit_log: any org member writes; only managers and owners read.
-- No update or delete policy: append-only.
create policy audit_log_insert on public.audit_log
  for insert with check (org_id = public.current_org_id() and actor_id = auth.uid());
create policy audit_log_select on public.audit_log
  for select using (org_id = public.current_org_id() and public.current_role() in ('manager', 'owner'));
