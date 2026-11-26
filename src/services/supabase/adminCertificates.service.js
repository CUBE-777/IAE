import { supabase } from './client';

/**
 * إدارة الشهادات (المرحلة 2A) — طبقة خدمة فوق migrations 0063/0064.
 * - لا `select *` على أي جدول شهادات، ولا قراءة أي عمود رمز/سرّ: الأعمدة تُسمّى صراحةً.
 * - الكتابة كلها عبر RPC (SECURITY DEFINER)؛ لا INSERT/UPDATE/DELETE مباشر.
 * - members_manager لا يملك SELECT فعّالًا: يستعمل certificate_review_campaigns / certificate_review_recipients فقط.
 */

export const CERT_TYPES = ['participation', 'organization', 'volunteering', 'training'];
/** registration_based معطّل بمشغّل في 0063، فلا يُعرض عند الإنشاء */
export const CERT_SOURCES = ['attendance_based', 'manual_selection'];
export const CERT_LANGUAGES = ['fr', 'ar', 'en'];
export const CERT_NAME_MODES = ['masked', 'none', 'full'];

const CAMPAIGN_COLS =
  'id, title, certificate_type, eligibility_source, activity_id, activity_title_snapshot, activity_date_snapshot, template_id, language, public_name_mode, status, issued_at, archived_at, created_at';
const RECIPIENT_COLS = 'id, campaign_id, member_id, kind, display_name, email, eligibility_source, attended_at, status, certificate_id, created_at';
const TEMPLATE_COLS = 'id, code, name, style, is_active';

/** الوحدة غير مطبّقة على القاعدة (migration لم تُنفَّذ): دالة/جدول غير موجود */
export function isCertificateSchemaMissing(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code) || /could not find the (function|table)|schema cache|does not exist/i.test(msg);
}

// ---------------------------------------------------------------- القراءة

/** قائمة الحملات لكل الأدوار المسموحة (RPC المراجعة؛ المؤرشفة لا يراها إلا مدراء الشهادات) */
export async function fetchCertificateCampaigns() {
  const { data, error } = await supabase.rpc('certificate_review_campaigns');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** حملة كاملة للإدارة (manage فقط) */
export async function fetchCertificateCampaign(id) {
  const { data, error } = await supabase.from('certificate_campaigns').select(CAMPAIGN_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchCertificateTemplates() {
  const { data, error } = await supabase.from('certificate_templates').select(TEMPLATE_COLS).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}

/** أنشطة غير محذوفة لاختيار نشاط الحملة (أعمدة محدّدة فقط) */
export async function fetchCertificateActivities() {
  const { data, error } = await supabase.from('activities').select('id, title, date').is('deleted_at', null).order('date', { ascending: false }).limit(300);
  if (error) throw error;
  return data || [];
}

/**
 * مستفيدو حملة، بشكل موحّد:
 * - manage: من الجداول بأعمدة صريحة (يشمل email وmember_id ورقم الشهادة وحالتها).
 * - مراجعة فقط (members_manager): من RPC المراجعة بلا email (has_email منطقي فقط).
 * يُرجع { campaign, recipients } حيث campaign قد يكون جزئيًا في وضع المراجعة.
 */
export async function fetchCertificateRecipients(campaignId, { canManage }) {
  if (!canManage) {
    const { data, error } = await supabase.rpc('certificate_review_recipients', { p_campaign_id: campaignId });
    if (error) throw error;
    const recipients = (data?.recipients || []).map((r) => ({
      id: r.id,
      display_name: r.display_name,
      kind: r.kind,
      eligibility_source: r.eligibility_source,
      status: r.status,
      certificate_number: r.certificate_number || null,
      certificate_status: r.certificate_status || null,
      email: null,
      has_email: !!r.has_email,
      member_id: null,
      attended_at: null,
    }));
    return { campaign: data?.campaign || null, recipients };
  }

  const { data: rows, error } = await supabase
    .from('certificate_recipients')
    .select(RECIPIENT_COLS)
    .eq('campaign_id', campaignId)
    .order('display_name', { ascending: true });
  if (error) throw error;
  const list = rows || [];

  const certIds = list.map((r) => r.certificate_id).filter(Boolean);
  const certMap = new Map();
  if (certIds.length) {
    const { data: certs, error: cErr } = await supabase.from('certificates').select('id, certificate_number, status').in('id', certIds);
    if (cErr) throw cErr;
    (certs || []).forEach((c) => certMap.set(c.id, c));
  }
  const recipients = list.map((r) => {
    const c = r.certificate_id ? certMap.get(r.certificate_id) : null;
    return {
      id: r.id,
      display_name: r.display_name,
      kind: r.kind,
      eligibility_source: r.eligibility_source,
      status: r.status,
      certificate_number: c?.certificate_number || null,
      certificate_status: c?.status || null,
      email: r.email || null,
      has_email: !!r.email,
      member_id: r.member_id || null,
      attended_at: r.attended_at || null,
    };
  });
  return { campaign: null, recipients };
}

/** بحث أعضاء للإضافة اليدوية (manage فقط؛ أعمدة محدّدة) */
export async function searchMembersForCertificate(search) {
  const s = String(search || '').replace(/[%_,()]/g, ' ').trim();
  if (s.length < 2) return [];
  const { data, error } = await supabase
    .from('members')
    .select('id, full_name, promotion')
    .is('deleted_at', null)
    .ilike('full_name', `%${s}%`)
    .order('full_name')
    .limit(15);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------- الكتابة (RPC فقط)

export async function createCertificateCampaign(v) {
  const { data, error } = await supabase.rpc('certificate_create_campaign', {
    p_title: v.title,
    p_type: v.certificate_type,
    p_eligibility: v.eligibility_source,
    p_activity_id: v.activity_id || null,
    p_template_id: v.template_id,
    p_language: v.language || 'fr',
    p_public_name_mode: v.public_name_mode || 'masked',
    p_settings: {},
  });
  if (error) throw error;
  return data; // uuid
}

/** تعديل مسودة فقط (الخادم يرفض غيرها) */
export async function updateCertificateCampaign(id, v) {
  const { error } = await supabase.rpc('certificate_update_campaign', {
    p_id: id,
    p_title: v.title,
    p_template_id: v.template_id,
    p_language: v.language,
    p_public_name_mode: v.public_name_mode,
    p_settings: null,
  });
  if (error) throw error;
}

/** يُرجع عدد المضافين الجدد */
export async function addAttendanceRecipients(campaignId) {
  const { data, error } = await supabase.rpc('certificate_add_attendance_recipients', { p_campaign_id: campaignId });
  if (error) throw error;
  return Number(data) || 0;
}

export async function addMemberRecipient(campaignId, memberId) {
  const { data, error } = await supabase.rpc('certificate_add_member_recipient', { p_campaign_id: campaignId, p_member_id: memberId });
  if (error) throw error;
  return data;
}

export async function addExternalRecipient(campaignId, name, email) {
  const { data, error } = await supabase.rpc('certificate_add_external_recipient', {
    p_campaign_id: campaignId,
    p_name: name,
    p_email: email || null,
  });
  if (error) throw error;
  return data;
}

/** رفض مستفيد غير مُصدَر = حذفه من الحملة (الدالة ترفض المُصدَرين) */
export async function rejectCertificateRecipient(recipientId) {
  const { error } = await supabase.rpc('certificate_remove_recipient', { p_recipient_id: recipientId });
  if (error) throw error;
}

/** اعتماد/إصدار كل المستفيدين المعلّقين: { issued, skipped, status } */
export async function issueCertificateCampaign(campaignId) {
  const { data, error } = await supabase.rpc('certificate_issue_campaign', { p_campaign_id: campaignId });
  if (error) throw error;
  return data || { issued: 0, skipped: 0 };
}
