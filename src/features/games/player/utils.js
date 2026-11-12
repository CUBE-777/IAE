/** أدوات عرض فقط لواجهة اللاعب. لا حساب نقاط ولا نتائج هنا: كلّها من الخادم. */

/** هل التحدي داخل نافذته الزمنية الآن؟ (للعرض؛ الخادم يفرضها عند بدء المحاولة). */
export function isOpenNow(c, now = Date.now()) {
  if (!c) return false;
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return false;
  if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false;
  return true;
}

const pad = (n) => String(n).padStart(2, '0');

/** ثوانٍ → mm:ss أو h:mm:ss. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function formatDateTime(v, lang) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDurationMs(ms) {
  return ms == null ? '—' : `${(Number(ms) / 1000).toFixed(1)}s`;
}

/** مصفوفة الحالة → خريطة بحسب challenge_id. */
export function statusMap(rows) {
  return Object.fromEntries((rows || []).map((r) => [r.challenge_id, r]));
}

/** المحاولات المتبقية: null = غير محدود. تُحتسب المحاولة الجارية ضمن المستهلك (كما يفعل الخادم). */
export function attemptsLeft(challenge, status) {
  if (challenge?.max_attempts == null) return null;
  return Math.max(0, challenge.max_attempts - (status?.attempts_used || 0));
}

/** ترتيب التحديات للعرض. */
export function sortChallenges(list, mode) {
  const arr = [...list];
  const byOrder = (a, b) => (a.sort_order - b.sort_order) || String(a.slug).localeCompare(String(b.slug));
  if (mode === 'difficulty_asc') return arr.sort((a, b) => (a.difficulty - b.difficulty) || byOrder(a, b));
  if (mode === 'difficulty_desc') return arr.sort((a, b) => (b.difficulty - a.difficulty) || byOrder(a, b));
  if (mode === 'points_desc') return arr.sort((a, b) => (b.points_reward - a.points_reward) || byOrder(a, b));
  return arr.sort(byOrder);
}
