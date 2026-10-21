import { useEffect, useRef, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import StateBox from '../../components/admin/StateBox';
import GalleryEditModal from './GalleryEditModal';
import {
  fetchActivitiesForLinking, fetchGalleryAdmin, uploadGalleryFiles, softDeleteGalleryItem,
} from '../../services/supabase/adminGallery.service';

import { tr } from '../../i18n/adminDict';
export default function Gallery() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [activities, setActivities] = useState([]);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.title = tr('معرض الصور — لوحة إدارة النادي');
    fetchActivitiesForLinking()
      .then(setActivities)
      .catch((err) => console.error('تعذر تحميل قائمة الأنشطة للربط:', err));
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchGalleryAdmin()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الصور:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الصور'));
        setError(true);
      });
  };

  useEffect(load, []);

  const activityTitle = (id) => (activities.find((a) => a.id === id) || {}).title || '';

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    const t = window.notify?.loading(tr('جاري رفع {{length}} صورة...', { length: files.length }));
    try {
      const { success, failed } = await uploadGalleryFiles(files);
      t?.remove();
      if (success) window.notify?.success(tr('تم رفع {{success}} صورة بنجاح', { success: success }));
      if (failed) window.notify?.error(tr('تعذر رفع {{failed}} صورة', { failed: failed }));
      load();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const doDelete = async (item) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteGalleryItem(item);
      t?.remove();
      window.notify?.success(tr('تم الحذف'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('معرض الصور')}
        subtitle={tr('رفع وإدارة صور المعرض العام')}
        actions={
          <label className="admin-quick-action admin-upload-label">
            {uploading ? tr('جاري الرفع...') : tr('+ رفع صور')}
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
          </label>
        }
      />

      <div className="admin-panel">
        <StateBox
          state={error ? 'error' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : ''}
          emptyText={tr('لا توجد صور بعد.')}
          errorText={tr('تعذر تحميل الصور.')}
          onRetry={load}
        />
        {rows && rows.length > 0 && (
          <div className="admin-media-grid">
            {rows.map((g) => (
              <div className="admin-media-item" key={g.id}>
                <img src={g.image_url} alt={g.title || ''} loading="lazy" />
                <div className="media-body">
                  <div className="media-title">{g.title || tr('بدون عنوان')}</div>
                  <div className="media-sub">{g.activity_id ? activityTitle(g.activity_id) : tr('غير مرتبطة بنشاط')}</div>
                </div>
                <div className="media-actions">
                  <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" aria-label={tr('تعديل الصورة: {{v1}}', { v1: g.title || 'بدون عنوان' })} onClick={() => setEditTarget(g)}>{tr('تعديل')}</button>
                  <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" aria-label={tr('حذف الصورة: {{v1}}', { v1: g.title || 'بدون عنوان' })} onClick={() => setDeleteTarget(g)}>{tr('حذف')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editTarget && (
        <GalleryEditModal
          item={editTarget}
          activities={activities}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>{tr('حذف الصورة')}</h3>
          <p>{tr('هل تريد حذف هذه الصورة من المعرض؟')}</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
