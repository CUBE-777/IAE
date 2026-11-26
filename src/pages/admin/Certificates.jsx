import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import { useAuth } from '../../app/providers/AuthProvider';
import { ROLES_CERT_MANAGE } from '../../constants/roles';
import { fetchCertificateCampaigns, isCertificateSchemaMissing } from '../../services/supabase/adminCertificates.service';
import CertificateCampaignFormModal from './CertificateCampaignFormModal';
import CertificateCampaignDetail from './CertificateCampaignDetail';
import { CAMPAIGN_BADGE } from './certificateUi';

const STATUSES = ['draft', 'issued', 'archived'];

export default function Certificates() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const canManage = ROLES_CERT_MANAGE.includes(profile?.role);
  const [params, setParams] = useSearchParams();
  const campaignId = params.get('c');

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    document.title = t('admin.certificates.pageTitle');
  }, [t]);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    fetchCertificateCampaigns()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل حملات الشهادات:', err);
        if (!isCertificateSchemaMissing(err)) window.notify?.fromError(err, t('admin.certificates.loadError'));
        setError(err);
      });
  }, [t]);

  useEffect(() => {
    if (!campaignId) load();
  }, [campaignId, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((c) => (!status || c.status === status) && (!q || String(c.title || '').toLowerCase().includes(q)));
  }, [rows, search, status]);

  const open = (id) => setParams({ c: id });
  const back = () => setParams({});

  if (campaignId) {
    return (
      <AdminLayout>
        <CertificateCampaignDetail id={campaignId} canManage={canManage} onBack={back} />
      </AdminLayout>
    );
  }

  const state = error ? 'error' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : filtered.length === 0 ? 'empty-filtered' : '';

  return (
    <AdminLayout>
      <AdminPageHeader
        title={t('admin.certificates.title')}
        subtitle={t('admin.certificates.subtitle')}
        actions={canManage ? <button type="button" className="admin-quick-action" onClick={() => setCreating(true)}>{t('admin.certificates.new')}</button> : null}
      />

      {!canManage && <p className="admin-hint">{t('admin.certificates.reviewOnlyNotice')}</p>}

      <div className="admin-panel">
        <div className="admin-search-row">
          <input type="search" className="admin-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.certificates.search')} aria-label={t('admin.certificates.search')} />
          <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('admin.certificates.filterStatus')}>
            <option value="">{t('admin.certificates.allStatuses')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`admin.certificates.status.${s}`)}</option>)}
          </select>
        </div>

        <StateBox
          state={state === 'empty-filtered' ? 'empty' : state}
          emptyText={state === 'empty-filtered' ? t('admin.certificates.emptyFiltered') : t('admin.certificates.empty')}
          errorText={isCertificateSchemaMissing(error) ? t('admin.certificates.unavailable') : t('admin.certificates.loadError')}
          onRetry={load}
        />

        {rows && filtered.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.certificates.colTitle')}</th>
                  <th>{t('admin.certificates.colType')}</th>
                  <th>{t('admin.certificates.colSource')}</th>
                  <th>{t('admin.certificates.colLanguage')}</th>
                  <th>{t('admin.certificates.colStatus')}</th>
                  <th>{t('admin.certificates.colRecipients')}</th>
                  <th>{t('admin.certificates.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td data-label={t('admin.certificates.colTitle')}><strong>{c.title}</strong></td>
                    <td data-label={t('admin.certificates.colType')}>{t(`admin.certificates.types.${c.certificate_type}`, { defaultValue: c.certificate_type })}</td>
                    <td data-label={t('admin.certificates.colSource')}>{t(`admin.certificates.sources.${c.eligibility_source}`, { defaultValue: c.eligibility_source })}</td>
                    <td data-label={t('admin.certificates.colLanguage')}>{t(`admin.certificates.languages.${c.language}`, { defaultValue: c.language })}</td>
                    <td data-label={t('admin.certificates.colStatus')}>
                      <span className={`admin-badge admin-badge-${CAMPAIGN_BADGE[c.status] || 'muted'}`}>{t(`admin.certificates.status.${c.status}`, { defaultValue: c.status })}</span>
                    </td>
                    <td data-label={t('admin.certificates.colRecipients')}>{t('admin.certificates.recipientsCount', { total: c.recipients_count ?? 0, issued: c.issued_count ?? 0 })}</td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => open(c.id)}>{t('admin.certificates.open')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CertificateCampaignFormModal
          campaign={null}
          onClose={() => setCreating(false)}
          onSaved={(newId) => {
            setCreating(false);
            if (newId) open(newId);
            else load();
          }}
        />
      )}
    </AdminLayout>
  );
}
