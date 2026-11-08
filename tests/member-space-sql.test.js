import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');

const sql = stripSql(read('supabase/migrations/0036_member_space_activation_and_card_requests.sql'));
const down = stripSql(read('supabase/rollback/0036_member_space_down.sql'));
const edge = read('supabase/functions/member-activate/index.ts');
const config = read('supabase/config.toml');

const fnBody = (name) => {
  const i = sql.indexOf(`function public.${name}(`);
  assert.ok(i >= 0, `الدالة ${name} غير موجودة`);
  return sql.slice(i, sql.indexOf('$$;', sql.indexOf('as $$', i)));
};

test('0036: جدولا الروابط والطلبات مغلقان — RLS مفعّلة وسحب كل الصلاحيات من العملاء', () => {
  for (const t of ['member_activation_links', 'member_card_requests']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`), t);
    assert.doesNotMatch(sql, new RegExp(`grant [^;]*\\b(insert|update|delete|all)\\b[^;]*on public\\.${t}`, 'i'), t);
    assert.doesNotMatch(sql, new RegExp(`grant [^;]*on public\\.${t} to[^;]*anon`), t);
  }
  // جدول الروابط بلا أي سياسة ولا SELECT لأي عميل
  assert.doesNotMatch(sql, /on public\.member_activation_links\s+for /);
  assert.doesNotMatch(sql, /grant select on public\.member_activation_links/);
});

test('0036: الرمز يُخزَّن مُجزَّأً فقط وطلب واحد قيد الانتظار لكل عضو', () => {
  assert.match(sql, /token_hash text not null unique/);
  assert.doesNotMatch(sql, /\btoken\s+text\b/);
  assert.match(sql, /create unique index if not exists idx_member_card_requests_one_pending\s+on public\.member_card_requests \(member_id\) where status = 'pending'/);
});

test('0036: قراءة الطلبات — صاحبها أو مديرو نظام الأعضاء فقط، ولا سياسة كتابة', () => {
  assert.match(sql, /member_card_requests_own_read[\s\S]*?using \(member_id = public\.current_member_id\(\)\)/);
  assert.match(sql, /member_card_requests_manager_read[\s\S]*?using \(public\.can_manage_member_system\(\)\)/);
  assert.doesNotMatch(sql, /create policy[^;]*on public\.member_card_requests\s+for (insert|update|delete|all)/i);
});

test('0036: كل دالة SECURITY DEFINER تثبّت search_path', () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.equal(fns.length, 11);
  for (const f of fns) {
    const head = f.slice(0, 400);
    assert.match(head, /security definer/, head.split('(')[0]);
    assert.match(head, /set search_path = public(, auth)?, pg_temp/, head.split('(')[0]);
  }
});

test('0036: كل دالة تسحب EXECUTE من public وanon وauthenticated ثم تمنح بدقة', () => {
  const names = [
    ['issue_member_activation_link', 'uuid', 'authenticated'],
    ['get_member_activation_link', 'text', 'anon, authenticated'],
    ['prepare_member_activation', 'text', 'service_role'],
    ['finalize_member_activation', 'text, uuid', 'service_role'],
    ['get_my_member', '', 'authenticated'],
    ['update_my_member_private', 'jsonb', 'authenticated'],
    ['submit_member_card_request', 'jsonb, text', 'authenticated'],
    ['cancel_my_member_card_request', '', 'authenticated'],
    ['approve_member_card_request', 'uuid, text', 'authenticated'],
    ['reject_member_card_request', 'uuid, text', 'authenticated'],
    ['member_card_photo_upload_allowed', 'text', 'authenticated'],
  ];
  for (const [n, args, to] of names) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${n}\\(${args}\\)\\s+from public, anon, authenticated`), `revoke ${n}`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${n}\\(${args}\\)\\s+to ${to};`), `grant ${n}`);
  }
});

test('0036: دوال الـ Edge Function لا تُمنح لأي دور عميل', () => {
  assert.doesNotMatch(sql, /grant execute on function public\.(prepare|finalize)_member_activation[^;]*(anon|authenticated)/);
});

test('0036: المسؤول — الإصدار والاعتماد والرفض تتطلب can_manage_member_system', () => {
  for (const n of ['issue_member_activation_link', 'approve_member_card_request', 'reject_member_card_request']) {
    assert.match(fnBody(n), /auth\.uid\(\) is null or not public\.can_manage_member_system\(\)/, n);
  }
});

test('0036: دوال العضو تعتمد current_member_id() لا معرّفًا قادمًا من العميل', () => {
  for (const n of ['get_my_member', 'update_my_member_private', 'submit_member_card_request', 'cancel_my_member_card_request']) {
    const b = fnBody(n);
    assert.match(b, /public\.current_member_id\(\)/, n);
    assert.doesNotMatch(b.slice(0, b.indexOf('begin')), /p_member_id|p_user_id/, n);
  }
});

test('0036: العضو لا يكتب في الحقول الإدارية — bio وfull_name وemail ليست في أي update', () => {
  const approve = fnBody('approve_member_card_request');
  const upd = approve.slice(approve.indexOf('update public.members'), approve.indexOf('update public.member_card_requests'));
  for (const col of ['bio ', 'full_name', 'email', 'phone', 'city', 'status', 'deleted_at']) {
    assert.doesNotMatch(upd, new RegExp(`\\b${col.trim()}\\s*=`), col);
  }
  const priv = fnBody('update_my_member_private');
  assert.doesNotMatch(priv, /set\s+(full_name|email|status|bio|photo_url|promotion|university|track)\b/);
  const submit = fnBody('submit_member_card_request');
  assert.match(submit, /v_clean - 'bio'/); // الحقل الخاص يُحذف من المقترح
});

test('0036: سحب الموافقة على الظهور فوري، أما التفعيل فيمر بالمراجعة', () => {
  const priv = fnBody('update_my_member_private');
  assert.match(priv, /hide_from_directory/);
  assert.doesNotMatch(priv, /show_in_directory = true/);
});

test('0036: الاعتماد والرفض يعملان على طلب pending فقط مع قفل الصف', () => {
  for (const n of ['approve_member_card_request', 'reject_member_card_request']) {
    const b = fnBody(n);
    assert.match(b, /for update/, n);
    assert.match(b, /status <> 'pending'/, n);
  }
});

test('0036: التفعيل — الرمز يُستعمل مرة واحدة وينتهي، ولا يصدر لعضو له حساب أو بريده مسجّل', () => {
  const issue = fnBody('issue_member_activation_link');
  assert.match(issue, /interval '7 days'/);
  assert.match(issue, /from public\.member_accounts where member_id/);
  assert.match(issue, /from auth\.users u where lower\(u\.email\)/);
  const fin = fnBody('finalize_member_activation');
  assert.match(fin, /for update/);
  assert.match(fin, /used_at is not null or v_l\.expires_at < now\(\)/);
  assert.match(fin, /update public\.member_activation_links set used_at = now\(\)/);
});

test('0036: التحقق من الرابط لا يكشف البريد كاملًا ولا أي حقل خاص', () => {
  const b = fnBody('get_member_activation_link');
  assert.match(b, /email_hint/);
  assert.doesNotMatch(b, /'phone'|'city'|'email',/);
});

test('0036: رفع الصورة — مجلد العضو نفسه فقط، سقف 10 ملفات، وbucket خاص', () => {
  const b = fnBody('member_card_photo_upload_allowed');
  assert.match(b, /split_part\(p_name, '\/', 1\) = 'member-' \|\| public\.current_member_id\(\)::text/);
  assert.match(b, /< 10/);
  assert.match(sql, /member_card_photo_insert[\s\S]*?bucket_id = 'membership-docs'/);
  assert.match(sql, /member_card_photo_manager_select[\s\S]*?can_manage_member_system\(\)/);
  assert.doesNotMatch(sql, /for (update|delete) to authenticated[\s\S]{0,40}member_card_photo/);
  const sub = fnBody('submit_member_card_request');
  assert.match(sub, /from storage\.objects where bucket_id = 'membership-docs' and name = p_photo_path/);
});

test('0036: لا تعديل على أي كائن موجود (إضافة فقط)', () => {
  assert.doesNotMatch(sql, /alter table public\.(members|profiles|member_accounts)\b/);
  assert.doesNotMatch(sql, /drop (policy|function|trigger)[^;]*(members_|profiles_|member_accounts_)/);
  assert.doesNotMatch(sql, /create or replace function public\.(current_member_id|can_manage_member_system|current_admin_role|is_admin|mfa_satisfied)\b/);
});

test('0036: الرجوع يحذف الجديد فقط ولا يمسّ member_accounts ولا members', () => {
  assert.match(down, /drop table if exists public\.member_card_requests/);
  assert.match(down, /drop table if exists public\.member_activation_links/);
  assert.doesNotMatch(down, /drop table[^;]*(member_accounts|members\b|profiles)/);
});

test('member-activate: لا تثق بالبريد القادم من العميل، وتتراجع عند الفشل، وverify_jwt = false مسجّل', () => {
  assert.match(config, /\[functions\.member-activate\]\s+verify_jwt = false/);
  assert.match(edge, /prepare_member_activation/);
  assert.match(edge, /finalize_member_activation/);
  assert.match(edge, /email: prep\.email/);
  assert.doesNotMatch(edge, /body\.email/);
  assert.match(edge, /auth\.admin\.deleteUser\(created\.user\.id\)/);
  assert.match(edge, /\^\[0-9a-f\]\{64\}\$/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin': '\*'/);
});

test('لا يتجاوز أي تكرار {n,m} في تعبيرات SQL حدّ PostgreSQL (255)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const body = stripSql(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const m of body.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      for (const n of [m[1], m[2]]) {
        if (n) assert.ok(Number(n) <= 255, `${f}: ${m[0]} يتجاوز 255`);
      }
    }
  }
});
