/**
 * نافذة ترقيم مختصرة: الأولى والأخيرة وما حول الصفحة الحالية، والفجوات تُمثَّل بـ '…'.
 * pageWindow(7, 20) → [1, '…', 6, 7, 8, '…', 20]
 */
export function pageWindow(current, total, around = 1) {
  if (!Number.isInteger(total) || total < 1) return [];
  const cur = Math.min(Math.max(Number(current) || 1, 1), total);
  const keep = new Set([1, total]);
  for (let p = cur - around; p <= cur + around; p += 1) if (p >= 1 && p <= total) keep.add(p);
  const out = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev === 2) out.push(prev + 1); // فجوة من صفحة واحدة: اعرضها بدل '…'
    else if (p - prev > 2) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}
