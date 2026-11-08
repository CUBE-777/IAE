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
