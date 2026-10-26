import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diffBoardProfile } from '../src/utils/boardProfileDiff.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0031_board_profile_links.sql'));

test('0031: الجدول خاص — RLS مفعّلة وبلا أي صلاحية لـ anon، والقراءة لمسؤولي المحتوى فقط', () => {
  assert.match(sql, /create table if not exists public\.board_profile_links/);
  assert.match(sql, /alter table public\.board_profile_links enable row level security/);
  assert.match(sql, /revoke all on public\.board_profile_links from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.board_profile_links to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.board_profile_links to[^;]*anon/);
  assert.match(sql, /using \(public\.can_manage_content\(\)\)/);
});

test('0031: الرمز يُخزَّن مجزّأً فقط ولا يوجد عمود للرمز نفسه', () => {
  assert.match(sql, /token_hash\s+text not null unique/);
  assert.match(sql, /encode\(sha256\(convert_to\(/);
  assert.doesNotMatch(sql, /\btoken\s+text\b/);
});

test('0031: كل دالة SECURITY DEFINER تثبّت search_path', () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.ok(fns.length >= 8, 'عدد الدوال أقل من المتوقع');
  for (const f of fns) {
    const head = f.slice(0, 400);
    if (/security definer/.test(head)) assert.match(head, /set search_path = public, pg_temp/, head.split('(')[0]);
  }
});

test('0031: دوال الإدارة تفحص الجلسة والصلاحية، والزائر يملك القراءة والإرسال فقط', () => {
  for (const fn of ['issue_board_profile_link', 'approve_board_profile', 'return_board_profile']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, 700), /auth\.uid\(\) is null or not public\.can_manage_content\(\)/, fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated;`));
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)[^;]*anon`));
  }
  assert.match(sql, /grant execute on function public\.get_board_profile_link\(text\)\s+to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.submit_board_profile\(text, jsonb\)\s+to anon, authenticated/);
  // دوال التنظيف الداخلية لا تُنفَّذ من العميل
  assert.match(sql, /revoke execute on function public\._bp_clean\(jsonb\)\s+from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\._bp_text\(jsonb, integer\) from public, anon, authenticated/);
});

test('0031: التنظيف بقائمة بيضاء — منصات معروفة، روابط http/https فقط، وأطوال مطابقة لقيود board_members', () => {
  assert.match(sql, /array\['instagram','facebook','linkedin','tiktok','youtube','x','github','website'\]/);
  assert.match(sql, /\^https\?:\/\//);
  for (const [field, max] of [['public_bio', 600], ['study_path', 800], ['promotion', 60], ['track', 200]]) {
    assert.match(sql, new RegExp(`'${field}',\\s+public\\._bp_text\\(p_data -> '${field}', ${max}\\)`), field);
  }
});

test('0031: الاعتماد يحافظ على ترجمات المسؤول (الصفة) ولا يغيّر الاسم والصفة والترتيب', () => {
  const body = sql.slice(sql.indexOf('function public.approve_board_profile('), sql.indexOf('function public.return_board_profile('));
  const update = body.slice(body.indexOf('update public.board_members'), body.indexOf('update public.board_profile_links'));
  assert.doesNotMatch(update, /full_name|position\s*=|sort_order|is_active/);
  assert.match(body, /- 'track' - 'bio' - 'public_bio' - 'study_path' - 'extra'/);
  assert.match(body, /v_link\.status <> 'submitted'/);
});

test('0031: رفع الصورة مقيَّد بمسار مرتبط بالرمز، وسياسات التخزين الجديدة لا تمسّ سياسات 0020', () => {
  assert.match(sql, /\^\[0-9a-f\]\{64\}\/board-photo-\[1-6\]\\\.\(webp\|jpg\|png\)\$/);
  assert.match(sql, /create policy "board_photo_anon_insert" on storage\.objects/);
  assert.match(sql, /create policy "board_photo_content_select" on storage\.objects/);
  assert.doesNotMatch(sql, /membership_docs_anon_insert|membership_docs_manager_select/);
  // الإرسال يتأكد أن الصورة تحمل بصمة هذا الرمز ومرفوعة فعلًا
  assert.match(sql, /\^' \|\| v_hash \|\| '\/board-photo-\[1-6\]/);
});

test('الراوتر: صفحة التعبئة تُحمَّل عند الطلب، وهي غير مفهرسة في robots', () => {
  const router = read('src/app/router/index.jsx');
  assert.match(router, /const BoardProfileFormPage = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/public\/BoardProfileFormPage'\)\)/);
  assert.match(router, /path: '\/board-profile\/:token', element: <BoardProfileFormPage \/>/);
  assert.match(read('public/robots.txt'), /Disallow: \/board-profile\//);
  assert.match(read('src/pages/public/BoardProfileFormPage.jsx'), /name = 'robots'/);
});

test('صفحة المكتب في الإدارة: الأزرار الجديدة تختفي إن لم يُشغَّل 0031 ولا تؤثر على الحفظ القديم', () => {
  const board = read('src/pages/admin/Board.jsx');
  assert.match(board, /fetchBoardProfileLinks\(\)[\s\S]*\.catch\(\(\) => setLinks\(null\)\)/);
  assert.match(board, /links && \(/);
});

test('diffBoardProfile: يُرجع الحقول المتغيرة فقط', () => {
  const current = {
    university: 'FSA', promotion: '2026', track: '', bio: 'قديم', public_bio: null, study_path: null,
    socials: { instagram: 'https://instagram.com/a' }, extra: {}, translations: { name_latin: 'Ali', fr: { bio: 'Ancien' } },
  };
  const proposed = {
    university: 'FSA', promotion: '2026', track: 'Informatique', bio: 'جديد',
    socials: { instagram: 'https://instagram.com/a', github: 'https://github.com/a' },
    extra: { items: [{ label: 'اللغات', value: 'العربية' }] },
    translations: { name_latin: 'Ali', fr: { bio: 'Nouveau' }, en: { track: 'Computer science' } },
  };
  const keys = diffBoardProfile(current, proposed).map((r) => r.key).sort();
  assert.deepEqual(keys, ['bio', 'en.track', 'extra', 'fr.bio', 'socials', 'track']);
  assert.deepEqual(diffBoardProfile(current, current), []);
  assert.deepEqual(diffBoardProfile(null, null), []);
});
