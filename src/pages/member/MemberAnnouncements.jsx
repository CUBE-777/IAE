import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MemberPage from '../../components/member/MemberPage';
import AnnouncementCard from '../../components/announcements/AnnouncementCard';
import { ANNOUNCEMENTS_PAGE_SIZE, fetchPublishedAnnouncements } from '../../services/supabase/announcements.service';

/** إعلانات النادي داخل فضاء المنخرطين: نفس الإعلانات المنشورة علنًا (RLS)، لكن بين يدي العضو دون مغادرة فضائه. */
export default function MemberAnnouncements() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setStatus('loading');
    fetchPublishedAnnouncements({ limit: ANNOUNCEMENTS_PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (!alive) return;
        setRows(res.rows);
        setHasMore(res.hasMore);
        setStatus('ok');
      })
      .catch((err) => {
        console.error('member announcements failed', err);
        if (alive) setStatus('error');
      });
    return () => { alive = false; };
  }, []);
  useEffect(() => load(), [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchPublishedAnnouncements({ limit: ANNOUNCEMENTS_PAGE_SIZE, offset: rows.length });
      setRows((r) => [...r, ...res.rows]);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('member announcements more failed', err);
      window.notify?.error(t('announcements.error'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <MemberPage titleKey="member.announcements.title" descriptionKey="member.announcements.description" pageTitleKey="member.announcements.pageTitle">
      {status === 'loading' && <div className="ann-state" role="status">{t('announcements.loading')}</div>}
      {status === 'error' && (
        <div className="ann-state ann-state-error" role="alert">
          <span>{t('announcements.error')}</span>
          <button type="button" className="interior-btn" onClick={load}>{t('common.retry')}</button>
        </div>
      )}
      {status === 'ok' && rows.length === 0 && <div className="ann-state">{t('announcements.empty')}</div>}
      {status === 'ok' && rows.length > 0 && (
        <>
          <div className="ann-grid">
            {rows.map((row) => <AnnouncementCard key={row.id} announcement={row} />)}
          </div>
          {hasMore && (
            <div className="ann-more">
              <button type="button" className="interior-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t('common.loading') : t('announcements.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </MemberPage>
  );
}
