/**
 * src/utils/personDetails.js
 * يحوّل بيانات الملف العام القادمة من القاعدة إلى شكل آمن وجاهز للعرض.
 * لا يثق بالبيانات: يعيد التحقق من الروابط ويتجاهل أي شكل غير متوقع،
 * فلا تنكسر الصفحة إن كانت القيم ناقصة أو غير صالحة.
 */
import { SOCIAL_PLATFORMS, normalizeSocialUrl } from '../constants/socialPlatforms';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

export function getPersonDetails(person) {
  const socialsRaw = person && person.socials && typeof person.socials === 'object' && !Array.isArray(person.socials) ? person.socials : {};
  const socials = SOCIAL_PLATFORMS
    .map((p) => ({ key: p.key, label: p.label, href: normalizeSocialUrl(socialsRaw[p.key]) }))
    .filter((s) => s.href);

  const itemsRaw = person && person.extra && Array.isArray(person.extra.items) ? person.extra.items : [];
  const extra = itemsRaw
    .map((it) => ({ label: text(it && it.label), value: text(it && it.value) }))
    .filter((it) => it.label && it.value)
    .slice(0, 12);

  // عضو المكتب: النبذة العامة أولًا ثم النبذة المختصرة
  const bio = text(person && person.publicBio) || text(person && person.bio);
  const studyPath = text(person && person.studyPath);
  return { bio, studyPath, socials, extra, hasAny: !!(bio || studyPath || socials.length || extra.length) };
}
