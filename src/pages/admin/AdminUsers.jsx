import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import AdminUserFormModal from './AdminUserFormModal';
import AdminMemberLinkModal from './AdminMemberLinkModal';
import { useAuth } from '../../app/providers/AuthProvider';
import { fetchAdminProfiles, deactivateAdminProfile, ROLE_LABELS } from '../../services/supabase/adminUsers.service';
import { fetchAdminMemberLinkOverview, unlinkAdminAsMember } from '../../services/supabase/adminAccountLinks.service';

import { tr, trStrong } from '../../i18n/adminDict';
export default function AdminUsers() {
  const { profile: myProfile } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  // ربط الحساب الإداري بفضاء المنخرطين (0046): خريطة user_id → صف النظرة العامة. null = الميزة غير متاحة (لم تُطبَّق 0046)
  const [links, setLinks] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [unlinkTarget, setUnlinkTarget] = useState(null);

  useEffect(() => {
    document.title = tr('المستخدمون الإداريون — لوحة إدارة النادي');
  }, []);

  const load = () => {
    setRows(null);
    setError(false);
    fetchAdminProfiles()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل المستخدمين:', err);
        window.notify?.fromError(err, tr('تعذر تحميل المستخدمين'));
        setError(true);
      });
  };

  const loadLinks = () => {
    fetchAdminMemberLinkOverview()
      .then((list) => setLinks(Object.fromEntries(list.map((r) => [r.user_id, r]))))
      .catch((err) => {
        console.warn('ربط فضاء المنخرطين غير متاح (طبّق migration 0046):', err);
        setLinks(null);
      });
  };

  useEffect(load, []);
  useEffect(loadLinks, []);

  const doUnlink = async (row) => {
    setUnlinkTarget(null);
    const t = window.notify?.loading(tr('جاري التنفيذ...'));
    try {
      await unlinkAdminAsMember(row.user_id);
      t?.remove();
      window.notify?.success(tr('تم فصل فضاء المنخرطين'));
      loadLinks();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الفصل'));
    }
  };

  // حالة الربط للعرض: none | active | off
  const linkState = (row) => {
    if (!row?.account) return 'none';
    return row.account.is_active && row.account.admin_linked ? 'active' : row.account.is_active ? 'none' : 'off';
  };

  const doDeactivate = async (p) => {
    setDeactivateTarget(null);
    const t = window.notify?.loading(tr('جاري التنفيذ...'));
    try {
      await deactivateAdminProfile(p);
      t?.remove();
      window.notify?.success(tr('تمت إزالة صلاحية الوصول'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر التنفيذ'));
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('المستخدمون الإداريون')}
        subtitle={tr('إدارة صلاحيات الوصول إلى لوحة الإدارة')}
        actions={<button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إنشاء مسؤول جديد')}</button>}
      />

      <div className="admin-panel" style={{ background: 'rgba(31,122,77,.08)', borderColor: 'rgba(31,122,77,.3)' }}>
        <p style={{ fontSize: '.86rem', color: 'var(--success-bright)', margin: 0 }}>
          {tr('إنشاء مسؤول جديد يتم بالكامل من هنا: أدخل الاسم والبريد وكلمة مرور (أو اضغط «توليد»)، ثم سلّم البريد وكلمة المرور للمسؤول الجديد ليدخل من صفحة تسجيل الدخول. لا حاجة لأي خطوات في Supabase.')}
        </p>
      </div>

      {links && (
        <div className="admin-panel">
          <p style={{ fontSize: '.86rem', margin: 0 }}>
            {tr('يمكن ربط الحساب الإداري بفضاء المنخرطين ليدخل صاحبه إلى الفضاءين بنفس البريد وكلمة المرور، ويتعرّف على بطاقته في المكتب ليطلب تعديلها.')}
          </p>
        </div>
      )}

      <div className="admin-panel">
        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر التحميل.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>{tr('الاسم')}</th><th>{tr('البريد')}</th><th>{tr('الدور')}</th><th>{tr('الحالة')}</th>{links && <th>{tr('فضاء المنخرطين')}</th>}<th>{tr('إجراءات')}</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label={tr('الاسم')}>
                      {p.full_name}{' '}
                      {p.id === myProfile.id && <span className="admin-badge admin-badge-approved">{tr('أنت')}</span>}
                    </td>
                    <td data-label={tr('البريد')}>{p.email}</td>
                    <td data-label={tr('الدور')}>{tr(ROLE_LABELS[p.role] || p.role)}</td>
                    <td data-label={tr('الحالة')}><span className={`admin-badge admin-badge-${p.is_active ? 'approved' : 'rejected'}`}>{p.is_active ? tr('نشط') : tr('معطّل')}</span></td>
                    {links && (
                      <td data-label={tr('فضاء المنخرطين')}>
                        {(() => {
                          const row = links[p.id];
                          const st = linkState(row);
                          if (st === 'active') {
                            return (
                              <>
                                <span className="admin-badge admin-badge-approved">{tr('مرتبط')}</span>
                                {row.board && <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{tr('بطاقة المكتب: {{name}}', { name: row.board.full_name })}</div>}
                              </>
                            );
                          }
                          return <span className={`admin-badge admin-badge-${st === 'off' ? 'rejected' : 'pending'}`}>{st === 'off' ? tr('معطّل') : tr('غير مرتبط')}</span>;
                        })()}
                      </td>
                    )}
                    <td className="admin-cell-actions">
                      {/* حسابات المطوّرين يديرها المطوّر فقط (يُفرض أيضًا في قاعدة البيانات) */}
                      {p.role === 'developer' && myProfile.role !== 'developer' ? (
                        <span style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{tr('محمي')}</span>
                      ) : (
                        <>
                          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(p)}>{tr('تعديل')}</button>
                          {links && p.is_active && links[p.id] && (linkState(links[p.id]) === 'active' ? (
                            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setUnlinkTarget(links[p.id])}>{tr('فصل فضاء المنخرطين')}</button>
                          ) : (
                            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setLinkTarget(links[p.id])}>
                              {linkState(links[p.id]) === 'off' ? tr('إعادة الربط') : tr('ربط بفضاء المنخرطين')}
                            </button>
                          ))}
                          {p.id !== myProfile.id && (
                            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeactivateTarget(p)}>{tr('إزالة الصلاحية')}</button>
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

      {linkTarget && (
        <AdminMemberLinkModal
          row={linkTarget}
          onClose={() => setLinkTarget(null)}
          onDone={() => {
            setLinkTarget(null);
            loadLinks();
          }}
        />
      )}

      {unlinkTarget && (
        <Modal onClose={() => setUnlinkTarget(null)}>
          <h3>{tr('فصل فضاء المنخرطين')}</h3>
          <p>{trStrong('سيفقد <strong>{{name}}</strong> الدخول إلى فضاء المنخرطين فقط، وتبقى صفته الإدارية كما هي. يمكن إعادة الربط لاحقًا.', { name: unlinkTarget.full_name })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doUnlink(unlinkTarget)}>{tr('فصل')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setUnlinkTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}

      {deactivateTarget && (
        <Modal onClose={() => setDeactivateTarget(null)}>
          <h3>{tr('إزالة صلاحية الوصول')}</h3>
          <p>{trStrong('سيفقد <strong>{{name}}</strong> إمكانية الدخول إلى لوحة الإدارة فورًا (لن يُحذف حسابه من Supabase Auth، ويمكن إعادة تفعيله لاحقًا من هذه الصفحة عبر «تعديل»).', { name: deactivateTarget.full_name })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDeactivate(deactivateTarget)}>{tr('إزالة')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeactivateTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
