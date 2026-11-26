import { supabase } from './client';

/**
 * Public certificate verification. The token is sent only to the verify_certificate RPC;
 * it is never persisted, logged, or included in client-side analytics.
 */
export async function verifyCertificate(token) {
  const value = String(token || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return { status: 'not_found' };
  const { data, error } = await supabase.rpc('verify_certificate', { p_token: value });
  if (error) throw error;
  if (!data || !['valid', 'revoked', 'not_found'].includes(data.status)) {
    throw new Error('certificate_verification_unavailable');
  }
  return data;
}
