/**
 * src/utils/pdfBuilder.js
 * كاتب PDF أدنى بلا مكتبات: صفحة واحدة تحوي صورة JPEG تملأ الصفحة (DCTDecode). منطق خالص يُختبر في Node.
 * نستعمل صورة لأن رسم النص العربي (تشكيل الحروف واتجاه RTL) يتولاه المتصفح على canvas بدل تضمين خطوط في PDF.
 */
const enc = new TextEncoder();

/** @param {Uint8Array} jpeg بايتات JPEG @param {number} imgW @param {number} imgH @returns {Uint8Array} ملف PDF */
export function buildPdfFromJpeg(jpeg, imgW, imgH, { pageW = 595.28, pageH = 841.89 } = {}) {
  if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a jpeg');
  const w = Math.round(imgW);
  const h = Math.round(imgH);
  if (!(w > 0 && h > 0)) throw new Error('bad size');
  const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`;

  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObj = (n) => { offsets[n] = length; push(`${n} 0 obj\n`); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[^\x00-\x7f]/g, '')); // ترويسة ASCII فقط
  beginObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2); push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  beginObj(3);
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`);
  beginObj(4); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  beginObj(5);
  push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');

  const xrefAt = length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}
