// CareMiles — Setup tab (Stage 3).
// Homes, users + roles, rate table, organization code.
//
// RLS is the enforcement, and writes here are owner-only in the database:
//   homes insert/update ............ owner only
//   caremiles_profiles update ...... own row, or owner (role changes)
//   rate_table insert/update ....... owner only
// The UI hides those controls from everyone else and says so plainly
// instead of letting the database fail silently. Everyone in the org
// can read all three lists.
//
// The profile table is public.caremiles_profiles. The Judgy project
// already has a public.profiles table — do not touch it, and do not
// confuse the two.
//
// New users join by signing in with a magic link, then entering the
// organization code (shown below) on their first sign-in. Their role
// starts as employee; the owner changes it here. There is no
// invite-email flow: Supabase sends the magic link when the user asks
// for one, and the owner shares the code out of band.
//
// Nothing here touches Title22, Tello, or any other app.

import { supabase, currentProfile, currentOrg } from './supabase.js';

const $ = (id) => document.getElementById(id);

let profile = null;
let org = null;
let homes = [];
let users = [];
let rates = [];
let editingHomeId = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setNotice(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle('error', isError);
}

function isOwner() {
  return profile !== null && profile.role === 'owner';
}

function money(rate) {
  return `$${Number(rate).toFixed(3)}`;
}

// ------------------------------------------------------------ org card
function renderOrgCard() {
  const line = $('setup-org-line');
  if (line && org && profile) {
    line.textContent = `${org.name} — signed in as ${profile.full_name || profile.email} (${profile.role}).`;
  }
  const code = $('setup-org-code');
  if (code && org) code.value = org.id;
}

// ------------------------------------------------------------ homes
async function loadHomes() {
  const { data, error } = await supabase
    .from('homes')
    .select('id, name, address, is_personal_home, active')
    .eq('org_id', org.id)
    .order('name');
  if (error) throw error;
  homes = data || [];
  renderHomes();
}

function renderHomes() {
  const list = $('homes-list');
  if (!list) return;
  if (homes.length === 0) {
    list.innerHTML = '<p class="empty">No homes yet. Add the first one below.</p>';
  } else {
    list.innerHTML = homes
      .map(
        (home) => `
      <div class="row${home.active ? '' : ' inactive'}">
        <div class="main">
          <div class="name">${esc(home.name)}${home.is_personal_home ? '<span class="tag gold">Personal / home</span>' : ''}${home.active ? '' : '<span class="tag">Inactive</span>'}</div>
          ${home.address ? `<div class="sub">${esc(home.address)}</div>` : ''}
        </div>
        ${isOwner() ? `<button type="button" class="secondary small" data-edit-home="${esc(home.id)}">Edit</button>` : ''}
      </div>`,
      )
      .join('');
  }
  const addForm = $('home-add-form');
  const roleNote = $('homes-role-note');
  if (addForm) addForm.hidden = !isOwner();
  if (roleNote) {
    roleNote.hidden = isOwner();
    if (!isOwner()) {
      roleNote.textContent = `Only the organization owner can add or edit homes. You are signed in as ${profile.role}.`;
    }
  }
}

function fillHomeEditForm(home) {
  editingHomeId = home.id;
  $('home-edit-name').value = home.name;
  $('home-edit-address').value = home.address || '';
  $('home-edit-personal').checked = !!home.is_personal_home;
  $('home-edit-active').checked = !!home.active;
  $('home-edit-form').hidden = false;
  $('home-edit-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideHomeEditForm() {
  editingHomeId = null;
  const form = $('home-edit-form');
  if (form) form.hidden = true;
}

// One personal/home location per org (unique index). Clear the flag on
// every other home before setting it on this one.
async function clearOtherPersonalHomes(exceptId) {
  let query = supabase
    .from('homes')
    .update({ is_personal_home: false })
    .eq('org_id', org.id)
    .eq('is_personal_home', true);
  if (exceptId) query = query.neq('id', exceptId);
  const { error } = await query;
  if (error) throw error;
}

async function saveHomeAdd(event) {
  event.preventDefault();
  const notice = $('homes-notice');
  const name = $('home-add-name').value.trim();
  const address = $('home-add-address').value.trim();
  const personal = $('home-add-personal').checked;
  if (!name) return;
  const button = $('home-add-submit');
  button.disabled = true;
  setNotice(notice, 'Saving…');
  try {
    // Insert as not-personal first, so a failed insert never disturbs
    // the existing personal/home marker.
    const { data, error } = await supabase
      .from('homes')
      .insert({ org_id: org.id, name, address, is_personal_home: false })
      .select('id')
      .single();
    if (error) throw error;
    if (personal) {
      await clearOtherPersonalHomes(data.id);
      const { error: markError } = await supabase
        .from('homes')
        .update({ is_personal_home: true })
        .eq('id', data.id);
      if (markError) throw markError;
    }
    $('home-add-form').reset();
    setNotice(notice, 'Home added.');
    await loadHomes();
  } catch (err) {
    setNotice(notice, `Could not add the home: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function saveHomeEdit(event) {
  event.preventDefault();
  const notice = $('homes-notice');
  const name = $('home-edit-name').value.trim();
  const address = $('home-edit-address').value.trim();
  const personal = $('home-edit-personal').checked;
  const active = $('home-edit-active').checked;
  if (!name || !editingHomeId) return;
  const button = $('home-edit-submit');
  button.disabled = true;
  setNotice(notice, 'Saving…');
  try {
    if (personal) await clearOtherPersonalHomes(editingHomeId);
    const { error } = await supabase
      .from('homes')
      .update({ name, address, is_personal_home: personal, active })
      .eq('id', editingHomeId);
    if (error) throw error;
    hideHomeEditForm();
    setNotice(notice, 'Home updated.');
    await loadHomes();
  } catch (err) {
    setNotice(notice, `Could not update the home: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------ users
async function loadUsers() {
  const { data, error } = await supabase
    .from('caremiles_profiles')
    .select('id, full_name, email, role, created_at')
    .eq('org_id', org.id)
    .order('created_at');
  if (error) throw error;
  users = data || [];
  renderUsers();
}

function renderUsers() {
  const list = $('users-list');
  if (!list) return;
  if (users.length === 0) {
    list.innerHTML = '<p class="empty">No users yet.</p>';
    return;
  }
  list.innerHTML = users
    .map((user) => {
      const isMe = profile !== null && user.id === profile.id;
      const roleControl =
        isOwner() && !isMe
          ? `<select class="role" data-user-id="${esc(user.id)}" aria-label="Role for ${esc(user.full_name || user.email)}">
          ${['employee', 'manager', 'owner']
            .map(
              (role) =>
                `<option value="${role}"${role === user.role ? ' selected' : ''}>${role}</option>`,
            )
            .join('')}
        </select>`
          : `<span class="sub">${esc(user.role)}</span>`;
      return `
      <div class="row">
        <div class="main">
          <div class="name">${esc(user.full_name || user.email)}${isMe ? '<span class="tag">You</span>' : ''}</div>
          <div class="sub">${esc(user.email)}</div>
          ${
            isOwner() && isMe
              ? '<div class="sub">Your role can’t be changed here — the organization always needs its owner.</div>'
              : ''
          }
        </div>
        ${roleControl}
      </div>`;
    })
    .join('');
}

async function changeRole(userId, newRole, select) {
  const notice = $('users-notice');
  const previous = users.find((u) => u.id === userId);
  const previousRole = previous ? previous.role : null;
  try {
    const { error } = await supabase
      .from('caremiles_profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) throw error;
    setNotice(notice, 'Role updated.');
    await loadUsers();
  } catch (err) {
    if (select && previousRole) select.value = previousRole;
    setNotice(notice, `Could not change the role: ${err.message}`, true);
  }
}

// ------------------------------------------------------------ rates
async function loadRates() {
  const { data, error } = await supabase
    .from('rate_table')
    .select('id, effective_date, rate, created_at')
    .eq('org_id', org.id)
    .order('effective_date', { ascending: false });
  if (error) throw error;
  rates = data || [];
  renderRates();
}

function renderRates() {
  const list = $('rates-list');
  if (!list) return;
  if (rates.length === 0) {
    list.innerHTML = '<p class="empty">No rates yet.</p>';
  } else {
    list.innerHTML = rates
      .map(
        (row) => `
      <div class="row">
        <div class="main">
          <div class="name">${money(row.rate)} <span class="sub">per mile</span></div>
          <div class="sub">From ${esc(row.effective_date)}</div>
        </div>
      </div>`,
      )
      .join('');
  }
  const addForm = $('rate-add-form');
  const roleNote = $('rates-role-note');
  if (addForm) addForm.hidden = !isOwner();
  if (roleNote) {
    roleNote.hidden = isOwner();
    if (!isOwner()) {
      roleNote.textContent = `Only the organization owner can add rates. You are signed in as ${profile.role}.`;
    }
  }
}

async function saveRateAdd(event) {
  event.preventDefault();
  const notice = $('rates-notice');
  const date = $('rate-add-date').value;
  const rateValue = Number($('rate-add-rate').value);
  if (!date || !(rateValue > 0)) {
    setNotice(notice, 'Enter an effective date and a rate above zero.', true);
    return;
  }
  const button = $('rate-add-submit');
  button.disabled = true;
  setNotice(notice, 'Saving…');
  try {
    const { error } = await supabase.from('rate_table').insert({
      org_id: org.id,
      effective_date: date,
      rate: rateValue,
      created_by: profile.id,
    });
    if (error) throw error;
    $('rate-add-form').reset();
    setNotice(notice, 'Rate added.');
    await loadRates();
  } catch (err) {
    const duplicate = /duplicate|unique|23505/i.test(err.message);
    setNotice(
      notice,
      duplicate
        ? 'A rate already exists for that date. Rates are history — pick a different effective date.'
        : `Could not add the rate: ${err.message}`,
      true,
    );
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------ org code
function initCopyCode() {
  const button = $('setup-copy-code');
  if (!button) return;
  button.addEventListener('click', async () => {
    const input = $('setup-org-code');
    if (!input || !input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (err) {
      input.select();
      document.execCommand('copy');
    }
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 2000);
  });
}

// ------------------------------------------------------------ boot
export function initSetup() {
  const addForm = $('home-add-form');
  if (addForm) addForm.addEventListener('submit', saveHomeAdd);
  const editForm = $('home-edit-form');
  if (editForm) {
    editForm.addEventListener('submit', saveHomeEdit);
    const cancel = $('home-edit-cancel');
    if (cancel) cancel.addEventListener('click', hideHomeEditForm);
  }
  const rateForm = $('rate-add-form');
  if (rateForm) rateForm.addEventListener('submit', saveRateAdd);
  const homesList = $('homes-list');
  if (homesList) {
    homesList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-edit-home]');
      if (!button) return;
      const home = homes.find((h) => h.id === button.dataset.editHome);
      if (home) fillHomeEditForm(home);
    });
  }
  const usersList = $('users-list');
  if (usersList) {
    usersList.addEventListener('change', (event) => {
      const select = event.target.closest('select[data-user-id]');
      if (!select) return;
      changeRole(select.dataset.userId, select.value, select);
    });
  }
  initCopyCode();
}

export async function renderSetup() {
  if (!supabase) return;
  const panel = $('panel-setup');
  if (!panel) return;
  try {
    profile = await currentProfile();
    org = await currentOrg();
  } catch (err) {
    setNotice(
      $('setup-notice'),
      `Could not load Setup: ${err.message}`,
      true,
    );
    return;
  }
  if (!profile || !org) {
    setNotice(
      $('setup-notice'),
      'Sign in and create or join an organization first.',
      true,
    );
    return;
  }
  setNotice($('setup-notice'), '');
  renderOrgCard();
  const sections = [
    [loadHomes, 'homes-notice', 'homes'],
    [loadUsers, 'users-notice', 'users'],
    [loadRates, 'rates-notice', 'rates'],
  ];
  for (const [loader, noticeId, label] of sections) {
    try {
      await loader();
    } catch (err) {
      setNotice($(noticeId), `Could not load ${label}: ${err.message}`, true);
    }
  }
}
