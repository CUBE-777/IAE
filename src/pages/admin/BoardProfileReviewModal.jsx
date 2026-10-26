import { useEffect, useState } from 'react';
import Modal from '../../components/admin/Modal';
import { deleteImageByUrl } from '../../services/supabase/storage.service';
import {
  approveBoardProfile,
  returnBoardProfile,
  getBoardPhotoUrl,
  publishBoardPhoto,
} from '../../services/supabase/boardProfile.service';
import { diffBoardProfile } from '../../utils/boardProfileDiff';
import { tr } from '../../i18n/adminDict';

const cell = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', verticalAlign: 'top' };

/** مراجعة ما أرسله عضو المكتب: يعرض الفروق فقط، ثم اعتماد (ينسخ إلى الملف العام) أو إعادة للعضو مع ملاحظة. */
export default function BoardProfileReviewModal({ member, link, onClose, onDone }) {
  const [photoPreview, setPhotoPreview] = useState(null);
  const [usePhoto, setUsePhoto] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = diffBoardProfile(member, link.data);

  useEffect(() => {
    let alive = true;
    if (link.photo_path) {
      getBoardPhotoUrl(link.photo_path)
        .then((u) => alive && setPhotoPreview(u))
        .catch((err) => console.error('تعذر معاينة الصورة المرسلة:', err));
    }
    return () => { alive = false; };
  }, [link.photo_path]);

  const approve = async () => {
    setBusy(true);
    const t = window.notify?.loading(tr('جاري الاعتماد...'));
    let publicUrl = null;
    try {
      if (link.photo_path && usePhoto) publicUrl = await publishBoardPhoto(link.photo_path);
      await approveBoardProfile(link.id, publicUrl);
      t?.remove();
      window.notify?.success(tr('تم اعتماد الملف ونشره'));
      onDone();
    } catch (err) {
      t?.remove();
      if (publicUrl) await deleteImageByUrl(publicUrl); // لا نترك صورة يتيمة في الـ bucket العام
      window.notify?.fromError(err, tr('تعذر الاعتماد'));
      setBusy(false);
    }
  };

  const giveBack = async () => {
    setBusy(true);
    try {
      await returnBoardProfile(link.id, note.trim());
      window.notify?.success(tr('تمت إعادة الملف للعضو'));
      onDone();
    } catch (err) {
      window.notify?.fromError(err, tr('تعذر الإرجاع'));
      setBusy(false);
    }
  };

  const show = (v) => v || '—';

  return (
    <Modal onClose={onClose} wide>
      <h3>{tr('مراجعة الملف الذي أرسله {{name}}', { name: member.full_name })}</h3>

      {link.photo_path && (
        <div className="admin-form-group">
          <label>{tr('الصورة الجديدة')}</label>
          {photoPreview ? (
            <img src={photoPreview} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: '50%', display: 'block', marginBottom: 8 }} />
          ) : (
            <div style={{ fontSize: '.85rem', color: 'var(--admin-text-muted)' }}>{tr('جاري تحميل الصورة...')}</div>
          )}
          <label>
            <input type="checkbox" checked={usePhoto} onChange={(e) => setUsePhoto(e.target.checked)} /> {tr('استخدام الصورة الجديدة في الموقع')}
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <p>{tr('لا فروق في النصوص عن الملف الحالي.')}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr><th>{tr('الحقل')}</th><th>{tr('الحالي')}</th><th>{tr('المقترح')}</th></tr>
            </thead>
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

      <div className="admin-form-group" style={{ marginTop: 14 }}>
        <label htmlFor="bp_note">{tr('ملاحظة للعضو (اختياري، تظهر له عند الإعادة)')}</label>
        <textarea id="bp_note" className="admin-textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-primary" onClick={approve} disabled={busy}>{tr('اعتماد')}</button>
        <button type="button" className="admin-btn admin-btn-ghost" onClick={giveBack} disabled={busy}>{tr('إعادة للتعديل')}</button>
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} disabled={busy}>{tr('إلغاء')}</button>
      </div>
    </Modal>
  );
}
