import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import { issueBoardProfileLink } from '../../services/supabase/boardProfile.service';
import { tr, dateLocale } from '../../i18n/adminDict';

/**
 * يُصدر رابط تعبئة شخصيًا لعضو مكتب. الإصدار يُبطل أي رابط سابق لنفس العضو، لذلك لا يتم إلا بعد ضغطة صريحة
 * (لا عند فتح النافذة). الرمز لا يُخزَّن في القاعدة (مجزّأ فقط)، فيظهر هنا مرة واحدة ولا يمكن استرجاعه لاحقًا.
 */
export default function BoardProfileLinkModal({ member, link, onClose, onIssued }) {
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null); // { url, expires_at }

  const hadLink = !!link && link.status !== 'approved';

  const issue = async () => {
    setBusy(true);
    try {
      const res = await issueBoardProfileLink(member.id);
      setIssued({ url: `${window.location.origin}/board-profile/${res.token}`, expires_at: res.expires_at });
      onIssued?.();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر إنشاء الرابط'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.url);
      window.notify?.success(tr('تم نسخ الرابط'));
    } catch {
      window.notify?.info(tr('انسخ الرابط يدويًا من الخانة'));
    }
  };

  const whatsapp = issued
    ? `https://wa.me/?text=${encodeURIComponent(`${tr('مرحبًا {{name}}، يرجى ملء ملفك الشخصي على موقع النادي عبر هذا الرابط:', { name: member.full_name })}\n${issued.url}`)}`
    : null;

  return (
    <Modal onClose={onClose}>
      <h3>{tr('رابط تعبئة الملف الشخصي')}</h3>
      <p>{tr('رابط خاص بـ {{name}} ليملأ ملفه العام بنفسه. لا يظهر شيء في الموقع قبل أن تعتمده أنت.', { name: member.full_name })}</p>

      {!issued ? (
        <>
          {hadLink && <p style={{ color: 'var(--admin-text-muted)', fontSize: '.88rem' }}>{tr('يوجد رابط سابق لهذا العضو؛ إنشاء رابط جديد يُبطل القديم.')}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={issue} disabled={busy}>{tr('إنشاء رابط تعبئة')}</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إلغاء')}</button>
          </div>
        </>
      ) : (
        <>
          <div className="admin-form-group">
            <input className="admin-input" dir="ltr" readOnly value={issued.url} onFocus={(e) => e.target.select()} aria-label={tr('رابط تعبئة الملف الشخصي')} />
            <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
              {tr('صالح حتى {{date}}. يظهر الرابط هنا مرة واحدة فقط.', { date: new Date(issued.expires_at).toLocaleDateString(dateLocale()) })}
            </div>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={copy}>{tr('نسخ الرابط')}</button>
            <a className="admin-btn admin-btn-ghost" href={whatsapp} target="_blank" rel="noopener noreferrer">{tr('إرسال عبر واتساب')}</a>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إغلاق')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
