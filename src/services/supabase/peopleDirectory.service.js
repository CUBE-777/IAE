import { supabase } from './client';

function memberRowToPerson(row) {
  return {
    name: row.full_name,
    role: null, // يُترجَم في الواجهة (person.memberRole)
    university: row.university,
    // ملاحظة أمان/خصوصية: لا يُطلب حقل "age" هنا لأن قاعدة البيانات لا تمنح anon
    // صلاحية قراءته إطلاقًا (انظر supabase/migrations/0007_member_privacy.sql).
    // نفس الأمر لـ email/phone/city — تبقى خاصة بالإدارة فقط.
    promo: row.promotion,
    track: row.track,
    profession: row.profession,
    image: row.photo_url,
    // الملف العام (migration 0010) — قد تكون غير موجودة إن لم تُشغَّل بعد
    publicBio: row.public_bio,
    studyPath: row.study_path,
    socials: row.socials,
    extra: row.extra,
  };
}

function boardRowToPerson(row) {
  return {
    name: row.full_name,
    role: row.position,
    university: row.university,
    age: null,
    promo: null,
    track: null,
    profession: null,
    bio: row.bio, // نبذة مختصرة (إن وجدت) تُعرض تحت الاسم في بطاقة المكتب
    image: row.photo_url,
  };
}

export async function fetchPeopleDirectory(listKey) {
  if (listKey === 'board') {
    const { data, error } = await supabase
      .from('board_members')
      .select('id, full_name, position, photo_url, university, bio, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data || []).map(boardRowToPerson);
  }
  // نطلب فقط الأعمدة العامة غير الحساسة (RLS يرفض الباقي أصلاً لدور anon).
  // نحاول أولًا مع أعمدة الملف العام الجديدة، وإن لم تكن موجودة بعد (migration 0010
  // لم تُشغَّل) نرجع تلقائيًا للأعمدة الأساسية حتى لا تتعطل الصفحة.
  const BASE_COLS = 'id, full_name, photo_url, promotion, track, university, profession, status, created_at, deleted_at';
  const queryMembers = (cols) => supabase
    .from('members')
    .select(cols)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  let res = await queryMembers(`${BASE_COLS}, public_bio, study_path, socials, extra`);
  if (res.error) res = await queryMembers(BASE_COLS);
  if (res.error) throw res.error;
  return (res.data || []).map(memberRowToPerson);
}
