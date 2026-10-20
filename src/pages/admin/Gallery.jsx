import { useEffect, useRef, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import StateBox from '../../components/admin/StateBox';
import GalleryEditModal from './GalleryEditModal';
import {
  fetchActivitiesForLinking, fetchGalleryAdmin, uploadGalleryFiles, softDeleteGalleryItem,
} from '../../services/supabase/adminGallery.service';

export default function Gallery() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [activities, setActivities] = useState([]);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.title = 'معرض الصور — لوحة إدارة الجمعية';
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
        window.notify?.fromError(err, 'تعذر تحميل الصور');
        setError(true);
      });
  };

  useEffect(load, []);

  const activityTitle = (id) => (activities.find((a) => a.id === id) || {}).title || '';

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    const t = window.notify?.loading(`جاري رفع ${files.length} صورة...`);
    try {
      const { success, failed } = await uploadGalleryFiles(files);
      t?.remove();
      if (success) window.notify?.success(`تم رفع ${success} صورة بنجاح`);
      if (failed) window.notify?.error(`تعذر رفع ${failed} صورة`);
      load();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const doDelete = async (item) => {
    setDeleteTarget(null);
    const t = window.notify?.loading('جاري الحذف...');
    try {
      await softDeleteGalleryItem(item);
      t?.remove();
      window.notify?.success('تم الحذف');
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر الحذف');
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title="معرض الصور"
        subtitle="رفع وإدارة صور المعرض العام"
        actions={
          <label className="admin-quick-action admin-upload-label">
            {uploading ? 'جاري الرفع...' : '+ رفع صور'}
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
          </label>
        }
      />

      <div className="admin-panel">
        <StateBox
          state={error ? 'error' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : ''}
          emptyText="لا توجد صور بعد."
          errorText="تعذر تحميل الصور."
          onRetry={load}
        />
        {rows && rows.length > 0 && (
          <div className="admin-media-grid">
            {rows.map((g) => (
              <div className="admin-media-item" key={g.id}>
                <img src={g.image_url} alt={g.title || ''} loading="lazy" />
                <div className="media-body">
                  <div className="media-title">{g.title || 'بدون عنوان'}</div>
                  <div className="media-sub">{g.activity_id ? activityTitle(g.activity_id) : 'غير مرتبطة بنشاط'}</div>
                </div>
                <div className="media-actions">
                  <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" aria-label={`تعديل الصورة: ${g.title || 'بدون عنوان'}`} onClick={() => setEditTarget(g)}>تعديل</button>
                  <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" aria-label={`حذف الصورة: ${g.title || 'بدون عنوان'}`} onClick={() => setDeleteTarget(g)}>حذف</button>
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
          <h3>حذف الصورة</h3>
          <p>هل تريد حذف هذه الصورة من المعرض؟</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>حذف</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
