import { GamesError } from '../../services/gamesCore.shared';
import { GAMES_UNKNOWN_ERROR } from '../../constants/gamesCore';
import { GAMES_ADMIN_ERROR_CODES, LANGS } from '../constants/gamesAdmin';

/** أخطاء Postgres الشائعة عند الكتابة المباشرة (PostgREST) → رموز مفهومة. */
const PG_CODE_MAP = {
  '42501': 'games_access_denied',
  '23505': 'duplicate_value',
  '23514': 'invalid_data',
  '23502': 'invalid_data',
  '22P02': 'invalid_data',
  '23503': 'invalid_reference',
};

/** يحوّل خطأ Supabase إلى GamesError برمز يُترجم في الواجهة؛ لا نعرض نص الخادم الخام. */
export function toAdminError(error) {
  if (error instanceof GamesError) return error;
  const msg = typeof error?.message === 'string' ? error.message.trim() : '';
  if (GAMES_ADMIN_ERROR_CODES.includes(msg)) return new GamesError(msg, error);
  return new GamesError(PG_CODE_MAP[error?.code] || GAMES_UNKNOWN_ERROR, error);
}

export function unwrapAdmin({ data, error }) {
  if (error) throw toAdminError(error);
  return data;
}

/** كائن لغات منظَّف: قيم مقصوصة غير فارغة فقط؛ null إن لم يبقَ شيء. */
export function cleanI18n(obj) {
  const out = {};
  for (const l of LANGS) {
    const v = typeof obj?.[l] === 'string' ? obj[l].trim() : '';
    if (v) out[l] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** كائن لغات كامل المفاتيح للنماذج. */
export function fillI18n(obj) {
  return { ar: obj?.ar || '', fr: obj?.fr || '', en: obj?.en || '' };
}

/** slug آمن (a-z0-9 وشرطات) من نص لاتيني؛ سلسلة فارغة إن لم يصلح. */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;
export const KIND_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** قيمة localized للعرض في القوائم. */
export function pickName(value, lang) {
  if (!value || typeof value !== 'object') return '';
  for (const l of [lang, 'ar', 'en', 'fr']) {
    const v = value[l];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** ISO ↔ حقل datetime-local. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
