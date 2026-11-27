/**
 * نموذج تصميم الشهادة (Phase 2B.1) — دوال نقية بلا DOM ولا Supabase، قابلة للاختبار بـ node --test.
 *
 * يُخزَّن كله داخل certificate_templates.design (JSONB، الحد 20000 بايت في 0063):
 *   { page, colors, fonts,            ← موجودة أصلًا في القوالب الأربعة الافتراضية، وتُحفظ كما هي
 *     version: 1, background: { color }, elements: [...] }
 * الإحداثيات بالمليمتر على صفحة A4 أفقية 297×210. لا يُخزَّن PDF ولا ملف: الصور مضغوطة داخل data URI
 * أو رابط https، وكلاهما يُتحقَّق منه هنا (قائمة بيضاء) قبل الحفظ وبعد التحميل.
 */

export const PAGE_W = 297;
export const PAGE_H = 210;
/** حد القاعدة 20000؛ نترك هامشًا لفرق الترميز */
export const MAX_DESIGN_BYTES = 18000;
export const MAX_ELEMENTS = 60;
export const MAX_IMAGE_CHARS = 9000;
export const MIN_SIZE_MM = 2;

export const STYLES = ['academic', 'modern', 'premium', 'technology'];
export const LANGS = ['fr', 'ar', 'en'];
export const ELEMENT_TYPES = ['text', 'image', 'shape', 'qr'];
export const SHAPES = ['rect', 'ellipse', 'line'];
export const ALIGNS = ['start', 'center', 'end'];

/** مفاتيح الخطوط → سلاسل CSS. فقط الخطوط المحمَّلة فعلًا في التطبيق (Inter, IBM Plex Sans Arabic) + خطوط النظام. */
export const FONTS = {
  sans: "'Inter', 'IBM Plex Sans Arabic', 'Segoe UI', system-ui, sans-serif",
  arabic: "'IBM Plex Sans Arabic', 'Inter', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', 'IBM Plex Sans Arabic', serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'IBM Plex Sans Arabic', monospace",
};

/** أسماء المتغيّرات مطابقة لمفاتيح get_certificate_render_data (0064) */
export const VARIABLES = ['recipient_name', 'campaign_title', 'activity_title', 'activity_date', 'issued_at', 'certificate_number'];

/** بيانات تجريبية للمعاينة فقط — لا تُحفظ أبدًا داخل التصميم */
export const SAMPLE = {
  fr: { recipient_name: 'Sara El Amrani', campaign_title: 'Atelier de leadership', activity_title: 'Atelier de leadership étudiant', activity_date: '14 mars 2026', issued_at: '20 mars 2026', certificate_number: 'IAE-2026-000123' },
  ar: { recipient_name: 'سارة العمراني', campaign_title: 'ورشة القيادة', activity_title: 'ورشة القيادة الطلابية', activity_date: '14 مارس 2026', issued_at: '20 مارس 2026', certificate_number: 'IAE-2026-000123' },
  en: { recipient_name: 'Sara El Amrani', campaign_title: 'Leadership workshop', activity_title: 'Student leadership workshop', activity_date: 'March 14, 2026', issued_at: 'March 20, 2026', certificate_number: 'IAE-2026-000123' },
};

export const dirOf = (lang) => (lang === 'ar' ? 'rtl' : 'ltr');

// ------------------------------------------------------------------ أدوات صغيرة

export const uid = () => `e${Math.random().toString(36).slice(2, 9)}`;
const num = (v, min, max, d) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};
const r1 = (n) => Math.round(n * 10) / 10;
const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v, d) => (typeof v === 'string' && (HEX.test(v) || v === 'transparent') ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

/** data URI صغيرة بصيغ نقطية فقط (لا SVG) أو رابط https خالٍ من أحرف الحقن */
export function isSafeImageSrc(src) {
  if (typeof src !== 'string' || src.length === 0 || src.length > MAX_IMAGE_CHARS + 200) return false;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return true;
  return /^https:\/\/[^\s"'<>()\\]+$/.test(src) && src.length <= 500;
}

export const designBytes = (design) => new TextEncoder().encode(JSON.stringify(design)).length;

export function textOf(el, lang) {
  const t = el?.text || {};
  return t[lang] || t.fr || '';
}

/** استبدال {{var}} بالبيانات التجريبية؛ المتغيّر المجهول يبقى كما هو */
export function interpolate(text, data) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? data[k] : m));
}

// ------------------------------------------------------------------ مصانع العناصر

const base = (type, x, y, w, h) => ({ id: uid(), type, x: r1(x), y: r1(y), w: r1(w), h: r1(h), hidden: false, locked: false });
const L = (fr, ar, en) => ({ fr, ar: ar ?? fr, en: en ?? fr });

export function newText(o = {}) {
  return { ...base('text', 40, 90, 217, 14), text: L('Nouveau texte', 'نص جديد', 'New text'), font: 'sans', size: 14, color: '#202A36', align: 'center', bold: false, italic: false, ...o };
}
export function newShape(shape = 'rect', o = {}) {
  const line = shape === 'line';
  return { ...base('shape', 60, 70, line ? 100 : 60, line ? 1 : 40), shape, fill: line ? '#C5A45B' : '#E8EDF3', stroke: '#142B4A', strokeWidth: line ? 0 : 0.5, opacity: 1, ...o };
}
export function newImage(src, role = 'image', o = {}) {
  if (role === 'background') return { ...base('image', 0, 0, PAGE_W, PAGE_H), src, role, fit: 'cover', opacity: 1, ...o };
  if (role === 'logo') return { ...base('image', 20, 12, 30, 20), src, role, fit: 'contain', opacity: 1, ...o };
  return { ...base('image', 100, 60, 60, 40), src, role, fit: 'contain', opacity: 1, ...o };
}
export function newQr(o = {}) {
  return { ...base('qr', 133.5, 160, 30, 30), ...o };
}

export function duplicateElement(el) {
  return { ...JSON.parse(JSON.stringify(el)), id: uid(), x: r1(el.x + 5), y: r1(el.y + 5), locked: false, hidden: false };
}

/** تحريك طبقة في ترتيب الرسم (العنصر الأخير = الأعلى). dir: +1 للأعلى، -1 للأسفل */
export function moveLayer(elements, id, dir) {
  const i = elements.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= elements.length) return elements;
  const out = elements.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ------------------------------------------------------------------ التنظيف (قائمة بيضاء)

export function sanitizeElement(raw) {
  if (!raw || typeof raw !== 'object' || !ELEMENT_TYPES.includes(raw.type)) return null;
  const el = {
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(raw.id) ? raw.id : uid(),
    type: raw.type,
    x: r1(num(raw.x, -100, 400, 0)),
    y: r1(num(raw.y, -100, 300, 0)),
    w: r1(num(raw.w, MIN_SIZE_MM, 400, 20)),
    h: r1(num(raw.h, 0.2, 300, 10)),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
  };
  if (el.type === 'text') {
    const t = {};
    for (const l of LANGS) t[l] = typeof raw.text?.[l] === 'string' ? raw.text[l].slice(0, 400) : '';
    Object.assign(el, {
      text: t,
      font: oneOf(raw.font, Object.keys(FONTS), 'sans'),
      size: r1(num(raw.size, 4, 120, 14)),
      color: color(raw.color, '#202A36'),
      align: oneOf(raw.align, ALIGNS, 'center'),
      bold: raw.bold === true,
      italic: raw.italic === true,
    });
  } else if (el.type === 'image') {
    if (!isSafeImageSrc(raw.src)) return null;
    Object.assign(el, { src: raw.src, role: oneOf(raw.role, ['image', 'logo', 'background'], 'image'), fit: oneOf(raw.fit, ['contain', 'cover'], 'contain'), opacity: num(raw.opacity, 0, 1, 1) });
  } else if (el.type === 'shape') {
    Object.assign(el, {
      shape: oneOf(raw.shape, SHAPES, 'rect'),
      fill: color(raw.fill, 'transparent'),
      stroke: color(raw.stroke, '#142B4A'),
      strokeWidth: r1(num(raw.strokeWidth, 0, 10, 0.3)),
      opacity: num(raw.opacity, 0, 1, 1),
    });
  }
  return el;
}

/** هل يحتوي التصميم المخزَّن على تخطيط؟ (القوالب الافتراضية من 0063 بلا elements) */
export const hasLayout = (design) => Array.isArray(design?.elements);

/**
 * تنظيف تصميم كامل. يحتفظ بمفاتيح page/colors/fonts الموجودة (لا نتلفها) ويضمن A4 أفقي.
 */
export function sanitizeDesign(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const elements = (Array.isArray(d.elements) ? d.elements : []).slice(0, MAX_ELEMENTS).map(sanitizeElement).filter(Boolean);
  const seen = new Set();
  for (const e of elements) {
    while (seen.has(e.id)) e.id = uid();
    seen.add(e.id);
  }
  return {
    ...(d.colors && typeof d.colors === 'object' ? { colors: d.colors } : {}),
    ...(d.fonts && typeof d.fonts === 'object' ? { fonts: d.fonts } : {}),
    page: { format: 'A4', orientation: 'landscape', width_mm: PAGE_W, height_mm: PAGE_H },
    version: 1,
    background: { color: color(d.background?.color, '#FFFFFF') },
    elements,
  };
}

/** أخطاء الحفظ المحتملة بمفاتيح (تُترجم في الواجهة) */
export function validateForSave(design, name) {
  const errs = [];
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 80) errs.push('nameInvalid');
  if (design.elements.length > MAX_ELEMENTS) errs.push('tooManyElements');
  if (designBytes(design) > MAX_DESIGN_BYTES) errs.push('tooLarge');
  return errs;
}

// ------------------------------------------------------------------ القوالب الأربعة (تخطيطات ابتدائية)

const C = (design, k, d) => (typeof design?.colors?.[k] === 'string' && HEX.test(design.colors[k]) ? design.colors[k] : d);

const t = (x, y, w, h, text, o = {}) => newText({ x, y, w, h, text, ...o });
const rect = (x, y, w, h, o = {}) => newShape('rect', { x, y, w, h, ...o });
const line = (x, y, w, o = {}) => newShape('line', { x, y, w, h: 0.8, ...o });

const BODY = L(
  'Pour sa participation à « {{activity_title}} » le {{activity_date}}.',
  'تقديرًا لمشاركته في «{{activity_title}}» بتاريخ {{activity_date}}.',
  'In recognition of participation in "{{activity_title}}" on {{activity_date}}.',
);
const AWARDED = L('Décerné à', 'تُمنح إلى', 'Awarded to');
const TITLE = L('CERTIFICAT', 'شهادة', 'CERTIFICATE');
const DATE_L = L('Date : {{issued_at}}', 'التاريخ: {{issued_at}}', 'Date: {{issued_at}}');
const NUM_L = L('N° {{certificate_number}}', 'رقم {{certificate_number}}', 'No. {{certificate_number}}');

/** يبني تصميمًا ابتدائيًا لنمط معيّن، مع الاحتفاظ بألوان/خطوط القالب الموجودة */
export function presetDesign(style, existing = {}) {
  const navy = C(existing, 'navy', '#142B4A');
  const gold = C(existing, 'gold', '#C5A45B');
  const white = C(existing, 'white', '#FFFFFF');
  const dark = C(existing, 'dark', '#202A36');
  const silver = C(existing, 'silver', '#E8EDF3');
  let bg = white;
  let els;

  if (style === 'modern') {
    els = [
      rect(0, 0, 70, 210, { fill: navy, stroke: navy, strokeWidth: 0 }),
      rect(70, 0, 2.5, 210, { fill: gold, stroke: gold, strokeWidth: 0 }),
      t(90, 34, 185, 18, TITLE, { font: 'sans', size: 36, bold: true, color: navy, align: 'start' }),
      t(90, 54, 185, 9, L('{{campaign_title}}', '{{campaign_title}}', '{{campaign_title}}'), { size: 15, color: gold, align: 'start' }),
      t(90, 82, 185, 8, AWARDED, { size: 12, color: '#5A6675', align: 'start' }),
      t(90, 92, 185, 18, L('{{recipient_name}}'), { size: 30, bold: true, color: dark, align: 'start' }),
      t(90, 118, 185, 22, BODY, { size: 13, color: dark, align: 'start' }),
      t(90, 176, 90, 8, DATE_L, { size: 10, color: '#5A6675', align: 'start' }),
      t(185, 176, 90, 8, NUM_L, { size: 10, color: '#5A6675', align: 'end', font: 'mono' }),
      newQr({ x: 20, y: 160, w: 30, h: 30 }),
    ];
  } else if (style === 'premium') {
    bg = navy;
    els = [
      rect(8, 8, 281, 194, { stroke: gold, strokeWidth: 1.2 }),
      rect(13, 13, 271, 184, { stroke: gold, strokeWidth: 0.3 }),
      t(30, 30, 237, 20, TITLE, { font: 'serif', size: 40, bold: true, color: gold }),
      line(108, 56, 81, { fill: gold }),
      t(30, 66, 237, 8, AWARDED, { font: 'serif', size: 12, italic: true, color: silver }),
      t(30, 78, 237, 22, L('{{recipient_name}}'), { font: 'serif', size: 34, bold: true, color: white }),
      t(40, 108, 217, 22, BODY, { font: 'serif', size: 13, color: silver }),
      t(25, 180, 80, 8, DATE_L, { size: 10, color: silver, align: 'start' }),
      t(192, 180, 80, 8, NUM_L, { size: 10, color: silver, align: 'end', font: 'mono' }),
      newQr({ x: 133.5, y: 150, w: 30, h: 30 }),
    ];
  } else if (style === 'technology') {
    bg = '#0F1B2D';
    els = [
      rect(0, 0, 297, 3, { fill: '#2DD4BF', stroke: '#2DD4BF', strokeWidth: 0 }),
      rect(0, 207, 297, 3, { fill: '#2DD4BF', stroke: '#2DD4BF', strokeWidth: 0 }),
      t(20, 24, 257, 8, L('// IAE · {{campaign_title}}'), { font: 'mono', size: 11, color: '#2DD4BF', align: 'start' }),
      t(20, 44, 257, 20, TITLE, { font: 'sans', size: 38, bold: true, color: white, align: 'start' }),
      t(20, 82, 257, 8, AWARDED, { font: 'mono', size: 11, color: '#94A3B8', align: 'start' }),
      t(20, 92, 257, 18, L('{{recipient_name}}'), { size: 30, bold: true, color: '#2DD4BF', align: 'start' }),
      t(20, 118, 257, 22, BODY, { size: 13, color: silver, align: 'start' }),
      t(20, 184, 120, 8, DATE_L, { font: 'mono', size: 10, color: '#94A3B8', align: 'start' }),
      t(150, 184, 127, 8, NUM_L, { font: 'mono', size: 10, color: '#94A3B8', align: 'end' }),
      newQr({ x: 247, y: 150, w: 30, h: 30 }),
    ];
  } else {
    // academic (افتراضي)
    els = [
      rect(8, 8, 281, 194, { stroke: gold, strokeWidth: 0.9 }),
      rect(12, 12, 273, 186, { stroke: navy, strokeWidth: 0.3 }),
      t(30, 28, 237, 18, TITLE, { font: 'serif', size: 38, bold: true, color: navy }),
      t(30, 50, 237, 10, L('{{campaign_title}}'), { font: 'serif', size: 16, color: gold }),
      t(30, 74, 237, 8, AWARDED, { font: 'serif', size: 12, italic: true, color: '#5A6675' }),
      t(30, 84, 237, 20, L('{{recipient_name}}'), { font: 'serif', size: 32, bold: true, color: navy }),
      line(98, 108, 101, { fill: gold }),
      t(40, 116, 217, 22, BODY, { font: 'serif', size: 13, color: dark }),
      t(25, 176, 80, 8, DATE_L, { font: 'serif', size: 10, color: '#5A6675', align: 'start' }),
      t(192, 176, 80, 8, NUM_L, { font: 'serif', size: 10, color: '#5A6675', align: 'end' }),
      newQr({ x: 133.5, y: 150, w: 30, h: 30 }),
    ];
  }
  return sanitizeDesign({ ...existing, background: { color: bg }, elements: els });
}

// ------------------------------------------------------------------ التاريخ (Undo / Redo)

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

export const createHistory = (present) => ({ past: [], present, future: [], key: null, at: 0 });

/**
 * records:  لقطة قبل تغيير (key + at يدمجان ضغطات الكتابة المتتالية في خطوة واحدة)
 * live:     تحديث الحاضر دون تسجيل (أثناء السحب، بعد begin)
 * begin:    تسجيل لقطة واحدة قبل بدء سحب
 */
export function historyReducer(h, a) {
  switch (a.type) {
    case 'record': {
      if (a.key && a.key === h.key && a.at - h.at < COALESCE_MS) return { ...h, present: a.next, at: a.at };
      return { past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present], present: a.next, future: [], key: a.key || null, at: a.at || 0 };
    }
    case 'begin':
      return { past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present], present: h.present, future: [], key: null, at: 0 };
    case 'live':
      return { ...h, present: a.next };
    case 'undo':
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: null, at: 0 };
    case 'redo':
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: null, at: 0 };
    case 'reset':
      return createHistory(a.next);
    default:
      return h;
  }
}
