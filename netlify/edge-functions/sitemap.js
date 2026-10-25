// netlify/edge-functions/sitemap.js
// sitemap.xml ديناميكي: الصفحات الثابتة + الإعلانات والأنشطة والمشاريع المنشورة.
// إن تعذّر الوصول لقاعدة البيانات يُقدَّم public/sitemap.xml الثابت كما هو (احتياطي).
import { buildSitemap } from './lib/share-meta.js';

export const config = { path: '/sitemap.xml' };

const env = (k) => globalThis.Netlify?.env?.get?.(k) ?? globalThis.Deno?.env?.get?.(k);

export default async (request, context) => {
  try {
    const base = env('VITE_SUPABASE_URL');
    const key = env('VITE_SUPABASE_PUBLISHABLE_KEY');
    if (!base || !key) return context.next();
    const get = async (q) => {
      const res = await fetch(`${base}/rest/v1/${q}`, { headers: { apikey: key, Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`sitemap query failed: ${res.status}`);
      return res.json();
    };
    const [announcements, projects, activities] = await Promise.all([
      get('announcements?select=slug,updated_at&is_active=eq.true&slug=not.is.null&order=created_at.desc&limit=500'),
      get('projects?select=slug,updated_at&is_published=eq.true&deleted_at=is.null&limit=500'),
      get('activities?select=slug,updated_at&status=eq.published&deleted_at=is.null&slug=not.is.null&limit=500'),
    ]);
    const xml = buildSitemap({ origin: new URL(request.url).origin, announcements, projects, activities });
    return new Response(xml, {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  } catch (err) {
    console.error('sitemap:', err);
    return context.next();
  }
};
