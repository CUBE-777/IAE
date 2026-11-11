import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '../../components/admin/Modal';
import InvitationScene from '../../components/invitation/InvitationScene';
import {
  getInvitationsAdmin, saveInvitationSettings, addInvitations, updateInvitation, setInvitationRevoked, deleteInvitation,
} from '../../services/supabase/invitations.service';
import { DEFAULT_SETTINGS, guessStartsLocal, inviteUrl, localToIso } from '../../utils/invitationFormat';
import { downloadInvitationPdf } from '../../utils/invitationPdf';
import { buildWhatsappLink } from '../../utils/whatsapp';
import { tr, dateLocale } from '../../i18n/adminDict';
import '../../styles/invitation.css';

const EMPTY_GUEST = { id: null, name: '', title: '', gender: 'm' };

function statusOf(g) {
  if (g.revoked_at) return { cls: 'rejected', text: 'ملغاة' };
  if (g.rsvp === 'yes') return { cls: 'approved', text: 'سيحضر' };
  if (g.rsvp === 'no') return { cls: 'rejected', text: 'اعتذر' };
  if (g.open_count > 0) return { cls: 'pending', text: 'فُتحت' };
  return null;
}

/**
 * دعوات نشاط (0051): إعدادات الدعوة + قائمة الضيوف، وكل ضيف له رابط شخصي /invite/<token> ومعاينة وPDF.
 * الإعدادات تُحفظ أولًا (تتضمن تاريخ ووقت الحفل بتوقيت الدار البيضاء)، ثم تُضاف الدعوات.
 */
export default function ActivityInvitationsModal({ activity, onClose }) {
  const [data, setData] = useState(undefined); // undefined = تحميل
  const [form, setForm] = useState(null);
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => getInvitationsAdmin(activity.id).then((d) => {
    setData(d);
    setForm((prev) => prev || (d.settings
      ? { ...DEFAULT_SETTINGS, ...d.settings }
      : { ...DEFAULT_SETTINGS, starts_local: guessStartsLocal(activity), venue_text: activity.location || '' }));
  }).catch((err) => { window.notify?.fromError(err, tr('تعذّر تحميل الدعوات')); setData(null); }), [activity]);
  useEffect(() => { load(); }, [load]);

  const guard = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) window.notify?.success(tr(okMsg)); return r; }
    catch (err) { window.notify?.fromError(err, tr('تعذّر تنفيذ العملية')); return undefined; }
    finally { setBusy(false); }
  };

  const onField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const saveSettings = (e) => {
    e.preventDefault();
    return guard(async () => { await saveInvitationSettings(activity.id, form); setForm(null); await load(); }, 'حُفظت إعدادات الدعوة');
  };

  const submitGuest = (e) => {
    e.preventDefault();
    if (!guest.name.trim()) return undefined;
    return guard(async () => {
      if (guest.id) await updateInvitation(guest.id, guest);
      else await addInvitations(activity.id, [guest]);
      setGuest(EMPTY_GUEST); await load();
    }, guest.id ? 'تم التحديث بنجاح' : 'أُضيف الضيف');
  };

  const submitBulk = () => {
    const guests = bulk.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0])
      .map((p) => ({ name: p[0], title: p[1] || '', gender: (p[2] || '').toLowerCase() === 'f' ? 'f' : 'm' }));
    if (!guests.length) return undefined;
    return guard(async () => { const n = await addInvitations(activity.id, guests); setBulk(''); await load(); return n; }, 'أُضيفت الدعوات');
  };

  const copy = async (g) => {
    try { await navigator.clipboard.writeText(inviteUrl(g.token)); window.notify?.success(tr('نُسخ الرابط')); }
    catch { window.prompt(tr('انسخ الرابط'), inviteUrl(g.token)); }
  };
  const whatsapp = (g) => window.open(
    buildWhatsappLink('', `Bonjour ${g.guest_name}, voici votre invitation personnelle : ${inviteUrl(g.token)}`), '_blank', 'noopener');

  const previewable = (g) => {
    const startsAt = localToIso(form?.starts_local);
    if (!startsAt) { window.notify?.error(tr('حدّد تاريخ ووقت الحفل أولًا')); return null; }
    return { guest: { name: g.guest_name, title: g.guest_title, gender: g.gender }, settings: { ...DEFAULT_SETTINGS, ...form }, startsAt };
  };
  const showPreview = (g) => { const p = previewable(g); if (p) setPreview(p); };
  const pdf = (g) => { const p = previewable(g); if (p) guard(() => downloadInvitationPdf(p)); };

  const revoke = (g) => guard(async () => { await setInvitationRevoked(g.id, !g.revoked_at); await load(); });
  const remove = (g) => {
    if (!window.confirm(tr('حذف هذه الدعوة نهائيًا؟ سيتوقف رابطها عن العمل.'))) return undefined;
    return guard(async () => { await deleteInvitation(g.id); await load(); }, 'تم الحذف');
  };

  const hasSettings = !!data?.settings;
  const ltr = { dir: 'ltr', className: 'admin-input' };

  return (
    <Modal onClose={onClose} wide>
      <h3>{tr('الدعوات')} — {activity.title}</h3>
      {data === undefined && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
      {data === null && <div className="admin-state-box">{tr('تعذّر تحميل الدعوات')}</div>}

      {data && form && (<>
        <details open={!hasSettings}>
          <summary>{tr('إعدادات الدعوة')}</summary>
          <form onSubmit={saveSettings}>
            <div className="admin-form-group">
              <label htmlFor="iv_start">{tr('تاريخ ووقت الحفل (توقيت المغرب) *')}</label>
              <input id="iv_start" name="starts_local" type="datetime-local" className="admin-input" required value={form.starts_local} onChange={onField} />
            </div>
            <div className="admin-form-grid-2">
              <div className="admin-form-group"><label htmlFor="iv_h1">{tr('العنوان — السطر 1')}</label><input id="iv_h1" name="headline_1" {...ltr} value={form.headline_1} onChange={onField} /></div>
              <div className="admin-form-group"><label htmlFor="iv_h2">{tr('العنوان — السطر 2')}</label><input id="iv_h2" name="headline_2" {...ltr} value={form.headline_2} onChange={onField} /></div>
            </div>
            <div className="admin-form-group">
              <label htmlFor="iv_intro">{tr('الجملة التمهيدية')}</label>
              <input id="iv_intro" name="intro_text" {...ltr} value={form.intro_text} onChange={onField} />
              <p className="inv-adm-hint">{tr('اكتب {e} حيث تُضاف e للضيفة: invité{e}')}</p>
            </div>
            <div className="admin-form-group"><label htmlFor="iv_sub">{tr('سطر ما بعد العنوان')}</label><input id="iv_sub" name="subtitle_text" {...ltr} value={form.subtitle_text} onChange={onField} /></div>
            <div className="admin-form-group"><label htmlFor="iv_venue">{tr('المكان (اختياري)')}</label><input id="iv_venue" name="venue_text" {...ltr} value={form.venue_text} onChange={onField} /></div>
            <div className="admin-form-group"><label htmlFor="iv_thx">{tr('عبارة الشكر')}</label><input id="iv_thx" name="thanks_text" {...ltr} value={form.thanks_text} onChange={onField} /></div>
            <div className="admin-form-group">
              <label><input type="checkbox" name="allow_download" checked={!!form.allow_download} onChange={onField} /> {tr('السماح للضيف بتنزيل PDF')}</label>
            </div>
            <button className="admin-btn admin-btn-primary" disabled={busy}>{tr('حفظ الإعدادات')}</button>
          </form>
        </details>

        <h4>{tr('الضيوف')} ({data.invitations.length})</h4>
        {!hasSettings ? <p className="inv-adm-hint">{tr('احفظ إعدادات الدعوة أولًا لتتمكن من إضافة الضيوف.')}</p> : (<>
          <form onSubmit={submitGuest}>
            <div className="admin-form-grid-2">
              <div className="admin-form-group"><label htmlFor="ig_name">{tr('الاسم (مع اللقب) *')}</label><input id="ig_name" {...ltr} required maxLength={120} placeholder="Madame Lefrère" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} /></div>
              <div className="admin-form-group"><label htmlFor="ig_title">{tr('الصفة')}</label><input id="ig_title" {...ltr} maxLength={120} placeholder="Vice-doyenne" value={guest.title} onChange={(e) => setGuest({ ...guest, title: e.target.value })} /></div>
            </div>
            <div className="admin-form-group">
              <label htmlFor="ig_gender">{tr('الجنس (للصياغة الفرنسية)')}</label>
              <select id="ig_gender" className="admin-input" value={guest.gender} onChange={(e) => setGuest({ ...guest, gender: e.target.value })}>
                <option value="m">{tr('ذكر — invité')}</option><option value="f">{tr('أنثى — invitée')}</option>
              </select>
            </div>
            <div className="inv-adm-actions">
              <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy}>{guest.id ? tr('حفظ التعديل') : tr('+ إضافة ضيف')}</button>
              {guest.id && <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setGuest(EMPTY_GUEST)}>{tr('إلغاء')}</button>}
            </div>
          </form>
          <details>
            <summary>{tr('إضافة جماعية')}</summary>
            <p className="inv-adm-hint">{tr('سطر لكل ضيف: الاسم | الصفة | f للضيفة (اتركه فارغًا للضيف)')}</p>
            <textarea className="admin-textarea" dir="ltr" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'Madame Lefrère | Vice-doyenne | f\nMonsieur Alaoui | Doyen'} />
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy || !bulk.trim()} onClick={submitBulk}>{tr('إضافة القائمة')}</button>
          </details>
        </>)}

        {data.invitations.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>{tr('الضيف')}</th><th>{tr('الحالة')}</th><th>{tr('إجراءات')}</th></tr></thead>
              <tbody>
                {data.invitations.map((g) => {
                  const st = statusOf(g);
                  return (
                    <tr key={g.id}>
                      <td data-label={tr('الضيف')} dir="ltr">{g.guest_name}{g.guest_title ? ` — ${g.guest_title}` : ''}</td>
                      <td data-label={tr('الحالة')}>
                        {st ? <span className={`admin-badge admin-badge-${st.cls}`}>{tr(st.text)}{st.text === 'فُتحت' ? ` ×${g.open_count}` : ''}</span> : tr('لم تُفتح')}
                        {g.opened_at ? <div className="inv-adm-hint">{new Date(g.opened_at).toLocaleDateString(dateLocale())}</div> : null}
                      </td>
                      <td className="admin-cell-actions"><div className="inv-adm-actions">
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => showPreview(g)}>{tr('معاينة')}</button>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => copy(g)}>{tr('نسخ الرابط')}</button>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => whatsapp(g)}>{tr('واتساب')}</button>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => pdf(g)}>PDF</button>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setGuest({ id: g.id, name: g.guest_name, title: g.guest_title || '', gender: g.gender })}>{tr('تعديل')}</button>
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => revoke(g)}>{g.revoked_at ? tr('تفعيل') : tr('إلغاء الرابط')}</button>
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => remove(g)}>{tr('حذف')}</button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>)}

      {/* بوابة إلى body: النافذة قد تستعمل transform فيفسد position:fixed */}
      {preview && createPortal(<InvitationScene {...preview} onClose={() => setPreview(null)} />, document.body)}
    </Modal>
  );
}
