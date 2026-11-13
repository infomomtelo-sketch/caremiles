// CareMiles — auth (Supabase email magic link).
// Stage 1 only: sign in, sign out, session. No roles or org logic here;
// that lives in src/app.js after the session exists.

import { supabase, isConfigured } from './supabase.js';

export function authAvailable() {
  return isConfigured() && supabase !== null;
}

// Current session, or null. Safe to call before Supabase is configured.
export async function getSession() {
  if (!authAvailable()) return null;
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// Send a magic link to the given email. The link returns to this app.
// Supabase sends the email itself (default sender until Eli decides
// otherwise — plan open question 7).
export async function signInWithEmail(email) {
  if (!authAvailable()) {
    throw new Error('Supabase is not configured yet.');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!authAvailable()) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Subscribe to sign-in / sign-out events. Returns the subscription (or
// null when Supabase is not configured); callers unsubscribe on teardown.
export function onAuthChange(callback) {
  if (!authAvailable()) return null;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return data.subscription;
}
