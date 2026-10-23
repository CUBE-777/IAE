import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';
import { useMobileNav } from '../../hooks/useMobileNav';
import { useHasProjects } from '../../hooks/useHasProjects';
import NavMore from './NavMore';

const NAV_BREAKPOINT = 1180; // au-dessus : menu horizontal ; en dessous : tiroir (voir nav-responsive.css)
const SECTION_IDS = ['home', 'about', 'activities', 'projects', 'members', 'gallery', 'join', 'contact'];

export default function Header({ brandName }) {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState('home');
  const { open: navOpen, close, toggle, toggleRef, navRef } = useMobileNav(NAV_BREAKPOINT);
  const hasProjects = useHasProjects();

  useEffect(() => {
    // scroll-spy: القسم الحالي = آخر قسم تجاوز أعلاه خط مرجعي تحت الهيدر
    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      const stack = document.querySelector('.fixed-top-stack');
      const line = (stack ? stack.offsetHeight : 90) + 40;
      let current = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // آخر الصفحة: فعّل آخر قسم حتى لو كان قصيرًا
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = SECTION_IDS[SECTION_IDS.length - 1];
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Liens principaux (menu horizontal) et liens secondaires (menu « Plus » sur bureau, à plat dans le tiroir mobile)
  const links = [
    ['home', t('nav.home')],
    ['about', t('nav.about')],
    ['activities', t('nav.activities')],
    ...(hasProjects ? [['projects', t('nav.projects')]] : []),
    ['members', t('nav.members')],
    ['join', t('nav.join')],
  ];
  const moreItems = [
    { key: 'gallery', label: t('nav.gallery'), href: '#gallery' },
    { key: 'announcements', label: t('nav.announcements'), to: '/announcements' },
    { key: 'contact', label: t('nav.contact'), href: '#contact' },
  ];

  return (
    <header id="site-header" className={scrolled ? 'scrolled' : ''}>
      <div className="container">
        <a href="#home" className="brand">
          <img src="/logo.jpg" alt={t('a11y.logoAltFull')} />
          <div className="brand-text">
            {brandName || t('brand.name')}
            <span>{t('brand.tagline')}</span>
          </div>
        </a>
        <button
          type="button"
          className="nav-toggle"
          ref={toggleRef}
          aria-label={navOpen ? t('a11y.closeMenu') : t('a11y.openMenu')}
          aria-expanded={navOpen}
          aria-controls="mainNav"
          onClick={toggle}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        {navOpen && <div className="nav-backdrop" onClick={close} aria-hidden="true" />}
        <nav id="mainNav" ref={navRef} className={navOpen ? 'open' : ''} aria-label={t('a11y.mainNav')}>
          <button type="button" className="nav-close" aria-label={t('a11y.closeMenu')} onClick={close}>×</button>
          <ul>
            {links.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={activeId === id ? 'active' : undefined}
                  aria-current={activeId === id ? 'location' : undefined}
                  onClick={close}
                >
                  {label}
                </a>
              </li>
            ))}
            <NavMore label={t('nav.more')} items={moreItems} activeKey={activeId} activeCurrent="location" onNavigate={close} />
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
