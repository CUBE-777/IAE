import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';
import { useMobileNav } from '../../hooks/useMobileNav';
import { useHasProjects } from '../../hooks/useHasProjects';
import NavMore from './NavMore';

/** يحدد الرابط النشط بحسب مسار الصفحة الداخلية الحالي. */
function activeKeyFor(pathname) {
  if (pathname.startsWith('/members') || pathname.startsWith('/board')) return 'members';
  if (pathname.startsWith('/activity')) return 'activities';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/announcement')) return 'announcements';
  return '';
}

export default function InteriorHeader() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { open: navOpen, close, toggle, toggleRef, navRef } = useMobileNav(1180);
  const activeKey = activeKeyFor(pathname);
  const hasProjects = useHasProjects();

  const links = [
    ['home', '/#home', t('nav.home')],
    ['about', '/#about', t('nav.about')],
    ['activities', '/#activities', t('nav.activities')],
    ...(hasProjects || pathname.startsWith('/projects') ? [['projects', '/projects', t('nav.projects')]] : []),
    ['members', '/#members', t('nav.members')],
    ['join', '/#join', t('nav.join')],
  ];
  const moreItems = [
    { key: 'gallery', label: t('nav.gallery'), href: '/#gallery' },
    { key: 'announcements', label: t('nav.announcements'), to: '/announcements' },
    { key: 'contact', label: t('nav.contact'), href: '/#contact' },
  ];

  return (
    <header className="static-header">
      <div className="container">
        <Link to="/" className="brand">
          <img src="/logo.jpg" alt={t('a11y.logoAltFull')} />
          <div className="brand-text">
            {t('brand.name')}
            <span>{t('brand.tagline')}</span>
          </div>
        </Link>
        <button
          type="button"
          className="nav-toggle"
          ref={toggleRef}
          aria-label={navOpen ? t('a11y.closeMenu') : t('a11y.openMenu')}
          aria-expanded={navOpen}
          aria-controls="interiorNav"
          onClick={toggle}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        {navOpen && <div className="nav-backdrop" onClick={close} aria-hidden="true" />}
        <nav id="interiorNav" ref={navRef} className={navOpen ? 'open' : ''} aria-label={t('a11y.mainNav')}>
          <button type="button" className="nav-close" aria-label={t('a11y.closeMenu')} onClick={close}>×</button>
          <ul>
            {links.map(([key, href, label]) => (
              <li key={key}>
                <a
                  href={href}
                  className={activeKey === key ? 'active' : undefined}
                  aria-current={activeKey === key ? 'page' : undefined}
                  onClick={close}
                >
                  {label}
                </a>
              </li>
            ))}
            <NavMore label={t('nav.more')} items={moreItems} activeKey={activeKey} onNavigate={close} />
          </ul>
        </nav>
        <div className="header-tools">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
