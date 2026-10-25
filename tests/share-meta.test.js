import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isSocialCrawler, resolveTarget, restQuery, plainText, absoluteUrl, rowToMeta, buildMetaBlock, injectMeta, buildSitemap, escapeHtml,
} from '../netlify/edge-functions/lib/share-meta.js';

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ORIGIN = 'https://fsa-iae.netlify.app';

test('الزواحف: واتساب وفيسبوك وتيليغرام نعم، المتصفحات وGooglebot لا', () => {
  for (const ua of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1', 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0']) {
    assert.ok(isSocialCrawler(ua), ua);
  }
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36', 'Googlebot/2.1', '', undefined]) {
    assert.ok(!isSocialCrawler(ua), String(ua));
  }
});

test('resolveTarget: المسارات المدعومة فقط', () => {
  assert.deepEqual(resolveTarget('/announcement/a-123'), { kind: 'announcement', slug: 'a-123' });
  assert.deepEqual(resolveTarget('/announcements/a-123/'), { kind: 'announcement', slug: 'a-123' });
  assert.deepEqual(resolveTarget('/projects/robot-1'), { kind: 'project', slug: 'robot-1' });
  assert.deepEqual(resolveTarget('/activity/annual-meeting'), { kind: 'activity', slug: 'annual-meeting' });
  assert.equal(resolveTarget('/announcements'), null);
  assert.equal(resolveTarget('/admin/members'), null);
  assert.equal(resolveTarget('/activity/%E0%A4%A'), null); // ترميز تالف
  assert.equal(resolveTarget(`/projects/${'x'.repeat(200)}`), null);
});

test('restQuery: الـ slug مُرمَّز ولا يحقن مرشّحات إضافية', () => {
  const q = restQuery('announcement', 'a&is_active=eq.false');
  assert.ok(q.includes('slug=eq.a%26is_active%3Deq.false'));
  assert.equal((q.match(/is_active=/g) || []).length, 1);
  assert.match(restQuery('project', 'x'), /is_published=eq\.true/);
  assert.match(restQuery('activity', 'x'), /status=eq\.published/);
});

test('absoluteUrl: https أو مسار نسبي فقط', () => {
  assert.equal(absoluteUrl('https://x.co/a.jpg', ORIGIN), 'https://x.co/a.jpg');
  assert.equal(absoluteUrl('/uploads/a.jpg', ORIGIN), `${ORIGIN}/uploads/a.jpg`);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://x.co/a.jpg', '//evil.com/a.jpg', '']) {
    assert.equal(absoluteUrl(bad, ORIGIN), '', bad);
  }
});

test('plainText: يزيل الوسوم ويختصر', () => {
  assert.equal(plainText('<p>مرحبا <b>بكم</b></p>'), 'مرحبا بكم');
  assert.ok(plainText('x'.repeat(500)).length <= 200);
});

test('injectMeta: يستبدل وسوم index.html الحقيقية ويهرّب المحتوى الخبيث', () => {
  const meta = rowToMeta('announcement', {
    title: '"><script>alert(1)</script>إعلان',
    excerpt: 'وصف <img src=x onerror=alert(1)>',
    image_url: 'https://cdn.example/x.jpg',
  }, ORIGIN);
  const out = injectMeta(indexHtml, buildMetaBlock({ ...meta, url: `${ORIGIN}/announcement/a-1`, origin: ORIGIN }));
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/property="og:title"/g) || []).length, 1);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((out.match(/name="description"/g) || []).length, 1);
  assert.ok(out.includes(`href="${ORIGIN}/announcement/a-1"`));
  assert.ok(out.includes('content="https://cdn.example/x.jpg"'));
  assert.ok(out.includes('summary_large_image'));
  assert.ok(!out.includes('<script>alert(1)'), 'لم يُهرَّب العنوان');
  assert.ok(!out.includes('<img src=x'), 'لم يُهرَّب الوصف');
  assert.ok(out.includes('<div id="root">'), 'بقية الصفحة سليمة');
});

test('injectMeta: بلا صورة يعود إلى الشعار وبطاقة summary', () => {
  const meta = rowToMeta('project', { title: 'مشروع', summary: 'ملخص' }, ORIGIN);
  const out = injectMeta(indexHtml, buildMetaBlock({ ...meta, url: `${ORIGIN}/projects/p`, origin: ORIGIN }));
  assert.ok(out.includes(`property="og:image" content="${ORIGIN}/logo.jpg"`));
  assert.ok(out.includes('content="summary"'));
});

test('buildSitemap: روابط ديناميكية مُرمَّزة، وتجاهل slug الفارغ', () => {
  const xml = buildSitemap({
    origin: ORIGIN,
    announcements: [{ slug: 'a-1', updated_at: '2026-10-01T10:00:00Z' }, { slug: null }],
    projects: [{ slug: 'robot&co', updated_at: null }],
    activities: [{ slug: 'annual-meeting', updated_at: '2026-09-02' }],
  });
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes(`<loc>${ORIGIN}/announcement/a-1</loc>`));
  assert.ok(xml.includes('<lastmod>2026-10-01</lastmod>'));
  assert.ok(xml.includes(`<loc>${ORIGIN}/projects/robot%26co</loc>`));
  assert.ok(xml.includes(`<loc>${ORIGIN}/projects</loc>`));
  assert.ok(xml.includes(`<loc>${ORIGIN}/privacy</loc>`));
  assert.equal((xml.match(/<url>/g) || []).length, xml.match(/<\/url>/g).length);
  assert.ok(!xml.includes('/announcement/null'));
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('sitemap بلا مشاريع: لا رابط /projects', () => {
  assert.ok(!buildSitemap({ origin: ORIGIN }).includes('/projects'));
});
