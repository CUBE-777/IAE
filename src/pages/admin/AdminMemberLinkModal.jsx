import { useEffect, useState } from 'react';
import Modal from '../../components/admin/Modal';
import { fetchBoardMembers } from '../../services/supabase/adminBoard.service';
import { linkAdminAsMember } from '../../services/supabase/adminAccountLinks.service';

import { tr } from '../../i18n/adminDict';

/**
 * ربط حساب إداري بفضاء المنخرطين وببطاقة المكتب (0046). كلمة المرور واحدة للصفتين.
 * `row` من get_admin_member_link_overview؛ البطاقة المقترحة (بالبريد ثم الاسم) تُحدَّد مسبقًا ويؤكدها المسؤول.
 */
export default function AdminMemberLinkModal({ row, onClose, onDone }) {
  const [cards, setCards] = useState(null);
  const [boardId, setBoardId] = useState(row.suggest_board?.id || row.board?.id || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchBoardMembers()
      .then((list) => alive && setCards(list))
      .catch((err) => {
        console.error('تعذر تحميل أعضاء المكتب:', err);
        if (alive) setCards([]);
      });
    return () => { alive = false; };
  }, []);

  // البطاقات الحرة (غير مرتبطة بسجل عضو) + بطاقة هذا الحساب إن كانت مرتبطة سلفًا
  const available = (cards || []).filter((b) => b.is_active && (!b.member_id || b.id === row.board?.id));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const t = window.notify?.loading(tr('جاري التنفيذ...'));
    try {
      await linkAdminAsMember(row.user_id, boardId || null, null);
      t?.remove();
      window.notify?.success(tr('تم الربط'));
      onDone();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الربط'));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{tr('ربط {{name}} بفضاء المنخرطين', { name: row.full_name })}</h3>
      <p className="admin-hint" style={{ marginTop: 0 }}>
        {tr('سيدخل صاحب الحساب إلى لوحة الإدارة وفضاء المنخرطين بنفس البريد وكلمة المرور. إن لم يكن له سجل عضو يُنشأ سجل جديد لا يظهر في دليل الأعضاء العام.')}
      </p>
      <form onSubmit={submit}>
        <div className="admin-form-group">
          <label htmlFor="link_board">{tr('بطاقة المكتب')}</label>
          {cards === null ? (
            <div className="admin-state-box">{tr('جاري التحميل...')}</div>
          ) : (
            <select id="link_board" className="admin-select" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
              <option value="">{tr('بدون بطاقة مكتب (فضاء المنخرطين فقط)')}</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.full_name} — {b.position}{b.id === row.suggest_board?.id ? ` ${tr('(مقترح)')}` : ''}
                </option>
              ))}
            </select>
          )}
          {cards !== null && available.length === 0 && (
            <p className="admin-hint">{tr('لا توجد بطاقات مكتب نشطة غير مرتبطة.')}</p>
          )}
          <p className="admin-hint">{tr('بريد الحساب يجب أن يطابق بريد سجل العضو، وإلا يُرفض الربط حتى لا يُربط شخص بسجل غيره.')}</p>
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving || cards === null}>{tr('ربط')}</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
        </div>
      </form>
    </Modal>
  );
}
