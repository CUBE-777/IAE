import { pickLocalized } from '../../services/gamesLang';

/**
 * عقد محتوى التحديات التفاعلية (6.5) من جهة اللاعب. يطابق ما ينتجه Builder (admin/builder/builderModel.js → buildContent)
 * وما يتحقق منه الخادم (0057)، دون الاستيراد من وحدة الإدارة كي لا تدخل شيفرتها في حزمة اللاعب.
 *
 * المحتوى هنا «علني» فقط (بلا حلّ ولا شرح). كل دوال هذا الملف نقية: لا شبكة ولا تصحيح ولا نقاط.
 * الخادم وحده يصحّح (game_verify_answer = مطابقة تامة)، لذلك شكل الإجابة المبني هنا يجب أن يطابق عقد 0057 حرفيًا:
 *   multiple_choice {choice} · predict_output {choice} · fill_blanks {blanks:{id:optionId}} · code_completion {slots:{id:optionId}}
 *   drag_reorder {order:[id,…]} · find_error {line:n[, fix:id]} · match_pairs {pairs:{leftId:rightId}}
 * لا تنفيذ لأي كود: كل الإجابات اختيارات/عناصر محدّدة سلفًا.
 */

export const BUILDER_TYPES = ['multiple_choice', 'fill_blanks', 'drag_reorder', 'find_error', 'match_pairs', 'predict_output', 'code_completion'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** قراءة خاصية «مملوكة» فقط (المعرّفات تقبل نمط [A-Za-z0-9_-] فلا نثق بسلسلة النموذج الأولي مثل __proto__). */
export const getOwn = (o, k) => (isObj(o) && own(o, k) ? o[k] : undefined);

/** هل هذا محتوى من محرر التحديات بنوع معروف؟ (غيره لا يُعرض بواجهة المحرر). */
export function isBuilderContent(content) {
  return isObj(content) && content.answer_type === 'builder' && BUILDER_TYPES.includes(content.challenge_type);
}

export const builderType = (content) => (isBuilderContent(content) ? content.challenge_type : null);

/** نص متعدد اللغات {ar,fr,en}: اللغة المطلوبة ← الافتراضية للإصدار ← ترتيب الاحتياط. المنطق الموحّد في services/gamesLang.js (نفسه لعنوان التحدي ووصفه). */
export const pickText = pickLocalized;

/** [{id, text}] — عناصر بنص متعدد اللغات. تُهمَل العناصر بلا معرّف نصي. */
export function optionsOf(arr) {
  return list(arr).filter((o) => isObj(o) && typeof o.id === 'string' && o.id).map((o) => ({ id: o.id, text: isObj(o.text) ? o.text : {} }));
}

/** [{id, value}] — عناصر بنص حرفي (كود/ناتج) لا يتغيّر بالترجمة. */
export function literalOptionsOf(arr) {
  return list(arr).filter((o) => isObj(o) && typeof o.id === 'string' && o.id).map((o) => ({ id: o.id, value: typeof o.value === 'string' ? o.value : '' }));
}

/** [{id, options:[…]}] لفراغات fill_blanks (نصية) أو فتحات code_completion (حرفية). */
export function groupsOf(arr, literal) {
  return list(arr).filter((g) => isObj(g) && typeof g.id === 'string' && g.id)
    .map((g) => ({ id: g.id, options: literal ? literalOptionsOf(g.options) : optionsOf(g.options) }));
}

const ids = (items) => items.map((o) => o.id);

/** يقسم نصًّا على علامات {{id}}: [{text}] أو [{id}] بترتيب الورود. */
export function splitMarkers(text) {
  const parts = String(text ?? '').split(/\{\{([A-Za-z0-9_-]{1,32})\}\}/);
  return parts.map((p, i) => (i % 2 ? { id: p } : { text: p })).filter((p) => p.id !== undefined || p.text !== '');
}

/** الترتيب الأوّلي لعناصر drag_reorder كما وصل من الخادم (مخلوط بحيث لا يطابق الحلّ). */
export const initialOrder = (content) => ids(optionsOf(content?.items));

const has = (allowed, v) => typeof v === 'string' && allowed.includes(v);
const isPermutation = (a, allowed) => Array.isArray(a) && a.length === allowed.length && new Set(a).size === a.length && a.every((x) => allowed.includes(x));

const groupsForType = (content, type) => (type === 'fill_blanks' ? groupsOf(content.blanks, false) : groupsOf(content.slots, true));

/**
 * ينقّي حالة الواجهة (raw) بحيث لا تحتوي إلا معرّفات موجودة فعلًا في المحتوى. يُستعمل لاستعادة مسودّة محفوظة محليًا
 * (قد تكون من نسخة قديمة أو معدّلة) ولضمان أن ما يُرسل لا يخرج عن عناصر التحدي. undefined = لا شيء صالح.
 */
export function sanitizeRaw(content, raw) {
  const type = builderType(content);
  if (!type || raw === undefined || raw === null) return undefined;

  if (type === 'multiple_choice' || type === 'predict_output') {
    return has(ids(type === 'predict_output' ? literalOptionsOf(content.options) : optionsOf(content.options)), raw) ? raw : undefined;
  }
  if (type === 'fill_blanks' || type === 'code_completion') {
    if (!isObj(raw)) return undefined;
    const pairs = groupsForType(content, type)
      .filter((g) => own(raw, g.id) && has(ids(g.options), raw[g.id]))
      .map((g) => [g.id, raw[g.id]]);
    return Object.fromEntries(pairs);
  }
  if (type === 'drag_reorder') {
    return isPermutation(raw, initialOrder(content)) ? raw : undefined;
  }
  if (type === 'find_error') {
    if (!isObj(raw)) return undefined;
    const lines = list(content.lines);
    const out = {};
    const n = raw.line;
    if (Number.isInteger(n) && n >= 1 && n <= lines.length && String(lines[n - 1] ?? '').trim() !== '') out.line = n;
    if (has(ids(literalOptionsOf(content.fix_options)), raw.fix)) out.fix = raw.fix;
    return out;
  }
  if (type === 'match_pairs') {
    if (!isObj(raw)) return undefined;
    const rights = ids(optionsOf(content.right));
    const used = new Set();
    const pairs = [];
    ids(optionsOf(content.left)).forEach((l) => {
      const r = own(raw, l) ? raw[l] : undefined;
      if (has(rights, r) && !used.has(r)) {
        used.add(r);
        pairs.push([l, r]);
      }
    });
    return Object.fromEntries(pairs);
  }
  return undefined;
}

/**
 * raw (حالة الواجهة) → { ok, value } بعقد الإرسال. ok=false إن كانت الإجابة ناقصة (فراغ بلا اختيار، سطر غير محدّد، زوج غير مربوط…).
 * هذا فحص «اكتمال» فقط لتجنّب استهلاك المحاولة بإجابة ناقصة، وليس تحقّقًا من الصحة.
 */
export function toBuilderAnswer(content, raw) {
  const type = builderType(content);
  if (!type) return { ok: false };
  const v = sanitizeRaw(content, raw);

  if (type === 'multiple_choice' || type === 'predict_output') {
    return v === undefined ? { ok: false } : { ok: true, value: { choice: v } };
  }
  if (type === 'fill_blanks' || type === 'code_completion') {
    const groups = groupsForType(content, type);
    if (!groups.length || !v || groups.some((g) => !own(v, g.id))) return { ok: false };
    return { ok: true, value: { [type === 'fill_blanks' ? 'blanks' : 'slots']: Object.fromEntries(groups.map((g) => [g.id, v[g.id]])) } };
  }
  if (type === 'drag_reorder') {
    const order = v ?? initialOrder(content);
    return order.length >= 2 ? { ok: true, value: { order } } : { ok: false };
  }
  if (type === 'find_error') {
    const needFix = literalOptionsOf(content.fix_options).length > 0;
    if (!v || !Number.isInteger(v.line) || (needFix && !v.fix)) return { ok: false };
    return { ok: true, value: needFix ? { line: v.line, fix: v.fix } : { line: v.line } };
  }
  if (type === 'match_pairs') {
    const lefts = ids(optionsOf(content.left));
    if (!lefts.length || !v || lefts.some((l) => !own(v, l))) return { ok: false };
    return { ok: true, value: { pairs: Object.fromEntries(lefts.map((l) => [l, v[l]])) } };
  }
  return { ok: false };
}
