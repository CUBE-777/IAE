import { supabase } from '../../../../services/supabase/client';
import { GamesError } from '../../services/gamesCore.shared';
import { toAdminError } from './gamesAdmin.shared';
import { saveChallenge } from './gamesAdmin.service';

/**
 * خدمة محرر التحديات (المرحلة 6.3). كل شيء خلف RLS/RPC (can_manage_games() = super_admin/developer فقط):
 *   - القراءة: game_challenge_versions وgame_challenge_version_solutions (الحلّ والشرح للمدير فقط؛ لا سياسة للاعب).
 *   - الكتابة: admin_save_game_challenge_draft (مسودّة + حلّ + شرح ذرّيًا، 0057) ثم admin_publish_game_challenge_version (0055).
 * الواجهة لا تحمي شيئًا ولا تتحقق نهائيًا: الخادم يرفض أي محتوى غير صالح عند النشر. لا يُعاد الحلّ إلا لمدير يقرؤه ليحرّره.
 */

const VERSION_COLS = 'id, challenge_id, version_no, status, default_language, allow_language_fallback, title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content, change_note, created_at, published_at, updated_at';
const CHALLENGE_COLS = 'id, game_id, slug, title, description, status, current_version_id, stage_id, is_required';

/** دالة/عمود 0057 غير موجود (لم تُطبَّق الـ Migration بعد) → رمز واضح بدل خطأ مبهم. */
const MISSING_CODES = new Set(['PGRST202', 'PGRST204', '42883', '42703']);
function unwrap({ data, error }) {
  if (error) {
    if (MISSING_CODES.has(error.code)) throw new GamesError('builder_unavailable', error);
    throw toAdminError(error);
  }
  return data;
}
const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args));

export async function getChallengeRow(challengeId) {
  return unwrap(await supabase.from('game_challenges').select(CHALLENGE_COLS).eq('id', challengeId).maybeSingle());
}

/** كل إصدارات التحدي من الأحدث. */
export async function listChallengeVersions(challengeId) {
  return unwrap(await supabase.from('game_challenge_versions').select(VERSION_COLS).eq('challenge_id', challengeId).order('version_no', { ascending: false })) || [];
}

/** { verify_mode, solution, feedback } أو null (للمدير فقط). */
export async function getVersionSolution(versionId) {
  return unwrap(await supabase.from('game_challenge_version_solutions').select('verify_mode, solution, feedback').eq('version_id', versionId).maybeSingle());
}

/** يحفظ المسودّة المفتوحة (أو ينشئها). challengeId = null ينشئ هيكل تحدٍّ draft (يلزم game_id وslug في data). */
export const saveChallengeDraft = (challengeId, versionId, data) =>
  rpc('admin_save_game_challenge_draft', { p_challenge_id: challengeId || null, p_version_id: versionId || null, p_data: data });

/** نشر إصدار (آلية 0055 الموجودة): يؤرشف المنشور السابق ولا يمسّ المحاولات الجارية. */
export const publishChallengeVersion = (versionId) => rpc('admin_publish_game_challenge_version', { p_version_id: versionId });

/** حالة التحدي (draft | published | archived) عبر الدالة الإدارية الموجودة (لا تغيّر الإصدارات). */
export const setChallengeStatus = (challengeId, status) => saveChallenge(challengeId, { status });
