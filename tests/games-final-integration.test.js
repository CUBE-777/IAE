import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickLocalized } from '../src/features/games/services/gamesLang.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0060_games_final_integration.sql'));
const down = stripSql(read('supabase/rollback/0060_games_final_integration_down.sql'));
const fn = (src, name) => {
  const i = src.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};

// ---- 6.6: لغة العنوان والوصف = لغة المحتوى ----
test('pickLocalized: لغة اللاعب ← الافتراضية للإصدار ← الاحتياط (ar, en, fr)', () => {
  const v = { fr: 'Titre', en: 'Title' };
  assert.equal(pickLocalized(v, 'fr', 'en'), 'Titre');          // الترجمة المختارة متوفرة
  assert.equal(pickLocalized(v, 'ar', 'fr'), 'Titre');          // غير متوفرة ← الافتراضية fr (لا en كما كان الاحتياط الثابت)
  assert.equal(pickLocalized(v, 'ar', 'ar'), 'Title');          // الافتراضية غير متوفرة أيضًا ← الاحتياط
  assert.equal(pickLocalized(v, 'ar'), 'Title');                // بلا لغة افتراضية: السلوك القديم (ar ← en ← fr)
  assert.equal(pickLocalized({ ar: '  ', en: 'x' }, 'ar', 'ar'), 'x');   // نص فارغ لا يُحتسب ترجمة
  assert.equal(pickLocalized({ fr: 'a' }, 'en-US', 'fr'), 'a');          // i18n.language قد يكون en-US
});

test('pickLocalized: مدخلات غير صالحة ترجع سلسلة فارغة ولا ترمي', () => {
  for (const bad of [null, undefined, 'x', 5, [], ['ar']]) assert.equal(pickLocalized(bad, 'ar', 'fr'), '');
  assert.equal(pickLocalized({ ar: 5, en: null }, 'ar', 'en'), '');
});

test('6.6: ChallengePlay يمرّر defaultLang للعنوان والوصف وdocument.title والسؤال؛ وbuilderContent يستعمل المنطق نفسه', () => {
  const play = read('src/features/games/pages/ChallengePlay.jsx');
  assert.match(play, /pickLocalized\(challenge\.title, lang, defaultLang\)/g);
  assert.equal((play.match(/pickLocalized\(challenge\.title, lang, defaultLang\)/g) || []).length, 2, 'document.title + العنوان المعروض');
  assert.match(play, /pickLocalized\(challenge\.description, lang, defaultLang\)/);
  assert.match(play, /getPrompt\(challenge\.content, lang, defaultLang\)/);
  assert.match(play, /\(play\?\.version \|\| data\.data\?\.version\)\?\.default_language/);
  assert.doesNotMatch(play, /pickLocalized\(challenge\.(title|description), lang\)/, 'لا استدعاء بلا اللغة الافتراضية');
  const bc = read('src/features/games/player/interactive/builderContent.js');
  assert.match(bc, /export const pickText = pickLocalized;/);
  assert.match(read('src/features/games/services/gamesCore.shared.js'), /export \{ pickLocalized \} from '\.\/gamesLang';/);
});

test('6.6: قراءة لغة الإصدار الجاري قراءة أعمدة اللغة فقط (لا محتوى ولا حلّ ولا ملاحظات)', () => {
  const svc = read('src/features/games/services/gamesCatalog.service.js');
  const i = svc.indexOf('export async function getChallengeLanguage');
  assert.ok(i > -1);
  const body = svc.slice(i);
  assert.match(body, /select\('default_language, allow_language_fallback'\)/);
  assert.match(body, /\.eq\('status', 'published'\)/);
  assert.doesNotMatch(body, /solution|content|change_note/);
});

// ---- 6.6: Migration 0060 ----
test('0060: تعريفات حراسات فقط — لا جداول ولا أعمدة ولا سياسات ولا منح ولا بيانات', () => {
  assert.doesNotMatch(sql, /create table|alter table|drop table|truncate|delete from|insert into|update public\.|drop policy|create policy|grant /i);
  assert.doesNotMatch(sql, /function public\.(submit_game_attempt|start_game_attempt|can_access_games|can_manage_games|admin_publish_game_challenge_version)\(/);
});

test('0060: حارس حقول التحدي — النشر مستثنى، ومؤشّر الإصدار مقفل، والتحدي ذو المحاولات بلا إصدار مقفل', () => {
  const g = fn(sql, 'game_challenges_version_guard');
  assert.match(g, /current_setting\('iae\.games_publish', true\), ''\) = '1' then\s+return new;/);
  assert.match(g, /raise exception 'version_pointer_locked'/);
  assert.match(g, /if old\.current_version_id is not null then\s+raise exception 'challenge_versioned';/);
  assert.match(g, /exists \(select 1 from public\.game_attempts a where a\.challenge_id = old\.id\)\s+then\s+raise exception 'challenge_has_attempts'/);
  for (const col of ['title', 'description', 'difficulty', 'points_reward', 'time_limit_seconds', 'max_attempts', 'content']) {
    assert.match(g, new RegExp(`new\\.${col}`)); assert.match(g, new RegExp(`old\\.${col}`));
  }
  assert.doesNotMatch(g, /new\.(status|slug|starts_at|ends_at|sort_order|stage_id)/, 'الجدولة والحالة والمرحلة تبقى حرّة');
});

test('0060: حارس الحلّ الحيّ — الحذف لا يُستثنى أبدًا، والنشر وحده يتجاوز الإدراج/التعديل', () => {
  const g = fn(sql, 'game_challenge_solutions_version_guard');
  assert.match(g, /tg_op <> 'DELETE' and coalesce\(current_setting\('iae\.games_publish', true\), ''\) = '1' then\s+return new;/);
  assert.match(g, /current_version_id is not null\) then\s+raise exception 'challenge_versioned'/);
  assert.match(g, /game_attempts a where a\.challenge_id = v_chal\) then\s+raise exception 'challenge_has_attempts'/);
});

test('0060: مشغّل content_has_answer على الإدراج وعند تغيّر content فقط، ويستثني إسقاط النشر', () => {
  const g = fn(sql, 'game_challenges_content_guard');
  assert.match(g, /iae\.games_publish/);
  assert.match(g, /tg_op = 'INSERT' or new\.content is distinct from old\.content/);
  assert.match(g, /game_builder_has_forbidden_key\(new\.content\)/);
  assert.match(g, /raise exception 'content_has_answer'/);
  assert.match(sql, /create trigger trg_game_challenges_content_guard before insert or update of content on public\.game_challenges/);
});

test('0060: دوال الحراسة بلا EXECUTE لأي دور عميل، وتتحقق من المتطلبات السابقة', () => {
  for (const f of ['game_challenges_version_guard', 'game_challenge_solutions_version_guard', 'game_challenges_content_guard']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\(\\)\\s+from public, anon, authenticated;`));
  }
  assert.match(sql, /0055_games_learning_paths\.sql/);
  assert.match(sql, /0057_games_challenge_builder\.sql/);
});

test('0060 rollback: يعيد حارسَي 0055 حرفيًا ويُسقط مشغّل المحتوى', () => {
  const orig = stripSql(read('supabase/migrations/0055_games_learning_paths.sql'));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (const f of ['game_challenges_version_guard', 'game_challenge_solutions_version_guard']) {
    const take = (src) => norm(fn(src, f)).replace(/ revoke all.*$/, '').replace(/ drop trigger.*$/, '');
    assert.equal(take(down).split(' $$; ')[0], take(orig).split(' $$; ')[0], `${f}: الرجوع يطابق 0055`);
  }
  assert.match(down, /drop trigger if exists trg_game_challenges_content_guard on public\.game_challenges;/);
  assert.match(down, /drop function if exists public\.game_challenges_content_guard\(\);/);
  assert.doesNotMatch(down, /game_attempts a where/);
});

test('0060: رمز challenge_has_attempts معرّف في الواجهة وترجماته الثلاث', () => {
  assert.match(read('src/features/games/admin/constants/gamesAdmin.js'), /'challenge_has_attempts'/);
  for (const l of ['ar', 'fr', 'en']) {
    const j = JSON.parse(read(`src/i18n/locales/${l}.json`));
    const found = JSON.stringify(j).includes('"challenge_has_attempts":"');
    assert.ok(found, `الترجمة ${l} ناقصة`);
  }
});

test('6.6: المحرر القديم يقفل حقول التحدي ذي الإصدارات ولا يرسلها', () => {
  const tab = read('src/features/games/admin/pages/ChallengesTab.jsx');
  assert.match(tab, /const locked = !!item\?\.current_version_id;/);
  assert.match(tab, /if \(locked\) \{\s+for \(const k of \['title', 'description', 'difficulty', 'points_reward', 'time_limit_seconds', 'max_attempts', 'content', 'verify_mode', 'solution'\]\) delete data\[k\];/);
  assert.match(read('src/features/games/admin/services/gamesAdmin.service.js'), /sort_order, current_version_id, created_at/);
});
