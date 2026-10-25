/**
 * src/constants/adminNav.js
 * مصفوفة تنقل لوحة الإدارة (نفس المفاتيح/الأدوار/الترتيب). `labelKey`/`sectionKey`
 * مفاتيح ترجمة تحت admin.nav.* ؛ `label`/`section` نص عربي احتياطي فقط.
 */
export const ADMIN_NAV = [
  { key: 'dashboard', labelKey: 'dashboard', label: 'لوحة القيادة', href: '/admin/dashboard', icon: 'layout-dashboard', roles: [] },
  { sectionKey: 'sectionMembers', section: 'إدارة الأعضاء' },
  { key: 'members', labelKey: 'members', label: 'جميع الأعضاء', href: '/admin/members', icon: 'users', roles: ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'requests', labelKey: 'requests', label: 'طلبات الانخراط', href: '/admin/requests', icon: 'user-plus', roles: ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'treasurer', 'deputy_treasurer', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'board', labelKey: 'board', label: 'أعضاء المكتب', href: '/admin/board', icon: 'shield', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { sectionKey: 'sectionContent', section: 'المحتوى' },
  { key: 'activities', labelKey: 'activities', label: 'الأنشطة', href: '/admin/activities', icon: 'calendar', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'projects', labelKey: 'projects', label: 'المشاريع', href: '/admin/projects', icon: 'cpu', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'gallery', labelKey: 'gallery', label: 'معرض الصور', href: '/admin/gallery', icon: 'image', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'announcements', labelKey: 'announcements', label: 'الإعلانات', href: '/admin/announcements', icon: 'megaphone', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { key: 'content', labelKey: 'content', label: 'محتوى الموقع', href: '/admin/content', icon: 'file-text', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'] },
  { sectionKey: 'sectionFinance', section: 'المالية' },
  { key: 'budget', labelKey: 'budget', label: 'الميزانية', href: '/admin/budget', icon: 'wallet', roles: ['developer', 'super_admin', 'deputy_super_admin', 'treasurer', 'deputy_treasurer'] },
  { sectionKey: 'sectionDocs', section: 'الوثائق' },
  { key: 'internalFiles', labelKey: 'internalFiles', label: 'الملفات الداخلية', href: '/admin/internal-files', icon: 'folder', roles: ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'members_manager', 'secretary_general', 'deputy_secretary_general'] },
  { sectionKey: 'sectionAccount', section: 'حسابي' },
  { key: 'security', labelKey: 'security', label: 'أمان الحساب', href: '/admin/security', icon: 'shield', roles: [] },
  { sectionKey: 'sectionAdmin', section: 'الإدارة' },
  { key: 'admins', labelKey: 'admins', label: 'المستخدمون الإداريون', href: '/admin/admins', icon: 'user-cog', roles: ['developer', 'super_admin'] },
  { key: 'audit', labelKey: 'audit', label: 'سجل العمليات', href: '/admin/audit', icon: 'history', roles: ['developer', 'super_admin'] },
  { key: 'settings', labelKey: 'settings', label: 'الإعدادات العامة', href: '/admin/settings', icon: 'settings', roles: ['developer', 'super_admin'] },
];
