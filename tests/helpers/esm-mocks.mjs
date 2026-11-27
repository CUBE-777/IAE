// للاختبارات فقط: يحمّل esm-extless (استيراد بلا امتداد) ثم يضيف محاكاة قابلة للتبديل عبر globalThis:
//   services/supabase/client       → globalThis.__supabaseMock   (rpc)
//   services/supabase/publicClient → globalThis.__publicMock     (rpc)
//   jsr:@supabase/supabase-js@2    → globalThis.__createClientMock (Edge Functions)
// المحاكيات المتأخرة التسجيل تُنفَّذ أولًا، فتتقدّم على بدائل esm-extless.
import './esm-extless.mjs';
import { register } from 'node:module';

const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const CLIENT = dataUrl('export const supabase = { rpc: (...a) => globalThis.__supabaseMock.rpc(...a) };');
const PUBLIC = dataUrl('export const supabasePublic = { rpc: (...a) => globalThis.__publicMock.rpc(...a) };');
const JSR = dataUrl('export const createClient = (...a) => globalThis.__createClientMock(...a);');

const hooks = `
export async function resolve(specifier, context, next) {
  const parent = String(context.parentURL || '');
  if (specifier === 'jsr:@supabase/supabase-js@2') return { url: ${JSON.stringify(JSR)}, shortCircuit: true };
  if (/services\\/supabase\\//.test(parent)) {
    if (/^\\.\\/client(\\.js)?$/.test(specifier)) return { url: ${JSON.stringify(CLIENT)}, shortCircuit: true };
    if (/^\\.\\/publicClient(\\.js)?$/.test(specifier)) return { url: ${JSON.stringify(PUBLIC)}, shortCircuit: true };
  }
  return next(specifier, context);
}`;
register(dataUrl(hooks));
