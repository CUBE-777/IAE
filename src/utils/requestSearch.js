/**
 * src/utils/requestSearch.js
 * بحث داخل قائمة طلبات الانخراط بالاسم أو رقم الهاتف أو البريد الإلكتروني (في المتصفح، فالقوائم صغيرة).
 *  - الاسم: بدون تشكيل ومع توحيد الألف والياء (نفس بحث الأعضاء) ويدعم الحروف اللاتينية.
 *  - الهاتف: يُقارن بالأرقام فقط، ومفتاح المغرب 212/00212/+212 يُعامل كالصفر الأول،
 *    فيجد 0612345678 و+212612345678 و06 12 34 56 78 بنفس الاستعلام.
 *  - البريد: بلا حساسية لحالة الأحرف، ويطابق جزءًا منه (مثل النطاق).
 */
import { normalizeSearchValue } from './arabicSearch.js';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** أرقام فقط (يحوّل الهندية ٠-٩ إلى لاتينية) مع توحيد مفتاح المغرب إلى 0 في البداية. */
export function normalizePhoneDigits(value) {
  let d = String(value == null ? '' : value)
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
    .replace(/\D/g, '');
  if (d.startsWith('00212')) d = `0${d.slice(5)}`;
  else if (d.startsWith('212')) d = `0${d.slice(3)}`;
  return d;
}

/** يجهّز الاستعلام مرة واحدة لكل بحث بدل كل صف. */
export function prepareRequestQuery(raw) {
  const text = normalizeSearchValue(raw);
  const digits = normalizePhoneDigits(raw);
  // الاستعلام يُعدّ رقمًا فقط إن كان معظمه أرقامًا (حتى لا يطابق «2» أي رقم عند البحث عن اسم يحوي رقمًا)
  const phoneLike = digits.length >= 2 && digits.length >= String(raw).replace(/[\s+()\-.]/g, '').length * 0.8;
  return { text, digits: phoneLike ? digits : '' };
}

export function matchesRequestSearch(row, query) {
  if (!query || (!query.text && !query.digits)) return true;
  if (query.digits && normalizePhoneDigits(row.phone).includes(query.digits)) return true;
  if (!query.text) return false;
  const haystack = [row.full_name, row.email].map(normalizeSearchValue).join(' ');
  return haystack.includes(query.text);
}
