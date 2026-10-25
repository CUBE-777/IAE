import { supabase } from './client';
import { supabasePublic } from './publicClient';

function memberRowToPerson(row) {
  return {
    id: row.id,
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
    // ترجمات FR/EN (migration 0011): { name_latin, fr: {...}, en: {...} } — تُعرض عبر localizePerson
    tr: row.translations,
  };
}

function boardRowToPerson(row) {
  const tr = row.translations && typeof row.translations === 'object' ? row.translations : null;
  return {
    id: row.id,
    name: row.full_name,
    role: row.position,
    // المنصب بلغات الزائر (translations.fr.position / translations.en.position)
    roleTr: tr ? { fr: tr.fr && tr.fr.position, en: tr.en && tr.en.position } : null,
    tr,
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
    const BOARD_BASE = 'id, full_name, position, photo_url, university, bio, sort_order, is_active';
    const queryBoard = (cols) => supabase
      .from('board_members')
      .select(cols)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    // نطلب عمود الترجمات أولًا؛ إن لم تُشغَّل migration 0011 نرجع للأعمدة الأساسية فلا تتعطل الصفحة.
    let res = await queryBoard(`${BOARD_BASE}, translations`);
    if (res.error) res = await queryBoard(BOARD_BASE);
    if (res.error) throw res.error;
    return (res.data || []).map(boardRowToPerson);
  }
  // نطلب فقط الأعمدة العامة غير الحساسة (RLS يرفض الباقي أصلاً لدور anon).
  // نحاول أولًا مع أعمدة الملف العام الجديدة، وإن لم تكن موجودة بعد (migration 0010
  // لم تُشغَّل) نرجع تلقائيًا للأعمدة الأساسية حتى لا تتعطل الصفحة.
  const BASE_COLS = 'id, full_name, photo_url, promotion, track, university, profession, status, created_at, deleted_at';
  // عميل مجهول الجلسة عمدًا: الصفحة العامة تُعرض بدور anon دائمًا (انظر publicClient.js و0021).
  const queryMembers = (cols) => supabasePublic
    .from('members')
    .select(cols)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  const PROFILE_COLS = `${BASE_COLS}, public_bio, study_path, socials, extra`;
  // الترتيب: الملف العام + الترجمات ← الملف العام وحده ← الأعمدة الأساسية (كل مرحلة احتياط لعدم تشغيل migration معيّنة)
  let res = await queryMembers(`${PROFILE_COLS}, translations`);
  if (res.error) res = await queryMembers(PROFILE_COLS);
  if (res.error) res = await queryMembers(BASE_COLS);
  if (res.error) throw res.error;
  return (res.data || []).map(memberRowToPerson);
}
