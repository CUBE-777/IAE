import { useEffect, useState } from 'react';
import { canManageGames } from '../services/gamesAdmin.service';

/**
 * قرار الصلاحية من الخادم (can_manage_games: super_admin/developer + شروط الوصول).
 * phase: 'loading' | 'ready' | 'error'. أي فشل = لا إدارة (fail closed) مع إمكان إعادة المحاولة.
 */
export function useCanManageGames(userId) {
  const [state, setState] = useState({ phase: 'loading', allowed: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    setState({ phase: 'loading', allowed: false });
    canManageGames()
      .then((allowed) => alive && setState({ phase: 'ready', allowed }))
      .catch((err) => {
        console.error('can_manage_games failed', err);
        if (alive) setState({ phase: 'error', allowed: false });
      });
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}
