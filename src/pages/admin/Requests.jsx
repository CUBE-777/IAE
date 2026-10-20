import { useCallback, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import {
  fetchRequestsByStatus,
  approveMembershipRequest,
  rejectMembershipRequest,
} from '../../services/supabase/membershipRequests.service';
import { formatDate } from '../../utils/i18nContent';

const TABS = ['pending', 'approved', 'rejected'];
const TAB_KEY = { pending: 'tabPending', approved: 'tabApproved', rejected: 'tabRejected' };
const EMPTY_KEY = { pending: 'emptyPending', approved: 'emptyApproved', rejected: 'emptyRejected' };
const FIELD = (v) => (v == null || v === '' ? '—' : v);

export default function Requests() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'view'|'approve'|'reject', row }
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    setError(false);
    fetchRequestsByStatus(tab)
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

  const doApprove = async (row) => {
    closeModal();
    setBusy(true);
    window.notify?.loading(t('admin.requests.approving'));
    try {
      await approveMembershipRequest(row.id);
      window.notify?.success(t('admin.requests.approved'));
      load();
    } catch (err) {
      window.notify?.fromError(err, t('admin.requests.approveFailed'));
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
        {rows === null && !error && <div className="admin-state-box">{t('admin.requests.loading')}</div>}
        {error && <div className="admin-state-box">{t('admin.requests.loadError')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{t(`admin.requests.${EMPTY_KEY[tab]}`)}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.requests.colName')}</th>
                  <th>{t('admin.requests.colEmail')}</th>
                  <th>{t('admin.requests.colPhone')}</th>
                  <th>{t('admin.requests.colPromotion')}</th>
                  <th>{t('admin.requests.colCity')}</th>
                  <th>{t('admin.requests.colDate')}</th>
                  <th>{t('admin.requests.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label={t('admin.requests.colName')}>{r.full_name}</td>
                    <td data-label={t('admin.requests.colEmail')}>{r.email}</td>
                    <td data-label={t('admin.requests.colPhone')}>{FIELD(r.phone)}</td>
                    <td data-label={t('admin.requests.colPromotion')}>{FIELD(r.promotion)}</td>
                    <td data-label={t('admin.requests.colCity')}>{FIELD(r.city)}</td>
                    <td data-label={t('admin.requests.colDate')}>{formatDate(r.created_at, i18n.language)}</td>
                    <td className="admin-cell-actions">
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setModal({ type: 'view', row: r })}>
                        {t('admin.requests.view')}
                      </button>
                      {tab === 'pending' && (
                        <>
                          <button
                            className="admin-btn admin-btn-primary admin-btn-sm"
                            disabled={busy}
                            onClick={() => setModal({ type: 'approve', row: r })}
                          >
                            {t('admin.requests.approve')}
                          </button>
                          <button
                            className="admin-btn admin-btn-danger admin-btn-sm"
                            disabled={busy}
                            onClick={() => setModal({ type: 'reject', row: r })}
                          >
                            {t('admin.requests.reject')}
                          </button>
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
          <h3>{t('admin.requests.detailsTitle')}</h3>
          <p><strong>{t('admin.requests.colName')}:</strong> {modal.row.full_name}</p>
          <p><strong>{t('admin.requests.colEmail')}:</strong> {modal.row.email}</p>
          <p><strong>{t('admin.requests.colPhone')}:</strong> {FIELD(modal.row.phone)}</p>
          <p><strong>{t('admin.requests.colPromotion')}:</strong> {FIELD(modal.row.promotion)}</p>
          <p><strong>{t('admin.requests.fieldTrack')}:</strong> {FIELD(modal.row.track)}</p>
          <p><strong>{t('admin.requests.fieldProfession')}:</strong> {FIELD(modal.row.profession)}</p>
          <p><strong>{t('admin.requests.colCity')}:</strong> {FIELD(modal.row.city)}</p>
          <p><strong>{t('admin.requests.fieldMessage')}:</strong> {FIELD(modal.row.message)}</p>
          {modal.row.rejection_reason && <p><strong>{t('admin.requests.fieldRejectionReason')}:</strong> {modal.row.rejection_reason}</p>}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-ghost" onClick={closeModal}>{t('admin.common.close')}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'approve' && (
        <Modal onClose={closeModal}>
          <h3>{t('admin.requests.approveTitle')}</h3>
          <p>
            <Trans
              i18nKey="admin.requests.approveBody"
              values={{ name: modal.row.full_name }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-primary" onClick={() => doApprove(modal.row)}>{t('admin.requests.approveConfirm')}</button>
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
