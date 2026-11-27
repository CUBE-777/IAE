/**
 * src/utils/certificatePdf.js
 * توليد PDF الشهادات في المتصفح عند الطلب فقط (لا تخزين في Supabase ولا في المتصفح).
 * الرسم عبر CertificatePage (نفس Renderer المعاينة) ثم html2canvas → jsPDF؛ والـ QR يُرسم متجهيًا فوق الصورة لحدّة المسح.
 * المكتبتان تُحمَّلان بـ import() عند أول ضغطة. لا يُسجَّل أي رمز أو بيانات شهادة.
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import CertificatePage from '../components/certificates/CertificatePage';
import { QR_DARK, QR_LIGHT } from '../components/member/QrImage';
import { PAGE_W, PAGE_H, FONTS } from '../pages/admin/certificateDesign';
import { fetchCertificateRenderData } from '../services/supabase/adminCertificates.service';
import { certificatePdfModel, qrRects, buildCertificatesZip, campaignZipName } from './certificateRender';

const DOM_SCALE = 4; // px لكل مم عند التصوير (1188×840)
const waitImages = (host) => Promise.all([...host.querySelectorAll('img')].map((img) => (
  img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
)));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

async function loadFonts(design) {
  if (!document.fonts?.load) return;
  const fams = new Set(['sans']);
  for (const el of design.elements) if (el.type === 'text') fams.add(el.font);
  const jobs = [];
  for (const f of fams) {
    const family = (FONTS[f] || FONTS.sans).split(',')[0].trim();
    if (/^['"]/.test(family)) for (const w of [400, 700]) jobs.push(document.fonts.load(`${w} 16px ${family}`, 'Aأ'));
  }
  await Promise.allSettled(jobs);
  await document.fonts.ready;
}

/** يبني PDF (A4 أفقي) لشهادة من بيانات get_certificate_render_data. @returns {{ bytes: Uint8Array, fileName: string }} */
export async function renderCertificatePdf(data) {
  const model = certificatePdfModel(data, window.location.origin);
  const { design, lang, vars } = model;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('lang', lang);
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W * DOM_SCALE}px;height:${PAGE_H * DOM_SCALE}px;overflow:hidden;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(CertificatePage, { design, lang, vars, qr: { blank: true }, scale: DOM_SCALE })));
    await loadFonts(design);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await waitImages(host);
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: design.background.color, useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    pdf.setProperties({ title: `Certificat ${model.number}`, creator: 'IAE' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_W, PAGE_H);
    canvas.width = 0; // يحرّر ذاكرة اللوحة مبكرًا (مهم في التنزيل الجماعي)
    canvas.height = 0;
    for (const el of design.elements) {
      if (el.type !== 'qr' || el.hidden) continue;
      const q = qrRects(model.qrText, el.x, el.y, el.w, el.h);
      pdf.setFillColor(...hex(QR_LIGHT));
      pdf.rect(q.ox, q.oy, q.side, q.side, 'F');
      pdf.setFillColor(...hex(QR_DARK));
      for (const r of q.rects) pdf.rect(r.x, r.y, r.w, r.h + 0.01, 'F');
    }
    return { bytes: new Uint8Array(pdf.output('arraybuffer')), fileName: model.fileName };
  } finally {
    root.unmount();
    host.remove();
  }
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fetchAndRender = async (certificateId) => renderCertificatePdf(await fetchCertificateRenderData(certificateId));

/** شهادة واحدة: يجلب البيانات الحقيقية، يولّد PDF، ويحفظه. */
export async function downloadCertificatePdf(certificateId) {
  const { bytes, fileName } = await fetchAndRender(certificateId);
  saveBlob(new Blob([bytes], { type: 'application/pdf' }), fileName);
  return fileName;
}

/** حملة كاملة: items = [{ id (certificate id), name }] الصالحة الصادرة فقط. لا ZIP إن فشلت كل الملفات. */
export async function downloadCampaignZip({ items, campaignTitle, onProgress }) {
  const res = await buildCertificatesZip({ items, renderPdf: fetchAndRender, onProgress });
  if (res.blob) saveBlob(res.blob, campaignZipName(campaignTitle));
  return { total: res.total, ok: res.ok, failures: res.failures, saved: !!res.blob };
}
