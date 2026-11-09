/**
 * تصنيف أخطاء الخادم في مكان واحد. الرسائل تأتي من دوال SQL (raise exception) بالعربية، ويتحقق
 * tests/server-errors.test.js من أن العبارات المعتمدة هنا ما زالت موجودة في migrations، فلا يتكسر التصنيف بصمت.
 */
export const STALE_REQUEST_RE = /تغيّر الطلب أثناء مراجعتك|لا يوجد طلب قيد المراجعة/;
export const NOT_AUTHORIZED_RE = /غير\s*مصر[ّ]?ح|not authorized|permission denied|jwt/i;

export const isStaleRequestError = (err) => STALE_REQUEST_RE.test(err?.message || '');
