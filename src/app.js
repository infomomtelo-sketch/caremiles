// CareMiles — app shell wiring (Stage 1).
// Tab router (Log trip / Report / Setup) + auth view + first-run org
// creation. The three tabs are placeholders until their stages land:
//   Setup tab   -> Stage 3 (homes, users, rates, routes)
//   Log trip    -> Stage 4 (trip form, route auto-fill, month list)
//   Report tab  -> Stage 5 (totals, signature, locking)
// Approval + payment is Stage 6, export is Stage 7.
//
// Nothing here touches Title22, Tello, or any other app.

import { supabase, isConfigured, currentProfile, currentOrg } from './supabase.js';
import { getSession, signInWithEmail, signOut, onAuthChange } from './auth.js';

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

// ------------------------------------------------------------------ boot
async function boot() {
  initTabs();

  // No Supabase project yet: the shell loads, sign-in stays off, and the
  // page says plainly what is missing. This is expected in Stage 1.
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
    // First run: create the org.
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
initSignOut();
onAuthChange((session) => {
  if (session) enterApp(session.user);
  else showView('auth');
});

boot().catch((err) => {
  const notice = $('auth-notice') || $('org-setup-notice');
  setNotice(notice, `Something went wrong starting the app: ${err.message}`, true);
  showView('auth');
});
