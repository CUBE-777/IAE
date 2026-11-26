import i18n from '../../i18n';
import { isCertificateSchemaMissing } from '../../services/supabase/adminCertificates.service';

/** حالة → صنف الشارة الموجود أصلًا في admin.css */
export const CAMPAIGN_BADGE = { draft: 'pending', issued: 'approved', archived: 'muted' };
export const RECIPIENT_BADGE = { pending: 'pending', issued: 'approved' };
export const CERT_BADGE = { valid: 'approved', revoked: 'rejected' };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const isValidEmail = (v) => v.length <= 254 && EMAIL_RE.test(v);

/**
 * يعرض خطأ RPC للمستخدم: رموز certificate_* لها ترجمة، وغيابُ الوحدة عن القاعدة (migrations غير مطبّقة)
 * له رسالة مستقلة، وأي شيء آخر يمرّ عبر notify.fromError بالنص الاحتياطي.
 */
export function notifyCertError(err, t, fallbackKey) {
  if (isCertificateSchemaMissing(err)) {
    window.notify?.error(t('admin.certificates.unavailable'));
    console.error('Certificates schema unavailable:', err);
    return;
  }
  const code = String(err?.message || '').trim();
  const key = `admin.certificates.errors.${code}`;
  if (/^certificate_[a-z_]+$/.test(code) && i18n.exists(key)) {
    window.notify?.error(t(key));
    return;
  }
  window.notify?.fromError(err, t(fallbackKey));
}
