import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import MembershipDocs from '../../components/admin/MembershipDocs';
import {
  fetchRequestsByStatus,
  rejectMembershipRequest,
} from '../../services/supabase/membershipRequests.service';
import { formatDate } from '../../utils/i18nContent';
import { useAuth } from '../../app/providers/AuthProvider';
import {
  issueMembershipForm,
  fetchFormForRequest,
  recordAnnualMembership,
  publishMemberPhotoFromForm,
  fetchRenewalCandidates,
  fetchMembershipSettings,
} from '../../services/supabase/membershipFlow.service';
import { buildWhatsappLink } from '../../utils/whatsapp';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { prepareRequestQuery, matchesRequestSearch } from '../../utils/requestSearch';

const MANAGER_ROLES = ['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'secretary_general', 'deputy_secretary_general'];
const FORM_STATUS_KEY = { none: 'formNone', sent: 'formSent', received: 'formReceived' };
const FORM_FIELDS = [
  ['birth_date', 'fBirthDate'], ['university', 'fUniversity'], ['track', 'fieldTrack'], ['level', 'fLevel'],
  ['promotion', 'colPromotion'], ['profession', 'fieldProfession'], ['skills', 'fSkills'], ['interests', 'fInterests'],
  ['github', 'GitHub'], ['linkedin', 'LinkedIn'], ['bio', 'fBio'],
  ['emergency_name', 'fEmergencyName'], ['emergency_phone', 'fEmergencyPhone'], ['emergency_relation', 'fEmergencyRelation'],
];

const TABS = ['pending', 'approved', 'rejected', 'renewals'];
const TAB_KEY = { pending: 'tabPending', approved: 'tabApproved', rejected: 'tabRejected', renewals: 'tabRenewals' };
const EMPTY_KEY = { pending: 'emptyPending', approved: 'emptyApproved', rejected: 'emptyRejected', renewals: 'emptyRenewals' };
const FIELD = (v) => (v == null || v === '' ? '—' : v);

export default function Requests() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'view'|'approve'|'reject', row }
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { profile } = useAuth();
  const canManage = MANAGER_ROLES.includes(profile?.role);
  const [settings, setSettings] = useState({ fee: null, season: null });
  const [linkInfo, setLinkInfo] = useState(null); // { row, token, expires_at }
  const [msgLang, setMsgLang] = useState('ar');
  const [waCustom, setWaCustom] = useState(null); // نص معدَّل يدويًا؛ null = القالب الجاهز
  const [copied, setCopied] = useState(false);
  const [formData, setFormData] = useState(undefined); // undefined = chargement, null = aucun
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 250);
  // البحث في المتصفح داخل التبويب الحالي (الاسم / الهاتف / البريد)؛ يبقى الاستعلام عند تبديل التبويب
  const query = useMemo(() => prepareRequestQuery(search), [search]);
  const [formFilter, setFormFilter] = useState(''); // '' = الكل | none | sent | received (تبويب الطلبات المعلّقة فقط)
  const bySearch = useMemo(() => (rows ? rows.filter((r) => matchesRequestSearch(r, query)) : null), [rows, query]);
  const activeFilter = tab === 'pending' ? formFilter : '';
  const visibleRows = useMemo(
    () => (bySearch ? bySearch.filter((r) => !activeFilter || (r.form_status || 'none') === activeFilter) : null),
    [bySearch, activeFilter]
  );
  // أعداد كل حالة ضمن نتائج البحث الحالية (تظهر في الخيارات)
  const formCounts = useMemo(() => {
    const c = { none: 0, sent: 0, received: 0 };
    (bySearch || []).forEach((r) => { c[r.form_status || 'none'] += 1; });
    return c;
  }, [bySearch]);
  const searching = !!(query.text || query.digits || activeFilter);

  useEffect(() => {
    fetchMembershipSettings().then(setSettings).catch(() => setSettings({ fee: null, season: null }));
  }, []);

  const load = useCallback(() => {
    setRows(null);
    setError(false);
    const source = tab === 'renewals' ? fetchRenewalCandidates() : fetchRequestsByStatus(tab);
    source
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الطلبات:', err);
        window.notify?.fromError(err, t('admin.requests.loadError'));
        setError(true);
      });
  }, [tab, t]);

  useEffect(() => {
    document.title = t('admin.requests.pageTitle');
  }, [t]);

  useEffect(load, [load]);

  const closeModal = () => {
    setModal(null);
    setRejectReason('');
  };

  const closeLink = () => {
    setLinkInfo(null);
    setCopied(false);
    setWaCustom(null);
  };

  // رابط النموذج يحمل لغة الرسالة (?lang=) فتفتح الصفحة بنفس لغة الرسالة التي وصلت للمنخرط
  const formLink = (token, lng) => `${window.location.origin}/membership-form/${token}${lng ? `?lang=${lng}` : ''}`;

  const waText = (info, lng) =>
    t('admin.requests.waMessage', {
      lng,
      name: info.row.full_name,
      link: formLink(info.token, lng),
      date: formatDate(info.expires_at, lng), // تاريخ الانتهاء الفعلي بدل مدة ثابتة
    });
  const waFinalText = (info, lng) => (waCustom != null ? waCustom : waText(info, lng));

  const doSendForm = async (row) => {
    setBusy(true);
    window.notify?.loading(t('admin.requests.issuing'));
    try {
      const res = await issueMembershipForm(row.id);
      window.notify?.success(t('admin.requests.issued'));
      setLinkInfo({ row, token: res.token, expires_at: res.expires_at });
      setCopied(false);
      setWaCustom(null);
      load();
    } catch (err) {
      window.notify?.fromError(err, t('admin.requests.issueFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(formLink(linkInfo.token, msgLang));
      setCopied('link');
    } catch {
      window.notify?.error?.(t('admin.requests.copyFailed'));
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(waFinalText(linkInfo, msgLang));
      setCopied('message');
    } catch {
      window.notify?.error?.(t('admin.requests.copyFailed'));
    }
  };

  const openView = async (row) => {
    setModal({ type: 'view', row });
    setFormData(undefined);
    if (row.form_status === 'received') {
      try {
        setFormData(await fetchFormForRequest(row.id));
      } catch (err) {
        console.error('form load failed', err);
        setFormData(null);
      }
    } else {
      setFormData(null);
    }
  };

  const doAnnual = async (target) => {
    closeModal();
    setBusy(true);
    window.notify?.loading(t('admin.requests.recording'));
    try {
      const isRenewal = target.type === 'renewal';
      // موافقة العضو على نشر صورته (من نموذج الانخراط) تُقرأ قبل القبول، فإن لم يوافق لا تُنشر الصورة أبدًا
      let consentedPhoto = null;
      if (!isRenewal) {
        try {
          const form = await fetchFormForRequest(target.row.id);
          const d = form?.data;
          if (d && d.consent_directory === true && d.consent_photo === true && typeof d.photo_path === 'string') {
            consentedPhoto = d.photo_path;
          }
        } catch (err) {
          console.error('consent read failed', err); // لا نوقف التسجيل: الأسلم عدم نشر الصورة
        }
      }
      const res = await recordAnnualMembership(isRenewal ? { memberId: target.row.id } : { requestId: target.row.id });
      window.notify?.success(t('admin.requests.recorded'));
      if (consentedPhoto && res?.member_id) {
        try {
          await publishMemberPhotoFromForm(res.member_id, consentedPhoto);
        } catch (err) {
          console.error('photo publish failed', err);
          window.notify?.error(t('admin.requests.photoPublishFailed'));
        }
      }
      load();
    } catch (err) {
      window.notify?.fromError(err, t('admin.requests.recordFailed'));
    } finally {
      setBusy(false);
    }
  };

  const doReject = async (row) => {
    const reason = rejectReason.trim();
    closeModal();
    setBusy(true);
    window.notify?.loading(t('admin.requests.rejecting'));
    try {
      await rejectMembershipRequest(row.id, reason);
      window.notify?.success(t('admin.requests.rejected'));
      load();
    } catch (err) {
      window.notify?.fromError(err, t('admin.requests.rejectFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader title={t('admin.requests.title')} subtitle={t('admin.requests.subtitle')} />

      <div className="admin-tabs">
        {TABS.map((key) => (
          <button key={key} className={`admin-tab-btn${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
            {t(`admin.requests.${TAB_KEY[key]}`)}
          </button>
        ))}
      </div>

      <div className="admin-panel">
        <div className="admin-search-row" role="search">
          <label className="sr-only" htmlFor="requestsSearch">{t('admin.requests.searchLabel')}</label>
          <input
            id="requestsSearch"
            type="search"
            className="admin-input"
            placeholder={t('admin.requests.searchPlaceholder')}
            autoComplete="off"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            disabled={!rows || rows.length === 0}
          />
          {tab === 'pending' && (
            <>
              <label className="sr-only" htmlFor="requestsFormFilter">{t('admin.requests.filterLabel')}</label>
              <select
                id="requestsFormFilter"
                className="admin-select"
                style={{ width: 'auto' }}
                value={formFilter}
                onChange={(e) => setFormFilter(e.target.value)}
                disabled={!rows || rows.length === 0}
              >
                <option value="">{t('admin.requests.filterAll')} ({bySearch ? bySearch.length : 0})</option>
                {Object.keys(FORM_STATUS_KEY).map((k) => (
                  <option key={k} value={k}>{t(`admin.requests.${FORM_STATUS_KEY[k]}`)} ({formCounts[k]})</option>
                ))}
              </select>
            </>
          )}
          {searching && rows && (
            <span className="admin-hint" aria-live="polite">
              {t('admin.requests.searchCount', { count: visibleRows.length, total: rows.length })}
            </span>
          )}
        </div>
        {rows === null && !error && <div className="admin-state-box">{t('admin.requests.loading')}</div>}
        {error && <div className="admin-state-box">{t('admin.requests.loadError')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{t(`admin.requests.${EMPTY_KEY[tab]}`)}</div>}
        {rows && rows.length > 0 && visibleRows.length === 0 && (
          <div className="admin-state-box">{t('admin.requests.searchNoResults')}</div>
        )}
        {rows && visibleRows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.requests.colName')}</th>
                  <th>{t('admin.requests.colEmail')}</th>
                  <th>{t('admin.requests.colPhone')}</th>
                  <th>{t('admin.requests.colPromotion')}</th>
                  <th>{t('admin.requests.colCity')}</th>
                  {tab !== 'renewals' && <th>{t('admin.requests.colDate')}</th>}
                  {tab === 'pending' && <th>{t('admin.requests.colForm')}</th>}
                  <th>{t('admin.requests.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('admin.requests.colName')}>{r.full_name}</td>
                    <td data-label={t('admin.requests.colEmail')}>{r.email}</td>
                    <td data-label={t('admin.requests.colPhone')}>{FIELD(r.phone)}</td>
                    <td data-label={t('admin.requests.colPromotion')}>{FIELD(r.promotion)}</td>
                    <td data-label={t('admin.requests.colCity')}>{FIELD(r.city)}</td>
                    {tab !== 'renewals' && <td data-label={t('admin.requests.colDate')}>{formatDate(r.created_at, i18n.language)}</td>}
                    {tab === 'pending' && (
                      <td data-label={t('admin.requests.colForm')}>
                        <span className={`admin-badge admin-badge-${r.form_status === 'received' ? 'approved' : r.form_status === 'sent' ? 'sent' : 'pending'}`}>
                          {t(`admin.requests.${FORM_STATUS_KEY[r.form_status || 'none']}`)}
                        </span>
                      </td>
                    )}
                    <td className="admin-cell-actions">
                      {tab === 'renewals' ? (
                        <button
                          className="admin-btn admin-btn-primary admin-btn-sm"
                          disabled={busy}
                          onClick={() => setModal({ type: 'annual', row: r, kind: 'renewal' })}
                        >
                          {t('admin.requests.renew')}
                        </button>
                      ) : (
                        <>
                          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openView(r)}>
                            {r.form_status === 'received' ? t('admin.requests.viewForm') : t('admin.requests.view')}
                          </button>
                          {tab === 'pending' && r.form_status !== 'received' && canManage && (
                            <button
                              className="admin-btn admin-btn-primary admin-btn-sm"
                              disabled={busy}
                              onClick={() => setModal({ type: 'sendForm', row: r })}
                            >
                              {r.form_status === 'sent' ? t('admin.requests.resendForm') : t('admin.requests.sendForm')}
                            </button>
                          )}
                          {tab === 'pending' && r.form_status === 'received' && (
                            <button
                              className="admin-btn admin-btn-primary admin-btn-sm"
                              disabled={busy}
                              onClick={() => setModal({ type: 'annual', row: r, kind: 'request' })}
                            >
                              {t('admin.requests.annual')}
                            </button>
                          )}
                          {tab === 'pending' && canManage && (
                            <button
                              className="admin-btn admin-btn-danger admin-btn-sm"
                              disabled={busy}
                              onClick={() => setModal({ type: 'reject', row: r })}
                            >
                              {t('admin.requests.reject')}
                            </button>
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

      {modal?.type === 'view' && (
        <Modal onClose={closeModal}>
          <h3>{modal.row.form_status === 'received' ? t('admin.requests.formDetailsTitle') : t('admin.requests.detailsTitle')}</h3>
          <p><strong>{t('admin.requests.colName')}:</strong> {modal.row.full_name}</p>
          <p><strong>{t('admin.requests.colEmail')}:</strong> {modal.row.email}</p>
          <p><strong>{t('admin.requests.colPhone')}:</strong> {FIELD(modal.row.phone)}</p>
          <p><strong>{t('admin.requests.colCity')}:</strong> {FIELD(modal.row.city)}</p>
          <p><strong>{t('admin.requests.fieldMessage')}:</strong> {FIELD(modal.row.message)}</p>
          {modal.row.rejection_reason && <p><strong>{t('admin.requests.fieldRejectionReason')}:</strong> {modal.row.rejection_reason}</p>}
          {modal.row.form_status === 'received' && (
            <>
              <hr />
              {formData === undefined && <p>{t('admin.requests.loading')}</p>}
              {formData === null && <p>{t('admin.requests.loadError')}</p>}
              {formData && (
                <>
                  {FORM_FIELDS.map(([key, label]) => (
                    formData.data?.[key] ? (
                      <p key={key}>
                        <strong>{label.startsWith('f') || label.startsWith('col') || label.startsWith('field') ? t(`admin.requests.${label}`) : label}:</strong>{' '}
                        {formData.data[key]}
                      </p>
                    ) : null
                  ))}
                  <MembershipDocs data={formData.data} />
                  <p><strong>{t('admin.requests.fRules')}:</strong> {formData.data?.rules_accepted ? t('admin.requests.yes') : t('admin.requests.no')}</p>
                  <p><strong>{t('admin.requests.fSubmittedAt')}:</strong> {formatDate(formData.submitted_at, i18n.language)}</p>
                </>
              )}
            </>
          )}
          <div className="admin-modal-actions">
            {modal.row.form_status === 'received' && modal.row.status === 'pending' && (
              <button className="admin-btn admin-btn-primary" onClick={() => setModal({ type: 'annual', row: modal.row, kind: 'request' })}>
                {t('admin.requests.annual')}
              </button>
            )}
            <button className="admin-btn admin-btn-ghost" onClick={closeModal}>{t('admin.common.close')}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'sendForm' && (
        <Modal onClose={closeModal}>
          <h3>{t('admin.requests.sendFormTitle')}</h3>
          <p>
            <Trans i18nKey="admin.requests.sendFormBody" values={{ name: modal.row.full_name }} components={{ strong: <strong /> }} />
          </p>
          <p className="admin-hint">{t('admin.requests.sendFormWarning')}</p>
          <div className="admin-modal-actions">
            <button
              className="admin-btn admin-btn-primary"
              disabled={busy}
              onClick={() => { const row = modal.row; closeModal(); doSendForm(row); }}
            >
              {t('admin.requests.sendFormConfirm')}
            </button>
            <button className="admin-btn admin-btn-ghost" onClick={closeModal}>{t('admin.common.cancel')}</button>
          </div>
        </Modal>
      )}

      {linkInfo && (
        <Modal onClose={closeLink}>
          <h3>{t('admin.requests.linkTitle')}</h3>
          <p>
            <Trans i18nKey="admin.requests.linkBody" values={{ name: linkInfo.row.full_name }} components={{ strong: <strong /> }} />
          </p>
          <div className="admin-form-group">
            <label htmlFor="waLang">{t('admin.requests.msgLang')}</label>
            <select id="waLang" className="admin-select" value={msgLang} onChange={(e) => { setMsgLang(e.target.value); setWaCustom(null); setCopied(false); }}>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="admin-form-group">
            <label htmlFor="waPreview">{t('admin.requests.msgPreview')}</label>
            <textarea
              id="waPreview"
              className="admin-textarea"
              rows={12}
              dir={msgLang === 'ar' ? 'rtl' : 'ltr'}
              value={waFinalText(linkInfo, msgLang)}
              onChange={(e) => { setWaCustom(e.target.value); setCopied(false); }}
            />
            <p className="admin-hint">{t('admin.requests.msgEditHint')}</p>
          </div>
          <p className="admin-hint">
            {t('admin.requests.linkExpires', { date: formatDate(linkInfo.expires_at, i18n.language) })}
          </p>
          <div className="admin-modal-actions">
            <a
              className="admin-btn admin-btn-primary"
              href={buildWhatsappLink(linkInfo.row.phone, waFinalText(linkInfo, msgLang))}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('admin.requests.waOpen')}
            </a>
            <button className="admin-btn admin-btn-ghost" onClick={copyMessage}>
              {copied === 'message' ? t('admin.requests.copied') : t('admin.requests.copyMessage')}
            </button>
            <button className="admin-btn admin-btn-ghost" onClick={copyLink}>
              {copied === 'link' ? t('admin.requests.copied') : t('admin.requests.copyLink')}
            </button>
            <button className="admin-btn admin-btn-ghost" onClick={closeLink}>{t('admin.common.close')}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'annual' && (
        <Modal onClose={closeModal}>
          <h3>{modal.kind === 'renewal' ? t('admin.requests.renewTitle') : t('admin.requests.annualTitle')}</h3>
          <p>
            <Trans i18nKey="admin.requests.annualBody" values={{ name: modal.row.full_name }} components={{ strong: <strong /> }} />
          </p>
          {settings.fee && settings.season ? (
            <ul className="admin-summary-list">
              <li><strong>{t('admin.requests.annualAmount')}:</strong> {settings.fee} MAD</li>
              <li><strong>{t('admin.requests.annualSeason')}:</strong> {settings.season}</li>
            </ul>
          ) : (
            <div className="admin-state-box">{t('admin.requests.annualNoSettings')}</div>
          )}
          <div className="admin-modal-actions">
            <button
              className="admin-btn admin-btn-primary"
              disabled={busy || !(settings.fee && settings.season)}
              onClick={() => doAnnual({ type: modal.kind, row: modal.row })}
            >
              {t('admin.requests.annualConfirm')}
            </button>
            <button className="admin-btn admin-btn-ghost" onClick={closeModal}>{t('admin.common.cancel')}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'reject' && (
        <Modal onClose={closeModal}>
          <h3>{t('admin.requests.rejectTitle')}</h3>
          <p>
            <Trans
              i18nKey="admin.requests.rejectBody"
              values={{ name: modal.row.full_name }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="admin-form-group">
            <label htmlFor="rejectReason">{t('admin.requests.rejectReasonLabel')}</label>
            <textarea
              id="rejectReason"
              className="admin-textarea"
              placeholder={t('admin.requests.rejectReasonPlaceholder')}
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doReject(modal.row)}>{t('admin.requests.rejectConfirm')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={closeModal}>{t('admin.common.cancel')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
