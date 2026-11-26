import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/constants/roles.js';
import { ADMIN_NAV } from '../src/constants/adminNav.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const quoted = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const sorted = (a) => [...a].sort();

const sql63 = read('supabase/migrations/0063_certificates_schema.sql');
const sql64 = read('supabase/migrations/0064_certificates_admin_functions.sql');
const service = read('src/services/supabase/adminCertificates.service.js');
const PAGES = ['Certificates', 'CertificateCampaignDetail', 'CertificateCampaignFormModal', 'CertificateRecipientModals', 'certificateUi'];

const sqlRoles = (fn) => {
  const m = sql63.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?in \\(([^)]*)\\)`));
  assert.ok(m, `${fn} غير موجودة في 0063`);
  return quoted(m[1]);
};

test('الشهادات: مجموعات الأدوار في الواجهة مطابقة لدوال SQL (0063)', () => {
  assert.deepEqual(sorted(R.ROLES_CERT_MANAGE), sorted(sqlRoles('can_manage_certificates')));
  assert.deepEqual(sorted(R.ROLES_CERT_REVIEW), sorted(sqlRoles('can_review_certificate_recipients')));
  for (const role of R.ROLES_CERT_REVIEW) assert.ok(R.ALL_ROLES.includes(role), `دور غير معروف: ${role}`);
  // التسلسل developer > super_admin: كلاهما في الإدارة، ولا دور جديد
  assert.ok(R.ROLES_CERT_MANAGE.includes('developer') && R.ROLES_CERT_MANAGE.includes('super_admin'));
  assert.ok(!R.ROLES_CERT_MANAGE.includes('members_manager'), 'members_manager للمراجعة فقط');
  assert.ok(R.ROLES_CERT_REVIEW.includes('members_manager'));
});

test('الشهادات: عنصر القائمة مربوط بالمسار والأدوار', () => {
  const item = ADMIN_NAV.find((i) => i.key === 'certificates');
  assert.ok(item, 'عنصر certificates مفقود');
  assert.equal(item.href, '/admin/certificates');
  assert.deepEqual(sorted(item.roles), sorted(R.ROLES_CERT_REVIEW));
  assert.match(read('src/app/router/index.jsx'), /path: '\/admin\/certificates', element: protectedAdmin\(ROLES_CERT_REVIEW,/);
});

test('الشهادات: الخدمة بلا select * ولا token_hash ولا كتابة مباشرة على الجداول', () => {
  assert.ok(!/select\(\s*['"`]\s*\*/.test(service), 'select * ممنوع');
  assert.ok(!/token_hash|token_epoch|certificate_token_secret|certificate_number_counters/.test(service), 'عمود/جدول حساس في الخدمة');
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(service), 'كتابة مباشرة على جدول');
  // قراءة الجداول مسموحة فقط للأربعة المعروفة
  const tables = [...service.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(sorted(new Set(tables)), ['activities', 'certificate_campaigns', 'certificate_recipients', 'certificate_templates', 'certificates', 'members']);
});

test('الشهادات: كل RPC مستعمل موجود في 0064 وmembers_manager يمرّ بالمراجعة فقط', () => {
  const defined = new Set([...sql64.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]));
  const used = [...service.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 9);
  for (const fn of used) assert.ok(defined.has(fn), `RPC غير معرّف في 0064: ${fn}`);
  // فرع المراجعة (canManage=false) لا يلمس الجداول
  const review = service.slice(service.indexOf('if (!canManage) {'), service.indexOf('const { data: rows, error }'));
  assert.match(review, /rpc\('certificate_review_recipients'/);
  assert.ok(!/\.from\(/.test(review), 'فرع المراجعة يقرأ جدولًا مباشرة');
  assert.match(service, /rpc\('certificate_review_campaigns'/);
});

test('الشهادات: الصفحات لا تستدعي supabase مباشرة ولا تعرض أزرار كتابة لغير manage', () => {
  for (const f of PAGES) {
    const src = read(f.endsWith('Ui') ? `src/pages/admin/${f}.js` : `src/pages/admin/${f}.jsx`);
    assert.ok(!/services\/supabase\/client|supabase\./.test(src), `${f} يستدعي supabase مباشرة`);
  }
  const detail = read('src/pages/admin/CertificateCampaignDetail.jsx');
  assert.match(detail, /canManage && !archived && \(/);
  assert.match(detail, /canManage && isDraft/);
});

test('الشهادات: مفاتيح الترجمة موجودة في اللغات الثلاث بنفس الشكل والمتغيّرات', () => {
  const L = Object.fromEntries(['ar', 'fr', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`)).admin]));
  const flat = (o, p = '', out = {}) => {
    for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' ? flat(v, `${p}${k}.`, out) : (out[`${p}${k}`] = v));
    return out;
  };
  const maps = Object.fromEntries(Object.entries(L).map(([l, a]) => [l, flat(a.certificates)]));
  assert.deepEqual(sorted(Object.keys(maps.fr)), sorted(Object.keys(maps.ar)));
  assert.deepEqual(sorted(Object.keys(maps.fr)), sorted(Object.keys(maps.en)));
  const vars = (s) => sorted([...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  for (const k of Object.keys(maps.fr)) {
    assert.equal(typeof maps.fr[k], 'string');
    assert.deepEqual(vars(maps.ar[k]), vars(maps.fr[k]), `متغيّرات ${k} (ar)`);
    assert.deepEqual(vars(maps.en[k]), vars(maps.fr[k]), `متغيّرات ${k} (en)`);
  }
  for (const l of ['ar', 'fr', 'en']) assert.ok(L[l].nav.certificates && L[l].nav.sectionCertificates, `nav ${l}`);

  // كل مفتاح admin.certificates.* مستعمل حرفيًا في الكود موجود
  const used = new Set();
  for (const f of PAGES) {
    const src = read(f.endsWith('Ui') ? `src/pages/admin/${f}.js` : `src/pages/admin/${f}.jsx`);
    for (const m of src.matchAll(/['"`]admin\.certificates\.([A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(k in maps.fr || Object.keys(maps.fr).some((x) => x.startsWith(`${k}.`)), `مفتاح ناقص: admin.certificates.${k}`);
  // الأنواع/الحالات الديناميكية
  for (const k of ['types.participation', 'sources.attendance_based', 'status.archived', 'recStatus.issued', 'certStatus.revoked', 'kinds.external', 'nameModes.full', 'languages.en']) {
    assert.ok(k in maps.fr, k);
  }
});

test('الشهادات: الفرنسية اللغة الافتراضية لإنشاء الحملة', () => {
  assert.match(read('src/pages/admin/CertificateCampaignFormModal.jsx'), /language: campaign\?\.language \|\| 'fr'/);
});
