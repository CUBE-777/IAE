import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import PublicLayout from '../../layouts/PublicLayout';
import MembershipForm from '../../features/membership/MembershipForm';
import ContactForm from '../../features/contact/ContactForm';
import { usePublicHomeData } from '../../hooks/usePublicHomeData';
import { useScrollToHash } from '../../hooks/useScrollToHash';
import AnnouncementsBoard from '../../components/announcements/AnnouncementsBoard';
import { safeUrl } from '../../utils/sanitize';
import { localizeValue, localizeActivity, localizeGalleryItem, localizeRow } from '../../utils/i18nContent';
import { normalizeWhatsappNumber } from '../../utils/whatsapp';
import '../../styles/projects.css';
import ProjectCard from '../../components/projects/ProjectCard';
import { fetchPublishedProjects } from '../../services/supabase/projects.service';

// عدد صور المعرض الظاهرة أولًا؛ الباقي لا يُحمَّل حتى يضغط الزائر «عرض المزيد»
const GALLERY_INITIAL = 6;

const FALLBACK_ICONS = ['🤝', '📚', '🎒', '🌱', '🎓', '🌟', '🏆', '🤲'];

// أيقونة تمثّل النشاط بحسب تصنيفه/عنوانه (بدون تغيير schema). كلمات مفتاحية بالعربية/الفرنسية/الإنجليزية.
const ICON_RULES = [
  [/(دعم|تضامن|إنسان|اجتماع|solidar|charit|support|humanit)/i, '🤲'],
  [/(تأطير|توجيه|إرشاد|orient|mentor|guidance|coach)/i, '🧭'],
  [/(دراس|تعليم|مدرس|كتب|تقوية|éduc|educat|school|study|tutor)/i, '📚'],
  [/(رياض|sport)/i, '🏆'],
  [/(ثقاف|فن|مسرح|culture|art|theat|music)/i, '🎭'],
  [/(بيئ|غرس|شجر|environ|nature|tree)/i, '🌱'],
  [/(لقاء|ملتقى|جمع عام|réunion|meeting|assembl|annual)/i, '🤝'],
  [/(تخرج|حفل|تكريم|diplôm|graduat|ceremon|honou?r)/i, '🎓'],
  [/(مساعدة|حقيبة|توزيع|لوازم|aide|supplies|donat|don)/i, '🎒'],
];
function activityIcon(activity, index) {
  const hay = `${activity.category || ''} ${activity.title || ''}`;
  const rule = ICON_RULES.find(([re]) => re.test(hay));
  return rule ? rule[1] : FALLBACK_ICONS[index % FALLBACK_ICONS.length];
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || i18n.language || 'ar').slice(0, 2);
  const { activities, gallery, settings, settingsTr, content, contentTr, announcement } = usePublicHomeData();
  // فتح /#join (أو أي #قسم) من رابط خارجي أو صفحة أخرى: يمرّر إلى القسم بعد اكتمال الرسم
  useScrollToHash();

  // Projets : section affichée uniquement s'il existe au moins un projet publié (aucun contenu fictif).
  const [projects, setProjects] = useState([]);
  const [showAllGallery, setShowAllGallery] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchPublishedProjects(3)
      .then((data) => alive && setProjects(data))
      .catch((err) => console.error('Impossible de charger les projets :', err));
    return () => {
      alive = false;
    };
  }, []);
  const projectCards = useMemo(() => projects.map((p) => localizeRow(p, lang, ['title', 'summary', 'description'])), [projects, lang]);

  // ===== تحديث عنوان التبويب واتجاه التمرير (behavior parity فقط، لا منطق جديد) =====
  useEffect(() => {
    document.title = t('siteTitle');
  }, [t]);

  // نصوص قابلة للتحرير من الإدارة: تُعرض بلغة الزائر مع الرجوع للعربية عند غياب الترجمة
  const lc = (key) => localizeValue(content[key], contentTr[key], lang);
  const ls = (key) => localizeValue(settings[key], settingsTr[key], lang);
  const heroTitle = lc('homepage.hero_title');
  const aboutTitle = lc('homepage.about_title');
  const brandName = ls('association_name');
  const footerCopyright = lc('footer.copyright');

  // Coordonnées : uniquement les valeurs de site_settings (aucune valeur par défaut codée en dur).
  // Un champ vide masque simplement l'élément correspondant sur la page.
  const email = (settings.email || t('contact.defaultEmail') || '').trim();
  const phoneDisplay = (settings.phone || t('contact.defaultPhone') || '').trim();
  const phoneDigits = phoneDisplay.replace(/[^\d+]/g, '');
  const address = ls('address') || t('contact.defaultAddress') || '';
  const whatsappNum = normalizeWhatsappNumber(settings.whatsapp);
  const facebookUrl = settings.facebook ? safeUrl(settings.facebook) : '';
  const instagramUrl = settings.instagram ? safeUrl(settings.instagram) : '';
  const youtubeUrl = settings.youtube ? safeUrl(settings.youtube) : '';
  const hasSocial = Boolean(facebookUrl || instagramUrl || youtubeUrl || whatsappNum);

  const activityCards = activities
    ? activities.map((raw, i) => {
        const a = localizeActivity(raw, lang); // نص بلغة الزائر (الأيقونة تُحسب من الأصل العربي)
        return {
          icon: activityIcon(raw, i),
          image: safeUrl(a.cover_image_url),
          category: a.category,
          title: a.title,
          // نفس المعالجة الأصلية: إزالة وسوم HTML من الوصف قبل الاقتطاع لعرض معاينة نصية آمنة
          desc: (a.description || '').replace(/<[^>]*>/g, '').slice(0, 140),
          href: `/activity/${encodeURIComponent(a.slug)}`,
        };
      })
    : t('activities.fallback', { returnObjects: true }).map((a) => ({ ...a, href: `/activity/${a.slug}` }));

  return (
    <PublicLayout brandName={brandName} copyright={footerCopyright} announcement={announcement}>
      <section className="hero" id="home">
        <svg className="hero-arc" viewBox="0 0 1000 400" xmlns="http://www.w3.org/2000/svg">
          <path d="M 80 400 A 420 420 0 0 1 920 400" />
          <path className="inner" d="M 180 400 A 320 320 0 0 1 820 400" />
        </svg>
        <div className="container">
          <span className="hero-badge">{t('hero.badge')}</span>
          <h1 id="heroTitle">
            {heroTitle || (
              <>
                {t('hero.titlePrefix')}
                <em>{t('hero.titleEmphasis')}</em>
                {t('hero.titleSuffix')}
              </>
            )}
          </h1>
          <p>{t('hero.description')}</p>
          <div className="hero-actions">
            <a href="#join" className="btn btn-gold">{t('hero.ctaJoin')}</a>
            <a href="#activities" className="btn btn-ghost">{t('hero.ctaActivities')}</a>
          </div>
        </div>
      </section>

      <svg className="arc-divider" viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,0 L1440,0 L1440,40 C1140,80 300,80 0,40 Z" fill="var(--cream)"></path>
      </svg>

      <AnnouncementsBoard />

      <section id="about">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              <div className="eyebrow">{t('about.eyebrow')}</div>
              <h2 id="aboutTitle" className="about-title">
                {aboutTitle || t('about.title')}
              </h2>
              <p><Trans i18nKey="about.p1" components={{ strong: <strong /> }} /></p>
              <p><Trans i18nKey="about.p2" components={{ strong: <strong /> }} /></p>
            </div>
            <div className="pillars">
              {t('about.pillars', { returnObjects: true }).map((pillar) => (
                <div className="pillar" key={pillar.title}>
                  <span className="pillar-num">{pillar.num}</span>
                  <h3>{pillar.title}</h3>
                  <p>{pillar.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="activities on-navy" id="activities">
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>{t('activities.eyebrow')}</div>
            <h2>{t('activities.title')}</h2>
            <p>{t('activities.description')}</p>
          </div>
          <div className="activity-grid" id="activityGrid">
            {activityCards.map((card) => (
              <article className="activity-card" key={card.href}>
                {card.image && (
                  <div className="activity-cover">
                    <img src={card.image} alt={t('activities.coverAlt', { title: card.title })} loading="lazy" />
                  </div>
                )}
                <div className="activity-card-head">
                  <div className="activity-icon" aria-hidden="true">{card.icon}</div>
                  {card.category && <span className="activity-chip">{card.category}</span>}
                </div>
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
                <a href={card.href} className="btn btn-ghost" aria-label={`${t('activities.viewDetails')}: ${card.title}`}>
                  {t('activities.viewDetails')}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      {projectCards.length > 0 && (
        <section className="projects-section" id="projects">
          <div className="container">
            <div className="section-head center">
              <div className="eyebrow" style={{ justifyContent: 'center' }}>{t('projects.eyebrow')}</div>
              <h2>{t('projects.title')}</h2>
              <p>{t('projects.description')}</p>
            </div>
            <div className="project-grid">
              {projectCards.map((p) => <ProjectCard key={p.id} project={p} />)}
            </div>
            <div className="projects-more">
              <Link to="/projects" className="project-link">{t('projects.viewAll')}</Link>
            </div>
          </div>
        </section>
      )}

      <section className="members-section" id="members">
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>{t('members.eyebrow')}</div>
            <h2 style={{ color: 'var(--text-strong)' }}>{t('members.title')}</h2>
            <p>{t('members.description')}</p>
          </div>
          <div className="people-links">
            <a href="/board" className="people-link featured">
              <div className="eyebrow">{t('members.boardEyebrow')}</div>
              <h3>{t('members.boardTitle')}</h3>
              <p>{t('members.boardDesc')}</p>
              <span className="people-link-cta">{t('members.boardCta')}</span>
            </a>
            <a href="/members" className="people-link">
              <div className="eyebrow">{t('members.membersEyebrow')}</div>
              <h3>{t('members.membersTitle')}</h3>
              <p>{t('members.membersDesc')}</p>
              <span className="people-link-cta">{t('members.membersCta')}</span>
            </a>
          </div>
        </div>
      </section>

      <section className="gallery" id="gallery">
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>{t('gallery.eyebrow')}</div>
            <h2 style={{ color: 'var(--text-strong)' }}>{t('gallery.title')}</h2>
            <p>{t('gallery.description')}</p>
          </div>
          <div className="gallery-grid" id="galleryGrid">
            {gallery.length === 0 ? (
              <div className="gallery-empty">{t('gallery.empty')}</div>
            ) : (
              (showAllGallery ? gallery : gallery.slice(0, GALLERY_INITIAL)).map((raw, i) => {
                const item = localizeGalleryItem(raw, lang);
                return (
                <figure className="gallery-item" key={`${item.image_url}-${i}`}>
                  <img
                    src={safeUrl(item.image_url)}
                    alt={item.title || item.description || t('a11y.galleryImageAlt')}
                    loading="lazy"
                  />
                  {item.title && <figcaption>{item.title}</figcaption>}
                </figure>
                );
              })
            )}
          </div>
          {!showAllGallery && gallery.length > GALLERY_INITIAL && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-5, 24px)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAllGallery(true)}>
                {t('gallery.showMore')}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="join" id="join">
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>{t('join.eyebrow')}</div>
            <h2 style={{ color: 'var(--text-strong)' }}>{t('join.title')}</h2>
            <p>{t('join.description')}</p>
          </div>
          <div className="join-grid">
            <div className="join-card featured">
              <div className="eyebrow">{t('join.membershipEyebrow')}</div>
              <h3>{t('join.membershipTitle')}</h3>
              <p>{t('join.membershipDesc')}</p>
              <ul className="join-list">
                {t('join.membershipList', { returnObjects: true }).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <MembershipForm />
            </div>
            <div className="join-card">
              <div className="eyebrow">{t('join.donateEyebrow')}</div>
              <h3>{t('join.donateTitle')}</h3>
              <p>{t('join.donateDesc')}</p>
              <ul className="join-list">
                {t('join.donateList', { returnObjects: true }).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a
                href={whatsappNum ? `https://wa.me/${whatsappNum}?text=${encodeURIComponent(t('join.donateWhatsappText'))}` : '#contact'}
                {...(whatsappNum ? { target: '_blank', rel: 'noopener' } : {})}
                className="btn btn-ghost"
                style={{ color: 'var(--text-strong)', borderColor: 'var(--text-strong)' }}
              >
                {t('join.donateCta')}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="contact" id="contact">
        <div className="container">
          <div className="contact-grid">
            <div>
              <div className="eyebrow">{t('contact.eyebrow')}</div>
              <h2 style={{ marginBottom: 24 }}>{t('contact.title')}</h2>
              <ul className="contact-info">
                {email && (
                  <li>
                    <span className="ico">✉</span>
                    <div>
                      <h4>{t('contact.emailLabel')}</h4>
                      <span><a href={`mailto:${email}`} style={{ color: 'var(--navy-tint-2)' }}>{email}</a></span>
                    </div>
                  </li>
                )}
                {phoneDisplay && (
                  <li>
                    <span className="ico">☎</span>
                    <div>
                      <h4>{t('contact.phoneLabel')}</h4>
                      <span><a href={`tel:${phoneDigits}`} style={{ color: 'var(--navy-tint-2)' }}>{phoneDisplay}</a></span>
                    </div>
                  </li>
                )}
                {address && (
                  <li>
                    <span className="ico">📍</span>
                    <div>
                      <h4>{t('contact.addressLabel')}</h4>
                      <span>{address}</span>
                    </div>
                  </li>
                )}
              </ul>
              {hasSocial && (
                <div className="social-row">
                  {facebookUrl && <a href={facebookUrl} target="_blank" rel="noopener" aria-label={t('a11y.facebook')}>f</a>}
                  {instagramUrl && <a href={instagramUrl} target="_blank" rel="noopener" aria-label={t('a11y.instagram')}>📷</a>}
                  {youtubeUrl && <a href={youtubeUrl} target="_blank" rel="noopener" aria-label={t('a11y.youtube')}>▶</a>}
                  {whatsappNum && <a href={`https://wa.me/${whatsappNum}`} target="_blank" rel="noopener" aria-label={t('a11y.whatsapp')}>📱</a>}
                </div>
              )}
            </div>
            <ContactForm />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
