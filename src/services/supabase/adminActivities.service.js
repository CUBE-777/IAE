import { supabase } from './client';
import { logAction } from './auth.service';
import { runWithColumnFallback } from './profileColumns';

export const STATUS_LABEL = { draft: 'مسودة', published: 'منشور', archived: 'مؤرشف' };

export async function fetchActivitiesAdmin() {
  const { data, error } = await supabase.from('activities').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

function slugify(title) {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\u0600-\u06FFa-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    Date.now().toString(36)
  );
}

// يُرجع { degraded } = true إن حُفظ النص العربي فقط لأن عمود translations (0013) غير موجود بعد.
export async function saveActivity(existing, payload) {
  if (!existing) {
    payload.slug = slugify(payload.title);
    payload.status = 'draft';
  }
  if (existing) {
    const { res, degraded } = await runWithColumnFallback(
      (p) => supabase.from('activities').update(p).eq('id', existing.id),
      payload
    );
    if (res.error) throw res.error;
    await logAction('ADMIN_UPDATED_ACTIVITY', 'activities', existing.id, `تعديل النشاط ${payload.title}`);
    return { degraded };
  }
  const { res, degraded } = await runWithColumnFallback(
    (p) => supabase.from('activities').insert(p).select().single(),
    payload
  );
  if (res.error) throw res.error;
  await logAction('ADMIN_CREATED_ACTIVITY', 'activities', res.data.id, `إضافة نشاط جديد: ${payload.title}`);
  return { degraded };
}

export async function setActivityStatus(activity, status) {
  const { error } = await supabase.from('activities').update({ status }).eq('id', activity.id);
  if (error) throw error;
  await logAction(
    status === 'published' ? 'ADMIN_PUBLISHED_ACTIVITY' : 'ADMIN_ARCHIVED_ACTIVITY',
    'activities',
    activity.id,
    `تغيير حالة النشاط ${activity.title} إلى ${STATUS_LABEL[status]}`
  );
}

export async function softDeleteActivity(activity) {
  const { error } = await supabase.from('activities').update({ deleted_at: new Date().toISOString() }).eq('id', activity.id);
  if (error) throw error;
  await logAction('ADMIN_DELETED_ACTIVITY', 'activities', activity.id, `حذف النشاط ${activity.title}`);
}
