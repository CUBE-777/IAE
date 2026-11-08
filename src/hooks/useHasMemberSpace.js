import { useEffect, useState } from 'react';
import { getMyMember } from '../services/supabase/memberSpace.service';

/**
 * true إن كان حساب المسؤول الحالي مرتبطًا أيضًا بفضاء المنخرطين (حساب مزدوج، 0046) فيظهر رابط التبديل.
 * get_my_member تُرجع null لغير المنخرطين؛ أي فشل (شبكة أو 0046 غير مطبّقة) يُخفي الرابط ولا يُظهر خطأ.
 */
export function useHasMemberSpace(userId) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    setHas(false);
    if (userId) {
      getMyMember()
        .then((m) => alive && setHas(!!m))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [userId]);
  return has;
}
