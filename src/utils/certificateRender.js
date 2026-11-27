/**
 * src/utils/certificateRender.js
 * منطق خالص (بلا React/DOM/Supabase) لتوليد PDF الشهادات والتنزيل الجماعي والتحقق العام، ليُختبر مباشرة في Node.
 * - المتغيّرات والتصميم يأتيان من get_certificate_render_data فقط (لا بيانات تجريبية).
 * - الرمز (token) لا يُسجَّل ولا يدخل في أي رسالة خطأ أو اسم ملف؛ الأخطاء رموز ثابتة فقط.
 */
import { LANGS, STYLES, VARIABLES, hasLayout, sanitizeDesign, presetDesign } from '../pages/admin/certificateDesign.js';
import { encodeQr, QR_QUIET_ZONE } from './qr.js';
import { createZip } from './zipBuilder.js';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const VERIFY_PATH_RE = /^\/verify-certificate\/[A-Za-z0-9_-]{43}$/;
export const NUMBER_RE = /^IAE-\d{4}-\d{6,}$/;
const LOCALES = { fr: 'fr-FR', ar: 'ar-u-nu-latn', en: 'en-US' };

// ------------------------------------------------------------------ البيانات والتصميم

export function formatCertDate(value, lang) {
  if (!value) return '';
  const s = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T12:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALES[lang] || LOCALES.fr, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: dateOnly ? 'UTC' : 'Africa/Casablanca',
  }).format(d);
}

export const certLang = (data) => (LANGS.includes(data?.language) ? data.language : 'fr');

/** كل متغيّرات القالب بقيم الشهادة الحقيقية (فراغ لا «{{...}}» إن غابت قيمة) */
export function certificateVariables(data) {
  const lang = certLang(data);
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {
    recipient_name: s(data?.recipient_name),
    campaign_title: s(data?.campaign_title),
    activity_title: s(data?.activity_title),
    activity_date: formatCertDate(data?.activity_date, lang),
    issued_at: formatCertDate(data?.issued_at, lang),
    certificate_number: s(data?.certificate_number),
  };
  for (const v of VARIABLES) if (!(v in out)) out[v] = '';
  return out;
}

/** نفس منطق المصمّم عند تحميل قالب: بلا تخطيط محفوظ → التخطيط الابتدائي للنمط، وإلا التصميم المحفوظ منظَّفًا */
export function resolveCertificateDesign(data) {
  const style = STYLES.includes(data?.template_style) ? data.template_style : 'academic';
  const raw = data?.template_design && typeof data.template_design === 'object' ? data.template_design : {};
  return hasLayout(raw) ? sanitizeDesign(raw) : presetDesign(style, raw);
}

/** رابط QR المطلق من مسار التحقق الذي أرجعته القاعدة. يرمي رمزًا ثابتًا (لا يتضمن الرمز). */
export function certificateQrUrl(origin, verificationPath) {
  const o = String(origin || '').replace(/\/+$/, '');
  if (typeof verificationPath !== 'string' || !VERIFY_PATH_RE.test(verificationPath) || !/^https?:\/\/[^\s/]+$/.test(o)) {
    throw new Error('certificate_qr_invalid');
  }
  return `${o}${verificationPath}`;
}

/** نموذج الرسم الكامل لشهادة صادرة حقيقية. يرمي certificate_render_invalid إن كانت البيانات ناقصة. */
export function certificatePdfModel(data, origin) {
  if (!data || typeof data !== 'object' || !NUMBER_RE.test(String(data.certificate_number || '')) || !String(data.recipient_name || '').trim()) {
    throw new Error('certificate_render_invalid');
  }
  return {
    lang: certLang(data),
    design: resolveCertificateDesign(data),
    vars: certificateVariables(data),
    qrText: certificateQrUrl(origin, data.verification_path),
    number: data.certificate_number,
    fileName: certificateFileName(data.certificate_number, data.recipient_name),
  };
}

// ------------------------------------------------------------------ أسماء الملفات

export function safeFilePart(value, max = 50) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function certificateFileName(number, name) {
  const n = NUMBER_RE.test(String(number || '')) ? number : 'certificat';
  return `${n}_${safeFilePart(name) || 'beneficiaire'}.pdf`;
}

export function campaignZipName(title, now = new Date()) {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `Certificats-${safeFilePart(title, 40) || 'campagne'}-${ymd}.zip`;
}

// ------------------------------------------------------------------ QR كمستطيلات متجهية (لرسمه في PDF بلا تحويل لصورة)

/** مستطيلات الوحدات الداكنة داخل صندوق (x,y,w,h) بالمليمتر؛ المربع مركزي بضلع min(w,h) ويشمل منطقة الهدوء */
export function qrRects(text, x, y, w, h) {
  const { modules, size } = encodeQr(text);
  const total = size + QR_QUIET_ZONE * 2;
  const side = Math.min(w, h);
  const ox = x + (w - side) / 2;
  const oy = y + (h - side) / 2;
  const m = side / total;
  const rects = [];
  for (let r = 0; r < size; r += 1) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) { c += 1; continue; }
      let run = 1;
      while (c + run < size && modules[r][c + run]) run += 1;
      rects.push({ x: ox + (c + QR_QUIET_ZONE) * m, y: oy + (r + QR_QUIET_ZONE) * m, w: run * m, h: m });
      c += run;
    }
  }
  return { side, ox, oy, module: m, rects };
}

// ------------------------------------------------------------------ التنزيل الجماعي

/** الصادرة الصالحة فقط: مستفيد صادر + شهادة valid + معرّف شهادة. المعلّقة والملغاة مستبعدة. */
export const isBulkEligible = (r) => !!r && r.status === 'issued' && r.certificate_status === 'valid' && !!r.certificate_id;
export const bulkEligible = (recipients) => (Array.isArray(recipients) ? recipients.filter(isBulkEligible) : []);

/** رمز خطأ آمن للعرض: certificate_* فقط، وإلا رمز عام (لا نصوص خام قد تحوي الرمز) */
export const safeErrorCode = (err) => (/^certificate_[a-z_]+$/.test(String(err?.message || '')) ? err.message : 'certificate_pdf_failed');

/**
 * ينشئ ZIP تدريجيًا: شهادة واحدة في كل مرة (renderPdf يعيد { bytes, fileName }) ثم تُضاف فورًا ويُفرَّغ مرجعها.
 * لا يُنشئ ZIP إن لم ينجح أي ملف (blob = null). onProgress({ total, done, ok, failed }).
 * @returns {{ blob: Blob|null, total: number, ok: number, failures: {id: string, name: string, code: string}[] }}
 */
export async function buildCertificatesZip({ items, renderPdf, onProgress, now = new Date() }) {
  const list = Array.isArray(items) ? items : [];
  const zip = createZip({ now });
  const used = new Set();
  const failures = [];
  let ok = 0;
  const emit = (done) => onProgress?.({ total: list.length, done, ok, failed: failures.length });
  emit(0);
  for (let i = 0; i < list.length; i += 1) {
    const it = list[i];
    try {
      const out = await renderPdf(it.id);
      let name = out.fileName;
      for (let n = 2; used.has(name); n += 1) name = out.fileName.replace(/\.pdf$/, `-${n}.pdf`);
      zip.add(name, out.bytes);
      used.add(name);
      ok += 1;
    } catch (err) {
      failures.push({ id: it.id, name: it.name, code: safeErrorCode(err) });
    }
    emit(i + 1);
    await new Promise((r) => setTimeout(r, 0)); // يتيح للواجهة تحديث التقدم ويحرّر الذاكرة بين الملفات
  }
  return { blob: ok > 0 ? zip.toBlob() : null, total: list.length, ok, failures };
}

// ------------------------------------------------------------------ التحقق العام

const str = (v, max = 300) => (typeof v === 'string' && v.length <= max ? v : null);

/**
 * يُنظّف نتيجة verify_certificate بقائمة بيضاء: الملغاة/غير الموجودة/أي شكل غريب لا تحمل أي اسم أو بيانات شخصية
 * حتى لو أرجعها الخادم خطأً.
 */
export function normalizeVerifyResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = typeof r.certificate_type === 'string' && /^[a-z_]{3,30}$/.test(r.certificate_type) ? r.certificate_type : null;
  const number = typeof r.certificate_number === 'string' && NUMBER_RE.test(r.certificate_number) ? r.certificate_number : null;
  if (r.status === 'valid' && number) {
    return {
      status: 'valid', certificate_number: number, certificate_type: type, language: LANGS.includes(r.language) ? r.language : 'fr',
      campaign_title: str(r.campaign_title), activity_title: str(r.activity_title), activity_date: str(r.activity_date, 40),
      issued_at: str(r.issued_at, 40), holder_name: str(r.holder_name, 200),
    };
  }
  if (r.status === 'revoked' && number) {
    return { status: 'revoked', certificate_number: number, certificate_type: type, issued_at: str(r.issued_at, 40), revoked_at: str(r.revoked_at, 40) };
  }
  return { status: 'not_found' };
}
