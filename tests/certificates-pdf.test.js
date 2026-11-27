import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as D from '../src/pages/admin/certificateDesign.js';
import * as C from '../src/utils/certificateRender.js';
import { createZip, crc32 } from '../src/utils/zipBuilder.js';
import { qrMatrix, QR_QUIET_ZONE } from '../src/utils/qr.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOKEN = 'A'.repeat(43);
const origin = 'https://fsa-iae.netlify.app';
const render = (o = {}) => ({
  certificate_id: 'c1', certificate_number: 'IAE-2026-000123', certificate_type: 'participation', language: 'fr',
  recipient_name: 'Sara El Amrani', campaign_title: 'Atelier', activity_title: 'Atelier de leadership', activity_date: '2026-05-09',
  issued_at: '2026-05-20T10:00:00Z', template_style: 'academic', template_design: {}, token: TOKEN, verification_path: `/verify-certificate/${TOKEN}`, ...o,
});

// ---------------------------------------------------------------- ZIP
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true); const size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true); const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc); assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc);
    out.push({ name, data });
    p += 46 + nl;
  }
  return out;
}
const concat = (parts) => { const o = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o; };

test('ZIP: بنية صحيحة وأسماء UTF-8 (عربي) ومحتوى مطابق وCRC سليم', () => {
  const z = createZip();
  const a = new TextEncoder().encode('%PDF-1.3 A'); const b = new Uint8Array(70000).map((_, i) => i % 251);
  z.add('IAE-2026-000001_Sara.pdf', a);
  z.add('IAE-2026-000002_سارة-العمراني.pdf', b);
  const files = readZip(concat(z.finish()));
  assert.deepEqual(files.map((f) => f.name), ['IAE-2026-000001_Sara.pdf', 'IAE-2026-000002_سارة-العمراني.pdf']);
  assert.deepEqual([...files[0].data], [...a]); assert.deepEqual([...files[1].data], [...b]);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP: يرفض الفارغ وأسماء المسارات وأنواع خاطئة', () => {
  const z = createZip();
  assert.throws(() => z.finish(), /zip_empty/);
  for (const bad of ['', 'a/b.pdf', 'a\\b.pdf', '..']) assert.throws(() => z.add(bad, new Uint8Array(1)), /zip_bad_name/);
  assert.throws(() => z.add('x.pdf', 'text'), /zip_bad_bytes/);
});

// ---------------------------------------------------------------- المتغيّرات والتصميم والـ QR
test('PDF: المتغيّرات حقيقية وكاملة (بلا بيانات تجريبية ولا {{}} متبقية) بالفرنسية والعربية والإنجليزية', () => {
  for (const lang of D.LANGS) {
    const v = C.certificateVariables(render({ language: lang }));
    assert.deepEqual(Object.keys(v).sort(), [...D.VARIABLES].sort());
    assert.equal(v.recipient_name, 'Sara El Amrani');
    assert.equal(v.certificate_number, 'IAE-2026-000123');
    assert.ok(v.activity_date && v.issued_at);
    for (const s of Object.values(D.SAMPLE[lang])) assert.notEqual(v.activity_date, s);
  }
  assert.match(C.certificateVariables(render({ language: 'ar' })).issued_at, /ماي|مايو/);
  assert.match(C.certificateVariables(render({ language: 'fr' })).activity_date, /9 mai 2026/);
  assert.match(C.certificateVariables(render({ language: 'en' })).activity_date, /May 9, 2026/);
  const empty = C.certificateVariables(render({ activity_title: null, activity_date: null }));
  assert.equal(empty.activity_title, ''); assert.equal(empty.activity_date, '');
  assert.equal(C.certLang({ language: 'xx' }), 'fr');
});

test('PDF: التصميم يُحلّ كما في المصمّم (تخطيط محفوظ أو ابتدائي) وفيه QR', () => {
  const preset = C.resolveCertificateDesign(render({ template_style: 'premium', template_design: { colors: { navy: '#142B4A' } } }));
  assert.ok(preset.elements.some((e) => e.type === 'qr'));
  const saved = D.presetDesign('modern');
  const same = C.resolveCertificateDesign(render({ template_style: 'modern', template_design: saved }));
  assert.deepEqual(same.elements, D.sanitizeDesign(saved).elements);
  assert.equal(same.page.orientation, 'landscape');
  assert.ok(C.resolveCertificateDesign({}).elements.length > 0, 'قالب مفقود → تصميم افتراضي صالح');
});

test('QR: يفتح /verify-certificate/:token فقط، ويرفض أي مسار آخر دون كشف الرمز', () => {
  assert.equal(C.certificateQrUrl(`${origin}/`, `/verify-certificate/${TOKEN}`), `${origin}/verify-certificate/${TOKEN}`);
  for (const bad of [`/verify/${TOKEN}`, '/verify-certificate/short', null, `/verify-certificate/${TOKEN}?x=1`, `//evil.com/verify-certificate/${TOKEN}`]) {
    assert.throws(() => C.certificateQrUrl(origin, bad), (e) => e.message === 'certificate_qr_invalid' && !e.message.includes(TOKEN));
  }
  assert.throws(() => C.certificateQrUrl('javascript:alert(1)', `/verify-certificate/${TOKEN}`), /certificate_qr_invalid/);
  const m = C.certificatePdfModel(render(), origin);
  assert.equal(m.qrText, `${origin}/verify-certificate/${TOKEN}`);
  assert.equal(m.fileName, 'IAE-2026-000123_Sara-El-Amrani.pdf');
  assert.ok(!m.fileName.includes(TOKEN));
  assert.throws(() => C.certificatePdfModel(render({ certificate_number: 'x' }), origin), /certificate_render_invalid/);
  assert.throws(() => C.certificatePdfModel(render({ recipient_name: ' ' }), origin), /certificate_render_invalid/);
  assert.throws(() => C.certificatePdfModel(render({ verification_path: null }), origin), /certificate_qr_invalid/);
});

test('QR: المستطيلات المتجهية تطابق مصفوفة QR الحقيقية وضمن صندوق العنصر', () => {
  const text = `${origin}/verify-certificate/${TOKEN}`;
  const mod = qrMatrix(text); const size = mod.length;
  const q = C.qrRects(text, 100, 150, 40, 30); // صندوق غير مربّع → مربع مركزي بضلع 30
  assert.equal(q.side, 30); assert.equal(q.ox, 105); assert.equal(q.oy, 150);
  const grid = Array.from({ length: size }, () => Array(size).fill(false));
  for (const r of q.rects) {
    const row = Math.round((r.y - q.oy) / q.module) - QR_QUIET_ZONE; const c0 = Math.round((r.x - q.ox) / q.module) - QR_QUIET_ZONE;
    for (let k = 0; k < Math.round(r.w / q.module); k += 1) grid[row][c0 + k] = true;
    assert.ok(r.x >= q.ox && r.x + r.w <= q.ox + q.side + 1e-9 && r.y >= q.oy && r.y + r.h <= q.oy + q.side + 1e-9);
  }
  assert.deepEqual(grid, mod);
});

// ---------------------------------------------------------------- أسماء الملفات
test('الملفات: أسماء واضحة بالرقم والاسم، آمنة، وتدعم العربية', () => {
  assert.equal(C.certificateFileName('IAE-2026-000007', 'Zoé  Ben/Ali..'), 'IAE-2026-000007_Zoe-Ben-Ali.pdf');
  assert.equal(C.certificateFileName('IAE-2026-000008', 'سارة العمراني'), 'IAE-2026-000008_سارة-العمراني.pdf');
  assert.equal(C.certificateFileName('bad', '???'), 'certificat_beneficiaire.pdf');
  assert.ok(!/[\\/:*?"<>|]/.test(C.certificateFileName('IAE-2026-000009', 'a/b\\c:d*e?"f<g>h|i')));
  assert.ok(C.certificateFileName('IAE-2026-000010', 'x'.repeat(300)).length < 80);
  assert.equal(C.campaignZipName('Atelier de leadership', new Date('2026-03-20T00:00:00Z')), 'Certificats-Atelier-de-leadership-20260320.zip');
});

// ---------------------------------------------------------------- ZIP جماعي
const rec = (o) => ({ id: 'r', display_name: 'X', status: 'issued', certificate_status: 'valid', certificate_id: 'c', ...o });
test('جماعي: الصادرة الصالحة فقط (يُستبعد pending وrevoked وما بلا شهادة)', () => {
  const list = [rec({ id: '1' }), rec({ id: '2', status: 'pending', certificate_status: null, certificate_id: null }), rec({ id: '3', certificate_status: 'revoked' }), rec({ id: '4', certificate_id: null })];
  assert.deepEqual(C.bulkEligible(list).map((r) => r.id), ['1']);
  assert.deepEqual(C.bulkEligible(null), []);
});

test('جماعي: تقدّم تدريجي، فشل جزئي (ملغاة/خطأ)، بلا تسريب نصوص خام، ZIP صالح للناجح فقط', async () => {
  const events = []; let active = 0; let maxActive = 0;
  const renderPdf = async (id) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 1)); active -= 1;
    if (id === 'rev') throw Object.assign(new Error('certificate_revoked'), { code: '22023' });
    if (id === 'boom') throw new Error(`network down for token ${TOKEN}`);
    return { bytes: new TextEncoder().encode(`%PDF ${id}`), fileName: id === 'dup' ? 'IAE-2026-000001_A.pdf' : `IAE-2026-${id}_A.pdf` };
  };
  const items = [{ id: '000001', name: 'A' }, { id: 'rev', name: 'B' }, { id: 'boom', name: 'C' }, { id: 'dup', name: 'D' }];
  const res = await C.buildCertificatesZip({ items, renderPdf, onProgress: (p) => events.push({ ...p }) });
  assert.equal(maxActive, 1, 'معالجة تسلسلية');
  assert.equal(res.total, 4); assert.equal(res.ok, 2);
  assert.deepEqual(res.failures.map((f) => [f.id, f.code]), [['rev', 'certificate_revoked'], ['boom', 'certificate_pdf_failed']]);
  assert.ok(!JSON.stringify(res.failures).includes(TOKEN), 'الرمز لا يظهر في الإخفاقات');
  assert.deepEqual(events.map((e) => e.done), [0, 1, 2, 3, 4]);
  assert.deepEqual(events.at(-1), { total: 4, done: 4, ok: 2, failed: 2 });
  const files = readZip(new Uint8Array(await res.blob.arrayBuffer()));
  assert.deepEqual(files.map((f) => f.name), ['IAE-2026-000001_A.pdf', 'IAE-2026-000001_A-2.pdf'], 'تضارب الأسماء يُحلّ بلا استبدال');
});

test('جماعي: لا ZIP فارغ عند الفشل الكامل أو عدم وجود عناصر', async () => {
  const fail = await C.buildCertificatesZip({ items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], renderPdf: async () => { throw new Error('x'); } });
  assert.equal(fail.blob, null); assert.equal(fail.ok, 0); assert.equal(fail.failures.length, 2);
  const none = await C.buildCertificatesZip({ items: [], renderPdf: async () => { throw new Error('unused'); } });
  assert.equal(none.blob, null); assert.equal(none.total, 0);
});

// ---------------------------------------------------------------- التحقق العام
test('التحقق: valid يحمل الحقول المسموحة، وrevoked/not_found بلا أي اسم أو بيانات شخصية حتى لو سرّبها الخادم', () => {
  const v = C.normalizeVerifyResult({ status: 'valid', certificate_number: 'IAE-2026-000123', certificate_type: 'participation', language: 'fr', campaign_title: 'T', activity_title: 'A', activity_date: '2026-05-09', issued_at: '2026-03-20T10:00:00Z', holder_name: 'S**** E*****', email: 'a@b.c', member_id: 'm' });
  assert.equal(v.status, 'valid'); assert.equal(v.holder_name, 'S**** E*****'); assert.ok(!('email' in v) && !('member_id' in v));
  assert.equal(C.normalizeVerifyResult({ status: 'valid', certificate_number: 'IAE-2026-000123', holder_name: null }).holder_name, null);
  const leak = { certificate_number: 'IAE-2026-000123', certificate_type: 'training', issued_at: 'x', revoked_at: 'y', holder_name: 'Sara', recipient_name: 'Sara', campaign_title: 'T', email: 'a@b.c', revoke_reason: 'why' };
  const r = C.normalizeVerifyResult({ status: 'revoked', ...leak });
  assert.deepEqual(Object.keys(r).sort(), ['certificate_number', 'certificate_type', 'issued_at', 'revoked_at', 'status']);
  for (const raw of [{ status: 'not_found', ...leak }, null, undefined, 'x', {}, { status: 'weird', ...leak }, { status: 'valid' }, { status: 'revoked' }]) {
    assert.deepEqual(C.normalizeVerifyResult(raw), { status: 'not_found' });
  }
});

// ---------------------------------------------------------------- مسح ثابت للمصدر
test('الأمان: لا تخزين للرمز/PDF ولا تسجيله، والخدمة العامة تستعمل العميل المجهول، ولا خلط مع /verify/', () => {
  const files = ['src/utils/certificatePdf.js', 'src/utils/certificateRender.js', 'src/utils/zipBuilder.js', 'src/components/certificates/CertificatePage.jsx',
    'src/pages/public/VerifyCertificate.jsx', 'src/services/supabase/certificateVerify.service.js'];
  for (const f of files) {
    const s = read(f);
    assert.ok(!/localStorage|sessionStorage|indexedDB|console\.(log|error|warn|info)|\.storage\b|crypto\.(subtle|getRandomValues)|randomUUID/.test(s), `${f}: تخزين/تسجيل/توليد رموز`);
  }
  const svc = read('src/services/supabase/certificateVerify.service.js');
  assert.match(svc, /supabasePublic\.rpc\('verify_certificate', \{ p_token: token \}\)/);
  assert.match(svc, /throw new Error\('certificate_verify_failed'\)/);
  const admin = read('src/services/supabase/adminCertificates.service.js');
  assert.match(admin, /rpc\('get_certificate_render_data', \{ p_certificate_id: certificateId \}\)/);
  const router = read('src/app/router/index.jsx');
  assert.match(router, /path: '\/verify-certificate\/:token', element: <VerifyCertificate \/>/);
  assert.match(router, /path: '\/verify\/:token', element: <VerifyCard \/>/);
  assert.ok(!/verify_member_card/.test(svc + read('src/pages/public/VerifyCertificate.jsx')));
  assert.ok(!/verify_certificate/.test(read('src/pages/public/VerifyCard.jsx')));
  const page = read('src/pages/public/VerifyCertificate.jsx');
  assert.ok(!/\{token\}|token\)\}|useCanonicalUrl|InteriorLayout|document\.title = .*token/.test(page), 'الرمز لا يُعرض ولا يدخل canonical/العنوان');
  assert.match(page, /useNoindex\(\)/);
  assert.match(read('netlify.toml'), /for = "\/verify-certificate\/\*"[\s\S]*?Referrer-Policy = "no-referrer"[\s\S]*?Cache-Control = "no-store"/);
  assert.match(read('public/robots.txt'), /Disallow: \/verify-certificate\//);
});

test('PDF: A4 أفقي بـ jsPDF/html2canvas الموجودتين عند الضغط فقط، وQR الحقيقي من الرمز الآمن، بلا Storage ولا مكتبات جديدة', () => {
  const s = read('src/utils/certificatePdf.js');
  assert.match(s, /format: 'a4', orientation: 'landscape'/);
  assert.match(s, /import\('html2canvas'\)/); assert.match(s, /import\('jspdf'\)/);
  assert.ok(!/^import .*(html2canvas|jspdf)/m.test(s), 'المكتبتان تُحمَّلان عند الطلب لا ثابتًا');
  assert.ok(!/storage|\.from\(|upload/i.test(s), 'لا تخزين PDF');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!('jszip' in pkg.dependencies) && Object.keys(pkg.dependencies).length === 11, 'لا dependencies جديدة');
  // المعاينة (المصمّم) والـ PDF يستعملان نفس ElementBody
  assert.match(read('src/pages/admin/CertificateDesignerCanvas.jsx'), /import \{ ElementBody \} from '\.\.\/\.\.\/components\/certificates\/CertificatePage'/);
  assert.match(s, /import CertificatePage from '\.\.\/components\/certificates\/CertificatePage'/);
  assert.ok(!/SAMPLE/.test(s + read('src/utils/certificateRender.js')), 'لا بيانات تجريبية في الشهادات الحقيقية');
});

test('الواجهة: أزرار التنزيل للمدراء فقط (canManage) وللصادرة الصالحة فقط، والمراجعة بلا تنزيل', () => {
  const d = read('src/pages/admin/CertificateCampaignDetail.jsx');
  assert.match(d, /\{canManage && \(\s*<div className="admin-quick-actions">\s*<button[^>]*onClick=\{downloadAll\}/);
  assert.match(d, /isBulkEligible\(r\) && \(\s*<button[^>]*onClick=\{\(\) => downloadOne\(r\)\}/);
  assert.match(d, /canManage && !archived && \(/);
  assert.ok(!/supabase\./.test(d));
});

test('الترجمة: مفاتيح pdf وcertificateVerify متطابقة في fr/ar/en وغير فارغة وبنفس المتغيّرات', () => {
  const L = Object.fromEntries(['fr', 'ar', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`))]));
  const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' ? flat(v, `${p}${k}.`, out) : (out[`${p}${k}`] = v)); return out; };
  const vars = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  for (const pick of [(x) => x.admin.certificates.pdf, (x) => x.certificateVerify]) {
    const m = Object.fromEntries(Object.entries(L).map(([l, x]) => [l, flat(pick(x))]));
    const keys = Object.keys(m.fr).sort();
    assert.ok(keys.length >= 9);
    for (const l of ['ar', 'en']) {
      assert.deepEqual(Object.keys(m[l]).sort(), keys);
      for (const k of keys) { assert.ok(String(m[l][k]).trim(), `${l}:${k}`); assert.deepEqual(vars(m[l][k]), vars(m.fr[k])); }
    }
  }
  for (const l of ['fr', 'ar', 'en']) {
    for (const c of ['certificate_revoked', 'certificate_render_invalid', 'certificate_qr_invalid', 'certificate_pdf_failed', 'certificate_not_found']) assert.ok(L[l].admin.certificates.errors[c], `${l}:${c}`);
    for (const s of ['valid', 'revoked', 'not_found', 'problem']) assert.ok(L[l].certificateVerify.state[s].title && L[l].certificateVerify.state[s].text);
  }
  assert.ok(!/\{\{holder|name/i.test(JSON.stringify(L.fr.certificateVerify.state.revoked)), 'نص الملغاة بلا اسم');
});
