import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const ar = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/ar.json'), 'utf8'));
const flat = (o, p = '', out = new Set()) => {
  for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' ? flat(v, `${p}${k}.`, out) : out.add(`${p}${k}`));
  return out;
};
const keys = flat(ar);
const tops = Object.keys(ar).filter((k) => typeof ar[k] === 'object');

test('كل مفتاح ترجمة مستعمل حرفيًا في الكود موجود في ar.json', () => {
  const missing = [];
  const re = new RegExp(`['"\`]((?:${tops.join('|')})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');
  for (const f of walk(root).filter((x) => /\.jsx?$/.test(x) && !x.includes('/i18n/'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(re)) {
      const k = m[1];
      if (/\.(csv|json|pdf|png|jpe?g|js|css)$/i.test(k)) continue; // أسماء ملفات لا مفاتيح
      if (keys.has(k) || [...keys].some((x) => x.startsWith(`${k}.`))) continue;
      missing.push(`${path.relative(root, f)}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});
