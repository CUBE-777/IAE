/**
 * src/constants/socialPlatforms.js
 * قائمة منصات التواصل المدعومة في الملف العام للعضو + تنظيف الروابط.
 * لإضافة منصة جديدة مستقبلًا: أضف عنصرًا هنا (key فريد بالإنجليزية) وأيقونة في
 * components/common/PersonModal.jsx (SOCIAL_ICONS) — لا حاجة لأي تعديل في قاعدة البيانات
 * لأن الروابط تُحفظ في عمود jsonb اسمه socials.
 */
export const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/username' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/username' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/username' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'tiktok.com/@username' },
  { key: 'youtube', label: 'YouTube', placeholder: 'youtube.com/@channel' },
  { key: 'x', label: 'X / Twitter', placeholder: 'x.com/username' },
  { key: 'github', label: 'GitHub', placeholder: 'github.com/username' },
  { key: 'website', label: 'موقع شخصي', placeholder: 'example.com' },
];

const PLATFORM_KEYS = new Set(SOCIAL_PLATFORMS.map((p) => p.key));
export const isKnownPlatform = (key) => PLATFORM_KEYS.has(key);

/**
 * يُرجع رابطًا آمنًا (http/https فقط) أو '' إن كان غير صالح.
 * يقبل إدخالًا بدون بروتوكول (instagram.com/x) فيضيف https:// تلقائيًا،
 * ويرفض javascript: و data: و mailto: وأي نص فيه مسافات.
 */
export function normalizeSocialUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.href;
  } catch {
    return '';
  }
}
