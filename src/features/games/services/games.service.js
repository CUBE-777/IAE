import { supabase } from '../../../services/supabase/client';
import { GAMES_ACCESS_REASONS, GAMES_UNKNOWN_REASON } from '../constants/games';

/**
 * خدمة وحدة الألعاب. get_games_access() (0049) ترجع jsonb: { allowed: boolean, reason: text [, season: text] }
 * وهي للواجهة فقط (رسالة الرفض)؛ الحدّ الأمني الفعلي في RLS/RPC عبر can_access_games().
 * أي رد غير مطابق للشكل المتوقع يُعامل رفضًا (fail closed).
 */
export function normalizeGamesAccess(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.allowed !== true && data.allowed !== false)) {
    return { allowed: false, reason: GAMES_UNKNOWN_REASON, season: null };
  }
  const reason = GAMES_ACCESS_REASONS.includes(data.reason) ? data.reason : GAMES_UNKNOWN_REASON;
  const season = typeof data.season === 'string' && data.season ? data.season : null;
  return { allowed: data.allowed === true, reason, season };
}

/** { allowed, reason, season }. يرمي عند فشل الاستدعاء (شبكة/خادم) ليعرض الحارس «إعادة المحاولة» لا رفضًا خاطئًا. */
export async function getGamesAccess() {
  const { data, error } = await supabase.rpc('get_games_access');
  if (error) throw error;
  return normalizeGamesAccess(data);
}
