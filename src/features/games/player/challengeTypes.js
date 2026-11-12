import { pickLocalized } from '../services/gamesCore.shared';

/**
 * أنواع الإجابة العامة المدعومة في واجهة التحدي. المرحلة 4 بلا ألعاب فعلية: هذا مجرّد عقد على content (الجزء العلني فقط):
 *   content = { prompt: نص | {ar,fr,en}, answer_type: 'choice' | 'text' | 'number' | 'json', options?: [قيمة | {value, label}],
 *               placeholder?, hint? }
 * الإجابة المرسلة هي قيمة JSON تُطابَق على الخادم مع الحلّ المحفوظ (exact)؛ لا تحقق ولا نتيجة هنا.
 * نوع غير معروف = «غير مدعوم» فلا تُستهلك محاولة. ألعاب المراحل اللاحقة تضيف نوعها هنا (أو في KIND_RENDERERS) دون مساس بالصفحات.
 */
export const SUPPORTED_ANSWER_TYPES = ['choice', 'text', 'number', 'json'];

/** مكوّنات مخصّصة بحسب games.kind (فارغ الآن: المرحلة اللاحقة تسجّل هنا). */
export const KIND_RENDERERS = {};

export function resolveAnswerType(content, kind) {
  if (kind && KIND_RENDERERS[kind]) return 'custom';
  const c = content && typeof content === 'object' ? content : {};
  const declared = typeof c.answer_type === 'string' ? c.answer_type : null;
  if (declared) return SUPPORTED_ANSWER_TYPES.includes(declared) ? declared : null;
  return Array.isArray(c.options) && c.options.length ? 'choice' : 'text';
}

export function getPrompt(content, lang) {
  const p = content?.prompt;
  if (typeof p === 'string') return p;
  return pickLocalized(p, lang);
}

export function getOptions(content, lang) {
  const list = Array.isArray(content?.options) ? content.options.slice(0, 50) : [];
  return list.map((o, i) => {
    if (o && typeof o === 'object' && !Array.isArray(o) && 'value' in o) {
      const label = typeof o.label === 'string' ? o.label : pickLocalized(o.label, lang);
      return { key: i, value: o.value, label: label || String(o.value) };
    }
    return { key: i, value: o, label: typeof o === 'string' ? o : JSON.stringify(o) };
  });
}

/** raw (حالة الواجهة) → { ok, value } قيمة JSON للإرسال. */
export function toAnswer(type, raw) {
  if (type === 'custom') return raw === undefined || raw === null ? { ok: false } : { ok: true, value: raw };
  if (type === 'choice') return raw === undefined || raw === null ? { ok: false } : { ok: true, value: raw };
  if (type === 'text') {
    const v = String(raw ?? '').trim();
    return v ? { ok: true, value: v } : { ok: false };
  }
  if (type === 'number') {
    const s = String(raw ?? '').trim();
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (type === 'json') {
    try {
      const v = JSON.parse(String(raw ?? ''));
      return v === null ? { ok: false } : { ok: true, value: v };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}
