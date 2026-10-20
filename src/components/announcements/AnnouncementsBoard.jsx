import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AnnouncementCard from './AnnouncementCard';
import { fetchPublishedAnnouncements } from '../../services/supabase/announcements.service';

const BOARD_COUNT = 3;

/**
 * لوحة الإعلانات في الصفحة الرئيسية (بعد Hero وقبل About).
 * - بيانات ديناميكية من Supabase (المنشورة وغير المنتهية فقط عبر RLS).
 * - إن لم توجد إعلانات: يُخفى القسم كاملاً (لا قسم فارغ في أعلى الصفحة).
 * - إن فشل التحميل: رسالة خطأ + إعادة محاولة (لا نخفي الفشل كأنه "لا إعلانات").
 */
export default function AnnouncementsBoard() {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', rows: [], hasMore: false });

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    let alive = true;
    fetchPublishedAnnouncements({ limit: BOARD_COUNT })
      .then(({ rows, hasMore }) => alive && setState({ status: 'ok', rows, hasMore }))
      .catch((err) => {
        console.error('تعذر تحميل لوحة الإعلانات:', err);
        if (alive) setState({ status: 'error', rows: [], hasMore: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (state.status === 'ok' && state.rows.length === 0) return null;

  return (
    <section className="ann-board" id="announcements" aria-labelledby="annBoardTitle">
      <div className="container">
        <div className="ann-board-panel">
          <div className="ann-board-head">
            <span className="ann-board-icon" aria-hidden="true"><Megaphone size={22} /></span>
            <div>
              <div className="eyebrow">{t('announcements.eyebrow')}</div>
              <h2 id="annBoardTitle">{t('announcements.title')}</h2>
              <p>{t('announcements.subtitle')}</p>
            </div>
          </div>

          {state.status === 'loading' && <div className="ann-state" role="status">{t('announcements.loading')}</div>}
          {state.status === 'error' && (
            <div className="ann-state ann-state-error" role="alert">
              <span>{t('announcements.error')}</span>
              <button type="button" className="btn btn-ghost ann-retry" onClick={load}>{t('common.retry')}</button>
            </div>
          )}
          {state.status === 'ok' && (
            <>
              <div className="ann-board-list">
                {state.rows.map((row) => (
                  <AnnouncementCard key={row.id} announcement={row} variant="board" />
                ))}
              </div>
              <div className="ann-board-foot">
                <Link to="/announcements" className="btn btn-gold">{t('announcements.viewAll')}</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
