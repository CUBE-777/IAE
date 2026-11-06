import { supabase } from './client';
import { uploadImage } from './storage.service';

/**
 * «فضاء المنخرطين»: واجهة العضو + أدوات الإدارة (supabase/migrations/0036 و0037).
 * لا يكتب العضو في members مباشرة أبدًا: كل شيء عبر دوال SECURITY DEFINER وEdge Function member-activate.
 */

const DOCS_BUCKET = 'membership-docs';

/* ---------- زائر يحمل رمز التفعيل ---------- */

/** { valid, reason?, full_name?, email_hint?, existing?, expires_at? } */
export async function getActivationLink(token) {
  const { data, error } = await supabase.rpc('get_member_activation_link', { p_token: token });
  if (error) throw error;
  return data || { valid: false, reason: 'invalid' };
}

/** يفعّل الحساب (أو يعيد ضبط كلمة المرور لحساب قائم). يرمي Error مع userMessage من الخادم إن وُجد. */
export async function activateMember(token, password) {
  const { data, error } = await supabase.functions.invoke('member-activate', { body: { token, password } });
  if (error) {
    let userMessage = '';
    let status = 0;
    try {
      status = error.context?.status || 0;
      const body = await error.context?.json?.();
      userMessage = body?.error || '';
    } catch {
      /* لا شيء */
    }
    const e = new Error(userMessage || error.message);
    e.userMessage = userMessage;
    e.status = status;
    throw e;
  }
  if (data?.error) {
    const e = new Error(data.error);
    e.userMessage = data.error;
    throw e;
  }
  return data; // { ok, email, reset? }
}

/* ---------- العضو ---------- */

/** ملفي: null إن لم تكن الجلسة لحساب عضو نشط. */
export async function getMyMember() {
  const { data, error } = await supabase.rpc('get_my_member');
  if (error) throw error;
  return data || null;
}

/**
 * يغيّر كلمة مرور العضو الحالي بعد إعادة التحقق من كلمته الحالية (لا نعتمد على الجلسة وحدها).
 * يرمي Error بـ code: WRONG_CURRENT (الحالية خاطئة) | SAME (الجديدة مطابقة للحالية) | NO_SESSION، وغير ذلك خطأ Supabase كما هو.
 * إن طُلب إنهاء الجلسات الأخرى ففشله لا يُفشل التغيير، ويُرجع { othersEnded: false }.
 */
export async function changeMyPassword(currentPassword, newPassword, { endOthers = true } = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData?.session?.user?.email;
  if (!email) {
    const e = new Error('no session');
    e.code = 'NO_SESSION';
    throw e;
  }
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) {
    if (/invalid login credentials/i.test(reauthError.message || '')) {
      const e = new Error('wrong current password');
      e.code = 'WRONG_CURRENT';
      throw e;
    }
    throw reauthError; // شبكة/خادم: تُعرض كخطأ عام أو اتصال
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (/different from the old password/i.test(error.message || '')) {
      const e = new Error('same password');
      e.code = 'SAME';
      throw e;
    }
    throw error;
  }
  let othersEnded = false;
  if (endOthers) othersEnded = await signOutOtherSessions();
  return { othersEnded };
}

/** يُنهي جلسات هذا الحساب على كل الأجهزة الأخرى ويُبقي الجلسة الحالية. يُرجع true عند النجاح. */
export async function signOutOtherSessions() {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) {
    console.error('sign out others failed', error);
    return false;
  }
  return true;
}

/** الهاتف والمدينة فورًا، و hide_from_directory لسحب الظهور فورًا. (المهنة تمر عبر طلب البطاقة لأنها عامة.) */
export async function updateMyPrivate(payload) {
  const { error } = await supabase.rpc('update_my_member_private', { p_data: payload });
  if (error) throw error;
}

/**
 * سجل طلباتي (الأحدث أولًا) مباشرةً من الجدول: سياسة member_card_requests_own_read (0036) تحصر الصفوف بصاحبها
 * ولا حاجة لـ migration. لا نقرأ data (قد تبلغ 30KB للطلب) بل ما يلزم للعرض فقط.
 */
export async function listMyCardRequests(memberId, limit = 6) {
  const { data, error } = await supabase
    .from('member_card_requests')
    .select('id, status, review_note, created_at, reviewed_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function submitCardRequest(payload, photoPath = null) {
  const { data, error } = await supabase.rpc('submit_member_card_request', { p_data: payload, p_photo_path: photoPath });
  if (error) throw error;
  return data;
}

export async function cancelCardRequest() {
  const { error } = await supabase.rpc('cancel_my_member_card_request');
  if (error) throw error;
}

/** يرفع الصورة المقترحة إلى member-<id>/photo-<hex>.<ext> (الاسم الذي تفرضه سياسة 0036). يُرجع المسار. */
export async function uploadMemberCardPhoto(memberId, file) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const path = `member-${memberId}/photo-${hex}.${ext}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
  if (error) throw error;
  return path;
}

/* ---------- الإدارة ---------- */

/** { token, expires_at, existing }: الرمز يظهر مرة واحدة ولا يُخزَّن؛ إعادة الإصدار تُبطل الرابط السابق. */
export async function issueMemberActivationLink(memberId) {
  const { data, error } = await supabase.rpc('issue_member_activation_link', { p_member_id: memberId });
  if (error) throw error;
  return data;
}

const REQUEST_SELECT =
  'id, member_id, status, data, photo_path, review_note, created_at, ' +
  'members(id, full_name, photo_url, university, promotion, track, profession, public_bio, study_path, socials, extra, translations, show_in_directory)';

export async function fetchPendingCardRequests() {
  const { data, error } = await supabase
    .from('member_card_requests')
    .select(REQUEST_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function countPendingCardRequests() {
  const { count, error } = await supabase
    .from('member_card_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count || 0;
}

export async function getCardRequestPhotoUrl(path) {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

/** ينسخ الصورة المقترحة من المجلد الخاص إلى الـ bucket العام ويُرجع رابطها العام. */
export async function publishCardRequestPhoto(path, memberId) {
  const signedUrl = await getCardRequestPhotoUrl(path);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`photo download failed (${res.status})`);
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `member-${memberId}.${ext}`, { type: blob.type || 'image/jpeg' });
  return uploadImage(file, 'members');
}

export async function approveCardRequest(requestId, photoUrl = null) {
  const { error } = await supabase.rpc('approve_member_card_request', { p_request_id: requestId, p_photo_url: photoUrl });
  if (error) throw error;
}

export async function rejectCardRequest(requestId, note = '') {
  const { error } = await supabase.rpc('reject_member_card_request', { p_request_id: requestId, p_note: note || null });
  if (error) throw error;
}
