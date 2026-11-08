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

/* ---------- طلب مساعدة في الدخول (0039) ---------- */

/**
 * زائر بلا جلسة يطلب رابط تفعيل/استعادة. لا يُرجع الخادم شيئًا مهما كان البريد (لا تعداد)، فالنجاح لا يعني أن البريد مسجّل.
 * يرمي خطأ يحتوي rate_limited عند تجاوز الحدّ.
 */
export async function requestAccessHelp(email) {
  const { error } = await supabase.rpc('request_member_access_help', { p_email: String(email || '').trim() });
  if (error) throw error;
}

/* ---------- الإدارة ---------- */

/** { token, expires_at, existing }: الرمز يظهر مرة واحدة ولا يُخزَّن؛ إعادة الإصدار تُبطل الرابط السابق. */
export async function issueMemberActivationLink(memberId) {
  const { data, error } = await supabase.rpc('issue_member_activation_link', { p_member_id: memberId });
  if (error) throw error;
  return data;
}

/**
 * ملخص حالة رابط التفعيل لكل عضو: Map(member_id → { state: 'sent'|'expired'|'activated', sent_at, expires_at }).
 * من لا يظهر فيه لم يُرسَل له رابط ولا حساب له. يتطلب 0047؛ قبل تشغيله ترمي الدالة خطأً ويتجاهله المستدعي.
 */
export async function fetchMemberActivationOverview() {
  const { data, error } = await supabase.rpc('member_activation_overview');
  if (error) throw error;
  return new Map((data || []).map((r) => [r.member_id, { state: r.state, sent_at: r.sent_at, expires_at: r.expires_at }]));
}

const REQUEST_SELECT =
  'id, member_id, status, data, photo_path, review_note, created_at, updated_at, ' +
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

// expectedUpdatedAt: قيمة updated_at كما رآها المسؤول (نصًا كما وصلت، دون تحويلها إلى Date) لمنع اعتماد طلب عدّله العضو بعد فتحه
// skipFields: مفاتيح الحقول التي لم يعتمدها المسؤول (قبول جزئي)؛ تحتفظ البطاقة بقيمها الحالية
export async function approveCardRequest(requestId, photoUrl = null, expectedUpdatedAt = null, skipFields = []) {
  const { error } = await supabase.rpc('approve_member_card_request', {
    p_request_id: requestId,
    p_photo_url: photoUrl,
    p_expected_updated_at: expectedUpdatedAt,
    p_skip_fields: Array.isArray(skipFields) && skipFields.length ? skipFields : null,
  });
  if (error) throw error;
}

export async function rejectCardRequest(requestId, note = '', expectedUpdatedAt = null) {
  const { error } = await supabase.rpc('reject_member_card_request', {
    p_request_id: requestId, p_note: note || null, p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw error;
}

/* ---------- طلبات المساعدة في الدخول (الإدارة) ---------- */

const ACCESS_SELECT = 'id, member_id, status, created_at, members(id, full_name, email, phone, status)';

export async function fetchPendingAccessRequests() {
  const { data, error } = await supabase
    .from('member_access_requests')
    .select(ACCESS_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function countPendingAccessRequests() {
  const { count, error } = await supabase
    .from('member_access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count || 0;
}

/** status: 'handled' (بعد إصدار الرابط) أو 'dismissed' (تجاهل). */
export async function resolveAccessRequest(requestId, status = 'handled') {
  const { error } = await supabase.rpc('resolve_member_access_request', { p_request_id: requestId, p_status: status });
  if (error) throw error;
}

/* ---------- بطاقة العضوية الرقمية (0040) ---------- */

/**
 * رمز QR الثابت للعضو النشط (0042): { token, expires_at: null, permanent: true }. نفس الرمز في كل مرة حتى يستدعي العضو regenerateMemberCardToken.
 * لا يُخزَّن في أي مكان بالمتصفح (لا storage ولا رابط ولا سجل). يرمي غير مصرّح إن لم يكن الحساب لعضو نشط.
 */
export async function issueMemberCardToken() {
  const { data, error } = await supabase.rpc('issue_member_card_token');
  if (error) throw error;
  return data;
}

/**
 * رمز جديد بطلب العضو (0042): يُوقف الرمز الثابت الحالي فورًا ويُصدر غيره. يرمي rate_limited بعد 5 مرات/ساعة.
 */
export async function regenerateMemberCardToken() {
  const { data, error } = await supabase.rpc('regenerate_member_card_token');
  if (error) throw error;
  return data;
}

/**
 * تحقق عام (زائر بلا جلسة): { valid: false } أو { valid: true, full_name, photo_url, university, promotion, track, membership: { season, active } }.
 * لا يُفرَّق بين المنتهي وغير المعروف. يرمي خطأ رسالته rate_limited عند تجاوز 30 محاولة/10 دقائق.
 */
export async function verifyMemberCard(token) {
  const { data, error } = await supabase.rpc('verify_member_card', { p_token: String(token || '') });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { valid: false };
}

/** حالة انخراطي للموسم الحالي: { season, active, paid_at, has_previous } أو null إن لم تكن الجلسة لعضو. */
export async function getMyMembershipStatus() {
  const { data, error } = await supabase.rpc('get_my_membership_status');
  if (error) throw error;
  return data || null;
}

/**
 * بطاقات الحضور المفتوحة للعضو (0041): [{ activity_id, title, date, token, attended }]. الرمز ثابت لنفس (نشاط، عضو).
 * لا يُخزَّن في المتصفح؛ يُجلب عند فتح الصفحة.
 */
export async function getMyAttendanceCards() {
  const { data, error } = await supabase.rpc('get_my_attendance_cards');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * يطلب من الدالة الطرفية إرسال بريد للعضو بنتيجة المراجعة (اعتماد/رفض). لا يرمي أبدًا: فشل البريد لا يُفشل المراجعة.
 * يُرجع { sent: boolean, reason?: string } — reason: not_configured | no_email | send_failed | already_notified | error
 */
export async function notifyCardRequestOutcome(requestId) {
  try {
    const { data, error } = await supabase.functions.invoke('notify-member-card-request', { body: { request_id: requestId } });
    if (error) return { sent: false, reason: 'error' };
    return { sent: data?.sent === true, reason: data?.reason };
  } catch {
    return { sent: false, reason: 'error' };
  }
}

/** سجل طلبات تعديل بطاقة عضو (للمسؤول): سياسة member_card_requests_manager_read (0036). */
export async function fetchMemberCardRequests(memberId, limit = 5) {
  const { data, error } = await supabase
    .from('member_card_requests')
    .select('id, status, created_at, reviewed_at, review_note')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
