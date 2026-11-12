import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { deleteLevel, listLevels, saveLevel } from '../services/gamesAdmin.service';
import { cleanI18n, fillI18n, pickName } from '../services/gamesAdmin.shared';
import { ConfirmModal, Field, LocalizedFields, notifyError } from '../components/adminUi';

function LevelForm({ item, nextLevel, onClose, onSaved }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    level: String(item?.level ?? nextLevel),
    min_points: String(item?.min_points ?? ''),
    title: fillI18n(item?.title),
    icon: item?.icon || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const zeroLocked = item?.min_points === 0;

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    const title = cleanI18n(v.title);
    const level = Number(v.level);
    const min = Number(v.min_points);
    if (!title) er.title = t('games.admin.errors.nameRequired');
    if (!item && (!Number.isInteger(level) || level < 1)) er.level = t('games.admin.errors.levelInvalid');
    if (!Number.isInteger(min) || min < 0 || min > 2147483647) er.min_points = t('games.admin.errors.minPointsInvalid');
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      await saveLevel(item ? item.level : null, { level, min_points: min, title, icon: v.icon.trim() || null });
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{item ? t('games.admin.levels.edit') : t('games.admin.levels.new')}</h3>
      <form onSubmit={submit} noValidate>
        <LocalizedFields label={t('games.admin.fields.levelName')} required value={v.title} onChange={(title) => setV({ ...v, title })} error={errors.title} />
        <div className="admin-form-grid-2">
          <Field id="l_level" label={t('games.admin.fields.levelNumber')} error={errors.level}>
            <input id="l_level" type="number" min="1" className="admin-input" dir="ltr" value={v.level} disabled={!!item} onChange={(e) => setV({ ...v, level: e.target.value })} />
          </Field>
          <Field id="l_min" label={t('games.admin.fields.minPoints')} hint={zeroLocked ? t('games.admin.levels.zeroLocked') : t('games.admin.levels.minPointsHint')} error={errors.min_points}>
            <input id="l_min" type="number" min="0" className="admin-input" dir="ltr" value={v.min_points} disabled={zeroLocked} onChange={(e) => setV({ ...v, min_points: e.target.value })} />
          </Field>
          <Field id="l_icon" label={t('games.admin.fields.icon')}>
            <input id="l_icon" className="admin-input" dir="ltr" maxLength={64} value={v.icon} onChange={(e) => setV({ ...v, icon: e.target.value })} />
          </Field>
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}{t('admin.common.save')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function LevelsTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(listLevels);
  const [form, setForm] = useState(undefined);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data || [];
  const nextLevel = rows.reduce((m, l) => Math.max(m, l.level), 0) + 1;

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteLevel(del.level);
      window.notify?.success(t('games.admin.deletedOk'));
      setDel(null);
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.levels')}>
      <div className="ga-toolbar">
        <p className="admin-hint ga-grow">{t('games.admin.levels.hint')}</p>
        <button type="button" className="admin-quick-action" disabled={state !== 'ready'} onClick={() => setForm(null)}>{t('games.admin.levels.new')}</button>
      </div>
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.levels.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.levelNumber')}</th><th>{t('games.admin.fields.levelName')}</th>
                  <th>{t('games.admin.fields.minPoints')}</th><th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.level}>
                    <td data-label={t('games.admin.fields.levelNumber')}>{l.level}</td>
                    <td data-label={t('games.admin.fields.levelName')}>
                      <span className="admin-ann-title">{pickName(l.title, i18n.language)}</span>
                      <span className="admin-ann-sub">{['ar', 'fr', 'en'].filter((k) => l.title?.[k]).map((k) => `${k.toUpperCase()}: ${l.title[k]}`).join(' · ')}</span>
                    </td>
                    <td data-label={t('games.admin.fields.minPoints')}>{l.min_points}</td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm(l)}>{t('admin.common.edit')}</button>
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={l.min_points === 0} title={l.min_points === 0 ? t('games.admin.levels.zeroLocked') : undefined} onClick={() => setDel(l)}>{t('admin.common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form !== undefined && <LevelForm item={form} nextLevel={nextLevel} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload(); }} />}
      {del && (
        <ConfirmModal title={t('admin.common.confirmDelete')} confirmLabel={t('admin.common.delete')} busy={busy} onConfirm={doDelete} onClose={() => setDel(null)}>
          <p><strong>{t('games.admin.fields.levelNumber')} {del.level} — {pickName(del.title, i18n.language)}</strong></p>
          <p>{t('games.admin.levels.deleteConfirm')}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
