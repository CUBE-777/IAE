// يسمح لـ node:test باستيراد ملفات src التي تُكتب بلا امتداد (Vite) ويستبدل عميل Supabase بكائن فارغ. للاختبارات فقط.
import { register } from 'node:module';

const hooks = `
export async function resolve(specifier, context, next) {
  if (/supabase\\/client(\\.js)?$/.test(specifier)) return { url: 'data:text/javascript,export const supabase = {};', shortCircuit: true };
  try { return await next(specifier, context); }
  catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && /^[./]/.test(specifier)) {
      for (const ext of ['.js', '.jsx', '/index.js']) { try { return await next(specifier + ext, context); } catch {} }
    }
    throw e;
  }
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
