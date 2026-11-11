import { supabase } from '../../../services/supabase/client';
import { COLUMNS, unwrap } from './gamesCore.shared';

/**
 * كتالوج الألعاب (قراءة فقط). RLS (0050) تُرجع للاعب المنشور فقط، وللمدير الكل؛ والحلول محفوظة في جدول مغلق عن اللاعبين فلا تُقرأ من هنا أبدًا.
 */

/** تصنيفات نشطة مرتبة. */
export async function getGameCategories() {
  return unwrap(await supabase.from('game_categories').select(COLUMNS.category).order('sort_order').order('slug')) || [];
}

/** ألعاب منشورة، مع تصفية اختيارية بالتصنيف أو النوع. */
export async function getGames({ categoryId, kind } = {}) {
  let q = supabase.from('games').select(COLUMNS.game).order('sort_order').order('slug');
  if (categoryId) q = q.eq('category_id', categoryId);
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q) || [];
}

/** لعبة واحدة بالـ slug أو null. */
export async function getGameBySlug(slug) {
  return unwrap(await supabase.from('games').select(COLUMNS.game).eq('slug', String(slug || '')).maybeSingle());
}

/** تحديات لعبة (الظاهرة للاعب فقط)، مع تصفية اختيارية بالصعوبة 1..5. */
export async function getChallenges(gameId, { difficulty } = {}) {
  let q = supabase.from('game_challenges').select(COLUMNS.challenge).eq('game_id', gameId).order('sort_order').order('slug');
  if (Number.isInteger(difficulty)) q = q.eq('difficulty', difficulty);
  return unwrap(await q) || [];
}

/** تحدٍّ واحد بالمعرّف أو null. */
export async function getChallengeById(challengeId) {
  return unwrap(await supabase.from('game_challenges').select(COLUMNS.challenge).eq('id', challengeId).maybeSingle());
}
