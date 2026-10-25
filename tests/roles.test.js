import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/constants/roles.js';
import { ADMIN_NAV } from '../src/constants/adminNav.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const quoted = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const sorted = (a) => [...a].sort();

const router = read('src/app/router/index.jsx');
const sql0012 = read('supabase/migrations/0012_budget_and_developer_role.sql');
const sql0019 = read('supabase/migrations/0019_new_roles_and_file_delete_fix.sql');

/** مسار → مجموعة الأدوار كما يستعملها الراوتر ([] = أي مسؤول). */
const routeRoles = {};
for (const m of router.matchAll(/path: '(\/admin\/[a-z-]+)', element: protectedAdmin\((\[\]|ROLES_[A-Z_]+),/g)) {
  routeRoles[m[1]] = m[2] === '[]' ? [] : R[m[2]];
  assert.ok(m[2] === '[]' || Array.isArray(R[m[2]]), `${m[2]} غير معرّف في constants/roles.js`);
}

const sqlFn = (sql, fn) => {
  const m = sql.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?in \\(([^)]*)\\)`));
  assert.ok(m, `الدالة ${fn} غير موجودة`);
  return quoted(m[1]);
};

test('الأدوار: مجموعات الواجهة مطابقة لدوال RLS في SQL', () => {
  assert.deepEqual(sorted(R.ROLES_MEMBERS), sorted(sqlFn(sql0019, 'can_manage_members')));
  assert.deepEqual(sorted(R.ROLES_REQUESTS), sorted(sqlFn(sql0019, 'can_handle_membership')));
  assert.deepEqual(sorted(R.ROLES_CONTENT), sorted(sqlFn(sql0019, 'can_manage_content')));
  assert.deepEqual(sorted(R.ROLES_INTERNAL_FILES), sorted(sqlFn(sql0019, 'can_access_internal_files')));
  assert.deepEqual(sorted(R.ROLES_BUDGET), sorted(sqlFn(sql0019, 'can_manage_budget')));
  assert.deepEqual(sorted(R.ROLES_SUPER), sorted(sqlFn(sql0012, 'is_super_admin')));
});

test('الأدوار: كل مسارات /admin معرّفة، وقائمة التنقل تطابق الراوتر', () => {
  assert.ok(Object.keys(routeRoles).length >= 15, 'عدد مسارات الإدارة أقل من المتوقع');
  for (const item of ADMIN_NAV.filter((i) => i.href)) {
    assert.ok(item.href in routeRoles, `${item.href} في القائمة وليس في الراوتر`);
    assert.deepEqual(sorted(item.roles), sorted(routeRoles[item.href]), `أدوار ${item.href} تختلف بين القائمة والراوتر`);
  }
});

test('الأدوار: ALL_ROLES = enum القاعدة = Edge Function = ROLE_LABELS', () => {
  const enumBase = quoted(read('supabase/migrations/0001_extensions_and_types.sql').match(/create type admin_role as enum \(([^)]*)\)/)[1]);
  const added = [...(sql0012 + sql0019).matchAll(/alter type admin_role add value if not exists '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(sorted(R.ALL_ROLES), sorted([...enumBase, ...added]), 'ALL_ROLES ≠ قيم admin_role في SQL');

  const edge = read('supabase/functions/admin-create-user/index.ts').match(/const ALLOWED_ROLES = \[([\s\S]*?)\];/)[1];
  assert.deepEqual(sorted(quoted(edge)), sorted(R.ALL_ROLES), 'ALLOWED_ROLES في Edge Function ≠ ALL_ROLES');

  const labels = read('src/services/supabase/auth.service.js').match(/export const ROLE_LABELS = \{([\s\S]*?)\};/)[1];
  const labelKeys = [...labels.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(sorted(labelKeys), sorted(R.ALL_ROLES), 'ROLE_LABELS ≠ ALL_ROLES');

  for (const group of [R.ROLES_MEMBERS, R.ROLES_REQUESTS, R.ROLES_CONTENT, R.ROLES_INTERNAL_FILES, R.ROLES_BUDGET, R.ROLES_SUPER]) {
    for (const role of group) assert.ok(R.ALL_ROLES.includes(role), `دور غير معروف: ${role}`);
  }
});
