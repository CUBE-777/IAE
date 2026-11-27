/**
 * src/utils/memberCertificates.js
 * منطق خالص (بلا React/DOM/Supabase) لصفحة «شهاداتي»، ليُختبر مباشرة في Node.
 * - القائمة تأتي من RPC get_my_certificates() فقط: الخادم يحدّد العضو من الجلسة (لا member_id من العميل).
 * - التنظيف بقائمة بيضاء: الرمز الخام (token) وأي حقل آخر غير معروف يُسقَط هنا ولا يصل إلى الواجهة.
 * - زر PDF للشهادة الصالحة فقط؛ الخادم (get_certificate_render_data) يفرض الملكية والإلغاء مرة ثانية.
 */
import { NUMBER_RE } from './certificateRender.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_RE = /^[a-z_]{3,30}$/;
const STATUSES = ['valid', 'revoked'];
const str = (v, max = 300) => (typeof v === 'string' && v.length <= max ? v : null);

/** يحوّل استجابة get_my_certificates إلى مصفوفة صفوف آمنة للعرض (الأحدث أولًا كما يرتّبها الخادم). */
export function normalizeMyCertificates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.id !== 'string' || !UUID_RE.test(r.id)) continue;
    if (!STATUSES.includes(r.status)) continue;
    if (typeof r.certificate_number !== 'string' || !NUMBER_RE.test(r.certificate_number)) continue;
    out.push({
      id: r.id,
      certificate_number: r.certificate_number,
      certificate_type: typeof r.certificate_type === 'string' && TYPE_RE.test(r.certificate_type) ? r.certificate_type : null,
      campaign_title: str(r.campaign_title),
      issued_at: str(r.issued_at, 40),
      status: r.status,
    });
  }
  return out;
}

/** زر التحميل للشهادة الصالحة فقط (الملغاة لا يُعرض لها زر ولا يُستدعى توليد PDF). */
export const canDownloadCertificate = (c) => !!c && c.status === 'valid' && typeof c.id === 'string' && UUID_RE.test(c.id);

/** رمز خطأ ثابت للعرض (certificate_* فقط)، وغير ذلك يصبح certificate_pdf_failed. لا يمرّ أي نص حرّ من الخادم. */
export const memberCertErrorCode = (err) => (/^certificate_[a-z_]+$/.test(String(err?.message || '')) ? err.message : 'certificate_pdf_failed');
