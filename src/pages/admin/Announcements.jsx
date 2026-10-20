import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import StateBox from '../../components/admin/StateBox';
import AnnouncementFormModal from './AnnouncementFormModal';
import {
  fetchAnnouncementsAdmin, deleteAnnouncement, setAnnouncementFlags,
} from '../../services/supabase/adminAnnouncements.service';
import { formatDate } from '../../utils/i18nContent';

/** حالة العرض: draft | scheduled | expired | published */
function announcementStatus(a, now = Date.now()) {
  if (!a.is_active) return 'draft';
  if (a.start_at && new Date(a.start_at).getTime() > now) return 'scheduled';
  if (a.end_at && new Date(a.end_at).getTime() < now) return 'expired';
  return 'published';
}
const STATUS_BADGE = { published: 'approved', scheduled: 'pending', expired: 'muted', draft: 'rejected' };

export default function Announcements() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined); // undefined=مغلق، null=جديد، كائن=تعديل
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    document.title = t('admin.announcements.pageTitle');
  }, [t]);

  const load = useCallback(() => {
    setRows(null);
    setError(false);
    fetchAnnouncementsAdmin()
      .then(setRows)
      .catch((err) => {
        console.error('تعذر تحميل الإعلانات:', err);
        window.notify?.fromError(err, t('admin.announcements.loadError'));
        setError(true);
      });
  }, [t]);

  useEffect(load, [load]);

  const toggle = async (a, flags, okKey) => {
    setBusyId(a.id);
    try {
      await setAnnouncementFlags(a, flags);
      window.notify?.success(t(`admin.announcements.${okKey}`));
      load();
    } catch (err) {
      window.notify?.fromError(err, t('admin.announcements.updateFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (a) => {
    setDeleteTarget(null);
    const toast = window.notify?.loading(t('admin.common.deleting'));
    try {
      await deleteAnnouncement(a);
      toast?.remove();
      window.notify?.success(t('admin.common.deleted'));
      load();
    } catch (err) {
      toast?.remove();
      window.notify?.fromError(err, t('admin.common.deleteFailed'));
    }
  };

  const state = error ? 'error' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : '';
  const dash = '—';

  return (
    <AdminLayout>
      <AdminPageHeader
        title={t('admin.announcements.title')}
        subtitle={t('admin.announcements.subtitle')}
        actions={<button type="button" className="admin-quick-action" onClick={() => setFormTarget(null)}>{t('admin.announcements.new')}</button>}
      />

      <div className="admin-panel">
        <StateBox state={state} emptyText={t('admin.announcements.empty')} errorText={t('admin.announcements.loadError')} onRetry={load} />
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('admin.announcements.colTitle')}</th>
                  <th>{t('admin.announcements.colType')}</th>
                  <th>{t('admin.announcements.colStatus')}</th>
                  <th>{t('admin.announcements.colDates')}</th>
                  <th>{t('admin.announcements.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const st = announcementStatus(a);
                  const busy = busyId === a.id;
                  return (
                    <tr key={a.id}>
                      <td data-label={t('admin.announcements.colTitle')}>
                        <span className="admin-ann-title">{a.title || a.text}</span>
                      </td>
                      <td data-label={t('admin.announcements.colType')}>{t(`announcements.types.${a.type || 'general'}`)}</td>
                      <td data-label={t('admin.announcements.colStatus')}>
                        <span className={`admin-badge admin-badge-${STATUS_BADGE[st]}`}>{t(`admin.announcements.${st}`)}</span>{' '}
                        {a.is_pinned && <span className="admin-badge admin-badge-pinned">{t('admin.announcements.pinned')}</span>}
                      </td>
                      <td data-label={t('admin.announcements.colDates')} style={{ fontSize: '.8rem' }}>
                        {a.start_at ? formatDate(a.start_at, i18n.language) : dash} → {a.end_at ? formatDate(a.end_at, i18n.language) : dash}
                      </td>
                      <td className="admin-cell-actions">
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy}
                          onClick={() => toggle(a, { is_active: !a.is_active }, a.is_active ? 'unpublishedOk' : 'publishedOk')}>
                          {a.is_active ? t('admin.announcements.unpublish') : t('admin.announcements.publish')}
                        </button>
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy}
                          onClick={() => toggle(a, { is_pinned: !a.is_pinned }, a.is_pinned ? 'unpinnedOk' : 'pinnedOk')}>
                          {a.is_pinned ? t('admin.announcements.unpin') : t('admin.announcements.pin')}
                        </button>
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(a)}>{t('admin.common.edit')}</button>
                        <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(a)}>{t('admin.common.delete')}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <AnnouncementFormModal
          announcement={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>{t('admin.common.confirmDelete')}</h3>
          <p><strong>{deleteTarget.title || deleteTarget.text}</strong></p>
          <p>{t('admin.announcements.deleteConfirm')}</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{t('admin.common.delete')}</button>
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{t('admin.common.cancel')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
