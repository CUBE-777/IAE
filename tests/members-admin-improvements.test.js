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
  assert.match(modal, /approveCardRequest\(request\.id, publicUrl, request\.updated_at\)/);
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
