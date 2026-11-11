import { GAMES_ERROR_CODES, GAMES_LANG_FALLBACK, GAMES_UNKNOWN_ERROR } from '../constants/gamesCore';

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

/** قيمة jsonb متعددة اللغات {ar,fr,en} باللغة المطلوبة مع احتياط؛ سلسلة فارغة إن لم يوجد شيء. */
export function pickLocalized(value, lang) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const l of [lang, ...GAMES_LANG_FALLBACK]) {
    const v = value[l];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** أعمدة صريحة بدل النجمة كي لا يتسرّب عمود جديد حساس تلقائيًا. */
export const COLUMNS = {
  category: 'id, slug, name, description, icon, sort_order',
  game: 'id, category_id, slug, kind, title, description, sort_order, config',
  challenge: 'id, game_id, slug, title, description, difficulty, points_reward, time_limit_seconds, max_attempts, content, starts_at, ends_at, sort_order',
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
