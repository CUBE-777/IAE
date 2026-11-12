import { useEffect, useState } from 'react';

/**
 * ثوانٍ متبقية حتى expiresAt (ISO) أو null إن لم يكن هناك حدّ. للعرض فقط: الخادم هو من يقرّر الانتهاء.
 * offsetMs = (ساعة الجهاز − ساعة الخادم) المقدَّرة عند بدء المحاولة لتخفيف انحراف ساعة الجهاز.
 */
export function useCountdown(expiresAt, offsetMs = 0, active = true) {
  const compute = () => (expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() + offsetMs - Date.now()) / 1000)) : null);
  const [left, setLeft] = useState(compute);

  useEffect(() => {
    setLeft(compute());
    if (!expiresAt || !active) return undefined;
    const id = setInterval(() => setLeft(compute()), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, offsetMs, active]);

  return left;
}
