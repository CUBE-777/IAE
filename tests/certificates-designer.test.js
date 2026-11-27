import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../src/pages/admin/certificateDesign.js';
import * as R from '../src/constants/roles.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sql63 = read('supabase/migrations/0063_certificates_schema.sql');
const sql64 = read('supabase/migrations/0064_certificates_admin_functions.sql');
const service = read('src/services/supabase/adminCertificates.service.js');
const FILES = ['CertificateDesigner', 'CertificateDesignerCanvas', 'CertificateDesignerPanels'].map((f) => `src/pages/admin/${f}.jsx`)
  .concat(['src/pages/admin/certificateDesign.js', 'src/pages/admin/certificateImage.js']);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('المصمّم: القوالب الأربعة تبني تصميمًا صالحًا A4 أفقي ضمن حد الحجم', () => {
  assert.deepEqual(D.STYLES, ['academic', 'modern', 'premium', 'technology']);
  for (const s of D.STYLES) {
    const d = D.presetDesign(s, { colors: { navy: '#142B4A' }, fonts: { latin: 'Inter' } });
    assert.equal(d.page.width_mm, 297);
    assert.equal(d.page.height_mm, 210);
    assert.equal(d.page.orientation, 'landscape');
    assert.ok(d.elements.length >= 8, s);
    assert.ok(D.designBytes(d) < D.MAX_DESIGN_BYTES, `${s}: ${D.designBytes(d)}`);
    assert.deepEqual(d.colors, { navy: '#142B4A' }, 'colors الموجودة تُحفظ');
    assert.deepEqual(d.fonts, { latin: 'Inter' }, 'fonts الموجودة تُحفظ');
    assert.ok(d.elements.some((e) => e.type === 'text' && /\{\{recipient_name\}\}/.test(e.text.fr)), `${s}: اسم المستفيد`);
    assert.deepEqual(D.sanitizeDesign(d), d, `${s}: التنظيف idempotent`);
    for (const e of d.elements) {
      assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.w <= 297.1 && e.y + e.h <= 210.1, `${s}: عنصر خارج A4`);
    }
  }
  // القوالب النظامية في 0063 بلا elements → تُعرض كقاعدة نمط ولا تُعتبر مخزَّنة
  assert.ok(!/'elements'/.test(sql63.slice(sql63.indexOf('7) القوالب الأربعة'))), '0063 لا يزرع elements');
  assert.equal(D.hasLayout({ page: {}, colors: {}, fonts: {} }), false);
  assert.equal(D.hasLayout(D.presetDesign('modern')), true);
});

test('المصمّم: التنظيف يرفض الصور غير الآمنة ويقيّد القيم', () => {
  for (const bad of ['javascript:alert(1)', 'http://x.com/a.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,AAAA', 'https://x.com/a"onerror="x', '', null, 5]) {
    assert.equal(D.isSafeImageSrc(bad), false, String(bad));
  }
  assert.equal(D.isSafeImageSrc(PNG), true);
  assert.equal(D.isSafeImageSrc('https://cdn.example.com/logo.png'), true);
  assert.equal(D.isSafeImageSrc(`data:image/png;base64,${'A'.repeat(D.MAX_IMAGE_CHARS + 500)}`), false, 'حد الحجم');

  const out = D.sanitizeDesign({
    page: { width_mm: 1, orientation: 'portrait' },
    background: { color: 'red' },
    elements: [
      { id: 'a', type: 'image', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 },
      { id: 'b', type: 'text', x: 9999, y: -9999, w: -5, h: 1e9, size: 1000, color: 'url(x)', font: 'comic', align: 'left', text: { fr: 'x'.repeat(999), ar: 5 } },
      { id: 'b', type: 'shape', shape: 'star', fill: '#12', x: 1, y: 1, w: 10, h: 10 },
      { type: 'script', x: 1 },
      { id: 'c', type: 'image', src: PNG, role: 'hack', fit: 'fill', opacity: 9 },
    ],
  });
  assert.equal(out.page.orientation, 'landscape');
  assert.equal(out.page.width_mm, 297);
  assert.equal(out.background.color, '#FFFFFF');
  assert.equal(out.elements.length, 3, 'الصورة غير الآمنة والنوع المجهول سقطا');
  const [t, s, i] = out.elements;
  assert.ok(t.x <= 400 && t.y >= -100 && t.w >= D.MIN_SIZE_MM && t.h <= 300 && t.size <= 120);
  assert.equal(t.color, '#202A36');
  assert.equal(t.font, 'sans');
  assert.equal(t.align, 'center');
  assert.equal(t.text.fr.length, 400);
  assert.equal(t.text.ar, '');
  assert.equal(s.shape, 'rect');
  assert.equal(s.fill, 'transparent');
  assert.notEqual(s.id, t.id, 'معرّفات فريدة');
  assert.equal(i.role, 'image');
  assert.equal(i.fit, 'contain');
  assert.equal(i.opacity, 1);

  const many = D.sanitizeDesign({ elements: Array.from({ length: 100 }, () => D.newText()) });
  assert.equal(many.elements.length, D.MAX_ELEMENTS);
});

test('المصمّم: التحقق قبل الحفظ (الاسم والحجم والعدد)', () => {
  const ok = D.presetDesign('academic');
  assert.deepEqual(D.validateForSave(ok, 'Mon modèle'), []);
  assert.deepEqual(D.validateForSave(ok, ' a '), ['nameInvalid']);
  assert.deepEqual(D.validateForSave(ok, 'x'.repeat(81)), ['nameInvalid']);
  const big = { ...ok, elements: [...ok.elements, D.newImage(`data:image/png;base64,${'A'.repeat(8900)}`), D.newImage(`data:image/png;base64,${'A'.repeat(8900)}`)] };
  assert.ok(D.validateForSave(big, 'ok').includes('tooLarge'));
});

test('المصمّم: RTL/LTR والمعاينة ببيانات تجريبية لا تُخزَّن', () => {
  assert.equal(D.dirOf('ar'), 'rtl');
  assert.equal(D.dirOf('fr'), 'ltr');
  assert.equal(D.dirOf('en'), 'ltr');
  for (const l of D.LANGS) {
    assert.deepEqual(Object.keys(D.SAMPLE[l]).sort(), [...D.VARIABLES].sort());
    const all = D.VARIABLES.map((v) => `{{${v}}}`).join(' ');
    assert.ok(!/\{\{/.test(D.interpolate(all, D.SAMPLE[l])), `متغيّرات متبقية (${l})`);
  }
  assert.match(D.SAMPLE.ar.recipient_name, /[\u0600-\u06FF]/);
  assert.equal(D.interpolate('{{inconnu}}', D.SAMPLE.fr), '{{inconnu}}');
  assert.equal(D.interpolate('{{recipient_name}}', {}), '{{recipient_name}}', 'التحرير يعرض المتغيّر خامًا');
  // الاحتياط للفرنسية عند فراغ اللغة
  const el = D.newText({ text: { fr: 'Bonjour', ar: '', en: '' } });
  assert.equal(D.textOf(el, 'ar'), 'Bonjour');
  // لا بيانات تجريبية داخل أي نمط محفوظ
  for (const s of D.STYLES) {
    const json = JSON.stringify(D.presetDesign(s));
    for (const l of D.LANGS) for (const v of Object.values(D.SAMPLE[l])) assert.ok(!json.includes(v), `${s} يحتوي بيانات تجريبية: ${v}`);
  }
  // أسماء المتغيّرات تطابق مفاتيح get_certificate_render_data
  const fn = sql64.slice(sql64.indexOf('function public.get_certificate_render_data'));
  for (const v of D.VARIABLES) assert.ok(fn.includes(`'${v}'`), `${v} غير موجود في render_data`);
});

test('المصمّم: Undo/Redo والتجميع والسحب', () => {
  const a = { n: 1 }; const b = { n: 2 }; const c = { n: 3 };
  let h = D.createHistory(a);
  h = D.historyReducer(h, { type: 'record', next: b, at: 1000 });
  h = D.historyReducer(h, { type: 'record', next: c, at: 2000 });
  assert.equal(h.present, c);
  h = D.historyReducer(h, { type: 'undo' });
  assert.equal(h.present, b);
  h = D.historyReducer(h, { type: 'undo' });
  assert.equal(h.present, a);
  assert.equal(D.historyReducer(h, { type: 'undo' }), h, 'لا تراجع بعد البداية');
  h = D.historyReducer(h, { type: 'redo' });
  assert.equal(h.present, b);
  // تسجيل جديد يمسح future
  h = D.historyReducer(h, { type: 'record', next: c, at: 3000 });
  assert.equal(h.future.length, 0);
  // دمج الكتابة المتتالية بنفس المفتاح في خطوة واحدة
  let k = D.createHistory(a);
  for (let i = 0; i < 5; i += 1) k = D.historyReducer(k, { type: 'record', next: { n: 10 + i }, key: 'text:x', at: 5000 + i * 100 });
  assert.equal(k.past.length, 1);
  k = D.historyReducer(k, { type: 'undo' });
  assert.equal(k.present, a);
  // سحب: begin مرة ثم live كثيرة = خطوة واحدة
  let m = D.createHistory(a);
  m = D.historyReducer(m, { type: 'begin' });
  for (let i = 0; i < 10; i += 1) m = D.historyReducer(m, { type: 'live', next: { n: 100 + i } });
  assert.equal(m.past.length, 1);
  assert.equal(D.historyReducer(m, { type: 'undo' }).present, a);
  // الحد الأعلى للتاريخ
  let z = D.createHistory(0);
  for (let i = 1; i <= 150; i += 1) z = D.historyReducer(z, { type: 'record', next: i, at: i });
  assert.equal(z.past.length, 100);
  assert.equal(D.historyReducer(z, { type: 'reset', next: 7 }).past.length, 0);
});

test('المصمّم: النسخ وترتيب الطبقات', () => {
  const t = D.newText({ x: 10, y: 10, locked: true, hidden: true });
  const copy = D.duplicateElement(t);
  assert.notEqual(copy.id, t.id);
  assert.equal(copy.x, 15);
  assert.equal(copy.locked, false);
  assert.equal(copy.hidden, false);
  copy.text.fr = 'x';
  assert.notEqual(t.text.fr, 'x', 'نسخة عميقة');
  const [a, b, c] = [D.newText(), D.newText(), D.newText()];
  assert.deepEqual(D.moveLayer([a, b, c], a.id, 1).map((e) => e.id), [b.id, a.id, c.id]);
  assert.deepEqual(D.moveLayer([a, b, c], c.id, 1).map((e) => e.id), [a.id, b.id, c.id], 'الأعلى لا يتحرك أكثر');
  assert.deepEqual(D.moveLayer([a, b, c], a.id, -1).map((e) => e.id), [a.id, b.id, c.id]);
});

test('المصمّم: الحفظ عبر certificate_save_template بنفس توقيع 0064 والأدوار', () => {
  const sig = sql64.match(/function public\.certificate_save_template\(([^)]*)\)/)[1];
  const params = [...sig.matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1]);
  assert.deepEqual(params, ['p_id', 'p_name', 'p_style', 'p_design', 'p_is_active']);
  const fn = service.slice(service.indexOf('export async function saveCertificateTemplate'));
  assert.match(fn, /rpc\('certificate_save_template'/);
  for (const p of params) assert.ok(fn.includes(`${p}:`), `المعامل ${p} غير مُمرَّر`);
  // الصلاحية: can_admin_certificates = developer/super_admin = ROLES_SUPER، والمسار محمي بها
  const m = sql63.match(/function public\.can_admin_certificates\(\)[\s\S]*?in \(([^)]*)\)/);
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), [...R.ROLES_SUPER].sort());
  assert.deepEqual([...R.ROLES_SUPER].sort(), ['developer', 'super_admin']);
  assert.match(sql64.slice(sql64.indexOf('function public.certificate_save_template')), /can_admin_certificates\(\)/);
  assert.match(read('src/app/router/index.jsx'), /path: '\/admin\/certificates\/designer', element: protectedAdmin\(ROLES_SUPER, <CertificateDesigner \/>\)/);
  assert.match(read('src/pages/admin/Certificates.jsx'), /canDesign[\s\S]*ROLES_SUPER/);
  // القراءة: أعمدة صريحة بلا select *
  assert.match(service, /TEMPLATE_DESIGN_COLS = 'id, code, name, style, design, is_system, is_active'/);
  assert.ok(!/select\(\s*['"`]\s*\*/.test(service));
});

test('المصمّم: لا ربط بالإصدار ولا تخزين متصفح ولا supabase مباشر ولا PDF/token', () => {
  for (const f of FILES) {
    const src = read(f);
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), `${f}: تخزين متصفح`);
    assert.ok(!/services\/supabase\/client|supabase\./.test(src), `${f}: supabase مباشر`);
    assert.ok(!/issueCertificateCampaign|removeCertificateRecipient|addAttendanceRecipients|jspdf|html2canvas|token_hash|dangerouslySetInnerHTML|eval\(/.test(src), `${f}: خارج النطاق/غير آمن`);
  }
  const page = read('src/pages/admin/CertificateDesigner.jsx');
  assert.match(page, /useState\('fr'\)/, 'اللغة الافتراضية fr');
  assert.match(page, /fetchCertificateTemplatesWithDesign[\s\S]*saveCertificateTemplate/);
});

test('المصمّم: مفاتيح الترجمة designer متطابقة في fr/ar/en وكل المستعمل موجود', () => {
  const L = Object.fromEntries(['fr', 'ar', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`)).admin.certificates]));
  const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' ? flat(v, `${p}${k}.`, out) : (out[`${p}${k}`] = v)); return out; };
  const maps = Object.fromEntries(Object.entries(L).map(([l, c]) => [l, flat(c.designer)]));
  const keys = Object.keys(maps.fr).sort();
  assert.ok(keys.length > 100);
  assert.deepEqual(Object.keys(maps.ar).sort(), keys);
  assert.deepEqual(Object.keys(maps.en).sort(), keys);
  for (const k of keys) for (const l of ['fr', 'ar', 'en']) assert.ok(String(maps[l][k]).trim(), `${l}:${k} فارغ`);

  const used = new Set();
  for (const f of FILES) {
    const src = read(f);
    for (const m of src.matchAll(/admin\.certificates\.designer\.([A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
    for (const m of src.matchAll(/\$\{D\}\.([A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
  }
  assert.ok(used.size > 40);
  for (const k of used) assert.ok(k in maps.fr, `مفتاح ناقص: designer.${k}`);
  // عائلات ديناميكية
  for (const s of D.STYLES) assert.ok(`styles.${s}` in maps.fr);
  for (const v of D.VARIABLES) assert.ok(`vars.${v}` in maps.fr);
  for (const f of Object.keys(D.FONTS)) assert.ok(`fonts.${f}` in maps.fr);
  for (const k of ['rect', 'ellipse', 'line', 'qr', 'text', 'image', 'logo', 'background']) assert.ok(`layers.types.${k}` in maps.fr);
  for (const k of ['start', 'center', 'end']) assert.ok(`props.align_${k}` in maps.fr);
  for (const k of ['nameInvalid', 'tooLarge', 'tooManyElements', 'image_unsupported', 'image_too_large', 'image_failed']) assert.ok(`messages.${k}` in maps.fr);
  for (const l of ['ar', 'en']) {
    const vars = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const k of keys) assert.deepEqual(vars(maps[l][k]), vars(maps.fr[k]), `متغيّرات ${k} (${l})`);
  }
});
