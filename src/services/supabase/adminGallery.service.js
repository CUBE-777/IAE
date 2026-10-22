import { supabase } from './client';
import { logAction } from './auth.service';
import { uploadImage } from './storage.service';
import { runWithColumnFallback } from './profileColumns';

export async function fetchActivitiesForLinking() {
  const { data } = await supabase.from('activities').select('id,title').is('deleted_at', null);
  return data || [];
}

export async function fetchGalleryAdmin() {
  const { data, error } = await supabase.from('gallery').select('*').is('deleted_at', null).order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function uploadGalleryFiles(files) {
  let success = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const url = await uploadImage(file, 'gallery');
      const { error } = await supabase.from('gallery').insert({ image_url: url, title: file.name.replace(/\.[^.]+$/, ''), sort_order: 0 });
      if (error) throw error;
      success++;
    } catch (err) {
      failed++;
      console.error(err);
    }
  }
  await logAction('ADMIN_UPLOADED_GALLERY_IMAGES', 'gallery', null, `رفع ${success} صورة إلى المعرض`);
  return { success, failed };
}

// يُرجع { degraded } = true إن حُفظ النص العربي فقط لأن عمود translations (0015) غير موجود بعد.
export async function updateGalleryItem(item, payload) {
  const { res, degraded } = await runWithColumnFallback(
    (p) => supabase.from('gallery').update(p).eq('id', item.id),
    payload
  );
  if (res.error) throw res.error;
  await logAction('ADMIN_UPDATED_IMAGE', 'gallery', item.id, 'تعديل بيانات صورة في المعرض');
  return { degraded };
}

export async function softDeleteGalleryItem(item) {
  const { error } = await supabase.from('gallery').update({ deleted_at: new Date().toISOString() }).eq('id', item.id);
  if (error) throw error;
  await logAction('ADMIN_DELETED_IMAGE', 'gallery', item.id, 'حذف صورة من المعرض');
}
