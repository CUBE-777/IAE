import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import { setChallengeStage } from '../services/gamesPaths.service';
import { pickName } from '../services/gamesAdmin.shared';
import { StatusPill, notifyError } from './adminUi';

/**
 * إسناد تحديات قائمة إلى مرحلة وتحديد الإلزامي منها (بنية فقط: لا محتوى ولا حلول ولا إصدارات).
 * المرشّحون: تحديات اللعبة بلا مرحلة فقط. لنقل تحدٍّ بين مراحل يُفكّ أولًا ثم يُسند (فلا يتغيّر تقدّم لاعبين دون قصد).
 * `challenges` من الأب بعد كل إعادة تحميل (بيانات حيّة).
 */
export default function StageChallengesModal({ stage, challenges, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const [pickRequired, setPickRequired] = useState(true);
  const assigned = challenges.filter((c) => c.stage_id === stage.id);
  const available = challenges.filter((c) => !c.stage_id && c.status !== 'archived');
  const locked = stage.status === 'archived';

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      window.notify?.success(t('admin.common.saved'));
      await onChanged();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{t('games.admin.paths.challengesModal.title', { name: pickName(stage.title, i18n.language) })}</h3>
      <p className="admin-hint">{t('games.admin.paths.challengesModal.hint')}</p>

      {assigned.length === 0 ? (
        <p className="ga-empty">{t('games.admin.paths.challengesModal.none')}</p>
      ) : (
        <ul className="ga-assign-list">
          {assigned.map((c) => (
            <li key={c.id} className="ga-assign-row">
              <span className="ga-assign-name">{pickName(c.title, i18n.language) || c.slug} <StatusPill status={c.status} /></span>
              <label className="admin-check">
                <input type="checkbox" checked={c.is_required} disabled={busy || locked}
                  onChange={(e) => run(() => setChallengeStage(c.id, stage.id, e.target.checked))} /> {t('games.admin.paths.challengesModal.required')}
              </label>
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy || locked} onClick={() => run(() => setChallengeStage(c.id, null, true))}>
                {t('games.admin.paths.challengesModal.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ga-assign-add">
        <label htmlFor="ga_assign_pick">{t('games.admin.paths.challengesModal.addLabel')}</label>
        {available.length === 0 ? (
          <p className="admin-hint">{t('games.admin.paths.challengesModal.noneAvailable')}</p>
        ) : (
          <div className="ga-assign-controls">
            <select id="ga_assign_pick" className="admin-select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || locked}>
              <option value="">{t('games.admin.paths.challengesModal.choose')}</option>
              {available.map((c) => <option key={c.id} value={c.id}>{pickName(c.title, i18n.language) || c.slug}</option>)}
            </select>
            <label className="admin-check">
              <input type="checkbox" checked={pickRequired} onChange={(e) => setPickRequired(e.target.checked)} /> {t('games.admin.paths.challengesModal.required')}
            </label>
            <button type="button" className="admin-btn admin-btn-primary" disabled={busy || locked || !pick}
              onClick={() => run(async () => { await setChallengeStage(pick, stage.id, pickRequired); setPick(''); })}>
              {busy && <span className="admin-btn-spinner" aria-hidden="true" />}{t('games.admin.paths.challengesModal.add')}
            </button>
          </div>
        )}
      </div>
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('games.admin.paths.close')}</button>
      </div>
    </Modal>
  );
}
