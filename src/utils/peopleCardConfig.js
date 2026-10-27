/**
 * src/utils/peopleCardConfig.js
 * إعدادات شكل بطاقات الأشخاص (الأعضاء وأعضاء المكتب) وما يظهر منها للزوار.
 *
 * تُحفظ في site_content (section = people_cards ، key = config) كنص JSON:
 *   { members: { card: {...}, modal: {...} }, board: { card: {...}, modal: {...} } }
 * القراءة عامة والكتابة لأدوار المحتوى (RLS الموجودة أصلًا) — فلا migration جديدة.
 *
 * لا يُوثَق بالقيمة المخزّنة: كل حقل يُتحقَّق منه مقابل قائمة بيضاء، وأي قيمة ناقصة أو غير صالحة
 * تعود إلى الافتراضي. الافتراضي يطابق الشكل الحالي للموقع تمامًا، فلا يتغيّر شيء قبل أن يعدّل المسؤول.
 *
 * خصوصية: العمر والبريد والهاتف والمدينة لا تُعرض هنا إطلاقًا (لا يملك الزائر صلاحية قراءتها، انظر 0007).
 */

export const CARD_SECTION = 'people_cards';
export const CARD_KEY = 'config';
export const PEOPLE_LISTS = ['members', 'board'];

export const CARD_CHOICES = {
  layout: ['side', 'stacked'],
  columns: [2, 3, 4],
  photoShape: ['circle', 'rounded', 'square'],
  photoSize: ['sm', 'md', 'lg'],
};

export const CARD_BOOLEANS = [
  'showPhoto', 'showUniversity', 'showBadge', 'showPromo', 'showTrack', 'showProfession', 'showProfileButton', 'highlightBoard',
];

export const MODAL_BOOLEANS = [
  'showPhoto', 'showBadge', 'showUniversity', 'showFacts', 'showBio', 'showStudyPath', 'showExtra', 'showSocials',
];

export const DEFAULT_LIST_CONFIG = Object.freeze({
  card: Object.freeze({
    layout: 'side',
    columns: 3,
    photoShape: 'circle',
    photoSize: 'md',
    showPhoto: true,
    showUniversity: true,
    showBadge: true,
    showPromo: true,
    showTrack: true,
    showProfession: true,
    showProfileButton: true,
    highlightBoard: true,
  }),
  modal: Object.freeze({
    showPhoto: true,
    showBadge: true,
    showUniversity: true,
    showFacts: true,
    showBio: true,
    showStudyPath: true,
    showExtra: true,
    showSocials: true,
  }),
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function normalizeGroup(raw, defaults, booleans, choices = {}) {
  const src = isObj(raw) ? raw : {};
  const out = { ...defaults };
  booleans.forEach((k) => {
    if (typeof src[k] === 'boolean') out[k] = src[k];
  });
  Object.entries(choices).forEach(([k, allowed]) => {
    if (allowed.includes(src[k])) out[k] = src[k];
  });
  return out;
}

/** يُنظّف إعدادات قائمة واحدة (members أو board) ويكمل الناقص بالافتراضي. */
export function normalizeListConfig(raw) {
  const src = isObj(raw) ? raw : {};
  return {
    card: normalizeGroup(src.card, DEFAULT_LIST_CONFIG.card, CARD_BOOLEANS, CARD_CHOICES),
    modal: normalizeGroup(src.modal, DEFAULT_LIST_CONFIG.modal, MODAL_BOOLEANS),
  };
}

/** يقبل نصًا JSON أو كائنًا ويُرجع { members, board } سليمين دائمًا. */
export function normalizeConfig(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  const src = isObj(data) ? data : {};
  return { members: normalizeListConfig(src.members), board: normalizeListConfig(src.board) };
}

export const serializeConfig = (config) => JSON.stringify(normalizeConfig(config));

/**
 * يطبّق إعدادات النافذة على تفاصيل الملف العام (ناتج getPersonDetails):
 * يُخفي ما عطّله المسؤول، و hasAny تُحسب بعد الإخفاء — فلا يظهر زر «عرض الملف» إن لم يبقَ شيء يُعرض.
 */
export function applyModalConfig(details, modalCfg) {
  const m = modalCfg || DEFAULT_LIST_CONFIG.modal;
  const bio = m.showBio ? details.bio : '';
  const studyPath = m.showStudyPath ? details.studyPath : '';
  const socials = m.showSocials ? details.socials : [];
  const extra = m.showExtra ? details.extra : [];
  return { bio, studyPath, socials, extra, hasAny: !!(bio || studyPath || socials.length || extra.length) };
}

/** أصناف CSS لشكل البطاقة (تُضاف على عنصر article). */
export function cardClassNames(cardCfg) {
  const c = cardCfg || DEFAULT_LIST_CONFIG.card;
  return [
    c.layout === 'stacked' ? 'member-card--stacked' : '',
    `member-card--shape-${c.photoShape}`,
    `member-card--size-${c.photoSize}`,
  ].filter(Boolean);
}
