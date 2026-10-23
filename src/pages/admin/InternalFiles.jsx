import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import InternalFileUploadModal from './InternalFileUploadModal';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  fetchInternalFiles, getInternalFileDownloadUrl, softDeleteInternalFile,
} from '../../services/supabase/internalFiles.service';
import { INTERNAL_FILE_CATEGORIES, formatBytes } from '../../utils/internalFiles';
import { normalizeSearchValue } from '../../utils/arabicSearch';

import { tr, trStrong, dateLocale } from '../../i18n/adminDict';

const CATEGORY_LABEL = Object.fromEntries(INTERNAL_FILE_CATEGORIES);
const CAN_DELETE_ROLES = ['developer', 'super_admin', 'deputy_super_admin', 'secretary_general']; // identique à can_delete_internal_files() (0019)

export default function InternalFiles() {
  const { profile } = useAuth();
  const canDelete = CAN_DELETE_ROLES.includes(profile?.role);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    document.title = tr('الملفات الداخلية — لوحة إدارة النادي');
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchInternalFiles()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الملفات الداخلية:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الملفات الداخلية'));
        setError(true);
      });
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = normalizeSearchValue(query);
    return (rows || []).filter((f) => {
      if (category && f.category !== category) return false;
      if (!q) return true;
      return normalizeSearchValue(`${f.title} ${f.file_name} ${f.description || ''}`).includes(q);
    });
  }, [rows, category, query]);

  const download = async (file) => {
    setBusyId(file.id);
    try {
      const url = await getInternalFileDownloadUrl(file);
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر تنزيل الملف'));
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (file) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteInternalFile(file);
      t?.remove();
      window.notify?.success(tr('تم حذف الملف'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الملفات الداخلية')}
        subtitle={tr('وثائق النادي الداخلية: متاحة للإدارة فقط ولا تُنشر في الموقع')}
        actions={<button className="admin-quick-action" onClick={() => setUploadOpen(true)}>{tr('+ رفع ملف')}</button>}
      />

      <div className="admin-panel">
        {rows && rows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <input
              type="search"
              className="admin-input"
              style={{ flex: '1 1 220px', maxWidth: 360 }}
              placeholder={tr('بحث في الملفات...')}
              aria-label={tr('بحث في الملفات...')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="admin-select" style={{ width: 'auto' }} aria-label={tr('الفئة')} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{tr('كل الفئات')}</option>
              {INTERNAL_FILE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}
            </select>
          </div>
        )}

        {rows === null && !error && <div className="admin-state-box" role="status">{tr('جاري التحميل...')}</div>}
        {error && (
          <div className="admin-state-box admin-state-error" role="alert">
            <span>{tr('تعذر تحميل الملفات الداخلية.')}</span>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={load}>{tr('إعادة المحاولة')}</button>
          </div>
        )}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد ملفات داخلية بعد.')}</div>}
        {rows && rows.length > 0 && filtered.length === 0 && <div className="admin-state-box">{tr('لا توجد ملفات مطابقة.')}</div>}

        {filtered.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{tr('العنوان')}</th><th>{tr('الفئة')}</th><th>{tr('الملف')}</th><th>{tr('رفعه')}</th><th>{tr('التاريخ')}</th><th>{tr('إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id}>
                    <td data-label={tr('العنوان')}>
                      <strong>{f.title}</strong>
                      {f.description && <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{f.description}</div>}
                    </td>
                    <td data-label={tr('الفئة')}>{tr(CATEGORY_LABEL[f.category] || 'أخرى')}</td>
                    <td data-label={tr('الملف')}>
                      <span dir="ltr" style={{ unicodeBidi: 'isolate', overflowWrap: 'anywhere' }}>{f.file_name}</span>
                      <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{formatBytes(f.size_bytes)}</div>
                    </td>
                    <td data-label={tr('رفعه')}>{f.uploaded_by_name || '—'}</td>
                    <td data-label={tr('التاريخ')}>{new Date(f.created_at).toLocaleDateString(dateLocale())}</td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={busyId === f.id} onClick={() => download(f)}>{tr('تنزيل')}</button>
                      {canDelete && (
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(f)}>{tr('حذف')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {uploadOpen && (
        <InternalFileUploadModal
          onClose={() => setUploadOpen(false)}
          onSaved={() => {
            setUploadOpen(false);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>{tr('تأكيد الحذف')}</h3>
          <p>{trStrong('هل تريد حذف الملف <strong>{{name}}</strong>؟', { name: deleteTarget.title })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
