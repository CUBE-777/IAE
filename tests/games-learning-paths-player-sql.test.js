import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0058_games_learning_paths_player.sql'));
const down = stripSql(read('supabase/rollback/0058_games_learning_paths_player_down.sql'));

const HELPERS = ['game_learning_stage_visible', 'game_stage_progress', 'game_stage_lock_reason'];
const RPCS = ['get_my_learning_tracks', 'get_my_learning_track', 'get_my_learning_stage'];

const fn = (name, src = sql) => {
  const i = src.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};

test('0058: لا جداول ولا تعديل هيكل ولا حذف بيانات، ولا يعيد تعريف التسليم ولا دوال الوصول', () => {
  assert.doesNotMatch(sql, /create table|alter table|drop table|truncate|delete from|drop policy|create policy/i);
  assert.doesNotMatch(sql, /function public\.(submit_game_attempt|can_access_games|get_games_access|can_manage_games|game_attempts_bind)\(/);
});

test('0058: start_game_attempt تستأنف المحاولة المفتوحة قبل أي فحص نشر أو نافذة زمنية أو فتح', () => {
  const body = fn('start_game_attempt');
  const resume = body.indexOf("status = 'in_progress'", body.indexOf('select * into v_open'));
  const published = body.indexOf("ch.status = 'published'");
  assert.ok(resume > -1 && published > -1 && resume < published, 'الاستئناف يجب أن يسبق فحص النشر');
  // ملكية المحاولة
  assert.match(body.slice(body.indexOf('select * into v_open'), published), /user_id = v_uid and challenge_id = p_challenge_id/);
  // لا فحص نشر/نافذة/فتح قبل الاستئناف
  const beforeResume = body.slice(0, published);
  assert.doesNotMatch(beforeResume.slice(0, beforeResume.indexOf('select * into v_open')), /starts_at|ends_at|game_stage_is_unlocked|game_stage_chain_published|\.status = 'published'/);
  // لا تغيير للإصدار المثبَّت ولا محاولة جديدة في فرع الاستئناف
  const resumeBranch = body.slice(body.indexOf('select * into v_open'), published);
  assert.doesNotMatch(resumeBranch, /insert into|challenge_version_id/);
  assert.match(resumeBranch, /'resumed', true/);
});

test('0058: المحاولة الجديدة تحتفظ بكل الفحوص (نشر، نافذة زمنية، سلسلة المرحلة وفتحها، إصدار صالح، حدود)', () => {
  const body = fn('start_game_attempt');
  const after = body.slice(body.indexOf("ch.status = 'published'"));
  for (const needle of ["g.status = 'published'", 'gc.is_active', 'challenge_not_available', 'challenge_not_open', 'starts_at', 'ends_at',
    'game_stage_chain_published', 'stage_not_available', 'game_stage_is_unlocked', 'stage_locked',
    "v.status = 'published'", "verify_mode = 'exact'", 'max_attempts_reached', 'rate_limited', 'insert into public.game_attempts']) {
    assert.ok(after.includes(needle), `فحص مفقود للمحاولة الجديدة: ${needle}`);
  }
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = public, pg_temp/);
  assert.match(body, /can_access_games\(\)/);
  assert.match(sql, /revoke all on function public\.start_game_attempt\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.start_game_attempt\(uuid\) to authenticated/);
});

test('0058: المساعدات الداخلية SECURITY DEFINER بمسار بحث ثابت وبلا EXECUTE لأي دور عميل', () => {
  for (const f of HELPERS) {
    const body = fn(f);
    assert.match(body, /security definer/, f);
    assert.match(body, /set search_path = public, pg_temp/, f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\(`), f);
  }
});

test('0058: RPC اللاعب تتحقق من can_access_games وتعيد المنشور فقط وتُمنح لـ authenticated فقط', () => {
  for (const f of RPCS) {
    const body = fn(f);
    assert.match(body, /security definer/, f);
    assert.match(body, /stable/, f);
    assert.match(body, /set search_path = public, pg_temp/, f);
    assert.match(body, /auth\.uid\(\)/, f);
    assert.match(body, /can_access_games\(\)/, f);
    assert.match(body, /games_access_denied/, f);
    assert.match(body, /status = 'published'/, f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to authenticated`), f);
  }
  // المرحلة والمسار: سلسلة كاملة (لعبة ← مسار ← فئة ← مرحلة) وتصنيف اللعبة فعّال
  assert.match(fn('game_learning_stage_visible'), /g\.status = 'published' and gc\.is_active/);
  assert.match(fn('get_my_learning_stage'), /game_learning_stage_visible/);
  assert.match(fn('get_my_learning_track'), /path_not_available/);
  assert.match(fn('get_my_learning_stage'), /stage_not_available/);
});

test('0058: الفتح والإكمال من دوال 0056 وحدها، ولا تسريب محتوى أو حلول أو شرح', () => {
  assert.match(fn('game_stage_progress'), /game_stage_is_complete\(/);
  assert.match(fn('game_stage_lock_reason'), /game_stage_is_unlocked\(/);
  assert.match(fn('get_my_learning_stage'), /game_stage_is_unlocked\(/);
  assert.match(fn('get_my_learning_track'), /game_stage_is_unlocked\(/);
  for (const f of [...RPCS, ...HELPERS]) {
    const body = fn(f);
    assert.doesNotMatch(body, /game_challenge_solutions|game_challenge_version_solutions|\bfeedback\b|\bsolution\b|\bc\.content\b|\.content\b/, `${f}: تسريب محتمل`);
  }
  // التحدي القادم بلا عنوان ولا وصف
  assert.match(fn('get_my_learning_stage'), /case when x\.upcoming then null else x\.title end/);
});

test('0058: ملف الرجوع يعيد 0057 ويُسقط ما أضافته 0058 دون مسّ الجداول', () => {
  assert.match(down, /function public\.start_game_attempt\(/);
  assert.match(down, /game_stage_chain_published/);
  assert.match(down, /stage_locked/);
  for (const f of [...HELPERS, ...RPCS]) assert.match(down, new RegExp(`drop function if exists public\\.${f}\\(`), f);
  assert.doesNotMatch(down, /drop table|truncate|delete from/i);
  // التعريف المُعاد هو تعريف 0057: لا يستعمل مساعدات 0058 (كي لا يعتمد الرجوع على ما يُسقَط فيه)
  assert.doesNotMatch(down.slice(0, down.indexOf('drop function')), /game_learning_stage_visible|game_stage_progress|game_stage_lock_reason/);
});
