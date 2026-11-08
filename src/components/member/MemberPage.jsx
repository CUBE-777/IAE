import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, MoreHorizontal, Home, LogOut, Pencil, QrCode, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider';
import { useNoindex } from '../../hooks/useNoindex';
import { useNewAnnouncement } from '../../hooks/useNewAnnouncement';
import '../../styles/member-shell.css';

/**
 * غلاف فضاء المنخرط: رأس صفحة مضغوط + قائمة جانبية (حاسوب/لوحي) + شريط سفلي ثابت (هاتف).
 * الشريط السفلي: الرئيسية، بطاقة العضوية QR، الإعلانات، «المزيد» (تعديل البطاقة، الأمان، الخروج).
 * نفس الواجهة السابقة (titleKey/descriptionKey/pageTitleKey/children) فلا تتغير الصفحات الفرعية.
 */
export default function MemberPage({ titleKey, descriptionKey, pageTitleKey, children }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const ctx = useOutletContext();
  const member = ctx?.member;
  const location = useLocation();
  const hasNewAnnouncement = useNewAnnouncement();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useNoindex();

  useEffect(() => {
    document.title = `${t(pageTitleKey)} — ${t('brand.name')}`;
  }, [t, pageTitleKey]);

  // إغلاق قائمة «المزيد» عند تغيّر الصفحة أو الضغط خارجها أو Escape
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);

  const dot = hasNewAnnouncement && <span className="ms-dot" role="img" aria-label={t('member.nav.newAnnouncements')} />;
  const moreActive = ['/member/card', '/member/security'].includes(location.pathname.replace(/\/$/, ''));
  const subtitle = member ? [member.university, member.promotion].filter((v) => v && String(v).trim()).join(' · ') : '';

  return (
    <div className="ms-wrap">
    <div className="ms">
      <aside className="ms-side">
        {member && (
          <div className="ms-id">
            <img
              className="ms-avatar"
              src={member.photo_url || '/logo.jpg'}
              alt=""
              onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.jpg'; }}
            />
            <div className="ms-id-text">
              <strong>{member.full_name}</strong>
              {subtitle && <span>{subtitle}</span>}
            </div>
          </div>
        )}
        <nav className="ms-side-nav" aria-label={t('member.nav.label')}>
          <NavLink to="/member" end><Home size={20} aria-hidden="true" />{t('member.nav.home')}</NavLink>
          <NavLink to="/member/id"><QrCode size={20} aria-hidden="true" />{t('member.nav.id')}</NavLink>
          <NavLink to="/member/card"><Pencil size={20} aria-hidden="true" />{t('member.nav.card')}</NavLink>
          <NavLink to="/member/announcements"><Bell size={20} aria-hidden="true" />{t('member.nav.announcements')}{dot}</NavLink>
          <NavLink to="/member/security"><ShieldCheck size={20} aria-hidden="true" />{t('member.nav.security')}</NavLink>
        </nav>
        <button type="button" className="ms-logout" onClick={() => logout()}><LogOut size={20} aria-hidden="true" />{t('member.nav.logout')}</button>
      </aside>

      <main className="ms-main">
        <header className="ms-head">
          <h1>{t(titleKey)}</h1>
          <p>{t(descriptionKey)}</p>
        </header>
        {children}
      </main>

      <nav className="ms-tabbar" aria-label={t('member.nav.tabsLabel')}>
        <NavLink to="/member" end><Home size={22} aria-hidden="true" /><span>{t('member.nav.home')}</span></NavLink>
        <NavLink to="/member/id"><QrCode size={22} aria-hidden="true" /><span>{t('member.nav.id')}</span></NavLink>
        <NavLink to="/member/announcements"><span className="ms-ico"><Bell size={22} aria-hidden="true" />{dot}</span><span>{t('member.nav.announcements')}</span></NavLink>
        <div className="ms-more" ref={moreRef}>
          <button
            type="button"
            className={moreActive || moreOpen ? 'active' : undefined}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={t('member.nav.moreLabel')}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal size={22} aria-hidden="true" /><span>{t('member.nav.more')}</span>
          </button>
          {moreOpen && (
            <div className="ms-sheet" role="menu">
              <NavLink to="/member/card" role="menuitem"><Pencil size={20} aria-hidden="true" />{t('member.nav.card')}</NavLink>
              <NavLink to="/member/security" role="menuitem"><ShieldCheck size={20} aria-hidden="true" />{t('member.nav.security')}</NavLink>
              <button type="button" role="menuitem" className="ms-sheet-out" onClick={() => logout()}><LogOut size={20} aria-hidden="true" />{t('member.nav.logout')}</button>
            </div>
          )}
        </div>
      </nav>
    </div>
    </div>
  );
}
