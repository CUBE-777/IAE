import { NOT_AUTHORIZED_RE } from './serverErrors.js';
/**
 * src/utils/memberCardToken.js
 * منطق خالص (بلا React ولا شبكة) لرمز بطاقة العضوية المتجدد ولشارة الانخراط، ليُختبر مباشرة.
 * الأرقام تطابق 0040: صلاحية الرمز 120 ثانية، والواجهة تجدّد عند 90 ثانية.
 */

export const CARD_TOKEN_TTL_MS = 120_000;
export const CARD_REFRESH_MS = 90_000;
export const CARD_RETRY_MS = 15_000;          // بعد فشل شبكة
export const CARD_RATE_LIMIT_RETRY_MS = 60_000; // بعد rate_limited

/** يصنّف خطأ الإصدار: 'rate_limited' | 'forbidden' (ليس عضوًا نشطًا) | 'error' (شبكة/خادم). */
export function classifyIssueError(err) {
  const text = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  if (/rate_limited/i.test(text)) return 'rate_limited';
  if (NOT_AUTHORIZED_RE.test(text) || err?.status === 401 || err?.status === 403) return 'forbidden';
  return 'error';
}

/** الثواني المتبقية (صحيح، لا تقل عن 0). */
export function secondsLeft(expiresAt, now) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * عند عودة التبويب إلى الظهور: هل نطلب رمزًا جديدًا؟ نعم إن لم يوجد رمز أو بلغ وقت التجديد (أو انتهى).
 * وإلا نُعيد جدولة التجديد في الوقت المتبقي.
 */
export function shouldRefreshOnReturn(token, now) {
  return !token || now >= token.refreshAt;
}

/** نص الرابط الذي يُشفَّر في QR: الأصل + /verify/ + الرمز (لا شيء شخصي). */
export function verifyUrl(origin, token) {
  return `${String(origin).replace(/\/+$/, '')}/verify/${token}`;
}

/** حالة شارة الانخراط للعضو: 'active' | 'lapsed' (الانخراط غير مجدَّد) | 'none' (غير منخرط) | 'unset' (لم يُضبط الموسم). */
export function membershipState(status) {
  if (!status || status.season == null || status.active == null) return 'unset';
  if (status.active) return 'active';
  return status.has_previous ? 'lapsed' : 'none';
}

/** حالة صفحة التحقق العامة: 'invalid' | 'active' | 'inactive' | 'unknown' (الموسم غير مضبوط). */
export function verifyState(result) {
  if (!result || result.valid !== true) return 'invalid';
  const m = result.membership;
  if (!m || m.season == null || m.active == null) return 'unknown';
  return m.active ? 'active' : 'inactive';
}
