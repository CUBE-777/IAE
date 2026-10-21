import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { fetchAuditLogs, AUDIT_ENTITY_OPTIONS, AUDIT_PAGE_SIZE } from '../../services/supabase/auditLog.service';

import { tr, dateLocale } from '../../i18n/adminDict';
export default function Audit() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    document.title = tr('سجل العمليات — لوحة إدارة النادي');
  }, []);

  useEffect(() => {
    setRows(null);
    setError(false);
    fetchAuditLogs({ page, entity })
      .then(({ rows: r, total: t }) => {
        setRows(r);
        setTotal(t);
      })
      .catch((err) => {
        console.error('تعذر تحميل السجل:', err);
        window.notify?.fromError(err, tr('تعذر تحميل السجل'));
        setError(true);
      });
  }, [page, entity]);

  const totalPages = Math.ceil(total / AUDIT_PAGE_SIZE);

  return (
    <AdminLayout>
      <AdminPageHeader title={tr('سجل العمليات الإدارية')} subtitle={tr('سجل كامل بكل العمليات الحساسة في لوحة الإدارة')} />

      <div className="admin-panel">
        <div style={{ marginBottom: 16 }}>
          <select
            className="admin-select"
            style={{ width: 'auto' }}
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPage(1);
            }}
          >
            {AUDIT_ENTITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{tr(label)}</option>
            ))}
          </select>
        </div>

        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر التحميل.')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا توجد عمليات مسجّلة.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead><tr><th>{tr('المسؤول')}</th><th>{tr('العملية')}</th><th>{tr('الوصف')}</th><th>{tr('التاريخ')}</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td data-label={tr('المسؤول')}>{a.profiles?.full_name || '—'}</td>
                    <td data-label={tr('العملية')}><code style={{ fontSize: '.8rem' }}>{a.action}</code></td>
                    <td data-label={tr('الوصف')}>{a.description || '—'}</td>
                    <td data-label={tr('التاريخ')} style={{ fontSize: '.82rem' }}>{new Date(a.created_at).toLocaleString(dateLocale())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className="admin-btn admin-btn-ghost admin-btn-sm"
                style={p === page ? { background: 'var(--admin-accent)', color: 'var(--admin-bg)', borderColor: 'var(--admin-accent)' } : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
