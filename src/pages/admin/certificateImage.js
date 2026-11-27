import { MAX_IMAGE_CHARS, isSafeImageSrc } from './certificateDesign';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_ACCEPT = ACCEPTED.join(',');

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
    img.src = url;
  });
}

/**
 * يضغط صورة (PNG/JPEG/WebP) إلى data URI لا تتجاوز MAX_IMAGE_CHARS، بتصغير الأبعاد وخفض الجودة تدريجيًا.
 * قيد القاعدة (design ≤ 20000 بايت) يجعل الصور شعارات/زخارف صغيرة؛ لا يوجد تخزين ملفات في هذه المرحلة.
 * يرمي image_unsupported | image_decode_failed | image_too_large.
 */
export async function compressImage(file, { background = false } = {}) {
  if (!file || !ACCEPTED.includes(file.type)) throw new Error('image_unsupported');
  const img = await loadImage(file);
  const steps = background
    ? [[640, 0.5], [480, 0.45], [360, 0.4], [260, 0.35], [180, 0.3]]
    : [[360, 0.85], [280, 0.8], [220, 0.75], [160, 0.7], [120, 0.6], [80, 0.5]];
  // الخلفية: JPEG أخفّ (بلا شفافية)؛ غيرها: WebP للحفاظ على شفافية الشعارات (يعود PNG إن لم يدعمه المتصفح)
  const mime = background ? 'image/jpeg' : 'image/webp';
  for (const [maxDim, q] of steps) {
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL(mime, q);
    if (out.length <= MAX_IMAGE_CHARS && isSafeImageSrc(out)) return { src: out, ratio: w / h };
  }
  throw new Error('image_too_large');
}
