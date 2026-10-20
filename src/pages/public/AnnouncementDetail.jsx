import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/public-home.css';
import '../../styles/interior-page.css';
import '../../styles/activity-page.css';
import '../../styles/not-found.css';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';
import { fetchAnnouncementBySlug } from '../../services/supabase/announcements.service';
import { announcementDate, formatDate, localizeAnnouncement } from '../../utils/i18nContent';
import { safeUrl } from '../../utils/sanitize';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

/** /announcement/:slug (و /announcements/:slug كمرادف). المحتوى نص عادي بفقرات — لا HTML خام. */
export default function AnnouncementDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const [state, setState] = useState({ status: 'loading', row: null }); // loading | ok | notfound | error

  const load = useCallback(() => {
    let alive = true;
    setState({ status: 'loading', row: null });
    fetchAnnouncementBySlug(slug)
      .then((row) => alive && setState(row ? { status: 'ok', row } : { status: 'notfound', row: null }))
      .catch((err) => {
        console.error('تعذر تحميل الإعلان:', err);
        if (alive) setState({ status: 'error', row: null });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => load(), [load]);

  const a = useMemo(() => (state.row ? localizeAnnouncement(state.row, i18n.language) : null), [state.row, i18n.language]);

  const metaTitle = a
    ? `${a.title} — ${t('brand.name')}`
    : state.status === 'notfound'
      ? `${t('announcements.notFoundTitle')} — ${t('brand.name')}`
      : undefined;
  useDocumentMeta(metaTitle, a ? a.excerpt || (a.content || '').slice(0, 160) : undefined);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: a?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        window.notify?.success(t('announcements.linkCopied'));
      }
    } catch {
      // إلغاء المشاركة من المستخدم — لا خطأ يُعرض
    }
  };

  const link = a ? safeUrl(a.link) : '';
  const img = a ? safeUrl(a.image_url) : '';
  const paragraphs = a?.content ? a.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];

  if (state.status === 'notfound' || state.status === 'error') {
    const notFound = state.status === 'notfound';
    return (
      <>
        <InteriorHeader />
        <section className="activity-hero not-found-hero">
          <div className="container">
            <div className="breadcrumbs">
              <Link to="/">{t('nav.home')}</Link><span>‹</span>
              <Link to="/announcements">{t('announcements.crumb')}</Link>
            </div>
            <h1>{notFound ? t('announcements.notFoundHero') : t('announcements.error')}</h1>
          </div>
        </section>
        <section className="not-found-section">
          <div className="container not-found-content">
            {notFound && <p className="not-found-code">404</p>}
            <h2>{notFound ? t('announcements.notFoundTitle') : t('announcements.error')}</h2>
            {notFound && <p className="not-found-text">{t('announcements.notFoundMessage')}</p>}
            <div className="not-found-actions">
              {!notFound && <button type="button" className="btn btn-gold" onClick={load}>{t('common.retry')}</button>}
              <Link to="/announcements" className={`btn ${notFound ? 'btn-gold' : 'btn-ghost'}`}>{t('announcements.backToList')}</Link>
            </div>
          </div>
        </section>
        <InteriorFooter />
      </>
    );
  }

  const loading = state.status === 'loading';
  const type = a?.type || 'general';

  return (
    <>
      <InteriorHeader />
      <section className="activity-hero">
        <div className="container">
          <div className="breadcrumbs">
            <Link to="/">{t('nav.home')}</Link><span>‹</span>
            <Link to="/announcements">{t('announcements.crumb')}</Link><span>‹</span>
            <span style={{ color: 'var(--gold)' }}>{loading ? '…' : a.title}</span>
          </div>
          <h1>{loading ? t('announcements.loading') : a.title}</h1>
          {!loading && (
            <div className="activity-meta-pills">
              <div className="meta-pill"><span className={`ann-badge ann-badge-${type}`}>{t(`announcements.types.${type}`)}</span></div>
              <div className="meta-pill">📅 <span>{t('announcements.publishedOn', { date: formatDate(announcementDate(a), i18n.language) })}</span></div>
              {a.end_at && <div className="meta-pill">⏳ <span>{t('announcements.expiresOn', { date: formatDate(a.end_at, i18n.language) })}</span></div>}
            </div>
          )}
        </div>
      </section>

      <section className="activity-detail-section">
        <div className="container">
          <article className="ann-detail">
            {img && (
              <div className="ann-detail-image">
                <img src={img} alt={t('announcements.imageAlt', { title: a?.title || '' })} />
              </div>
            )}
            {loading ? (
              <p>{t('announcements.loading')}</p>
            ) : (
              <div className="ann-detail-body">
                {a.excerpt && <p className="ann-detail-lead">{a.excerpt}</p>}
                {paragraphs.map((p, i) => <p key={i} className="ann-detail-p">{p}</p>)}
              </div>
            )}
            {!loading && (
              <div className="ann-detail-actions">
                {link && <a href={link} className="btn btn-gold" target="_blank" rel="noopener noreferrer">{t('announcements.externalLink')}</a>}
                {type === 'membership' && <a href="/#join" className="btn btn-gold">{t('announcements.joinCta')}</a>}
                <button type="button" className="btn btn-outline" onClick={share}>{t('announcements.share')}</button>
                <Link to="/announcements" className="btn btn-ghost ann-back">{t('announcements.backToList')}</Link>
              </div>
            )}
          </article>
        </div>
      </section>
      <InteriorFooter />
    </>
  );
}
