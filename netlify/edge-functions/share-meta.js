// netlify/edge-functions/share-meta.js
// معاينات المشاركة الصحيحة (واتساب/فيسبوك/تويتر/تيليغرام) لصفحات الإعلان والمشروع والنشاط.
// الزائر العادي ومحركات البحث لا يتأثرون: لا نتدخل إلا مع زواحف المعاينة المعروفة، وأي خطأ → الصفحة الأصلية كما هي.
// يقرأ VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY من متغيرات بيئة Netlify (نفسها المستخدمة في البناء).
import { isSocialCrawler, resolveTarget, restQuery, rowToMeta, buildMetaBlock, injectMeta } from './lib/share-meta.js';

export const config = { path: ['/announcement/*', '/announcements/*', '/projects/*', '/activity/*'] };

const env = (k) => globalThis.Netlify?.env?.get?.(k) ?? globalThis.Deno?.env?.get?.(k);

export default async (request, context) => {
  if (request.method !== 'GET' || !isSocialCrawler(request.headers.get('user-agent'))) return context.next();

  const pageRes = await context.next();
  try {
    const url = new URL(request.url);
    const target = resolveTarget(url.pathname);
    const base = env('VITE_SUPABASE_URL');
    const key = env('VITE_SUPABASE_PUBLISHABLE_KEY');
    if (!target || !base || !key || !pageRes.ok) return pageRes;

    // مفتاح publishable يُرسل في apikey فقط (لا Authorization: ليس JWT في المفاتيح الجديدة)
    const dataRes = await fetch(`${base}/rest/v1/${restQuery(target.kind, target.slug)}`, {
      headers: { apikey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!dataRes.ok) return pageRes;
    const rows = await dataRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return pageRes; // غير موجود/غير منشور: الـ SPA تعرض 404 كالمعتاد

    const html = await pageRes.clone().text();
    const meta = rowToMeta(target.kind, row, url.origin);
    const out = injectMeta(html, buildMetaBlock({ ...meta, url: `${url.origin}${url.pathname}`, origin: url.origin }));
    const headers = new Headers(pageRes.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=300');
    headers.delete('content-length');
    return new Response(out, { status: 200, headers });
  } catch (err) {
    console.error('share-meta:', err);
    return pageRes;
  }
};
