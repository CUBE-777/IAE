import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { listPlayers } from '../services/gamesAdmin.service';
import { getStageStatus, grantStage, listStageGrants, revokeStageGrant } from '../services/gamesPaths.service';
import { pickName } from '../services/gamesAdmin.shared';
import { ADJUST_NOTE_MAX } from '../constants/gamesAdmin';
import { notifyError } from './adminUi';

const fmtDate = (iso, lang) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** حالة لاعب في مرحلة كما حسبها الخادم (قراءة فقط). */
function StatusSummary({ s }) {
  const { t } = useTranslation();
  const yn = (b) => t(b ? 'games.admin.yes' : 'games.admin.no');
  return (
    <dl className="ga-stage-status">
      <div><dt>{t('games.admin.paths.grantsModal.unlocked')}</dt><dd>{yn(s.unlocked)}</dd></div>
      <div><dt>{t('games.admin.paths.grantsModal.complete')}</dt><dd>{yn(s.complete)}</dd></div>
      <div><dt>{t('games.admin.paths.grantsModal.required')}</dt><dd>{s.required_solved}/{s.required_total}</dd></div>
      <div><dt>{t('games.admin.paths.grantsModal.solved')}</dt><dd>{s.challenges_solved}/{s.challenges_total}</dd></div>
      <div><dt>{t('games.admin.paths.grantsModal.points')}</dt><dd>{s.points_earned}/{s.points_available}</dd></div>
    </dl>
  );
}

/**
 * المنح اليدوي: فتح مرحلة (فئة manual) واعتماد إكمالها (مرحلة manual) وإلغاؤهما.
 * الخادم يتحقق من كل شيء (الوضع، سلسلة اللعبة/المسار/الفئة/المرحلة، حساب اللاعب)؛ هنا عرض وإخفاء أزرار غير منطبقة فقط.
 */
export default function StageGrantsModal({ stage, category, onClose }) {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(() => listStageGrants(stage.id), [stage.id]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [players, setPlayers] = useState(null);   // null = لم يُبحث بعد
  const [searching, setSearching] = useState(false);
  const [statuses, setStatuses] = useState({});    // user_id → حالة الخادم
  const [revokeId, setRevokeId] = useState(null);

  const canUnlock = category?.stage_unlock_mode === 'manual';
  const canComplete = stage.completion_mode === 'manual';
  const locked = stage.status === 'archived';
  const rows = data || [];

  const search = async (e) => {
    e.preventDefault();
    setSearching(true);
    try {
      const res = await listPlayers({ search: q.trim(), page: 1, pageSize: 8 });
      setPlayers(res?.rows || []);
    } catch (err) {
      notifyError(t, err);
    } finally {
      setSearching(false);
    }
  };

  const grant = async (userId, kind) => {
    setBusy(true);
    try {
      const res = await grantStage(stage.id, userId, kind, note.trim());
      window.notify?.success(t(res?.result === 'exists' ? 'games.admin.paths.grantsModal.alreadyGranted' : 'games.admin.paths.grantsModal.granted'));
      setStatuses((s) => { const n = { ...s }; delete n[userId]; return n; });
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    setBusy(true);
    try {
      await revokeStageGrant(id);
      window.notify?.success(t('games.admin.paths.grantsModal.revoked'));
      setRevokeId(null);
      setStatuses({});
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  const check = async (userId) => {
    try {
      const s = await getStageStatus(stage.id, userId);
      setStatuses((x) => ({ ...x, [userId]: s }));
    } catch (err) {
      notifyError(t, err);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{t('games.admin.paths.grantsModal.title', { name: pickName(stage.title, i18n.language) })}</h3>

      {!canUnlock && !canComplete && <p className="admin-state-box admin-state-error" role="note">{t('games.admin.paths.grantsModal.notApplicable')}</p>}
      {locked && <p className="admin-state-box admin-state-error" role="note">{t('games.admin.errors.stage_archived')}</p>}

      <h4 className="ga-sub">{t('games.admin.paths.grantsModal.listTitle')}</h4>
      <StateBox state={state === 'ready' ? (rows.length ? '' : 'empty') : state} emptyText={t('games.admin.paths.grantsModal.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
      {rows.length > 0 && (
        <ul className="ga-assign-list">
          {rows.map((g) => (
            <li key={g.id} className="ga-assign-row">
              <span className="ga-assign-name">
                <strong>{g.display_name}</strong> <span className="admin-hint" dir="ltr">{g.email}</span>
                <span className="admin-badge admin-badge-pending">{t(`games.admin.paths.grantsModal.kinds.${g.kind}`)}</span>
                <span className="admin-hint">{fmtDate(g.created_at, i18n.language)}{g.note ? ` — ${g.note}` : ''}</span>
              </span>
              {revokeId === g.id ? (
                <span className="ga-inline-confirm">
                  <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={busy} onClick={() => revoke(g.id)}>{t('games.admin.paths.grantsModal.revokeConfirm')}</button>
                  <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setRevokeId(null)}>{t('admin.common.cancel')}</button>
                </span>
              ) : (
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setRevokeId(g.id)}>{t('games.admin.paths.grantsModal.revoke')}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(canUnlock || canComplete) && !locked && (
        <>
          <h4 className="ga-sub">{t('games.admin.paths.grantsModal.addTitle')}</h4>
          <form className="ga-grant-search" onSubmit={search} role="search">
            <label htmlFor="ga_grant_q" className="ga-sr-only">{t('games.admin.paths.grantsModal.searchLabel')}</label>
            <input id="ga_grant_q" className="admin-input ga-search" value={q} maxLength={80} placeholder={t('games.admin.paths.grantsModal.searchPlaceholder')} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="admin-btn admin-btn-primary" disabled={searching || q.trim().length < 2}>
              {searching && <span className="admin-btn-spinner" aria-hidden="true" />}{t('games.admin.paths.grantsModal.search')}
            </button>
          </form>
          <div className="admin-form-group">
            <label htmlFor="ga_grant_note">{t('games.admin.paths.grantsModal.noteLabel')}</label>
            <input id="ga_grant_note" className="admin-input" maxLength={ADJUST_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {players && players.length === 0 && <p className="ga-empty">{t('games.admin.paths.grantsModal.noResults')}</p>}
          {players && players.length > 0 && (
            <ul className="ga-assign-list">
              {players.map((p) => (
                <li key={p.user_id} className="ga-assign-row ga-assign-col">
                  <div className="ga-assign-row">
                    <span className="ga-assign-name"><strong>{p.display_name}</strong> <span className="admin-hint" dir="ltr">{p.email}</span></span>
                    <span className="ga-inline-confirm">
                      {canUnlock && <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy} onClick={() => grant(p.user_id, 'unlock')}>{t('games.admin.paths.grantsModal.grantUnlock')}</button>}
                      {canComplete && <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy} onClick={() => grant(p.user_id, 'complete')}>{t('games.admin.paths.grantsModal.approveComplete')}</button>}
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => check(p.user_id)}>{t('games.admin.paths.grantsModal.check')}</button>
                    </span>
                  </div>
                  {statuses[p.user_id] && <StatusSummary s={statuses[p.user_id]} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('games.admin.paths.close')}</button>
      </div>
    </Modal>
  );
}
