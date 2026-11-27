import { supabasePublic } from './publicClient';
import { TOKEN_RE, normalizeVerifyResult } from '../../utils/certificateRender';

/**
 * التحقق العام من شهادة (RPC verify_certificate، anon). يستعمل العميل المجهول حتى لو كان المسؤول مسجّلًا في المتصفح.
 * يرجع { status: 'valid' | 'revoked' | 'not_found', ... } بعد تنظيف بقائمة بيضاء؛ الملغاة وغير الموجودة بلا اسم.
 * الرمز المشوَّه لا يُرسَل للخادم أصلًا. خطأ الشبكة يرمي رمزًا ثابتًا بلا الرمز (لا يُحكم على الشهادة).
 */
export async function verifyCertificate(token) {
  if (!TOKEN_RE.test(String(token || ''))) return { status: 'not_found' };
  const { data, error } = await supabasePublic.rpc('verify_certificate', { p_token: token });
  if (error) throw new Error('certificate_verify_failed');
  return normalizeVerifyResult(data);
}
