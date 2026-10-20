/**
 * src/utils/validators.js
 * فحوصات بسيطة للنماذج تُرجع **مفتاح ترجمة** (وليس نصًا) أو null، لتُترجَم
 * الرسائل في الواجهة بحسب اللغة الحالية (AR/FR/EN).
 */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function validateRequired(value) {
  return String(value ?? '').trim() ? null : 'forms.required';
}

export function validateEmail(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'forms.required';
  return EMAIL_RE.test(v) ? null : 'forms.invalidEmail';
}

export function validatePhone(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'forms.required';
  if (!/^[+\d][\d\s().-]*$/.test(v)) return 'forms.invalidPhone';
  const digits = v.replace(/\D/g, '');
  return digits.length >= 6 && v.length <= 30 ? null : 'forms.invalidPhone';
}

export function validateName(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'forms.required';
  return v.length >= 2 && v.length <= 150 ? null : 'forms.nameTooShort';
}

/** يرجع [مفتاح الخطأ, خيارات الترجمة] أو null — للرسائل ذات المتغيّرات. */
export function validateMaxLength(value, max) {
  return String(value ?? '').length > max ? ['forms.messageTooLong', { max }] : null;
}
