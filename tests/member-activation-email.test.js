import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const sql = stripSql(read('supabase/migrations/0048_member_activation_email.sql'));
const down = stripSql(read('supabase/rollback/0048_member_activation_email_down.sql'));
const emailEdge = read('supabase/functions/member-activate-email/index.ts');
const edge = read('supabase/functions/member-activate/index.ts');
const config = read('supabase/config.toml');
const page = read('src/pages/member/MemberActivate.jsx');
const service = read('src/services/supabase/memberSpace.service.js');
const fnBody = (name) => {
  const i = sql.indexOf(`function public.${name}(`);
  assert.ok(i >= 0, name);
  return sql.slice(i, sql.indexOf('$$;', sql.indexOf('as $$', i)));
};

test('0048: إضافة فقط — أعمدة على جدول الروابط المغلق ودالتان جديدتان، دون استبدال أي دالة قائمة', () => {
  assert.match(sql, /alter table public\.member_activation_links\s+add column if not exists email_confirmed/);
  assert.doesNotMatch(sql, /create table/i);
  assert.doesNotMatch(sql, /create policy|drop policy/i);
  const defined = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(defined, ['member_activation_email_confirmed', 'set_member_activation_email']);
  assert.doesNotMatch(sql, /update public\.profiles|insert into public\.profiles|update auth\.users/i);
});

test('0048: الدالتان service_role فقط ومسار البحث ثابت', () => {
  for (const [n, sig] of [['set_member_activation_email', 'text, text'], ['member_activation_email_confirmed', 'text']]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${n}\\(${sig}\\)\\s+from public, anon, authenticated`), n);
    assert.match(sql, new RegExp(`grant execute on function public\\.${n}\\(${sig}\\) to service_role`), n);
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${n}[^;]*(anon|authenticated)`), n);
    assert.match(fnBody(n).slice(0, 300), /security definer[\s\S]*set search_path = public(, auth)?, pg_temp/, n);
  }
});

test('0048: set_member_activation_email — الرمز أولًا، لا حساب للعضو، لا يستهلك الرمز، يمنع بريد حساب آخر', () => {
  const f = fnBody('set_member_activation_email');
  assert.match(f, /token_hash = v_hash for update/);
  assert.match(f, /used_at is not null or v_l\.expires_at < now\(\)/);
  assert.match(f, /exists \(select 1 from public\.member_accounts where member_id = v_m\.id\)[\s\S]{0,40}activation_link_invalid/);
  assert.doesNotMatch(f, /set used_at/);                                  // الرمز لا يُستهلك إلا في finalize
  assert.match(f, /from auth\.users u where lower\(btrim\(u\.email\)\) = v_email/);
  assert.match(f, /from public\.profiles p where lower\(btrim\(p\.email\)\) = v_email/);
  assert.match(f, /o\.id <> v_m\.id and o\.deleted_at is null/);
  assert.match(f, /update public\.members set email = v_email where id = v_m\.id/);
  assert.match(f, /MEMBER_ACTIVATION_EMAIL_SET/);
});

test('0048: الإخفاقات المتوقعة تُعاد كنتيجة (لا raise) كي يُحفظ عدّاد المحاولات، والسقف 10 مرتبط بالرمز', () => {
  const f = fnBody('set_member_activation_email');
  for (const r of ['invalid_format', 'attempts_exceeded', 'email_taken']) assert.match(f, new RegExp(`return jsonb_build_object\\('ok', false, 'reason', '${r}'\\)`));
  assert.equal((f.match(/raise exception/g) || []).length, 3);               // كلها activation_link_invalid
  assert.equal((f.match(/raise exception 'activation_link_invalid'/g) || []).length, 3);
  assert.match(f, /v_l\.email_state_hash = v_l\.token_hash/);               // إعادة الإصدار تصفّر الحالة
  assert.match(f, /v_attempts >= 10/);
  const c = fnBody('member_activation_email_confirmed');
  assert.match(c, /l\.email_state_hash = l\.token_hash and l\.used_at is null and l\.expires_at >= now\(\)/);
});

test('0048: لا تكرار نقاط ولا حدود regex فوق 255، والرجوع يحذف الجديد فقط', () => {
  for (const m of sql.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) for (const n of [m[1], m[2]]) if (n) assert.ok(Number(n) <= 255);
  assert.match(down, /drop function if exists public\.set_member_activation_email\(text, text\)/);
  assert.match(down, /drop function if exists public\.member_activation_email_confirmed\(text\)/);
  assert.match(down, /drop column if exists email_confirmed,\s+drop column if exists email_attempts,\s+drop column if exists email_state_hash/);
});

test('member-activate-email: بلا إنشاء/تعديل/حذف مستخدمين، وبحد مستقل، ومسجّلة بلا JWT كالدالة الأم', () => {
  assert.doesNotMatch(emailEdge, /createUser|updateUserById|deleteUser|auth\.admin/);
  assert.match(emailEdge, /set_member_activation_email/);
  assert.match(emailEdge, /`email:\$\{ip\}`/);
  assert.match(emailEdge, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(token\)/);
  assert.doesNotMatch(emailEdge, /console\.(log|error)\([^)]*token/);        // لا يُسجَّل الرمز
  assert.match(config, /\[functions\.member-activate-email\]\s+verify_jwt = false/);
});

test('member-activate: يبقى البريد من القاعدة فقط، والتفعيل الجديد يُرفض قبل createUser إن لم يُؤكَّد البريد، والاستعادة لا تتأثر', () => {
  assert.doesNotMatch(edge, /body\.email/);
  const iConfirm = edge.indexOf("rpc('member_activation_email_confirmed'");
  assert.ok(iConfirm > edge.indexOf('if (existingUserId)'));
  assert.ok(iConfirm > edge.indexOf('return json({ ok: true, email: prep.email, reset: true })'));   // بعد فرع الاستعادة
  assert.ok(iConfirm < edge.indexOf('await adminClient.auth.admin.createUser'));
  assert.match(edge, /email: prep\.email,\s+password,/);
  assert.equal((edge.match(/deleteUser\(/g) || []).length, 1);
});

// نسخ دالة normalizeEmail من الدالة الطرفية وتشغيلها فعليًا
const src = emailEdge.slice(emailEdge.indexOf('export function normalizeEmail'), emailEdge.indexOf('async function handle'))
  .replace('export function normalizeEmail(raw: unknown): string | null', 'function normalizeEmail(raw)');
const normalizeEmail = new Function(`${src}; return normalizeEmail;`)();

test('normalizeEmail: صيغ صحيحة وخاطئة', () => {
  assert.equal(normalizeEmail('  Ali.Ben+club@Gmail.COM '), 'ali.ben+club@gmail.com');
  assert.equal(normalizeEmail('a@b.co'), 'a@b.co');
  assert.equal(normalizeEmail('x@mail.univ-rabat.ac.ma'), 'x@mail.univ-rabat.ac.ma');
  for (const bad of ['', 'abc', 'a@b', 'a@@b.com', 'a b@c.com', 'a..b@c.com', 'a@b..com', '@b.com', 'a@.com', 'a@b.c', 'a@-b.com'.replace('-b', '_b'), null, undefined, `${'a'.repeat(65)}@b.com`, `a@${'b'.repeat(150)}.com`]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('الصيغة في Edge Function مطابقة لتلك في SQL', () => {
  const re = (s) => s.match(/\^\[a-z0-9\._%\+-\]\+@.*?\$/)[0].replace(/\\\./g, '.');
  const a = re(sql);
  const b = re(emailEdge);
  assert.equal(a.replace(/\\\./g, '.'), b.replace(/\\\./g, '.'));
});

test('الواجهة: خطوة البريد للتفعيل الجديد فقط، وتعود إليها عند email_required/email_taken، ولا يُكتب في members من الواجهة', () => {
  assert.match(page, /const needsEmail = !reset && !confirmedEmail/);
  assert.match(page, /setActivationEmail\(token, em\)/);
  assert.match(page, /err\?\.code === 'email_required' \|\| err\?\.code === 'email_taken'/);
  assert.match(page, /\{!reset && \(/);                                      // زر تعديل البريد لا يظهر في الاستعادة
  assert.match(service, /invokeActivation\('member-activate-email', \{ token, email \}\)/);
  assert.doesNotMatch(page + service, /\.from\('members'\)\s*\.(update|insert|delete|upsert)/);
});
