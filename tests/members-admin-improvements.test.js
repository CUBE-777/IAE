import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { csvCell } from '../src/utils/csvExport.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');

test('csvCell: يمنع حقن الصيغ ويُبقي الأرقام (حتى السالبة) كما هي', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  for (const v of ['+cmd', '@sum', '-cmd', '\tx']) assert.ok(csvCell(v).startsWith(`"'`), v);
  assert.equal(csvCell('-500'), '"-500"');
  assert.equal(csvCell('+212 600-000000'), '"+212 600-000000"'); // هاتف لا يُشوَّه
  assert.equal(csvCell(1200.5), '"1200.5"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('مراكش'), '"مراكش"');
});

test('0044: اعتماد/رفض الطلب يفحصان updated_at ويُسقطان التوقيعين القديمين', () => {
  const sql = stripSql(read('supabase/migrations/0044_card_request_review_race.sql'));
  assert.match(sql, /drop function if exists public\.approve_member_card_request\(uuid, text\)/);
  assert.match(sql, /drop function if exists public\.reject_member_card_request\(uuid, text\)/);
  assert.equal((sql.match(/p_expected_updated_at is not null and v_r\.updated_at is distinct from p_expected_updated_at/g) || []).length, 2);
  assert.match(sql, /grant execute on function public\.approve_member_card_request\(uuid, text, timestamptz\) to authenticated/);
  assert.match(sql, /grant execute on function public\.reject_member_card_request\(uuid, text, timestamptz\)\s+to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*to[^;]*\banon\b/);
  assert.doesNotMatch(sql, /\{\d+,\d{3,}\}/);
});

test('الواجهة تمرّر updated_at عند الاعتماد والرفض', () => {
  const svc = read('src/services/supabase/memberSpace.service.js');
  assert.match(svc, /created_at, updated_at,/);
  assert.match(svc, /p_expected_updated_at: expectedUpdatedAt/);
  const modal = read('src/pages/admin/MemberCardRequestsModal.jsx');
  assert.match(modal, /approveCardRequest\(request\.id, publicUrl, request\.updated_at, \[\.\.\.skip\]\)/);
  assert.match(modal, /rejectCardRequest\(request\.id, note\.trim\(\), request\.updated_at\)/);
});

import { pageWindow } from '../src/utils/pagination.js';

test('pageWindow: ترقيم مختصر بالأولى والأخيرة وما حول الحالية', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(7, 20), [1, '…', 6, 7, 8, '…', 20]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, '…', 20]);
  assert.deepEqual(pageWindow(20, 20), [1, '…', 19, 20]);
  assert.deepEqual(pageWindow(4, 20), [1, 2, 3, 4, 5, '…', 20]);
  assert.deepEqual(pageWindow(1, 0), []);
  assert.deepEqual(pageWindow(99, 3), [1, 2, 3]);
});

test('المحذوفون: استعلام للمسؤولين واسترجاع بتسجيل في سجل التدقيق، وواجهة تمرّر deleted', () => {
  const svc = read('src/services/supabase/adminMembers.service.js');
  assert.match(svc, /deleted \? query\.not\('deleted_at', 'is', null\) : query\.is\('deleted_at', null\)/);
  assert.match(svc, /update\(\{ deleted_at: null \}\)/);
  assert.match(svc, /ADMIN_RESTORED_MEMBER/);
  const page = read('src/pages/admin/Members.jsx');
  assert.match(page, /deleted: showDeleted/);
  assert.match(page, /doRestore\(m\)/);
  assert.match(page, /pageWindow\(page, totalPages\)/);
});

const sql45 = () => stripSql(read('supabase/migrations/0045_partial_approval_cancel_membership.sql'));

test('0045: القبول الجزئي — قائمة بيضاء للمفاتيح، ورفض غير المعروف، وتدوين المستثنى في التدقيق', () => {
  const sql = sql45();
  assert.match(sql, /drop function if exists public\.approve_member_card_request\(uuid, text, timestamptz\)/);
  assert.match(sql, /p_skip_fields text\[\] default null/);
  for (const k of ['university', 'promotion', 'track', 'public_bio', 'study_path', 'socials', 'extra', 'profession', 'show_in_directory', 'name_latin']) {
    assert.ok(sql.includes(`'${k}'`), k);
  }
  assert.match(sql, /\(fr\|en\)\\\.\(track\|public_bio\|study_path\|extra\)/);
  assert.match(sql, /raise exception 'حقل غير معروف/);
  assert.match(sql, /'skipped_fields'/);
  // لا يزال فحص السباق قائمًا
  assert.match(sql, /p_expected_updated_at is not null and v_r\.updated_at is distinct from p_expected_updated_at/);
  assert.match(sql, /grant execute on function public\.approve_member_card_request\(uuid, text, timestamptz, text\[\]\) to authenticated/);
});

test('0045: إلغاء الانخراط — صلاحية، سبب إلزامي، إلغاء الإيراد (لا حذف) وتدقيق', () => {
  const sql = sql45();
  const i = sql.indexOf('function public.cancel_member_membership(');
  assert.ok(i >= 0);
  const body = sql.slice(i, sql.indexOf('$$;', sql.indexOf('as $$', i)));
  assert.match(body, /security definer/);
  assert.match(body, /not public\.can_handle_membership\(\)/);
  assert.match(body, /char_length\(v_reason\) < 3/);
  assert.match(body, /update public\.budget_transactions\s+set status = 'voided', void_reason = v_reason/);
  assert.doesNotMatch(body, /delete from public\.budget_transactions/);
  assert.match(body, /delete from public\.member_memberships/);
  assert.match(body, /ADMIN_CANCELLED_MEMBERSHIP/);
  assert.match(sql, /revoke all on function public\.cancel_member_membership\(uuid, text\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*cancel_member_membership[^;]*anon/);
  assert.match(sql, /add column if not exists notified_at timestamptz/);
});

test('دالة الإشعار: تتحقق من الهوية والدور، لا تأخذ البريد من العميل، وتحجز الإرسال مرة واحدة', () => {
  const src = read('supabase/functions/notify-member-card-request/index.ts');
  assert.match(src, /auth\.getUser\(token\)/);
  assert.match(src, /rpc\('can_manage_member_system'\)/);
  assert.doesNotMatch(src, /body\??\.(email|to)\b/);
  assert.match(src, /\.is\('notified_at', null\)/);
  assert.match(src, /FRESH_MS/);
  assert.match(src, /reason: 'not_configured'/);
  assert.match(src, /const esc = /);
  assert.match(read('supabase/config.toml'), /\[functions\.notify-member-card-request\]\s+verify_jwt = false/);
});

test('الواجهة: قبول جزئي وإشعار وتجديد جماعي وإلغاء انخراط وسجل الطلبات', () => {
  const svc = read('src/services/supabase/memberSpace.service.js');
  assert.match(svc, /p_skip_fields:/);
  assert.match(svc, /export async function notifyCardRequestOutcome/);
  assert.match(svc, /export async function fetchMemberCardRequests/);
  const flow = read('src/services/supabase/membershipFlow.service.js');
  assert.match(flow, /rpc\('cancel_member_membership', \{ p_membership_id: membershipId, p_reason: reason \}\)/);
  assert.match(flow, /select\('id, season, amount, paid_at'\)/);
  const page = read('src/pages/admin/Members.jsx');
  assert.match(page, /doBulkRenew/);
  assert.match(page, /doCancelMembership/);
  assert.match(page, /h\.id && canMemberSystem/);
  assert.match(page, /setInterval\(tick, 60000\)/);
  const modal = read('src/pages/admin/MemberCardRequestsModal.jsx');
  assert.match(modal, /notifyMember\(request\.id\)/);
  assert.match(modal, /approveAllText/);
  assert.match(modal, /nothingToApply/);
});
