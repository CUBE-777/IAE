import { supabase } from '../../../services/supabase/client';
import { COLUMNS, GamesError, clampLimit, currentUserId, unwrap } from './gamesCore.shared';

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
 * 6.5: يتأكد من شكل حمولة اللعب القادمة من الخادم قبل استعمالها. شكل غير متوقع = خطأ صريح لا تخمين.
 * الحمولة: { attempt, challenge, game, version } — محتوى «علني» فقط لإصدار المحاولة المثبَّت (0059)، بلا حلّ ولا شرح ولا معرّف إصدار.
 */
function toPlayPayload(p) {
  const ok = p && typeof p === 'object' && p.attempt?.id && p.challenge?.id && p.game?.id
    && p.challenge.content && typeof p.challenge.content === 'object' && !Array.isArray(p.challenge.content);
  if (!ok) throw new GamesError('unknown');
  return p;
}

/**
 * محتوى محاولة محدّدة من «إصدارها المثبَّت» (game_attempts.challenge_version_id) لا من الإصدار الجاري (get_my_attempt_challenge، 0059).
 * محاولتي أنا فقط وجارية وغير منتهية؛ وإلا يرمي attempt_not_found / attempt_already_finished. إصدار غير صالح: attempt_version_unavailable
 * (لا استبدال تلقائي بالإصدار الجاري). المعرّف يأتي دائمًا من start_game_attempt أو get_my_open_attempt_challenge؛ الخادم يتحقق من الملكية.
 */
export async function getAttemptChallenge(attemptId) {
  return toPlayPayload(unwrap(await supabase.rpc('get_my_attempt_challenge', { p_attempt_id: attemptId })));
}

/**
 * محاولتي الجارية على هذا التحدي (إن وُجدت) مع محتواها من إصدارها المثبَّت، أو null. تعمل حتى لو سُحب نشر التحدي/اللعبة
 * أو نُشر إصدار أحدث بعد بدء المحاولة (0059). لا تكشف شيئًا لمن لا يملك محاولة جارية.
 */
export async function getOpenAttemptChallenge(challengeId) {
  const p = unwrap(await supabase.rpc('get_my_open_attempt_challenge', { p_challenge_id: challengeId }));
  return p ? toPlayPayload(p) : null;
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
