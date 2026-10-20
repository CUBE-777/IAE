import { supabase } from './client';

export async function fetchRequestsByStatus(status) {
  const { data, error } = await supabase
    .from('membership_requests')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** المراجع يُشتق تلقائيًا من auth.uid() داخل قاعدة البيانات (انظر 0006_security_hardening.sql) — لا نرسل معرّف المستخدم من العميل. */
export async function approveMembershipRequest(requestId) {
  const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectMembershipRequest(requestId, reason) {
  const { error } = await supabase.rpc('reject_membership_request', {
    p_request_id: requestId,
    p_reason: reason || null,
  });
  if (error) throw error;
}
