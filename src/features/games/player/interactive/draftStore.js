/**
 * مسودّة الإجابة (اختيارات اللاعب فقط) في sessionStorage لكل محاولة، كي لا تضيع بإعادة تحميل الصفحة أثناء محاولة جارية.
 * ليست نتيجة ولا حلًّا ولا مصدر حقيقة: تُنقَّى دائمًا بمحتوى الإصدار المثبَّت (sanitizeRaw) قبل الاستعمال، وتُمسح بعد التسليم.
 * أي فشل في التخزين (وضع خاص/ممتلئ/معطّل) يُتجاهل بصمت ولا يؤثر على اللعب.
 */
const key = (attemptId) => `iae.games.draft.${attemptId}`;
const MAX = 20000;

export function saveDraft(attemptId, raw) {
  try {
    if (!attemptId) return;
    if (raw === undefined) {
      sessionStorage.removeItem(key(attemptId));
      return;
    }
    const s = JSON.stringify(raw);
    if (s.length <= MAX) sessionStorage.setItem(key(attemptId), s);
  } catch {
    /* التخزين غير متاح */
  }
}

export function loadDraft(attemptId) {
  try {
    const s = attemptId ? sessionStorage.getItem(key(attemptId)) : null;
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

export function clearDraft(attemptId) {
  try {
    if (attemptId) sessionStorage.removeItem(key(attemptId));
  } catch {
    /* التخزين غير متاح */
  }
}
