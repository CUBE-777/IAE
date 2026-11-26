import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/admin/Modal';
import { searchMembersForCertificate, addMemberRecipient, addExternalRecipient } from '../../services/supabase/adminCertificates.service';
import { notifyCertError, isValidEmail } from './certificateUi';

/** تأكيد موحّد (إضافة من الحضور، اعتماد، رفض). */
export function ConfirmModal({ title, children, confirmLabel, danger = false, busy = false, onConfirm, onClose }) {
  const { t } = useTranslation();
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <h3>{title}</h3>
      {children}
      <div className="admin-modal-actions">
        <button type="button" className={`admin-btn ${danger ? 'admin-btn-danger' : 'admin-btn-primary'}`} disabled={busy} onClick={onConfirm}>
          {busy ? t('admin.common.loading') : confirmLabel}
        </button>
        <button type="button" className="admin-btn admin-btn-ghost" disabled={busy} onClick={onClose}>{t('admin.common.cancel')}</button>
      </div>
    </Modal>
  );
}

/** إضافة عضو (مصدر manual_selection): بحث بالاسم ثم إضافة؛ النافذة تبقى مفتوحة لإضافة أكثر من عضو. */
export function AddMemberModal({ campaignId, existingMemberIds, onChanged, onClose }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [added, setAdded] = useState(() => new Set());

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSearchError(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchMembersForCertificate(term)
        .then((rows) => { if (!cancelled) { setResults(rows); setSearchError(false); } })
        .catch((err) => { console.error('بحث الأعضاء:', err); if (!cancelled) setSearchError(true); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  const add = async (m) => {
    setBusyId(m.id);
    try {
      await addMemberRecipient(campaignId, m.id);
      setAdded((s) => new Set(s).add(m.id));
      window.notify?.success(t('admin.certificates.add.addOk'));
      onChanged();
    } catch (err) {
      notifyCertError(err, t, 'admin.certificates.add.addFailed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{t('admin.certificates.add.memberTitle')}</h3>
      <div className="admin-form-group">
        <label htmlFor="cert_member_q">{t('admin.certificates.add.memberSearch')}</label>
        <input id="cert_member_q" type="search" className="admin-input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('admin.certificates.add.memberSearchPlaceholder')} />
      </div>
      {searching && <p className="admin-hint" role="status">{t('admin.certificates.add.searching')}</p>}
      {searchError && <p className="admin-inline-error" role="alert">{t('admin.certificates.add.searchError')}</p>}
      {!searching && !searchError && q.trim().length >= 2 && results.length === 0 && <p className="admin-hint">{t('admin.certificates.add.memberNone')}</p>}
      {results.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <tbody>
              {results.map((m) => {
                const already = added.has(m.id) || existingMemberIds.has(m.id);
                return (
                  <tr key={m.id}>
                    <td>{m.full_name}{m.promotion ? <span className="admin-hint"> · {m.promotion}</span> : null}</td>
                    <td className="admin-cell-actions">
                      {already
                        ? <span className="admin-badge admin-badge-approved">{t('admin.certificates.add.alreadyAdded')}</span>
                        : <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busyId === m.id} onClick={() => add(m)}>{t('admin.certificates.add.memberAdd')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.close')}</button>
      </div>
    </Modal>
  );
}

/** إضافة مستفيد خارجي (اسم + بريد اختياري). */
export function AddExternalModal({ campaignId, onChanged, onClose }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    const m = email.trim();
    const er = {};
    if (n.length < 2 || n.length > 200) er.name = t('admin.certificates.add.errName');
    if (m && !isValidEmail(m)) er.email = t('admin.certificates.add.errEmail');
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      await addExternalRecipient(campaignId, n, m || null);
      window.notify?.success(t('admin.certificates.add.addOk'));
      onChanged();
      onClose();
    } catch (err) {
      notifyCertError(err, t, 'admin.certificates.add.addFailed');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{t('admin.certificates.add.externalTitle')}</h3>
      <form onSubmit={submit} noValidate>
        <div className="admin-form-group">
          <label htmlFor="cert_ext_name">{t('admin.certificates.add.externalName')} *</label>
          <input id="cert_ext_name" className="admin-input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? 'true' : undefined} />
          {errors.name && <p className="admin-inline-error" role="alert">{errors.name}</p>}
        </div>
        <div className="admin-form-group">
          <label htmlFor="cert_ext_email">{t('admin.certificates.add.externalEmail')}</label>
          <input id="cert_ext_email" type="email" dir="ltr" className="admin-input" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? 'true' : undefined} />
          {errors.email && <p className="admin-inline-error" role="alert">{errors.email}</p>}
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{saving ? t('admin.common.saving') : t('admin.certificates.add.externalAdd')}</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} disabled={saving}>{t('admin.common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
