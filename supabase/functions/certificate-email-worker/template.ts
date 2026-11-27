// supabase/functions/certificate-email-worker/template.ts
// قالب بريد الشهادة (fr افتراضي، ar بـ RTL، en). دوال خالصة بلا Deno ولا شبكة، فتُختبر في Node.
// الرسالة تحمل رابط التحقق /verify-certificate/:token فقط — لا PDF ولا مرفقات. كل قيمة متغيّرة تُهرَّب قبل دخول HTML.

export type Lang = 'fr' | 'ar' | 'en';

export interface EmailInput {
  language: string;
  recipientName: string;
  certificateNumber: string;
  certificateType: string;
  campaignTitle: string;
  verifyUrl: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** يقبل أصل https فقط (أو http لـ localhost للتجربة) ويُرجع origin بلا مسار؛ وإلا null. */
export function normalizeSiteUrl(raw: string | undefined | null): string | null {
  try {
    const u = new URL(String(raw || '').trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
  } catch { /* لا شيء */ }
  return null;
}

export function buildVerifyUrl(siteOrigin: string, token: string): string | null {
  return TOKEN_RE.test(token) ? `${siteOrigin}/verify-certificate/${token}` : null;
}

const LANGS: Lang[] = ['fr', 'ar', 'en'];
export const pickLang = (v: unknown): Lang => (LANGS.includes(v as Lang) ? (v as Lang) : 'fr');

const TYPES: Record<Lang, Record<string, string>> = {
  fr: { participation: 'Participation', organization: 'Organisation', volunteering: 'Bénévolat', training: 'Formation' },
  ar: { participation: 'مشاركة', organization: 'تنظيم', volunteering: 'تطوع', training: 'تكوين' },
  en: { participation: 'Participation', organization: 'Organization', volunteering: 'Volunteering', training: 'Training' },
};

const COPY: Record<Lang, {
  brand: string; subject: (n: string) => string; pre: string; hello: (name: string) => string; helloAnon: string;
  intro: string; labels: { number: string; type: string; title: string }; button: string; fallback: string; note: string; ignore: string;
}> = {
  fr: {
    brand: 'Intelligence Artificielle Embarquée',
    subject: (n) => `Votre certificat IAE n° ${n}`,
    pre: 'Votre certificat est disponible : ouvrez le lien de vérification.',
    hello: (name) => `Bonjour ${name},`, helloAnon: 'Bonjour,',
    intro: 'Le club IAE vous a délivré un certificat. Voici ses informations :',
    labels: { number: 'N° du certificat', type: 'Type', title: 'Intitulé' },
    button: 'Vérifier mon certificat',
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    note: 'Ce message contient un lien de vérification ; le certificat PDF n’est pas joint.',
    ignore: 'Si vous n’êtes pas concerné(e), ignorez simplement ce message.',
  },
  ar: {
    brand: 'الذكاء الاصطناعي المدمج',
    subject: (n) => `شهادتك من نادي IAE رقم ${n}`,
    pre: 'شهادتك متاحة: افتح رابط التحقق.',
    hello: (name) => `مرحبًا ${name}،`, helloAnon: 'مرحبًا،',
    intro: 'أصدر لك نادي IAE شهادة. هذه بياناتها:',
    labels: { number: 'رقم الشهادة', type: 'النوع', title: 'العنوان' },
    button: 'التحقق من شهادتي',
    fallback: 'إن لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:',
    note: 'تحمل هذه الرسالة رابط تحقق فقط؛ ملف PDF للشهادة غير مرفق.',
    ignore: 'إن لم تكن المعنيّ بهذه الرسالة فتجاهلها ببساطة.',
  },
  en: {
    brand: 'Embedded Artificial Intelligence',
    subject: (n) => `Your IAE certificate no. ${n}`,
    pre: 'Your certificate is available: open the verification link.',
    hello: (name) => `Hello ${name},`, helloAnon: 'Hello,',
    intro: 'The IAE club has issued a certificate to you. Here are its details:',
    labels: { number: 'Certificate no.', type: 'Type', title: 'Title' },
    button: 'Verify my certificate',
    fallback: 'If the button does not work, copy this link into your browser:',
    note: 'This message carries a verification link; the PDF certificate is not attached.',
    ignore: 'If this message is not meant for you, simply ignore it.',
  },
};

const NAVY = '#07254f';
const BLUE = '#0a66c8';
const INK = '#16233b';
const MUTED = '#5b6b86';

export function buildCertificateEmail(i: EmailInput): { subject: string; html: string; text: string } {
  const lang = pickLang(i.language);
  const c = COPY[lang];
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const name = String(i.recipientName || '').trim();
  const type = TYPES[lang][i.certificateType] || '';
  const title = String(i.campaignTitle || '').trim();
  const hello = name ? c.hello(name) : c.helloAnon;
  const subject = c.subject(i.certificateNumber);

  const row = (label: string, value: string, ltrValue = false) => (value
    ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:13px;width:38%;vertical-align:top" align="${align}">${esc(label)}</td>`
      + `<td style="padding:8px 0;color:${INK};font-size:15px;font-weight:600;vertical-align:top" align="${align}"${ltrValue ? ' dir="ltr"' : ''}>${esc(value)}</td></tr>`
    : '');

  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6fb">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe4f2;font-family:Arial,Helvetica,sans-serif" dir="${dir}">
<tr><td style="background:${NAVY};padding:22px 28px" align="${align}">
<div style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:2px">IAE</div>
<div style="color:#a8d0ff;font-size:13px;margin-top:2px">${esc(c.brand)}</div></td></tr>
<tr><td style="padding:28px" align="${align}">
<p style="margin:0 0 12px;color:${INK};font-size:17px;line-height:1.6">${esc(hello)}</p>
<p style="margin:0 0 18px;color:${INK};font-size:15px;line-height:1.7">${esc(c.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6ecf6;border-bottom:1px solid #e6ecf6;margin:0 0 24px">
${row(c.labels.number, i.certificateNumber, true)}${row(c.labels.type, type)}${row(c.labels.title, title)}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:${BLUE};border-radius:8px">
<a href="${esc(i.verifyUrl)}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">${esc(c.button)}</a></td></tr></table>
<p style="margin:0 0 6px;color:${MUTED};font-size:12.5px;line-height:1.6">${esc(c.fallback)}</p>
<p style="margin:0 0 20px;font-size:12.5px;line-height:1.5;word-break:break-all" dir="ltr"><a href="${esc(i.verifyUrl)}" style="color:${BLUE}">${esc(i.verifyUrl)}</a></p>
<p style="margin:0 0 6px;color:${MUTED};font-size:12.5px;line-height:1.6">${esc(c.note)}</p>
<p style="margin:0;color:${MUTED};font-size:12.5px;line-height:1.6">${esc(c.ignore)}</p>
</td></tr></table></td></tr></table></body></html>`;

  const details = [
    `${c.labels.number}: ${i.certificateNumber}`,
    type ? `${c.labels.type}: ${type}` : '',
    title ? `${c.labels.title}: ${title}` : '',
  ].filter(Boolean);
  const text = [hello, '', c.intro, '', ...details, '', `${c.button}: ${i.verifyUrl}`, '', c.note, c.ignore, ''].join('\n');

  return { subject, html, text };
}
