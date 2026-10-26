/**
 * src/constants/roles.js — المصدر الوحيد لمجموعات الأدوار في الواجهة (الراوتر وقائمة التنقل).
 *
 * قاعدة الحقيقة تبقى في SQL (دوال can_* في migrations/0019 و is_super_admin في 0012)؛ هذا الملف مرآتها في الواجهة،
 * و tests/roles.test.js يفشل إن اختلفت المجموعات عن SQL أو عن أدوار Edge Function وROLE_LABELS.
 * لإضافة دور جديد: عدّل SQL ثم هذا الملف ثم ALLOWED_ROLES في admin-create-user و ROLE_LABELS — والاختبار يدلّك على ما نسيت.
 * مصفوفة فارغة [] في الراوتر/القائمة تعني «أي مسؤول نشط».
 */

export const ALL_ROLES = ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'members_manager', 'treasurer', 'secretary_general', 'deputy_secretary_general', 'deputy_treasurer', 'consultant'];

/** إدارة الأعضاء — يطابق can_manage_members() في SQL */
export const ROLES_MEMBERS = ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'secretary_general', 'deputy_secretary_general'];

/** طلبات الانخراط — يطابق can_handle_membership() */
export const ROLES_REQUESTS = ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'treasurer', 'deputy_treasurer', 'secretary_general', 'deputy_secretary_general'];

/** المحتوى (أنشطة، مشاريع، معرض، إعلانات، مكتب، محتوى الموقع) — يطابق can_manage_content() */
export const ROLES_CONTENT = ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'secretary_general', 'deputy_secretary_general'];

/** الملفات الداخلية — يطابق can_access_internal_files() */
export const ROLES_INTERNAL_FILES = ['developer', 'super_admin', 'deputy_super_admin', 'editor', 'members_manager', 'secretary_general', 'deputy_secretary_general'];

/** الميزانية — يطابق can_manage_budget() */
export const ROLES_BUDGET = ['developer', 'super_admin', 'deputy_super_admin', 'treasurer', 'deputy_treasurer'];

/** الحسابات الإدارية والسجل والإعدادات — يطابق is_super_admin() (مسؤول أعلى + مطوّر) */
export const ROLES_SUPER = ['developer', 'super_admin'];

/** مشاريع النادي (إنشاء/تعديل/نشر/حذف منطقي) — يطابق can_manage_projects() في SQL (0032): أدوار المحتوى + المستشار */
export const ROLES_PROJECTS = [...ROLES_CONTENT, 'consultant'];

/** صفحات المحتوى للاطلاع: تُفتح للمستشار قراءةً فقط (الكتابة تبقى لـ ROLES_CONTENT في RLS) */
export const ROLES_CONTENT_VIEW = [...ROLES_CONTENT, 'consultant'];

/** الملفات الداخلية: اطلاع وتنزيل — يطابق can_read_internal_files() في SQL (0032)؛ الرفع يبقى لـ ROLES_INTERNAL_FILES */
export const ROLES_INTERNAL_FILES_VIEW = [...ROLES_INTERNAL_FILES, 'consultant'];

/** أدوار لا ترى أزرار الإضافة والتعديل والحذف في صفحات المحتوى (الخادم يرفض الكتابة على أي حال) */
export const ROLES_READONLY = ['consultant'];
export const isReadOnlyRole = (role) => ROLES_READONLY.includes(role);
