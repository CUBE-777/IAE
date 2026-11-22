import { supabase } from '../../../services/supabase/client';
import { GAMES_STATUS, GAMES_STATUS_KEY, createGamesStatusStore, isMissingStatusFunction, normalizeGamesStatus } from './gamesStatusCore';

/**
 * حالة قسم الألعاب من الخادم: get_games_section_status() (0062) تعيد 'enabled' | 'maintenance' وتشاركها الواجهة والحارس نفس المنطق (games_section_enabled()).
 * الواجهة هنا للعرض فقط؛ الحدّ الأمني الفعلي: can_access_games() في RLS/RPC (0062).
 */
export async function fetchGamesSectionStatus() {
  const { data, error } = await supabase.rpc('get_games_section_status');
  if (error) {
    if (isMissingStatusFunction(error)) {
      console.warn('get_games_section_status غير موجودة: شغّل 0062_games_maintenance_mode.sql. تُعامل الألعاب كمفعّلة.');
      return GAMES_STATUS.ENABLED;
    }
    throw error;
  }
  return normalizeGamesStatus(data);
}

/** Realtime: أي تغيير في صف المفتاح يُطلق إعادة جلب (لا نثق بحمولة البثّ؛ القرار دائمًا من RPC). الفشل صامت: المؤقّت وتركيز التبويب يغطّيان. */
function listenRealtime(onChange) {
  let channel = null;
  try {
    channel = supabase
      .channel('games-section-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings', filter: `key=eq.${GAMES_STATUS_KEY}` }, () => onChange())
      .subscribe();
  } catch (err) {
    console.warn('games status realtime unavailable', err);
  }
  return () => { if (channel) supabase.removeChannel(channel); };
}

export const gamesStatusStore = createGamesStatusStore({
  fetchStatus: fetchGamesSectionStatus,
  listen: listenRealtime,
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  addVisibilityListener: (cb) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', cb);
    window.addEventListener('online', cb);
    return () => { document.removeEventListener('visibilitychange', cb); window.removeEventListener('online', cb); };
  },
});
