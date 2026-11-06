/**
 * src/utils/memberRequests.js
 * سجل طلبات تعديل البطاقة: دالة نقية للعرض فقط.
 * آخر طلب يُعرض أصلًا في قسم «آخر طلب تعديل»، فالسجل يعرض ما سبقه فقط (الأحدث أولًا).
 */
export const HISTORY_LIMIT = 6; // آخر طلب + حتى 5 طلبات سابقة

export function olderRequests(list, latestId) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && r.id && r.id !== latestId);
}
