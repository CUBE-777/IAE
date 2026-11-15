import './helpers/esm-extless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--.*$/gm, '');
const M = await import('../src/features/games/admin/bulk/importModel.js');
const { runChunks } = await import('../src/features/games/admin/bulk/importRunner.js');

const GAME = { id: 'g1', slug: 'game' };
const STAGE_ID = '11111111-1111-4111-8111-111111111111';
const index = M.buildStageIndex([{
  game: GAME,
  tracks: [{ id: 't1', slug: 'track' }],
  categories: [{ id: 'c1', track_id: 't1', slug: 'cat' }],
  stages: [
    { id: STAGE_ID, category_id: 'c1', slug: 'stage', status: 'published' },
    { id: '22222222-2222-4222-8222-222222222222', category_id: 'c1', slug: 'old', status: 'archived' },
  ],
}]);
const ctx = (extra = {}) => ({ stageMap: { 'game/track/cat/stage': STAGE_ID }, stageIndex: index, ...extra });
const withRef = (doc) => ({ ...doc, challenges: doc.challenges.map((c) => ({ ...c, stage_ref: 'game/track/cat/stage' })) });
const tpl = () => withRef(M.buildTemplate());

test('النموذج: 7 أنواع وكلها صالحة بلا أخطاء', () => {
  const doc = tpl();
  assert.equal(doc.challenges.length, 7);
  assert.deepEqual([...new Set(doc.challenges.map((c) => c.type))].sort(),
    ['code_completion', 'drag_reorder', 'fill_blanks', 'find_error', 'match_pairs', 'multiple_choice', 'predict_output']);
  const items = M.prepareAll(doc, ctx());
  items.forEach((it) => assert.deepEqual(it.errors, [], `${it.external_id}: ${JSON.stringify(it.errors)}`));
  assert.ok(items.every((it) => it.payload && it.payload.stage_id === STAGE_ID));
});

test('ملف docs يطابق buildTemplate()', () => {
  assert.deepEqual(JSON.parse(read('docs/games-bulk-import-template.json')), M.buildTemplate());
});

test('100 تحدٍّ: صالحة وتُقسَّم دفعات ≤ 50', () => {
  const base = tpl().challenges;
  const many = Array.from({ length: 100 }, (_, i) => ({ ...base[i % 7], external_id: `x-${i}` }));
  const items = M.prepareAll({ import_id: 'bulk-100', challenges: many }, ctx());
  assert.equal(items.filter((it) => it.errors.length).length, 0);
  const parts = M.chunk(items, M.CHUNK_SIZE);
  assert.deepEqual(parts.map((p) => p.length), [50, 50]);
  assert.equal(new Set(items.map((i) => i.payload.slug)).size, 100);
});

test('ترجمة ناقصة لغير الافتراضية: تحذير لا خطأ؛ الافتراضية ناقصة: خطأ', () => {
  const doc = tpl();
  const c = JSON.parse(JSON.stringify(doc.challenges[0]));
  delete c.translations.fr;
  const [ok] = M.prepareAll({ import_id: 'part-001', challenges: [c] }, ctx());
  assert.equal(ok.errors.length, 0);
  assert.ok(ok.warnings.length > 0);
  const c2 = JSON.parse(JSON.stringify(doc.challenges[0]));
  delete c2.translations.en;
  const [bad] = M.prepareAll({ import_id: 'part-002', challenges: [c2] }, ctx());
  assert.ok(bad.errors.length > 0);
  assert.equal(bad.payload, null);
});

test('نوع غير مدعوم ومرحلة غير مربوطة وexternal_id مكرر', () => {
  const c = tpl().challenges;
  const [t] = M.prepareAll({ import_id: 'bad-type', challenges: [{ ...c[0], type: 'essay' }] }, ctx());
  assert.ok(t.errors.some((e) => e.code === 'invalid_challenge_type' || e.field === 'type'));
  const [s] = M.prepareAll({ import_id: 'bad-stage', challenges: [c[0]] }, { stageMap: {}, stageIndex: index, });
  assert.ok(s.errors.some((e) => e.code === 'stage_unmapped'));
  const dup = M.prepareAll({ import_id: 'dup-ext', challenges: [c[0], { ...c[1], external_id: c[0].external_id }] }, ctx());
  assert.ok(dup[1].errors.some((e) => e.code === 'duplicate_external_id'));
  assert.equal(dup[1].payload, null);
});

test('المرحلة المؤرشفة لا تُحلّ تلقائيًا؛ المسار الكامل وUUID يُحلّان', () => {
  assert.equal(M.autoResolveRef('game/track/cat/old', index), null);
  assert.equal(M.autoResolveRef('game/track/cat/stage', index), STAGE_ID);
  assert.equal(M.autoResolveRef(STAGE_ID, index), STAGE_ID);
  assert.equal(M.autoResolveRef('stage', index), null);
});

test('قراءة الملف: JSON تالف/فارغ/كبير/إصدار/معرّف/بلا تحديات', () => {
  const code = (s) => M.parseImportText(s).code;
  assert.equal(code(''), 'file_empty');
  assert.equal(code('{oops'), 'json_invalid');
  assert.equal(code('[]'), 'file_structure');
  assert.equal(code(JSON.stringify({ schema_version: 2, import_id: 'abc', challenges: [1] })), 'schema_unsupported');
  assert.equal(code(JSON.stringify({ schema_version: 1, import_id: 'a b', challenges: [1] })), 'import_id_invalid');
  assert.equal(code(JSON.stringify({ schema_version: 1, import_id: 'abc', challenges: [] })), 'no_challenges');
  assert.equal(code('x'.repeat(M.MAX_FILE_BYTES + 1)), 'file_too_large');
  assert.equal(M.parseImportText(JSON.stringify(M.buildTemplate())).ok, true);
});

test('الملخّص: صالح/غير صالح/مكرر وتوزيع النوع والمرحلة', () => {
  const items = M.prepareAll(tpl(), ctx());
  const sv = new Map([[0, { status: 'duplicate' }], [1, { status: 'error', code: 'slug_taken' }]]);
  const s = M.summarize(items, sv);
  assert.deepEqual([s.total, s.valid, s.invalid, s.duplicate], [7, 5, 1, 1]);
  assert.equal(s.byStage[STAGE_ID], 7);
  assert.equal(s.byType.multiple_choice, 1);
});

test('runChunks: تقدّم، تتابع، وتوقف عند أول دفعة فاشلة', async () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ index: i, payload: { external_id: `e${i}` } }));
  const calls = [];
  const ok = await runChunks(items, async (p) => { calls.push(p.length); return { items: p.map((_, i) => ({ index: i, status: 'new' })) }; }, { dryRun: true });
  assert.deepEqual(calls, [50, 50, 20]);
  assert.equal(ok.rows.size, 120);
  assert.equal(ok.failed, null);
  let n = 0;
  const prog = [];
  const bad = await runChunks(items, async (p) => { n += 1; if (n === 2) throw new Error('x'); return { items: p.map((_, i) => ({ index: i, status: 'created' })) }; },
    { dryRun: false, onProgress: (p) => prog.push(p.done) });
  assert.equal(n, 2);
  assert.deepEqual(prog, [50]);
  assert.equal(bad.failed.chunk, 1);
  assert.equal(bad.done, 50);
  assert.equal(bad.rows.size, 50);
});

test('0061 (ثابت): مسودات فقط، بلا نشر، صلاحية وقفل، منح مقيّد', () => {
  const sql = stripSql(read('supabase/migrations/0061_games_bulk_import.sql'));
  assert.match(sql, /can_manage_games\(\)/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /import_too_large/);
  assert.match(sql, /uq_game_challenges_import_key/);
  assert.doesNotMatch(sql, /admin_publish_game_challenge_version|iae\.games_publish|status\s*=\s*'published'/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(games|game_tracks|game_track_categories|game_stages)\b/i);
  assert.match(sql, /revoke all on function public\.admin_import_game_challenges[^;]*from public, anon/i);
  assert.match(sql, /grant execute on function public\.admin_import_game_challenges[^;]*to authenticated/i);
});

test('الواجهة: لا service role، ولا نشر، والاستيراد عبر RPC فقط', () => {
  const ui = read('src/features/games/admin/bulk/BulkImport.jsx') + read('src/features/games/admin/bulk/importRunner.js') + read('src/features/games/admin/bulk/importModel.js');
  assert.doesNotMatch(ui, /service_role|SERVICE_ROLE/);
  assert.doesNotMatch(ui, /publish/i);
  assert.match(read('src/features/games/admin/services/gamesAdmin.service.js'), /admin_import_game_challenges/);
});

test('i18n: مفاتيح bulk متطابقة في اللغات الثلاث وكل رمز خطأ محلي مترجم', () => {
  const L = Object.fromEntries(['ar', 'fr', 'en'].map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`)).games.admin.bulk]));
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(L.ar), keys(L.en));
  assert.deepEqual(keys(L.fr), keys(L.en));
  for (const c of ['file_empty', 'file_too_large', 'json_invalid', 'file_structure', 'schema_unsupported', 'import_id_invalid', 'no_challenges', 'too_many',
    'field_required', 'unsupported_key', 'invalid_structure', 'invalid_number', 'stage_unmapped', 'invalid_solution', 'duplicate_item', 'translation_required',
    'invalid_external_id', 'duplicate_external_id', 'stage_game_mismatch', 'invalid_language', 'invalid_challenge_type']) {
    assert.ok(L.en.errors[c], c);
  }
});
