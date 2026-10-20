import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import ActivityFormModal from './ActivityFormModal';
import {
  fetchActivitiesAdmin, setActivityStatus, softDeleteActivity, STATUS_LABEL,
} from '../../services/supabase/adminActivities.service';

const STATUS_TO_BADGE = { draft: 'pending', published: 'approved', archived: 'rejected' };

export default function Activities() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    document.title = 'الأنشطة — لوحة إدارة الجمعية';
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchActivitiesAdmin()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الأنشطة:', err);
        window.notify?.fromError(err, 'تعذر تحميل الأنشطة');
        setError(true);
      });
  };

  useEffect(load, []);

  const changeStatus = async (activity, status) => {
    if (status === 'published' && (!activity.title || !activity.date || !activity.description)) {
      window.notify?.error('لا يمكن نشر نشاط ناقص، تأكد من العنوان والتاريخ والوصف.');
      return;
    }
    const t = window.notify?.loading('جاري التحديث...');
    try {
      await setActivityStatus(activity, status);
      t?.remove();
      window.notify?.success('تم التحديث بنجاح');
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر التحديث');
    }
  };

  const doDelete = async (activity) => {
    setDeleteTarget(null);
    const t = window.notify?.loading('جاري الحذف...');
    try {
      await softDeleteActivity(activity);
      t?.remove();
      window.notify?.success('تم حذف النشاط');
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر الحذف');
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title="الأنشطة"
        subtitle="إدارة أنشطة الجمعية ونشرها في الموقع"
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>+ إضافة نشاط</button>}
      />

      <div className="admin-panel">
        {rows === null && !error && <div className="admin-state-box">جاري التحميل...</div>}
        {error && <div className="admin-state-box">تعذر تحميل الأنشطة.</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">لا توجد أنشطة بعد.</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>العنوان</th><th>الفئة</th><th>التاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td data-label="العنوان">{a.title}</td>
                    <td data-label="الفئة">{a.category || '—'}</td>
                    <td data-label="التاريخ">{a.date ? new Date(a.date).toLocaleDateString('ar-MA') : '—'}</td>
                    <td data-label="الحالة"><span className={`admin-badge admin-badge-${STATUS_TO_BADGE[a.status]}`}>{STATUS_LABEL[a.status] || a.status}</span></td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(a)}>تعديل</button>
                      {a.status !== 'published' ? (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => changeStatus(a, 'published')}>نشر</button>
                      ) : (
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => changeStatus(a, 'archived')}>أرشفة</button>
                      )}
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(a)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <ActivityFormModal
          activity={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>تأكيد الحذف</h3>
          <p>هل تريد حذف النشاط <strong>{deleteTarget.title}</strong>؟</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>حذف</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
