/**
 * src/features/games/admin/bulk/importModel.js — منطق Bulk Challenge Import النقي (بلا React ولا شبكة).
 *
 * لا يكرّر قواعد التحقق: يحوّل كل عنصر في الملف إلى «إصدار» ثم يمرّره على المنطق نفسه الذي يستعمله محرر التحديات
 * (fromVersion ← validateModel ← toDraftData في builder/builderModel.js). ما يضيفه هنا فقط:
 *   · فحص البنية (مفاتيح مسموحة، علاقات الحلّ بالمحتوى) لأن fromVersion متسامح عمدًا مع المسودّات الناقصة؛
 *   · ربط stage_ref بمرحلة قائمة؛ · الترجمات؛ · ملف النموذج.
 * هذا التحقق مرآة لتجربة المستخدم فقط: الحَكَم الفعلي RPC admin_import_game_challenges (0061) الذي يعيد الفحص كاملًا بشروط النشر.
 */
import { LANGS } from '../constants/gamesAdmin.js';
import { BUILDER_TYPES, CODE_LANGS, LIMITS, fromVersion, toDraftData, validateModel } from '../builder/builderModel.js';
import { slugify } from '../services/gamesAdmin.shared.js';

export const IMPORT_SCHEMA_VERSION = 1;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ITEMS = 1000;
export const CHUNK_SIZE = 50; // ≤ 100 (حد الخادم للاستدعاء الواحد)

export const IMPORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
export const EXTERNAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const TOP_KEYS = new Set(['schema_version', 'import_id', 'description', 'challenges']);
const ITEM_KEYS = new Set(['external_id', 'stage_ref', 'game', 'slug', 'type', 'difficulty', 'points', 'default_language', 'allow_language_fallback',
  'time_limit_seconds', 'max_attempts', 'is_required', 'translations', 'content', 'solution']);
const TR_KEYS = new Set(['title', 'description', 'prompt', 'instructions', 'hints', 'feedback']);
const CONTENT_KEYS = {
  multiple_choice: ['options'],
  predict_output: ['code', 'code_lang', 'options'],
  fill_blanks: ['template', 'blanks'],
  drag_reorder: ['items'],
  find_error: ['code_lang', 'lines', 'fix_options'],
  match_pairs: ['left', 'right'],
  code_completion: ['code', 'code_lang', 'slots'],
};
const SOLUTION_KEYS = {
  multiple_choice: ['choice'],
  predict_output: ['choice'],
  fill_blanks: ['blanks'],
  drag_reorder: ['order'],
  find_error: ['line', 'fix'],
  match_pairs: ['pairs'],
  code_completion: ['slots'],
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const arr = (v) => (Array.isArray(v) ? v : []);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

/* ---------- قراءة الملف ---------- */
/** { ok: true, doc } | { ok: false, code } — code مفتاح في games.admin.bulk.errors. */
export function parseImportText(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'file_empty' };
  if (text.length > MAX_FILE_BYTES) return { ok: false, code: 'file_too_large' };
  let doc;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, code: 'json_invalid' };
  }
  if (!isObj(doc)) return { ok: false, code: 'file_structure' };
  if (doc.schema_version !== IMPORT_SCHEMA_VERSION) return { ok: false, code: 'schema_unsupported' };
  if (typeof doc.import_id !== 'string' || !IMPORT_ID_RE.test(doc.import_id)) return { ok: false, code: 'import_id_invalid' };
  if (!Array.isArray(doc.challenges) || doc.challenges.length === 0) return { ok: false, code: 'no_challenges' };
  if (doc.challenges.length > MAX_ITEMS) return { ok: false, code: 'too_many' };
  return { ok: true, doc };
}

/** المراجع المميّزة لـ stage_ref (للربط) مع عدد التحديات لكل مرجع. */
export function collectStageRefs(doc) {
  const m = new Map();
  arr(doc?.challenges).forEach((c) => {
    const ref = isObj(c) && typeof c.stage_ref === 'string' ? c.stage_ref.trim() : '';
    m.set(ref, (m.get(ref) || 0) + 1);
  });
  return [...m.entries()].map(([ref, count]) => ({ ref, count }));
}

/* ---------- فهرس المراحل ---------- */
/**
 * paths: [{ game, tracks, categories, stages }] لكل لعبة (listPaths + سجل اللعبة).
 * المرجع المستقر: UUID المرحلة، أو المسار الكامل «game/track/category/stage» (slugs) — لا اسم المرحلة وحده (قد يتكرر).
 * المراحل المؤرشفة لا تُعرض ولا تُقبل.
 */
export function buildStageIndex(paths) {
  const list = [];
  arr(paths).forEach(({ game, tracks, categories, stages }) => {
    const tr = new Map(arr(tracks).map((x) => [x.id, x]));
    const ca = new Map(arr(categories).map((x) => [x.id, x]));
    arr(stages).forEach((st) => {
      if (st.status === 'archived') return;
      const cat = ca.get(st.category_id);
      const track = cat ? tr.get(cat.track_id) : null;
      if (!cat || !track) return;
      list.push({ id: st.id, game, track, category: cat, stage: st, path: `${game.slug}/${track.slug}/${cat.slug}/${st.slug}` });
    });
  });
  const byId = new Map(list.map((x) => [x.id, x]));
  const byPath = new Map(list.map((x) => [x.path, x]));
  return { list, byId, byPath };
}

/** يحاول ربط مرجع تلقائيًا؛ يعيد stageId أو null. */
export function autoResolveRef(ref, index) {
  const r = String(ref || '').trim();
  if (!r) return null;
  return (index.byId.get(r) || index.byPath.get(r))?.id || null;
}

/* ---------- فحص بنية المحتوى والحلّ لكل نوع ---------- */
function checkIdList(list, add, path, { literal }) {
  const ids = [];
  list.forEach((o, i) => {
    if (!isObj(o) || typeof o.id !== 'string' || !ID_RE.test(o.id)) add(`${path}[${i}].id`, 'invalid_structure');
    else ids.push(o.id);
    if (isObj(o) && literal && typeof o.value !== 'string') add(`${path}[${i}].value`, 'invalid_structure');
    if (isObj(o) && !literal && !isObj(o.text)) add(`${path}[${i}].text`, 'invalid_structure');
  });
  if (new Set(ids).size !== ids.length) add(path, 'duplicate_item');
  return ids;
}

function checkStructure(type, content, solution, add) {
  if (!isObj(content)) { add('content', 'invalid_structure'); return; }
  if (!isObj(solution)) { add('solution', 'solution_required'); return; }
  Object.keys(content).forEach((k) => { if (!CONTENT_KEYS[type].includes(k)) add(`content.${k}`, 'unsupported_key'); });
  Object.keys(solution).forEach((k) => { if (!SOLUTION_KEYS[type].includes(k)) add(`solution.${k}`, 'unsupported_key'); });
  if (content.code_lang !== undefined && !CODE_LANGS.includes(content.code_lang)) add('content.code_lang', 'invalid_structure');

  const need = (cond, field, code = 'invalid_solution') => { if (!cond) add(field, code); return cond; };

  if (type === 'multiple_choice' || type === 'predict_output') {
    if (!Array.isArray(content.options)) { add('content.options', 'invalid_structure'); return; }
    const ids = checkIdList(content.options, add, 'content.options', { literal: type === 'predict_output' });
    need(typeof solution.choice === 'string' && ids.includes(solution.choice), 'solution.choice');
    if (type === 'predict_output' && !isStr(content.code)) add('content.code', 'field_required');
  } else if (type === 'fill_blanks') {
    if (!isObj(content.template)) add('content.template', 'invalid_structure');
    if (!Array.isArray(content.blanks)) { add('content.blanks', 'invalid_structure'); return; }
    const blankIds = [];
    content.blanks.forEach((b, i) => {
      if (!isObj(b) || typeof b.id !== 'string' || !ID_RE.test(b.id) || !Array.isArray(b.options)) { add(`content.blanks[${i}]`, 'invalid_structure'); return; }
      blankIds.push(b.id);
      const oids = checkIdList(b.options, add, `content.blanks[${i}].options`, { literal: false });
      const pick = isObj(solution.blanks) ? solution.blanks[b.id] : undefined;
      need(typeof pick === 'string' && oids.includes(pick), `solution.blanks.${b.id}`);
    });
    if (new Set(blankIds).size !== blankIds.length) add('content.blanks', 'duplicate_item');
    need(isObj(solution.blanks) && sameSet(Object.keys(solution.blanks), blankIds), 'solution.blanks');
  } else if (type === 'drag_reorder') {
    if (!Array.isArray(content.items)) { add('content.items', 'invalid_structure'); return; }
    const ids = checkIdList(content.items, add, 'content.items', { literal: false });
    need(Array.isArray(solution.order) && sameSet(solution.order, ids), 'solution.order');
  } else if (type === 'find_error') {
    if (!Array.isArray(content.lines) || content.lines.some((l) => typeof l !== 'string')) { add('content.lines', 'invalid_structure'); return; }
    const fixes = content.fix_options === undefined ? [] : content.fix_options;
    if (!Array.isArray(fixes)) { add('content.fix_options', 'invalid_structure'); return; }
    const fids = checkIdList(fixes, add, 'content.fix_options', { literal: true });
    need(Number.isInteger(solution.line) && solution.line >= 1 && solution.line <= content.lines.length && String(content.lines[solution.line - 1]).trim() !== '', 'solution.line');
    if (fixes.length) need(typeof solution.fix === 'string' && fids.includes(solution.fix), 'solution.fix');
    else need(solution.fix === undefined, 'solution.fix');
  } else if (type === 'match_pairs') {
    if (!Array.isArray(content.left) || !Array.isArray(content.right)) { add('content.left', 'invalid_structure'); return; }
    const l = checkIdList(content.left, add, 'content.left', { literal: false });
    const r = checkIdList(content.right, add, 'content.right', { literal: false });
    const map = isObj(solution.pairs) ? solution.pairs : null;
    need(!!map && sameSet(Object.keys(map), l) && sameSet(Object.values(map), r), 'solution.pairs');
  } else if (type === 'code_completion') {
    if (!isStr(content.code)) add('content.code', 'field_required');
    if (!Array.isArray(content.slots)) { add('content.slots', 'invalid_structure'); return; }
    const sids = [];
    content.slots.forEach((s, i) => {
      if (!isObj(s) || typeof s.id !== 'string' || !ID_RE.test(s.id) || !Array.isArray(s.options)) { add(`content.slots[${i}]`, 'invalid_structure'); return; }
      sids.push(s.id);
      const oids = checkIdList(s.options, add, `content.slots[${i}].options`, { literal: true });
      const pick = isObj(solution.slots) ? solution.slots[s.id] : undefined;
      need(typeof pick === 'string' && oids.includes(pick), `solution.slots.${s.id}`);
    });
    if (new Set(sids).size !== sids.length) add('content.slots', 'duplicate_item');
    need(isObj(solution.slots) && sameSet(Object.keys(solution.slots), sids), 'solution.slots');
  }
}

/* ---------- عنصر واحد ---------- */
const intIn = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** slug افتراضي حتمي: import_id + external_id (يمنع التصادم مع ملفات أخرى). */
export function defaultSlug(importId, externalId) {
  const s = slugify(`${importId}-${externalId}`).slice(0, 64).replace(/-+$/, '');
  return s || 'imported';
}

function localizedFrom(tr, key) {
  const out = {};
  LANGS.forEach((l) => { const v = tr?.[l]?.[key]; if (isStr(v)) out[l] = v.trim(); });
  return out;
}

/**
 * يحضّر عنصرًا: { index, external_id, stage_ref, type, title, errors[{field,code,vars?}], warnings[{field,code,vars?}], payload|null }.
 * payload جاهز لـ admin_import_game_challenges (يُرسل فقط إن خلا errors من الأخطاء).
 * ctx: { importId, stageMap: {ref → stageId}, stageIndex }
 */
export function prepareItem(raw, index, ctx) {
  const errors = [];
  const warnings = [];
  const add = (field, code, vars) => errors.push({ field, code, ...(vars ? { vars } : {}) });
  const res = (extra) => ({ index, external_id: '', stage_ref: '', type: '', title: '', errors, warnings, payload: null, stageId: null, ...extra });

  if (!isObj(raw)) { add('item', 'invalid_structure'); return res({}); }
  const external_id = typeof raw.external_id === 'string' ? raw.external_id.trim() : '';
  const stage_ref = typeof raw.stage_ref === 'string' ? raw.stage_ref.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type : '';

  if (!EXTERNAL_ID_RE.test(external_id)) add('external_id', 'invalid_external_id');
  Object.keys(raw).forEach((k) => { if (!ITEM_KEYS.has(k)) add(k, 'unsupported_key'); });

  // المرحلة
  let stageId = null;
  if (!stage_ref) add('stage_ref', 'field_required');
  else {
    stageId = ctx.stageMap?.[stage_ref] || null;
    const st = stageId ? ctx.stageIndex.byId.get(stageId) : null;
    if (!st) { stageId = null; add('stage_ref', 'stage_unmapped'); }
    else if (raw.game !== undefined && (typeof raw.game !== 'string' || raw.game !== st.game.slug)) add('game', 'stage_game_mismatch');
  }

  // النوع
  if (!BUILDER_TYPES.includes(type)) add('type', 'invalid_challenge_type');

  // اللغة والترجمات
  const defLang = raw.default_language;
  if (!LANGS.includes(defLang)) add('default_language', 'invalid_language');
  const tr = raw.translations;
  if (!isObj(tr)) add('translations', 'field_required');
  else {
    Object.keys(tr).forEach((l) => { if (!LANGS.includes(l)) add(`translations.${l}`, 'invalid_language'); });
    LANGS.forEach((l) => {
      if (tr[l] === undefined) return;
      if (!isObj(tr[l])) { add(`translations.${l}`, 'invalid_structure'); return; }
      Object.keys(tr[l]).forEach((k) => { if (!TR_KEYS.has(k)) add(`translations.${l}.${k}`, 'unsupported_key'); });
      if (tr[l].hints !== undefined && (!Array.isArray(tr[l].hints) || tr[l].hints.some((h) => typeof h !== 'string'))) add(`translations.${l}.hints`, 'invalid_structure');
    });
    if (LANGS.includes(defLang)) {
      if (!isStr(tr[defLang]?.title)) add(`translations.${defLang}.title`, 'translation_required');
      if (!isStr(tr[defLang]?.prompt)) add(`translations.${defLang}.prompt`, 'translation_required');
    }
    // ترجمة ناقصة في لغة غير افتراضية: مسموح (المحرر يسمح) لكن نُنبّه
    LANGS.filter((l) => l !== defLang).forEach((l) => {
      const miss = ['title', 'prompt'].filter((k) => !isStr(tr[l]?.[k]));
      if (miss.length) warnings.push({ field: `translations.${l}`, code: 'translation_partial', vars: { lang: l, fields: miss.join(', ') } });
    });
  }

  // أرقام
  if (!intIn(raw.difficulty, 1, 5)) add('difficulty', 'invalid_number', { min: 1, max: 5 });
  if (!intIn(raw.points, 0, 10000)) add('points', 'invalid_number', { min: 0, max: 10000 });
  if (raw.time_limit_seconds != null && !intIn(raw.time_limit_seconds, 5, 86400)) add('time_limit_seconds', 'invalid_number', { min: 5, max: 86400 });
  if (raw.max_attempts != null && !intIn(raw.max_attempts, 1, 1000)) add('max_attempts', 'invalid_number', { min: 1, max: 1000 });
  if (raw.is_required !== undefined && typeof raw.is_required !== 'boolean') add('is_required', 'invalid_structure');
  if (raw.allow_language_fallback !== undefined && typeof raw.allow_language_fallback !== 'boolean') add('allow_language_fallback', 'invalid_structure');

  let slug = '';
  if (raw.slug !== undefined) {
    slug = typeof raw.slug === 'string' ? raw.slug : '';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 64) add('slug', 'invalid_structure');
  } else if (EXTERNAL_ID_RE.test(external_id)) slug = defaultSlug(ctx.importId, external_id);

  const title = isObj(tr) && LANGS.includes(defLang) ? tr[defLang]?.title || '' : '';
  const base = { external_id, stage_ref, type, title: typeof title === 'string' ? title : '', stageId };

  // المحتوى والحلّ (بنية ← المحرر)
  if (BUILDER_TYPES.includes(type)) checkStructure(type, raw.content, raw.solution, add);
  if (errors.length) return res(base);

  // نفس منطق المحرر: إصدار افتراضي ← نموذج ← validateModel/toDraftData
  const hintsLen = Math.max(0, ...LANGS.map((l) => arr(tr[l]?.hints).length));
  const hints = Array.from({ length: hintsLen }, (_, i) => Object.fromEntries(LANGS.filter((l) => isStr(tr[l]?.hints?.[i])).map((l) => [l, tr[l].hints[i].trim()])));
  const instructions = localizedFrom(tr, 'instructions');
  const prompt = localizedFrom(tr, 'prompt');
  const content = { answer_type: 'builder', challenge_type: type, schema_version: 1, prompt, ...(Object.keys(instructions).length ? { instructions } : {}), ...(hints.length ? { hints } : {}), ...raw.content };
  const version = {
    default_language: defLang,
    allow_language_fallback: raw.allow_language_fallback !== false,
    title: localizedFrom(tr, 'title'),
    description: localizedFrom(tr, 'description'),
    difficulty: raw.difficulty,
    points_reward: raw.points,
    time_limit_seconds: raw.time_limit_seconds ?? '',
    max_attempts: raw.max_attempts ?? '',
    content,
  };
  const { model, legacy } = fromVersion(version, { solution: raw.solution, feedback: localizedFrom(tr, 'feedback') });
  if (legacy) { add('type', 'invalid_challenge_type'); return res(base); }
  model.changeNote = `bulk-import:${ctx.importId}`;

  validateModel(model).forEach((p) => add('content', `problem:${p.code}`, p.vars));
  if (model.hints.length > LIMITS.hints) add('translations', 'problem:hintsMax', { max: LIMITS.hints });
  if (errors.length) return res(base);

  const draft = toDraftData(model);
  const payload = { external_id, stage_id: stageId, game_id: ctx.stageIndex.byId.get(stageId).game.id, slug, is_required: raw.is_required !== false, ...draft };
  return res({ ...base, payload });
}

/** يحضّر كل الملف: { items, duplicatesInFile } — external_id المكرر داخل الملف يُعلَّم خطأً على العناصر اللاحقة. */
export function prepareAll(doc, ctx) {
  const seen = new Map();
  const items = arr(doc.challenges).map((raw, i) => {
    const it = prepareItem(raw, i, { ...ctx, importId: doc.import_id });
    if (it.external_id) {
      if (seen.has(it.external_id)) {
        it.errors.push({ field: 'external_id', code: 'duplicate_external_id', vars: { first: seen.get(it.external_id) + 1 } });
        it.payload = null;
      } else seen.set(it.external_id, i);
    }
    return it;
  });
  return items;
}

/** ملخّص المعاينة. serverStatus: Map(index → {status, code, field}) من الفحص الخادمي. */
export function summarize(items, serverStatus) {
  const s = { total: items.length, valid: 0, invalid: 0, duplicate: 0, byType: {}, byStage: {}, warnings: 0 };
  items.forEach((it) => {
    const sv = serverStatus?.get(it.index);
    s.byType[it.type || '?'] = (s.byType[it.type || '?'] || 0) + 1;
    s.byStage[it.stageId || it.stage_ref || '?'] = (s.byStage[it.stageId || it.stage_ref || '?'] || 0) + 1;
    s.warnings += it.warnings.length;
    if (sv?.status === 'duplicate') s.duplicate += 1;
    else if (it.errors.length || sv?.status === 'error') s.invalid += 1;
    else s.valid += 1;
  });
  return s;
}

export function chunk(list, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ---------- ملف النموذج: مثال صحيح لكل نوع، بنية النظام الفعلية ---------- */
const T = (ar, fr, en) => ({ ar, fr, en });
export function buildTemplate() {
  const common = { stage_ref: 'game-slug/track-slug/category-slug/stage-slug', difficulty: 1, points: 10, default_language: 'en' };
  const tr = (title, prompt, extra = {}) => ({
    ar: { title: title.ar, prompt: prompt.ar, ...(extra.ar || {}) },
    fr: { title: title.fr, prompt: prompt.fr, ...(extra.fr || {}) },
    en: { title: title.en, prompt: prompt.en, ...(extra.en || {}) },
  });
  return {
    schema_version: IMPORT_SCHEMA_VERSION,
    import_id: 'sample-import-001',
    description: 'Replace import_id with a unique name for each file. stage_ref = existing stage UUID or "game/track/category/stage" slugs. All challenges are created as drafts.',
    challenges: [
      {
        external_id: 'mc-001', ...common, type: 'multiple_choice',
        translations: tr(T('عاصمة فرنسا', 'Capitale de la France', 'Capital of France'), T('ما عاصمة فرنسا؟', 'Quelle est la capitale de la France ?', 'What is the capital of France?'),
          { en: { feedback: 'Paris is the capital of France.', hints: ['Think of the Eiffel Tower.'] } }),
        content: { options: [{ id: 'o1', text: T('باريس', 'Paris', 'Paris') }, { id: 'o2', text: T('ليون', 'Lyon', 'Lyon') }, { id: 'o3', text: T('مرسيليا', 'Marseille', 'Marseille') }] },
        solution: { choice: 'o1' },
      },
      {
        external_id: 'fb-001', ...common, type: 'fill_blanks',
        translations: tr(T('إكمال الجملة', 'Compléter la phrase', 'Complete the sentence'), T('اختر الكلمة المناسبة لكل فراغ.', 'Choisissez le bon mot pour chaque blanc.', 'Pick the right word for each blank.')),
        content: {
          template: T('{{b1}} هي لغة برمجة', '{{b1}} est un langage de programmation', '{{b1}} is a programming language'),
          blanks: [{ id: 'b1', options: [{ id: 'o1', text: T('بايثون', 'Python', 'Python') }, { id: 'o2', text: T('كوبرا', 'Cobra', 'Cobra') }] }],
        },
        solution: { blanks: { b1: 'o1' } },
      },
      {
        external_id: 'dr-001', ...common, type: 'drag_reorder',
        translations: tr(T('رتّب الخطوات', 'Remettre dans l’ordre', 'Put in order'), T('رتّب الخطوات من الأولى إلى الأخيرة.', 'Classez les étapes de la première à la dernière.', 'Order the steps from first to last.')),
        content: { items: [{ id: 'i1', text: T('اكتب الكود', 'Écrire le code', 'Write the code') }, { id: 'i2', text: T('شغّل الكود', 'Exécuter le code', 'Run the code') }, { id: 'i3', text: T('اقرأ النتيجة', 'Lire le résultat', 'Read the result') }] },
        solution: { order: ['i1', 'i2', 'i3'] },
      },
      {
        external_id: 'fe-001', ...common, type: 'find_error',
        translations: tr(T('ابحث عن الخطأ', 'Trouver l’erreur', 'Find the error'), T('أي سطر فيه الخطأ؟', 'Quelle ligne contient l’erreur ?', 'Which line has the error?')),
        content: {
          code_lang: 'python',
          lines: ['name = "IAE"', 'print(nmae)', 'print("done")'],
          fix_options: [{ id: 'f1', value: 'print(name)' }, { id: 'f2', value: 'print(nmae())' }],
        },
        solution: { line: 2, fix: 'f1' },
      },
      {
        external_id: 'mp-001', ...common, type: 'match_pairs',
        translations: tr(T('طابق الأزواج', 'Associer les paires', 'Match the pairs'), T('اربط كل مصطلح بتعريفه.', 'Associez chaque terme à sa définition.', 'Match each term with its definition.')),
        content: {
          left: [{ id: 'l1', text: T('HTML', 'HTML', 'HTML') }, { id: 'l2', text: T('CSS', 'CSS', 'CSS') }],
          right: [{ id: 'r1', text: T('تنسيق الصفحة', 'Mise en forme', 'Styling') }, { id: 'r2', text: T('هيكل الصفحة', 'Structure', 'Structure') }],
        },
        solution: { pairs: { l1: 'r2', l2: 'r1' } },
      },
      {
        external_id: 'po-001', ...common, type: 'predict_output',
        translations: tr(T('توقّع الناتج', 'Prédire la sortie', 'Predict the output'), T('ماذا يطبع هذا الكود؟', 'Que affiche ce code ?', 'What does this code print?')),
        content: { code: 'x = 2\nprint(x * 3)', code_lang: 'python', options: [{ id: 'o1', value: '6' }, { id: 'o2', value: '23' }, { id: 'o3', value: '5' }] },
        solution: { choice: 'o1' },
      },
      {
        external_id: 'cc-001', ...common, type: 'code_completion',
        translations: tr(T('أكمل الكود', 'Compléter le code', 'Complete the code'), T('اختر ما يملأ الفراغ.', 'Choisissez ce qui complète le blanc.', 'Pick what fills the slot.')),
        content: { code: 'for i in {{s1}}(3):\n    print(i)', code_lang: 'python', slots: [{ id: 's1', options: [{ id: 'o1', value: 'range' }, { id: 'o2', value: 'len' }] }] },
        solution: { slots: { s1: 'o1' } },
      },
    ],
  };
}
