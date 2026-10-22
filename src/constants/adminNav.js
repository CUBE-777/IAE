/**
 * src/constants/adminNav.js
 * مصفوفة تنقل لوحة الإدارة (نفس المفاتيح/الأدوار/الترتيب). `labelKey`/`sectionKey`
 * مفاتيح ترجمة تحت admin.nav.* ؛ `label`/`section` نص عربي احتياطي فقط.
 */
export const ADMIN_NAV = [
  { key: 'dashboard', labelKey: 'dashboard', label: 'لوحة القيادة', href: '/admin/dashboard', icon: 'layout-dashboard', roles: [] },
  { sectionKey: 'sectionMembers', section: 'إدارة الأعضاء' },
  { key: 'members', labelKey: 'members', label: 'جميع الأعضاء', href: '/admin/members', icon: 'users', roles: ['developer', 'super_admin', 'members_manager'] },
  { key: 'requests', labelKey: 'requests', label: 'طلبات الانخراط', href: '/admin/requests', icon: 'user-plus', roles: ['developer', 'super_admin', 'members_manager', 'treasurer'] },
  { key: 'board', labelKey: 'board', label: 'أعضاء المكتب', href: '/admin/board', icon: 'shield', roles: ['developer', 'super_admin', 'editor'] },
  { sectionKey: 'sectionContent', section: 'المحتوى' },
  { key: 'activities', labelKey: 'activities', label: 'الأنشطة', href: '/admin/activities', icon: 'calendar', roles: ['developer', 'super_admin', 'editor'] },
  { key: 'gallery', labelKey: 'gallery', label: 'معرض الصور', href: '/admin/gallery', icon: 'image', roles: ['developer', 'super_admin', 'editor'] },
  { key: 'announcements', labelKey: 'announcements', label: 'الإعلانات', href: '/admin/announcements', icon: 'megaphone', roles: ['developer', 'super_admin', 'editor'] },
  { key: 'content', labelKey: 'content', label: 'محتوى الموقع', href: '/admin/content', icon: 'file-text', roles: ['developer', 'super_admin', 'editor'] },
  { sectionKey: 'sectionFinance', section: 'المالية' },
  { key: 'budget', labelKey: 'budget', label: 'الميزانية', href: '/admin/budget', icon: 'wallet', roles: ['developer', 'super_admin', 'treasurer'] },
  { sectionKey: 'sectionAdmin', section: 'الإدارة' },
  { key: 'admins', labelKey: 'admins', label: 'المستخدمون الإداريون', href: '/admin/admins', icon: 'user-cog', roles: ['developer', 'super_admin'] },
  { key: 'audit', labelKey: 'audit', label: 'سجل العمليات', href: '/admin/audit', icon: 'history', roles: ['developer', 'super_admin'] },
  { key: 'settings', labelKey: 'settings', label: 'الإعدادات العامة', href: '/admin/settings', icon: 'settings', roles: ['developer', 'super_admin'] },
];
