/**
 * src/services/supabase/publicClient.js
 * عميل Supabase "مجهول الجلسة" للصفحات العامة: لا يحمل جلسة المسؤول أبدًا (لا تخزين ولا تجديد)،
 * فيُنفَّذ كل استعلام عام بدور anon حتى لو كان صاحب الحساب مسجّلًا كمسؤول في نفس المتصفح.
 * هذا يمنع اختلاف ما يراه الزائر عمّا يراه المسؤول، ويضمن عدم اعتماد الصفحات العامة على
 * سياسات القراءة الإدارية (مثل members_admin_read_all في 0021).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'iae-public-anon',
  },
});
