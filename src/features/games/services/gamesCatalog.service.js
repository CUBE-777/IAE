import { supabase } from '../../../services/supabase/client';
import { COLUMNS, unwrap } from './gamesCore.shared';

/**
 * كتالوج الألعاب (قراءة فقط). RLS (0050) تُرجع للاعب المنشور فقط، وللمدير الكل؛ والحلول محفوظة في جدول مغلق عن اللاعبين فلا تُقرأ من هنا أبدًا.
 */

/** تصنيفات نشطة مرتبة. الشرط صريح لأن المدير يرى كل شيء في RLS ولا يجب أن تظهر له المعطّلة في واجهة اللعب. */
export async function getGameCategories() {
  return unwrap(await supabase.from('game_categories').select(COLUMNS.category).eq('is_active', true).order('sort_order').order('slug')) || [];
}

/** ألعاب منشورة، مع تصفية اختيارية بالتصنيف أو النوع. */
export async function getGames({ categoryId, kind } = {}) {
  let q = supabase.from('games').select(COLUMNS.game).eq('status', 'published').order('sort_order').order('slug');
  if (categoryId) q = q.eq('category_id', categoryId);
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q) || [];
}

/** لعبة واحدة بالـ slug أو null. */
export async function getGameBySlug(slug) {
  return unwrap(await supabase.from('games').select(COLUMNS.game).eq('slug', String(slug || '')).eq('status', 'published').maybeSingle());
}

/** تحديات لعبة (الظاهرة للاعب فقط)، مع تصفية اختيارية بالصعوبة 1..5. */
export async function getChallenges(gameId, { difficulty } = {}) {
  let q = supabase.from('game_challenges').select(COLUMNS.challenge).eq('game_id', gameId).eq('status', 'published').order('sort_order').order('slug');
  if (Number.isInteger(difficulty)) q = q.eq('difficulty', difficulty);
  return unwrap(await q) || [];
}

/**
 * تحدٍّ واحد بالمعرّف أو null — المنشور فقط (سياسة النشر)، وبمحتواه «الجاري». عمدًا لا يُستعمل لاستعادة محاولة قائمة:
 * التحدي غير المنشور لا يُرى بهذه الدالة أبدًا. استئناف محاولة جارية (حتى بعد سحب النشر أو نشر إصدار أحدث) يمرّ عبر
 * getOpenAttemptChallenge/getAttemptChallenge (gamesAttempts.service) المعتمدتين على الإصدار المثبَّت في المحاولة.
 */
export async function getChallengeById(challengeId) {
  return unwrap(await supabase.from('game_challenges').select(COLUMNS.challenge).eq('id', challengeId).eq('status', 'published').maybeSingle());
}

/** كل التحديات المنشورة (الظاهرة للاعب) عبر الألعاب. الفلترة بالنافذة الزمنية تتمّ في الواجهة للعرض فقط؛ الخادم يفرضها عند بدء المحاولة. */
export async function getAllChallenges() {
  return unwrap(await supabase.from('game_challenges').select(COLUMNS.challenge).eq('status', 'published').order('sort_order').order('slug')) || [];
}

/** تحديات بمعرّفاتها (للسجلّ). ما لا يراه اللاعب (غير منشور/مؤرشف) لا يُرجَع. */
export async function getChallengesByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))].slice(0, 200);
  if (!list.length) return [];
  return unwrap(await supabase.from('game_challenges').select('id, game_id, slug, title').in('id', list)) || [];
}

/**
 * لغة إصدار التحدي الجاري المنشور { default_language, allow_language_fallback } أو null (تحدٍّ قديم بلا إصدارات، أو تعذّرت القراءة).
 * سياسة RLS (0055) تُظهر للاعب الإصدار الجاري المنشور لتحدٍّ يراه فقط؛ لا حلّ هنا ولا محتوى. تُستعمل لعرض عنوان التحدي ووصفه
 * بنفس منطق لغة محتواه (لغة اللاعب ← الافتراضية ← الاحتياط) قبل بدء المحاولة. أثناء المحاولة تأتي اللغة من إصدارها المثبَّت (get_my_attempt_challenge).
 */
export async function getChallengeLanguage(challengeId) {
  const row = unwrap(await supabase.from('game_challenge_versions').select('default_language, allow_language_fallback')
    .eq('challenge_id', challengeId).eq('status', 'published').maybeSingle());
  return row ? { default_language: row.default_language, allow_language_fallback: row.allow_language_fallback } : null;
}
