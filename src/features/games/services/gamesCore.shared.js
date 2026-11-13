import { supabase } from '../../../services/supabase/client';
import { GAMES_ERROR_CODES, GAMES_UNKNOWN_ERROR } from '../constants/gamesCore';

/** خطأ موحّد: code من GAMES_ERROR_CODES (أو 'unknown') ليُترجم في الواجهة؛ لا نعرض نص الخادم الخام. */
export class GamesError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = 'GamesError';
    this.code = code;
    this.cause = cause;
  }
}

/** يحوّل خطأ Supabase/PostgREST إلى GamesError. نص استثناء RPC هو الرمز نفسه. */
export function toGamesError(error) {
  const msg = typeof error?.message === 'string' ? error.message.trim() : '';
  return new GamesError(GAMES_ERROR_CODES.includes(msg) ? msg : GAMES_UNKNOWN_ERROR, error);
}

/** يرمي عند الخطأ ويعيد البيانات. */
export function unwrap({ data, error }) {
  if (error) throw toGamesError(error);
  return data;
}

/** قيمة jsonb متعددة اللغات {ar,fr,en}: لغة اللاعب ← اللغة الافتراضية للإصدار (اختياري) ← الاحتياط. المنطق في gamesLang.js (نقي). */
export { pickLocalized } from './gamesLang';

/** أعمدة صريحة بدل النجمة كي لا يتسرّب عمود جديد حساس تلقائيًا. */
export const COLUMNS = {
  category: 'id, slug, name, description, icon, sort_order',
  game: 'id, category_id, slug, kind, title, description, sort_order, config',
  challenge: 'id, game_id, stage_id, slug, title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content, starts_at, ends_at, sort_order',
  level: 'level, min_points, title, icon',
  achievement: 'id, code, title, description, icon, points_bonus, sort_order',
  attempt: 'id, challenge_id, status, started_at, expires_at, finished_at',
  result: 'id, attempt_id, challenge_id, is_correct, score, duration_ms, created_at',
  point: 'id, delta, reason, challenge_id, achievement_id, note, created_at',
};

export const clampLimit = (n, def = 50, max = 200) => {
  const v = Number.isInteger(n) ? n : def;
  return Math.min(Math.max(v, 1), max);
};

/**
 * معرّف المستخدم الحالي لقراءات «صفوفي». ضروري لأن سياسات المدير (0050) تسمح لـ super_admin/developer بقراءة صفوف الجميع،
 * فلو اكتفينا بـ RLS لرأى المدير اللاعب سجلّات غيره في «ملفي». الحدّ الأمني يبقى RLS؛ هذا يضمن صحة العرض.
 */
export async function currentUserId() {
  const { data, error } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (error || !id) throw new GamesError('games_access_denied', error);
  return id;
}
