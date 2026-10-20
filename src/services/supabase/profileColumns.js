/**
 * src/services/supabase/profileColumns.js
 * مساعد مشترك لحفظ الأعضاء وأعضاء المكتب مع أعمدة الملف العام (0010/0011) والترجمات (0011).
 * إن لم تكن الأعمدة موجودة بعد في القاعدة نعيد المحاولة بدونها بدل أن يفشل الحفظ كله:
 *   1) المحاولة الكاملة  2) بدون translations  3) بدون كل أعمدة الملف العام والترجمات.
 * فشل المحاولة بسبب عمود ناقص لا يكتب شيئًا، فإعادة المحاولة آمنة.
 */
export const PROFILE_COLS = ['public_bio', 'study_path', 'socials', 'extra'];
export const TRANSLATION_COL = 'translations';

export const isMissingColumn = (e) => !!e && (e.code === 'PGRST204' || e.code === '42703');

const strip = (payload, keys) => {
  const copy = { ...payload };
  keys.forEach((k) => delete copy[k]);
  return copy;
};

/**
 * run(payload) => Promise<{data, error}>
 * optionalCols: أعمدة اختيارية إضافية خاصة بالجدول (مثل promotion/track في board_members بعد 0012).
 * الترتيب: كاملة ← بدون الاختيارية ← بدون الترجمات ← بدون الملف العام. نتجاوز المحاولات المكرّرة.
 * يُرجع { res, degraded } حيث degraded=true إن حُفظت بيانات ناقصة بسبب غياب أعمدة.
 */
export async function runWithColumnFallback(run, payload, optionalCols = []) {
  const steps = [[], optionalCols, [...optionalCols, TRANSLATION_COL], [...optionalCols, TRANSLATION_COL, ...PROFILE_COLS]];
  const attempts = [];
  steps.forEach((keys) => {
    const candidate = strip(payload, keys);
    if (!attempts.length || Object.keys(candidate).length < Object.keys(attempts[attempts.length - 1]).length) {
      attempts.push(candidate);
    }
  });

  let res;
  let degraded = false;
  for (let i = 0; i < attempts.length; i += 1) {
    res = await run(attempts[i]);
    if (!(res.error && isMissingColumn(res.error))) {
      degraded = i > 0;
      break;
    }
  }
  return { res, degraded };
}
