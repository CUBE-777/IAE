import { useEffect, useState } from 'react';

/**
 * ثوانٍ متبقية حتى expiresAt (ISO) أو null إن لم يكن هناك حدّ. للعرض فقط: الخادم هو من يقرّر الانتهاء.
 * offsetMs = (ساعة الجهاز − ساعة الخادم) المقيسة من الخادم عند بدء المحاولة أو استئنافها (measureClockOffset).
 *
 * القيمة تُحسب أثناء الرسم نفسه لا من حالة مخزَّنة: الحالة المخزَّنة تتأخر دورة رسم عند تغيّر expiresAt
 * فتُظهر 0 القديمة لمحاولة جديدة وتُسقطها في «انتهى الوقت» فور البدء. المؤقّت أدناه لا يفعل سوى إعادة الرسم كل نصف ثانية.
 */
export function useCountdown(expiresAt, offsetMs = 0, active = true) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!expiresAt || !active) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [expiresAt, active]);

  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime() + (Number.isFinite(offsetMs) ? offsetMs : 0);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : null;
}
