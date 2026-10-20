import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import BoardFormModal from './BoardFormModal';
import StateBox from '../../components/admin/StateBox';
import { fetchBoardMembers, reorderBoardMembers, deleteBoardMember } from '../../services/supabase/adminBoard.service';

export default function Board() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    document.title = 'أعضاء المكتب — لوحة إدارة الجمعية';
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchBoardMembers()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل أعضاء المكتب:', err);
        window.notify?.fromError(err, 'تعذر تحميل أعضاء المكتب');
        setError(true);
      });
  };

  useEffect(load, []);

  const [moving, setMoving] = useState(false);

  // الترتيب الجديد يُرسل كاملاً لدالة RPC ذرّية؛ لا نعتبر العملية ناجحة إلا بعد نجاحها فعليًا
  const move = async (item, dir) => {
    const idx = rows.indexOf(item);
    const target = idx + dir;
    if (target < 0 || target >= rows.length || moving) return;
    const next = [...rows];
    [next[idx], next[target]] = [next[target], next[idx]];
    setMoving(true);
    try {
      await reorderBoardMembers(next.map((r) => r.id));
      window.notify?.success('تم تغيير الترتيب');
      load();
    } catch (err) {
      window.notify?.fromError(err, 'تعذر تغيير الترتيب');
    } finally {
      setMoving(false);
    }
  };

  const doDelete = async (member) => {
    setDeleteTarget(null);
    const t = window.notify?.loading('جاري الحذف...');
    try {
      await deleteBoardMember(member);
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
        title="أعضاء المكتب"
        subtitle='يظهر هذا الترتيب في صفحة "المكتب" على الموقع العام'
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>+ إضافة عضو مكتب</button>}
      />

      <div className="admin-panel">
        <StateBox
          state={error ? 'error' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : ''}
          emptyText="لا يوجد أعضاء مكتب بعد."
          errorText="تعذر تحميل أعضاء المكتب."
          onRetry={load}
        />
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>#</th><th>الاسم</th><th>الصفة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {rows.map((b, i) => (
                  <tr key={b.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="الاسم">{b.full_name}</td>
                    <td data-label="الصفة">{b.position}</td>
                    <td data-label="الحالة"><span className={`admin-badge admin-badge-${b.is_active ? 'approved' : 'rejected'}`}>{b.is_active ? 'نشط' : 'غير نشط'}</span></td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" aria-label="رفع للأعلى" disabled={i === 0 || moving} onClick={() => move(b, -1)}>↑</button>
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" aria-label="إنزال للأسفل" disabled={i === rows.length - 1 || moving} onClick={() => move(b, 1)}>↓</button>
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(b)}>تعديل</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(b)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <BoardFormModal
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
          <p>حذف <strong>{deleteTarget.full_name}</strong> من أعضاء المكتب؟</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>حذف</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
