import './helpers/esm-mocks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const f65 = stripSql(read('supabase/migrations/0065_certificates_email_queue.sql'));
const f66 = stripSql(read('supabase/migrations/0066_certificate_email_worker_guard.sql'));
const down66 = stripSql(read('supabase/rollback/0066_certificate_email_worker_guard_down.sql'));
const fnBody = (src, name, sig = '') => {
  const i = src.indexOf(`function public.${name}(${sig}`);
  assert.ok(i > -1, `${name}(${sig})`);
  const j = src.indexOf('create or replace function', i + 10);
  return src.slice(i, j > -1 ? j : src.length);
};

// ------------------------------------------------------------------ 0066
test('0066: ملف جديد متسلسل بعد 0065 مع rollback، ويبدأ بـ begin وينتهي بـ commit، ولا يعدّل الملفات القديمة', () => {
  const nums = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((x) => /^\d{4}_.*\.sql$/.test(x)).map((x) => x.slice(0, 4));
  assert.equal(new Set(nums).size, nums.length);
  assert.ok(nums.includes('0066'));
  const src = f66.trim();
  assert.match(src, /^begin;/);
  assert.match(src, /commit;$/);
  assert.match(down66.trim(), /^begin;/);
  // 0065 ما زالت بتوقيعاتها الأصلية (لم تُعدَّل)
  assert.match(f65, /function public\.certificate_email_recheck\(p_queue_id uuid\)/);
  assert.match(f65, /function public\.certificate_email_complete\(p_queue_id uuid, p_success boolean, p_error_code text default null\)/);
});

test('0066: recheck يتحقق من claimed_by = هوية العامل (fail-closed) وصلاحية الشهادة والبريد', () => {
  const b = fnBody(f66, 'certificate_email_recheck', 'p_queue_id uuid, p_worker text');
  assert.match(b, /q\.claimed_by = p_worker/);
  assert.match(b, /q\.status = 'sending'/);
  assert.match(b, /c\.status = 'valid'/);
  assert.match(b, /c\.recipient_email is not null/);
  assert.match(b, /p_worker !~ '\^\[a-z0-9_:-\]\{1,60\}\$'[\s\S]*return false/);
  assert.match(b, /\bstable\b/);
});

test('0066: complete يرفض غير الحاجز (42501) ويحافظ على ترتيب الأقفال وقواعد 0065', () => {
  const b = fnBody(f66, 'certificate_email_complete', 'p_queue_id uuid, p_worker text');
  assert.match(b, /claimed_by is distinct from p_worker[\s\S]*certificate_email_worker_mismatch[\s\S]*42501/);
  assert.ok(b.indexOf('from public.certificates where id = v_cert for share') < b.indexOf('from public.certificate_email_queue where id = p_queue_id for update'), 'الشهادة ثم الطابور');
  assert.ok(b.indexOf("v_q.status <> 'sending'") < b.indexOf('worker_mismatch'));
  assert.match(b, /elsif v_c\.status <> 'valid' then[\s\S]*'cancelled'/);
  assert.match(b, /v_code !~ '\^\[a-z0-9_\]\{1,40\}\$'/);
  assert.match(b, /make_interval\(mins => v_q\.attempts \* v_q\.attempts\)/);
  assert.match(b, /revoked_during_send/);
  assert.doesNotMatch(b, /recipient_email|to_email/, 'لا بريد في complete');
});

test('0066: يحذف التوقيعين القديمين غير المحروسين', () => {
  assert.match(f66, /drop function if exists public\.certificate_email_recheck\(uuid\);/);
  assert.match(f66, /drop function if exists public\.certificate_email_complete\(uuid, boolean, text\);/);
});

test('0066: EXECUTE — service_role فقط لدوال العامل الأربع، مع فحص نهائي يُسقط الـ migration عند أي تسرّب', () => {
  for (const sig of ['certificate_email_recheck(uuid, text)', 'certificate_email_complete(uuid, text, boolean, text)', 'certificate_email_claim_next(text)', 'certificate_email_release_stale(integer)']) {
    const esc = sig.replace(/[().,]/g, (c) => `\\${c}`).replace(/ /g, '\\s+');
    assert.match(f66, new RegExp(`revoke all on function public\\.${esc}\\s+from public, anon, authenticated;`), `revoke ${sig}`);
    assert.match(f66, new RegExp(`grant execute on function public\\.${esc}\\s+to service_role;`), `grant ${sig}`);
  }
  assert.doesNotMatch(f66, /grant [^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  assert.match(f66, /has_function_privilege\(v_role, v_sig, 'EXECUTE'\)[\s\S]*raise exception/);
  assert.match(f66, /array\['anon', 'authenticated'\]/);
  // دوال الإدارة تبقى لـ authenticated فقط ولم تُمسّ
  assert.match(f65, /grant execute on function public\.certificate_enqueue_campaign_emails\(uuid\)\s+to authenticated;/);
  assert.doesNotMatch(f66, /certificate_enqueue|certificate_retry_email/);
});

test('0066: لا يمسّ RLS ولا Auth ولا الجداول ولا security hardening', () => {
  assert.doesNotMatch(f66, /row level security|create policy|drop policy|alter table|create table|drop table|auth\.|security-hardening/i);
  assert.doesNotMatch(f66, /\bdelete\s+from\b/i);
  const inserts = [...f66.matchAll(/insert into ([a-z_.]+)/gi)].map((m) => m[1]);
  assert.ok(inserts.length > 0 && inserts.every((t) => t === 'public.certificate_email_logs'), `إدراج في جدول غير سجلّ البريد: ${inserts}`);
});

test('0066 (rollback): يعيد التوقيعين القديمين ويرفض مع مهام sending', () => {
  assert.match(down66, /status = 'sending'[\s\S]*raise exception/);
  assert.match(down66, /function public\.certificate_email_recheck\(p_queue_id uuid\)/);
  assert.match(down66, /function public\.certificate_email_complete\(p_queue_id uuid, p_success boolean, p_error_code text default null\)/);
  assert.match(down66, /grant execute on function public\.certificate_email_recheck\(uuid\)\s+to service_role;/);
  assert.doesNotMatch(down66, /\bgrant\b[^;]*\bto\s+(anon|authenticated|public)\b/i);
});

test('العامل ↔ SQL: أسماء الدوال ووسائطها في core.ts تطابق 0065/0066', () => {
  const core = read('supabase/functions/certificate-email-worker/core.ts');
  const used = [...core.matchAll(/d\.rpc\('(certificate_email_[a-z_]+)', \{([^}]*)\}/g)].map((m) => [m[1], [...m[2].matchAll(/(p_[a-z_]+)/g)].map((x) => x[1])]);
  const byFn = Object.fromEntries(used);
  assert.deepEqual(Object.keys(byFn).sort(), ['certificate_email_claim_next', 'certificate_email_complete', 'certificate_email_recheck', 'certificate_email_release_stale']);
  assert.deepEqual(byFn.certificate_email_claim_next, ['p_worker']);
  assert.deepEqual(byFn.certificate_email_recheck, ['p_queue_id', 'p_worker']);
  assert.deepEqual(byFn.certificate_email_complete, ['p_queue_id', 'p_worker', 'p_success', 'p_error_code']);
  assert.deepEqual(byFn.certificate_email_release_stale, ['p_older_than_minutes']);
  // أسماء المعاملات موجودة فعلًا في تعريفات SQL
  assert.match(f65, /certificate_email_claim_next\(p_worker text/);
  assert.match(f66, /certificate_email_recheck\(p_queue_id uuid, p_worker text\)/);
  assert.match(f66, /certificate_email_complete\(p_queue_id uuid, p_worker text, p_success boolean, p_error_code text default null\)/);
  assert.match(f65, /certificate_email_release_stale\(p_older_than_minutes integer/);
  // مفاتيح حمولة claim_next التي يقرؤها العامل موجودة في 0065
  const claim = fnBody(f65, 'certificate_email_claim_next');
  for (const k of ['queue_id', 'to_email', 'recipient_name', 'certificate_number', 'certificate_type', 'language', 'campaign_title', 'token']) assert.ok(claim.includes(`'${k}'`), k);
});

// ------------------------------------------------------------------ واجهة الإدارة
test('واجهة الجدولة: RPC certificate_enqueue_campaign_emails بوسيط الحملة فقط، دون إرسال من المتصفح', async () => {
  const { enqueueCampaignEmails } = await import('../src/services/supabase/certificateEmail.service.js');
  const calls = [];
  globalThis.__supabaseMock = { rpc: async (...a) => { calls.push(a); return { data: 7, error: null }; } };
  assert.equal(await enqueueCampaignEmails('c-1'), 7);
  assert.deepEqual(calls[0], ['certificate_enqueue_campaign_emails', { p_campaign_id: 'c-1' }]);
  globalThis.__supabaseMock = { rpc: async () => ({ data: 0, error: null }) };
  assert.equal(await enqueueCampaignEmails('c-1'), 0);
  globalThis.__supabaseMock = { rpc: async () => ({ data: null, error: Object.assign(new Error('certificate_campaign_not_found'), { code: 'P0002' }) }) };
  await assert.rejects(enqueueCampaignEmails('c-1'), (e) => e.message === 'certificate_campaign_not_found');
  assert.match(f65, /function public\.certificate_enqueue_campaign_emails\(p_campaign_id uuid\)\s+returns integer/);
});

test('واجهة الجدولة: الصفحة تعرض الزر للإدارة فقط، تؤكد قبل الجدولة، تعرض العدد، ولا تستدعي fetch/functions', () => {
  const page = stripJs(read('src/pages/admin/CertificateCampaignDetail.jsx'));
  assert.match(page, /import \{ enqueueCampaignEmails \} from '\.\.\/\.\.\/services\/supabase\/certificateEmail\.service'/);
  assert.match(page, /\{canManage && \(\s*<>\s*<div className="admin-quick-actions">\s*<button[\s\S]*?setDialog\(\{ type: 'email' \}\)/);
  assert.match(page, /dialog\?\.type === 'email'[\s\S]*ConfirmModal[\s\S]*enqueueCampaignEmails\(campaign\.id\)/);
  assert.match(page, /admin\.certificates\.email\.ok', \{ count: n \}/);
  assert.match(page, /admin\.certificates\.email\.last', \{ count: queuedEmails \}/);
  assert.match(page, /disabled=\{emailable\.length === 0 \|\| busy\}/);
  assert.doesNotMatch(page, /fetch\(|functions\.invoke|resend|api\.resend/i);
  // الصالحة ذات البريد فقط
  assert.match(page, /bulkEligible\(recipients\)\.filter\(\(r\) => !!r\.email\)/);
  // الخدمة لا تُرسل ولا تمسّ جدول الطابور مباشرة
  const svc = stripJs(read('src/services/supabase/certificateEmail.service.js'));
  assert.doesNotMatch(svc, /\.from\(|fetch\(|functions\.invoke|certificate_email_queue/);
});

test('واجهة الجدولة: لا تغيير في صلاحيات الأدوار (ROLES_CERT_*) ولا في خدمة الإدارة الأصلية', () => {
  const roles = read('src/constants/roles.js');
  assert.match(roles, /ROLES_CERT_MANAGE/);
  const adminSvc = read('src/services/supabase/adminCertificates.service.js');
  assert.doesNotMatch(adminSvc, /certificate_enqueue|certificate_email/);
});

test('واجهة الجدولة: مفاتيح الترجمة الثلاث كاملة', () => {
  const keys = ['button', 'title', 'body', 'confirm', 'hint', 'none', 'ok', 'okNone', 'failed', 'last'];
  for (const l of ['ar', 'fr', 'en']) {
    const d = JSON.parse(read(`src/i18n/locales/${l}.json`));
    for (const k of keys) assert.ok(typeof d.admin.certificates.email[k] === 'string' && d.admin.certificates.email[k].length > 0, `${l}.${k}`);
    assert.match(d.admin.certificates.email.body, /\{\{count\}\}/);
    assert.match(d.admin.certificates.email.ok, /\{\{count\}\}/);
  }
});
