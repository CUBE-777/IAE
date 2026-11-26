import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('المسار العام للشهادة موجود ويستعمل صفحة مستقلة غير مفهرسة', () => {
  const router = read('src/app/router/index.jsx');
  const page = read('src/pages/public/VerifyCertificate.jsx');
  assert.match(router, /\/verify-certificate\/:token/);
  assert.match(router, /VerifyCertificate/);
  assert.match(page, /useNoindex\(\)/);
  assert.match(page, /verifyCertificate\(token\)/);
  assert.match(page, /valid.*revoked.*not_found.*problem/s);
  assert.doesNotMatch(page, /console\.(log|info|debug)\([^)]*token/i);
  assert.doesNotMatch(page, /\{token\}/);
});

test('خدمة التحقق لا ترسل إلى RPC إلا رمزًا مطابقًا ولا تحفظه', () => {
  const service = read('src/services/supabase/certificatePublic.service.js');
  assert.match(service, /\^\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(service, /rpc\('verify_certificate', \{ p_token: value \}\)/);
  assert.doesNotMatch(service, /localStorage|sessionStorage|document\.cookie|console\./);
});

test('قاموس التحقق موجود وصالح في اللغات الثلاث', () => {
  for (const lang of ['fr', 'ar', 'en']) {
    const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
    assert.ok(locale.certificateVerify, lang);
    for (const state of ['valid', 'revoked', 'not_found', 'problem']) {
      assert.ok(locale.certificateVerify.state[state]?.title, `${lang}: ${state} title`);
      assert.ok(locale.certificateVerify.state[state]?.text, `${lang}: ${state} text`);
    }
  }
});
