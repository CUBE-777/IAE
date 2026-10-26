import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(`${ROOT}/${f}`, 'utf8');

/**
 * خلل حقيقي: لوحة الإدارة تُحمَّل lazy، فإن لم يكن admin.css في الحزمة الأولى قبل ملفات التحسينات يُحقن بعدها
 * ويتغلّب عليها عند تساوي الخصوصية: z-index الدرج الجوّال يصير 40 بدل 70، فتعلوه طبقة الخلفية (60) وتبتلع النقرات.
 */
test('الترتيب: admin.css يُستورد في main.jsx قبل enhancements و admin-enhancements و theme', () => {
  const main = read('src/main.jsx');
  const pos = (name) => main.indexOf(`'./styles/${name}'`);
  const admin = pos('admin.css');
  assert.ok(admin > 0, 'admin.css غير مستورد في main.jsx');
  for (const later of ['enhancements.css', 'admin-enhancements.css', 'theme.css', 'nav-responsive.css']) {
    assert.ok(pos(later) > admin, `${later} يجب أن يأتي بعد admin.css`);
  }
});

test('الدرج الجوّال: الدرج فوق طبقة الخلفية (z-index)', () => {
  const css = read('src/styles/admin-enhancements.css');
  const sidebar = Number(/@media \(max-width: 980px\) \{\s*\.admin-sidebar \{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
  const backdrop = Number(/\.admin-sidebar-backdrop \{[^}]*z-index:\s*(\d+)/.exec(css.slice(css.indexOf('@media (max-width: 980px)')))?.[1]);
  assert.ok(sidebar > backdrop, `الدرج (${sidebar}) يجب أن يعلو الخلفية (${backdrop})`);
});

test('كل محددات admin.css تخص الإدارة فقط (آمن استيرادها في الحزمة الأولى)', () => {
  const css = read('src/styles/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  css.replace(/([^{}]+)\{/g, (_, sel) => {
    const s = sel.trim();
    if (s && !s.startsWith('@') && !/^[\d.%\s,]+$/.test(s) && !/^(from|to)$/.test(s)) selectors.push(s);
    return '';
  });
  const offenders = selectors.flatMap((s) => s.split(',').map((x) => x.trim())).filter((x) => !/admin/.test(x));
  assert.deepEqual(offenders, []);
});
