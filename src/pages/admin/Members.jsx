import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import MemberFormModal from './MemberFormModal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { downloadCsv } from '../../utils/csvExport';
import {
  fetchMembersPage, softDeleteMember, fetchAllMembersForExport, PAGE_SIZE,
} from '../../services/supabase/adminMembers.service';

import { tr, trStrong } from '../../i18n/adminDict';
const FIELD = (v) => (v == null || v === '' ? '—' : v);
const CSV_HEADERS = ['full_name', 'university', 'promotion', 'track', 'profession', 'city', 'email', 'phone', 'status'];

export default function Members() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const search = useDebouncedValue(searchInput, 350);

  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = add, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    document.title = tr('الأعضاء — لوحة إدارة النادي');
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  const load = () => {
    setRows(null);
    setError(false);
    fetchMembersPage({ page, search, status })
      .then(({ rows: r, total: t }) => {
        setRows(r);
        setTotal(t);
      })
      .catch((err) => {
        console.error('تعذر تحميل الأعضاء:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الأعضاء'));
        setError(true);
      });
  };

  useEffect(load, [page, search, status]);

  const doDelete = async (member) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteMember(member);
      t?.remove();
      window.notify?.success(tr('تم حذف العضو'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    const t = window.notify?.loading(tr('جاري تجهيز الملف...'));
    try {
      const data = await fetchAllMembersForExport();
      downloadCsv('members.csv', data, CSV_HEADERS);
      t?.remove();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر تصدير الملف'));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الأعضاء')}
        subtitle={tr('إدارة جميع أعضاء النادي')}
        actions={
          <>
            <button className="admin-quick-action" disabled={exporting} onClick={exportCsv}>{tr('تصدير CSV')}</button>
            <button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة عضو')}</button>
          </>
        }
      />

      <div className="admin-panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            className="admin-input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={tr('ابحث بالاسم، الجامعة، المهنة، المدينة، الدفعة...')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select className="admin-select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr('كل الحالات')}</option>
            <option value="active">{tr('نشط')}</option>
            <option value="inactive">{tr('غير نشط')}</option>
          </select>
        </div>

        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر تحميل الأعضاء.')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا يوجد أعضاء مطابقون.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr><th>{tr('الاسم')}</th><th>{tr('الجامعة')}</th><th>{tr('الدفعة')}</th><th>{tr('المهنة')}</th><th>{tr('المدينة')}</th><th>{tr('الحالة')}</th><th>{tr('إجراءات')}</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td data-label={tr('الاسم')}>{m.full_name}</td>
                    <td data-label={tr('الجامعة')}>{FIELD(m.university)}</td>
                    <td data-label={tr('الدفعة')}>{FIELD(m.promotion)}</td>
                    <td data-label={tr('المهنة')}>{FIELD(m.profession)}</td>
                    <td data-label={tr('المدينة')}>{FIELD(m.city)}</td>
                    <td data-label={tr('الحالة')}><span className={`admin-badge admin-badge-${m.status === 'active' ? 'approved' : 'rejected'}`}>{m.status === 'active' ? tr('نشط') : tr('غير نشط')}</span></td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(m)}>{tr('تعديل')}</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(m)}>{tr('حذف')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className="admin-btn admin-btn-ghost admin-btn-sm"
                style={p === page ? { background: 'var(--admin-accent)', color: 'var(--admin-bg)', borderColor: 'var(--admin-accent)' } : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <MemberFormModal
          member={formTarget}
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
          <p>{trStrong('هل تريد حذف العضو <strong>{{name}}</strong>؟ يمكن استرجاعه لاحقًا من قاعدة البيانات.', { name: deleteTarget.full_name })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
