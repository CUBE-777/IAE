import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('CSP: script-src لا يسمح بـ unsafe-inline ولا بأي CDN', () => {
  const line = (read('netlify.toml').match(/^\s*script-src\s.*$/m) || [])[0];
  assert.ok(line, 'script-src غير موجود');
  assert.ok(!line.includes('unsafe-inline'));
  assert.ok(!/https?:\/\//.test(line), 'لا يجب السماح بنطاق خارجي للسكربتات');
});

test('index.html لا يحتوي سكربتًا inline قابلًا للتنفيذ', () => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/g)];
  assert.equal(inline.length, 0);
});

test('vite: لا sourcemap في الإنتاج', () => {
  assert.match(read('vite.config.js'), /sourcemap:\s*false/);
});

// اختبار الصلاحيات (الراوتر ↔ SQL ↔ Edge Function ↔ القائمة) انتقل إلى tests/roles.test.js

test('0021: إدراج طلبات الانخراط مقيّد بالأعمدة والحالة الأولية', () => {
  const sql = read('supabase/migrations/0021_security_phase1.sql');
  assert.match(sql, /revoke insert on public\.membership_requests from anon, authenticated/);
  assert.match(sql, /grant insert \(full_name, email, phone, promotion, track, profession, city, message\)/);
  assert.match(sql, /status = 'pending'/);
});

test('0022: حد المعدل لكل عميل/بريد وسقف عام احتياطي، وجدول الـ throttle مغلق على أدوار العميل', () => {
  const sql = read('supabase/migrations/0022_rate_limit_per_client.sql');
  assert.match(sql, /raise exception 'rate_limited'/);
  assert.match(sql, /request\.headers/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.membership_request_throttle from public, anon, authenticated/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public, pg_temp/);
  // السقف العام لم يعد 30 (كان يسمح لمهاجم واحد بحجب الجميع)
  assert.doesNotMatch(sql, />= 30 then/);
});

test('netlify: ملفات /assets/ تُخزَّن طويلًا وtheme-init.js يُعاد التحقق منه', () => {
  const toml = read('netlify.toml');
  assert.match(toml, /for = "\/assets\/\*"[\s\S]*?immutable/);
  assert.match(toml, /for = "\/theme-init\.js"[\s\S]*?must-revalidate/);
});
