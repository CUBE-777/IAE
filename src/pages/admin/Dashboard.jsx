import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, CalendarPlus, ImagePlus, FileEdit } from 'lucide-react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StatusBadge from '../../components/admin/StatusBadge';
import StateBox from '../../components/admin/StateBox';
import { useAuth } from '../../app/providers/AuthProvider';
import { fetchDashboardStats, fetchRecentMembershipRequests, fetchRecentAuditLogs } from '../../services/supabase/dashboard.service';
import { localeFor } from '../../utils/i18nContent';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const locale = localeFor(i18n.language);
  const [stats, setStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false); // فشل كلي للاستعلامات
  const [requests, setRequests] = useState([]);
  const [requestsState, setRequestsState] = useState('loading'); // loading | ok | forbidden | error
  const [audit, setAudit] = useState([]);
  const [auditState, setAuditState] = useState('loading');

  const loadStats = useCallback(() => {
    setStats(null);
    setStatsFailed(false);
    fetchDashboardStats()
      .then(setStats)
      .catch((err) => {
        console.error('تعذر تحميل الإحصائيات:', err);
        setStatsFailed(true);
      });
  }, []);

  const loadRequests = useCallback(() => {
    if (!['developer', 'super_admin', 'deputy_super_admin', 'members_manager', 'secretary_general', 'deputy_secretary_general'].includes(profile.role)) {
      setRequestsState('forbidden');
      return;
    }
    setRequestsState('loading');
    fetchRecentMembershipRequests()
      .then((data) => {
        setRequests(data);
        setRequestsState('ok');
      })
      .catch((err) => {
        console.error('تعذر تحميل الطلبات:', err);
        setRequestsState('error');
      });
  }, [profile.role]);

  const loadAudit = useCallback(() => {
    if (!['developer', 'super_admin'].includes(profile.role)) {
      setAuditState('forbidden');
      return;
    }
    setAuditState('loading');
    fetchRecentAuditLogs()
      .then((data) => {
        setAudit(data);
        setAuditState('ok');
      })
      .catch((err) => {
        console.error('تعذر تحميل سجل العمليات:', err);
        setAuditState('error');
      });
  }, [profile.role]);

  useEffect(() => {
    document.title = t('admin.dashboard.pageTitle');
  }, [t]);
  useEffect(loadStats, [loadStats]);
  useEffect(loadRequests, [loadRequests]);
  useEffect(loadAudit, [loadAudit]);

  const someStatFailed = stats && stats.some((s) => s.error);
  const firstName = (profile.full_name || '').split(' ')[0];

  return (
    <AdminLayout>
      <AdminPageHeader
        title={t('admin.dashboard.hello', { name: firstName })}
        subtitle={t('admin.dashboard.subtitle')}
        actions={
          <>
            <Link to="/admin/members" className="admin-quick-action"><UserPlus size={15} aria-hidden="true" /> {t('admin.dashboard.addMember')}</Link>
            <Link to="/admin/activities" className="admin-quick-action"><CalendarPlus size={15} aria-hidden="true" /> {t('admin.dashboard.addActivity')}</Link>
            <Link to="/admin/gallery" className="admin-quick-action"><ImagePlus size={15} aria-hidden="true" /> {t('admin.dashboard.uploadImages')}</Link>
            <Link to="/admin/content" className="admin-quick-action"><FileEdit size={15} aria-hidden="true" /> {t('admin.dashboard.editContent')}</Link>
          </>
        }
      />

      {statsFailed ? (
        <div className="admin-panel">
          <StateBox state="error" errorText={t('admin.dashboard.statsError')} onRetry={loadStats} />
        </div>
      ) : (
        <>
          <div className="admin-stat-grid">
            {(stats || Array(5).fill(null)).map((s, i) => (
              <div className="admin-stat-card" key={s ? s.key : i}>
                <div className="admin-stat-label">{s ? t(`admin.dashboard.${s.key}`) : '...'}</div>
                {/* 0 حقيقي يُعرض 0؛ الفشل يُعرض "—" مع تنبيه، ولا يُعرض 0 أبدًا عند الخطأ */}
                <div className={`admin-stat-value${s?.error ? ' is-unavailable' : ''}`}>
                  {s ? (s.error ? t('admin.dashboard.statUnavailable') : s.value) : '–'}
                </div>
              </div>
            ))}
          </div>
          {someStatFailed && (
            <div className="admin-state-box admin-state-error" role="alert">
              <span>{t('admin.dashboard.statsError')}</span>
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={loadStats}>{t('admin.common.retry')}</button>
            </div>
          )}
        </>
      )}

      <div className="admin-panel">
        <h2>{t('admin.dashboard.recentRequests')}</h2>
        <StateBox state={requestsState === 'ok' ? (requests.length === 0 ? 'empty' : '') : requestsState}
          emptyText={t('admin.dashboard.noRequests')} errorText={t('admin.dashboard.requestsError')} onRetry={loadRequests} />
        {requestsState === 'forbidden' && <div className="admin-state-box">{t('admin.common.noPermission')}</div>}
        {requestsState === 'ok' && requests.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.dashboard.colName')}</th><th>{t('admin.dashboard.colEmail')}</th>
                  <th>{t('admin.dashboard.colStatus')}</th><th>{t('admin.dashboard.colDate')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('admin.dashboard.colName')}>{r.full_name}</td>
                    <td data-label={t('admin.dashboard.colEmail')} dir="ltr">{r.email}</td>
                    <td data-label={t('admin.dashboard.colStatus')}><StatusBadge status={r.status} /></td>
                    <td data-label={t('admin.dashboard.colDate')}>{new Date(r.created_at).toLocaleDateString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="admin-panel">
        <h2>{t('admin.dashboard.recentAudit')}</h2>
        <StateBox state={auditState === 'ok' ? (audit.length === 0 ? 'empty' : '') : auditState}
          emptyText={t('admin.dashboard.noAudit')} errorText={t('admin.dashboard.auditError')} onRetry={loadAudit} />
        {auditState === 'forbidden' && <div className="admin-state-box">{t('admin.common.noPermission')}</div>}
        {auditState === 'ok' && audit.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.dashboard.colAction')}</th><th>{t('admin.dashboard.colDescription')}</th><th>{t('admin.dashboard.colDate')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td data-label={t('admin.dashboard.colAction')}>{a.action}</td>
                    <td data-label={t('admin.dashboard.colDescription')}>{a.description || '—'}</td>
                    <td data-label={t('admin.dashboard.colDate')}>{new Date(a.created_at).toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
