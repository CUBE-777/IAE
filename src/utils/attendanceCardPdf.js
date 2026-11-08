import { qrSvgPath } from './qr.js';
import { attendanceCodeText } from './attendanceCode.js';
import { buildPdfFromJpeg } from './pdfBuilder.js';

/**
 * تنزيل بطاقة حضور نشاط كملف PDF (صفحة A4): عنوان النشاط والتاريخ + صورة العضو واسمه + رمز QR كبير.
 * الرسم على canvas (المتصفح يتولى تشكيل العربية) ثم تُدمج الصورة في PDF بلا أي مكتبة ولا شبكة.
 * صورة العضو تُحمَّل بـ crossOrigin؛ إن فشلت (CORS/شبكة) نرسم شعار النادي بدلها فلا يتعطل التنزيل ولا يتلوّث canvas.
 */
const W = 1240; // A4 عند 150dpi
const H = 1754;
const NAVY = '#07254f';
const NAVY_MID = '#0a66c8';
const INK = '#12233f';
const MUTED = '#52627f';
const GREEN = '#14573a';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    return kept;
  }
  return lines;
}

export function pdfFileName(card) {
  const day = String(card.date || '').replace(/[^0-9-]/g, '');
  return `iae-attendance-${day ? `${day}-` : ''}${String(card.activity_id || '').slice(0, 8) || 'card'}.pdf`;
}

/**
 * @param {{ title: string, date?: string, token: string, activity_id?: string, attended?: boolean }} card
 * @param {{ fullName: string, photoUrl?: string|null, meta?: string }} member
 * @param {{ dir: 'rtl'|'ltr', lang: string, labels: { heading: string, show: string, attended: string, dateText?: string, brand: string } }} opts
 * @returns {Promise<Blob>} ملف PDF
 */
export async function buildAttendancePdf(card, member, opts) {
  const { dir, labels } = opts;
  try { await document.fonts?.ready; await document.fonts?.load?.('700 40px "IBM Plex Sans Arabic"'); } catch { /* الخط الاحتياطي يكفي */ }
  const [photo, logo] = await Promise.all([
    member.photoUrl ? loadImage(member.photoUrl) : Promise.resolve(null),
    loadImage('/logo.jpg'),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = dir;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';
  const font = (weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; };

  // الخلفية + الشريط العلوي
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, 420);
  grad.addColorStop(0, NAVY_MID);
  grad.addColorStop(0.6, '#0a3d80');
  grad.addColorStop(1, NAVY);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 430);

  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 100, 44, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, W / 2 - 44, 56, 88, 88);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  font(600, 34);
  ctx.fillText(labels.heading, W / 2, 200);
  ctx.fillStyle = '#ffffff';
  font(800, 62);
  const titleLines = wrapLines(ctx, card.title, W - 200, 3);
  titleLines.forEach((ln, i) => ctx.fillText(ln, W / 2, 285 + i * 76));
  if (labels.dateText) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    font(600, 36);
    ctx.fillText(labels.dateText, W / 2, 285 + titleLines.length * 76 + 10);
  }

  // صورة العضو (دائرة تتداخل مع حافة الشريط)
  const cy = 520;
  const r = 120;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(W / 2, cy, r + 12, 0, Math.PI * 2);
  ctx.fill();
  const face = photo || logo;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (face) {
    const s = Math.max((r * 2) / face.width, (r * 2) / face.height);
    const dw = face.width * s;
    const dh = face.height * s;
    ctx.drawImage(face, W / 2 - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = '#cfe0f7';
    ctx.fillRect(W / 2 - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.strokeStyle = NAVY_MID;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(W / 2, cy, r + 3, 0, Math.PI * 2);
  ctx.stroke();

  // الاسم
  ctx.fillStyle = INK;
  font(800, 58);
  const nameLines = wrapLines(ctx, member.fullName, W - 240, 2);
  nameLines.forEach((ln, i) => ctx.fillText(ln, W / 2, 705 + i * 68));
  let y = 705 + nameLines.length * 68;
  if (member.meta) {
    ctx.fillStyle = MUTED;
    font(500, 38);
    ctx.fillText(member.meta, W / 2, y + 4);
    y += 52;
  }

  // رمز QR: مقياس صحيح لكل وحدة ليبقى حادًّا
  const qr = qrSvgPath(attendanceCodeText(card.token));
  const unit = Math.max(1, Math.floor(540 / qr.size));
  const qrPx = unit * qr.size;
  const qy = Math.max(y + 60, 860);
  const qx = (W - qrPx) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d9e4f2';
  ctx.lineWidth = 4;
  ctx.fillRect(qx - 24, qy - 24, qrPx + 48, qrPx + 48);
  ctx.strokeRect(qx - 24, qy - 24, qrPx + 48, qrPx + 48);
  ctx.save();
  ctx.translate(qx, qy);
  ctx.scale(unit, unit);
  ctx.fillStyle = '#0b1220';
  ctx.fill(new Path2D(qr.d));
  ctx.restore();

  // التذييل
  const fy = qy + qrPx + 100;
  ctx.fillStyle = INK;
  font(700, 42);
  ctx.fillText(labels.show, W / 2, fy);
  if (card.attended && labels.attended) {
    ctx.fillStyle = '#e5f4ec';
    ctx.fillRect(160, fy + 36, W - 320, 84);
    ctx.fillStyle = GREEN;
    font(800, 44);
    ctx.fillText(`✓  ${labels.attended}`, W / 2, fy + 92);
  }
  ctx.fillStyle = MUTED;
  font(500, 30);
  ctx.fillText(labels.brand, W / 2, H - 44);

  const jpegBlob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.93));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = buildPdfFromJpeg(jpeg, W, H);
  return new Blob([pdf], { type: 'application/pdf' });
}

/** يُنزّل الـ Blob كملف (رابط مؤقت يُحرَّر بعد لحظة). */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
