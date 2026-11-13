// CareMiles — app shell wiring (Stages 1–3).
// Tab router (Log trip / Report / Setup) + auth view + first-run org
// creation / joining. Setup tab logic lives in src/setup.js.
//   Setup tab   -> Stage 3 DONE (homes, users, rates, org code)
//   Log trip    -> Stage 4 (trip form, route auto-fill, month list)
//   Report tab  -> Stage 5 (totals, signature, locking)
// Approval + payment is Stage 6, export is Stage 7.
//
// Nothing here touches Title22, Tello, or any other app.

import { supabase, isConfigured, currentProfile, currentOrg } from './supabase.js';
import { getSession, signInWithEmail, signOut, onAuthChange } from './auth.js';
import { initSetup, renderSetup } from './setup.js';

const $ = (id) => document.getElementById(id);

const views = {
  config: $('view-config'),
  auth: $('view-auth'),
  orgSetup: $('view-org-setup'),
  app: $('view-app'),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    if (el) el.hidden = key !== name;
  }
}

function setNotice(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle('error', isError);
}

// ------------------------------------------------------------ tab router
const TABS = ['log', 'report', 'setup'];

function showTab(name) {
  if (!TABS.includes(name)) name = 'log';
  for (const tab of TABS) {
    const button = document.querySelector(`[data-tab="${tab}"]`);
    const panel = $(`panel-${tab}`);
    const active = tab === name;
    if (button) button.setAttribute('aria-selected', String(active));
    if (panel) panel.hidden = !active;
  }
  window.location.hash = `tab=${name}`;
  // Setup data is reloaded every time the tab is opened, so the lists
  // are never stale. Skipped before sign-in (the app view is hidden).
  if (name === 'setup' && views.app && !views.app.hidden) {
    renderSetup();
  }
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  });
  const match = window.location.hash.match(/tab=(log|report|setup)/);
  showTab(match ? match[1] : 'log');
}

// --------------------------------------------------------- org creation
// First run: a signed-in owner with no profile/org creates the org, their
// owner profile, and the two seeded IRS rates (2026-01-01 $0.725,
// 2026-07-01 $0.76). RLS policies allow exactly this sequence:
// orgs insert (any authenticated user) -> caremiles_profiles insert (own row) ->
// rate_table insert (owner role, once the profile exists).
async function createOrg(orgName, fullName, user) {
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .insert({ name: orgName, created_by: user.id })
    .select('id')
    .single();
  if (orgError) throw orgError;

  const { error: profileError } = await supabase.from('caremiles_profiles').insert({
    id: user.id,
    org_id: org.id,
    email: user.email,
    full_name: fullName,
    role: 'owner',
  });
  if (profileError) throw profileError;

  const { error: rateError } = await supabase.from('rate_table').insert([
    { org_id: org.id, effective_date: '2026-01-01', rate: 0.725, created_by: user.id },
    { org_id: org.id, effective_date: '2026-07-01', rate: 0.76, created_by: user.id },
  ]);
  if (rateError) throw rateError;

  return org;
}

// ------------------------------------------------------------ org joining
// A new user who belongs to an existing org: they sign in with a magic
// link, then enter the organization code the owner shared. Their profile
// row is their own row (RLS allows a user to insert only their own row),
// so the owner cannot create it for them — the user creates it here, and
// the owner sets their role in Setup. Role starts as employee.
async function joinOrg(orgCode, fullName, user) {
  const { error } = await supabase.from('caremiles_profiles').insert({
    id: user.id,
    org_id: orgCode,
    email: user.email,
    full_name: fullName,
    role: 'employee',
  });
  if (error) throw error;
}

// ------------------------------------------------------------------ boot
async function boot() {
  initTabs();

  // No Supabase project yet: the shell loads, sign-in stays off, and the
  // page says plainly what is missing. (Stage 2 connected the project;
  // this branch only fires if the config is ever removed again.)
  if (!isConfigured()) {
    showView('config');
    return;
  }

  const session = await getSession();
  if (!session) {
    showView('auth');
    return;
  }
  await enterApp(session.user);
}

async function enterApp(user) {
  let profile = null;
  let org = null;
  try {
    profile = await currentProfile();
    org = await currentOrg();
  } catch (err) {
    // Tables do not exist until the migration is applied (Stage 2).
    setNotice(
      $('org-setup-notice'),
      'Signed in, but the database tables are not there yet. Apply supabase/migrations/0001_init.sql first (Stage 2).',
      true,
    );
    showView('orgSetup');
    return;
  }

  if (!profile || !org) {
    // First run: create the org, or join an existing one.
    showView('orgSetup');
    const nameInput = $('org-name');
    if (nameInput && user.email) nameInput.focus();
    return;
  }

  const orgName = $('org-name-display');
  if (orgName) orgName.textContent = org.name;
  const userLine = $('user-line');
  if (userLine) {
    userLine.textContent = `${profile.full_name || profile.email} · ${profile.role}`;
  }
  showView('app');
  renderSetup();
}

function initAuthForm() {
  const form = $('auth-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('auth-email').value.trim();
    const button = $('auth-submit');
    const notice = $('auth-notice');
    if (!email) return;
    button.disabled = true;
    setNotice(notice, 'Sending your sign-in link…');
    try {
      await signInWithEmail(email);
      setNotice(notice, 'Check your email — your sign-in link is on its way.');
    } catch (err) {
      setNotice(notice, `Could not send the link: ${err.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
}

function initOrgForm() {
  const form = $('org-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const orgName = $('org-name').value.trim();
    const fullName = $('owner-name').value.trim();
    const button = $('org-submit');
    const notice = $('org-setup-notice');
    if (!orgName || !fullName) return;
    button.disabled = true;
    setNotice(notice, 'Creating your organization…');
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You are signed out. Sign in again.');
      await createOrg(orgName, fullName, user);
      setNotice(notice, '');
      await enterApp(user);
    } catch (err) {
      setNotice(notice, `Could not create the organization: ${err.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
}

function initJoinForm() {
  const form = $('join-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const orgCode = $('join-code').value.trim();
    const fullName = $('join-name').value.trim();
    const button = $('join-submit');
    const notice = $('join-notice');
    if (!orgCode || !fullName) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgCode)) {
      setNotice(
        notice,
        'That does not look like an organization code — it should be the code the owner shared with you.',
        true,
      );
      return;
    }
    button.disabled = true;
    setNotice(notice, 'Joining…');
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You are signed out. Sign in again.');
      await joinOrg(orgCode, fullName, user);
      setNotice(notice, '');
      await enterApp(user);
    } catch (err) {
      const notFound = /foreign key|violates|23503/i.test(err.message);
      setNotice(
        notice,
        notFound
          ? 'That organization code was not found. Check it with the owner and try again.'
          : `Could not join: ${err.message}`,
        true,
      );
    } finally {
      button.disabled = false;
    }
  });
}

function initSignOut() {
  const button = $('sign-out');
  if (!button) return;
  button.addEventListener('click', async () => {
    await signOut();
    showView('auth');
  });
}

initAuthForm();
initOrgForm();
initJoinForm();
initSignOut();
initSetup();
onAuthChange((session) => {
  if (session) enterApp(session.user);
  else showView('auth');
});

boot().catch((err) => {
  const notice = $('auth-notice') || $('org-setup-notice');
  setNotice(notice, `Something went wrong starting the app: ${err.message}`, true);
  showView('auth');
});
