import { supabase } from './client';
import { uploadImage } from './storage.service';

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

/* ---------- Documents (photo + carte nationale) : bucket privé membership-docs (migration 0020) ---------- */

const DOCS_BUCKET = 'membership-docs';

/** sha256 hex du jeton : même valeur que token_hash côté SQL → nom du dossier d'envoi. */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Envoie une image (kind = 'photo' | 'id') dans le dossier privé lié au jeton.
 * Les noms sont limités par la politique SQL à photo-1..3 / id-1..3 : on essaie le suivant si le nom existe.
 * Renvoie le chemin à transmettre à submit_membership_form.
 */
export async function uploadMembershipDoc(token, kind, file) {
  const prefix = await sha256Hex(token);
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  let lastError = null;
  for (let i = 1; i <= 3; i += 1) {
    const path = `${prefix}/${kind}-${i}.${ext}`;
    const { error } = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (!error) return path;
    lastError = error;
    const text = `${error.message || ''} ${error.statusCode || ''}`;
    if (!/exist|duplicate|409/i.test(text)) break;
  }
  throw lastError || new Error('upload failed');
}

/** Admin : lien signé de 2 minutes ; l'accès est journalisé côté SQL (request_membership_document). */
export async function getMembershipDocUrl(path) {
  const { data: allowed, error } = await supabase.rpc('request_membership_document', { p_path: path });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(allowed || path, 120);
  if (signError) throw signError;
  return data.signedUrl;
}

/**
 * ينشر صورة العضو في الصفحة العامة بعد قبوله، وفقط إن وافق على ذلك (consent_photo في النموذج).
 * تُنسخ الصورة من المجلد الخاص membership-docs إلى الـ bucket العام ثم يُحدَّث members.photo_url.
 * (الصورة الأصلية تبقى في المجلد الخاص). تُرمى استثناءات عند الفشل ليقرّر المستدعي ما يفعل.
 */
export async function publishMemberPhotoFromForm(memberId, photoPath) {
  if (!memberId || !photoPath) return null;
  const signedUrl = await getMembershipDocUrl(photoPath);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`photo download failed (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `member-${memberId}.${ext}`, { type: blob.type || 'image/jpeg' });
  const publicUrl = await uploadImage(file, 'members');
  const { error } = await supabase.from('members').update({ photo_url: publicUrl }).eq('id', memberId);
  if (error) throw error;
  return publicUrl;
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
