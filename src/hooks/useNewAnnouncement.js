import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchLatestAnnouncementStamp } from '../services/supabase/announcements.service';
import { isNewer, markSeen, readSeen } from '../utils/announcementSeen';

/**
 * true إن وُجد إعلان أحدث مما رآه العضو. أول زيارة (لا قيمة محفوظة) لا تُظهر نقطة على إعلانات قديمة، وزيارة
 * صفحة الإعلانات تُسجَّل «رُئي». فشل الجلب أو التخزين صامت: لا نقطة.
 */
export function useNewAnnouncement() {
  const { pathname } = useLocation();
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchLatestAnnouncementStamp()
      .then((stamp) => {
        if (!alive || stamp == null) return;
        const seen = readSeen();
        if (seen === null || pathname.startsWith('/member/announcements')) {
          markSeen(stamp);
          setHasNew(false);
          return;
        }
        setHasNew(isNewer(stamp, seen));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);

  return hasNew;
}
