import { supabase } from '../../../services/supabase/client';
import { COLUMNS, clampLimit, currentUserId, unwrap } from './gamesCore.shared';

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

/**
 * «الآن» عند الخادم بالميلي ثانية (get_game_server_time، 0054). للعدّاد المعروض فقط؛ الحَكَم الفعلي هو الخادم عند البدء والتسليم.
 */
export async function getGameServerTime() {
  const ms = new Date(unwrap(await supabase.rpc('get_game_server_time'))).getTime();
  if (!Number.isFinite(ms)) throw new Error('invalid_server_time');
  return ms;
}

/**
 * (ساعة الجهاز − ساعة الخادم) بالميلي ثانية، مقيسةً بمنتصف زمن الذهاب والإياب لتخفيف أثر التأخير.
 * ترجع null إن تعذّر القياس (شبكة، أو 0054 لم تُطبَّق بعد)؛ فيعتمد المستدعي تقديرًا احتياطيًا ولا يتعطّل اللعب.
 */
export async function measureClockOffset() {
  const sent = Date.now();
  try {
    const server = await getGameServerTime();
    return Math.round((sent + Date.now()) / 2 - server);
  } catch {
    return null;
  }
}

/** محاولاتي (الأحدث أولًا)، اختياريًا لتحدٍّ واحد. */
export async function getMyAttempts({ challengeId, limit } = {}) {
  const uid = await currentUserId();
  let q = supabase.from('game_attempts').select(COLUMNS.attempt).eq('user_id', uid).order('started_at', { ascending: false }).limit(clampLimit(limit));
  if (challengeId) q = q.eq('challenge_id', challengeId);
  return unwrap(await q) || [];
}

/** نتائجي (الأحدث أولًا)، اختياريًا لتحدٍّ واحد. */
export async function getMyResults({ challengeId, limit } = {}) {
  const uid = await currentUserId();
  let q = supabase.from('game_results').select(COLUMNS.result).eq('user_id', uid).order('created_at', { ascending: false }).limit(clampLimit(limit));
  if (challengeId) q = q.eq('challenge_id', challengeId);
  return unwrap(await q) || [];
}
