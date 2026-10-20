/**
 * src/services/supabase/client.js
 * نقطة الاتصال الموحّدة بـ Supabase لكامل التطبيق (منفذ لـ js/supabase.js الأصلي).
 * المفتاح هنا "publishable key" (anon) — آمن للظهور في كود المتصفح، صلاحياته
 * الفعلية تُحدَّد بالكامل عبر سياسات RLS في قاعدة البيانات (supabase/migrations).
 * لا تضع هنا أبدًا service_role / secret key.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // eslint-disable-next-line no-console
  console.error('متغيرات البيئة VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY غير معرّفة. راجع .env.example');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
