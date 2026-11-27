import './helpers/esm-mocks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { verifyCertificate } = await import('../src/services/supabase/certificateVerify.service.js');
const { normalizeVerifyResult } = await import('../src/utils/certificateRender.js');

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v'.slice(0, 43);
const rpcReturning = (result) => { const calls = []; globalThis.__publicMock = { rpc: async (...a) => { calls.push(a); return result; } }; return calls; };

test('التحقق العام: valid يعيد بيانات الشهادة والاسم حسب وضع الخصوصية فقط', async () => {
  rpcReturning({ error: null, data: {
    status: 'valid', certificate_number: 'IAE-2026-000007', certificate_type: 'training', language: 'ar', campaign_title: 'دورة',
    activity_title: 'نشاط', activity_date: '2026-03-01', issued_at: '2026-05-01T10:00:00Z', holder_name: 'A*** B***',
    email: 'leak@example.org', member_id: 'x',
  } });
  const r = await verifyCertificate(TOKEN);
  assert.equal(r.status, 'valid');
  assert.equal(r.holder_name, 'A*** B***');
  assert.equal(r.certificate_number, 'IAE-2026-000007');
  assert.ok(!('email' in r) && !('member_id' in r), 'حقول خارج القائمة البيضاء');
});

test('التحقق العام: valid بوضع «بلا اسم» لا يحمل اسمًا', async () => {
  rpcReturning({ error: null, data: { status: 'valid', certificate_number: 'IAE-2026-000007', certificate_type: 'training', language: 'fr', holder_name: null } });
  const r = await verifyCertificate(TOKEN);
  assert.equal(r.status, 'valid');
  assert.equal(r.holder_name, null);
});

test('التحقق العام: revoked لا يكشف اسم صاحب الشهادة حتى لو أرسله الخادم خطأً', async () => {
  rpcReturning({ error: null, data: {
    status: 'revoked', certificate_number: 'IAE-2026-000007', certificate_type: 'training', issued_at: '2026-05-01', revoked_at: '2026-06-01',
    holder_name: 'Prénom Nom', recipient_name: 'Prénom Nom', campaign_title: 'Titre', email: 'a@b.co',
  } });
  const r = await verifyCertificate(TOKEN);
  assert.equal(r.status, 'revoked');
  assert.deepEqual(Object.keys(r).sort(), ['certificate_number', 'certificate_type', 'issued_at', 'revoked_at', 'status']);
  assert.ok(!JSON.stringify(r).includes('Prénom'));
});

test('التحقق العام: not_found وأي شكل غريب → not_found بلا أي بيانات', async () => {
  rpcReturning({ error: null, data: { status: 'not_found', holder_name: 'Secret Name', certificate_number: 'IAE-2026-000007' } });
  assert.deepEqual(await verifyCertificate(TOKEN), { status: 'not_found' });
  for (const odd of [null, undefined, 'valid', 42, [], { status: 'valid' }, { status: 'revoked' }, { status: 'weird', holder_name: 'X' }]) {
    assert.deepEqual(normalizeVerifyResult(odd), { status: 'not_found' }, JSON.stringify(odd));
  }
});

test('التحقق العام: رمز مشوّه لا يُرسَل للخادم أصلًا', async () => {
  const calls = rpcReturning({ error: null, data: { status: 'valid' } });
  for (const bad of ['', null, undefined, 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`, '../etc/passwd']) {
    assert.deepEqual(await verifyCertificate(bad), { status: 'not_found' });
  }
  assert.equal(calls.length, 0);
});

test('التحقق العام: خطأ الشبكة/الخادم يرمي رمزًا ثابتًا (ليس حكمًا على الشهادة) ولا يتسرّب الرمز', async () => {
  rpcReturning({ data: null, error: { message: `boom ${TOKEN}`, code: 'PGRST000' } });
  await assert.rejects(verifyCertificate(TOKEN), (e) => e.message === 'certificate_verify_failed' && !e.message.includes(TOKEN));
  // fetch نفسه يرفض (انقطاع شبكة): الرفض يصل للصفحة كما هو لتعرض حالة problem
  globalThis.__publicMock = { rpc: async () => { throw new TypeError('Failed to fetch'); } };
  await assert.rejects(verifyCertificate(TOKEN));
});

test('التحقق العام: يستعمل RPC verify_certificate بالعميل المجهول وبوسيط الرمز فقط', async () => {
  const calls = rpcReturning({ error: null, data: { status: 'not_found' } });
  await verifyCertificate(TOKEN);
  assert.deepEqual(calls[0], ['verify_certificate', { p_token: TOKEN }]);
  const svc = read('src/services/supabase/certificateVerify.service.js');
  assert.match(svc, /from '\.\/publicClient'/);
  assert.doesNotMatch(svc, /from '\.\/client'/);
});

test('التحقق العام (الصفحة): الحالات الأربع، الشبكة ≠ ملغاة، لا تخزين ولا تسجيل للرمز ولا عرضه', () => {
  const page = stripJs(read('src/pages/public/VerifyCertificate.jsx'));
  for (const s of ["valid: {", "revoked: {", "not_found: {", "problem: {"]) assert.ok(page.includes(s), s);
  assert.match(page, /\.catch\(\(\) => alive && setPhase\(\{ kind: 'problem' \}\)\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(page, /console\./);
  assert.doesNotMatch(page, /\{token\}|\$\{token\}/, 'الرمز يظهر في الواجهة/العنوان');
  // الملغاة: لا صفّ holder
  const revoked = page.slice(page.indexOf("state === 'revoked' && ("), page.indexOf("state === 'problem' && ("));
  assert.doesNotMatch(revoked, /holder|campaign|activity/);
  // not_found: لا صفوف بيانات أصلًا
  assert.doesNotMatch(page, /state === 'not_found' && \(/);
  // زر إعادة المحاولة عند problem
  assert.match(page, /state === 'problem'[\s\S]*certificateVerify\.retry/);
});

test('التحقق العام (المسار): /verify-certificate/:token مستقل عن /verify/:token ومحمي بترويسات no-referrer/noindex', () => {
  const router = read('src/app/router/index.jsx');
  assert.match(router, /path: '\/verify-certificate\/:token', element: <VerifyCertificate \/>/);
  assert.match(router, /path: '\/verify\/:token', element: <VerifyCard \/>/);
  assert.notEqual(router.match(/path: '\/verify-certificate\/:token', element: <(\w+)/)[1], router.match(/path: '\/verify\/:token', element: <(\w+)/)[1]);
  const toml = read('netlify.toml');
  const block = toml.slice(toml.indexOf('for = "/verify-certificate/*"'));
  assert.match(block.slice(0, 300), /X-Robots-Tag = "noindex, nofollow"/);
  assert.match(block.slice(0, 300), /Referrer-Policy = "no-referrer"/);
});

test('التحقق العام (QR→RPC→الصفحة): مسار التحقق في الـ QR يطابق المسار والنمط وRPC يعيد الحالات الثلاث فقط', () => {
  const R = fs.readFileSync(new URL('../src/utils/certificateRender.js', import.meta.url), 'utf8');
  assert.match(R, /VERIFY_PATH_RE = \/\^\\\/verify-certificate\\\/\[A-Za-z0-9_-\]\{43\}\$\//);
  const sql = read('supabase/migrations/0064_certificates_admin_functions.sql');
  const body = sql.slice(sql.indexOf('function public.verify_certificate('), sql.indexOf('-- 11) المنح'));
  assert.equal((body.match(/'status', '(valid|revoked|not_found)'/g) || []).length, 4); // not_found ×2 + revoked + valid
  const revoked = body.slice(body.indexOf("if v_c.status = 'revoked'"), body.indexOf("return jsonb_build_object(\n    'status', 'valid'"));
  assert.doesNotMatch(revoked.replace(/--.*$/gm, ''), /recipient_name|holder_name/);
});
