import './helpers/esm-mocks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// الاستيراد الديناميكي بعد تسجيل المحاكيات: الاستيراد الساكن يحلّ كل الرسم البياني قبل تنفيذ register()
const { normalizeMyCertificates, canDownloadCertificate, memberCertErrorCode } = await import('../src/utils/memberCertificates.js');
const { fetchMyCertificates } = await import('../src/services/supabase/memberCertificates.service.js');

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sql64 = stripSql(read('supabase/migrations/0064_certificates_admin_functions.sql'));
const fnBody = (src, name) => {
  const i = src.indexOf(`function public.${name}(`);
  assert.ok(i > -1, name);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'T'.repeat(43);
const row = (over = {}) => ({
  id: ID1, certificate_number: 'IAE-2026-000001', certificate_type: 'participation', campaign_title: 'Atelier IA', language: 'fr',
  issued_at: '2026-05-01T10:00:00Z', status: 'valid', public_name_mode: 'masked', token: TOKEN, ...over,
});

test('شهاداتي: التنظيف يُسقط الرمز الخام وأي حقل غير مدرج في القائمة البيضاء', () => {
  const [c] = normalizeMyCertificates([row()]);
  assert.deepEqual(Object.keys(c).sort(), ['campaign_title', 'certificate_number', 'certificate_type', 'id', 'issued_at', 'status']);
  assert.ok(!JSON.stringify(c).includes(TOKEN), 'الرمز الخام ظهر');
  assert.ok(!('token' in c) && !('member_id' in c) && !('public_name_mode' in c));
});

test('شهاداتي: الصفوف الغريبة تُستبعد (معرّف/رقم/حالة غير صالحة، غير مصفوفة)', () => {
  assert.deepEqual(normalizeMyCertificates(null), []);
  assert.deepEqual(normalizeMyCertificates({ id: ID1 }), []);
  const out = normalizeMyCertificates([row({ id: 'x' }), row({ certificate_number: 'bad' }), row({ status: 'pending' }), null, 5, row({ id: ID2 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, ID2);
});

test('شهاداتي: الصالحة فقط قابلة للتحميل؛ الملغاة لا', () => {
  const [valid, revoked] = normalizeMyCertificates([row(), row({ id: ID2, status: 'revoked', token: null })]);
  assert.equal(canDownloadCertificate(valid), true);
  assert.equal(canDownloadCertificate(revoked), false);
  assert.equal(canDownloadCertificate(null), false);
  assert.equal(canDownloadCertificate({ id: 'not-a-uuid', status: 'valid' }), false);
});

test('شهاداتي: رمز خطأ التحميل ثابت ولا يمرّر نصًا حرًّا من الخادم', () => {
  assert.equal(memberCertErrorCode(new Error('certificate_revoked')), 'certificate_revoked');
  assert.equal(memberCertErrorCode(new Error('certificate_not_found')), 'certificate_not_found');
  assert.equal(memberCertErrorCode(new Error('select * from members')), 'certificate_pdf_failed');
  assert.equal(memberCertErrorCode(null), 'certificate_pdf_failed');
});

test('شهاداتي: الخدمة تستدعي get_my_certificates بلا أي وسيط (لا member_id من العميل)', async () => {
  const calls = [];
  globalThis.__supabaseMock = { rpc: async (...args) => { calls.push(args); return { data: [row()], error: null }; } };
  const list = await fetchMyCertificates();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['get_my_certificates'], 'يجب ألا تُمرَّر أي وسائط');
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(TOKEN));
});

test('شهاداتي: خطأ RPC يصبح رمزًا ثابتًا بلا تفاصيل', async () => {
  globalThis.__supabaseMock = { rpc: async () => ({ data: null, error: { message: 'secret detail IAE-2026-000001', code: '42501' } }) };
  await assert.rejects(fetchMyCertificates(), (e) => e.message === 'certificate_list_failed');
});

test('شهاداتي: قائمة فارغة من الخادم تعني قائمة فارغة (لا بيانات احتياطية)', async () => {
  globalThis.__supabaseMock = { rpc: async () => ({ data: [], error: null }) };
  assert.deepEqual(await fetchMyCertificates(), []);
});

test('شهاداتي (SQL): get_my_certificates بلا وسائط، تقيّد بـ current_member_id، وfail-closed', () => {
  const b = fnBody(sql64, 'get_my_certificates');
  assert.match(b, /get_my_certificates\(\)/);
  assert.match(b, /v_me := public\.current_member_id\(\)/);
  assert.match(b, /auth\.uid\(\) is null or v_me is null[\s\S]*certificate_member_required/);
  assert.match(b, /c\.member_id is not null and c\.member_id = v_me/);
  assert.doesNotMatch(b, /p_member_id|member_id\s*=\s*p_/);
  // الرمز يُشتق للصالحة فقط
  assert.match(b, /case when c\.status = 'valid' then public\.certificate_token_for/);
});

test('شهاداتي (SQL): get_certificate_render_data ترفض ملكية عضو آخر بنفس خطأ «غير موجودة» وترفض الملغاة', () => {
  const b = fnBody(sql64, 'get_certificate_render_data');
  assert.match(b, /not \(public\.can_manage_certificates\(\) or \(v_me is not null and v_c\.member_id is not null and v_c\.member_id = v_me\)\)/);
  const notFound = b.indexOf("raise exception 'certificate_not_found'", b.indexOf('not found or not'));
  const revoked = b.indexOf("raise exception 'certificate_revoked'");
  assert.ok(notFound > -1 && revoked > notFound, 'فحص الملكية قبل فحص الإلغاء (لا كشف وجود)');
  assert.doesNotMatch(b, /recipient_email|'email'/, 'لا بريد في بيانات التوليد');
});

test('شهاداتي (SQL): المنح — get_my_certificates وget_certificate_render_data لـ authenticated فقط', () => {
  assert.match(sql64, /grant execute on function public\.get_my_certificates\(\)\s+to authenticated;/);
  assert.match(sql64, /grant execute on function public\.get_certificate_render_data\(uuid\)\s+to authenticated;/);
  assert.doesNotMatch(sql64, /grant execute on function public\.(get_my_certificates|get_certificate_render_data)[^;]*anon/);
});

test('شهاداتي (الصفحة): لا member_id ولا معاملات رابط ولا console ولا token، والزر للصالحة فقط', () => {
  const page = stripJs(read('src/pages/member/MemberCertificates.jsx'));
  const svc = stripJs(read('src/services/supabase/memberCertificates.service.js'));
  const util = stripJs(read('src/utils/memberCertificates.js'));
  for (const [name, src] of [['page', page], ['service', svc], ['util', util]]) {
    assert.doesNotMatch(src, /member_id|memberId/, `${name}: member_id`);
    assert.doesNotMatch(src, /console\./, `${name}: console`);
    assert.doesNotMatch(src, /localStorage|sessionStorage/, `${name}: تخزين`);
  }
  assert.doesNotMatch(page, /useParams|useSearchParams|location\.search|URLSearchParams/);
  assert.doesNotMatch(page, /\.token\b|c\.token/, 'عرض الرمز الخام');
  assert.match(page, /import \{ downloadCertificatePdf \} from '\.\.\/\.\.\/utils\/certificatePdf'/);
  assert.match(page, /canDownloadCertificate\(c\)/);
  // زر التحميل داخل فرع valid فقط
  const validBranch = page.slice(page.indexOf('{valid ? ('), page.indexOf(') : ('));
  assert.match(validBranch, /download\(c\)/);
  assert.ok(!page.slice(page.indexOf(') : (')).includes('download(c)'), 'زر تحميل في فرع الملغاة');
  // الحالات الثلاث + إعادة المحاولة
  for (const s of ["status === 'loading'", "status === 'error'", 'rows.length === 0']) assert.ok(page.includes(s), s);
  assert.match(page, /onClick=\{load\}/);
});

test('شهاداتي: route محمي داخل /member، ورابط واضح في القائمة الجانبية وقائمة «المزيد»', () => {
  const router = read('src/app/router/index.jsx');
  const member = router.slice(router.indexOf("path: '/member',"), router.indexOf("path: '/member',") + 900);
  assert.match(member, /element: <MemberLayout \/>/);
  assert.match(member, /path: 'certificates', element: <MemberCertificates \/>/);
  assert.match(router, /lazy\(\(\) => import\('\.\.\/\.\.\/pages\/member\/MemberCertificates'\)\)/);
  const nav = read('src/components/member/MemberPage.jsx');
  assert.equal((nav.match(/to="\/member\/certificates"/g) || []).length, 2, 'الجانبية + المزيد');
});

test('شهاداتي: الترجمة ar/fr/en كاملة (RTL يأتي من اللغة) والمفاتيح مستعملة موجودة', () => {
  const keys = ['pageTitle', 'title', 'description', 'loading', 'loadError', 'empty', 'download', 'downloading', 'downloadOk', 'revokedNote',
    'status.valid', 'status.revoked', 'fields.type', 'fields.issuedAt', 'types.participation', 'types.organization', 'types.volunteering', 'types.training',
    'errors.certificate_not_found', 'errors.certificate_revoked', 'errors.certificate_render_invalid', 'errors.certificate_qr_invalid', 'errors.certificate_pdf_failed'];
  for (const l of ['ar', 'fr', 'en']) {
    const d = JSON.parse(read(`src/i18n/locales/${l}.json`));
    const get = (p) => p.split('.').reduce((a, k) => a?.[k], d);
    for (const k of keys) assert.ok(typeof get(`member.certificates.${k}`) === 'string' && get(`member.certificates.${k}`).length > 0, `${l}: member.certificates.${k}`);
    assert.ok(get('member.nav.certificates'), `${l}: member.nav.certificates`);
  }
});
