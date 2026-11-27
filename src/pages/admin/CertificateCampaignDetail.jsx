import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import {
  fetchCertificateCampaign, fetchCertificateRecipients, fetchCertificateTemplates, isCertificateSchemaMissing,
  addAttendanceRecipients, removeCertificateRecipient, issueCertificateCampaign,
} from '../../services/supabase/adminCertificates.service';
import { formatDate } from '../../utils/i18nContent';
import { bulkEligible, isBulkEligible } from '../../utils/certificateRender';
import { downloadCertificatePdf, downloadCampaignZip } from '../../utils/certificatePdf';
import CertificateCampaignFormModal from './CertificateCampaignFormModal';
import { ConfirmModal, AddMemberModal, AddExternalModal } from './CertificateRecipientModals';
import { CAMPAIGN_BADGE, RECIPIENT_BADGE, CERT_BADGE, notifyCertError } from './certificateUi';

/**
 * تفاصيل حملة + مستفيدوها.
 * canManage=false (members_manager): عرض فقط عبر RPC المراجعة؛ لا توجد دالة كتابة له في 0064،
 * فلا تُعرض أي أزرار كتابة (الخادم سيرفضها على أي حال).
 * لا يوجد اعتماد/رفض فردي في قاعدة البيانات: الإصدار جماعي على مستوى الحملة، والإزالة حذف لمستفيد معلّق.
 */
export default function CertificateCampaignDetail({ id, canManage, onBack }) {
  const { t, i18n } = useTranslation();
  const [campaign, setCampaign] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dialog, setDialog] = useState(null); // 'edit' | 'member' | 'external' | { type: 'attendance'|'issue'|'remove', ... }
  const [busy, setBusy] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState(null); // certificate_id قيد التوليد
  const [zip, setZip] = useState(null); // { running, total, done, ok, failed, failures, saved }

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setCampaign(null);
      setRecipients(null);
    }
    setError(null);
    const tasks = canManage
      ? [fetchCertificateCampaign(id), fetchCertificateRecipients(id, { canManage }), fetchCertificateTemplates().catch(() => [])]
      : [Promise.resolve(null), fetchCertificateRecipients(id, { canManage })];
    Promise.all(tasks)
      .then(([camp, rec, templates]) => {
        const c = camp || rec.campaign;
        if (!c) throw Object.assign(new Error('certificate_campaign_not_found'), { code: 'P0002' });
        setCampaign(c);
        setRecipients(rec.recipients);
        const tp = (templates || []).find((x) => x.id === c.template_id);
        setTemplateName(tp?.name || '');
      })
      .catch((err) => {
        console.error('تعذر تحميل الحملة:', err);
        if (!isCertificateSchemaMissing(err)) window.notify?.fromError(err, t('admin.certificates.detail.loadError'));
        setError(err);
      });
  }, [id, canManage, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (campaign?.title) document.title = `${campaign.title} — ${t('admin.certificates.pageTitle')}`;
  }, [campaign, t]);

  const pending = useMemo(() => (recipients || []).filter((r) => r.status === 'pending'), [recipients]);
  const issuedCount = (recipients || []).length - pending.length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (recipients || []).filter((r) =>
      (!statusFilter || r.status === statusFilter) &&
      (!q || r.display_name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.certificate_number || '').toLowerCase().includes(q)));
  }, [recipients, search, statusFilter]);
  const downloadable = useMemo(() => bulkEligible(recipients), [recipients]);
  const existingMemberIds = useMemo(() => new Set((recipients || []).map((r) => r.member_id).filter(Boolean)), [recipients]);

  const run = async (fn, okMsg, failKey) => {
    setBusy(true);
    try {
      const out = await fn();
      setDialog(null);
      window.notify?.success(typeof okMsg === 'function' ? okMsg(out) : okMsg);
      load({ silent: true });
    } catch (err) {
      notifyCertError(err, t, failKey);
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async (r) => {
    if (pdfBusyId || zip?.running) return;
    setPdfBusyId(r.certificate_id);
    try {
      await downloadCertificatePdf(r.certificate_id);
      window.notify?.success(t('admin.certificates.pdf.downloadOk'));
    } catch (err) {
      notifyCertError(err, t, 'admin.certificates.pdf.downloadFailed');
    } finally {
      setPdfBusyId(null);
    }
  };

  const downloadAll = async () => {
    if (pdfBusyId || zip?.running || downloadable.length === 0) return;
    const items = downloadable.map((r) => ({ id: r.certificate_id, name: r.display_name }));
    setZip({ running: true, total: items.length, done: 0, ok: 0, failed: 0, failures: [], saved: false });
    try {
      const res = await downloadCampaignZip({
        items,
        campaignTitle: campaign.title,
        onProgress: (p) => setZip((z) => ({ ...(z || {}), running: true, ...p })),
      });
      setZip({ running: false, total: res.total, done: res.total, ok: res.ok, failed: res.failures.length, failures: res.failures, saved: res.saved });
      if (res.saved) window.notify?.success(t('admin.certificates.pdf.bulkDone', { ok: res.ok, failed: res.failures.length }));
      else window.notify?.error(t('admin.certificates.pdf.bulkNoneGenerated'));
    } catch (err) {
      setZip(null);
      notifyCertError(err, t, 'admin.certificates.pdf.downloadFailed');
    }
  };

  if (error) {
    return (
      <>
        <AdminPageHeader title={t('admin.certificates.title')} actions={<button type="button" className="admin-quick-action" onClick={onBack}>{t('admin.certificates.back')}</button>} />
        <div className="admin-panel">
          <StateBox state="error" errorText={isCertificateSchemaMissing(error) ? t('admin.certificates.unavailable') : t('admin.certificates.detail.loadError')} onRetry={() => load()} />
        </div>
      </>
    );
  }
  if (!campaign || !recipients) {
    return (
      <>
        <AdminPageHeader title={t('admin.certificates.title')} />
        <div className="admin-panel"><StateBox state="loading" /></div>
      </>
    );
  }

  const archived = campaign.status === 'archived';
  const isDraft = campaign.status === 'draft';
  const date = (v) => (v ? formatDate(v, i18n.language) : '—');
  const canIssue = canManage && !archived && pending.length > 0;
  const noActivity = campaign.eligibility_source === 'attendance_based' && !campaign.activity_id;

  const actions = (
    <>
      <button type="button" className="admin-quick-action" onClick={onBack}>{t('admin.certificates.back')}</button>
      {canManage && isDraft && <button type="button" className="admin-quick-action" onClick={() => setDialog('edit')}>{t('admin.common.edit')}</button>}
    </>
  );

  return (
    <>
      <AdminPageHeader
        title={campaign.title}
        subtitle={<span className={`admin-badge admin-badge-${CAMPAIGN_BADGE[campaign.status] || 'muted'}`}>{t(`admin.certificates.status.${campaign.status}`, { defaultValue: campaign.status })}</span>}
        actions={actions}
      />
      {!canManage && <p className="admin-hint">{t('admin.certificates.reviewOnlyNotice')}</p>}

      <div className="admin-panel">
        <h2>{t('admin.certificates.detail.details')}</h2>
        <dl className="admin-form-grid-2">
          <div><dt className="admin-hint">{t('admin.certificates.colType')}</dt><dd>{t(`admin.certificates.types.${campaign.certificate_type}`, { defaultValue: campaign.certificate_type })}</dd></div>
          <div><dt className="admin-hint">{t('admin.certificates.colSource')}</dt><dd>{t(`admin.certificates.sources.${campaign.eligibility_source}`, { defaultValue: campaign.eligibility_source })}</dd></div>
          <div><dt className="admin-hint">{t('admin.certificates.colLanguage')}</dt><dd>{t(`admin.certificates.languages.${campaign.language}`, { defaultValue: campaign.language })}</dd></div>
          {canManage && (
            <>
              <div><dt className="admin-hint">{t('admin.certificates.detail.nameMode')}</dt><dd>{t(`admin.certificates.nameModes.${campaign.public_name_mode}`, { defaultValue: campaign.public_name_mode })}</dd></div>
              <div><dt className="admin-hint">{t('admin.certificates.detail.template')}</dt><dd>{templateName || '—'}</dd></div>
              <div><dt className="admin-hint">{t('admin.certificates.detail.activity')}</dt><dd>{campaign.activity_title_snapshot || '—'}{campaign.activity_date_snapshot ? ` (${date(campaign.activity_date_snapshot)})` : ''}</dd></div>
              <div><dt className="admin-hint">{t('admin.certificates.detail.createdAt')}</dt><dd>{date(campaign.created_at)}</dd></div>
              <div><dt className="admin-hint">{t('admin.certificates.detail.issuedAt')}</dt><dd>{date(campaign.issued_at)}</dd></div>
            </>
          )}
          <div><dt className="admin-hint">{t('admin.certificates.colRecipients')}</dt><dd>{t('admin.certificates.recipientsCount', { total: recipients.length, issued: issuedCount })}</dd></div>
        </dl>
        {canManage && !isDraft && <p className="admin-hint">{t('admin.certificates.detail.lockedAfterDraft')}</p>}
      </div>

      <div className="admin-panel">
        <h2>{t('admin.certificates.recipients.heading')}</h2>

        {canManage && !archived && (
          <div className="admin-quick-actions">
            {campaign.eligibility_source === 'attendance_based' && (
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={noActivity} onClick={() => setDialog({ type: 'attendance' })}>
                {t('admin.certificates.add.fromAttendance')}
              </button>
            )}
            {campaign.eligibility_source === 'manual_selection' && (
              <>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setDialog('member')}>{t('admin.certificates.add.addMember')}</button>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setDialog('external')}>{t('admin.certificates.add.addExternal')}</button>
              </>
            )}
            <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={!canIssue} onClick={() => setDialog({ type: 'issue' })}>
              {t('admin.certificates.issue.button')}
            </button>
          </div>
        )}
        {canManage && !archived && pending.length > 0 && <p className="admin-hint">{t('admin.certificates.issue.scope')}</p>}

        {canManage && (
          <div className="admin-quick-actions">
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={downloadable.length === 0 || !!zip?.running || !!pdfBusyId} onClick={downloadAll}>
              {zip?.running ? t('admin.certificates.pdf.bulkBusy') : `${t('admin.certificates.pdf.bulkButton')} (${downloadable.length})`}
            </button>
          </div>
        )}
        {canManage && <p className="admin-hint">{downloadable.length === 0 ? t('admin.certificates.pdf.bulkNone') : t('admin.certificates.pdf.bulkHint')}</p>}
        {zip && (
          <div className="admin-panel" role="status" aria-live="polite">
            <progress value={zip.done} max={Math.max(1, zip.total)} style={{ width: '100%' }} />
            <p>{t('admin.certificates.pdf.bulkProgress', { done: zip.done, total: zip.total, ok: zip.ok, failed: zip.failed })}</p>
            {!zip.running && zip.failures.length > 0 && (
              <>
                <p className="admin-hint">{t('admin.certificates.pdf.bulkFailures')}</p>
                <ul>
                  {zip.failures.map((f) => (
                    <li key={f.id}>{f.name} — {t(`admin.certificates.errors.${f.code}`, { defaultValue: f.code })}</li>
                  ))}
                </ul>
              </>
            )}
            {!zip.running && <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setZip(null)}>{t('admin.certificates.pdf.bulkClose')}</button>}
          </div>
        )}

        <div className="admin-search-row">
          <input type="search" className="admin-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.certificates.recipients.searchPlaceholder')} aria-label={t('admin.certificates.recipients.searchPlaceholder')} />
          <select className="admin-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('admin.certificates.filterStatus')}>
            <option value="">{t('admin.certificates.allStatuses')}</option>
            <option value="pending">{t('admin.certificates.recStatus.pending')}</option>
            <option value="issued">{t('admin.certificates.recStatus.issued')}</option>
          </select>
        </div>

        <StateBox
          state={recipients.length === 0 ? 'empty' : filtered.length === 0 ? 'empty' : ''}
          emptyText={recipients.length === 0 ? t('admin.certificates.recipients.empty') : t('admin.certificates.recipients.emptyFiltered')}
        />

        {filtered.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.certificates.recipients.colName')}</th>
                  <th>{t('admin.certificates.recipients.colEmail')}</th>
                  <th>{t('admin.certificates.recipients.colKind')}</th>
                  <th>{t('admin.certificates.colSource')}</th>
                  <th>{t('admin.certificates.colStatus')}</th>
                  <th>{t('admin.certificates.recipients.colNumber')}</th>
                  {canManage && <th>{t('admin.certificates.colActions')}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('admin.certificates.recipients.colName')}><strong>{r.display_name}</strong></td>
                    <td data-label={t('admin.certificates.recipients.colEmail')} dir="ltr">
                      {canManage ? (r.email || t('admin.certificates.recipients.noEmail')) : (r.has_email ? t('admin.certificates.recipients.hasEmail') : t('admin.certificates.recipients.noEmail'))}
                    </td>
                    <td data-label={t('admin.certificates.recipients.colKind')}>{t(`admin.certificates.kinds.${r.kind}`, { defaultValue: r.kind })}</td>
                    <td data-label={t('admin.certificates.colSource')}>{t(`admin.certificates.sources.${r.eligibility_source}`, { defaultValue: r.eligibility_source })}</td>
                    <td data-label={t('admin.certificates.colStatus')}>
                      <span className={`admin-badge admin-badge-${RECIPIENT_BADGE[r.status] || 'muted'}`}>{t(`admin.certificates.recStatus.${r.status}`, { defaultValue: r.status })}</span>
                      {r.certificate_status && (
                        <>{' '}<span className={`admin-badge admin-badge-${CERT_BADGE[r.certificate_status] || 'muted'}`}>{t(`admin.certificates.certStatus.${r.certificate_status}`, { defaultValue: r.certificate_status })}</span></>
                      )}
                    </td>
                    <td data-label={t('admin.certificates.recipients.colNumber')} dir="ltr">{r.certificate_number || '—'}</td>
                    {canManage && (
                      <td className="admin-cell-actions">
                        {r.status === 'pending' && !archived && (
                          <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDialog({ type: 'remove', recipient: r })}>{t('admin.certificates.remove.button')}</button>
                        )}
                        {isBulkEligible(r) && (
                          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={!!pdfBusyId || !!zip?.running} onClick={() => downloadOne(r)}>
                            {pdfBusyId === r.certificate_id ? t('admin.certificates.pdf.downloading') : t('admin.certificates.pdf.download')}
                          </button>
                        )}
                        {!isBulkEligible(r) && !(r.status === 'pending' && !archived) && '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog === 'edit' && (
        <CertificateCampaignFormModal campaign={campaign} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load({ silent: true }); }} />
      )}
      {dialog === 'member' && (
        <AddMemberModal campaignId={campaign.id} existingMemberIds={existingMemberIds} onChanged={() => load({ silent: true })} onClose={() => setDialog(null)} />
      )}
      {dialog === 'external' && (
        <AddExternalModal campaignId={campaign.id} onChanged={() => load({ silent: true })} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'attendance' && (
        <ConfirmModal title={t('admin.certificates.add.fromAttendance')} confirmLabel={t('admin.certificates.add.fromAttendanceConfirm')} busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => addAttendanceRecipients(campaign.id),
            (n) => (n > 0 ? t('admin.certificates.add.fromAttendanceOk', { count: n }) : t('admin.certificates.add.fromAttendanceNone')),
            'admin.certificates.add.addFailed')}>
          <p>{t('admin.certificates.add.fromAttendanceBody', { activity: campaign.activity_title_snapshot || '—' })}</p>
        </ConfirmModal>
      )}
      {dialog?.type === 'issue' && (
        <ConfirmModal title={t('admin.certificates.issue.title')} confirmLabel={t('admin.certificates.issue.confirm')} busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => issueCertificateCampaign(campaign.id),
            (r) => t('admin.certificates.issue.ok', { issued: r.issued ?? 0, skipped: r.skipped ?? 0 }),
            'admin.certificates.issue.failed')}>
          <p>{t('admin.certificates.issue.body', { count: pending.length })}</p>
          <p className="admin-hint">{t('admin.certificates.issue.irreversible')}</p>
        </ConfirmModal>
      )}
      {dialog?.type === 'remove' && (
        <ConfirmModal title={t('admin.certificates.remove.title')} confirmLabel={t('admin.certificates.remove.confirm')} danger busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => removeCertificateRecipient(dialog.recipient.id), t('admin.certificates.remove.ok'), 'admin.certificates.remove.failed')}>
          <p><strong>{dialog.recipient.display_name}</strong></p>
          <p>{t('admin.certificates.remove.body')}</p>
        </ConfirmModal>
      )}
    </>
  );
}
