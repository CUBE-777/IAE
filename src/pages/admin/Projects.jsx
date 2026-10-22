import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import ProjectFormModal from './ProjectFormModal';
import {
  fetchProjectsAdmin, setProjectPublished, softDeleteProject,
} from '../../services/supabase/adminProjects.service';

import { tr, trStrong } from '../../i18n/adminDict';

export default function Projects() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined); // undefined = fermé, null = création
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    document.title = tr('المشاريع — لوحة إدارة النادي');
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchProjectsAdmin()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل المشاريع:', err);
        window.notify?.fromError(err, tr('تعذر تحميل المشاريع'));
        setError(true);
      });
  };

  useEffect(load, []);

  const togglePublish = async (project, publish) => {
    if (publish && (!project.title || !project.summary)) {
      window.notify?.error(tr('لا يمكن نشر مشروع بدون عنوان وملخص.'));
      return;
    }
    const t = window.notify?.loading(tr('جاري التحديث...'));
    try {
      await setProjectPublished(project, publish);
      t?.remove();
      window.notify?.success(tr('تم التحديث بنجاح'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر التحديث'));
    }
  };

  const doDelete = async (project) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteProject(project);
      t?.remove();
      window.notify?.success(tr('تم حذف المشروع'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('المشاريع')}
        subtitle={tr('إدارة مشاريع النادي ونشرها في الموقع')}
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة مشروع')}</button>}
      />

      <div className="admin-panel">
        {rows === null && !error && <div className="admin-state-box" role="status">{tr('جاري التحميل...')}</div>}
        {error && (
          <div className="admin-state-box admin-state-error" role="alert">
            <span>{tr('تعذر تحميل المشاريع.')}</span>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={load}>{tr('إعادة المحاولة')}</button>
          </div>
        )}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد مشاريع بعد.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{tr('العنوان')}</th><th>{tr('حالة المشروع')}</th><th>{tr('النشر')}</th><th>{tr('ترتيب العرض')}</th><th>{tr('إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label={tr('العنوان')}>{p.title}</td>
                    <td data-label={tr('حالة المشروع')}>{p.status === 'completed' ? tr('منجز') : tr('قيد التنفيذ')}</td>
                    <td data-label={tr('النشر')}>
                      <span className={`admin-badge admin-badge-${p.is_published ? 'approved' : 'pending'}`}>
                        {p.is_published ? tr('منشور') : tr('مسودة')}
                      </span>
                    </td>
                    <td data-label={tr('ترتيب العرض')}>{p.sort_order}</td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(p)}>{tr('تعديل')}</button>
                      {p.is_published ? (
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => togglePublish(p, false)}>{tr('إلغاء النشر')}</button>
                      ) : (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => togglePublish(p, true)}>{tr('نشر')}</button>
                      )}
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(p)}>{tr('حذف')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <ProjectFormModal
          project={formTarget}
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
          <p>{trStrong('هل تريد حذف المشروع <strong>{{name}}</strong>؟', { name: deleteTarget.title })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
