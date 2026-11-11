import { supabase } from '../../../services/supabase/client';
import { COLUMNS, clampLimit, unwrap } from './gamesCore.shared';

/**
 * المحاولات والنتائج. الواجهة لا ترسل نقاطًا ولا نتيجة ولا مدة: الخادم يحسبها كلها (submit_game_attempt).
 */

/** { attempt_id, challenge_id, status, started_at, expires_at, resumed }. تستأنف المحاولة الجارية إن وُجدت. */
export async function startAttempt(challengeId) {
  return unwrap(await supabase.rpc('start_game_attempt', { p_challenge_id: challengeId }));
}

/**
 * يسلّم الإجابة (قيمة JSON: كائن/مصفوفة/نص/رقم) ويعيد
 * { status, is_correct, score, points_awarded, total_points, level, achievements } — status='expired' إن انتهت المهلة.
 */
export async function submitAttempt(attemptId, answer) {
  return unwrap(await supabase.rpc('submit_game_attempt', { p_attempt_id: attemptId, p_answer: answer }));
}

/** محاولاتي (الأحدث أولًا)، اختياريًا لتحدٍّ واحد. */
export async function getMyAttempts({ challengeId, limit } = {}) {
  let q = supabase.from('game_attempts').select(COLUMNS.attempt).order('started_at', { ascending: false }).limit(clampLimit(limit));
  if (challengeId) q = q.eq('challenge_id', challengeId);
  return unwrap(await q) || [];
}

/** نتائجي (الأحدث أولًا)، اختياريًا لتحدٍّ واحد. */
export async function getMyResults({ challengeId, limit } = {}) {
  let q = supabase.from('game_results').select(COLUMNS.result).order('created_at', { ascending: false }).limit(clampLimit(limit));
  if (challengeId) q = q.eq('challenge_id', challengeId);
  return unwrap(await q) || [];
}
