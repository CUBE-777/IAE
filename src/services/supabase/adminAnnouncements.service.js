import { supabase } from './client';
import { logAction } from './auth.service';
import { uploadImage, deleteImageByUrl } from './storage.service';

export async function fetchAnnouncementsAdmin() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * يحفظ إعلانًا (إنشاء/تعديل) مع إدارة صورته في Storage بلا ملفات يتيمة:
 *  - الرفع أولاً؛ إن فشل إدخال/تعديل الصف بعده يُحذف الملف المرفوع للتو.
 *  - الصورة القديمة لا تُحذف إلا بعد نجاح حفظ الصف (استبدال أو إزالة).
 * `image`: { file?: File, remove?: boolean } — بدون تغيير تُترك الصورة كما هي.
 */
export async function saveAnnouncement(existing, payload, image = {}) {
  let uploadedUrl = null;
  const dbPayload = { ...payload };

  if (image.file) {
    uploadedUrl = await uploadImage(image.file, 'announcements');
    dbPayload.image_url = uploadedUrl;
  } else if (image.remove) {
    dbPayload.image_url = null;
  }

  let savedId = existing?.id || null;
  try {
    if (existing) {
      const { error } = await supabase.from('announcements').update(dbPayload).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('announcements').insert(dbPayload).select('id').single();
      if (error) throw error;
      savedId = data?.id || null;
    }
  } catch (err) {
    if (uploadedUrl) await deleteImageByUrl(uploadedUrl); // تنظيف: لا ملف يتيم
    throw err;
  }

  // نجح الحفظ: احذف الصورة القديمة إن استُبدلت أو أُزيلت
  if (existing?.image_url && (uploadedUrl || image.remove) && existing.image_url !== dbPayload.image_url) {
    await deleteImageByUrl(existing.image_url);
  }

  await logAction(
    existing ? 'ADMIN_UPDATED_ANNOUNCEMENT' : 'ADMIN_CREATED_ANNOUNCEMENT',
    'announcements',
    savedId,
    `${existing ? 'تعديل' : 'إضافة'} إعلان: ${(payload.title || payload.text || '').slice(0, 60)}`
  );
  return savedId;
}

/** تبديل سريع للنشر/التثبيت من القائمة. */
export async function setAnnouncementFlags(announcement, flags) {
  const patch = { ...flags };
  // عند النشر لأول مرة بدون تاريخ نشر: يُسجَّل الوقت الحالي كتاريخ نشر فعلي
  if (flags.is_active === true && !announcement.start_at) patch.start_at = new Date().toISOString();
  const { error } = await supabase.from('announcements').update(patch).eq('id', announcement.id);
  if (error) throw error;
  const what = 'is_active' in flags ? (flags.is_active ? 'نشر' : 'إلغاء نشر') : flags.is_pinned ? 'تثبيت' : 'إلغاء تثبيت';
  await logAction('ADMIN_UPDATED_ANNOUNCEMENT', 'announcements', announcement.id, `${what} إعلان: ${(announcement.title || announcement.text || '').slice(0, 60)}`);
}

export async function deleteAnnouncement(announcement) {
  const { error } = await supabase.from('announcements').delete().eq('id', announcement.id);
  if (error) throw error;
  if (announcement.image_url) await deleteImageByUrl(announcement.image_url);
  await logAction('ADMIN_DELETED_ANNOUNCEMENT', 'announcements', announcement.id, `حذف إعلان: ${(announcement.title || announcement.text || '').slice(0, 60)}`);
}
