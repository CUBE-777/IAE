/**
 * src/utils/attendanceCode.js
 * نصّ رمز بطاقة الحضور: «IAE-» + 22 خانة base64url (128 بت). نص مبهم لا رابط، فمن يمسحه بكاميرا هاتفه العادية لا يرى
 * سوى هذا السطر ولا تُفتح له أي صفحة. المسح الحقيقي يتم من صفحة المنظِّم داخل الموقع.
 */
export const ATTENDANCE_PREFIX = 'IAE-';
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export const attendanceCodeText = (token) => `${ATTENDANCE_PREFIX}${token}`;

/** يستخرج الرمز (22 خانة) من نص ممسوح، أو null إن لم يكن رمز حضور. */
export function parseAttendanceCode(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith(ATTENDANCE_PREFIX)) return null;
  const token = s.slice(ATTENDANCE_PREFIX.length);
  return TOKEN_RE.test(token) ? token : null;
}
