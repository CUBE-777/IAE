/**
 * src/utils/imageCompress.js
 * ضغط الصور في المتصفح قبل رفعها: تصغير الأبعاد (حد أقصى 1600px) وتحويلها إلى WebP بجودة 82%.
 * تقلّل حجم صورة الهاتف من عدة ميغابايتات إلى مئات الكيلوبايتات بجودة تبدو كما هي.
 *
 * مبدأ الأمان: أي فشل (متصفح قديم، ملف غريب، لا دعم لـ WebP) يُرجع الملف الأصلي كما هو،
 * فلا يتعطل الرفع أبدًا بسبب الضغط. ولا نستبدل الأصل أبدًا إن لم تكن النتيجة أصغر منه.
 * GIF لا يُمسّ (قد يكون متحركًا).
 */
const MAX_DIM = 1600;
const QUALITY = 0.82;
const SKIP_BELOW = 150 * 1024; // ملفات صغيرة وبأبعاد مناسبة: لا حاجة لضغطها

async function loadSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file); // يحترم اتجاه EXIF افتراضيًا
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch {
      /* نجرّب عنصر Image */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function compressImage(file, { maxDim = MAX_DIM, quality = QUALITY } = {}) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    if (typeof document === 'undefined') return file;

    const src = await loadSource(file);
    try {
      const { width, height } = src;
      if (!width || !height) return file;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      if (scale === 1 && file.size <= SKIP_BELOW) return file;

      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(src.source, 0, 0, w, h);

      const blob = await toBlob(canvas, 'image/webp', quality);
      // بعض المتصفحات القديمة تتجاهل webp وتُرجع PNG: نترك الأصل حينها
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

      const base = (file.name || 'image').replace(/\.[^.]+$/, '');
      return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
    } finally {
      src.release();
    }
  } catch (err) {
    console.warn('تعذر ضغط الصورة، سيُرفع الملف الأصلي:', err);
    return file;
  }
}
