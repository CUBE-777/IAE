/**
 * src/utils/sanitize.js
 * منفذ مباشر (1:1) لمنطق js/utils.js الأصلي من المشروع القديم.
 * ملاحظة: في React، استخدام {value} العادي في JSX يقوم بالتهريب تلقائيًا،
 * لذا escapeHtml هنا تُستخدم فقط عند الحاجة الفعلية لبناء نص يُدرج لاحقًا
 * (نادر). sanitizeRichText تبقى ضرورية لأي محتوى HTML غني قادم من القاعدة
 * (مثل activities.description) يُعرض عبر dangerouslySetInnerHTML.
 */
import DOMPurify from 'dompurify';

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * يتحقق أن الرابط يستخدم بروتوكول آمن (http/https/relative) فقط، ويرفض
 * javascript:, data:, vbscript: وغيرها. يُرجع '' إذا كان الرابط غير آمن.
 */
export function safeUrl(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('/') || v.startsWith('./') || v.startsWith('../')) {
    return v;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return '';
}

/**
 * ينظّف HTML غني (rich text) قادم من الحقول القابلة للتحرير عبر DOMPurify،
 * بنفس قائمة الوسوم/السمات المسموحة المستخدمة في المشروع الأصلي.
 */
export function sanitizeRichText(html) {
  const raw = String(html == null ? '' : html);
  if (!raw.trim()) return '';
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'a', 'span', 'h3', 'h4', 'blockquote'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
  });
}
