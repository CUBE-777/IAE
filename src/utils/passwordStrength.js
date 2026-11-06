/**
 * src/utils/passwordStrength.js
 * مؤشر قوة كلمة المرور (إرشادي فقط، لا يمنع شيئًا) + حدود الطول المشتركة بين التفعيل وتغيير كلمة المرور.
 * الحدّان يطابقان ما يفرضه الخادم في member-activate (8..72).
 */
export const MIN_LEN = 8;
export const MAX_LEN = 72;

export const STRENGTH_KEYS = {
  weak: 'member.activate.strengthWeak',
  medium: 'member.activate.strengthMedium',
  strong: 'member.activate.strengthStrong',
};

/** 'weak' | 'medium' | 'strong'، أو null إن كانت أقصر من الحد الأدنى. */
export function passwordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_LEN) return null;
  const classes = [/[a-z\u0600-\u06FF]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\u0600-\u06FF]/].filter((re) => re.test(pw)).length;
  const points = (pw.length >= 10 ? 1 : 0) + (pw.length >= 14 ? 1 : 0) + (classes >= 2 ? 1 : 0) + (classes >= 3 ? 1 : 0);
  return points >= 3 ? 'strong' : points === 2 ? 'medium' : 'weak';
}
