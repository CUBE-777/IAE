import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/admin/Modal';
import { deleteImageByUrl } from '../../services/supabase/storage.service';
import {
  fetchPendingCardRequests, approveCardRequest, rejectCardRequest, getCardRequestPhotoUrl, publishCardRequestPhoto,
} from '../../services/supabase/memberSpace.service';
import { diffBoardProfile } from '../../utils/boardProfileDiff';
import { tr, dateLocale } from '../../i18n/adminDict';

const cell = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', verticalAlign: 'top' };
const show = (v) => (v === '' || v == null ? '—' : v);

/** فروق الطلب عن البطاقة المنشورة: حقول الملف المشترك + المهنة + الموافقة على الظهور. members.bio خاصة بالإدارة ولا تدخل المقارنة. */
export function cardRequestRows(member, data) {
  const cur = { ...(member || {}), bio: undefined };
  const rows = diffBoardProfile(cur, data);
  const prof = (v) => (typeof v === 'string' ? v.trim() : '');
  if (data && 'profession' in data && prof(member?.profession) !== prof(data.profession)) {
    rows.push({ key: 'profession', label: 'المهنة', before: prof(member?.profession), after: prof(data.profession) });
  }
  if (data && typeof data.show_in_directory === 'boolean' && (member?.show_in_directory !== false) !== data.show_in_directory) {
    rows.push({
      key: 'show_in_directory', label: 'الظهور في صفحة الأعضاء',
      before: member?.show_in_directory === false ? tr('غير ظاهر') : tr('ظاهر'),
      after: data.show_in_directory ? tr('ظاهر') : tr('غير ظاهر'),
    });
  }
  return rows;
}

function ReviewRow({ request, onDone }) {
  const m = request.members || {};
  const [photoPreview, setPhotoPreview] = useState(null);
  const [usePhoto, setUsePhoto] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = cardRequestRows(m, request.data);

  useEffect(() => {
    let alive = true;
    if (request.photo_path) {
      getCardRequestPhotoUrl(request.photo_path)
        .then((u) => alive && setPhotoPreview(u))
        .catch((err) => console.error('تعذر معاينة الصورة المرسلة:', err));
    }
    return () => { alive = false; };
  }, [request.photo_path]);

  const approve = async () => {
    setBusy(true);
    const t = window.notify?.loading(tr('جاري الاعتماد...'));
    let publicUrl = null;
    try {
      if (request.photo_path && usePhoto) publicUrl = await publishCardRequestPhoto(request.photo_path, m.id);
      await approveCardRequest(request.id, publicUrl);
      t?.remove();
      window.notify?.success(tr('تم اعتماد التعديل ونشره'));
      onDone();
    } catch (err) {
      t?.remove();
      if (publicUrl) await deleteImageByUrl(publicUrl); // لا نترك صورة يتيمة في الـ bucket العام
      window.notify?.fromError(err, tr('تعذر الاعتماد'));
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await rejectCardRequest(request.id, note.trim());
      window.notify?.success(tr('تم رفض الطلب'));
      onDone();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر الرفض'));
      setBusy(false);
    }
  };

  return (
    <section style={{ border: '1px solid var(--admin-border)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }}>
      <h4 style={{ margin: '0 0 8px' }}>{m.full_name} <small style={{ fontWeight: 400, color: 'var(--admin-text-muted)' }}>{new Date(request.created_at).toLocaleDateString(dateLocale())}</small></h4>

      {request.photo_path && (
        <div className="admin-form-group">
          <label>{tr('الصورة المقترحة')}</label>
          {photoPreview ? (
            <img src={photoPreview} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: '50%', display: 'block', marginBottom: 8 }} />
          ) : (
            <div style={{ fontSize: '.85rem', color: 'var(--admin-text-muted)' }}>{tr('جاري تحميل الصورة...')}</div>
          )}
          <label><input type="checkbox" checked={usePhoto} onChange={(e) => setUsePhoto(e.target.checked)} /> {tr('استخدام الصورة الجديدة في الموقع')}</label>
        </div>
      )}

      {rows.length === 0 && !request.photo_path ? (
        <p>{tr('لا فروق في النصوص عن البطاقة الحالية.')}</p>
      ) : rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <thead><tr><th>{tr('الحقل')}</th><th>{tr('الحالي')}</th><th>{tr('المقترح')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{tr(r.label)}{r.lang ? ` (${r.lang})` : ''}</td>
                  <td style={cell}>{show(r.before)}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{show(r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-form-group" style={{ marginTop: 12 }}>
        <label htmlFor={`mcr_note_${request.id}`}>{tr('ملاحظة للعضو (اختياري، تظهر له عند الرفض)')}</label>
        <textarea id={`mcr_note_${request.id}`} className="admin-textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-primary" onClick={approve} disabled={busy}>{tr('اعتماد')}</button>
        <button type="button" className="admin-btn admin-btn-danger" onClick={reject} disabled={busy}>{tr('رفض')}</button>
      </div>
    </section>
  );
}

/** قائمة طلبات تعديل البطاقات قيد الانتظار مع المراجعة (اعتماد ينشر في الموقع، أو رفض مع ملاحظة). */
export default function MemberCardRequestsModal({ onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetchPendingCardRequests()
      .then(setRows)
      .catch((err) => {
        console.error('card requests load failed', err);
        window.notify?.fromError(err, tr('تعذر تحميل الطلبات'));
        setError(true);
      });
  }, []);
  useEffect(load, [load]);

  return (
    <Modal onClose={onClose} wide>
      <h3>{tr('طلبات تعديل بطاقات الأعضاء')}</h3>
      <p style={{ color: 'var(--admin-text-muted)', fontSize: '.88rem' }}>{tr('لا يُنشر أي تعديل في الموقع قبل اعتماده هنا.')}</p>
      {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
      {error && <div className="admin-state-box">{tr('تعذر تحميل الطلبات.')}</div>}
      {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد طلبات قيد المراجعة.')}</div>}
      {rows && rows.map((r) => (
        <ReviewRow key={r.id} request={r} onDone={() => { onChanged?.(); load(); }} />
      ))}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{tr('إغلاق')}</button>
      </div>
    </Modal>
  );
}
