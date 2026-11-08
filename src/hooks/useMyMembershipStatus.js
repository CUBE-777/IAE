import { useCallback, useEffect, useState } from 'react';
import { getMyMembershipStatus } from '../services/supabase/memberSpace.service';

/**
 * حالة انخراط العضو للموسم الحالي (get_my_membership_status). status: undefined = جارٍ التحميل | null = لا حالة | كائن.
 * الفشل لا يكسر الصفحة: يُرجع failed = true مع reload لإعادة المحاولة.
 */
export function useMyMembershipStatus() {
  const [state, setState] = useState({ status: undefined, failed: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => (prev.status === undefined ? prev : { status: prev.status, failed: false }));
    getMyMembershipStatus()
      .then((status) => alive && setState({ status, failed: false }))
      .catch(() => alive && setState((prev) => ({ status: prev.status, failed: true })));
    return () => { alive = false; };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { status: state.status, failed: state.failed, reload };
}
