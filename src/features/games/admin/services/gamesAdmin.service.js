import { supabase } from '../../../../services/supabase/client';
import { clampLimit } from '../../services/gamesCore.shared';
import { unwrapAdmin } from './gamesAdmin.shared';

/**
 * خدمة إدارة الألعاب (المرحلة 3). كل العمليات خلف RLS/RPC (0050/0052) عبر can_manage_games() = super_admin/developer فقط؛
 * الواجهة لا تحمي شيئًا بنفسها. لا service_role ولا كتابة مباشرة على النقاط/النتائج/المحاولات: التسوية عبر admin_adjust_game_points فقط.
 */

const COL = {
  category: 'id, slug, name, description, icon, sort_order, is_active, created_at, updated_at',
  game: 'id, category_id, slug, kind, title, description, status, sort_order, config, created_at, updated_at',
  challenge: 'id, game_id, slug, title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content, status, starts_at, ends_at, sort_order, current_version_id, created_at, updated_at',
  achievement: 'id, code, title, description, icon, points_bonus, criteria, is_active, sort_order, created_at, updated_at',
  level: 'level, min_points, title, icon',
  attempt: 'id, challenge_id, status, started_at, expires_at, finished_at',
  result: 'id, attempt_id, challenge_id, is_correct, score, duration_ms, created_at',
  point: 'id, delta, reason, challenge_id, achievement_id, note, created_by, created_at',
};

const rpc = async (fn, args) => unwrapAdmin(await supabase.rpc(fn, args));

/** القرار الفعلي للصلاحية من الخادم (للواجهة فقط؛ الحماية في RLS/RPC). */
export async function canManageGames() {
  return (await rpc('can_manage_games')) === true;
}

export const reorderItems = (kind, ids) => rpc('admin_reorder_game_items', { p_kind: kind, p_ids: ids });

// ---- التصنيفات ----
export async function listCategories() {
  return unwrapAdmin(await supabase.from('game_categories').select(COL.category).order('sort_order').order('slug')) || [];
}
export async function saveCategory(id, payload) {
  const q = id ? supabase.from('game_categories').update(payload).eq('id', id) : supabase.from('game_categories').insert(payload);
  return unwrapAdmin(await q.select('id').single());
}
export async function setCategoryActive(id, isActive) {
  return unwrapAdmin(await supabase.from('game_categories').update({ is_active: isActive }).eq('id', id).select('id').single());
}

// ---- الألعاب ----
export async function listGames() {
  return unwrapAdmin(await supabase.from('games').select(COL.game).order('sort_order').order('slug')) || [];
}
export async function saveGame(id, payload) {
  const q = id ? supabase.from('games').update(payload).eq('id', id) : supabase.from('games').insert(payload);
  return unwrapAdmin(await q.select('id').single());
}
export async function setGameStatus(id, status) {
  return unwrapAdmin(await supabase.from('games').update({ status }).eq('id', id).select('id').single());
}
/** { result: 'deleted' | 'archived' } — يؤرشف بدل الحذف إن وُجد سجلّ لاعبين. */
export const deleteGame = (id) => rpc('admin_delete_game', { p_id: id });

// ---- التحديات ----
export async function listChallenges() {
  return unwrapAdmin(await supabase.from('game_challenges').select(COL.challenge).order('sort_order').order('slug')) || [];
}
/** الحلّ للمدير فقط (RLS)؛ يرجع { verify_mode, solution } أو null. لا يُعرض لغير المدير ولا يُسجَّل. */
export async function getChallengeSolution(challengeId) {
  return unwrapAdmin(await supabase.from('game_challenge_solutions').select('verify_mode, solution').eq('challenge_id', challengeId).maybeSingle());
}
export const saveChallenge = (id, data) => rpc('admin_save_game_challenge', { p_id: id || null, p_data: data });
export const deleteChallenge = (id) => rpc('admin_delete_game_challenge', { p_id: id });

// ---- الإنجازات ----
export async function listAchievements() {
  return unwrapAdmin(await supabase.from('game_achievements').select(COL.achievement).order('sort_order').order('code')) || [];
}
export async function saveAchievement(id, payload) {
  const q = id ? supabase.from('game_achievements').update(payload).eq('id', id) : supabase.from('game_achievements').insert(payload);
  return unwrapAdmin(await q.select('id').single());
}
export async function setAchievementActive(id, isActive) {
  return unwrapAdmin(await supabase.from('game_achievements').update({ is_active: isActive }).eq('id', id).select('id').single());
}

// ---- المستويات ----
export async function listLevels() {
  return unwrapAdmin(await supabase.from('game_levels').select(COL.level).order('min_points')) || [];
}
/** originalLevel = رقم المستوى قبل التعديل (null للجديد). رقم المستوى مفتاح أساسي فلا يُغيَّر عند التعديل. */
export async function saveLevel(originalLevel, payload) {
  const q = originalLevel == null
    ? supabase.from('game_levels').insert(payload)
    : supabase.from('game_levels').update({ min_points: payload.min_points, title: payload.title, icon: payload.icon }).eq('level', originalLevel);
  return unwrapAdmin(await q.select('level').single());
}
export async function deleteLevel(level) {
  return unwrapAdmin(await supabase.from('game_levels').delete().eq('level', level).select('level').single());
}

// ---- اللاعبون (قراءة) ----
export async function listPlayers({ search = '', page = 1, pageSize = 25 } = {}) {
  const size = clampLimit(pageSize, 25, 100);
  return rpc('admin_list_game_players', { p_search: search || null, p_limit: size, p_offset: (Math.max(page, 1) - 1) * size });
}
export const getPlayer = (userId) => rpc('admin_get_game_player', { p_user_id: userId });
export const getPlayerProgress = (userId) => rpc('admin_get_game_player_progress', { p_user_id: userId });
export async function getPlayerPoints(userId, limit = 50) {
  return unwrapAdmin(await supabase.from('game_points').select(COL.point).eq('user_id', userId).order('created_at', { ascending: false }).limit(clampLimit(limit))) || [];
}
export async function getPlayerResults(userId, limit = 30) {
  return unwrapAdmin(await supabase.from('game_results').select(COL.result).eq('user_id', userId).order('created_at', { ascending: false }).limit(clampLimit(limit))) || [];
}
export async function getPlayerAttempts(userId, limit = 30) {
  return unwrapAdmin(await supabase.from('game_attempts').select(COL.attempt).eq('user_id', userId).order('started_at', { ascending: false }).limit(clampLimit(limit))) || [];
}
export async function getPlayerAchievements(userId) {
  return unwrapAdmin(await supabase.from('game_user_achievements').select('achievement_id, unlocked_at').eq('user_id', userId).order('unlocked_at', { ascending: false })) || [];
}

// ---- تسوية النقاط: الدالة الوحيدة المسموحة لتعديل النقاط ----
export const adjustPoints = (userId, delta, note) => rpc('admin_adjust_game_points', { p_user_id: userId, p_delta: delta, p_note: note });
