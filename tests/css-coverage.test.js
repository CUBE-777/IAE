import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * يلتقط خطأ «الأنماط غير المحمَّلة»: صفحة تستخدم className معرَّفًا فقط في ملف CSS لا تستورده الصفحة
 * ولا مخططها (Layout) ولا مكوّناتها، فيظهر النص بلا إطار/خلفية (مثل people.css على الصفحة الرئيسية).
 * الملفات العامة المستوردة في main.jsx تُعدّ محمَّلة دائمًا.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GLOBAL = new Set(['global.css', 'enhancements.css', 'admin-enhancements.css', 'theme.css', 'nav-responsive.css', 'tokens.css']);

const read = (f) => fs.readFileSync(f, 'utf8');
const resolveImport = (base, imp) => {
  const p = path.normalize(path.join(path.dirname(base), imp));
  return [p, `${p}.js`, `${p}.jsx`, path.join(p, 'index.js'), path.join(p, 'index.jsx')].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};

const stylesDir = path.join(ROOT, 'src/styles');
const definedIn = new Map(); // class -> Set(css file)
for (const f of fs.readdirSync(stylesDir).filter((x) => x.endsWith('.css'))) {
  const css = read(path.join(stylesDir, f)).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (!definedIn.has(m[1])) definedIn.set(m[1], new Set());
    definedIn.get(m[1]).add(f);
  }
}

function analyse(entry, layouts) {
  const seen = new Set();
  const loaded = new Set(GLOBAL);
  const classes = new Map();
  const stack = [path.join(ROOT, entry), ...layouts.map((l) => path.join(ROOT, l))];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const s = read(f);
    for (const m of s.matchAll(/import\s+'(\.[^']*\.css)'/g)) loaded.add(path.basename(m[1]));
    for (const m of s.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !/admin/i.test(r)) stack.push(r);
    }
    for (const m of s.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\}|\{['"]([^'"]+)['"]\})/g)) {
      for (const tok of (m[1] || m[2] || m[3]).split(/[\s${}]+/)) {
        if (/^[a-zA-Z][\w-]*$/.test(tok) && !classes.has(tok)) classes.set(tok, path.basename(f));
      }
    }
  }
  const missing = [];
  for (const [cls, from] of classes) {
    const files = definedIn.get(cls);
    if (files && ![...files].some((x) => loaded.has(x))) missing.push(`${cls} (${[...files].join(', ')}) ← ${from}`);
  }
  return missing;
}

const PAGES = [
  ['Home', 'src/pages/public/Home.jsx', ['src/layouts/PublicLayout.jsx']],
  ['Projects', 'src/pages/public/Projects.jsx', ['src/layouts/PublicLayout.jsx']],
  ['ProjectDetail', 'src/pages/public/ProjectDetail.jsx', []],
  ['Members', 'src/pages/public/Members.jsx', []],
  ['Board', 'src/pages/public/Board.jsx', []],
  ['Announcements', 'src/pages/public/Announcements.jsx', []],
  ['AnnouncementDetail', 'src/pages/public/AnnouncementDetail.jsx', []],
  ['Activity', 'src/pages/public/Activity.jsx', []],
  ['NotFound', 'src/pages/public/NotFound.jsx', []],
  ['ThankYou', 'src/pages/public/ThankYou.jsx', []],
  ['Privacy', 'src/pages/public/Privacy.jsx', []],
  ['MembershipFormPage', 'src/pages/public/MembershipFormPage.jsx', []],
  ['BoardProfileFormPage', 'src/pages/public/BoardProfileFormPage.jsx', []],
];

for (const [name, entry, layouts] of PAGES) {
  test(`الأنماط: كل أصناف صفحة ${name} معرَّفة في ملفات CSS محمَّلة معها`, () => {
    assert.deepEqual(analyse(entry, layouts), []);
  });
}

test('الأنماط: people.css لا يُستورد من الصفحة الرئيسية (ترتيبه بعد enhancements.css مقصود لبطاقات الأعضاء)', () => {
  assert.doesNotMatch(read(path.join(ROOT, 'src/pages/public/Home.jsx')), /people\.css/);
  // بطاقتا المكتب/الأعضاء في الرئيسية تعيشان في public-home.css، لا في people.css
  assert.match(read(path.join(ROOT, 'src/styles/public-home.css')), /\.people-links\s*\{/);
  assert.doesNotMatch(read(path.join(ROOT, 'src/styles/people.css')), /\.people-link/);
});

test('الأزرار الشبحية: لها لون مقروء على الأسطح الفاتحة (معرض، 404/أخطاء، منتقي الصورة)', () => {
  const theme = read(path.join(ROOT, 'src/styles/theme.css'));
  for (const sel of ['.gallery .btn-ghost', '.not-found-section .btn-ghost', '.btn-ghost.mf-picker-btn']) {
    assert.ok(theme.includes(sel), `${sel} بلا قاعدة لون في theme.css`);
  }
});
