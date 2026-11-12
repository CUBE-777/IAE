import { supabase } from '../../../services/supabase/client';
import { COLUMNS, clampLimit, currentUserId, unwrap } from './gamesCore.shared';

/** النقاط والمستويات والإنجازات (قراءة فقط؛ المنح كلّه على الخادم). */

/** { total_points, level, next_level, solved_challenges, attempts_count, achievements_count }. */
export async function getMyGameSummary() {
  return unwrap(await supabase.rpc('get_my_game_summary'));
}

/** سجلّ نقاطي (الأحدث أولًا). */
export async function getMyPoints({ limit } = {}) {
  const uid = await currentUserId();
  return unwrap(await supabase.from('game_points').select(COLUMNS.point).eq('user_id', uid).order('created_at', { ascending: false }).limit(clampLimit(limit))) || [];
}

/** كل مستويات التقدم مرتبة تصاعديًا. */
export async function getGameLevels() {
  return unwrap(await supabase.from('game_levels').select(COLUMNS.level).order('min_points')) || [];
}

/** تعريفات الإنجازات النشطة. الشرط صريح لأن المدير يرى المعطّلة أيضًا في RLS ولا يجب أن تظهر له في ملفه كلاعب. */
export async function getGameAchievements() {
  return unwrap(await supabase.from('game_achievements').select(COLUMNS.achievement).eq('is_active', true).order('sort_order').order('code')) || [];
}

/** إنجازاتي المفتوحة: [{ unlocked_at, achievement: {...} }]. */
export async function getMyAchievements() {
  const uid = await currentUserId();
  const rows = unwrap(
    await supabase
      .from('game_user_achievements')
      .select(`unlocked_at, achievement:game_achievements(${COLUMNS.achievement})`)
      .eq('user_id', uid)
      .order('unlocked_at', { ascending: false }),
  );
  return rows || [];
}

/** حالة تحدياتي مجمَّعة من الخادم (0053): [{ challenge_id, attempts_used, solved, best_score, last_attempt_at, open_attempt_id, open_expires_at }]. */
export async function getMyChallengeStatus() {
  return unwrap(await supabase.rpc('get_my_challenge_status')) || [];
}

/** لوحة الصدارة (0053): { total, rows: [{ rank, display_name, total_points, level, is_me }], me }. أسماء مختصرة بلا بيانات شخصية. */
export async function getLeaderboard({ page = 1, pageSize = 20 } = {}) {
  const size = clampLimit(pageSize, 20, 50);
  return unwrap(await supabase.rpc('get_game_leaderboard', { p_limit: size, p_offset: (Math.max(page, 1) - 1) * size }));
}
