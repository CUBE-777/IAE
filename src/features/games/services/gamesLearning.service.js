import { supabase } from '../../../services/supabase/client';
import { unwrap } from './gamesCore.shared';

/**
 * مسارات التعلم للاعب (6.4، قراءة فقط). كل ما يُعاد محسوب على الخادم (0058): الفتح والإكمال والنسب وسبب القفل.
 * الواجهة لا تحسب شيئًا من هذا ولا تحكم بالسماح؛ الحدّ الفعلي start_game_attempt (يفرض فتح المرحلة عند بدء محاولة جديدة).
 * لا يُعاد محتوى التحدي ولا الحلول: الاستجابة بيانات عرض فقط.
 */

/** [{ id, slug, title, description, game: {id, slug, title}, categories_count, stages_count, stages_completed, challenges_total, challenges_solved, progress_percent }] */
export async function getMyLearningTracks({ gameId } = {}) {
  return unwrap(await supabase.rpc('get_my_learning_tracks', { p_game_id: gameId || null })) || [];
}

/** { track: {...}, categories: [{ id, title, stage_unlock_mode, stages: [{ id, title, state, is_unlocked, is_complete, progress, lock_reason, ... }] }] } */
export async function getMyLearningTrack(trackId) {
  return unwrap(await supabase.rpc('get_my_learning_track', { p_track_id: trackId }));
}

/** { game, track, category, stage, is_unlocked, is_complete, state, lock_reason, progress, previous_stage, next_stage, challenges: [...] } */
export async function getMyLearningStage(stageId) {
  return unwrap(await supabase.rpc('get_my_learning_stage', { p_stage_id: stageId }));
}
