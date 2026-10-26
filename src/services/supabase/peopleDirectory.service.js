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
    memberId: row.member_id || null,
    isBoard: true,
    name: row.full_name,
    role: row.position,
    // المنصب بلغات الزائر (translations.fr.position / translations.en.position)
    roleTr: tr ? { fr: tr.fr && tr.fr.position, en: tr.en && tr.en.position } : null,
    tr,
    university: row.university,
    age: null,
    promo: row.promotion || null,
    track: row.track || null,
    profession: null,
    bio: row.bio, // نبذة مختصرة تُستعمل في نافذة الملف إن لم توجد نبذة عامة
    image: row.photo_url,
    // الملف العام (0011) — يجعل بطاقة المكتب تفتح نافذة المعلومات كبطاقة العضو
    publicBio: row.public_bio,
    studyPath: row.study_path,
    socials: row.socials,
    extra: row.extra,
    showInMembersList: row.show_in_members_list !== false,
  };
}

// أعمدة المكتب من الأساسية إلى الأوسع؛ نرجع للأضيق إن لم تُشغَّل migration معيّنة فلا تتعطل الصفحة.
const BOARD_BASE = 'id, full_name, position, photo_url, university, bio, sort_order, is_active, member_id';
const BOARD_COL_STEPS = [
  `${BOARD_BASE}, promotion, track, public_bio, study_path, socials, extra, translations, show_in_members_list`,
  `${BOARD_BASE}, promotion, track, public_bio, study_path, socials, extra, translations`,
  `${BOARD_BASE}, public_bio, study_path, socials, extra, translations`,
  `${BOARD_BASE}, translations`,
  BOARD_BASE,
  'id, full_name, position, photo_url, university, bio, sort_order, is_active',
];

async function fetchBoardPeople() {
  let res;
  for (const cols of BOARD_COL_STEPS) {
    // eslint-disable-next-line no-await-in-loop
    res = await supabasePublic
      .from('board_members')
      .select(cols)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (!res.error) break;
  }
  if (res.error) throw res.error;
  return (res.data || []).map(boardRowToPerson);
}

export async function fetchPeopleDirectory(listKey) {
  if (listKey === 'board') return fetchBoardPeople();
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
  const members = (res.data || []).map(memberRowToPerson);

  // أعضاء المكتب يظهرون أيضًا في قائمة الأعضاء (يتحكم المسؤول بذلك لكل عضو). فشل جلبهم لا يعطّل القائمة.
  let board = [];
  try {
    board = (await fetchBoardPeople()).filter((b) => b.showInMembersList);
  } catch (err) {
    console.warn('تعذر جلب أعضاء المكتب لدمجهم في قائمة الأعضاء:', err);
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  const top = [];
  const taken = new Set();
  board.forEach((b, i) => {
    const m = b.memberId ? byId.get(b.memberId) : null;
    if (m && !taken.has(m.id)) {
      // عضو مرتبط وظاهر: تنتقل صفة المكتب إلى بطاقته فلا يتكرر الشخص
      taken.add(m.id);
      top.push({ ...m, isBoard: true, role: b.role, roleTr: b.roleTr, _order: i });
    } else {
      top.push({ ...b, id: `board-${b.id}`, _order: i });
    }
  });
  const rest = members.filter((m) => !taken.has(m.id));
  return [...top, ...rest];
}
