import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0050_games_core.sql'));
const down = stripSql(read('supabase/rollback/0050_games_core_down.sql'));

const TABLES = ['game_categories', 'games', 'game_challenges', 'game_challenge_solutions', 'game_levels',
  'game_achievements', 'game_attempts', 'game_results', 'game_points', 'game_user_achievements'];
const PLAYER_TABLES = ['game_attempts', 'game_results', 'game_points', 'game_user_achievements'];
const CLIENT_RPCS = ['start_game_attempt', 'submit_game_attempt', 'get_my_game_summary', 'admin_adjust_game_points'];
const INTERNAL = ['game_user_total', 'game_level_for_points', 'game_next_level_for_points', 'game_verify_answer', 'game_grant_achievements'];

const fn = (name) => {
  const i = sql.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = sql.indexOf('create or replace function', i + 10);
  return sql.slice(i, j > -1 ? j : sql.length);
};

test('0050: كل الجداول العشرة معرّفة وRLS مفعّل عليها', () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
  }
});

test('0050: بيانات اللاعبين قراءة فقط: لا منح كتابة ولا سياسة كتابة عليها', () => {
  const m = sql.match(/grant select on public\.game_attempts[^;]*to authenticated;/);
  assert.ok(m, 'منح select فقط لجداول اللاعبين');
  for (const t of PLAYER_TABLES) {
    assert.ok(m[0].includes(`public.${t}`), t);
    assert.doesNotMatch(sql, new RegExp(`grant[^;]*(insert|update|delete)[^;]*public\\.${t}\\b[^;]*to`, 'i'), `${t}: منح كتابة`);
    const pols = [...sql.matchAll(new RegExp(`create policy (\\w+) on public\\.${t} for (\\w+)`, 'g'))];
    assert.ok(pols.length >= 2, `${t}: سياستا قراءة`);
    for (const p of pols) assert.equal(p[2], 'select', `${t}.${p[1]} ليست select`);
  }
});

test('0050: لا سياسات عامة (كل سياسة to authenticated) ولا منح لـ anon/public', () => {
  const policies = [...sql.matchAll(/create policy \w+ on public\.\w+ for \w+ (to \w+)?/g)];
  assert.ok(policies.length >= 15);
  for (const p of policies) assert.equal(p[1], 'to authenticated');
  assert.doesNotMatch(sql, /\bto\s+(?:\w+,\s*)*(anon|public)\b/i);
  assert.match(sql, /revoke all on table[\s\S]*?from public, anon, authenticated/);
});

test('0050: الحلول لا تُقرأ إلا بـ can_manage_games() (لا سياسة select للاعب)', () => {
  const pols = [...sql.matchAll(/create policy (\w+) on public\.game_challenge_solutions[\s\S]*?;/g)];
  assert.equal(pols.length, 1);
  assert.match(pols[0][0], /can_manage_games/);
  assert.doesNotMatch(pols[0][0], /can_access_games/);
});

test('0050: كل الدوال SECURITY DEFINER بمسار بحث ثابت، وrevoke من الجميع، والمنح للمصادقين فقط للمُعلَنة', () => {
  for (const f of [...CLIENT_RPCS, ...INTERNAL, 'can_manage_games']) {
    assert.match(fn(f), /security definer[\s\S]{0,60}set search_path = public, pg_temp|set search_path = public, pg_temp/, f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), `revoke ${f}`);
  }
  for (const f of [...CLIENT_RPCS, 'can_manage_games']) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\)\\s+to authenticated;`), `grant ${f}`);
  }
  for (const f of INTERNAL) assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${f}`), `${f} يجب ألا تُمنح`);
  assert.doesNotMatch(sql, /grant execute[^;]*\banon\b/);
});

test('0050: عمليات اللاعب تتحقق من auth.uid() وcan_access_games() وتقيّد المحاولة بصاحبها', () => {
  for (const f of ['start_game_attempt', 'submit_game_attempt', 'get_my_game_summary']) {
    assert.match(fn(f), /auth\.uid\(\)/, f);
    assert.match(fn(f), /can_access_games\(\)/, f);
  }
  assert.match(fn('submit_game_attempt'), /where id = p_attempt_id and user_id = v_uid for update/);
  assert.match(fn('admin_adjust_game_points'), /can_manage_games\(\)/);
});

test('0050: لا تثق بالواجهة: التسليم بلا نقاط/نتيجة/مدة من العميل، والنقاط من points_reward فقط وبقيد فريد', () => {
  const sig = sql.match(/function public\.submit_game_attempt\(([^)]*)\)/)[1];
  assert.equal(sig.replace(/\s+/g, ' ').trim(), 'p_attempt_id uuid, p_answer jsonb');
  const body = fn('submit_game_attempt');
  assert.match(body, /game_verify_answer\(/);
  assert.match(body, /c\.points_reward/);
  assert.match(body, /on conflict \(user_id, challenge_id\) where reason = 'challenge_solved' do nothing/);
  assert.match(sql, /create unique index if not exists uq_game_points_challenge[\s\S]*?where reason = 'challenge_solved'/);
  assert.match(sql, /create unique index if not exists uq_game_points_achievement[\s\S]*?where reason = 'achievement'/);
  assert.match(sql, /create unique index if not exists uq_game_attempts_one_open[\s\S]*?where status = 'in_progress'/);
  assert.doesNotMatch(body, /raise exception 'verification_unavailable'[\s\S]*return[\s\S]*solution/); // لا تُعاد الإجابة الصحيحة
  assert.doesNotMatch(body, /'solution'/);
});

test('0050: الوضع غير المدعوم للتحقق يفشل مغلقًا؛ ونتائج/نقاط لا تُعدَّل (مشغّلات)', () => {
  assert.match(fn('game_verify_answer'), /raise exception 'verification_unavailable'/);
  assert.match(sql, /create trigger trg_game_results_immutable before update on public\.game_results/);
  assert.match(sql, /create trigger trg_game_points_immutable before update on public\.game_points/);
});

test('0050: لا يعيد تعريف 0049 ولا يمسّ المصادقة، ولا يستعمل service_role', () => {
  assert.doesNotMatch(sql, /function public\.(can_access_games|get_games_access|is_admin|current_admin_role|current_member_id|mfa_satisfied)\(/);
  assert.doesNotMatch(sql, /service_role/i);
  assert.doesNotMatch(sql, /alter table public\.(profiles|members|member_accounts|member_memberships|site_settings)/i);
});

test('0050: الرجوع يحذف كل الجداول والدوال بلا CASCADE', () => {
  for (const t of TABLES) assert.match(down, new RegExp(`drop table if exists public\\.${t};`), t);
  for (const f of [...CLIENT_RPCS, ...INTERNAL, 'can_manage_games', 'game_points_immutable', 'game_results_immutable']) {
    assert.match(down, new RegExp(`drop function if exists public\\.${f}\\(`), f);
  }
  assert.doesNotMatch(down, /cascade/i);
  assert.doesNotMatch(down, /can_access_games|get_games_access/);
});

test('خدمات الألعاب: لا service_role، ولا إرسال نقاط/نتيجة من الواجهة، ولا قراءة جدول الحلول', () => {
  const files = ['gamesCatalog', 'gamesAttempts', 'gamesProgress'].map((n) => read(`src/features/games/services/${n}.service.js`));
  const all = files.join('\n') + read('src/features/games/services/gamesCore.shared.js');
  assert.doesNotMatch(all, /service_role/i);
  assert.doesNotMatch(all, /game_challenge_solutions/);
  assert.doesNotMatch(all, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(all, /select\('\*'\)/);
  const attempts = files[1];
  assert.match(attempts, /rpc\('submit_game_attempt', \{ p_attempt_id: attemptId, p_answer: answer \}\)/);
});
