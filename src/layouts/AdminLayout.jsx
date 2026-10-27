import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, UserPlus, Shield, Calendar, Image as ImageIcon,
  Megaphone, FileText, UserCog, History, Settings, Wallet, Cpu, Folder, LayoutGrid, Menu, ChevronRight, LogOut, X,
} from 'lucide-react';
import '../styles/admin.css';
import { ADMIN_NAV } from '../constants/adminNav';
import { useAuth } from '../app/providers/AuthProvider';
import LanguageSwitcher from '../components/layout/LanguageSwitcher';
import ThemeToggle from '../components/layout/ThemeToggle';

const ICONS = {
  'layout-dashboard': LayoutDashboard,
  users: Users,
  'user-plus': UserPlus,
  shield: Shield,
  calendar: Calendar,
  image: ImageIcon,
  megaphone: Megaphone,
  'file-text': FileText,
  'user-cog': UserCog,
  history: History,
  settings: Settings,
  wallet: Wallet,
  cpu: Cpu,
  folder: Folder,
  'layout-grid': LayoutGrid,
};

export default function AdminLayout({ children }) {
  const { t, i18n } = useTranslation();
  const { profile, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const sidebarRef = useRef(null);

  const allowed = (roles) => !roles || roles.length === 0 || roles.includes(profile.role);

  // الدرج الجوّال: Escape يغلق، قفل تمرير الصفحة، نقل التركيز للدرج ثم إعادته لزر القائمة
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const btn = menuBtnRef.current;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 980) setMobileOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector('.admin-sidebar-link')?.focus();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      btn?.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="admin-root">
      <div className="admin-mobile-topbar">
        <button
          type="button"
          ref={menuBtnRef}
          aria-label={mobileOpen ? t('admin.layout.closeMenu') : t('admin.layout.openMenu')}
          aria-expanded={mobileOpen}
          aria-controls="adminSidebar"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <span className="admin-topbar-title">{t('admin.layout.panel')}</span>
        <ThemeToggle className="theme-toggle-admin" />
      </div>

      {mobileOpen && <div className="admin-sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <div className="admin-shell">
        <aside
          id="adminSidebar"
          ref={sidebarRef}
          aria-label={t('admin.layout.sidebar')}
          className={`admin-sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}
        >
          <button
            type="button"
            className="admin-sidebar-close"
            aria-label={t('admin.layout.closeMenu')}
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="admin-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? t('admin.layout.expand') : t('admin.layout.collapse')}
            aria-expanded={!collapsed}
          >
            <ChevronRight size={14} aria-hidden="true" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }} />
          </button>

          <div className="admin-sidebar-brand">
            <img src="/logo.jpg" alt={t('admin.layout.logoAlt')} />
            <span>{t('admin.layout.short')}</span>
          </div>

          <nav className="admin-sidebar-nav">
            {ADMIN_NAV.map((item, i) => {
              if (item.sectionKey) {
                // لا نعرض عنوان قسم إن لم يكن للدور الحالي أي عنصر فيه (حتى لا يُكشف وجود أقسام مقيّدة)
                let hasVisible = false;
                for (let j = i + 1; j < ADMIN_NAV.length && !ADMIN_NAV[j].sectionKey; j += 1) {
                  if (allowed(ADMIN_NAV[j].roles)) { hasVisible = true; break; }
                }
                if (!hasVisible) return null;
                return (
                  <div className="admin-sidebar-section" key={`section-${i}`}>
                    {t(`admin.nav.${item.sectionKey}`)}
                  </div>
                );
              }
              if (!allowed(item.roles)) return null;
              const Icon = ICONS[item.icon];
              const isActive = location.pathname.startsWith(item.href);
              const label = t(`admin.nav.${item.labelKey}`);
              return (
                <NavLink
                  key={item.key}
                  to={item.href}
                  className={`admin-sidebar-link${isActive ? ' active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? label : undefined}
                >
                  <span className="icon">{Icon && <Icon size={17} aria-hidden="true" />}</span>
                  <span>{label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="admin-sidebar-lang">
            <LanguageSwitcher />
            <ThemeToggle className="theme-toggle-admin" />
          </div>

          <div className="admin-sidebar-footer">
            <div className="admin-sidebar-user">
              <strong>{profile.full_name}</strong>
              <span className="role">{t(`admin.roles.${profile.role}`, { defaultValue: profile.role })}</span>
            </div>
            <button type="button" className="admin-logout-btn" onClick={logout}>
              <LogOut size={14} aria-hidden="true" style={{ verticalAlign: 'middle' }} />
              {t('admin.layout.logout')}
            </button>
          </div>
        </aside>

        <main className="admin-main" key={i18n.resolvedLanguage || i18n.language}>{children}</main>
      </div>
    </div>
  );
}
