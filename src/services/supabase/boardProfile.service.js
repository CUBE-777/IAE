import { supabase } from './client';
import { sha256Hex } from './membershipFlow.service';
import { uploadImage } from './storage.service';

/**
 * أعضاء المكتب يملؤون ملفاتهم بأنفسهم عبر رابط شخصي (supabase/migrations/0031_board_profile_links.sql).
 * كل المنطق الحساس (الرمز المجزّأ، التنظيف، الاعتماد) داخل دوال SQL من نوع SECURITY DEFINER.
 */

/* ---------- عام (زائر يحمل الرمز) ---------- */

export async function getBoardProfileLink(token) {
  const { data, error } = await supabase.rpc('get_board_profile_link', { p_token: token });
  if (error) throw error;
  return data || { state: 'invalid' };
}

export async function submitBoardProfile(token, payload) {
  const { data, error } = await supabase.rpc('submit_board_profile', { p_token: token, p_data: payload });
  if (error) throw error;
  return data;
}

const DOCS_BUCKET = 'membership-docs';

/** يرفع الصورة إلى المجلد الخاص المرتبط بالرمز. الأسماء board-photo-1..6؛ نجرّب التالي إن وُجد الاسم. */
export async function uploadBoardPhoto(token, file) {
  const prefix = await sha256Hex(token);
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  let lastError = null;
  for (let i = 1; i <= 6; i += 1) {
    const path = `${prefix}/board-photo-${i}.${ext}`;
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

/* ---------- الإدارة ---------- */

/** يُرجع { token, expires_at }. الرابط القديم (إن وُجد) يتوقف عن العمل. */
export async function issueBoardProfileLink(boardMemberId) {
  const { data, error } = await supabase.rpc('issue_board_profile_link', { p_board_member_id: boardMemberId });
  if (error) throw error;
  return data;
}

/**
 * حالة الروابط لكل أعضاء المكتب. تُرمى الاستثناءات إن لم يُشغَّل 0031 بعد (الجدول غير موجود)،
 * والمستدعي (صفحة المكتب) يتعامل مع ذلك بإخفاء الأزرار الجديدة فقط.
 */
export async function fetchBoardProfileLinks() {
  const { data, error } = await supabase
    .from('board_profile_links')
    .select('id, board_member_id, status, expires_at, submitted_at, data, photo_path, review_note');
  if (error) throw error;
  return data || [];
}

/** رابط موقّع لمدة دقيقتين لمعاينة الصورة المرفوعة (سياسة board_photo_content_select). */
export async function getBoardPhotoUrl(path) {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

/** ينسخ الصورة المرفوعة من المجلد الخاص إلى الـ bucket العام ويُرجع رابطها العام. */
export async function publishBoardPhoto(path) {
  const signedUrl = await getBoardPhotoUrl(path);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`photo download failed (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `board-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' });
  return uploadImage(file, 'board');
}

export async function approveBoardProfile(linkId, photoUrl = null) {
  const { error } = await supabase.rpc('approve_board_profile', { p_link_id: linkId, p_photo_url: photoUrl });
  if (error) throw error;
}

export async function returnBoardProfile(linkId, note = '') {
  const { error } = await supabase.rpc('return_board_profile', { p_link_id: linkId, p_note: note || null });
  if (error) throw error;
}
