import { supabase } from '../../../services/supabase/client';
import { COLUMNS, clampLimit, unwrap } from './gamesCore.shared';

/** النقاط والمستويات والإنجازات (قراءة فقط؛ المنح كلّه على الخادم). */

/** { total_points, level, next_level, solved_challenges, attempts_count, achievements_count }. */
export async function getMyGameSummary() {
  return unwrap(await supabase.rpc('get_my_game_summary'));
}

/** سجلّ نقاطي (الأحدث أولًا). */
export async function getMyPoints({ limit } = {}) {
  return unwrap(await supabase.from('game_points').select(COLUMNS.point).order('created_at', { ascending: false }).limit(clampLimit(limit))) || [];
}

/** كل مستويات التقدم مرتبة تصاعديًا. */
export async function getGameLevels() {
  return unwrap(await supabase.from('game_levels').select(COLUMNS.level).order('min_points')) || [];
}

/** تعريفات الإنجازات النشطة. */
export async function getGameAchievements() {
  return unwrap(await supabase.from('game_achievements').select(COLUMNS.achievement).order('sort_order').order('code')) || [];
}

/** إنجازاتي المفتوحة: [{ unlocked_at, achievement: {...} }]. */
export async function getMyAchievements() {
  const rows = unwrap(
    await supabase
      .from('game_user_achievements')
      .select(`unlocked_at, achievement:game_achievements(${COLUMNS.achievement})`)
      .order('unlocked_at', { ascending: false }),
  );
  return rows || [];
}
