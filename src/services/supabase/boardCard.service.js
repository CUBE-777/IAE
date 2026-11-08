import { supabase } from './client';
import { uploadMemberCardPhoto } from './memberSpace.service';

/**
 * بطاقة المكتب للعضو (supabase/migrations/0046): العضو المرتبط ببطاقة مكتب نشطة يقترح تعديل ملفه العام.
 * لا نكتب في board_members أبدًا: كل شيء عبر دوال SECURITY DEFINER، والاعتماد يبقى بيد مسؤول المحتوى
 * (approve_board_profile من 0031). الاسم والصفة والترتيب خارج ما يقبله الخادم.
 */

/**
 * بطاقتي: null إن لم يكن الحساب مرتبطًا ببطاقة مكتب نشطة.
 * يُرجع { board_member_id, full_name, position, photo_url, current, request: { status, review_note, submitted_at, has_draft_photo, draft } | null }.
 * إن لم تُطبَّق 0046 بعد تُعاد null (الواجهة تُخفي القسم بهدوء).
 */
export async function getMyBoardCard() {
  const { data, error } = await supabase.rpc('get_my_board_card');
  if (error) {
    if (/get_my_board_card|schema cache|does not exist/i.test(`${error.message || ''} ${error.code || ''}`)) return null;
    throw error;
  }
  return data || null;
}

/** payload بنفس شكل submit_board_profile (حقول الملف العام + translations)؛ photo_path اختياري من uploadBoardCardPhoto. */
export async function submitMyBoardCard(payload) {
  const { data, error } = await supabase.rpc('submit_my_board_card', { p_data: payload });
  if (error) throw error;
  return data;
}

/** سحب الطلب قبل مراجعته. */
export async function cancelMyBoardCardRequest() {
  const { error } = await supabase.rpc('cancel_my_board_card_request');
  if (error) throw error;
}

/** الصورة تُرفع إلى مجلد العضو نفسه member-<id>/photo-<hex>.<ext> (نفس سياسة 0036 المستعملة لبطاقة العضو). */
export const uploadBoardCardPhoto = uploadMemberCardPhoto;
