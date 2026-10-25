import { supabase } from './client';
import { logAction } from './auth.service';

const PAGE_SIZE = 15;
export { PAGE_SIZE };

// أعمدة الملف العام (migration 0010). إن لم تُشغَّل بعد، نحفظ بدونها بدل أن يفشل الحفظ كله.
const PROFILE_COLS = ['public_bio', 'study_path', 'socials', 'extra'];
// عمود موافقة الظهور (migration 0030): إن لم يُشغَّل بعد نحفظ بدونه بصمت، فلا يفشل الحفظ العادي.
const DIRECTORY_COL = 'show_in_directory';
const isMissingColumn = (e) => !!e && (e.code === 'PGRST204' || e.code === '42703');
const withoutProfileCols = (payload) => {
  const copy = { ...payload };
  PROFILE_COLS.forEach((k) => delete copy[k]);
  delete copy[DIRECTORY_COL];
  return copy;
};
const hasProfileCols = (payload) => PROFILE_COLS.some((k) => k in payload);
const hasOptionalCols = (payload) => hasProfileCols(payload) || DIRECTORY_COL in payload;

export async function fetchMembersPage({ page, search, status }) {
  let query = supabase.from('members').select('*', { count: 'exact' }).is('deleted_at', null);
  if (status) query = query.eq('status', status);
  if (search) {
    const s = search.replace(/[%_]/g, '');
    query = query.or(`full_name.ilike.%${s}%,profession.ilike.%${s}%,city.ilike.%${s}%,promotion.ilike.%${s}%,university.ilike.%${s}%`);
  }
  const from = (page - 1) * PAGE_SIZE;
  query = query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}

// يُرجع degraded=true إن حُفظت البيانات الأساسية فقط لأن أعمدة الملف العام غير موجودة بعد.
export async function createMember(payload) {
  let degraded = false;
  let res = await supabase.from('members').insert(payload).select().single();
  if (res.error && isMissingColumn(res.error) && hasOptionalCols(payload)) {
    degraded = hasProfileCols(payload);
    res = await supabase.from('members').insert(withoutProfileCols(payload)).select().single();
  }
  if (res.error) throw res.error;
  await logAction('ADMIN_CREATED_MEMBER', 'members', res.data.id, `إضافة عضو جديد: ${payload.full_name}`);
  return { ...res.data, degraded };
}

export async function updateMember(id, payload) {
  let degraded = false;
  let { error } = await supabase.from('members').update(payload).eq('id', id);
  if (error && isMissingColumn(error) && hasOptionalCols(payload)) {
    degraded = hasProfileCols(payload);
    ({ error } = await supabase.from('members').update(withoutProfileCols(payload)).eq('id', id));
  }
  if (error) throw error;
  await logAction('ADMIN_UPDATED_MEMBER', 'members', id, `تعديل بيانات العضو ${payload.full_name}`);
  return { degraded };
}

export async function softDeleteMember(member) {
  const { error } = await supabase.from('members').update({ deleted_at: new Date().toISOString() }).eq('id', member.id);
  if (error) throw error;
  await logAction('ADMIN_DELETED_MEMBER', 'members', member.id, `حذف العضو ${member.full_name}`);
}

export async function fetchAllMembersForExport() {
  const { data, error } = await supabase
    .from('members')
    .select('full_name,university,promotion,track,profession,city,email,phone,status')
    .is('deleted_at', null);
  if (error) throw error;
  return data || [];
}
