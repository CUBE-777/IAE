import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { listAchievements, listGames, reorderItems, saveAchievement, setAchievementActive } from '../services/gamesAdmin.service';
import { cleanI18n, CODE_RE, fillI18n, pickName } from '../services/gamesAdmin.shared';
import { ACHIEVEMENT_CRITERIA } from '../constants/gamesAdmin';
import { ActivePill, Field, LocalizedFields, MoveButtons, moveItem, notifyError } from '../components/adminUi';

function AchievementForm({ item, games, nextOrder, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState({
    code: item?.code || '',
    title: fillI18n(item?.title),
    description: fillI18n(item?.description),
    icon: item?.icon || '',
    points_bonus: String(item?.points_bonus ?? 0),
    type: ACHIEVEMENT_CRITERIA.includes(item?.criteria?.type) ? item.criteria.type : ACHIEVEMENT_CRITERIA[0],
    threshold: String(item?.criteria?.threshold ?? ''),
    game_id: item?.criteria?.game_id || '',
    is_active: item ? item.is_active : true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (patch) => setV((p) => ({ ...p, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    const title = cleanI18n(v.title);
    const code = v.code.trim();
    const bonus = Number(v.points_bonus);
    const threshold = Number(v.threshold);
    if (!title) er.title = t('games.admin.errors.nameRequired');
    if (!CODE_RE.test(code)) er.code = t('games.admin.errors.codeInvalid');
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > 10000) er.points_bonus = t('games.admin.errors.pointsRange');
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 999999999) er.threshold = t('games.admin.errors.thresholdInvalid');
    setErrors(er);
    if (Object.keys(er).length) return;
    const criteria = { type: v.type, threshold };
    if (v.type === 'challenges_solved' && v.game_id) criteria.game_id = v.game_id;
    setSaving(true);
    try {
      const payload = { code, title, description: cleanI18n(v.description), icon: v.icon.trim() || null, points_bonus: bonus, criteria, is_active: v.is_active };
      if (!item) payload.sort_order = nextOrder;
      await saveAchievement(item?.id, payload);
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{item ? t('games.admin.achievements.edit') : t('games.admin.achievements.new')}</h3>
      <form onSubmit={submit} noValidate>
        <LocalizedFields label={t('games.admin.fields.title')} required value={v.title} onChange={(title) => set({ title })} error={errors.title} />
        <LocalizedFields label={t('games.admin.fields.description')} multiline maxLength={1000} value={v.description} onChange={(description) => set({ description })} />
        <div className="admin-form-grid-2">
          <Field id="a_code" label={t('games.admin.fields.code')} hint={t('games.admin.fields.codeHint')} error={errors.code}>
            <input id="a_code" className="admin-input" dir="ltr" maxLength={64} value={v.code} onChange={(e) => set({ code: e.target.value })} />
          </Field>
          <Field id="a_icon" label={t('games.admin.fields.icon')}>
            <input id="a_icon" className="admin-input" dir="ltr" maxLength={64} value={v.icon} onChange={(e) => set({ icon: e.target.value })} />
          </Field>
          <Field id="a_bonus" label={t('games.admin.fields.bonus')} hint={t('games.admin.fields.bonusHint')} error={errors.points_bonus}>
            <input id="a_bonus" type="number" min="0" max="10000" className="admin-input" dir="ltr" value={v.points_bonus} onChange={(e) => set({ points_bonus: e.target.value })} />
          </Field>
          <div />
          <Field id="a_type" label={t('games.admin.fields.criteriaType')}>
            <select id="a_type" className="admin-select" value={v.type} onChange={(e) => set({ type: e.target.value })}>
              {ACHIEVEMENT_CRITERIA.map((c) => <option key={c} value={c}>{t(`games.admin.criteria.${c}`)}</option>)}
            </select>
          </Field>
          <Field id="a_thr" label={t('games.admin.fields.threshold')} error={errors.threshold}>
            <input id="a_thr" type="number" min="1" className="admin-input" dir="ltr" value={v.threshold} onChange={(e) => set({ threshold: e.target.value })} />
          </Field>
        </div>
        {v.type === 'challenges_solved' && (
          <Field id="a_game" label={t('games.admin.fields.criteriaGame')} hint={t('games.admin.fields.criteriaGameHint')}>
            <select id="a_game" className="admin-select" value={v.game_id} onChange={(e) => set({ game_id: e.target.value })}>
              <option value="">{t('games.admin.allGames')}</option>
              {games.map((g) => <option key={g.id} value={g.id}>{pickName(g.title, i18n.language)}</option>)}
            </select>
          </Field>
        )}
        <label className="admin-check">
          <input type="checkbox" checked={v.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> {t('games.admin.fields.isActive')}
        </label>
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

export default function AchievementsTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(() => Promise.all([listAchievements(), listGames()]));
  const [form, setForm] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [rows, games] = data || [[], []];
  const gameName = useMemo(() => Object.fromEntries(games.map((g) => [g.id, pickName(g.title, i18n.language)])), [games, i18n.language]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };
  const move = (from, to) => run(() => reorderItems('achievement', moveItem(rows, from, to).map((r) => r.id)));
  const toggle = (a) => run(async () => {
    await setAchievementActive(a.id, !a.is_active);
    window.notify?.success(t(a.is_active ? 'games.admin.deactivatedOk' : 'games.admin.activatedOk'));
  });
  const describe = (a) => {
    const c = a.criteria || {};
    const base = t(`games.admin.criteria.${c.type}`, { defaultValue: String(c.type || '—') });
    return `${base}: ${c.threshold ?? '—'}${c.game_id ? ` (${gameName[c.game_id] || '…'})` : ''}`;
  };

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.achievements')}>
      <div className="ga-toolbar">
        <button type="button" className="admin-quick-action" disabled={state !== 'ready'} onClick={() => setForm(null)}>{t('games.admin.achievements.new')}</button>
      </div>
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.achievements.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.title')}</th><th>{t('games.admin.fields.criteria')}</th><th>{t('games.admin.fields.bonus')}</th>
                  <th>{t('games.admin.fields.status')}</th><th>{t('games.admin.fields.order')}</th><th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={a.id}>
                    <td data-label={t('games.admin.fields.title')}><span className="admin-ann-title">{pickName(a.title, i18n.language)}</span><span className="admin-ann-sub" dir="ltr">{a.code}</span></td>
                    <td data-label={t('games.admin.fields.criteria')}>{describe(a)}</td>
                    <td data-label={t('games.admin.fields.bonus')}>{a.points_bonus}</td>
                    <td data-label={t('games.admin.fields.status')}><ActivePill active={a.is_active} /></td>
                    <td data-label={t('games.admin.fields.order')}><MoveButtons index={i} count={rows.length} disabled={busy} onMove={move} /></td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => toggle(a)}>
                        {a.is_active ? t('games.admin.deactivate') : t('games.admin.activate')}
                      </button>
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm(a)}>{t('admin.common.edit')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form !== undefined && (
        <AchievementForm item={form} games={games} nextOrder={rows.length + 1} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload(); }} />
      )}
    </section>
  );
}
