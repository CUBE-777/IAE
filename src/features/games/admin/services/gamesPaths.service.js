import { supabase } from '../../../../services/supabase/client';
import { unwrapAdmin } from './gamesAdmin.shared';

/**
 * خدمة إدارة مسارات التعلم (المرحلة 6.2): Game → Track → Category → Stage → Challenge.
 * القراءة والكتابة على المسارات/الفئات/المراحل عبر RLS (game_*_manage = can_manage_games()) وقيود 0055 ومشغّل التدقيق؛
 * إعادة الترتيب والمنح والإسناد عبر RPC (0056). لا حذف مباشر (سُحب في 0056): الإزالة = أرشفة.
 * الواجهة لا تحمي شيئًا بنفسها، ولا تحسب الفتح/الإكمال: الخادم وحده (game_stage_is_unlocked / game_stage_is_complete).
 */

const COL = {
  track: 'id, game_id, slug, title, description, status, sort_order, created_at, updated_at',
  category: 'id, game_id, track_id, slug, title, description, status, sort_order, stage_unlock_mode, created_at, updated_at',
  stage: 'id, game_id, category_id, slug, title, description, status, sort_order, completion_mode, completion_threshold, created_at, updated_at',
  // أعمدة البنية فقط: بلا content ولا حلول
  challenge: 'id, game_id, slug, title, status, stage_id, is_required, sort_order',
};

const rpc = async (fn, args) => unwrapAdmin(await supabase.rpc(fn, args));
const bySort = (q) => q.order('sort_order').order('created_at').order('id');

/** كل بنية لعبة واحدة: { gameId, tracks, categories, stages, challenges } (مصفوفات مسطّحة؛ التجميع في الواجهة). */
export async function listPaths(gameId) {
  const [tracks, categories, stages, challenges] = await Promise.all([
    bySort(supabase.from('game_tracks').select(COL.track).eq('game_id', gameId)),
    bySort(supabase.from('game_track_categories').select(COL.category).eq('game_id', gameId)),
    bySort(supabase.from('game_stages').select(COL.stage).eq('game_id', gameId)),
    bySort(supabase.from('game_challenges').select(COL.challenge).eq('game_id', gameId)),
  ]);
  return {
    gameId,
    tracks: unwrapAdmin(tracks) || [],
    categories: unwrapAdmin(categories) || [],
    stages: unwrapAdmin(stages) || [],
    challenges: unwrapAdmin(challenges) || [],
  };
}

const save = async (table, id, payload) => {
  const q = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert(payload);
  return unwrapAdmin(await q.select('id').single());
};
const setStatus = async (table, id, status) =>
  unwrapAdmin(await supabase.from(table).update({ status }).eq('id', id).select('id').single());

export const saveTrack = (id, payload) => save('game_tracks', id, payload);
export const saveTrackCategory = (id, payload) => save('game_track_categories', id, payload);
export const saveStage = (id, payload) => save('game_stages', id, payload);

export const PATH_TABLES = { track: 'game_tracks', category: 'game_track_categories', stage: 'game_stages' };
export const setPathStatus = (kind, id, status) => setStatus(PATH_TABLES[kind], id, status);

/** kind: 'track' | 'category' | 'stage'؛ ids = كل الإخوة بالترتيب الجديد (الخادم يرفض غير ذلك). */
export const reorderPathItems = (kind, ids) => rpc('admin_reorder_game_path_items', { p_kind: kind, p_ids: ids });

/** إسناد تحدٍّ قائم إلى مرحلة (stageId = null لفكّه) وتحديد كونه إلزاميًا. */
export const setChallengeStage = (challengeId, stageId, isRequired = true) =>
  rpc('admin_set_game_challenge_stage', { p_challenge_id: challengeId, p_stage_id: stageId, p_is_required: isRequired });

// ---- المنح اليدوي ----
export const listStageGrants = (stageId) => rpc('admin_list_game_stage_grants', { p_stage_id: stageId });
/** kind: 'unlock' (فئة manual) | 'complete' (مرحلة manual). يعيد { result: 'granted' | 'exists' }. */
export const grantStage = (stageId, userId, kind, note) =>
  rpc('admin_grant_game_stage', { p_stage_id: stageId, p_user_id: userId, p_kind: kind, p_note: note || null });
export const revokeStageGrant = (grantId) => rpc('admin_revoke_game_stage_grant', { p_grant_id: grantId });
/** الحالة كما يحسبها الخادم الآن للاعب (للتحقق الإداري فقط). */
export const getStageStatus = (stageId, userId) => rpc('admin_get_game_stage_status', { p_stage_id: stageId, p_user_id: userId });
