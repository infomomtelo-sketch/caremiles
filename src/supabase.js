// CareMiles — Supabase client.
//
// Project: dmemzljerldzeiwqfxzp (TheJudgy's project, per Eli's decision
// 2026-11-13 — a new project needs a paid Supabase subscription).
// The anon key below is the publishable client key (Project Settings >
// API). Do NOT paste the service-role key here — the browser must only
// ever use the anon key. Row-level security enforces all access.
//
//   SUPABASE_URL:      https://dmemzljerldzeiwqfxzp.supabase.co
//   SUPABASE_ANON_KEY: <anon / publishable key>
//
// Until these are set, the app shell loads and explains what is missing;
// sign-in and org creation stay disabled.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://dmemzljerldzeiwqfxzp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtZW16bGplcmxkemVpd3FmeHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NDMxNzgsImV4cCI6MjA5NDIxOTE3OH0.u4FL1mk555dUesVNjF58pXwkQlvvQYQgR5JpcxRtB40';

export function isConfigured() {
  return (
    typeof SUPABASE_URL === 'string' &&
    SUPABASE_URL.startsWith('https://') &&
    SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY' &&
    SUPABASE_ANON_KEY.length > 20
  );
}

// Null until Supabase is configured. Every caller must check isConfigured()
// (or a null supabase) before using it.
export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// The signed-in user's profile row (org + role), or null when there is
// no session or no profile yet (fresh sign-in before org creation).
export async function currentProfile() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('caremiles_profiles')
    .select('id, org_id, email, full_name, role')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The caller's org row, or null when they have no profile/org yet.
export async function currentOrg() {
  const profile = await currentProfile();
  if (!profile || !profile.org_id) return null;
  const { data, error } = await supabase
    .from('orgs')
    .select('id, name')
    .eq('id', profile.org_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
