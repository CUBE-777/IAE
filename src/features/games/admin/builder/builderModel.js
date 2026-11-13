/**
 * src/features/games/admin/builder/builderModel.js — منطق محرر التحديات (6.3) النقي (بلا React ولا شبكة).
 *
 * النموذج (model) حالة الواجهة؛ toDraftData(model) يحوّله إلى ما يستقبله admin_save_game_challenge_draft (0057):
 *   content = الجزء العلني فقط (بلا حلّ ولا شرح) · solution = الإجابة الصحيحة بعقد الإرسال · feedback = شرح الإجابة (يبقى في الخادم).
 * التحقق هنا (validateModel) مرآة لتجربة المستخدم فقط؛ الحَكَم الفعلي هو الخادم (game_builder_validate عند النشر).
 * لا تنفيذ لأي كود: كل الإجابات اختيارات/عناصر محددة مسبقًا.
 */
import { LANGS } from '../constants/gamesAdmin';
import { cleanI18n } from '../services/gamesAdmin.shared';

export const BUILDER_TYPES = ['multiple_choice', 'fill_blanks', 'drag_reorder', 'find_error', 'match_pairs', 'predict_output', 'code_completion'];
export const CODE_LANGS = ['text', 'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'php', 'sql', 'html', 'css', 'bash', 'json'];

/** حدود تطابق الخادم (0057). */
export const LIMITS = {
  options: [2, 8], items: [2, 10], pairs: [2, 8], blanks: [1, 10], slots: [1, 10], lines: [2, 60], fix: [2, 6],
  hints: 5, text: 300, prompt: 2000, instructions: 1000, template: 3000, code: 4000, feedback: 2000, title: 200, description: 2000, line: 300,
};

export const MARKER_RE = /\{\{([A-Za-z0-9_-]{1,32})\}\}/g;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const blankText = () => ({ ar: '', fr: '', en: '' });
const txt = (o) => ({ ...blankText(), ...(o || {}) });

/** أصغر معرّف غير مستعمل بالبادئة (o1, o2, …). */
export function nextId(prefix, list) {
  const taken = new Set((list || []).map((x) => x.id));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

const opt = (id) => ({ id, text: blankText() });
const lit = (id) => ({ id, value: '' });

export function emptyData(type) {
  switch (type) {
    case 'multiple_choice': return { options: [opt('o1'), opt('o2')], correct: null };
    case 'predict_output': return { code: '', codeLang: 'python', options: [lit('o1'), lit('o2')], correct: null };
    case 'fill_blanks': return { template: blankText(), blanks: [{ id: 'b1', options: [opt('o1'), opt('o2')], correct: null }] };
    case 'drag_reorder': return { items: [opt('i1'), opt('i2'), opt('i3')] };
    case 'find_error': return { codeLang: 'python', lines: '', errorLine: null, askFix: false, fixOptions: [lit('f1'), lit('f2')], fix: null };
    case 'match_pairs': return { pairs: [{ id: 'p1', left: blankText(), right: blankText() }, { id: 'p2', left: blankText(), right: blankText() }] };
    case 'code_completion': return { code: '', codeLang: 'python', slots: [{ id: 's1', options: [lit('o1'), lit('o2')], correct: null }] };
    default: return {};
  }
}

export function emptyModel(type = 'multiple_choice', base = {}) {
  return {
    type,
    defaultLang: base.defaultLang || 'ar',
    allowFallback: base.allowFallback !== false,
    title: txt(base.title),
    description: txt(base.description),
    difficulty: base.difficulty || 1,
    points: base.points ?? 10,
    timeLimit: base.timeLimit ?? '',
    maxAttempts: base.maxAttempts ?? '',
    changeNote: '',
    prompt: blankText(),
    instructions: blankText(),
    hints: [],
    feedback: blankText(),
    data: emptyData(type),
  };
}

/* ---------- خلط حتمي: ترتيب المحتوى العلني لا يطابق الحلّ (الخادم يرفض التطابق) ---------- */
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** يخلط نسخة من المصفوفة بذرة ثابتة، وإن بقيت بترتيبها الأصلي (n ≥ 2) يدوّرها موضعًا واحدًا. */
export function shuffleNonIdentity(list, seedText) {
  const a = list.slice();
  const rnd = seeded(seedText);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.length >= 2 && a.every((x, i) => x === list[i])) a.push(a.shift());
  return a;
}

/* ---------- النموذج → الحمولة ---------- */
const optText = (o) => cleanI18n(o.text) || {};
const strOpt = (o) => ({ id: o.id, value: String(o.value ?? '') });
const ids = (list) => list.map((x) => x.id);
const pairL = (p) => `${p.id}_l`;
const pairR = (p) => `${p.id}_r`;

export function splitLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

/** { content, solution } من النموذج. الحقول الفارغة تُحذف (المسودّة قد تكون ناقصة؛ الخادم يطبّق الكامل عند النشر). */
export function buildContent(model) {
  const { type, data } = model;
  const content = { answer_type: 'builder', challenge_type: type, schema_version: 1 };
  const prompt = cleanI18n(model.prompt);
  if (prompt) content.prompt = prompt;
  const instructions = cleanI18n(model.instructions);
  if (instructions) content.instructions = instructions;
  const hints = model.hints.map((h) => cleanI18n(h)).filter(Boolean);
  if (hints.length) content.hints = hints;
  const code = (v) => { if (String(v || '').trim()) content.code = String(v).replace(/\r\n?/g, '\n'); };
  let solution = {};

  if (type === 'multiple_choice') {
    content.options = data.options.map((o) => ({ id: o.id, text: optText(o) }));
    if (data.correct) solution = { choice: data.correct };
  } else if (type === 'predict_output') {
    code(data.code);
    if (data.codeLang) content.code_lang = data.codeLang;
    content.options = data.options.map(strOpt);
    if (data.correct) solution = { choice: data.correct };
  } else if (type === 'fill_blanks') {
    const tpl = cleanI18n(data.template);
    if (tpl) content.template = tpl;
    content.blanks = data.blanks.map((b) => ({ id: b.id, options: b.options.map((o) => ({ id: o.id, text: optText(o) })) }));
    solution = { blanks: Object.fromEntries(data.blanks.filter((b) => b.correct).map((b) => [b.id, b.correct])) };
  } else if (type === 'drag_reorder') {
    content.items = shuffleNonIdentity(data.items, ids(data.items).join('|') + data.items.map((o) => o.text.en || o.text.fr || o.text.ar).join('|'))
      .map((o) => ({ id: o.id, text: optText(o) }));
    solution = { order: ids(data.items) };
  } else if (type === 'find_error') {
    if (data.codeLang) content.code_lang = data.codeLang;
    content.lines = splitLines(data.lines);
    const fixes = data.askFix ? data.fixOptions : [];
    if (fixes.length) content.fix_options = fixes.map(strOpt);
    if (data.errorLine) {
      solution = { line: data.errorLine };
      if (fixes.length && data.fix) solution.fix = data.fix;
    }
  } else if (type === 'match_pairs') {
    content.left = data.pairs.map((p) => ({ id: pairL(p), text: cleanI18n(p.left) || {} }));
    const rights = data.pairs.map((p) => ({ id: pairR(p), text: cleanI18n(p.right) || {} }));
    content.right = shuffleNonIdentity(rights, rights.map((r) => r.id + (r.text.en || r.text.fr || r.text.ar || '')).join('|'));
    solution = { pairs: Object.fromEntries(data.pairs.map((p) => [pairL(p), pairR(p)])) };
  } else if (type === 'code_completion') {
    code(data.code);
    if (data.codeLang) content.code_lang = data.codeLang;
    content.slots = data.slots.map((s) => ({ id: s.id, options: s.options.map(strOpt) }));
    solution = { slots: Object.fromEntries(data.slots.filter((s) => s.correct).map((s) => [s.id, s.correct])) };
  }
  return { content, solution };
}

const intOrNull = (s) => (String(s ?? '').trim() === '' ? null : Number(s));

/** الحمولة الكاملة لـ admin_save_game_challenge_draft. game_id وslug يُضافان عند إنشاء تحدٍّ جديد فقط (من المستدعي). */
export function toDraftData(model) {
  const { content, solution } = buildContent(model);
  return {
    default_language: model.defaultLang,
    allow_language_fallback: !!model.allowFallback,
    title: cleanI18n(model.title) || {},
    description: cleanI18n(model.description),
    difficulty: Number(model.difficulty),
    points_reward: Number(model.points),
    time_limit_seconds: intOrNull(model.timeLimit),
    max_attempts: intOrNull(model.maxAttempts),
    content,
    solution,
    feedback: cleanI18n(model.feedback),
    change_note: model.changeNote?.trim() || null,
  };
}

/* ---------- الإصدار → النموذج ---------- */
const arr = (v) => (Array.isArray(v) ? v : []);
const txtOf = (o) => txt(o && typeof o === 'object' ? o : {});
const optIn = (o) => ({ id: String(o?.id ?? ''), text: txtOf(o?.text) });
const litIn = (o) => ({ id: String(o?.id ?? ''), value: typeof o?.value === 'string' ? o.value : '' });

/** يعيد { model, legacy }. legacy = المحتوى ليس من المحرر (JSON حر قديم): يبدأ المحرر من نوع فارغ مع حقول التحدي. */
export function fromVersion(version, solutionRow) {
  const v = version || {};
  const c = v.content && typeof v.content === 'object' ? v.content : {};
  const base = {
    defaultLang: LANGS.includes(v.default_language) ? v.default_language : 'ar',
    allowFallback: v.allow_language_fallback !== false,
    title: v.title, description: v.description, difficulty: v.difficulty, points: v.points_reward,
    timeLimit: v.time_limit_seconds ?? '', maxAttempts: v.max_attempts ?? '',
  };
  const type = c.challenge_type;
  if (c.answer_type !== 'builder' || !BUILDER_TYPES.includes(type)) return { model: emptyModel('multiple_choice', base), legacy: true };

  const sol = solutionRow?.solution && typeof solutionRow.solution === 'object' ? solutionRow.solution : {};
  const m = emptyModel(type, base);
  m.prompt = txtOf(c.prompt);
  m.instructions = txtOf(c.instructions);
  m.hints = arr(c.hints).map(txtOf);
  m.feedback = txtOf(solutionRow?.feedback);

  if (type === 'multiple_choice') {
    m.data = { options: arr(c.options).map(optIn), correct: typeof sol.choice === 'string' ? sol.choice : null };
  } else if (type === 'predict_output') {
    m.data = { code: typeof c.code === 'string' ? c.code : '', codeLang: c.code_lang || 'python', options: arr(c.options).map(litIn), correct: typeof sol.choice === 'string' ? sol.choice : null };
  } else if (type === 'fill_blanks') {
    const map = sol.blanks && typeof sol.blanks === 'object' ? sol.blanks : {};
    m.data = {
      template: txtOf(c.template),
      blanks: arr(c.blanks).map((b) => ({ id: String(b?.id ?? ''), options: arr(b?.options).map(optIn), correct: typeof map[b?.id] === 'string' ? map[b.id] : null })),
    };
  } else if (type === 'drag_reorder') {
    const items = arr(c.items).map(optIn);
    const order = arr(sol.order);
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    m.data = { items: ordered.length === items.length ? ordered : items };
  } else if (type === 'find_error') {
    const fixes = arr(c.fix_options).map(litIn);
    m.data = {
      codeLang: c.code_lang || 'python', lines: arr(c.lines).map(String).join('\n'),
      errorLine: Number.isInteger(sol.line) ? sol.line : null,
      askFix: fixes.length > 0, fixOptions: fixes.length ? fixes : emptyData('find_error').fixOptions, fix: typeof sol.fix === 'string' ? sol.fix : null,
    };
  } else if (type === 'match_pairs') {
    const left = arr(c.left).map(optIn);
    const right = new Map(arr(c.right).map(optIn).map((r) => [r.id, r]));
    const map = sol.pairs && typeof sol.pairs === 'object' ? sol.pairs : {};
    m.data = { pairs: left.map((l, i) => ({ id: `p${i + 1}`, left: l.text, right: right.get(map[l.id])?.text || blankText() })) };
  } else if (type === 'code_completion') {
    const map = sol.slots && typeof sol.slots === 'object' ? sol.slots : {};
    m.data = {
      code: typeof c.code === 'string' ? c.code : '', codeLang: c.code_lang || 'python',
      slots: arr(c.slots).map((s) => ({ id: String(s?.id ?? ''), options: arr(s?.options).map(litIn), correct: typeof map[s?.id] === 'string' ? map[s.id] : null })),
    };
  }
  return { model: m, legacy: false };
}

/* ---------- التحقق (واجهة فقط) ---------- */
const filled = (o, l) => typeof o?.[l] === 'string' && o[l].trim() !== '';
const markersOf = (s) => [...String(s || '').matchAll(MARKER_RE)].map((x) => x[1]);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
const inRange = (n, [min, max]) => n >= min && n <= max;
const dup = (list) => new Set(list).size !== list.length;

function checkList(list, [min, max], def, literal, add, kind) {
  if (!inRange(list.length, [min, max])) add('optionsCount', { min, max, kind });
  let empty = false;
  const seen = list.map((o) => {
    if (literal ? !String(o.value ?? '').trim() : !filled(o.text, def)) empty = true;
    return literal ? String(o.value ?? '').trim() : String(o.text?.[def] ?? '').trim().toLowerCase();
  });
  if (empty) add('optionEmpty', { kind });
  if (!empty && dup(seen)) add('optionDuplicate', { kind });
}

/** يعيد قائمة { code, vars } (فارغة = صالح للنشر). code مفتاح في games.admin.builder.problems. */
export function validateModel(model) {
  const out = [];
  const add = (code, vars) => out.push({ code, vars: vars || {} });
  const def = model.defaultLang;
  const { type, data } = model;

  if (!filled(model.title, def)) add('titleDefault');
  if (!filled(model.prompt, def)) add('promptDefault');
  if (model.instructions && cleanI18n(model.instructions) && !filled(model.instructions, def)) add('instructionsDefault');
  if (!Number.isInteger(Number(model.points)) || Number(model.points) < 0 || Number(model.points) > 10000) add('pointsRange');
  const tl = intOrNull(model.timeLimit);
  if (tl !== null && !(Number.isInteger(tl) && tl >= 5 && tl <= 86400)) add('timeRange');
  const ma = intOrNull(model.maxAttempts);
  if (ma !== null && !(Number.isInteger(ma) && ma >= 1 && ma <= 1000)) add('attemptsRange');
  if (model.hints.length > LIMITS.hints) add('hintsMax', { max: LIMITS.hints });
  if (model.hints.some((h) => cleanI18n(h) && !filled(h, def))) add('hintDefault');
  if (cleanI18n(model.feedback) && !filled(model.feedback, def)) add('feedbackDefault');

  if (type === 'multiple_choice') {
    checkList(data.options, LIMITS.options, def, false, add, 'options');
    if (!data.options.some((o) => o.id === data.correct)) add('correctMissing');
  } else if (type === 'predict_output') {
    if (!String(data.code || '').trim()) add('codeRequired');
    checkList(data.options, LIMITS.options, def, true, add, 'outputs');
    if (!data.options.some((o) => o.id === data.correct)) add('correctMissing');
  } else if (type === 'fill_blanks') {
    if (!inRange(data.blanks.length, LIMITS.blanks)) add('blanksCount', { min: LIMITS.blanks[0], max: LIMITS.blanks[1] });
    if (!filled(data.template, def)) add('templateDefault');
    const blankIds = ids(data.blanks);
    LANGS.forEach((l) => { if (filled(data.template, l) && !sameSet(markersOf(data.template[l]), blankIds)) add('markersMismatch', { lang: l }); });
    data.blanks.forEach((b, i) => {
      checkList(b.options, LIMITS.options, def, false, (c, v) => add(c, { ...v, n: i + 1 }), 'blank');
      if (!b.options.some((o) => o.id === b.correct)) add('blankCorrectMissing', { n: i + 1 });
    });
  } else if (type === 'drag_reorder') {
    checkList(data.items, LIMITS.items, def, false, add, 'items');
  } else if (type === 'find_error') {
    const lines = splitLines(data.lines);
    if (!inRange(lines.length, LIMITS.lines) || lines.filter((l) => l.trim()).length < 2) add('linesCount', { min: LIMITS.lines[0], max: LIMITS.lines[1] });
    if (lines.some((l) => l.length > LIMITS.line)) add('lineTooLong', { max: LIMITS.line });
    if (!data.errorLine || !lines[data.errorLine - 1] || !lines[data.errorLine - 1].trim()) add('errorLineMissing');
    if (data.askFix) {
      checkList(data.fixOptions, LIMITS.fix, def, true, add, 'fixes');
      if (!data.fixOptions.some((o) => o.id === data.fix)) add('fixMissing');
    }
  } else if (type === 'match_pairs') {
    if (!inRange(data.pairs.length, LIMITS.pairs)) add('optionsCount', { min: LIMITS.pairs[0], max: LIMITS.pairs[1], kind: 'pairs' });
    if (data.pairs.some((p) => !filled(p.left, def) || !filled(p.right, def))) add('pairEmpty');
    else {
      if (dup(data.pairs.map((p) => p.left[def].trim().toLowerCase()))) add('pairDuplicate', { side: 'left' });
      if (dup(data.pairs.map((p) => p.right[def].trim().toLowerCase()))) add('pairDuplicate', { side: 'right' });
    }
  } else if (type === 'code_completion') {
    if (!String(data.code || '').trim()) add('codeRequired');
    else if (!sameSet(markersOf(data.code), ids(data.slots))) add('markersMismatch', { lang: '' });
    if (!inRange(data.slots.length, LIMITS.slots)) add('blanksCount', { min: LIMITS.slots[0], max: LIMITS.slots[1] });
    data.slots.forEach((s, i) => {
      checkList(s.options, LIMITS.options, def, true, (c, v) => add(c, { ...v, n: i + 1 }), 'slot');
      if (!s.options.some((o) => o.id === s.correct)) add('blankCorrectMissing', { n: i + 1 });
    });
  }
  const allIds = [...(data.options || []), ...(data.items || [])].map((o) => o.id);
  if (allIds.some((id) => !ID_RE.test(id))) add('idInvalid');
  return out;
}

/* ---------- حالة الترجمة لكل لغة (للعرض فقط؛ لا تُفرض اكتمال اللغات) ---------- */
export function collectTexts(model) {
  const { type, data } = model;
  const list = [model.title, model.description, model.prompt, model.instructions, model.feedback, ...model.hints];
  if (type === 'multiple_choice' || type === 'drag_reorder') list.push(...(data.options || data.items).map((o) => o.text));
  if (type === 'fill_blanks') {
    list.push(data.template);
    data.blanks.forEach((b) => list.push(...b.options.map((o) => o.text)));
  }
  if (type === 'match_pairs') data.pairs.forEach((p) => list.push(p.left, p.right));
  return list;
}

/** { ar: {filled, total}, … }: total = الحقول المعبّأة بأي لغة (الحقل الفارغ بكل اللغات لا يُحسب). */
export function translationStats(model) {
  const texts = collectTexts(model).filter((o) => LANGS.some((l) => filled(o, l)));
  return Object.fromEntries(LANGS.map((l) => [l, { filled: texts.filter((o) => filled(o, l)).length, total: texts.length }]));
}

/** نص بلغة مع fallback (اللغة المطلوبة ← الافتراضية إن سُمح). */
export function localize(obj, lang, def, fallback = true) {
  if (filled(obj, lang)) return obj[lang];
  return fallback && filled(obj, def) ? obj[def] : '';
}
