/**
 * src/utils/announcementSeen.js
 * «إعلانات جديدة» في فضاء المنخرطين: نقطة على تبويب الإعلانات عندما يوجد إعلان أحدث مما رآه العضو.
 * الحالة في localStorage على هذا المتصفح فقط (لا جدول ولا migration)؛ فشل التخزين يعني ببساطة لا نقطة.
 */
export const SEEN_KEY = 'iae:member:ann-seen';
const MAX_ROWS = 20;

const ts = (v) => {
  const n = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(n) ? n : null;
};

/** أحدث وقت ظهور بين صفوف { start_at, created_at } (start_at إن وُجد وإلا created_at). null إن لم يوجد. */
export function latestStamp(rows) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows.slice(0, MAX_ROWS)) {
    const t = ts(r?.start_at) ?? ts(r?.created_at);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best;
}

export const isNewer = (stamp, seen) => typeof stamp === 'number' && typeof seen === 'number' && stamp > seen;

const defaultStorage = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/** آخر وقت رآه العضو (رقم) أو null إن لم يُسجَّل بعد/تعذّرت القراءة. */
export function readSeen(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(SEEN_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export function markSeen(stamp, storage = defaultStorage()) {
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return;
  try { storage?.setItem(SEEN_KEY, String(stamp)); } catch { /* تجاهل: التخزين معطّل */ }
}
