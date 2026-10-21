import { supabase } from './client';
import { compressImage } from '../../utils/imageCompress';

import { tr } from '../../i18n/adminDict';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB (بعد الضغط)
const MAX_INPUT_SIZE = 15 * 1024 * 1024; // نقبل صور الهاتف الكبيرة لأنها تُضغط قبل الرفع

/** يرفع صورة إلى bucket "association-media" ويُرجع الرابط العام، مطابق تمامًا لسلوك uploadFile() الأصلي. */
export async function uploadImage(file, folder) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(tr('نوع الملف غير مدعوم، استخدم صورة JPG أو PNG أو WEBP.'));
  }
  if (file.size > MAX_INPUT_SIZE) {
    throw new Error(tr('حجم الملف أكبر من 15MB.'));
  }
  // ضغط تلقائي (يرجع الأصل إن تعذّر). الحد 5MB يُطبَّق على الملف النهائي المرفوع.
  const prepared = await compressImage(file);
  if (prepared.size > MAX_SIZE) {
    throw new Error(tr('حجم الملف أكبر من 5MB.'));
  }
  const path = `${folder}/${Date.now()}-${prepared.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const { error } = await supabase.storage
    .from('association-media')
    .upload(path, prepared, { upsert: false, contentType: prepared.type });
  if (error) throw error;
  const { data } = supabase.storage.from('association-media').getPublicUrl(path);
  return data.publicUrl;
}

const PUBLIC_PREFIX = '/storage/v1/object/public/association-media/';

/** يستخرج مسار الملف داخل الـ bucket من رابطه العام، أو null إن لم يكن من هذا الـ bucket. */
export function storagePathFromUrl(url) {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    const i = pathname.indexOf(PUBLIC_PREFIX);
    if (i === -1) return null;
    return decodeURIComponent(pathname.slice(i + PUBLIC_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * يحذف ملفًا من bucket "association-media" عبر رابطه العام. يُستعمل لتنظيف
 * الملفات اليتيمة (فشل الإدخال بعد الرفع، أو استبدال/حذف صورة). لا يرمي خطأ:
 * فشل الحذف يُسجَّل فقط حتى لا يعطّل العملية الأساسية.
 */
export async function deleteImageByUrl(url) {
  const path = storagePathFromUrl(url);
  if (!path) return false;
  const { error } = await supabase.storage.from('association-media').remove([path]);
  if (error) {
    console.error('تعذر حذف الملف من التخزين:', path, error);
    return false;
  }
  return true;
}
