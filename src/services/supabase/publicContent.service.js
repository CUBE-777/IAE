/**
 * src/services/supabase/publicContent.service.js
 * كل استعلامات القراءة العامة المستخدمة في الصفحة الرئيسية (index.html الأصلي):
 * activities, gallery, site_settings, site_content, announcements.
 * منطق كل دالة مطابق 1:1 لما كان مضمّنًا سابقًا داخل <script> في index.html.
 */
import { supabase } from './client';

// يحاول جلب عمود translations (migration 0013) وإن لم يوجد بعد يرجع للأعمدة الأساسية.
async function selectWithTranslations(table, cols) {
  let res = await supabase.from(table).select(`${cols}, translations`);
  if (res.error) res = await supabase.from(table).select(cols);
  if (res.error) throw res.error;
  return res.data || [];
}

export async function fetchPublishedActivities(limit = 8) {
  const query = (cols) => supabase
    .from('activities')
    .select(cols)
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(limit);
  const BASE = 'slug, title, description, category, cover_image_url';
  // sub_activities غير مطلوبة للبطاقات؛ الترجمة تُجلب مع تراجع تلقائي إن لم تُشغَّل 0013
  let res = await query(`${BASE}, translations`);
  if (res.error) res = await query(BASE);
  if (res.error) throw res.error;
  return res.data || [];
}

export async function fetchGalleryItems(limit = 12) {
  const query = (cols) => supabase
    .from('gallery')
    .select(cols)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .limit(limit);
  const BASE = 'image_url, title, description';
  let res = await query(`${BASE}, translations`);
  if (res.error) res = await query(BASE);
  if (res.error) throw res.error;
  return res.data || [];
}

/** يُرجع { values: {key: نص عربي}, translations: {key: {fr:{value}, en:{value}}} } */
export async function fetchSiteSettings() {
  const data = await selectWithTranslations('site_settings', 'key, value');
  const values = {};
  const translations = {};
  data.forEach((row) => {
    if (row.value) values[row.key] = row.value;
    if (row.translations && typeof row.translations === 'object') translations[row.key] = row.translations;
  });
  return { values, translations };
}

/** يُرجع { values: {"section.key": نص عربي}, translations: {"section.key": {fr:{value}, en:{value}}} } */
export async function fetchSiteContent() {
  const data = await selectWithTranslations('site_content', 'section, key, value');
  const values = {};
  const translations = {};
  data.forEach((row) => {
    const k = `${row.section}.${row.key}`;
    if (row.value != null && row.value !== '') values[k] = row.value;
    if (row.translations && typeof row.translations === 'object') translations[k] = row.translations;
  });
  return { values, translations };
}

/** يُرجع الإعلان النشط الوحيد ضمن الفترة الزمنية الحالية، أو null. */
export async function fetchActiveAnnouncement() {
  const now = Date.now();
  const { data, error } = await supabase
    .from('announcements')
    .select('id, slug, text, title, excerpt, content, link, start_at, end_at, is_pinned, translations')
    .eq('is_active', true)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  const active = (data || []).find((row) => {
    const afterStart = !row.start_at || new Date(row.start_at).getTime() <= now;
    const beforeEnd = !row.end_at || new Date(row.end_at).getTime() >= now;
    return afterStart && beforeEnd;
  });
  return active || null;
}

export async function submitMembershipRequest(payload) {
  const { error } = await supabase.from('membership_requests').insert(payload);
  if (error) throw error;
}

export async function submitContactMessage(payload) {
  // ملاحظة: النموذج الأصلي (contact) كان يعتمد Netlify Forms (data-netlify) وليس
  // Supabase، بعكس نموذج الانخراط الذي هُجِّر بالفعل إلى membership_requests
  // (انظر AUDIT_REPORT.md وتعليق index.html). أُبقي نفس السلوك هنا لعدم كسر آلية
  // استقبال الرسائل الحالية — Netlify Forms يعمل بإرسال POST عادي لنفس الصفحة.
  const body = new URLSearchParams({ 'form-name': 'contact', ...payload }).toString();
  const res = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('Netlify form submission failed');
}
