import { supabase } from './client';
import { logAction } from './auth.service';
import { runWithColumnFallback } from './profileColumns';

export async function fetchBoardMembers() {
  const { data, error } = await supabase.from('board_members').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * يعيد ترتيب القائمة كلها بعملية واحدة ذرّية (RPC reorder_board_members):
 * إمّا تنجح بالكامل أو تفشل بالكامل — لا حالة نصف مكتملة، ويُرمى الخطأ للواجهة.
 */
export async function reorderBoardMembers(orderedIds) {
  const { error } = await supabase.rpc('reorder_board_members', { p_ids: orderedIds });
  if (error) throw error;
}

// يُرجع { degraded } = true إن حُفظت البيانات الأساسية فقط لأن أعمدة الملف العام/الترجمات (0011/0012) غير موجودة بعد.
// أعمدة اختيارية خاصة بالمكتب (migration 0012): سنة التخرج والتخصص
const BOARD_OPTIONAL_COLS = ['promotion', 'track'];

export async function saveBoardMember(existing, payload) {
  if (existing) {
    const { res, degraded } = await runWithColumnFallback(
      (p) => supabase.from('board_members').update(p).eq('id', existing.id),
      payload,
      BOARD_OPTIONAL_COLS
    );
    if (res.error) throw res.error;
    await logAction('ADMIN_UPDATED_BOARD_MEMBER', 'board_members', existing.id, `تعديل بيانات عضو المكتب ${payload.full_name}`);
    return { degraded };
  }
  const { count } = await supabase.from('board_members').select('id', { count: 'exact', head: true });
  const insertPayload = { ...payload, sort_order: count || 0 };
  const { res, degraded } = await runWithColumnFallback(
    (p) => supabase.from('board_members').insert(p).select().single(),
    insertPayload,
    BOARD_OPTIONAL_COLS
  );
  if (res.error) throw res.error;
  await logAction('ADMIN_CREATED_BOARD_MEMBER', 'board_members', res.data?.id || null, `إضافة عضو مكتب جديد: ${payload.full_name}`);
  return { degraded };
}

export async function deleteBoardMember(member) {
  const { error } = await supabase.from('board_members').delete().eq('id', member.id);
  if (error) throw error;
  await logAction('ADMIN_DELETED_BOARD_MEMBER', 'board_members', member.id, `حذف عضو المكتب ${member.full_name}`);
}
