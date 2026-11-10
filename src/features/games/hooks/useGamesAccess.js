import { useCallback, useEffect, useState } from 'react';
import { getGamesAccess } from '../services/games.service';

/**
 * حالة الوصول إلى الألعاب من الخادم. phase: 'idle' (لا مستخدم) | 'loading' | 'ready' | 'error'.
 * يُعاد الفحص عند تغيّر المستخدم أو قيمة `deps` (مثل تغيّر مستوى MFA) أو عند reload().
 */
export function useGamesAccess(userId, { enabled = true, deps = '' } = {}) {
  const [state, setState] = useState({ phase: 'idle', access: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId || !enabled) {
      setState({ phase: 'idle', access: null });
      return undefined;
    }
    let alive = true;
    setState({ phase: 'loading', access: null });
    getGamesAccess()
      .then((access) => alive && setState({ phase: 'ready', access }))
      .catch((err) => {
        console.error('games access failed', err);
        if (alive) setState({ phase: 'error', access: null });
      });
    return () => {
      alive = false;
    };
  }, [userId, enabled, deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** true فقط عند السماح الصريح؛ أي فشل أو رفض يُخفي رابط الدخول دون خطأ ظاهر. */
export function useCanSeeGamesLink(userId, enabled = true) {
  const { phase, access } = useGamesAccess(userId, { enabled });
  return phase === 'ready' && access?.allowed === true;
}
