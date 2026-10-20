import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import AnnouncementCard from '../../components/announcements/AnnouncementCard';
import {
  ANNOUNCEMENT_TYPES, ANNOUNCEMENTS_PAGE_SIZE, fetchPublishedAnnouncements,
} from '../../services/supabase/announcements.service';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

/** /announcements — كل الإعلانات المنشورة مع تصفية بالنوع و"عرض المزيد". */
export default function Announcements() {
  const { t } = useTranslation();
  const [type, setType] = useState('');
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [loadingMore, setLoadingMore] = useState(false);

  useDocumentMeta(`${t('announcements.pageTitle')} — ${t('brand.name')}`, t('announcements.pageDescription'));

  const load = useCallback(() => {
    let alive = true;
    setStatus('loading');
    fetchPublishedAnnouncements({ limit: ANNOUNCEMENTS_PAGE_SIZE, offset: 0, type })
      .then((res) => {
        if (!alive) return;
        setRows(res.rows);
        setHasMore(res.hasMore);
        setStatus('ok');
      })
      .catch((err) => {
        console.error('تعذر تحميل الإعلانات:', err);
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [type]);

  useEffect(() => load(), [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchPublishedAnnouncements({ limit: ANNOUNCEMENTS_PAGE_SIZE, offset: rows.length, type });
      setRows((r) => [...r, ...res.rows]);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('تعذر تحميل المزيد:', err);
      window.notify?.error(t('announcements.error'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('announcements.crumb') }]}
        title={t('announcements.pageTitle')}
        description={t('announcements.pageDescription')}
      />
      <section className="ann-page">
        <div className="container">
          <div className="ann-filters" role="group" aria-label={t('announcements.filterLabel')}>
            {['', ...ANNOUNCEMENT_TYPES].map((k) => (
              <button
                key={k || 'all'}
                type="button"
                className={`ann-filter${type === k ? ' active' : ''}`}
                aria-pressed={type === k}
                onClick={() => setType(k)}
              >
                {k ? t(`announcements.types.${k}`) : t('announcements.filterAll')}
              </button>
            ))}
          </div>

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
        </div>
      </section>
    </InteriorLayout>
  );
}
