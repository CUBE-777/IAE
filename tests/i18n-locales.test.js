import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = (l) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${l}.json`, import.meta.url), 'utf8'));
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [`${p}${k}`]));

test('ملفات الترجمة ar/fr/en متطابقة المفاتيح تمامًا', () => {
  const ar = new Set(flat(load('ar')));
  for (const l of ['fr', 'en']) {
    const other = new Set(flat(load(l)));
    assert.deepEqual([...ar].filter((k) => !other.has(k)), [], `مفاتيح ناقصة في ${l}`);
    assert.deepEqual([...other].filter((k) => !ar.has(k)), [], `مفاتيح زائدة في ${l}`);
  }
});

test('مفاتيح شاشة الأخطاء والمرحلة 2 موجودة', () => {
  for (const l of ['ar', 'fr', 'en']) {
    const keys = new Set(flat(load(l)));
    for (const k of ['app.error.title', 'app.error.reload', 'admin.errors.sessionRetry', 'forms.rateLimited']) {
      assert.ok(keys.has(k), `${k} (${l})`);
    }
  }
});
