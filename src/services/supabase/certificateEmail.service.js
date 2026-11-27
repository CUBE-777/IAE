import { supabase } from './client';

/**
 * جدولة بريد الشهادات (RPC certificate_enqueue_campaign_emails، migration 0065).
 * - الخادم (can_manage_certificates) هو من يقرّر الصلاحية؛ لا إرسال بريد من المتصفح: هذه الدالة تضيف مهامَّ للطابور فقط،
 *   ويرسلها عامل خلفي مجدول (Edge Function مستقلة على الخادم) لاحقًا؛ المتصفح لا يستدعيه ولا يعرف أسراره.
 * - تعيد عدد الرسائل المُضافة فعلًا. لا تُضيف شهادة لها مهمة نشطة (queued/sending) أو أُرسلت سابقًا (يمنعها الخادم).
 * - ملف مستقل عن adminCertificates.service لأن الدالة معرّفة في 0065 (والخدمة تلك مقيّدة بدوال 0064).
 */
export async function enqueueCampaignEmails(campaignId) {
  const { data, error } = await supabase.rpc('certificate_enqueue_campaign_emails', { p_campaign_id: campaignId });
  if (error) throw error;
  return Number.isInteger(data) && data >= 0 ? data : 0;
}
