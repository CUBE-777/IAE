import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// اختبارات static على ملفات SQL (لا اتصال بقاعدة البيانات). السلوك الفعلي: supabase/tests/certificates_smoke.sql على بيئة تجريبية.
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const f63 = stripSql(read('supabase/migrations/0063_certificates_schema.sql'));
const f64 = stripSql(read('supabase/migrations/0064_certificates_admin_functions.sql'));
const f65 = stripSql(read('supabase/migrations/0065_certificates_email_queue.sql'));
const f66 = stripSql(read('supabase/migrations/0066_certificates_email_token_recheck.sql'));
const all = f63 + f64 + f65 + f66;
const down63 = stripSql(read('supabase/rollback/0063_certificates_schema_down.sql'));
const down64 = stripSql(read('supabase/rollback/0064_certificates_admin_functions_down.sql'));
const down65 = stripSql(read('supabase/rollback/0065_certificates_email_queue_down.sql'));
const down66 = stripSql(read('supabase/rollback/0066_certificates_email_token_recheck_down.sql'));

const fnBody = (src, name) => {
  const i = src.indexOf(`function public.${name}(`);
  assert.ok(i > -1, `الدالة ${name} غير معرّفة`);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};
const TABLES = ['certificate_templates', 'certificate_campaigns', 'certificates', 'certificate_recipients',
  'certificate_email_queue', 'certificate_email_logs', 'certificate_token_secret', 'certificate_number_counters'];

test('الترقيم: 0063→0065 متسلسلة بعد 0062 ولا يوجد تكرار', () => {
  const files = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((x) => /^\d{4}_.*\.sql$/.test(x));
  const nums = files.map((x) => x.slice(0, 4));
  assert.equal(new Set(nums).size, nums.length, 'أرقام migrations مكرّرة');
  for (const n of ['0062', '0063', '0064', '0065', '0066']) assert.ok(nums.includes(n), n);
  assert.ok(fs.existsSync(new URL('../supabase/rollback/0063_certificates_schema_down.sql', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../supabase/rollback/0064_certificates_admin_functions_down.sql', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../supabase/rollback/0065_certificates_email_queue_down.sql', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../supabase/rollback/0066_certificates_email_token_recheck_down.sql', import.meta.url)));
});

test('الجداول الثمانية معرّفة، RLS مفعّل، وكل الصلاحيات مسحوبة', () => {
  for (const t of TABLES) {
    assert.match(f63, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(f63, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
  }
  assert.match(f63, /revoke all on table[\s\S]*?from public, anon, authenticated/);
});

test('السرّ والعدّادات: بلا سياسات ولا منح؛ لا INSERT/UPDATE/DELETE لأي دور عميل', () => {
  assert.doesNotMatch(f63, /create policy certificate_token_secret|create policy certificate_number_counters/);
  assert.doesNotMatch(all, /grant (insert|update|delete|all)[^;]*on (table )?public\.certificate/i);
  assert.doesNotMatch(all, /grant select[^;]*certificate_token_secret|grant select[^;]*certificate_number_counters/i);
  // SELECT المباشر لا يشمل token_hash
  const colGrant = f63.match(/grant select \(([^)]*)\)\s+on public\.certificates/);
  assert.ok(colGrant, 'منح أعمدة الشهادات غير موجود');
  assert.doesNotMatch(colGrant[1], /token_hash/);
  assert.doesNotMatch(f63, /grant select on public\.certificates /);
  // كل سياسات القراءة تمرّ عبر can_manage_certificates (لا members_manager مباشرة)
  const policies = f63.match(/create policy [\s\S]*?;/g) || [];
  assert.equal(policies.length, 6);
  for (const p of policies) assert.match(p, /for select to authenticated using \(public\.can_manage_certificates\(\)\)/);
  assert.doesNotMatch(f63, /create policy[^;]*for (insert|update|delete|all)/i);
});

test('كل الدوال SECURITY DEFINER بمسار بحث ثابت (pgcrypto مؤهَّل بالكامل)', () => {
  const defs = (all.match(/create or replace function public\.\w+\([\s\S]*?\n(?:as|language)/g) || []);
  assert.ok(defs.length >= 36, `عدد الدوال ${defs.length}`);
  const bodies = all.split(/create or replace function /).slice(1);
  for (const b of bodies) {
    const name = b.slice(0, b.indexOf('(')).trim();
    if (/security definer/.test(b.slice(0, 600))) assert.match(b.slice(0, 700), /set search_path = public, pg_temp/, name);
    else assert.match(b.slice(0, 700), /set search_path = public, pg_temp|language plpgsql\nset search_path/, name);
  }
  assert.match(f63, /%I\.hmac\(p_msg, p_key, 'sha256'\)/);
  assert.match(f63, /%I\.gen_random_bytes\(p_n\)/);
});

test('المساعدات الداخلية بلا منح؛ والمنح صريحة فقط', () => {
  for (const f of ['certificate_hmac', 'certificate_random_bytes', 'certificate_audit', 'certificate_token_for', 'certificate_token_hash',
    'certificate_next_number', 'certificate_mask_name']) {
    assert.match(all, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon, authenticated`), f);
    assert.doesNotMatch(all, new RegExp(`grant execute on function public\\.${f}\\(`), f);
  }
  const grantsAnon = all.match(/grant execute[^;]*\banon\b[^;]*;/g) || [];
  assert.equal(grantsAnon.length, 1);
  assert.match(grantsAnon[0], /verify_certificate\(text\)\s+to anon, authenticated/);
  // عامل البريد: service_role فقط
  for (const f of ['certificate_email_claim_next(text)', 'certificate_email_complete(uuid, boolean, text)', 'certificate_email_release_stale(integer)']) {
    assert.ok(f65.includes(`grant execute on function public.${f}`), f);
    assert.match(f65, new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, '\\$&')}\\s+to service_role;`), f);
  }
});

test('التحقق العام: الحالات الثلاث ولا تُكشف بيانات الحساب أو البريد أو الرموز', () => {
  const verify = fnBody(f64, 'verify_certificate');
  assert.match(verify, /'status', 'not_found'/);
  assert.match(verify, /'status', 'revoked'/);
  assert.match(verify, /'status', 'valid'/);
  assert.match(verify, /case v_c\.public_name_mode[\s\S]*'full'[\s\S]*'masked'/);
  const revoked = verify.slice(verify.indexOf("if v_c.status = 'revoked'"));
  assert.match(revoked, /'revoked_at'/);
  assert.doesNotMatch(revoked, /'holder_name'|'recipient_name'|'email'|'member_id'/);
  assert.doesNotMatch(verify, /'email'|'member_id'|'token_hash'|'recipient_email'/);
  assert.match(verify, /p_token !~/);
  assert.match(fnBody(f63, 'can_admin_certificates'), /in \('developer', 'super_admin'\)/);
  assert.match(fnBody(f63, 'can_manage_certificates'), /in \('developer', 'super_admin', 'secretary_general'\)/);
  assert.match(fnBody(f63, 'can_review_certificate_recipients'), /in \('developer', 'super_admin', 'secretary_general', 'members_manager'\)/);
  assert.doesNotMatch(f63, /create or replace function public\.(can_manage_content|can_manage_members|is_admin|current_admin_role|current_member_id)\(/);
  assert.doesNotMatch(all, /alter type admin_role/i);
  assert.match(fnBody(f64, 'certificate_rotate_token_secret'), /current_admin_role\(\)::text is distinct from 'developer'/);
  for (const f of ['certificate_create_campaign', 'certificate_issue_campaign', 'certificate_revoke', 'certificate_archive_campaign', 'certificate_set_public_name_mode'])
    assert.match(fnBody(f64, f), /not public\.can_manage_certificates\(\)/, f);
  for (const f of ['certificate_save_template', 'certificate_reissue_token']) assert.match(fnBody(f64, f), /not public\.can_admin_certificates\(\)/, f);
  for (const f of ['certificate_review_campaigns', 'certificate_review_recipients']) assert.match(fnBody(f64, f), /not public\.can_review_certificate_recipients\(\)/, f);
});

test('الرمز: HMAC-SHA256 عبر pgcrypto، Base64URL، تخزين hash فقط، بلا بناء مخصّص', () => {
  const t = fnBody(f64, 'certificate_token_for');
  assert.match(t, /public\.certificate_hmac\(s\.secret, convert_to\('iae-cert:v1:' \|\| p_certificate_id::text \|\| ':' \|\| p_epoch::text, 'utf8'\)\)/);
  assert.match(t, /translate\([\s\S]*'\+\/', '-_'\)/);
  assert.match(t, /rtrim\(/);
  assert.match(f63, /secret\s+bytea not null check \(octet_length\(secret\) = 32\)/);
  assert.match(f63, /certificate_random_bytes\(32\)/);
  assert.match(f63, /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(f63 + f64, /\braw_token\b|\btoken\s+text\s+not null/);
  assert.doesNotMatch(all, /sha256\(convert_to\([^)]*secret/i);   // لا sha256(secret ‖ …) مخصّص
  assert.match(fnBody(f64, 'certificate_token_hash'), /sha256\(convert_to\(p_token, 'utf8'\)\)/);
  // الرمز لا يُخزَّن ولا يُسجَّل
  assert.doesNotMatch(f63, /(token|secret)\s+text/);
  assert.match(fnBody(f63, 'certificate_audit'), /'token', 'secret'/);
});

test('التدوير: قفل السرّ، إعادة اشتقاق كل hash في نفس المعاملة، توثيق، والإصدار يأخذ FOR SHARE', () => {
  const r = fnBody(f64, 'certificate_rotate_token_secret');
  assert.match(r, /from public\.certificate_token_secret where id = 1 for update/);
  assert.match(r, /update public\.certificates c\s+set token_hash = public\.certificate_token_hash\(public\.certificate_token_for\(c\.id, c\.token_epoch\)\)/);
  assert.match(r, /certificate_audit\('certificate_secret_rotated'/);
  assert.match(fnBody(f64, 'certificate_issue_campaign'), /certificate_token_secret where id = 1 for share/);
  assert.match(f63, /iae\.certificate_internal/);
});

test('الملكية: member_id ON DELETE SET NULL، المطابقة fail-closed عبر current_member_id()', () => {
  assert.match(f63, /member_id\s+uuid references public\.members\(id\) on delete set null/);
  assert.doesNotMatch(f63, /references public\.members\(id\) on delete cascade/);
  assert.match(f63, /certificate_owner_immutable/);
  const mine = fnBody(f64, 'get_my_certificates');
  assert.match(mine, /public\.current_member_id\(\)/);
  assert.match(mine, /auth\.uid\(\) is null or v_me is null/);
  assert.match(mine, /c\.member_id is not null and c\.member_id = v_me/);
  const render = fnBody(f64, 'get_certificate_render_data');
  assert.match(render, /v_me is not null and v_c\.member_id is not null and v_c\.member_id = v_me/);
  assert.match(render, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);
  // لا حذف شهادات من أي مسار، والحملة/الشهادة restrict
  assert.match(f63, /campaign_id\s+uuid not null references public\.certificate_campaigns\(id\) on delete restrict/);
  assert.match(f63, /certificate_delete_forbidden/);
  assert.match(f63, /certificate_campaign_delete_forbidden/);
});

test('الخصوصية: التحقق العام بلا email/member_id؛ الملغاة بلا اسم؛ الافتراضي masked؛ التضييق فقط', () => {
  const v = fnBody(f64, 'verify_certificate');
  assert.doesNotMatch(v, /recipient_email|member_id|issued_by|revoked_by|revoke_reason/);
  assert.match(v, /'status', 'not_found'/);
  assert.match(v, /'status', 'revoked'/);
  assert.match(v, /'status', 'valid'/);
  const revokedBranch = v.slice(v.indexOf("v_c.status = 'revoked'"), v.indexOf("'status', 'valid'"));
  assert.doesNotMatch(revokedBranch, /holder_name|recipient_name/);
  assert.match(v, /p_token !~ '\^\[A-Za-z0-9_-\]\{43\}\$'/);
  assert.match(f63, /public_name_mode\s+text not null default 'masked' check \(public_name_mode in \('none', 'masked', 'full'\)\)/);
  assert.match(f63, /certificate_name_mode_widening_forbidden/);
  assert.match(fnBody(f64, 'certificate_set_public_name_mode'), /certificate_name_mode_widening_forbidden/);
});

test('مراجعة members_manager: RPC محدودة بلا email/member_id/token/queue', () => {
  for (const f of ['certificate_review_campaigns', 'certificate_review_recipients']) {
    const b = fnBody(f64, f);
    assert.doesNotMatch(b, /\bemail\b\s*,|'email'|recipient_email|member_id|token|certificate_email_queue|snapshot/, f);
  }
  const b = fnBody(f64, 'certificate_review_recipients');
  assert.match(b, /'has_email', r\.email is not null/);
  assert.match(b, /v_c\.status = 'archived' and not public\.can_manage_certificates\(\)/);
});

test('مصادر الأهلية: registration_based معطّل بمشغّل؛ لا استخدام لـ invitations/RSVP', () => {
  assert.match(f63, /certificate_registration_based_disabled/);
  assert.match(fnBody(f64, 'certificate_create_campaign'), /certificate_registration_based_disabled/);
  assert.doesNotMatch(all, /activity_invitations|rsvp/i);
  assert.match(fnBody(f64, 'certificate_add_attendance_recipients'), /from public\.activity_attendance a/);
  assert.match(f63, /certificate_type in \('participation', 'organization', 'volunteering', 'training'\)/);
});

test('منع التكرار: فهارس فريدة للمستفيدين والرقم والرمز والمهمة النشطة', () => {
  assert.match(f63, /uq_certificate_recipient_member[\s\S]*?\(campaign_id, member_id\) where member_id is not null/);
  assert.match(f63, /uq_certificate_recipient_external_email[\s\S]*?lower\(email\)\) where kind = 'external'/);
  assert.match(f63, /uq_certificate_recipient_external_name/);
  assert.match(f63, /certificate_number text not null unique/);
  assert.match(f63, /uq_certificate_email_active[\s\S]*?\(certificate_id\) where status in \('queued', 'sending'\)/);
});

test('الترقيم: IAE-YYYY-NNNNNN بتوقيت Africa/Casablanca بعدّاد ذرّي (لا sequence ولا max+1)', () => {
  const n = fnBody(f64, 'certificate_next_number');
  assert.match(n, /at time zone 'Africa\/Casablanca'/);
  assert.match(n, /on conflict \(year\) do update set last_value = c\.last_value \+ 1/);
  assert.match(n, /'IAE-' \|\| v_year::text \|\| '-' \|\| lpad\(v_n::text, 6, '0'\)/);
  assert.doesNotMatch(n, /max\(|nextval/i);
});

test('الإلغاء والطابور: ترتيب الأقفال، SKIP LOCKED، رفض الملغاة في enqueue/retry/claim، وتوثيق revoked_during_send', () => {
  const rev = fnBody(f64, 'certificate_revoke');
  assert.match(rev, /from public\.certificates where id = p_certificate_id for update/);
  assert.match(rev, /status = 'cancelled', last_error_code = 'certificate_revoked'/);
  assert.match(rev, /'revoked_during_send'/);
  assert.ok(rev.indexOf('from public.certificates where id = p_certificate_id for update') < rev.indexOf('update public.certificate_email_queue'), 'القفل الأول على الشهادة');

  const enq = fnBody(f65, 'certificate_enqueue_email');
  assert.match(enq, /from public\.certificates where id = p_certificate_id for update/);
  assert.match(enq, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);

  const retry = fnBody(f65, 'certificate_retry_email');
  assert.ok(retry.indexOf('from public.certificates where id = v_cert for update') < retry.indexOf('from public.certificate_email_queue where id = p_queue_id for update'));
  assert.match(retry, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);

  const claim = fnBody(f65, 'certificate_email_claim_next');
  assert.match(claim, /from public\.certificates where id = v_cand\.certificate_id for share skip locked/);
  assert.match(claim, /from public\.certificate_email_queue where id = v_cand\.id for update skip locked/);
  assert.ok(claim.indexOf('for share skip locked') < claim.indexOf('for update skip locked'), 'الشهادة قبل الطابور');
  assert.match(claim, /v_c\.status <> 'valid'/);
  assert.match(fnBody(f66, 'certificate_email_recheck'), /c\.token_hash = public\.certificate_token_hash\(p_token\)/);
  assert.match(fnBody(f66, 'certificate_email_recheck'), /q\.status = 'sending'/);
  assert.match(f66, /revoke all on function public\.certificate_email_recheck\(uuid, text\) from public, anon, authenticated/);
  assert.match(f66, /grant execute on function public\.certificate_email_recheck\(uuid, text\) to service_role/);
  assert.doesNotMatch(f66, /certificate_email_recheck\(uuid\)/);
  assert.match(fnBody(f65, 'certificate_email_complete'), /elsif v_c\.status <> 'valid' then[\s\S]*'cancelled'/);
  assert.match(fnBody(f65, 'certificate_email_release_stale'), /'stale_sending'/);
  // الطابور لا يخزّن نصًّا حرًّا للأخطاء
  assert.match(f63, /last_error_code text check \(last_error_code is null or last_error_code ~ '\^\[a-z0-9_\]\{1,40\}\$'\)/);
  assert.match(fnBody(f65, 'certificate_email_complete'), /v_code !~ '\^\[a-z0-9_\]\{1,40\}\$'/);
});

test('البريد: رابط آمن لا مرفق PDF، ولا مفاتيح مزوّد في الملفات', () => {
  assert.doesNotMatch(all, /attachment|pdf_base64|bytea\s+.*pdf/i);
  assert.doesNotMatch(all, /api[_-]?key|resend|sendgrid|smtp_password|service_role_key/i);
  assert.doesNotMatch(f63, /storage\.|create bucket/i);   // لا تخزين دائم لملفات PDF
});

test('Audit: audit_logs القائم دون أي تعديل على بنيته؛ بلا PII؛ كل العمليات الأساسية مغطّاة', () => {
  assert.doesNotMatch(all, /alter table public\.audit_logs|drop trigger[^;]*audit_logs|create trigger[^;]*on public\.audit_logs|disable trigger/i);
  assert.match(fnBody(f63, 'certificate_audit'), /insert into public\.audit_logs \(user_id, action, entity_type, entity_id, description, metadata\)/);
  assert.match(fnBody(f63, 'certificate_audit'), /\?\| array\['email'[\s\S]*'member_id'[\s\S]*'reason'/);
  for (const a of ['certificate_campaign_created', 'certificate_campaign_issued', 'certificate_revoked', 'certificate_campaign_archived',
    'certificate_privacy_changed', 'certificate_secret_rotated', 'certificate_email_sent', 'certificate_email_enqueued', 'certificate_token_reissued'])
    assert.ok(all.includes(`'${a}'`), a);
  // لا metadata بمفاتيح حسّاسة في أي استدعاء
  const calls = all.match(/certificate_audit\([\s\S]*?\);/g) || [];
  assert.ok(calls.length >= 18, `عدد استدعاءات audit ${calls.length}`);
  for (const c of calls) assert.doesNotMatch(c, /jsonb_build_object\([^;]*'(email|name|token|secret|member_id|reason|display_name)'/, c);
});

test('الحماية: snapshots والإلغاء والطابور والسجلات (مشغّلات)', () => {
  for (const t of ['certificate_campaigns_guard', 'certificates_guard', 'certificate_recipients_guard', 'certificate_email_queue_guard', 'certificate_email_logs_guard'])
    assert.match(f63, new RegExp(`create trigger trg_${t}`), t);
  assert.match(f63, /certificate_snapshot_immutable/);
  assert.match(f63, /certificate_revoked_is_final/);
  assert.match(f63, /certificate_email_logs_append_only/);
  assert.match(f63, /certificate_campaign_invalid_transition/);
  assert.match(f63, /certificate_campaign_locked_after_draft/);
});

test('Rollback: لا يحذف بيانات ولا يمسّ جداول النظام؛ يرفض عند وجود بيانات', () => {
  assert.match(down63, /raise exception 'رُفض الرجوع/);
  assert.match(down63, /exists \(select 1 from public\.certificates\)/);
  assert.match(down63, /exists \(select 1 from public\.certificate_templates where not is_system\)/);
  assert.doesNotMatch(down63 + down64 + down65, /drop table[^;]*\b(audit_logs|members|activities|profiles|activity_attendance)\b/);
  assert.doesNotMatch(down63 + down64 + down65, /\b(delete from|truncate)\b/i);
  assert.doesNotMatch(down63 + down64 + down65, /drop (extension|type)|alter type/i);
  for (const t of TABLES) assert.match(down63, new RegExp(`drop table if exists public\\.${t};`), t);
  assert.match(down64, /exists \(select 1 from public\.certificates\)/);
  assert.match(down65, /status in \('queued', 'sending'\)/);
  assert.match(down66, /drop function if exists public\.certificate_email_recheck\(uuid, text\)/);
  assert.doesNotMatch(down66, /create or replace function public\.certificate_email_recheck\(uuid\)/);
});

test('0063→0066 لا تمسّ security-hardening ولا ملفات قائمة، وتنتهي بـ commit', () => {
  for (const f of ['0063_certificates_schema', '0064_certificates_admin_functions', '0065_certificates_email_queue', '0066_certificates_email_token_recheck']) {
    const src = stripSql(read(`supabase/migrations/${f}.sql`)).trim();
    assert.match(src, /^begin;/);
    assert.match(src, /commit;$/);
  }
  assert.doesNotMatch(all, /security-hardening/);
  assert.doesNotMatch(all, /drop (table|function|policy|trigger)[^;]*\b(profiles|members|audit_logs|member_accounts|activities)\b/i);
  assert.doesNotMatch(all, /create or replace function public\.(set_updated_at|prevent_audit_log_update)\(/);
});

test('ملفات الاختبار والتوثيق موجودة', () => {
  for (const p of ['supabase/tests/certificates_smoke.sql', 'docs/CERTIFICATES_DB.md', 'PHASE_1_HANDOFF.md'])
    assert.ok(fs.existsSync(new URL(`../${p}`, import.meta.url)), p);
  const smoke = read('supabase/tests/certificates_smoke.sql');
  assert.match(smoke, /^[\s\S]*begin;[\s\S]*rollback;\s*$/);
  assert.doesNotMatch(stripSql(smoke), /\bcommit;/);
});
/);
});

test('الصلاحيات: التسلسل والأدوار المقترحة بالضبط', () => {
  assert.match(fnBody(f63, 'can_admin_certificates'), /in \('developer', 'super_admin'\)/);
  assert.match(fnBody(f63, 'can_manage_certificates'), /in \('developer', 'super_admin', 'secretary_general'\)/);
  assert.match(fnBody(f63, 'can_review_certificate_recipients'), /in \('developer', 'super_admin', 'secretary_general', 'members_manager'\)/);
  assert.doesNotMatch(f63, /create or replace function public\.(can_manage_content|can_manage_members|is_admin|current_admin_role|current_member_id)\(/);
  assert.doesNotMatch(all, /alter type admin_role/i);
  assert.match(fnBody(f64, 'certificate_rotate_token_secret'), /current_admin_role\(\)::text is distinct from 'developer'/);
  for (const f of ['certificate_create_campaign', 'certificate_issue_campaign', 'certificate_revoke', 'certificate_archive_campaign', 'certificate_set_public_name_mode'])
    assert.match(fnBody(f64, f), /not public\.can_manage_certificates\(\)/, f);
  for (const f of ['certificate_save_template', 'certificate_reissue_token']) assert.match(fnBody(f64, f), /not public\.can_admin_certificates\(\)/, f);
  for (const f of ['certificate_review_campaigns', 'certificate_review_recipients']) assert.match(fnBody(f64, f), /not public\.can_review_certificate_recipients\(\)/, f);
});

test('الرمز: HMAC-SHA256 عبر pgcrypto، Base64URL، تخزين hash فقط، بلا بناء مخصّص', () => {
  const t = fnBody(f64, 'certificate_token_for');
  assert.match(t, /public\.certificate_hmac\(s\.secret, convert_to\('iae-cert:v1:' \|\| p_certificate_id::text \|\| ':' \|\| p_epoch::text, 'utf8'\)\)/);
  assert.match(t, /translate\([\s\S]*'\+\/', '-_'\)/);
  assert.match(t, /rtrim\(/);
  assert.match(f63, /secret\s+bytea not null check \(octet_length\(secret\) = 32\)/);
  assert.match(f63, /certificate_random_bytes\(32\)/);
  assert.match(f63, /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(f63 + f64, /\braw_token\b|\btoken\s+text\s+not null/);
  assert.doesNotMatch(all, /sha256\(convert_to\([^)]*secret/i);   // لا sha256(secret ‖ …) مخصّص
  assert.match(fnBody(f64, 'certificate_token_hash'), /sha256\(convert_to\(p_token, 'utf8'\)\)/);
  // الرمز لا يُخزَّن ولا يُسجَّل
  assert.doesNotMatch(f63, /(token|secret)\s+text/);
  assert.match(fnBody(f63, 'certificate_audit'), /'token', 'secret'/);
});

test('التدوير: قفل السرّ، إعادة اشتقاق كل hash في نفس المعاملة، توثيق، والإصدار يأخذ FOR SHARE', () => {
  const r = fnBody(f64, 'certificate_rotate_token_secret');
  assert.match(r, /from public\.certificate_token_secret where id = 1 for update/);
  assert.match(r, /update public\.certificates c\s+set token_hash = public\.certificate_token_hash\(public\.certificate_token_for\(c\.id, c\.token_epoch\)\)/);
  assert.match(r, /certificate_audit\('certificate_secret_rotated'/);
  assert.match(fnBody(f64, 'certificate_issue_campaign'), /certificate_token_secret where id = 1 for share/);
  assert.match(f63, /iae\.certificate_internal/);
});

test('الملكية: member_id ON DELETE SET NULL، المطابقة fail-closed عبر current_member_id()', () => {
  assert.match(f63, /member_id\s+uuid references public\.members\(id\) on delete set null/);
  assert.doesNotMatch(f63, /references public\.members\(id\) on delete cascade/);
  assert.match(f63, /certificate_owner_immutable/);
  const mine = fnBody(f64, 'get_my_certificates');
  assert.match(mine, /public\.current_member_id\(\)/);
  assert.match(mine, /auth\.uid\(\) is null or v_me is null/);
  assert.match(mine, /c\.member_id is not null and c\.member_id = v_me/);
  const render = fnBody(f64, 'get_certificate_render_data');
  assert.match(render, /v_me is not null and v_c\.member_id is not null and v_c\.member_id = v_me/);
  assert.match(render, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);
  // لا حذف شهادات من أي مسار، والحملة/الشهادة restrict
  assert.match(f63, /campaign_id\s+uuid not null references public\.certificate_campaigns\(id\) on delete restrict/);
  assert.match(f63, /certificate_delete_forbidden/);
  assert.match(f63, /certificate_campaign_delete_forbidden/);
});

test('الخصوصية: التحقق العام بلا email/member_id؛ الملغاة بلا اسم؛ الافتراضي masked؛ التضييق فقط', () => {
  const v = fnBody(f64, 'verify_certificate');
  assert.doesNotMatch(v, /recipient_email|member_id|issued_by|revoked_by|revoke_reason/);
  assert.match(v, /'status', 'not_found'/);
  assert.match(v, /'status', 'revoked'/);
  assert.match(v, /'status', 'valid'/);
  const revokedBranch = v.slice(v.indexOf("v_c.status = 'revoked'"), v.indexOf("'status', 'valid'"));
  assert.doesNotMatch(revokedBranch, /holder_name|recipient_name/);
  assert.match(v, /p_token !~ '\^\[A-Za-z0-9_-\]\{43\}\$'/);
  assert.match(f63, /public_name_mode\s+text not null default 'masked' check \(public_name_mode in \('none', 'masked', 'full'\)\)/);
  assert.match(f63, /certificate_name_mode_widening_forbidden/);
  assert.match(fnBody(f64, 'certificate_set_public_name_mode'), /certificate_name_mode_widening_forbidden/);
});

test('مراجعة members_manager: RPC محدودة بلا email/member_id/token/queue', () => {
  for (const f of ['certificate_review_campaigns', 'certificate_review_recipients']) {
    const b = fnBody(f64, f);
    assert.doesNotMatch(b, /\bemail\b\s*,|'email'|recipient_email|member_id|token|certificate_email_queue|snapshot/, f);
  }
  const b = fnBody(f64, 'certificate_review_recipients');
  assert.match(b, /'has_email', r\.email is not null/);
  assert.match(b, /v_c\.status = 'archived' and not public\.can_manage_certificates\(\)/);
});

test('مصادر الأهلية: registration_based معطّل بمشغّل؛ لا استخدام لـ invitations/RSVP', () => {
  assert.match(f63, /certificate_registration_based_disabled/);
  assert.match(fnBody(f64, 'certificate_create_campaign'), /certificate_registration_based_disabled/);
  assert.doesNotMatch(all, /activity_invitations|rsvp/i);
  assert.match(fnBody(f64, 'certificate_add_attendance_recipients'), /from public\.activity_attendance a/);
  assert.match(f63, /certificate_type in \('participation', 'organization', 'volunteering', 'training'\)/);
});

test('منع التكرار: فهارس فريدة للمستفيدين والرقم والرمز والمهمة النشطة', () => {
  assert.match(f63, /uq_certificate_recipient_member[\s\S]*?\(campaign_id, member_id\) where member_id is not null/);
  assert.match(f63, /uq_certificate_recipient_external_email[\s\S]*?lower\(email\)\) where kind = 'external'/);
  assert.match(f63, /uq_certificate_recipient_external_name/);
  assert.match(f63, /certificate_number text not null unique/);
  assert.match(f63, /uq_certificate_email_active[\s\S]*?\(certificate_id\) where status in \('queued', 'sending'\)/);
});

test('الترقيم: IAE-YYYY-NNNNNN بتوقيت Africa/Casablanca بعدّاد ذرّي (لا sequence ولا max+1)', () => {
  const n = fnBody(f64, 'certificate_next_number');
  assert.match(n, /at time zone 'Africa\/Casablanca'/);
  assert.match(n, /on conflict \(year\) do update set last_value = c\.last_value \+ 1/);
  assert.match(n, /'IAE-' \|\| v_year::text \|\| '-' \|\| lpad\(v_n::text, 6, '0'\)/);
  assert.doesNotMatch(n, /max\(|nextval/i);
});

test('الإلغاء والطابور: ترتيب الأقفال، SKIP LOCKED، رفض الملغاة في enqueue/retry/claim، وتوثيق revoked_during_send', () => {
  const rev = fnBody(f64, 'certificate_revoke');
  assert.match(rev, /from public\.certificates where id = p_certificate_id for update/);
  assert.match(rev, /status = 'cancelled', last_error_code = 'certificate_revoked'/);
  assert.match(rev, /'revoked_during_send'/);
  assert.ok(rev.indexOf('from public.certificates where id = p_certificate_id for update') < rev.indexOf('update public.certificate_email_queue'), 'القفل الأول على الشهادة');

  const enq = fnBody(f65, 'certificate_enqueue_email');
  assert.match(enq, /from public\.certificates where id = p_certificate_id for update/);
  assert.match(enq, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);

  const retry = fnBody(f65, 'certificate_retry_email');
  assert.ok(retry.indexOf('from public.certificates where id = v_cert for update') < retry.indexOf('from public.certificate_email_queue where id = p_queue_id for update'));
  assert.match(retry, /v_c\.status <> 'valid' then raise exception 'certificate_revoked'/);

  const claim = fnBody(f65, 'certificate_email_claim_next');
  assert.match(claim, /from public\.certificates where id = v_cand\.certificate_id for share skip locked/);
  assert.match(claim, /from public\.certificate_email_queue where id = v_cand\.id for update skip locked/);
  assert.ok(claim.indexOf('for share skip locked') < claim.indexOf('for update skip locked'), 'الشهادة قبل الطابور');
  assert.match(claim, /v_c\.status <> 'valid'/);
  assert.match(fnBody(f66, 'certificate_email_recheck'), /c\.token_hash = public\.certificate_token_hash\(p_token\)/);
  assert.match(fnBody(f66, 'certificate_email_recheck'), /q\.status = 'sending'/);
  assert.match(f66, /revoke all on function public\.certificate_email_recheck\(uuid, text\) from public, anon, authenticated/);
  assert.match(f66, /grant execute on function public\.certificate_email_recheck\(uuid, text\) to service_role/);
  assert.doesNotMatch(f66, /certificate_email_recheck\(uuid\)/);
  assert.match(fnBody(f65, 'certificate_email_complete'), /elsif v_c\.status <> 'valid' then[\s\S]*'cancelled'/);
  assert.match(fnBody(f65, 'certificate_email_release_stale'), /'stale_sending'/);
  // الطابور لا يخزّن نصًّا حرًّا للأخطاء
  assert.match(f63, /last_error_code text check \(last_error_code is null or last_error_code ~ '\^\[a-z0-9_\]\{1,40\}\$'\)/);
  assert.match(fnBody(f65, 'certificate_email_complete'), /v_code !~ '\^\[a-z0-9_\]\{1,40\}\$'/);
});

test('البريد: رابط آمن لا مرفق PDF، ولا مفاتيح مزوّد في الملفات', () => {
  assert.doesNotMatch(all, /attachment|pdf_base64|bytea\s+.*pdf/i);
  assert.doesNotMatch(all, /api[_-]?key|resend|sendgrid|smtp_password|service_role_key/i);
  assert.doesNotMatch(f63, /storage\.|create bucket/i);   // لا تخزين دائم لملفات PDF
});

test('Audit: audit_logs القائم دون أي تعديل على بنيته؛ بلا PII؛ كل العمليات الأساسية مغطّاة', () => {
  assert.doesNotMatch(all, /alter table public\.audit_logs|drop trigger[^;]*audit_logs|create trigger[^;]*on public\.audit_logs|disable trigger/i);
  assert.match(fnBody(f63, 'certificate_audit'), /insert into public\.audit_logs \(user_id, action, entity_type, entity_id, description, metadata\)/);
  assert.match(fnBody(f63, 'certificate_audit'), /\?\| array\['email'[\s\S]*'member_id'[\s\S]*'reason'/);
  for (const a of ['certificate_campaign_created', 'certificate_campaign_issued', 'certificate_revoked', 'certificate_campaign_archived',
    'certificate_privacy_changed', 'certificate_secret_rotated', 'certificate_email_sent', 'certificate_email_enqueued', 'certificate_token_reissued'])
    assert.ok(all.includes(`'${a}'`), a);
  // لا metadata بمفاتيح حسّاسة في أي استدعاء
  const calls = all.match(/certificate_audit\([\s\S]*?\);/g) || [];
  assert.ok(calls.length >= 18, `عدد استدعاءات audit ${calls.length}`);
  for (const c of calls) assert.doesNotMatch(c, /jsonb_build_object\([^;]*'(email|name|token|secret|member_id|reason|display_name)'/, c);
});

test('الحماية: snapshots والإلغاء والطابور والسجلات (مشغّلات)', () => {
  for (const t of ['certificate_campaigns_guard', 'certificates_guard', 'certificate_recipients_guard', 'certificate_email_queue_guard', 'certificate_email_logs_guard'])
    assert.match(f63, new RegExp(`create trigger trg_${t}`), t);
  assert.match(f63, /certificate_snapshot_immutable/);
  assert.match(f63, /certificate_revoked_is_final/);
  assert.match(f63, /certificate_email_logs_append_only/);
  assert.match(f63, /certificate_campaign_invalid_transition/);
  assert.match(f63, /certificate_campaign_locked_after_draft/);
});

test('Rollback: لا يحذف بيانات ولا يمسّ جداول النظام؛ يرفض عند وجود بيانات', () => {
  assert.match(down63, /raise exception 'رُفض الرجوع/);
  assert.match(down63, /exists \(select 1 from public\.certificates\)/);
  assert.match(down63, /exists \(select 1 from public\.certificate_templates where not is_system\)/);
  assert.doesNotMatch(down63 + down64 + down65, /drop table[^;]*\b(audit_logs|members|activities|profiles|activity_attendance)\b/);
  assert.doesNotMatch(down63 + down64 + down65, /\b(delete from|truncate)\b/i);
  assert.doesNotMatch(down63 + down64 + down65, /drop (extension|type)|alter type/i);
  for (const t of TABLES) assert.match(down63, new RegExp(`drop table if exists public\\.${t};`), t);
  assert.match(down64, /exists \(select 1 from public\.certificates\)/);
  assert.match(down65, /status in \('queued', 'sending'\)/);
  assert.match(down66, /drop function if exists public\.certificate_email_recheck\(uuid, text\)/);
  assert.doesNotMatch(down66, /create or replace function public\.certificate_email_recheck\(uuid\)/);
});

test('0063→0066 لا تمسّ security-hardening ولا ملفات قائمة، وتنتهي بـ commit', () => {
  for (const f of ['0063_certificates_schema', '0064_certificates_admin_functions', '0065_certificates_email_queue', '0066_certificates_email_token_recheck']) {
    const src = stripSql(read(`supabase/migrations/${f}.sql`)).trim();
    assert.match(src, /^begin;/);
    assert.match(src, /commit;$/);
  }
  assert.doesNotMatch(all, /security-hardening/);
  assert.doesNotMatch(all, /drop (table|function|policy|trigger)[^;]*\b(profiles|members|audit_logs|member_accounts|activities)\b/i);
  assert.doesNotMatch(all, /create or replace function public\.(set_updated_at|prevent_audit_log_update)\(/);
});

test('ملفات الاختبار والتوثيق موجودة', () => {
  for (const p of ['supabase/tests/certificates_smoke.sql', 'docs/CERTIFICATES_DB.md', 'PHASE_1_HANDOFF.md'])
    assert.ok(fs.existsSync(new URL(`../${p}`, import.meta.url)), p);
  const smoke = read('supabase/tests/certificates_smoke.sql');
  assert.match(smoke, /^[\s\S]*begin;[\s\S]*rollback;\s*$/);
  assert.doesNotMatch(stripSql(smoke), /\bcommit;/);
});
