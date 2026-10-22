import { supabase } from './client';

/**
 * Parcours d'adhésion : lien de formulaire personnel → formulaire détaillé → adhésion annuelle.
 * Toute la logique sensible (jeton, validation, création du membre, recette budgétaire) est dans
 * des fonctions SQL SECURITY DEFINER (supabase/migrations/0014_membership_flow.sql).
 */

/* ---------- Public (visiteur avec jeton) ---------- */

export async function getMembershipForm(token) {
  const { data, error } = await supabase.rpc('get_membership_form', { p_token: token });
  if (error) throw error;
  return data || { state: 'invalid' };
}

export async function submitMembershipForm(token, payload) {
  const { data, error } = await supabase.rpc('submit_membership_form', { p_token: token, p_data: payload });
  if (error) throw error;
  return data;
}

/* ---------- Administration ---------- */

/** Génère (ou régénère) le lien : renvoie { token, expires_at }. L'ancien lien est invalidé. */
export async function issueMembershipForm(requestId) {
  const { data, error } = await supabase.rpc('issue_membership_form', { p_request_id: requestId });
  if (error) throw error;
  return data;
}

export async function fetchFormForRequest(requestId) {
  const { data, error } = await supabase
    .from('membership_forms')
    .select('submitted_at, expires_at, data')
    .eq('request_id', requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Adhésion annuelle : { requestId } pour une nouvelle demande, { memberId } pour un renouvellement. */
export async function recordAnnualMembership({ requestId = null, memberId = null }) {
  const { data, error } = await supabase.rpc('record_annual_membership', {
    p_request_id: requestId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data;
}

export async function fetchRenewalCandidates() {
  const { data, error } = await supabase.rpc('list_members_for_renewal');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** { fee, season } depuis site_settings (lecture publique). Valeurs vides → null. */
export async function fetchMembershipSettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('key, value')
    .in('key', ['membership_fee', 'current_season']);
  if (error) throw error;
  const map = Object.fromEntries((data || []).map((r) => [r.key, (r.value || '').trim()]));
  return { fee: map.membership_fee || null, season: map.current_season || null };
}

export async function fetchPaidMemberIds(season) {
  if (!season) return new Set();
  const { data, error } = await supabase.from('member_memberships').select('member_id').eq('season', season);
  if (error) throw error;
  return new Set((data || []).map((r) => r.member_id));
}

export async function fetchMemberPrivate(memberId) {
  const { data, error } = await supabase.from('member_private').select('*').eq('member_id', memberId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchMemberMemberships(memberId) {
  const { data, error } = await supabase
    .from('member_memberships')
    .select('season, amount, paid_at')
    .eq('member_id', memberId)
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
