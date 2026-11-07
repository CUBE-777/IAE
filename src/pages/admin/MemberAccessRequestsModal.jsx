import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/admin/Modal';
import MemberActivationModal from './MemberActivationModal';
import { fetchPendingAccessRequests, resolveAccessRequest } from '../../services/supabase/memberSpace.service';
import { tr, dateLocale } from '../../i18n/adminDict';

/**
 * طلبات «المساعدة في الدخول» التي أرسلها الأعضاء من /member/help.
 * «إنشاء رابط وإرساله» يفتح أداة الرابط الموجودة (نسخ/واتساب إلى هاتف العضو المسجّل لدينا)، وبعد إصدار الرابط
 * يُعلَّم الطلب «معالَجًا». «تجاهل» يُغلقه دون رابط. الرابط لا يُرسَل إلا إلى وسيلة الاتصال المسجّلة للعضو.
 */
export default function MemberAccessRequestsModal({ onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState(null); // { request, issued }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setError(false);
    fetchPendingAccessRequests()
      .then(setRows)
      .catch((err) => {
        console.error('access requests load failed', err);
        window.notify?.fromError(err, tr('تعذر تحميل الطلبات'));
        setError(true);
      });
  }, []);
  useEffect(load, [load]);

  const dismiss = async (request) => {
    setBusyId(request.id);
    try {
      await resolveAccessRequest(request.id, 'dismissed');
      window.notify?.success(tr('تم تجاهل الطلب'));
      onChanged?.();
      load();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر تحديث الطلب'));
    } finally {
      setBusyId(null);
    }
  };

  // أداة الرابط تُعرض وحدها (نافذة واحدة في كل مرة)، وعند إغلاقها نعود للقائمة؛ إن أُصدر الرابط يُعلَّم الطلب معالَجًا
  if (target) {
    const done = async () => {
      const { request, issued } = target;
      setTarget(null);
      if (issued) {
        try {
          await resolveAccessRequest(request.id, 'handled');
          window.notify?.success(tr('تمت معالجة الطلب'));
          onChanged?.();
        } catch (err) {
          window.notify?.fromError(err, tr('تعذر تحديث الطلب'));
        }
      }
      load();
    };
    return (
      <MemberActivationModal
        member={target.request.members || {}}
        onIssued={() => setTarget((t) => (t ? { ...t, issued: true } : t))}
        onClose={done}
      />
    );
  }

  return (
    <Modal onClose={onClose} wide>
      <h3>{tr('طلبات المساعدة في الدخول')}</h3>
      <p style={{ color: 'var(--admin-text-muted)', fontSize: '.88rem' }}>
        {tr('أعضاء طلبوا رابط تفعيل أو استعادة دخول. أرسل الرابط إلى رقم العضو المسجّل لدينا فقط، وليس إلى من قدّم الطلب.')}
      </p>
      {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
      {error && <div className="admin-state-box">{tr('تعذر تحميل الطلبات.')}</div>}
      {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد طلبات مساعدة قيد الانتظار.')}</div>}
      {rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr><th>{tr('الاسم')}</th><th>{tr('الهاتف')}</th><th>{tr('تاريخ الطلب')}</th><th>{tr('إجراءات')}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.members || {};
                return (
                  <tr key={r.id}>
                    <td>{m.full_name || '—'}</td>
                    <td dir="ltr">{m.phone || '—'}</td>
                    <td>{new Date(r.created_at).toLocaleString(dateLocale())}</td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={busyId === r.id || !m.id} onClick={() => setTarget({ request: r, issued: false })}>
                        {tr('إنشاء رابط وإرساله')}
                      </button>
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busyId === r.id} onClick={() => dismiss(r)}>
                        {tr('تجاهل')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إغلاق')}</button>
      </div>
    </Modal>
  );
}
