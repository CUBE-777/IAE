import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import ActivityFormModal from './ActivityFormModal';
import {
  fetchActivitiesAdmin, setActivityStatus, softDeleteActivity, STATUS_LABEL,
} from '../../services/supabase/adminActivities.service';

import { tr, trStrong, dateLocale } from '../../i18n/adminDict';
const STATUS_TO_BADGE = { draft: 'pending', published: 'approved', archived: 'rejected' };

export default function Activities() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    document.title = tr('الأنشطة — لوحة إدارة النادي');
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchActivitiesAdmin()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الأنشطة:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الأنشطة'));
        setError(true);
      });
  };

  useEffect(load, []);

  const changeStatus = async (activity, status) => {
    if (status === 'published' && (!activity.title || !activity.date || !activity.description)) {
      window.notify?.error(tr('لا يمكن نشر نشاط ناقص، تأكد من العنوان والتاريخ والوصف.'));
      return;
    }
    const t = window.notify?.loading(tr('جاري التحديث...'));
    try {
      await setActivityStatus(activity, status);
      t?.remove();
      window.notify?.success(tr('تم التحديث بنجاح'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر التحديث'));
    }
  };

  const doDelete = async (activity) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteActivity(activity);
      t?.remove();
      window.notify?.success(tr('تم حذف النشاط'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الأنشطة')}
        subtitle={tr('إدارة أنشطة النادي ونشرها في الموقع')}
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة نشاط')}</button>}
      />

      <div className="admin-panel">
        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر تحميل الأنشطة.')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد أنشطة بعد.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>{tr('العنوان')}</th><th>{tr('الفئة')}</th><th>{tr('التاريخ')}</th><th>{tr('الحالة')}</th><th>{tr('إجراءات')}</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td data-label={tr('العنوان')}>{a.title}</td>
                    <td data-label={tr('الفئة')}>{a.category || '—'}</td>
                    <td data-label={tr('التاريخ')}>{a.date ? new Date(a.date).toLocaleDateString(dateLocale()) : '—'}</td>
                    <td data-label={tr('الحالة')}><span className={`admin-badge admin-badge-${STATUS_TO_BADGE[a.status]}`}>{tr(STATUS_LABEL[a.status] || a.status)}</span></td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(a)}>{tr('تعديل')}</button>
                      {a.status !== 'published' ? (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => changeStatus(a, 'published')}>{tr('نشر')}</button>
                      ) : (
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => changeStatus(a, 'archived')}>{tr('أرشفة')}</button>
                      )}
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(a)}>{tr('حذف')}</button>
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
          <h3>{tr('تأكيد الحذف')}</h3>
          <p>{trStrong('هل تريد حذف النشاط <strong>{{name}}</strong>؟', { name: deleteTarget.title })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
