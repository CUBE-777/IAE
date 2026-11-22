import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_DICT } from '../src/i18n/adminDict.data.js';
import {
  GAMES_STATUS,
  GAMES_STATUS_KEY,
  createGamesStatusStore,
  isMissingStatusFunction,
  normalizeGamesStatus,
} from '../src/features/games/maintenance/gamesStatusCore.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (sql) => sql.replace(/--.*$/gm, '');
const listDir = (p) => fs.readdirSync(new URL(`../${p}`, import.meta.url));
const tick = () => new Promise((r) => setImmediate(r));

// ───────────────────────── 1) منطق الحالة والمخزن ─────────────────────────

test('normalizeGamesStatus: maintenance صراحةً فقط؛ أي شيء آخر = enabled (مطابق لـ games_section_enabled في SQL)', () => {
  assert.equal(normalizeGamesStatus('maintenance'), 'maintenance');
  assert.equal(normalizeGamesStatus('  Maintenance '), 'maintenance');
  for (const v of ['enabled', '', null, undefined, 'garbage', 0, {}]) assert.equal(normalizeGamesStatus(v), 'enabled');
  assert.equal(GAMES_STATUS_KEY, 'games_section_status');
});

test('isMissingStatusFunction: يتعرّف على غياب الدالة (واجهة نُشرت قبل 0062) لا على أخطاء الشبكة', () => {
  assert.equal(isMissingStatusFunction({ code: 'PGRST202' }), true);
  assert.equal(isMissingStatusFunction({ code: '42883' }), true);
  assert.equal(isMissingStatusFunction({ message: 'Could not find the function public.get_games_section_status' }), true);
  assert.equal(isMissingStatusFunction({ message: 'Failed to fetch' }), false);
  assert.equal(isMissingStatusFunction({ code: '42501' }), false);
  assert.equal(isMissingStatusFunction(null), false);
});

function makeStore(overrides = {}) {
  const calls = { fetch: 0, listenOn: 0, listenOff: 0, timers: [], cleared: 0, visOn: 0, visOff: 0 };
  let onChange = () => {};
  let visible = true;
  let visCb = () => {};
  let responder = overrides.responder || (async () => 'enabled');
  const store = createGamesStatusStore({
    fetchStatus: () => { calls.fetch += 1; return responder(); },
    listen: (cb) => { calls.listenOn += 1; onChange = cb; return () => { calls.listenOff += 1; }; },
    pollMs: 1000,
    isVisible: () => visible,
    addVisibilityListener: (cb) => { calls.visOn += 1; visCb = cb; return () => { calls.visOff += 1; }; },
    setTimer: (fn) => { calls.timers.push(fn); return calls.timers.length; },
    clearTimer: () => { calls.cleared += 1; },
  });
  return {
    store, calls,
    emitRealtime: () => onChange(),
    poll: () => calls.timers[calls.timers.length - 1]?.(),
    setResponder: (fn) => { responder = fn; },
    setVisible: (v) => { visible = v; },
    visibility: () => visCb(),
  };
}

test('المخزن: loading ثم ready=enabled — الألعاب تعمل عند التفعيل', async () => {
  const h = makeStore();
  assert.deepEqual(h.store.getSnapshot(), { phase: 'loading', status: null });
  const unsub = h.store.subscribe(() => {});
  await tick();
  assert.deepEqual(h.store.getSnapshot(), { phase: 'ready', status: 'enabled' });
  unsub();
});

test('المخزن: maintenance يُلتقط، وإعادة التفعيل تُرجع enabled (Realtime ثم المؤقّت)', async () => {
  const h = makeStore({ responder: async () => 'maintenance' });
  const seen = [];
  const unsub = h.store.subscribe(() => seen.push(h.store.getSnapshot().status));
  await tick();
  assert.equal(h.store.getSnapshot().status, 'maintenance');
  h.setResponder(async () => 'enabled');
  h.emitRealtime(); // مسؤول أعاد التفعيل
  await tick();
  assert.equal(h.store.getSnapshot().status, 'enabled');
  h.setResponder(async () => 'maintenance');
  h.poll(); // وفي حال فشل Realtime: المؤقّت يلتقط
  await tick();
  assert.equal(h.store.getSnapshot().status, 'maintenance');
  assert.deepEqual(seen, ['maintenance', 'enabled', 'maintenance']);
  unsub();
});

test('المخزن: خطأ أول جلب ⇒ error (لا enabled ولا maintenance مُختلقة)، وretry يستعيد', async () => {
  const origErr = console.error; console.error = () => {};
  try {
    let fail = true;
    const h = makeStore({ responder: async () => { if (fail) throw new Error('network'); return 'maintenance'; } });
    const unsub = h.store.subscribe(() => {});
    await tick();
    assert.deepEqual(h.store.getSnapshot(), { phase: 'error', status: null });
    fail = false;
    const p = h.store.retry();
    assert.equal(h.store.getSnapshot().phase, 'loading');
    await p;
    assert.deepEqual(h.store.getSnapshot(), { phase: 'ready', status: 'maintenance' });
    unsub();
  } finally { console.error = origErr; }
});

test('المخزن: فشل لاحق (شبكة) يُبقي آخر حالة معروفة — لا وميض ولا فتح/غلق خاطئ', async () => {
  const origErr = console.error; console.error = () => {};
  try {
    const h = makeStore({ responder: async () => 'maintenance' });
    const unsub = h.store.subscribe(() => {});
    await tick();
    h.setResponder(async () => { throw new Error('offline'); });
    h.poll();
    await tick();
    assert.deepEqual(h.store.getSnapshot(), { phase: 'ready', status: 'maintenance' });
    unsub();
  } finally { console.error = origErr; }
});

test('المخزن: حدث Realtime أثناء جلب جارٍ لا يضيع (يُعاد الجلب مرة واحدة بعد انتهائه)', async () => {
  let release;
  let n = 0;
  const h = makeStore({ responder: () => { n += 1; if (n === 1) return new Promise((r) => { release = () => r('enabled'); }); return Promise.resolve('maintenance'); } });
  const unsub = h.store.subscribe(() => {});
  await tick();                 // الجلب الأول معلّق (سبق التغيير في القاعدة)
  h.emitRealtime();             // وصل حدث التغيير أثناءه
  h.emitRealtime();             // تكراره لا يضاعف الجلب
  release();
  await tick(); await tick();
  assert.equal(h.calls.fetch, 2);
  assert.equal(h.store.getSnapshot().status, 'maintenance');
  unsub();
});

test('المخزن: المؤقّت لا يجلب والتبويب مخفي، وعودة التبويب تجلب؛ وآخر مشترك يوقف كل شيء', async () => {
  const h = makeStore();
  const unsub = h.store.subscribe(() => {});
  await tick();
  assert.equal(h.calls.fetch, 1);
  h.setVisible(false);
  h.poll(); await tick();
  assert.equal(h.calls.fetch, 1);
  h.setVisible(true);
  h.visibility(); await tick();
  assert.equal(h.calls.fetch, 2);
  unsub();
  assert.equal(h.calls.cleared, 1);
  assert.equal(h.calls.listenOff, 1);
  assert.equal(h.calls.visOff, 1);
});

test('المخزن: مشتركون متعددون = جلب وقناة Realtime واحدة فقط (مناسب للطبقة المجانية)', async () => {
  const h = makeStore();
  const u1 = h.store.subscribe(() => {});
  const u2 = h.store.subscribe(() => {});
  const u3 = h.store.subscribe(() => {});
  await tick();
  assert.equal(h.calls.fetch, 1);
  assert.equal(h.calls.listenOn, 1);
  u1(); u2();
  assert.equal(h.calls.listenOff, 0);
  u3();
  assert.equal(h.calls.listenOff, 1);
});

// ───────────────────────── 2) SQL (0062) ─────────────────────────

const rawUp = read('supabase/migrations/0062_games_maintenance_mode.sql');
const up = stripSql(rawUp);
const down = stripSql(read('supabase/rollback/0062_games_maintenance_mode_down.sql'));
const fnBody = (src, name) => {
  const m = src.match(new RegExp(`function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`));
  assert.ok(m, `الدالة ${name} غير معرّفة`);
  return m[1];
};

test('0062: الترقيم وملف الرجوع وملف الفحص السلوكي', () => {
  assert.deepEqual(listDir('supabase/migrations').filter((f) => f.startsWith('0062_')), ['0062_games_maintenance_mode.sql']);
  assert.ok(listDir('supabase/rollback').includes('0062_games_maintenance_mode_down.sql'));
  assert.ok(listDir('supabase/tests').includes('games_maintenance_smoke.sql'));
});

test('0062: لا جداول ولا أعمدة ولا سياسات جديدة ولا حذف/تعديل لبيانات الألعاب أو المستخدمين', () => {
  assert.doesNotMatch(up, /\bcreate\s+table\b/i);
  assert.doesNotMatch(up, /\balter\s+table\b/i);
  assert.doesNotMatch(up, /\b(create|drop|alter)\s+policy\b/i);
  assert.doesNotMatch(up, /\b(delete\s+from|truncate)\b/i);
  assert.doesNotMatch(up, /\bupdate\s+public\./i);
  assert.doesNotMatch(up, /\bdrop\s+(table|function|policy|type)\b/i);
  // الإدراج الوحيد: صف المفتاح في site_settings، ولا يطغى على قيمة موجودة
  const inserts = [...up.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(inserts, ['site_settings']);
  assert.match(up, /values \('games_section_status', 'enabled'\)\s*on conflict \(key\) do nothing/);
  for (const t of ['games', 'game_attempts', 'game_results', 'game_points', 'game_challenges', 'profiles', 'members']) {
    assert.doesNotMatch(up, new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+public\\.${t}\\b`, 'i'));
  }
});

test('0062: لا تُعاد كتابة سياسات site_settings (الكتابة تبقى لـ is_super_admin عبر 0003)', () => {
  const rls = stripSql(read('supabase/migrations/0003_rls_policies.sql'));
  assert.match(rls, /site_settings_insert_super_admin[\s\S]*?is_super_admin\(\)/);
  assert.match(rls, /site_settings_update_super_admin[\s\S]*?is_super_admin\(\)/);
  assert.match(rls, /site_settings_delete_super_admin[\s\S]*?is_super_admin\(\)/);
  const dev = stripSql(read('supabase/migrations/0012_budget_and_developer_role.sql'));
  assert.match(dev, /function public\.is_super_admin\(\)[\s\S]*?in \('super_admin', 'developer'\)/);
});

test('0062: مشغّل التحقق يقبل enabled/maintenance فقط لهذا المفتاح وحده', () => {
  const body = fnBody(up, 'site_settings_validate_games_status');
  assert.match(body, /new\.key = 'games_section_status'/);
  assert.match(body, /not in \('enabled', 'maintenance'\)/);
  assert.match(body, /raise exception 'invalid_games_section_status'/);
  assert.match(up, /before insert or update on public\.site_settings\s+for each row/);
});

test('0062: can_access_games = القسم مفعّل AND الأهلية الأساسية (الاسم والتوقيع ثابتان فلا تتغيّر سياسات RLS)', () => {
  const body = fnBody(up, 'can_access_games');
  assert.match(body, /if not public\.games_section_enabled\(\) then return false; end if;/);
  assert.match(body, /return public\.games_base_access\(\);/);
  assert.match(up, /function public\.can_access_games\(\)\s+returns boolean/);
});

test('0062: games_base_access يحمل منطق 0049 حرفيًا (MFA ثم إداري ثم عضو منخرط للموسم الحالي)', () => {
  const orig = stripSql(read('supabase/migrations/0049_games_access.sql'));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const a = norm(fnBody(orig, 'can_access_games'));
  const b = norm(fnBody(up, 'games_base_access'));
  assert.equal(b, a);
});

test('0062: can_manage_games مستقلة عن الصيانة (تعتمد على games_base_access) وتبقى super_admin/developer فقط', () => {
  const body = fnBody(up, 'can_manage_games');
  assert.match(body, /public\.games_base_access\(\)\s+and\s+coalesce\(public\.is_super_admin\(\), false\)/);
  assert.doesNotMatch(body, /can_access_games|games_section_enabled/);
  // مطابقة لتعريف 0052 عدا الأساس
  const m52 = fnBody(stripSql(read('supabase/migrations/0052_games_admin.sql')), 'can_manage_games');
  assert.match(m52, /public\.can_access_games\(\) and coalesce\(public\.is_super_admin\(\), false\)/);
});

test('0062: games_section_enabled — الافتراضي enabled عند غياب الصف، وmaintenance صراحةً فقط', () => {
  const body = fnBody(up, 'games_section_enabled');
  assert.match(body, /key = 'games_section_status'/);
  assert.match(body, /'enabled'\s*\)\s*is distinct from 'maintenance'/);
});

test('0062: get_games_access يعيد maintenance للمؤهَّلين فقط ولا يغيّر بقية الأسباب', () => {
  const body = fnBody(up, 'get_games_access');
  const iAllowed = body.indexOf("'reason', 'admin'");
  const iMaint = body.indexOf("'reason', 'maintenance'");
  const iMfa = body.indexOf("'reason', 'mfa_required'");
  assert.ok(iAllowed > 0 && iMaint > iAllowed && iMfa > iMaint, 'ترتيب الفروع: السماح ثم الصيانة ثم الأسباب القديمة');
  assert.match(body, /if public\.games_base_access\(\) then\s+return jsonb_build_object\('allowed', false, 'reason', 'maintenance'\)/);
  for (const r of ['unauthenticated', 'mfa_required', 'password_change_required', 'no_member_account', 'no_season', 'member_inactive', 'membership_not_paid']) {
    assert.match(body, new RegExp(`'reason', '${r}'`));
  }
});

test('0062: المنح — الداخلية بلا منح، can_* لـ authenticated، وحالة القسم العامة لـ anon + authenticated فقط', () => {
  for (const f of ['games_section_enabled', 'games_base_access']) {
    assert.match(up, new RegExp(`revoke all on function public\\.${f}\\(\\) from public, anon, authenticated;`));
    assert.doesNotMatch(up, new RegExp(`grant execute on function public\\.${f}\\(\\)`));
  }
  for (const f of ['can_access_games', 'can_manage_games', 'get_games_access']) {
    assert.match(up, new RegExp(`revoke all on function public\\.${f}\\(\\) from public, anon, authenticated;`));
    assert.match(up, new RegExp(`grant execute on function public\\.${f}\\(\\) to authenticated;`));
  }
  assert.match(up, /grant execute on function public\.get_games_section_status\(\) to anon, authenticated;/);
  // كل الدوال SECURITY DEFINER بمسار بحث ثابت (عدا المشغّل الذي لا يقرأ جداول)
  for (const f of ['games_section_enabled', 'games_base_access', 'can_access_games', 'can_manage_games', 'get_games_access', 'get_games_section_status']) {
    assert.match(up, new RegExp(`function public\\.${f}\\(\\)[\\s\\S]*?security definer\\s+stable\\s+set search_path = public, pg_temp`));
  }
});

test('0062: Realtime — إضافة site_settings للمنشور بحماية (لا تفشل إن لم يوجد المنشور أو كانت مضافة)', () => {
  assert.match(up, /from pg_publication where pubname = 'supabase_realtime'/);
  assert.match(up, /not exists \([\s\S]*?pg_publication_tables[\s\S]*?tablename = 'site_settings'/);
  assert.match(up, /alter publication supabase_realtime add table public\.site_settings/);
});

test('0062: الشروط المسبقة تُفحص قبل أي تعريف، والملف داخل معاملة', () => {
  const pre = up.slice(0, up.indexOf('create or replace function'));
  assert.match(pre, /to_regclass\('public\.site_settings'\)/);
  assert.match(pre, /to_regprocedure\('public\.can_access_games\(\)'\)/);
  assert.match(pre, /to_regprocedure\('public\.can_manage_games\(\)'\)/);
  assert.match(up.trim(), /^begin;/);
  assert.match(up.trim(), /commit;$/);
});

test('0062: الرجوع يعيد 0049/0052 حرفيًا ويُسقط المضاف دون مسّ بيانات الألعاب', () => {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const orig49 = stripSql(read('supabase/migrations/0049_games_access.sql'));
  assert.equal(norm(fnBody(down, 'can_access_games')), norm(fnBody(orig49, 'can_access_games')));
  assert.equal(norm(fnBody(down, 'get_games_access')), norm(fnBody(orig49, 'get_games_access')));
  assert.match(fnBody(down, 'can_manage_games'), /public\.can_access_games\(\) and coalesce\(public\.is_super_admin\(\), false\)/);
  for (const f of ['get_games_section_status', 'games_base_access', 'games_section_enabled', 'site_settings_validate_games_status']) {
    assert.match(down, new RegExp(`drop function if exists public\\.${f}\\(\\)`));
  }
  assert.match(down, /drop trigger if exists trg_site_settings_validate_games_status/);
  assert.match(down, /delete from public\.site_settings where key = 'games_section_status'/);
  assert.doesNotMatch(down, /\b(delete\s+from|truncate)\s+public\.(games|game_\w+|members|profiles)\b/i);
  assert.doesNotMatch(down, /\bcascade\b/i);
});

test('0062: لا ملف ألعاب سابق (0050–0061) يعرّف can_access_games/can_manage_games بعد 0052 — فالتفويض عبر 0062 يغطي كل RPC/RLS', () => {
  const later = listDir('supabase/migrations').filter((f) => /^00(5[3-9]|6[01])_/.test(f));
  for (const f of later) {
    const s = stripSql(read(`supabase/migrations/${f}`));
    assert.doesNotMatch(s, /create or replace function public\.(can_access_games|can_manage_games)\b/, f);
  }
});

test('الفحص السلوكي: يغطي القسم المفعّل والصيانة والتحقق وعدم صلاحية غير المخوّلين وإبقاء البيانات ويُلغى بـ rollback', () => {
  const smoke = read('supabase/tests/games_maintenance_smoke.sql');
  assert.match(smoke.trim(), /rollback;$/);
  for (const needle of ['maintenance', '22023', 'can_manage_games', 'can_access_games', 'get_games_section_status', 'FAIL:']) {
    assert.ok(smoke.includes(needle), `الفحص لا يغطي: ${needle}`);
  }
});

// ───────────────────────── 3) الواجهة: التوصيل والحماية ─────────────────────────

test('الحماية: كل مسارات /games/* أبناء GamesLayout (الذي يفحص الصيانة قبل الحارس) — الروابط المباشرة محمية', () => {
  const router = read('src/app/router/index.jsx');
  const block = router.slice(router.indexOf('path: GAMES_BASE_PATH'), router.indexOf("path: '/admin'"));
  assert.match(block, /element: <GamesLayout \/>/);
  for (const p of ["index: true", "'g/:slug'", "'c/:challengeId'", "'paths'", "'paths/:trackId'", "'stages/:stageId'", "'profile'", "'leaderboard'"]) {
    assert.ok(block.includes(p), `المسار ${p} ليس تحت GamesLayout`);
  }
  // كل صفحة ألعاب تظهر مرة واحدة فقط كعنصر مسار، وداخل غلاف GamesLayout
  for (const c of ['GamesHome', 'GameDetails', 'ChallengePlay', 'LearningPaths', 'LearningTrack', 'LearningStage', 'PlayerProfile', 'GamesLeaderboard']) {
    const uses = router.match(new RegExp(`element: <${c} />`, 'g')) || [];
    assert.equal(uses.length, 1, `${c} يجب أن يُستعمل مرة واحدة`);
    assert.ok(block.includes(`<${c} />`), `${c} خارج GamesLayout`);
  }
});

test('GamesLayout: الصيانة تُفحص قبل الحارس، ولا يُصيَّر أي طفل (Outlet) أثناء الصيانة/التحميل/الخطأ', () => {
  const src = read('src/features/games/layout/GamesLayout.jsx');
  const iMaint = src.indexOf('isMaintenance');
  const iGuard = src.indexOf('<GamesGuard>');
  const iOutlet = src.indexOf('<Outlet />');
  assert.ok(iMaint > 0 && iMaint < iGuard && iGuard < iOutlet);
  assert.match(src, /if \(phase !== 'ready'\)/);
  assert.match(src, /if \(isMaintenance\)\s*\{[\s\S]*?<GamesMaintenance \/>[\s\S]*?\}/);
  // لا يوجد Outlet قبل فحص الصيانة
  assert.equal(src.split('<Outlet />').length - 1, 1);
});

test('GamesGuard وuseCanSeeGamesLink: reason=maintenance معروف ويُعرض كصيانة لا كرفض', () => {
  assert.match(read('src/features/games/constants/games.js'), /'maintenance'/);
  const guard = read('src/features/games/components/GamesGuard.jsx');
  assert.match(guard, /access\?\.reason === 'maintenance'/);
  assert.match(guard, /if \(serverSaysMaintenance\) return <GamesMaintenance \/>;/);
  assert.match(read('src/features/games/hooks/useGamesAccess.js'), /access\?\.reason === 'maintenance'/);
});

test('الإدارة: اللوحة داخل /admin/settings (ROLES_SUPER) ومنفصلة عن نموذج الإعدادات العامة ولا تُحفظ معه', () => {
  const router = read('src/app/router/index.jsx');
  assert.match(router, /'\/admin\/settings', element: protectedAdmin\(ROLES_SUPER, <Settings \/>\)/);
  const roles = read('src/constants/roles.js');
  assert.match(roles, /ROLES_SUPER = \['developer', 'super_admin'\]/);
  const settings = read('src/pages/admin/Settings.jsx');
  const panelAt = settings.indexOf('<GamesSectionStatusPanel />');
  assert.ok(panelAt > 0 && panelAt < settings.indexOf('<form'), 'اللوحة خارج <form>');
  const svc = read('src/services/supabase/adminSettings.service.js');
  const groups = svc.slice(svc.indexOf('SETTINGS_GROUPS'), svc.indexOf('TRANSLATABLE_SETTINGS'));
  assert.doesNotMatch(groups, /games_section_status/);
});

test('خدمة الحفظ: تكتب مفتاح الصيانة وحده، تتحقق من القيمة والصفوف المُرجعة (RLS الصامت)، وتسجّل في التدقيق', () => {
  const svc = read('src/services/supabase/adminSettings.service.js');
  const fn = svc.slice(svc.indexOf('export async function saveGamesSectionStatus'));
  assert.match(fn, /status !== GAMES_STATUS\.ENABLED && status !== GAMES_STATUS\.MAINTENANCE/);
  assert.match(fn, /\.upsert\(\{ key: GAMES_STATUS_KEY, value: status \}, \{ onConflict: 'key' \}\)/);
  assert.match(fn, /!data\?\.length \|\| data\[0\]\.value !== status/);
  assert.match(fn, /logAction\(\s*'ADMIN_SET_GAMES_STATUS'/);
  assert.match('ADMIN_SET_GAMES_STATUS', /^ADMIN_[A-Z_]{3,60}$/);
});

test('لوحة الإدارة: كل نص tr() فيها له ترجمة fr/en في قاموس الإدارة', () => {
  const src = read('src/components/admin/GamesSectionStatusPanel.jsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const keys = new Set();
  for (const m of src.matchAll(/'([^'\n]*[\u0600-\u06FF][^'\n]*)'/g)) keys.add(m[1]);
  assert.ok(keys.size >= 10, 'لم تُستخرج النصوص');
  const missing = [...keys].filter((k) => !ADMIN_DICT[k]);
  assert.deepEqual(missing, []);
  // وصف سجل التدقيق مترجم أيضًا
  const audit = read('src/utils/auditDescription.js');
  assert.match(audit, /تفعيل وضع الصيانة لقسم الألعاب/);
  assert.match(audit, /إنهاء وضع الصيانة وإعادة تفعيل قسم الألعاب/);
});

// ───────────────────────── 4) اللغات والتصميم ─────────────────────────

const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) (v && typeof v === 'object' ? flat(v, `${p}${k}.`, out) : (out[`${p}${k}`] = v));
  return out;
};

test('اللغات: مفاتيح games.maintenance.* وgames.admin.maintenanceBanner* موجودة ومتطابقة وغير فارغة في ar/fr/en', () => {
  const need = ['badge', 'title', 'text', 'reassure', 'actionHome', 'actionCheck', 'checking', 'adminNote', 'adminAction', 'illustration', 'statusErrorTitle'].map((k) => `games.maintenance.${k}`)
    .concat(['games.admin.maintenanceBanner', 'games.admin.maintenanceBannerAction']);
  const maps = Object.fromEntries(['ar', 'fr', 'en'].map((l) => [l, flat(JSON.parse(read(`src/i18n/locales/${l}.json`)))]));
  for (const k of need) {
    for (const l of ['ar', 'fr', 'en']) assert.ok(String(maps[l][k] || '').trim(), `${l}: ${k} مفقود`);
  }
  // اللغات مختلفة فعلًا (لا نسخ للإنجليزية في العربية)
  assert.notEqual(maps.ar['games.maintenance.title'], maps.en['games.maintenance.title']);
  assert.notEqual(maps.fr['games.maintenance.title'], maps.en['games.maintenance.title']);
  assert.match(maps.ar['games.maintenance.title'], /[\u0600-\u06FF]/);
});

test('كل مفاتيح t() المستعملة في صفحة الصيانة والتخطيط موجودة', () => {
  const ar = flat(JSON.parse(read('src/i18n/locales/ar.json')));
  for (const f of ['src/features/games/components/GamesMaintenance.jsx', 'src/features/games/layout/GamesLayout.jsx', 'src/features/games/admin/pages/GamesAdmin.jsx']) {
    for (const m of read(f).matchAll(/\bt\('([A-Za-z0-9_.]+)'\)/g)) {
      const k = m[1];
      assert.ok(k in ar || Object.keys(ar).some((x) => x.startsWith(`${k}.`)), `${f}: ${k}`);
    }
  }
});

test('التصميم: CSS الصيانة بخصائص منطقية (RTL/LTR) وألوان tokens فقط ويحترم تقليل الحركة، والصفحة تعيد استعمال games-wrap/btn', () => {
  const css = read('src/styles/games-maintenance.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\b(margin|padding|border)-(left|right)\b|(^|[;{\s])(left|right)\s*:|text-align:\s*(left|right)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /rgba?\(\s*\d/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(max-width: 480px\)/);
  const page = read('src/features/games/components/GamesMaintenance.jsx');
  assert.match(page, /games-wrap/);
  assert.match(page, /btn btn-gold/);
  assert.match(page, /btn btn-ghost/);
  assert.match(page, /role="status"/);
  assert.match(read('src/features/games/components/GamesMaintenanceArt.jsx'), /role="img" aria-label=\{label\}/);
});

test('لا اعتماديات جديدة ولا تعديل CSP (wss الخاص بـ Supabase مسموح أصلًا لـ Realtime)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@supabase/supabase-js', 'dompurify', 'html2canvas', 'i18next', 'jspdf', 'lucide-react', 'prismjs', 'react', 'react-dom', 'react-i18next', 'react-router-dom']);
  assert.match(read('netlify.toml'), /connect-src[^;]*wss:\/\/[a-z0-9]+\.supabase\.co/);
});

test('لا مسّ بالوحدات الأخرى: الملفات المعدَّلة تقتصر على الألعاب/الإعدادات/اللغات (فحص وجود فقط)', () => {
  for (const f of [
    'src/features/games/maintenance/gamesStatusCore.js',
    'src/features/games/maintenance/gamesStatus.service.js',
    'src/features/games/maintenance/useGamesSectionStatus.js',
    'src/features/games/components/GamesMaintenance.jsx',
    'src/features/games/components/GamesMaintenanceArt.jsx',
    'src/components/admin/GamesSectionStatusPanel.jsx',
    'src/styles/games-maintenance.css',
  ]) assert.ok(fs.existsSync(path.join(new URL('..', import.meta.url).pathname, f)), f);
});
