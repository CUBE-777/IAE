/**
 * netlify/edge-functions/lib/share-meta.js
 * منطق نقي (بلا Deno ولا شبكة) لمعاينات المشاركة وخريطة الموقع، فيُختبر بـ node:test (tests/share-meta.test.js).
 *
 * المشكلة: الموقع SPA، فزواحف واتساب/فيسبوك/تويتر/تيليغرام لا تنفّذ JavaScript وترى وسوم OG الثابتة في index.html
 * لكل رابط. الحل: Edge Function تتعرّف على هذه الزواحف فقط وتحقن وسوم الإعلان/المشروع/النشاط الحقيقية في HTML.
 */

export const SITE_NAME = 'Intelligence Artificielle Embarquée';

const CRAWLER_RE =
  /(whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|pinterest|skypeuripreview|embedly|vkshare|redditbot|iframely)/i;

export function isSocialCrawler(userAgent) {
  return CRAWLER_RE.test(String(userAgent || ''));
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** /announcement/:slug | /announcements/:slug | /projects/:slug | /activity/:slug → { kind, slug } أو null. */
export function resolveTarget(pathname) {
  const m = /^\/(announcement|announcements|projects|activity)\/([^/]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  let slug;
  try {
    slug = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!slug || slug.length > 160) return null;
  const kind = m[1] === 'projects' ? 'project' : m[1] === 'activity' ? 'activity' : 'announcement';
  return { kind, slug };
}

/** مسار + استعلام PostgREST. نفس شروط الصفحات العامة (RLS تطبّق الباقي: النافذة الزمنية للإعلانات مثلًا). */
export function restQuery(kind, slug) {
  const s = encodeURIComponent(slug);
  if (kind === 'project') {
    return `projects?select=title,summary,description,image_url&slug=eq.${s}&is_published=eq.true&deleted_at=is.null&limit=1`;
  }
  if (kind === 'activity') {
    return `activities?select=title,description,cover_image_url&slug=eq.${s}&status=eq.published&deleted_at=is.null&limit=1`;
  }
  return `announcements?select=title,text,excerpt,content,image_url&slug=eq.${s}&is_active=eq.true&limit=1`;
}

/** يحوّل HTML إلى نص مختصر صالح لوصف المعاينة. */
export function plainText(html, max = 200) {
  const text = String(html == null ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** يقبل https:// المطلق أو المسار النسبي /x فقط (يرفض javascript: وdata: وhttp:). */
export function absoluteUrl(value, origin) {
  const v = String(value == null ? '' : value).trim();
  if (/^https:\/\//i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return `${origin}${v}`;
  return '';
}

export function rowToMeta(kind, row, origin) {
  const r = row || {};
  let title = r.title || r.text || '';
  let description = '';
  let image = '';
  if (kind === 'project') {
    description = plainText(r.summary || r.description);
    image = r.image_url;
  } else if (kind === 'activity') {
    description = plainText(r.description);
    image = r.cover_image_url;
  } else {
    description = plainText(r.excerpt || r.content || r.text);
    image = r.image_url;
  }
  return { title: plainText(title, 120), description, image: absoluteUrl(image, origin), hasOwnImage: Boolean(absoluteUrl(image, origin)) };
}

/** كتلة الوسوم التي تحل محل وسوم index.html الثابتة. كل القيم مهرّبة. */
export function buildMetaBlock({ title, description, image, hasOwnImage, url, origin }) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const img = image || `${origin}/logo.jpg`;
  const desc = description || '';
  const lines = [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:image" content="${escapeHtml(img)}" />`,
    `<meta property="og:locale" content="ar_MA" />`,
    `<meta name="twitter:card" content="${hasOwnImage ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
  ];
  return lines.join('\n  ');
}

/** يحذف وسوم العنوان/الوصف/OG/Twitter/canonical الموجودة ثم يحقن الكتلة قبل </head>. */
export function injectMeta(html, block) {
  const src = String(html || '');
  if (!/<\/head>/i.test(src)) return src;
  const cleaned = src
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*?(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*)["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*?rel=["']canonical["'][^>]*>/gi, '');
  return cleaned.replace(/<\/head>/i, () => `  ${block}\n</head>`);
}

const STATIC_PATHS = [
  ['/', 'weekly', '1.0'],
  ['/members', 'weekly', '0.7'],
  ['/board', 'monthly', '0.6'],
  ['/announcements', 'weekly', '0.7'],
  ['/privacy', 'yearly', '0.3'],
];

function lastmod(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return m ? `\n    <lastmod>${m[1]}</lastmod>` : '';
}

function urlEntry(loc, changefreq, priority, mod) {
  return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lastmod(mod)}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

/** خريطة الموقع من الصفحات الثابتة + الإعلانات والأنشطة والمشاريع المنشورة. */
export function buildSitemap({ origin, announcements = [], projects = [], activities = [] }) {
  const entries = STATIC_PATHS.map(([p, f, pr]) => urlEntry(`${origin}${p}`, f, pr));
  if (projects.length) entries.splice(4, 0, urlEntry(`${origin}/projects`, 'weekly', '0.6'));
  const add = (rows, base, freq, prio) => {
    for (const r of rows) {
      if (!r || !r.slug) continue;
      entries.push(urlEntry(`${origin}${base}${encodeURIComponent(r.slug)}`, freq, prio, r.updated_at));
    }
  };
  add(activities, '/activity/', 'monthly', '0.5');
  add(projects, '/projects/', 'monthly', '0.6');
  add(announcements, '/announcement/', 'monthly', '0.5');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}
