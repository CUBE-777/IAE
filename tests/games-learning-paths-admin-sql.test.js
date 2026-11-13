import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0056_games_learning_paths_admin.sql'));
const down = stripSql(read('supabase/rollback/0056_games_learning_paths_admin_down.sql'));

const HELPERS = ['game_user_is_player', 'game_stage_chain_published', 'game_stage_is_complete', 'game_stage_is_unlocked'];
const ADMIN_RPCS = ['admin_reorder_game_path_items', 'admin_set_game_challenge_stage', 'admin_grant_game_stage',
  'admin_revoke_game_stage_grant', 'admin_list_game_stage_grants', 'admin_get_game_stage_status'];

const fn = (name, src = sql) => {
  const i = src.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};

test('0056: ملف الرجوع موجود ويعيد التعريفين الأصليين ويُسقط كل ما أضافه', () => {
  assert.match(down, /function public\.game_attempts_bind\(\)/);
  assert.match(down, /stage_lock_not_enforced/);
  assert.match(down, /function public\.submit_game_attempt\(/);
  for (const f of [...HELPERS, ...ADMIN_RPCS]) assert.match(down, new RegExp(`drop function if exists public\\.${f}\\(`), f);
  assert.match(down, /grant delete on public\.game_tracks, public\.game_track_categories, public\.game_stages to authenticated/);
  assert.doesNotMatch(down, /drop table/i);
});

test('0056: لا يحذف جداول ولا يعيد إنشاءها ولا يمسّ 0055', () => {
  assert.doesNotMatch(sql, /drop table|create table|truncate|delete from public\.game_(attempts|results|points)/i);
  assert.doesNotMatch(sql, /alter table public\.game_(tracks|track_categories|stages|stage_grants)\s+(drop|add)/i);
});

test('0056: المساعدات الداخلية SECURITY DEFINER بمسار بحث ثابت وبلا EXECUTE لأي دور عميل', () => {
  for (const f of HELPERS) {
    const body = fn(f);
    assert.match(body, /security definer/, f);
    assert.match(body, /set search_path = public, pg_temp/, f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\(`), f);
  }
});

test('0056: كل RPC إدارية تتحقق من can_manage_games() وتُمنح لـ authenticated فقط', () => {
  for (const f of ADMIN_RPCS) {
    const body = fn(f);
    assert.match(body, /security definer/, f);
    assert.match(body, /set search_path = public, pg_temp/, f);
    assert.match(body, /auth\.uid\(\) is null or not public\.can_manage_games\(\)/, f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to authenticated`), f);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to (anon|public)`), f);
  }
});

test('0056: الفتح مُنفَّذ في مشغّل البدء (لا يُتجاوز بـ RPC) ولم يبقَ stage_lock_not_enforced', () => {
  const bind = fn('game_attempts_bind');
  assert.match(bind, /game_stage_is_unlocked\(v_stage, new\.user_id\)/);
  assert.match(bind, /raise exception 'stage_locked'/);
  assert.match(bind, /raise exception 'stage_not_available'/);
  assert.doesNotMatch(bind, /stage_lock_not_enforced/);
  assert.match(bind, /attempt_version_locked/);           // باقي منطق 0055 محفوظ
  assert.match(bind, /for share/);
});

test('0056: submit_game_attempt تعيد التحقق من الفتح وتحتفظ بمنطق 0055 (حلّ الإصدار والنقاط)', () => {
  const sub = fn('submit_game_attempt');
  assert.match(sub, /c\.stage_id is not null and not public\.game_stage_is_unlocked\(c\.stage_id, v_uid\)/);
  assert.match(sub, /game_challenge_version_solutions/);
  assert.match(sub, /game_verify_answer/);
  assert.match(sub, /on conflict \(user_id, challenge_id\) where reason = 'challenge_solved' do nothing/);
});

test('0056: الإكمال مشتقّ من النتائج والنقاط والمنح على الخادم وfail-closed', () => {
  const body = fn('game_stage_is_complete');
  for (const m of ['manual', 'all_required', 'min_success_rate', 'min_points']) assert.match(body, new RegExp(`'${m}'`), m);
  assert.match(body, /public\.game_results/);
  assert.match(body, /public\.game_points/);
  assert.match(body, /reason = 'challenge_solved'/);
  assert.match(body, /kind = 'complete'/);
  assert.match(body, /v_total > 0/);                                   // لا إكمال لمرحلة فارغة
  assert.match(body, /\* 100\) >= \(s\.completion_threshold::bigint \* v_total\)/);   // مقارنة صحيحة بلا تقريب
  assert.match(body, /return false;\s*end;\s*\$\$;/);                    // الوضع غير المتوقّع: fail closed
  const un = fn('game_stage_is_unlocked');
  for (const m of ['free', 'manual', 'sequential']) assert.match(un, new RegExp(`'${m}'`), m);
  assert.match(un, /kind = 'unlock'/);
  assert.match(un, /game_stage_is_complete\(v_prev, p_user_id\)/);
  assert.match(un, /return false;\s*end;\s*\$\$;/);
});

test('0056: الصلاحيات: سحب الحذف المباشر + فحص EXECUTE ذاتي', () => {
  assert.match(sql, /revoke delete on public\.game_tracks, public\.game_track_categories, public\.game_stages from public, anon, authenticated/);
  assert.match(sql, /has_function_privilege\('anon', f, 'execute'\)/);
  assert.doesNotMatch(sql, /service_role/);
});

test('0056: المنح اليدوي بلا تكرار تدقيق (المشغّل يسجّل) وبلا حذف مباشر', () => {
  const grant = fn('admin_grant_game_stage');
  assert.match(grant, /on conflict \(stage_id, user_id, kind\) do nothing/);
  assert.doesNotMatch(grant, /insert into public\.audit_logs/);
  assert.match(grant, /game_user_is_player\(p_user_id\)/);
  assert.match(fn('admin_revoke_game_stage_grant'), /grant_not_found/);
});

test('الواجهة: تبويب المسارات مسجَّل، والخدمة بلا حذف مباشر ولا service_role، والصفحة لا تستدعي supabase مباشرة', () => {
  assert.match(read('src/features/games/admin/constants/gamesAdmin.js'), /GAMES_ADMIN_TABS = \['games', 'paths',/);
  assert.match(read('src/features/games/admin/pages/GamesAdmin.jsx'), /paths: lazy\(\(\) => import\('\.\/PathsTab'\)\)/);
  const svc = read('src/features/games/admin/services/gamesPaths.service.js');
  assert.doesNotMatch(svc, /\.delete\(/);
  assert.doesNotMatch(svc, /service_role/i);
  for (const f of ['pages/PathsTab.jsx', 'components/PathForms.jsx', 'components/StageChallengesModal.jsx', 'components/StageGrantsModal.jsx']) {
    assert.doesNotMatch(read(`src/features/games/admin/${f}`), /services\/supabase\/client/, f);
  }
});
