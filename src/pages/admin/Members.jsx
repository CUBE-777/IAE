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
    document.title = 'الأعضاء — لوحة إدارة الجمعية';
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
        window.notify?.fromError(err, 'تعذر تحميل الأعضاء');
        setError(true);
      });
  };

  useEffect(load, [page, search, status]);

  const doDelete = async (member) => {
    setDeleteTarget(null);
    const t = window.notify?.loading('جاري الحذف...');
    try {
      await softDeleteMember(member);
      t?.remove();
      window.notify?.success('تم حذف العضو');
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر الحذف');
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    const t = window.notify?.loading('جاري تجهيز الملف...');
    try {
      const data = await fetchAllMembersForExport();
      downloadCsv('members.csv', data, CSV_HEADERS);
      t?.remove();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر تصدير الملف');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <AdminPageHeader
        title="الأعضاء"
        subtitle="إدارة جميع أعضاء الجمعية"
        actions={
          <>
            <button className="admin-quick-action" disabled={exporting} onClick={exportCsv}>تصدير CSV</button>
            <button className="admin-quick-action" onClick={() => setFormTarget(null)}>+ إضافة عضو</button>
          </>
        }
      />

      <div className="admin-panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            className="admin-input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder="ابحث بالاسم، الجامعة، المهنة، المدينة، الدفعة..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select className="admin-select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {rows === null && !error && <div className="admin-state-box">جاري التحميل...</div>}
        {error && <div className="admin-state-box">تعذر تحميل الأعضاء.</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">لا يوجد أعضاء مطابقون.</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr><th>الاسم</th><th>الجامعة</th><th>الدفعة</th><th>المهنة</th><th>المدينة</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td data-label="الاسم">{m.full_name}</td>
                    <td data-label="الجامعة">{FIELD(m.university)}</td>
                    <td data-label="الدفعة">{FIELD(m.promotion)}</td>
                    <td data-label="المهنة">{FIELD(m.profession)}</td>
                    <td data-label="المدينة">{FIELD(m.city)}</td>
                    <td data-label="الحالة"><span className={`admin-badge admin-badge-${m.status === 'active' ? 'approved' : 'rejected'}`}>{m.status === 'active' ? 'نشط' : 'غير نشط'}</span></td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(m)}>تعديل</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(m)}>حذف</button>
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
          <h3>تأكيد الحذف</h3>
          <p>هل تريد حذف العضو <strong>{deleteTarget.full_name}</strong>؟ يمكن استرجاعه لاحقًا من قاعدة البيانات.</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>حذف</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
