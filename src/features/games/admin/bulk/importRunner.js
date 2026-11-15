import { CHUNK_SIZE, chunk } from './importModel.js';

/**
 * ينفّذ الاستدعاءات الخادمية على دفعات (≤ CHUNK_SIZE) بالتتابع مع تقدّم.
 * call(chunkPayloads, dryRun) → نتيجة RPC. دالة نقية لا تعرف الشبكة (تُحقن) كي تُختبر.
 * items: عناصر محضّرة فيها payload (بلا أخطاء محلية). يعيد { rows: Map(index العنصر الأصلي → صف الخادم), failed: {index, error}|null, done }.
 * عند فشل دفعة يتوقف التنفيذ فورًا (الدفعات السابقة ثابتة؛ إعادة التشغيل آمنة لأن الخادم idempotent عبر import_key).
 */
export async function runChunks(items, call, { dryRun, size = CHUNK_SIZE, onProgress } = {}) {
  const rows = new Map();
  const parts = chunk(items, size);
  let done = 0;
  for (let c = 0; c < parts.length; c += 1) {
    const part = parts[c];
    let res;
    try {
      res = await call(part.map((it) => it.payload), dryRun);
    } catch (error) {
      return { rows, failed: { chunk: c, error }, done };
    }
    (Array.isArray(res?.items) ? res.items : []).forEach((r) => {
      const src = part[r.index];
      if (src) rows.set(src.index, r);
    });
    done += part.length;
    onProgress?.({ done, total: items.length, chunk: c + 1, chunks: parts.length });
  }
  return { rows, failed: null, done };
}
