import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import AdminUserFormModal from './AdminUserFormModal';
import { useAuth } from '../../app/providers/AuthProvider';
import { fetchAdminProfiles, deactivateAdminProfile, ROLE_LABELS } from '../../services/supabase/adminUsers.service';

export default function AdminUsers() {
  const { profile: myProfile } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  useEffect(() => {
    document.title = 'المستخدمون الإداريون — لوحة إدارة الجمعية';
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchAdminProfiles()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل المستخدمين:', err);
        window.notify?.fromError(err, 'تعذر تحميل المستخدمين');
        setError(true);
      });
  };

  useEffect(load, []);

  const doDeactivate = async (p) => {
    setDeactivateTarget(null);
    const t = window.notify?.loading('جاري التنفيذ...');
    try {
      await deactivateAdminProfile(p);
      t?.remove();
      window.notify?.success('تمت إزالة صلاحية الوصول');
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر التنفيذ');
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title="المستخدمون الإداريون"
        subtitle="إدارة صلاحيات الوصول إلى لوحة الإدارة"
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>+ إنشاء مسؤول جديد</button>}
      />

      <div className="admin-panel" style={{ background: 'rgba(31,122,77,.08)', borderColor: 'rgba(31,122,77,.3)' }}>
        <p style={{ fontSize: '.86rem', color: 'var(--success-bright)', margin: 0 }}>
          إنشاء مسؤول جديد يتم بالكامل من هنا: أدخل الاسم والبريد وكلمة مرور (أو اضغط «توليد»)، ثم سلّم البريد وكلمة
          المرور للمسؤول الجديد ليدخل من صفحة تسجيل الدخول. لا حاجة لأي خطوات في Supabase.
        </p>
      </div>

      <div className="admin-panel">
        {rows === null && !error && <div className="admin-state-box">جاري التحميل...</div>}
        {error && <div className="admin-state-box">تعذر التحميل.</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label="الاسم">
                      {p.full_name}{' '}
                      {p.id === myProfile.id && <span className="admin-badge admin-badge-approved">أنت</span>}
                    </td>
                    <td data-label="البريد">{p.email}</td>
                    <td data-label="الدور">{ROLE_LABELS[p.role] || p.role}</td>
                    <td data-label="الحالة"><span className={`admin-badge admin-badge-${p.is_active ? 'approved' : 'rejected'}`}>{p.is_active ? 'نشط' : 'معطّل'}</span></td>
                    <td className="admin-cell-actions">
                      {/* حسابات المطوّرين يديرها المطوّر فقط (يُفرض أيضًا في قاعدة البيانات) */}
                      {p.role === 'developer' && myProfile.role !== 'developer' ? (
                        <span style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>محمي</span>
                      ) : (
                        <>
                          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(p)}>تعديل</button>
                          {p.id !== myProfile.id && (
                            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeactivateTarget(p)}>إزالة الصلاحية</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <AdminUserFormModal
          profile={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            load();
          }}
        />
      )}

      {deactivateTarget && (
        <Modal onClose={() => setDeactivateTarget(null)}>
          <h3>إزالة صلاحية الوصول</h3>
          <p>
            سيفقد <strong>{deactivateTarget.full_name}</strong> إمكانية الدخول إلى لوحة الإدارة فورًا (لن يُحذف حسابه من
            Supabase Auth، ويمكن إعادة تفعيله لاحقًا من هذه الصفحة عبر "تعديل").
          </p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDeactivate(deactivateTarget)}>إزالة</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeactivateTarget(null)}>إلغاء</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
