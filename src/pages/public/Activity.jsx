import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/public-home.css';
import '../../styles/interior-page.css';
import '../../styles/activity-page.css';
import '../../styles/not-found.css';
import InteriorHeader from '../../components/layout/InteriorHeader';
import InteriorFooter from '../../components/layout/InteriorFooter';
import Lightbox from '../../components/common/Lightbox';
import { fetchActivityBySlug } from '../../services/supabase/activityDetail.service';
import { defaultActivities } from '../../constants/defaultActivities';
import { sanitizeRichText, safeUrl } from '../../utils/sanitize';
import { formatDate, localizeActivityDetail } from '../../utils/i18nContent';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export default function Activity() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  // status: loading | ok | notfound | error
  const [state, setState] = useState({ status: 'loading', item: null });

  const load = useCallback(() => {
    let alive = true;
    setState({ status: 'loading', item: null });
    // محتوى الأنشطة الافتراضية (defaultActivities) يبقى احتياطًا لأنشطة معروفة فقط
    // (مثل annual-meeting) — أي slug غير معروف يعرض 404 صريحة بدل نشاط آخر.
    const fallback = Object.prototype.hasOwnProperty.call(defaultActivities, slug) ? defaultActivities[slug] : null;
    fetchActivityBySlug(slug)
      .then((data) => {
        if (!alive) return;
        const item = data || fallback;
        setState(item ? { status: 'ok', item } : { status: 'notfound', item: null });
      })
      .catch((err) => {
        console.error('تعذر تحميل النشاط من قاعدة البيانات:', err);
        if (!alive) return;
        setState(fallback ? { status: 'ok', item: fallback } : { status: 'error', item: null });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => load(), [load]);

  const { status } = state;
  const lang = String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
  // عرض النشاط بلغة الزائر (مع الرجوع للعربية عند غياب الترجمة)
  const item = useMemo(() => localizeActivityDetail(state.item, lang), [state.item, lang]);
  const plainDescription = item?.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 160) : undefined;
  useDocumentMeta(
    item
      ? `${item.title} — ${t('brand.name')}`
      : status === 'notfound'
        ? `${t('activityPage.notFoundTitle')} — ${t('brand.name')}`
        : undefined,
    plainDescription
  );

  const sanitizedContent = useMemo(() => (item?.content ? sanitizeRichText(item.content) : ''), [item]);
  const imageSrc = item?.image ? safeUrl(item.image) || '/logo.jpg' : '/logo.jpg';
  const dateText = item?.date ? (ISO_DATE.test(item.date) ? formatDate(item.date, i18n.language) : item.date) : null;

  const shareActivity = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        window.notify?.success(t('activityPage.linkCopied'));
      }
    } catch {
      // إلغاء المشاركة من المستخدم — لا خطأ يُعرض
    }
  };

  if (status === 'notfound' || status === 'error') {
    const notFound = status === 'notfound';
    return (
      <>
        <InteriorHeader />
        <section className="activity-hero not-found-hero">
          <div className="container">
            <div className="breadcrumbs">
              <Link to="/">{t('nav.home')}</Link>
              <span>‹</span>
              <a href="/#activities">{t('activityPage.activitiesCrumb')}</a>
            </div>
            <h1>{notFound ? t('activityPage.notFoundHero') : t('activityPage.loadError')}</h1>
          </div>
        </section>
        <section className="not-found-section">
          <div className="container not-found-content">
            {notFound && <p className="not-found-code">404</p>}
            <h2>{notFound ? t('activityPage.notFoundTitle') : t('activityPage.loadError')}</h2>
            {notFound && <p className="not-found-text">{t('activityPage.notFoundMessage')}</p>}
            <div className="not-found-actions">
              {!notFound && <button type="button" className="btn btn-gold" onClick={load}>{t('common.retry')}</button>}
              <a href="/#activities" className={`btn ${notFound ? 'btn-gold' : 'btn-ghost'}`}>{t('activityPage.backToActivities')}</a>
            </div>
          </div>
        </section>
        <InteriorFooter />
      </>
    );
  }

  const loading = status === 'loading';

  return (
    <>
      <InteriorHeader />

      <section className="activity-hero">
        <div className="container">
          <div className="breadcrumbs">
            <Link to="/">{t('nav.home')}</Link>
            <span>‹</span>
            <a href="/#activities">{t('activityPage.activitiesCrumb')}</a>
            <span>‹</span>
            <span className="crumb-current">{loading ? t('activityPage.detailsCrumbFallback') : item.title}</span>
          </div>

          <h1>{loading ? t('activityPage.loadingTitle') : item.title}</h1>

          <div className="activity-meta-pills">
            <div className="meta-pill">📅 <span>{dateText || t('activityPage.dateFallback')}</span></div>
            <div className="meta-pill">📍 <span>{item?.location || t('activityPage.locationFallback')}</span></div>
            <div className="meta-pill">🏷️ <span>{item?.category || t('activityPage.categoryFallback')}</span></div>
          </div>

          {/* على الهاتف: أهم الإجراءات ظاهرة أعلى الصفحة بدل نهايتها */}
          {!loading && (
            <div className="activity-mobile-cta">
              <a href="/#join" className="btn btn-gold">{t('activityPage.joinCta')}</a>
              <button type="button" className="btn btn-ghost" onClick={shareActivity}>{t('activityPage.shareCta')}</button>
            </div>
          )}
        </div>
      </section>

      <section className="activity-detail-section">
        <div className="container">
          <div className="activity-layout">
            <div className="main-card">
              <div className="featured-image-container">
                <img src={imageSrc} alt={t('activityPage.imageAlt')} />
              </div>

              <div className="activity-body">
                {loading ? (
                  <>
                    <h3>{t('activityPage.aboutTitle')}</h3>
                    <p>{t('activityPage.loadingBody')}</p>
                  </>
                ) : (
                  <>
                    {/* المحتوى منظّف عبر DOMPurify (sanitizeRichText) قبل الإدراج — نفس آلية الحماية الأصلية من XSS */}
                    <div dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
                    {item.sub_activities && item.sub_activities.length > 0 && (
                      <>
                        <h3 className="sub-activities-title">{t('activityPage.achievementsTitle')}</h3>
                        <div className="sub-activities-grid">
                          {item.sub_activities.map((sub, i) => {
                            const subImage = safeUrl(sub.image);
                            return (
                              <div key={i} className="sub-activity-card">
                                {subImage && <img src={subImage} alt={sub.title || ''} loading="lazy" />}
                                <h4>{sub.title}</h4>
                                <p>{sub.desc}</p>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <aside className="sidebar-card">
              <h3>{t('activityPage.extraInfoTitle')}</h3>

              <ul className="info-list">
                <li>
                  <div className="info-icon">📆</div>
                  <div className="info-text">
                    <label>{t('activityPage.dateTimeLabel')}</label>
                    <span>{dateText || '--'}</span>
                  </div>
                </li>
                <li>
                  <div className="info-icon">📍</div>
                  <div className="info-text">
                    <label>{t('activityPage.locationLabel')}</label>
                    <span>{item?.location || '--'}</span>
                  </div>
                </li>
                <li>
                  <div className="info-icon">👥</div>
                  <div className="info-text">
                    <label>{t('activityPage.beneficiariesLabel')}</label>
                    <span>{item?.target || t('activityPage.beneficiariesFallback')}</span>
                  </div>
                </li>
              </ul>

              <a href="/#join" className="btn btn-gold">{t('activityPage.joinCta')}</a>
              <button type="button" className="btn btn-outline" onClick={shareActivity}>
                {t('activityPage.shareCta')}
              </button>
            </aside>
          </div>
        </div>
      </section>

      <InteriorFooter />
      <Lightbox />
    </>
  );
}
