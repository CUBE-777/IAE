import { supabase } from './client';
import { normalizeMyCertificates } from '../../utils/memberCertificates';

/**
 * شهادات العضو الحالي (RPC get_my_certificates، migration 0064).
 * - لا وسائط إطلاقًا: هوية العضو تُستنتج في الخادم من الجلسة (current_member_id)، فلا يمكن طلب شهادات عضو آخر.
 * - الاستجابة تُنظَّف بقائمة بيضاء (يسقط الرمز الخام). الخطأ رمز ثابت بلا بيانات.
 */
export async function fetchMyCertificates() {
  const { data, error } = await supabase.rpc('get_my_certificates');
  if (error) throw new Error('certificate_list_failed');
  return normalizeMyCertificates(data);
}
