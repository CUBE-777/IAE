import { ROLES_MEMBERS, ROLES_REQUESTS, ROLES_CONTENT_VIEW, ROLES_PROJECTS, ROLES_INTERNAL_FILES_VIEW, ROLES_BUDGET, ROLES_SUPER } from './roles.js'; // امتداد .js صريح ليستورده node:test أيضًا

/**
 * src/constants/adminNav.js
 * مصفوفة تنقل لوحة الإدارة (نفس المفاتيح/الأدوار/الترتيب). `labelKey`/`sectionKey`
 * مفاتيح ترجمة تحت admin.nav.* ؛ `label`/`section` نص عربي احتياطي فقط.
 */
export const ADMIN_NAV = [
  { key: 'dashboard', labelKey: 'dashboard', label: 'لوحة القيادة', href: '/admin/dashboard', icon: 'layout-dashboard', roles: [] },
  { sectionKey: 'sectionMembers', section: 'إدارة الأعضاء' },
  { key: 'members', labelKey: 'members', label: 'جميع الأعضاء', href: '/admin/members', icon: 'users', roles: ROLES_MEMBERS },
  { key: 'requests', labelKey: 'requests', label: 'طلبات الانخراط', href: '/admin/requests', icon: 'user-plus', roles: ROLES_REQUESTS },
  { key: 'board', labelKey: 'board', label: 'أعضاء المكتب', href: '/admin/board', icon: 'shield', roles: ROLES_CONTENT_VIEW },
  { sectionKey: 'sectionContent', section: 'المحتوى' },
  { key: 'activities', labelKey: 'activities', label: 'الأنشطة', href: '/admin/activities', icon: 'calendar', roles: ROLES_CONTENT_VIEW },
  { key: 'projects', labelKey: 'projects', label: 'المشاريع', href: '/admin/projects', icon: 'cpu', roles: ROLES_PROJECTS },
  { key: 'gallery', labelKey: 'gallery', label: 'معرض الصور', href: '/admin/gallery', icon: 'image', roles: ROLES_CONTENT_VIEW },
  { key: 'announcements', labelKey: 'announcements', label: 'الإعلانات', href: '/admin/announcements', icon: 'megaphone', roles: ROLES_CONTENT_VIEW },
  { key: 'content', labelKey: 'content', label: 'محتوى الموقع', href: '/admin/content', icon: 'file-text', roles: ROLES_CONTENT_VIEW },
  { sectionKey: 'sectionFinance', section: 'المالية' },
  { key: 'budget', labelKey: 'budget', label: 'الميزانية', href: '/admin/budget', icon: 'wallet', roles: ROLES_BUDGET },
  { sectionKey: 'sectionDocs', section: 'الوثائق' },
  { key: 'internalFiles', labelKey: 'internalFiles', label: 'الملفات الداخلية', href: '/admin/internal-files', icon: 'folder', roles: ROLES_INTERNAL_FILES_VIEW },
  { sectionKey: 'sectionAccount', section: 'حسابي' },
  { key: 'security', labelKey: 'security', label: 'أمان الحساب', href: '/admin/security', icon: 'shield', roles: [] },
  { sectionKey: 'sectionAdmin', section: 'الإدارة' },
  { key: 'admins', labelKey: 'admins', label: 'المستخدمون الإداريون', href: '/admin/admins', icon: 'user-cog', roles: ROLES_SUPER },
  { key: 'audit', labelKey: 'audit', label: 'سجل العمليات', href: '/admin/audit', icon: 'history', roles: ROLES_SUPER },
  { key: 'settings', labelKey: 'settings', label: 'الإعدادات العامة', href: '/admin/settings', icon: 'settings', roles: ROLES_SUPER },
];
