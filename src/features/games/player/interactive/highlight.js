/**
 * تحويل كود نصّي إلى أسطر من مقاطع ملوّنة (للعرض فقط). لا innerHTML: المقاطع تُرسم كعناصر React فيبقى النص مُهرَّبًا دائمًا.
 * Prism هنا لتحليل الرموز (tokenize) فقط؛ لا يُنفَّذ أي كود.
 */

/** code_lang في Builder → اسم قواعد Prism. text/غير معروف = بلا تلوين. */
const GRAMMAR = {
  python: 'python', javascript: 'javascript', typescript: 'typescript', java: 'java', c: 'c', cpp: 'cpp', csharp: 'csharp',
  php: 'php', sql: 'sql', html: 'markup', css: 'css', bash: 'bash', json: 'json',
};

/** أنواع رموز Prism → مجموعة ألوان صغيرة (الأصناف gp-tok-* في games-interactive.css). */
const KIND = {
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  string: 'string', char: 'string', 'attr-value': 'string', 'template-string': 'string', url: 'string',
  regex: 'regex', number: 'number',
  boolean: 'literal', constant: 'literal', symbol: 'literal', entity: 'literal',
  keyword: 'keyword', atrule: 'keyword', important: 'keyword',
  builtin: 'builtin', function: 'function', 'class-name': 'class', namespace: 'class',
  tag: 'tag', selector: 'tag', 'attr-name': 'attr', property: 'attr', variable: 'variable',
  operator: 'operator', punctuation: 'punct', deleted: 'deleted', inserted: 'inserted',
};

/** أول نوع معروف من (alias…، type). */
function kindOf(token) {
  const alias = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  const found = [...alias, token.type].find((k) => KIND[k]);
  return found ? KIND[found] : null;
}

function flatten(tokens, inherited, out) {
  tokens.forEach((t) => {
    if (typeof t === 'string') {
      out.push({ text: t, kind: inherited });
      return;
    }
    const kind = kindOf(t) || inherited;
    const c = t.content;
    if (Array.isArray(c)) flatten(c, kind, out);
    else if (typeof c === 'string') out.push({ text: c, kind });
    else if (c) flatten([c], kind, out);
  });
}

/** مقاطع [{text, kind}] → أسطر (مصفوفة مقاطع لكل سطر). الرمز متعدد الأسطر (تعليق/نص) يُقسَّم مع الحفاظ على لونه. */
function splitIntoLines(segments) {
  const lines = [[]];
  segments.forEach((s) => {
    s.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind: s.kind });
    });
  });
  return lines;
}

const plain = (src) => src.split('\n').map((text) => (text ? [{ text, kind: null }] : []));

/** src → أسطر مقاطع. prism=null أو لغة بلا قواعد ⇒ نص عادي. أي خطأ في التحليل ⇒ نص عادي. */
export function toLines(src, lang, prism) {
  const grammar = prism && GRAMMAR[lang] ? prism.languages?.[GRAMMAR[lang]] : null;
  if (!grammar) return plain(src);
  try {
    const out = [];
    flatten(prism.tokenize(src, grammar), null, out);
    return splitIntoLines(out);
  } catch {
    return plain(src);
  }
}

/* ---- فتحات code_completion: العلامة {{id}} تُستبدل بحرف خاص واحد قبل التحليل كي لا تُفسد الرموز، ثم تُرسم عنصرًا تفاعليًا ---- */
export const SLOT_FIRST = 0xe000;
export const SLOT_LAST = 0xe0ff;
export const SLOT_SPLIT = /([\ue000-\ue0ff])/;

const cleanCode = (code) => String(code ?? '').replace(/\r\n?/g, '\n').replace(/[\ue000-\ue0ff]/g, '');

/** { text, ids }: text = الكود وفيه حرف خاص لكل فتحة، وids[i] = معرّف الفتحة ذات الحرف SLOT_FIRST + i. */
export function withSlotMarks(code) {
  const slotIds = [];
  const text = cleanCode(code).replace(/\{\{([A-Za-z0-9_-]{1,32})\}\}/g, (_, id) => {
    let i = slotIds.indexOf(id);
    if (i < 0) {
      slotIds.push(id);
      i = slotIds.length - 1;
    }
    return String.fromCharCode(SLOT_FIRST + Math.min(i, SLOT_LAST - SLOT_FIRST));
  });
  return { text, ids: slotIds };
}

/** كود بلا فتحات (العلامات تبقى نصًّا حرفيًا كما كتبها المدير). */
export const withoutSlots = (code) => ({ text: cleanCode(code), ids: [] });
